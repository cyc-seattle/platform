// The comparison behind `mise run compare-dns`: what two sets of name servers answer, in one form.
import type { CaaRecord, MxRecord, SrvRecord } from "node:dns";
import dns from "node:dns/promises";

export const TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "CAA", "SRV"] as const;
export type RecordType = (typeof TYPES)[number];

// Names a domain commonly has, beyond those the zone declares, so a record Porkbun has and the zone
// lacks shows up as a difference.
export const PROBE_NAMES = [
  "",
  "www",
  "_dmarc",
  "mail",
  "smtp",
  "imap",
  "webmail",
  "autodiscover",
  "autoconfig",
  "_autodiscover._tcp",
  "_amazonses",
  "send",
  "bounce",
  "mail.send",
  "google._domainkey",
  "selector1._domainkey",
  "selector2._domainkey",
  "k1._domainkey",
  "k2._domainkey",
  "k3._domainkey",
  "mte1._domainkey",
  "mte2._domainkey",
  "mandrill._domainkey",
  "default._domainkey",
  "s1._domainkey",
  "s2._domainkey",
  "_domainconnect",
  "calendar",
  "drive",
  "sites",
  "shop",
  "blog",
  "news",
  "donate",
];

/** One answer as a string that doesn't depend on case, trailing dots, or how TXT is split. */
export function normalize(type: RecordType, answer: unknown): string {
  const name = (value: string) => value.toLowerCase().replace(/\.$/, "");
  switch (type) {
    case "A":
    case "AAAA":
      return answer as string;
    case "CNAME":
      return name(answer as string);
    case "MX": {
      const mx = answer as MxRecord;
      return `${mx.priority} ${name(mx.exchange)}`;
    }
    case "TXT":
      return (answer as string[]).join("");
    case "CAA": {
      const { critical, ...rest } = answer as CaaRecord;
      const [tag, value] = Object.entries(rest)[0]!;
      return `${critical} ${tag} "${value}"`;
    }
    case "SRV": {
      const srv = answer as SrvRecord;
      return `${srv.priority} ${srv.weight} ${srv.port} ${name(srv.name)}`;
    }
  }
}

/** The sorted answers, or none for a name or type that doesn't exist. Other failures throw. */
export async function lookup(resolver: dns.Resolver, fqdn: string, type: RecordType): Promise<string[]> {
  try {
    const answers = (await resolver.resolve(fqdn, type)) as unknown[];
    return answers.map((answer) => normalize(type, answer)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENODATA" || (error as NodeJS.ErrnoException).code === "ENOTFOUND") {
      return [];
    }
    throw error;
  }
}

/** A resolver that asks these name servers, by hostname, and nothing else. */
export async function resolverFor(nameServers: string[]): Promise<dns.Resolver> {
  const addresses = await Promise.all(nameServers.map((server) => dns.resolve4(server)));
  const resolver = new dns.Resolver({ timeout: 3000, tries: 3 });
  resolver.setServers(addresses.flat());
  return resolver;
}

export interface Difference {
  name: string;
  type: RecordType;
  zone: string[];
  delegated: string[];
}

/** Each name and type the two resolvers answer differently. */
export async function compare(
  domain: string,
  names: string[],
  zone: dns.Resolver,
  delegated: dns.Resolver,
): Promise<Difference[]> {
  const queries = [...new Set(names)].flatMap((name) => TYPES.map((type) => ({ name, type })));
  const results = await Promise.all(
    queries.map(async ({ name, type }) => {
      const fqdn = name ? `${name}.${domain}` : domain;
      const [z, d] = await Promise.all([lookup(zone, fqdn, type), lookup(delegated, fqdn, type)]);
      return { name, type, zone: z, delegated: d };
    }),
  );
  return results.filter((r) => JSON.stringify(r.zone) !== JSON.stringify(r.delegated));
}
