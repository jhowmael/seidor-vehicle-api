CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_plate_check" CHECK ("plate" ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  ADD CONSTRAINT "vehicles_color_check" CHECK (btrim("color") <> ''),
  ADD CONSTRAINT "vehicles_brand_check" CHECK (btrim("brand") <> '');

ALTER TABLE "drivers"
  ADD CONSTRAINT "drivers_name_check" CHECK (btrim("name") <> '');

ALTER TABLE "usages"
  ADD CONSTRAINT "usages_reason_check" CHECK (btrim("reason") <> ''),
  ADD CONSTRAINT "usages_period_check" CHECK ("ended_at" IS NULL OR "ended_at" > "started_at"),
  ADD CONSTRAINT "usages_vehicle_period_excl" EXCLUDE USING gist ("vehicle_id" WITH =, tstzrange("started_at", "ended_at") WITH &&),
  ADD CONSTRAINT "usages_driver_period_excl" EXCLUDE USING gist ("driver_id" WITH =, tstzrange("started_at", "ended_at") WITH &&);
