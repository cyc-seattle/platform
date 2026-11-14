import { shardFeature } from "./steps/index.ts";

shardFeature({ index: 0, count: 4 });
await import("./planning.test.ts");
