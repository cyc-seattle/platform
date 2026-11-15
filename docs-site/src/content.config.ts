import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { docsDir, titleOf } from "./plugins/remark-docs.ts";

// docs/*.md stay as GitHub shows them: no title frontmatter, so the title comes from the first heading.
const docsLoader = glob({
  pattern: "*.md",
  base: docsDir,
  // docs/README.md is the index GitHub shows for the folder, and the site's home.
  generateId: ({ entry }) => (entry === "README.md" ? "index" : entry.replace(/\.md$/, "")),
});

export const collections = {
  docs: defineCollection({
    loader: {
      name: "platform-docs",
      load: (context) =>
        docsLoader.load({
          ...context,
          parseData: (props) =>
            context.parseData({ ...props, data: { title: titleOf(props.filePath), ...props.data } }),
        }),
    },
    schema: docsSchema(),
  }),
};
