import { shardFeature } from "./steps/index.ts";

shardFeature({ index: 3, count: 4 });
await import("./planning.test.ts");
