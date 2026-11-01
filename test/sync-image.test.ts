import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inputsTag } from "../src/app/cluster.ts";
import { syncImageInputs } from "../stacks/backend/sync-image.ts";

const root = path.join(import.meta.dirname, "..");

describe("the sync images' inputs", () => {
  it("are the Dockerfile and exactly what .dockerignore lets into the context", () => {
    const allowed = fs
      .readFileSync(path.join(root, ".dockerignore"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("!"))
      .map((line) => line.slice(1).replace(/\/$/, ""));
    expect([...syncImageInputs].sort()).toEqual(["Dockerfile", ...allowed].sort());
  });
});

describe("inputsTag", () => {
  function tree(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inputs-tag-"));
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    }
    return dir;
  }

  const base = { Dockerfile: "FROM node", "src/a.ts": "a", "src/b/c.ts": "c", "docs/x.md": "x" };

  it("is the same for the same inputs, whatever else changes", () => {
    expect(inputsTag(tree(base), ["Dockerfile", "src"])).toBe(
      inputsTag(tree({ ...base, "docs/x.md": "changed" }), ["Dockerfile", "src"]),
    );
  });

  it("changes when an input's content, name, or set of files changes", () => {
    const tag = inputsTag(tree(base), ["Dockerfile", "src"]);
    expect(inputsTag(tree({ ...base, "src/b/c.ts": "changed" }), ["Dockerfile", "src"])).not.toBe(tag);
    expect(inputsTag(tree({ ...base, "src/new.ts": "" }), ["Dockerfile", "src"])).not.toBe(tag);
    const { "src/a.ts": a, ...rest } = base;
    expect(inputsTag(tree({ ...rest, "src/d.ts": a }), ["Dockerfile", "src"])).not.toBe(tag);
  });
});
