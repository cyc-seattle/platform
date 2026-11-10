import type dns from "node:dns/promises";
import { describe, expect, it } from "vitest";
import { compare, lookup, normalize } from "../scripts/dns-diff.ts";

/** A resolver that answers from a table keyed by "fqdn TYPE", and fails like Node's otherwise. */
function fakeResolver(answers: Record<string, unknown[] | string>): dns.Resolver {
  return {
    resolve: async (fqdn: string, type: string) => {
      const answer = answers[`${fqdn} ${type}`];
      if (typeof answer === "string") throw Object.assign(new Error(answer), { code: answer });
      if (!answer) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return answer;
    },
  } as unknown as dns.Resolver;
}

describe("normalize", () => {
  it("ignores case and trailing dots in names", () => {
    expect(normalize("CNAME", "Pointing.WixDNS.net.")).toBe("pointing.wixdns.net");
    expect(normalize("MX", { priority: 5, exchange: "ALT1.aspmx.l.google.com." })).toBe("5 alt1.aspmx.l.google.com");
  });

  it("joins a TXT record's strings, which servers may split differently", () => {
    expect(normalize("TXT", ["v=spf1 include:", "_spf.google.com ~all"])).toBe("v=spf1 include:_spf.google.com ~all");
  });

  it("writes CAA and SRV in zone-file order", () => {
    expect(normalize("CAA", { critical: 0, issue: "letsencrypt.org" })).toBe('0 issue "letsencrypt.org"');
    expect(normalize("SRV", { priority: 0, weight: 5, port: 443, name: "autodiscover.example.org." })).toBe(
      "0 5 443 autodiscover.example.org",
    );
  });
});

describe("lookup", () => {
  it("treats a missing name or type as no answers", async () => {
    const resolver = fakeResolver({ "example.org A": "ENODATA" });
    expect(await lookup(resolver, "example.org", "A")).toEqual([]);
    expect(await lookup(resolver, "nothing.example.org", "A")).toEqual([]);
  });

  it("fails on a server error, so an outage can't pass as a match", async () => {
    await expect(lookup(fakeResolver({ "example.org A": "ESERVFAIL" }), "example.org", "A")).rejects.toThrow(
      "ESERVFAIL",
    );
  });
});

describe("compare", () => {
  it("reports only the names and types the two answer differently, in any order", async () => {
    const zone = fakeResolver({
      "example.org A": ["192.0.2.1"],
      "example.org MX": [
        { priority: 5, exchange: "b.example.net." },
        { priority: 1, exchange: "a.example.net." },
      ],
    });
    const delegated = fakeResolver({
      "example.org A": ["192.0.2.1"],
      "example.org MX": [
        { priority: 1, exchange: "a.example.net" },
        { priority: 5, exchange: "b.example.net" },
      ],
      "www.example.org CNAME": ["site.example.net"],
    });
    expect(await compare("example.org", ["", "www", ""], zone, delegated)).toEqual([
      { name: "www", type: "CNAME", zone: [], delegated: ["site.example.net"] },
    ]);
  });
});
