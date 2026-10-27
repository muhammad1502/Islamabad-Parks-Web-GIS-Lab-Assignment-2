"use strict";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const phone = matchMedia("(max-width: 600px)");

// Category colours. Checked for contrast against both basemaps and kept apart from the status ring.
const CATEGORY_COLOURS = {
  "Park": "#1d7a43",
  "Playground": "#e08a00",
  "Walking track": "#0f7bbf",
  "Sports facility": "#d23f3a",
  "Garden": "#c2367f",
  "Viewpoint": "#6a4c93",
  "Wildlife park": "#0e7c74"
};
const colourFor = category => CATEGORY_COLOURS[category] || "#5f665c";

const state = {
  options: null,
  features: [],
  markers: new Map(),
  activeId: null,
  nearby: null,
  firstLoad: true
};

/* ---------- API ---------- */

const TOKEN_KEY = "islamabad-parks-editor";
function readToken() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
    if (saved && typeof saved.token === "string" && saved.expires > Date.now()) return saved.token;
  } catch {}
  return null;
}
function saveToken(value) {
  try { value ? sessionStorage.setItem(TOKEN_KEY, JSON.stringify(value)) : sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  const token = readToken();
  if (token && method !== "GET") headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection and try again.", 0);
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && method !== "GET" && path !== "/api/login") setEditor(false);
    throw new ApiError(data.error || `Request failed (${response.status}).`, response.status, data.fields);
  }
  return data;
}

/* ---------- Map ---------- */

const map = L.map("map", { zoomControl: false, minZoom: 10, maxZoom: 19, zoomSnap: 0.5 });
L.control.zoom({ position: "bottomright" }).addTo(map);
map.fitBounds([[33.55, 72.92], [33.80, 73.20]]);

const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);
const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19, attribution: "Tiles &copy; Esri"
});

const facilityLayer = L.layerGroup().addTo(map);
const outlineLayer = L.geoJSON(null, {
  style: feature => ({ color: colourFor(feature.properties.category), weight: 1.5, fillOpacity: 0.16, opacity: 0.85 }),
  onEachFeature: (feature, layer) => {
    layer.on("click", () => focusFacility(feature.properties.id, { pan: false }));
  }
}).addTo(map);
const nearbyLayer = L.layerGroup().addTo(map);

L.control.layers(
  { "OpenStreetMap": osm, "Satellite imagery": satellite },
  { "Facilities": facilityLayer, "Park outlines": outlineLayer },
  { position: "topright", collapsed: phone.matches }
).addTo(map);

function markerIcon(props) {
  const statusClass = props.status === "Closed" ? " is-closed" : props.status === "Under maintenance" ? " is-maint" : "";
  return L.divIcon({
    className: `facility-marker${statusClass}`,
    html: "",
    iconSize: [20, 20],
    popupAnchor: [0, -12]
  });
}

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "style") node.style.cssText = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(child => child !== null && child !== undefined));
  return node;
};

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });
const badgeClass = status => status === "Open" ? "badge-open" : status === "Closed" ? "badge-closed" : "badge-maint";

// Popups are built from DOM nodes, never from HTML strings, so text typed into the form cannot run as code.
function popupContent(props) {
  const rows = [
    ["Sector", props.sector],
    ["Status", el("span", { class: `badge ${badgeClass(props.status)}` }, props.status)],
    ["Condition", props.condition],
    ["Entry", props.entry],
    props.area_ha !== null ? ["Mapped area", `${props.area_ha.toLocaleString("en-GB")} ha`] : null,
    props.distance_m !== undefined ? ["Distance", formatDistance(props.distance_m)] : null,
    ["Source", props.source]
  ].filter(Boolean);
  const grid = el("dl", { class: "popup-grid" });
  rows.forEach(([label, value]) => grid.append(el("dt", {}, label), el("dd", {}, value)));

  const foot = el("div", { class: "popup-foot" }, el("span", {}, `Updated ${dateFormat.format(new Date(props.updated_at))}`));
  if (isEditor()) {
    const edit = el("button", { class: "popup-edit", type: "button" }, "Edit");
    edit.addEventListener("click", () => openFacilityForm(props.id));
    foot.append(edit);
  }
  return el("div", {},
    el("p", { class: "popup-label" }, el("i", { style: `background:${colourFor(props.category)}` }), props.category),
    el("h3", { class: "popup-title" }, props.name),
    grid,
    props.notes ? el("p", { class: "popup-notes" }, props.notes) : null,
    foot
  );
}

