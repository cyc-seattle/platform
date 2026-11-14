import { describe, expect, it } from "vitest";
import { allowedUrl, isPublicAddress, parsePreview } from "../stacks/backend/link-preview.cjs";

describe("the link-preview hook", () => {
  it("reaches only public addresses", () => {
    for (const address of ["8.8.8.8", "142.250.69.206", "2607:f8b0:400a:806::200e"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "not an address",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("follows only https addresses on the default port", () => {
    expect(allowedUrl("https://csc-website.web.app/")?.href).toBe("https://csc-website.web.app/");
    expect(allowedUrl("https://example.org:443/a")?.href).toBe("https://example.org/a");
    expect(allowedUrl("/next", "https://example.org/a")?.href).toBe("https://example.org/next");
    for (const url of [
      "http://example.org/",
      "https://example.org:8443/",
      "https://me:pw@example.org/",
      "file:///etc/passwd",
      "nonsense",
    ]) {
      expect(allowedUrl(url), url).toBeUndefined();
    }
  });

  it("reads a page's Open Graph tags", () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="CSC &amp; friends">
      <meta content='Sailing for   everyone.' property='og:description'>
      <meta property="og:image" content="/card.png">
      </head></html>`;
    expect(parsePreview(html, "https://example.org/page")).toEqual({
      preview_title: "CSC & friends",
      preview_description: "Sailing for everyone.",
      preview_image: "https://example.org/card.png",
    });
  });

  it("falls back to the page's title and description", () => {
    const html = `<title>
      Sail Team </title><meta name="description" content="Rosters and plans.">`;
    expect(parsePreview(html, "https://example.org/")).toEqual({
      preview_title: "Sail Team",
      preview_description: "Rosters and plans.",
      preview_image: null,
    });
  });

  it("drops a picture that isn't https, and trims a long title", () => {
    const html = `<meta property="og:image" content="http://example.org/card.png"><meta property="og:title" content="${"a".repeat(300)}">`;
    const preview = parsePreview(html, "https://example.org/");
    expect(preview.preview_image).toBeNull();
    expect(preview.preview_title).toHaveLength(200);
    expect(preview.preview_title!.endsWith("…")).toBe(true);
  });

  it("leaves the fields empty for a page with none of them", () => {
    expect(parsePreview("<p>Hello</p>", "https://example.org/")).toEqual({
      preview_title: null,
      preview_description: null,
      preview_image: null,
    });
  });
});
