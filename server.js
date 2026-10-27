// Local development server: the same API plus the static website from public/,
// sent with the same security headers that vercel.json sets in production.
import express from "express";
import { readFileSync } from "node:fs";
import app from "./src/app.js";

const { headers } = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url)));
const port = Number(process.env.PORT) || 3000;
const site = express();
site.disable("x-powered-by");
site.use((req, res, next) => {
  for (const { key, value } of headers[0].headers) if (key !== "Strict-Transport-Security") res.set(key, value.replace("; upgrade-insecure-requests", ""));
  next();
});
site.use(app);
site.use(express.static("public", { extensions: ["html"] }));
site.listen(port, () => console.log(`Islamabad Parks GIS running at http://localhost:${port}`));