function formatDistance(metres) {
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;
}

function drawFacilities(features) {
  facilityLayer.clearLayers();
  state.markers.clear();
  features.forEach((feature, i) => {
    const [lng, lat] = feature.geometry.coordinates;
    const props = feature.properties;
    const marker = L.marker([lat, lng], {
      icon: markerIcon(props),
      title: props.name,
      alt: `${props.name}, ${props.category}`,
      riseOnHover: true
    });
    marker.bindPopup(() => popupContent(props), { maxWidth: 300 });
    marker.on("add", () => {
      const node = marker.getElement();
      node.style.setProperty("--c", colourFor(props.category));
      node.style.setProperty("--i", i);
    });
    marker.on("popupopen", () => setActive(props.id));
    marker.on("popupclose", () => setActive(null));
    marker.addTo(facilityLayer);
    state.markers.set(props.id, marker);
  });
}

function setActive(id) {
  state.activeId = id;
  document.querySelectorAll(".result").forEach(button => {
    button.classList.toggle("is-active", Number(button.dataset.id) === id);
  });
  state.markers.forEach((marker, markerId) => marker.getElement()?.classList.toggle("is-active", markerId === id));
}

function focusFacility(id, { pan = true } = {}) {
  const marker = state.markers.get(id);
  if (!marker) return;
  if (pan) map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: reduceMotion.matches ? 0 : 0.8 });
  marker.openPopup();
}

/* ---------- Results list ---------- */

const resultsList = document.querySelector("#results");
const resultCount = document.querySelector("#result-count");

function renderResults(features) {
  resultsList.replaceChildren();
  if (!features.length) {
    resultsList.append(el("li", { class: "results-empty" }, "No facilities match. Try another filter or clear the search."));
    return;
  }
  features.forEach(feature => {
    const props = feature.properties;
    const meta = props.distance_m !== undefined ? formatDistance(props.distance_m) : props.status === "Open" ? "" : props.status;
    const button = el("button", { class: "result", type: "button", "data-id": props.id },
      el("span", { class: "dot", style: `background:${colourFor(props.category)}`, "aria-hidden": "true" }),
      el("strong", {}, props.name),
      el("small", {}, `${props.category} · ${props.sector}`),
      el("span", { class: "meta" }, meta)
    );
    button.addEventListener("click", () => focusFacility(props.id));
    resultsList.append(el("li", {}, button));
  });
}

/* ---------- Loading data ---------- */

const filterForm = document.querySelector("#filters");

function currentFilters() {
  const data = new FormData(filterForm);
  const params = new URLSearchParams();
  for (const [key, value] of data) if (String(value).trim()) params.set(key, String(value).trim());
  return params;
}

let loadToken = 0;
async function loadFacilities() {
  const ticket = ++loadToken;
  resultCount.textContent = "Loading facilities…";
  try {
    const params = currentFilters();
    let data;
    if (state.nearby) {
      data = await api(`/api/nearby?lat=${state.nearby.lat}&lng=${state.nearby.lng}&radius=${state.nearby.radius}`);
      // The nearby query is spatial only; apply the attribute filters on top of it here.
      const wanted = Object.fromEntries(params);
      data.features = data.features.filter(f => (!wanted.category || f.properties.category === wanted.category)
        && (!wanted.sector || f.properties.sector === wanted.sector)
        && (!wanted.status || f.properties.status === wanted.status)
        && (!wanted.q || f.properties.name.toLowerCase().includes(wanted.q.toLowerCase())));
    } else {
      data = await api(`/api/facilities?${params}`);
    }
    if (ticket !== loadToken) return;
    state.features = data.features;
    drawFacilities(data.features);
    renderResults(data.features);
    const total = data.features.length;
    const noun = total === 1 ? "facility" : "facilities";
    resultCount.textContent = state.nearby
      ? `${total} ${noun} within ${formatDistance(state.nearby.radius)} of the point`
      : params.toString() ? `${total} ${noun} ${total === 1 ? "matches" : "match"} your filters` : `Showing all ${total} ${noun}`;
    if (state.firstLoad && total) {
      // Frame the data itself rather than a fixed view, so the parks fill the map at any size.
      state.firstLoad = false;
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(data.features.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]])), { padding: [30, 30] });
    } else if (!state.nearby && total && params.toString()) {
      map.flyToBounds(L.latLngBounds(data.features.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]])).pad(0.25),
        { maxZoom: 15, duration: reduceMotion.matches ? 0 : 0.8 });
    }
  } catch (error) {
    if (ticket !== loadToken) return;
    resultCount.textContent = "Could not load facilities.";
    renderResults([]);
    toast(error.message, true);
  }
}

