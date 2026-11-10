// The records the external domain answers with, copied from Porkbun so the zone matches it before
// delegation (#150). `scripts/compare-dns.ts` reads this list too, so it holds no Pulumi values.

export interface DnsRecord {
  /** Relative to the domain; "" is the apex. */
  name: string;
  type: "A" | "CNAME" | "MX" | "TXT";
  ttl: number;
  /** In Cloud DNS's zone-file form: names end in a dot, and TXT strings are quoted. */
  rrdatas: string[];
}

export const externalRecords: DnsRecord[] = [
  // The website, on Wix until the cutover to Firebase Hosting.
  { name: "", type: "A", ttl: 600, rrdatas: ["185.230.63.107"] },
  { name: "www", type: "CNAME", ttl: 600, rrdatas: ["pointing.wixdns.net."] },

  // Google Workspace mail.
  {
    name: "",
    type: "MX",
    ttl: 600,
    rrdatas: [
      "1 aspmx.l.google.com.",
      "5 alt1.aspmx.l.google.com.",
      "5 alt2.aspmx.l.google.com.",
      "10 alt3.aspmx.l.google.com.",
      "10 alt4.aspmx.l.google.com.",
    ],
  },
  {
    name: "",
    type: "TXT",
    ttl: 600,
    rrdatas: [
      '"google-site-verification=ljnCtIm2Fg6jW45IWhaoJa2arfDh9Bw1y5_Kua9I3uM"',
      '"v=spf1 include:_spf.google.com include:amazonses.com ~all"',
    ],
  },
  { name: "_dmarc", type: "TXT", ttl: 300, rrdatas: ['"v=DMARC1; p=none;"'] },

  // Mailchimp's DKIM keys, for the newsletter until Listmonk replaces it (#180).
  { name: "k2._domainkey", type: "CNAME", ttl: 300, rrdatas: ["dkim2.mcsv.net."] },
  { name: "k3._domainkey", type: "CNAME", ttl: 300, rrdatas: ["dkim3.mcsv.net."] },
];
