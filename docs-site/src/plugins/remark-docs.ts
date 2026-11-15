import fs from "node:fs";
import path from "node:path";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
export const docsDir = path.join(repoRoot, "docs");
const blobUrl = "https://github.com/cyc-seattle/platform/blob/main";

/** A doc's first heading, as plain text. */
export function titleOf(filePath: string | undefined): string {
  const text = fs.readFileSync(path.resolve(repoRoot, filePath ?? ""), "utf8");
  const heading = /^#{1,6}\s+(.+)$/m.exec(text);
  return heading?.[1]?.replaceAll("`", "").trim() ?? path.basename(filePath ?? "", ".md");
}

/**
 * Fits docs/*.md, written for GitHub, to the site: drops the first heading, which Starlight shows as the
 * title, links a sibling doc to its page, and links any other repo path to GitHub.
 */
export function remarkDocs({ base }: { base: string }) {
  return (tree: Root, file: { path: string; data: { astro?: { frontmatter?: Record<string, unknown> } } }) => {
    const dir = path.dirname(file.path);
    if (path.resolve(dir) !== docsDir) return;

    // starlight-links-validator finds a page's id from its path under src/content/docs, unless it has a slug.
    const id = path.basename(file.path, ".md");
    const frontmatter = ((file.data.astro ??= {}).frontmatter ??= {});
    frontmatter["slug"] = id === "README" ? "" : id;

    const first = tree.children.findIndex((node) => node.type !== "yaml");
    if (tree.children[first]?.type === "heading") tree.children.splice(first, 1);

    visit(tree, "link", (link) => {
      if (/^([a-z]+:|#|\/)/i.test(link.url)) return;
      const [target = "", hash] = link.url.split("#");
      const resolved = path.resolve(dir, target);
      const suffix = hash ? `#${hash}` : "";
      if (path.dirname(resolved) === docsDir && resolved.endsWith(".md")) {
        const slug = path.basename(resolved, ".md");
        link.url = slug === "README" ? `${base}/${suffix}` : `${base}/${slug}/${suffix}`;
      } else {
        link.url = `${blobUrl}/${path.relative(repoRoot, resolved)}${suffix}`;
      }
    });
  };
}