async function loadOutlines() {
  try {
    const data = await api("/api/boundaries");
    outlineLayer.clearLayers();
    outlineLayer.addData(data);
    outlineLayer.bringToBack();
  } catch (error) {
    toast(`Park outlines did not load: ${error.message}`, true);
  }
}

function fillSelect(select, values, keepFirst = true) {
  const current = select.value;
  const first = keepFirst ? select.options[0] : null;
  select.replaceChildren(...(first ? [first] : []), ...values.map(value => el("option", { value }, value)));
  if (values.includes(current)) select.value = current;
}

async function loadOptions() {
  state.options = await api("/api/options");
  const o = state.options;
  fillSelect(document.querySelector("#filter-category"), o.categories);
  fillSelect(document.querySelector("#filter-sector"), o.sectors);
  fillSelect(document.querySelector("#filter-status"), o.statuses);
  const form = document.querySelector("#facility-form");
  fillSelect(form.category, o.categories);
  fillSelect(form.status, o.statuses, false);
  fillSelect(form.condition, o.conditions, false);
  fillSelect(form.entry, o.entry, false);
  document.querySelector("#sector-list").replaceChildren(...o.sectors.map(value => el("option", { value })));
  const legend = document.querySelector("#legend");
  legend.replaceChildren(...o.categories.map(category => el("li", {},
    el("span", { class: "legend-swatch", style: `background:${colourFor(category)}`, "aria-hidden": "true" }), category)));
}

/* ---------- Statistics ---------- */

function countUp(node, target) {
  if (reduceMotion.matches || !Number.isFinite(target)) { node.textContent = target.toLocaleString("en-GB"); return; }
  const from = Number(node.dataset.value || 0);
  const start = performance.now(), duration = 900;
  node.dataset.value = target;
  requestAnimationFrame(function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    node.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3))).toLocaleString("en-GB");
    if (t < 1) requestAnimationFrame(frame);
  });
}

function renderBars(list, rows, key, colour) {
  const max = Math.max(...rows.map(row => row.count), 1);
  list.replaceChildren(...rows.map(row => el("li", {},
    el("span", {}, row[key]),
    el("span", { class: "track", "aria-hidden": "true" },
      el("span", { class: "fill", style: `--w:${(row.count / max) * 100}%;--c:${colour(row[key])}` })),
    el("b", {}, String(row.count))
  )));
}

async function loadStats() {
  try {
    const stats = await api("/api/stats");
    document.querySelectorAll("[data-stat]").forEach(node => countUp(node, stats[node.dataset.stat]));
    renderBars(document.querySelector("#bars-category"), stats.byCategory, "category", colourFor);
    renderBars(document.querySelector("#bars-sector"), stats.bySector.slice(0, 10), "sector", () => "var(--accent)");
  } catch (error) {
    toast(`Statistics did not load: ${error.message}`, true);
  }
}

/* ---------- Filters and nearby search ---------- */

let searchTimer;
filterForm.addEventListener("input", event => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadFacilities, event.target.type === "search" ? 250 : 0);
});
filterForm.addEventListener("submit", event => { event.preventDefault(); loadFacilities(); });
filterForm.addEventListener("reset", () => {
  setNearbyMode(false);
  clearNearby();
  setTimeout(loadFacilities);
});

const hint = document.querySelector("#map-hint");
const nearbyToggle = document.querySelector("#nearby-toggle");
let mapMode = null; // "nearby" | "pick" | null

function showHint(text) {
  hint.textContent = text;
  hint.hidden = !text;
  map.getContainer().style.cursor = text ? "crosshair" : "";
}

function setNearbyMode(on) {
  mapMode = on ? "nearby" : mapMode === "nearby" ? null : mapMode;
  nearbyToggle.setAttribute("aria-pressed", String(on));
  showHint(on ? "Click anywhere on the map to find facilities within 1.5 km" : "");
}

function clearNearby() {
  state.nearby = null;
  nearbyLayer.clearLayers();
}

nearbyToggle.addEventListener("click", () => {
  const turningOn = nearbyToggle.getAttribute("aria-pressed") !== "true";
  if (!turningOn && state.nearby) {
    clearNearby();
    loadFacilities();
  }
  setNearbyMode(turningOn);
});

