-- Islamabad Parks and Recreation GIS: database schema
-- Run once in an empty database (pgAdmin Query Tool or psql).
--   CREATE DATABASE islamabad_parks;
--   \c islamabad_parks

CREATE EXTENSION IF NOT EXISTS postgis;

DROP TABLE IF EXISTS facilities;

CREATE TABLE facilities (
  id          serial PRIMARY KEY,
  name        varchar(120) NOT NULL CHECK (char_length(trim(name)) >= 3),
  category    varchar(30)  NOT NULL CHECK (category IN
                ('Park', 'Playground', 'Walking track', 'Sports facility', 'Garden', 'Viewpoint', 'Wildlife park')),
  sector      varchar(40)  NOT NULL,
  entry       varchar(10)  NOT NULL DEFAULT 'Unknown' CHECK (entry IN ('Free', 'Paid', 'Unknown')),
  condition   varchar(15)  NOT NULL DEFAULT 'Not assessed' CHECK (condition IN ('Good', 'Fair', 'Poor', 'Not assessed')),
  status      varchar(20)  NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Under maintenance', 'Closed')),
  notes       varchar(500),
  source      varchar(20)  NOT NULL DEFAULT 'User submitted' CHECK (source IN ('OpenStreetMap', 'Field observation', 'User submitted')),
  osm_id      varchar(20),
  geom        geometry(Point, 4326) NOT NULL,
  boundary    geometry(MultiPolygon, 4326),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Keep points inside a box around Islamabad and Rawalpindi so a typo cannot drop a park in the sea.
  CONSTRAINT facilities_in_study_area CHECK (
    ST_X(geom) BETWEEN 72.70 AND 73.50 AND ST_Y(geom) BETWEEN 33.40 AND 33.90
  )
);

CREATE INDEX facilities_geom_idx ON facilities USING gist (geom);
CREATE INDEX facilities_category_idx ON facilities (category);
CREATE INDEX facilities_sector_idx ON facilities (sector);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER facilities_touch
  BEFORE UPDATE ON facilities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
