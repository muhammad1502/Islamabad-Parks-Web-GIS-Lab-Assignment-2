// Creates the table and loads the seed data into the database in DATABASE_URL.
// Used for the hosted database, where psql may not be installed.
import { readFile } from "node:fs/promises";
import { pool } from "../src/db.js";

for (const file of ["db/01_schema.sql", "db/02_seed.sql"]) {
  await pool.query(await readFile(file, "utf8"));
  console.log(`Ran ${file}`);
}
const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM facilities");
console.log(`facilities now has ${rows[0].n} rows`);
await pool.end();
