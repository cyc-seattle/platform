import { shardFeature } from "./steps/index.ts";

shardFeature({ index: 2, count: 4 });
await import("./planning.test.ts");