map.on("click", event => {
  if (mapMode === "nearby") {
    const { lat, lng } = event.latlng;
    state.nearby = { lat: lat.toFixed(6), lng: lng.toFixed(6), radius: 1500 };
    nearbyLayer.clearLayers();
    L.circle(event.latlng, { radius: 1500, className: "nearby-ring", interactive: false }).addTo(nearbyLayer);
    L.circleMarker(event.latlng, { radius: 5, color: "#fff", weight: 2, fillColor: "#1d7a43", fillOpacity: 1, interactive: false }).addTo(nearbyLayer);
    map.flyToBounds(L.latLng(lat, lng).toBounds(3400), { duration: reduceMotion.matches ? 0 : 0.8 });
    showHint("Showing facilities within 1.5 km. Click again to move the point.");
    loadFacilities();
  } else if (mapMode === "pick") {
    finishPick(event.latlng);
  }
});

/* ---------- Editor sign-in ---------- */

const signinDialog = document.querySelector("#signin-dialog");
const signinForm = document.querySelector("#signin-form");
const signinError = document.querySelector("#signin-error");
const editorChip = document.querySelector("#editor-chip");
const addButton = document.querySelector("#add-button");
const signinOpen = document.querySelector("#signin-open");

const isEditor = () => Boolean(readToken());

function setEditor(on, session) {
  if (on && session) saveToken(session);
  if (!on) saveToken(null);
  editorChip.hidden = !on;
  addButton.hidden = !on;
  signinOpen.textContent = on ? "Sign out" : "Editor sign-in";
  editorChip.setAttribute("aria-label", on ? "Signed in as editor. Sign out" : "");
  editorChip.title = on ? "Signed in as editor. Click to sign out." : "";
  map.closePopup();
}

function signOut() {
  setEditor(false);
  toast("Signed out.");
}

signinOpen.addEventListener("click", () => {
  if (isEditor()) return signOut();
  signinError.textContent = "";
  signinForm.reset();
  signinDialog.showModal();
});
editorChip.addEventListener("click", signOut);

