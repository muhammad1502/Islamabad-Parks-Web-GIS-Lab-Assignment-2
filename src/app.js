import express from "express";
import { query } from "./db.js";
import { issueToken, passwordMatches, requireEditor, loginLimiter } from "./auth.js";
import { validateFacility, parseId, CATEGORIES, STATUSES, ENTRY, CONDITIONS, SOURCES, BOUNDS } from "./validate.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));

app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  next();
});

// One SELECT list, so every endpoint returns the same properties.
const FEATURE_SQL = `
  json_build_object(
    'type', 'Feature',
    'id', id,
    'geometry', ST_AsGeoJSON(geom, 6)::json,
    'properties', json_build_object(
      'id', id, 'name', name, 'category', category, 'sector', sector,
      'entry', entry, 'condition', condition, 'status', status, 'notes', notes,
      'source', source, 'osm_id', osm_id,
      'area_ha', CASE WHEN boundary IS NULL THEN NULL
                      ELSE ROUND((ST_Area(boundary::geography) / 10000)::numeric, 2) END,
      'created_at', created_at, 'updated_at', updated_at
    )
  )`;

const collection = features => ({ type: "FeatureCollection", features });

app.get("/api/health", async (req, res) => {
  const { rows } = await query("SELECT PostGIS_Lib_Version() AS postgis, COUNT(*)::int AS facilities FROM facilities");
  res.json({ ok: true, database: "PostgreSQL", ...rows[0] });
});

// Lists for the filter and form drop-downs. Sectors come from the data, so new ones appear on their own.
app.get("/api/options", async (req, res) => {
  const { rows } = await query("SELECT DISTINCT sector FROM facilities ORDER BY sector");
  res.json({
    categories: CATEGORIES, statuses: STATUSES, entry: ENTRY, conditions: CONDITIONS, sources: SOURCES,
    sectors: rows.map(row => row.sector), bounds: BOUNDS
  });
});

app.get("/api/facilities", async (req, res) => {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };

  const { category, sector, status, q } = req.query;
  if (category !== undefined && category !== "") {
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: "Unknown category." });
    add("category = ?", category);
  }
  if (status !== undefined && status !== "") {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status." });
    add("status = ?", status);
  }
  if (typeof sector === "string" && sector !== "") {
    if (sector.length > 40) return res.status(400).json({ error: "Sector is too long." });
    add("sector = ?", sector);
  }
  if (typeof q === "string" && q.trim() !== "") {
    if (q.length > 80) return res.status(400).json({ error: "Search text is too long." });
    // Escape LIKE wildcards so a search for "%" means a literal percent sign.
    add("name ILIKE ?", `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`);
  }

  const sql = `SELECT ${FEATURE_SQL} AS feature FROM facilities
               ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name`;
  const { rows } = await query(sql, params);
  res.json(collection(rows.map(row => row.feature)));
});

