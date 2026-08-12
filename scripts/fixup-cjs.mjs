/**
 * The root package.json says `"type": "module"`, which Node applies to every .js file
 * in the tree — including the CommonJS build. Dropping a `{"type":"commonjs"}` marker
 * inside dist/cjs/ scopes that back down for the CJS output only.
 *
 * Without this, `require("rrfparser")` fails with ERR_REQUIRE_ESM even though the files
 * under dist/cjs/ are genuinely CommonJS.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(
  resolve(root, "dist/cjs/package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);
