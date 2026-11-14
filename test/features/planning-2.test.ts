import { shardFeature } from "./steps/index.ts";

shardFeature({ index: 1, count: 4 });
await import("./planning.test.ts");
