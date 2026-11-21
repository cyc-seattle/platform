import fs from "node:fs";
import path from "node:path";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";
import starlightLinksValidator from "starlight-links-validator";
import { docsDir, remarkDocs } from "./src/plugins/remark-docs.ts";

const base = "/platform";

const platform = ["architecture", "backend", "access", "syncs", "backups", "website", "newsletter", "manual-setup"];
const dataModel = ["crm-schema", "hr-schema", "planning-schema", "planning-engine"];
// A new page lands here until it's given a section.
const reference = fs
  .readdirSync(docsDir)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .map((name) => path.basename(name, ".md"))
  .filter((slug) => !platform.includes(slug) && !dataModel.includes(slug))
  .sort();

export default defineConfig({
  site: "https://cyc-seattle.github.io",
  base,
  markdown: { remarkPlugins: [[remarkDocs, { base }]] },
  integrations: [
    // Before Starlight, so its code blocks never reach Expressive Code.
    mermaid(),
    starlight({
      title: "CYC platform",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/cyc-seattle/platform" }],
      editLink: { baseUrl: "https://github.com/cyc-seattle/platform/edit/main/docs/" },
      sidebar: [
        { label: "Home", link: "/" },
        { label: "Platform", items: platform },
        { label: "Data model", items: dataModel },
        { label: "Reference", items: reference },
      ],
      plugins: [starlightLinksValidator()],
    }),
  ],
});
