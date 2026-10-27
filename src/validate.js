// The same lists are enforced by CHECK constraints in db/01_schema.sql.
export const CATEGORIES = ["Park", "Playground", "Walking track", "Sports facility", "Garden", "Viewpoint", "Wildlife park"];
export const ENTRY = ["Free", "Paid", "Unknown"];
export const CONDITIONS = ["Good", "Fair", "Poor", "Not assessed"];
export const STATUSES = ["Open", "Under maintenance", "Closed"];
// OpenStreetMap is kept for the imported rows; new rows come from the website.
export const SOURCES = ["Field observation", "User submitted"];

// Islamabad and Rawalpindi. Matches the facilities_in_study_area constraint.
export const BOUNDS = { minLat: 33.4, maxLat: 33.9, minLng: 72.7, maxLng: 73.5 };

const SECTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .'()/-]{0,39}$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function text(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function coordinate(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

/**
 * Checks a facility sent by the website. Returns { values, errors }, where errors maps
 * a field name to a message the form can show next to that field.
 */
export function validateFacility(body) {
  const errors = {};
  const input = body && typeof body === "object" ? body : {};

  const name = text(input.name);
  if (name.length < 3) errors.name = "Enter a name of at least 3 characters.";
  else if (name.length > 120) errors.name = "Keep the name under 120 characters.";
  else if (CONTROL_CHARS.test(name) || /[<>]/.test(name)) errors.name = "The name contains characters that are not allowed.";

  const category = text(input.category);
  if (!CATEGORIES.includes(category)) errors.category = "Choose a category from the list.";

  const sector = text(input.sector);
  if (!sector) errors.sector = "Enter the sector or area, for example F-9.";
  else if (!SECTOR_PATTERN.test(sector)) errors.sector = "Use letters, numbers, spaces and - / only (up to 40 characters).";

  const entry = text(input.entry) || "Unknown";
  if (!ENTRY.includes(entry)) errors.entry = "Choose Free, Paid or Unknown.";

  const condition = text(input.condition) || "Not assessed";
  if (!CONDITIONS.includes(condition)) errors.condition = "Choose a condition from the list.";

  const status = text(input.status) || "Open";
  if (!STATUSES.includes(status)) errors.status = "Choose a status from the list.";

  const source = text(input.source) || "User submitted";
  if (!SOURCES.includes(source)) errors.source = "Choose Field observation or User submitted.";

  const rawNotes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (rawNotes.length > 500) errors.notes = "Keep notes under 500 characters.";
  else if (CONTROL_CHARS.test(rawNotes)) errors.notes = "Notes contain characters that are not allowed.";

  const lat = coordinate(input.lat);
  const lng = coordinate(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    errors.location = "Pick the location on the map or enter latitude and longitude.";
  } else if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) {
    errors.location = "The location must be inside Islamabad or Rawalpindi.";
  }

  return {
    errors,
    values: {
      name, category, sector, entry, condition, status, source,
      notes: rawNotes || null,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6
    }
  };
}

/** Reads a positive integer id from the URL, or returns null. */
export function parseId(value) {
  return /^[1-9]\d{0,8}$/.test(String(value)) ? Number(value) : null;
}
