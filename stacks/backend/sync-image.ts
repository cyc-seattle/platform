import path from "node:path";
import { inputsTag } from "../../src/app/cluster.ts";

/** What the sync images are built from: the Dockerfile, and what `.dockerignore` lets in. */
export const syncImageInputs = [
  "Dockerfile",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "src/model",
  "src/syncs",
];

export const syncImageTag = inputsTag(path.join(import.meta.dirname, "../.."), syncImageInputs);
