import childProcess from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.join(import.meta.dirname, "../scripts/changed-projects");

function changedProjects(...paths: string[]): string {
  return childProcess.execFileSync(script, { input: paths.join("\n"), encoding: "utf8" }).trim();
}

describe("changed-projects", () => {
  it("deploys nothing for docs, agent skills, and CI", () => {
    expect(
      changedProjects(
        "docs/backend.md",
        "README.md",
        ".agents/skills/directus-schema/SKILL.md",
        ".github/workflows/release.yml",
      ),
    ).toBe("");
  });

  it("deploys everything for a change to how the deploy runs", () => {
    expect(changedProjects("docs/backend.md", ".github/workflows/pull-request.yml")).toBe("smoke backend");
  });

  it("deploys everything for anything else", () => {
    expect(changedProjects("docs/backend.md", "test/smoke.test.ts")).toBe("smoke backend");
    expect(changedProjects("schemas/crm.yaml")).toBe("smoke backend");
  });
});