app.get("/api/facilities/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "The id must be a positive whole number." });
  const { rows } = await query(`SELECT ${FEATURE_SQL} AS feature FROM facilities WHERE id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ error: "No facility with that id." });
  res.json(rows[0].feature);
});

// Park outlines as a separate polygon layer.
app.get("/api/boundaries", async (req, res) => {
  const { rows } = await query(`
    SELECT json_build_object('type', 'Feature', 'id', id,
      'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(boundary, 0.00001), 6)::json,
      'properties', json_build_object('id', id, 'name', name, 'category', category)) AS feature
    FROM facilities WHERE boundary IS NOT NULL ORDER BY ST_Area(boundary) DESC`);
  res.json(collection(rows.map(row => row.feature)));
});

app.get("/api/stats", async (req, res) => {
  const [totals, byCategory, bySector] = await Promise.all([
    query(`SELECT COUNT(*)::int AS facilities,
                  COUNT(DISTINCT sector)::int AS sectors,
                  COUNT(*) FILTER (WHERE status = 'Open')::int AS open,
                  COALESCE(ROUND((SUM(ST_Area(boundary::geography)) / 10000)::numeric), 0)::int AS mapped_ha
           FROM facilities`),
    query("SELECT category, COUNT(*)::int AS count FROM facilities GROUP BY category ORDER BY count DESC, category"),
    query("SELECT sector, COUNT(*)::int AS count FROM facilities GROUP BY sector ORDER BY count DESC, sector")
  ]);
  res.json({ ...totals.rows[0], categories: CATEGORIES.length, byCategory: byCategory.rows, bySector: bySector.rows });
});

// Spatial query: facilities within a radius of a point, nearest first.
app.get("/api/nearby", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Number(req.query.radius ?? 1500);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "lat and lng must be valid coordinates." });
  }
  if (!Number.isFinite(radius) || radius < 100 || radius > 10_000) {
    return res.status(400).json({ error: "radius must be between 100 and 10000 metres." });
  }
  const { rows } = await query(`
    WITH here AS (SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS g)
    SELECT ${FEATURE_SQL} AS feature, ROUND(ST_Distance(geom::geography, here.g))::int AS metres
    FROM facilities, here
    WHERE ST_DWithin(geom::geography, here.g, $3)
    ORDER BY metres`, [lat, lng, radius]);
  res.json(collection(rows.map(row => {
    row.feature.properties.distance_m = row.metres;
    return row.feature;
  })));
});

app.post("/api/login", loginLimiter, (req, res) => {
  if (!passwordMatches(req.body?.password)) {
    return res.status(401).json({ error: "That password is not correct." });
  }
  res.json(issueToken());
});

app.post("/api/facilities", requireEditor, async (req, res) => {
  const { values, errors } = validateFacility(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: errors });
  const v = values;
  const { rows } = await query(`
    INSERT INTO facilities (name, category, sector, entry, condition, status, notes, source, geom)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($9, $10), 4326))
    RETURNING ${FEATURE_SQL} AS feature`,
    [v.name, v.category, v.sector, v.entry, v.condition, v.status, v.notes, v.source, v.lng, v.lat]);
  res.status(201).json(rows[0].feature);
});

app.put("/api/facilities/:id", requireEditor, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "The id must be a positive whole number." });
  const existing = await query("SELECT source FROM facilities WHERE id = $1", [id]);
  if (!existing.rows.length) return res.status(404).json({ error: "No facility with that id." });

  // Imported rows keep their OpenStreetMap source label when edited.
  const body = { ...req.body };
  if (existing.rows[0].source === "OpenStreetMap") body.source = "User submitted";
  const { values, errors } = validateFacility(body);
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: errors });
  const v = values;
  const { rows } = await query(`
    UPDATE facilities SET
      name = $2, category = $3, sector = $4, entry = $5, condition = $6, status = $7, notes = $8,
      source = CASE WHEN source = 'OpenStreetMap' THEN source ELSE $9 END,
      geom = ST_SetSRID(ST_MakePoint($10, $11), 4326),
      -- An outline no longer applies if the point is moved outside it.
      boundary = CASE WHEN boundary IS NOT NULL AND ST_Within(ST_SetSRID(ST_MakePoint($10, $11), 4326), boundary)
                      THEN boundary ELSE NULL END
    WHERE id = $1
    RETURNING ${FEATURE_SQL} AS feature`,
    [id, v.name, v.category, v.sector, v.entry, v.condition, v.status, v.notes, v.source, v.lng, v.lat]);
  res.json(rows[0].feature);
});

app.delete("/api/facilities/:id", requireEditor, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "The id must be a positive whole number." });
  const { rowCount } = await query("DELETE FROM facilities WHERE id = $1", [id]);
  if (!rowCount) return res.status(404).json({ error: "No facility with that id." });
  res.status(204).end();
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// Express 5 passes rejected promises here, so a database error never crashes the function.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "The request body is not valid JSON." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "The request is too large." });
  // 23514 is a CHECK constraint, the database's last line of validation.
  if (err.code === "23514" || err.code === "23502") return res.status(400).json({ error: "The database rejected this record because a value is not allowed." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server. Please try again." });
});

export default app;
