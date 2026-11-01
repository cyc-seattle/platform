// Writes src/schema/index.ts, the Directus schema's types, from schemas/*.yaml.
import fs from "node:fs";
import path from "node:path";
import { loadSchemaTypes } from "../src/directus/schema-types.ts";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "src/schema/index.ts");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, await loadSchemaTypes(path.join(root, "schemas")));
console.log(`Wrote ${path.relative(root, out)}`);