signinForm.addEventListener("submit", async event => {
  event.preventDefault();
  const password = signinForm.password.value;
  if (!password) { signinError.textContent = "Enter the editor password."; signinForm.password.focus(); return; }
  const submit = signinForm.querySelector("[type=submit]");
  submit.disabled = true;
  try {
    const session = await api("/api/login", { method: "POST", body: { password } });
    setEditor(true, session);
    signinDialog.close();
    toast("Signed in. You can now add and edit facilities.");
  } catch (error) {
    signinError.textContent = error.message;
    signinForm.password.select();
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll("dialog [data-close]").forEach(button => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
// Clicking the dimmed backdrop closes a dialog, a larger target than the close button.
document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
});

/* ---------- Add and edit form ---------- */

const facilityDialog = document.querySelector("#facility-dialog");
const facilityForm = document.querySelector("#facility-form");
const facilityTitle = document.querySelector("#facility-title");
const facilityError = document.querySelector("#facility-error");
const deleteButton = document.querySelector("#delete-button");
const saveButton = document.querySelector("#save-button");
const notesCounter = document.querySelector("#notes-counter");
let editingId = null;
let pickMarker = null;

const pickIcon = L.divIcon({
  className: "pick-marker",
  html: '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="#d23f3a" stroke="#fff" stroke-width="1.5" d="M12 1.5a7.5 7.5 0 0 0-7.5 7.5c0 5.6 7.5 13.5 7.5 13.5S19.5 14.6 19.5 9A7.5 7.5 0 0 0 12 1.5Z"/><circle cx="12" cy="9" r="2.8" fill="#fff"/></svg>',
  iconSize: [26, 26]
});

function setPickMarker(latlng) {
  if (!pickMarker) {
    pickMarker = L.marker(latlng, { icon: pickIcon, draggable: true, keyboard: false, zIndexOffset: 2000 }).addTo(map);
    pickMarker.on("dragend", () => writeLocation(pickMarker.getLatLng()));
  } else {
    pickMarker.setLatLng(latlng);
  }
}

function writeLocation(latlng) {
  facilityForm.lat.value = latlng.lat.toFixed(6);
  facilityForm.lng.value = latlng.lng.toFixed(6);
}

function clearFieldErrors() {
  facilityError.textContent = "";
  facilityForm.querySelectorAll(".field-error").forEach(node => { node.textContent = ""; });
  facilityForm.querySelectorAll("[aria-invalid]").forEach(node => node.removeAttribute("aria-invalid"));
}

function showFieldErrors(fields) {
  let first = null;
  for (const [field, message] of Object.entries(fields)) {
    const slot = facilityForm.querySelector(`#err-${field}`);
    if (slot) slot.textContent = message;
    const inputs = field === "location" ? [facilityForm.lat, facilityForm.lng] : [facilityForm.elements[field]];
    inputs.forEach(input => input?.setAttribute("aria-invalid", "true"));
    first ||= inputs[0];
  }
  first?.focus();
}

function openFacilityForm(id = null) {
  const feature = id ? state.features.find(f => f.properties.id === id) : null;
  if (id && !feature) return toast("That facility is not in the current list. Clear the filters and try again.", true);
  editingId = id;
  map.closePopup();
  facilityForm.reset();
  clearFieldErrors();
  const sourceSelect = facilityForm.source;
  const sources = feature?.properties.source === "OpenStreetMap" ? ["OpenStreetMap"] : state.options.sources;
  fillSelect(sourceSelect, sources, false);
  sourceSelect.disabled = feature?.properties.source === "OpenStreetMap";

  if (feature) {
    const p = feature.properties;
    facilityTitle.textContent = "Edit facility";
    for (const key of ["name", "category", "sector", "status", "condition", "entry", "source"]) facilityForm.elements[key].value = p[key];
    facilityForm.notes.value = p.notes || "";
    const [lng, lat] = feature.geometry.coordinates;
    writeLocation({ lat, lng });
    setPickMarker([lat, lng]);
  } else {
    facilityTitle.textContent = "Add facility";
    facilityForm.status.value = "Open";
    facilityForm.condition.value = "Not assessed";
    facilityForm.entry.value = "Unknown";
    facilityForm.source.value = "Field observation";
    if (pickMarker) { pickMarker.remove(); pickMarker = null; }
  }
  notesCounter.textContent = `${facilityForm.notes.value.length} / 500`;
  deleteButton.hidden = !feature;
  facilityDialog.showModal();
}

addButton.addEventListener("click", () => openFacilityForm());
facilityForm.notes.addEventListener("input", () => { notesCounter.textContent = `${facilityForm.notes.value.length} / 500`; });
facilityForm.addEventListener("input", event => {
  const field = event.target.name === "lat" || event.target.name === "lng" ? "location" : event.target.name;
  const slot = facilityForm.querySelector(`#err-${field}`);
  if (slot) slot.textContent = "";
  event.target.removeAttribute("aria-invalid");
  if (!facilityForm.querySelector("[aria-invalid]")) facilityError.textContent = "";
  if (field === "location") {
    const lat = Number(facilityForm.lat.value), lng = Number(facilityForm.lng.value);
    if (Number.isFinite(lat) && Number.isFinite(lng) && facilityForm.lat.value && facilityForm.lng.value) setPickMarker([lat, lng]);
  }
});

// Picking a location closes the dialog for a moment so the whole map can be clicked.
document.querySelector("#pick-location").addEventListener("click", () => {
  mapMode = "pick";
  nearbyToggle.setAttribute("aria-pressed", "false");
  facilityDialog.close();
  showHint("Click the map where the facility is. Press Esc to cancel.");
  document.querySelector("#map-section").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth" });
});

function finishPick(latlng) {
  mapMode = null;
  showHint("");
  if (latlng) {
    writeLocation(latlng);
    setPickMarker(latlng);
  }
  facilityDialog.showModal();
  facilityForm.querySelector("#err-location").textContent = "";
  facilityForm.lat.removeAttribute("aria-invalid");
  facilityForm.lng.removeAttribute("aria-invalid");
}

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (mapMode === "pick") finishPick(null);
  else if (mapMode === "nearby") setNearbyMode(false);
});

facilityDialog.addEventListener("close", () => {
  if (mapMode !== "pick" && pickMarker) { pickMarker.remove(); pickMarker = null; }
});

