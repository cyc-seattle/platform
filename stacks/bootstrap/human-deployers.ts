import { requireStringList } from "../../src/config";

// IAM members, such as `user:<email>`.
export const humanDeployers = requireStringList("humanDeployers");
