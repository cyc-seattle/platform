import config from "@cyc-seattle/ts-config/eslint";

// scripts/gen-sdks writes generated/.
export default [{ ignores: ["generated/"] }, ...config];