// Mirrors src/validate.js so most mistakes are caught before the request is sent.
function validateLocally(values) {
  const errors = {};
  const b = state.options.bounds;
  if (values.name.length < 3) errors.name = "Enter a name of at least 3 characters.";
  else if (/[<>]/.test(values.name)) errors.name = "The name cannot contain < or >.";
  if (!values.category) errors.category = "Choose a category.";
  if (!values.sector) errors.sector = "Enter the sector or area, for example F-9.";
  else if (!/^[A-Za-z0-9][A-Za-z0-9 .'()/-]{0,39}$/.test(values.sector)) errors.sector = "Use letters, numbers, spaces and - / only.";
  if (values.notes.length > 500) errors.notes = "Keep notes under 500 characters.";
  const lat = Number(values.lat), lng = Number(values.lng);
  if (values.lat === "" || values.lng === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    errors.location = "Pick the location on the map or enter latitude and longitude.";
  } else if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) {
    errors.location = "The location must be inside Islamabad or Rawalpindi.";
  }
  return errors;
}

facilityForm.addEventListener("submit", async event => {
  event.preventDefault();
  clearFieldErrors();
  const values = {};
  for (const name of ["name", "category", "sector", "status", "condition", "entry", "source", "notes", "lat", "lng"]) {
    values[name] = String(facilityForm.elements[name].value ?? "").trim();
  }
  const errors = validateLocally(values);
  if (Object.keys(errors).length) {
    facilityError.textContent = "Please fix the highlighted fields.";
    return showFieldErrors(errors);
  }
  saveButton.disabled = true;
  try {
    const saved = editingId
      ? await api(`/api/facilities/${editingId}`, { method: "PUT", body: values })
      : await api("/api/facilities", { method: "POST", body: values });
    facilityDialog.close();
    toast(editingId ? `Saved changes to ${saved.properties.name}.` : `Added ${saved.properties.name} to the database.`);
    await refreshAll();
    focusFacility(saved.properties.id);
  } catch (error) {
    facilityError.textContent = error.message;
    if (error.fields) showFieldErrors(error.fields);
    if (error.status === 401) {
      facilityDialog.close();
      toast("Your editor session has ended. Please sign in again.", true);
    }
  } finally {
    saveButton.disabled = false;
  }
});

deleteButton.addEventListener("click", async () => {
  const name = facilityForm.name.value || "this facility";
  if (!confirm(`Delete ${name}? This removes the row from the database.`)) return;
  deleteButton.disabled = true;
  try {
    await api(`/api/facilities/${editingId}`, { method: "DELETE" });
    facilityDialog.close();
    toast(`Deleted ${name}.`);
    await refreshAll();
  } catch (error) {
    facilityError.textContent = error.message;
  } finally {
    deleteButton.disabled = false;
  }
});

async function refreshAll() {
  await loadOptions();
  await Promise.all([loadFacilities(), loadOutlines(), loadStats()]);
}

/* ---------- Toast ---------- */

const toastNode = document.querySelector("#toast");
let toastTimer;
function toast(message, isError = false) {
  toastNode.textContent = message;
  toastNode.classList.toggle("is-error", isError);
  toastNode.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.classList.remove("is-shown"), isError ? 6000 : 3500);
}

/* ---------- Theme ---------- */

const root = document.documentElement;
const themeButton = document.querySelector(".theme-toggle");
const currentTheme = () => root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const updateThemeLabel = () => themeButton.setAttribute("aria-label", `Switch to ${currentTheme() === "dark" ? "light" : "dark"} mode`);
themeButton.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  const apply = () => {
    root.dataset.theme = next;
    try { localStorage.setItem("islamabad-parks-theme", next); } catch {}
    updateThemeLabel();
  };
  if (!reduceMotion.matches && document.startViewTransition) document.startViewTransition(apply);
  else apply();
});
updateThemeLabel();

/* ---------- Scroll reveal (decoration only: content is visible before it runs) ---------- */

if ("IntersectionObserver" in window && !reduceMotion.matches) {
  const groups = [".map-heading > *", "#insights .card", ".flow .card", ".endpoint-card", ".data-note"];
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("is-visible");
    observer.unobserve(entry.target);
  }), { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  groups.forEach(selector => document.querySelectorAll(selector).forEach((node, i) => {
    // Only things still below the fold animate, so nothing already on screen flickers.
    if (node.getBoundingClientRect().top < innerHeight) return;
    node.dataset.reveal = "";
    node.style.setProperty("--i", i);
    observer.observe(node);
  }));
}

/* ---------- Start ---------- */

if (phone.matches) document.querySelector(".map-legend").open = false;
setEditor(isEditor());

(async () => {
  try {
    await loadOptions();
  } catch (error) {
    resultCount.textContent = "Could not reach the database.";
    toast(error.message, true);
    return;
  }
  await Promise.all([loadFacilities(), loadOutlines(), loadStats()]);
})();
