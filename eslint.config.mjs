import config from "@cyc-seattle/ts-config/eslint";

// scripts/gen-sdks writes generated/, and Astro writes docs-site/.astro/.
export default [{ ignores: ["generated/", "docs-site/.astro/"] }, ...config];
