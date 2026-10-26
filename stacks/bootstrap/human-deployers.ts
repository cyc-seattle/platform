import { requireStringList } from "../../src/config.ts";

// IAM members, such as `user:<email>`.
export const humanDeployers = requireStringList("humanDeployers");
