-- Islamabad Parks and Recreation GIS: practice queries
-- Each query below is also used, in parameterised form, by the API in src/app.js.

-- 1. Retrieve: every facility with its coordinates
SELECT id, name, category, sector, status,
       ROUND(ST_Y(geom)::numeric, 5) AS lat,
       ROUND(ST_X(geom)::numeric, 5) AS lng
FROM facilities
ORDER BY name;

-- 2. Filter by two attributes: open parks in the F-9 sector
SELECT id, name, category, sector, status
FROM facilities
WHERE category = 'Park' AND sector = 'F-9' AND status = 'Open';

-- 3. Filter with a text search on the name
SELECT id, name, sector FROM facilities WHERE name ILIKE '%park%' ORDER BY name;

-- 4. Count: facilities per category
SELECT category, COUNT(*) AS facilities
FROM facilities
GROUP BY category
ORDER BY facilities DESC, category;

-- 5. Count: facilities per sector
SELECT sector, COUNT(*) AS facilities
FROM facilities
GROUP BY sector
ORDER BY facilities DESC, sector;

-- 6. Spatial: area of each mapped outline in hectares (geography gives square metres)
SELECT name, ROUND((ST_Area(boundary::geography) / 10000)::numeric, 2) AS area_ha
FROM facilities
WHERE boundary IS NOT NULL
ORDER BY area_ha DESC
LIMIT 10;

-- 7. Spatial: facilities within 3 km of Faisal Mosque, nearest first
SELECT name, category,
       ROUND(ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(73.0374, 33.7295), 4326)::geography)::numeric) AS metres
FROM facilities
WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(73.0374, 33.7295), 4326)::geography, 3000)
ORDER BY metres;

-- 8. Update: F-9 Park has free entry (the trigger sets updated_at)
UPDATE facilities
SET entry = 'Free'
WHERE name = 'Fatima Jinnah Park'
RETURNING id, name, entry, updated_at;

-- 9. Insert: a new facility (the CHECK constraints reject bad categories and points outside the study area)
INSERT INTO facilities (name, category, sector, source, geom)
VALUES ('Example Walking Track', 'Walking track', 'F-10', 'Field observation',
        ST_SetSRID(ST_MakePoint(73.0105, 33.6935), 4326))
RETURNING id, name;

-- 10. Validation test: this insert fails because the point is outside the study area
-- INSERT INTO facilities (name, category, sector, geom)
-- VALUES ('Wrong place', 'Park', 'F-6', ST_SetSRID(ST_MakePoint(67.0, 24.8), 4326));

-- 11. Delete the example row again
DELETE FROM facilities WHERE name = 'Example Walking Track' RETURNING id;

-- 12. GeoJSON for one record (what the API sends to Leaflet)
SELECT json_build_object(
  'type', 'Feature',
  'geometry', ST_AsGeoJSON(geom)::json,
  'properties', json_build_object('id', id, 'name', name, 'category', category)
) AS feature
FROM facilities
WHERE name = 'Lake View Park';
