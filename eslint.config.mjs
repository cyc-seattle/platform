import config from "@cyc-seattle/ts-config/eslint";

export default [...config, { rules: { "@typescript-eslint/no-explicit-any": "warn" } }];
