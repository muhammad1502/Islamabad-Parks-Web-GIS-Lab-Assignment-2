# Islamabad Parks: Lab Assignment 2

A database-driven Web GIS of parks and recreational facilities in Islamabad, built for the Web GIS Application course.

- **Assignment:** Lab Assignment 2: Database-driven Web GIS (Option 4, Parks and Recreational Facilities Management)
- **Student:** Muhammad Abdullah (FA23-BRG-040)
- **Stack:** PostgreSQL 18 + PostGIS 3.6, Node.js + Express 5, Leaflet 1.9.4, hosted on Vercel with a Neon PostgreSQL database

## What it does

- Stores 28 facilities from OpenStreetMap in a PostGIS table (`geometry(Point, 4326)`), with park outlines as `MultiPolygon`
- Express API that returns GeoJSON from parameterised SQL
- Leaflet map with OpenStreetMap and satellite basemaps, a facilities layer and a park outline layer
- Search by name and filter by category, sector and status
- "Search near a point" runs a PostGIS `ST_DWithin` query
- Editors sign in to add, update and delete records; changes are saved in PostgreSQL and survive a page refresh
- Validation in the browser, in the API and as CHECK constraints in the database

## Project layout

```
db/01_schema.sql     table, constraints, indexes, trigger
db/02_seed.sql       28 OpenStreetMap records
db/03_queries.sql    retrieve, filter, count, spatial, update, insert, delete
src/app.js           Express API
src/validate.js      input validation
src/auth.js          editor sign-in (HMAC-signed token)
src/db.js            PostgreSQL connection pool
api/index.js         Vercel serverless entry
server.js            local server (API + website)
public/              Leaflet website
```

## Run locally

1. Create the database in pgAdmin or psql and load the SQL files:

   ```
   CREATE DATABASE islamabad_parks;
   \c islamabad_parks
   \i db/01_schema.sql
   \i db/02_seed.sql
   ```

2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `ADMIN_PASSWORD` and `TOKEN_SECRET`.
3. `npm install`, then `npm run dev` and open http://localhost:3000.

`npm run db:setup` loads the schema and seed data into whatever database `DATABASE_URL` points to (used for the hosted database).

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/facilities?category=&sector=&status=&q=` | Facilities as a GeoJSON FeatureCollection |
| GET | `/api/facilities/:id` | One facility |
| GET | `/api/nearby?lat=&lng=&radius=` | Facilities within a radius, nearest first |
| GET | `/api/boundaries` | Park outlines |
| GET | `/api/stats` | Counts by category and sector |
| GET | `/api/options` | Lists for the drop-downs |
| POST | `/api/login` | Editor sign-in |
| POST | `/api/facilities` | Add (editor) |
| PUT | `/api/facilities/:id` | Update (editor) |
| DELETE | `/api/facilities/:id` | Delete (editor) |

## Data

Facility locations and outlines: © OpenStreetMap contributors, available under the Open Database Licence (ODbL). Extracted with the Overpass API on 27 October 2026. Condition starts as "Not assessed" and entry as "Unknown" unless OpenStreetMap records a fee. Records added on the website are labelled "Field observation" or "User submitted".
