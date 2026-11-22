import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import { enableService } from "../../src/services.ts";
import { provider } from "./cluster.ts";
import { httpsListener, httpsListeners } from "./environment.ts";
import { externalDomain, externalZone, internalDomain, internalZone } from "./dns.ts";

const certificateManagerApi = enableService("certificatemanager.googleapis.com");

const internalZoneName = internalZone.name;

/** Prod's base domain. Its apps are it and its subdomains. */
export const prodDomain = internalDomain;

/** Dev's base domain. Its apps are its subdomains. */
export const devDomain = pulumi.interpolate`dev.${prodDomain}`;

// Protected: the DNS records point at it.
export const address = new gcp.compute.GlobalAddress("gateway", { addressType: "EXTERNAL" }, { protect: true });

export const certificateMap = new gcp.certificatemanager.CertificateMap(
  "gateway",
  { description: "Certificates for the shared Gateway" },
  { dependsOn: certificateManagerApi },
);

/**
 * Serves an environment's domain and its subdomains through the Gateway: a DNS-authorized
 * certificate for both, their certificate map entries, and, with `records`, A records pointing at
 * the Gateway.
 */
function serveEnvironment(environment: string, domain: pulumi.Input<string>, records: boolean): void {
  const authorization = new gcp.certificatemanager.DnsAuthorization(
    environment,
    { domain, description: pulumi.interpolate`Authorizes certificates for ${domain}` },
    { dependsOn: certificateManagerApi },
  );
  const challenge = authorization.dnsResourceRecords.apply((records) => records[0]!);
  new gcp.dns.RecordSet(`${environment}-dns-authorization`, {
    managedZone: internalZoneName,
    name: challenge.name,
    type: challenge.type,
    ttl: 300,
    rrdatas: [challenge.data],
  });

  const wildcard = pulumi.interpolate`*.${domain}`;
  const certificate = new gcp.certificatemanager.Certificate(
    environment,
    { scope: "DEFAULT", managed: { domains: [domain, wildcard], dnsAuthorizations: [authorization.id] } },
    { dependsOn: certificateManagerApi },
  );

  for (const [suffix, hostname] of [
    ["", domain],
    ["-wildcard", wildcard],
  ] as const) {
    new gcp.certificatemanager.CertificateMapEntry(`${environment}${suffix}`, {
      map: certificateMap.name,
      hostname,
      certificates: [certificate.id],
    });
    if (records) {
      new gcp.dns.RecordSet(`${environment}${suffix}`, {
        managedZone: internalZoneName,
        name: pulumi.interpolate`${hostname}.`,
        type: "A",
        ttl: 300,
        rrdatas: [address.address],
      });
    }
  }
}

serveEnvironment("dev", devDomain, true);
// Each prod app owns its own record, and moves it from the VM to the Gateway at its cutover (#231).
serveEnvironment("prod", prodDomain, false);

/**
 * A prod app on the public domain, which subscribers see: its own certificate, map entry and A record.
 * Google issues the certificate only once the domain answers from Cloud DNS (#210).
 */
function servePublic(name: string, hostname: pulumi.Input<string>) {
  const authorization = new gcp.certificatemanager.DnsAuthorization(
    name,
    { domain: hostname, description: pulumi.interpolate`Authorizes a certificate for ${hostname}` },
    { dependsOn: certificateManagerApi },
  );
  const challenge = authorization.dnsResourceRecords.apply((records) => records[0]!);
  new gcp.dns.RecordSet(`${name}-dns-authorization`, {
    managedZone: externalZone.name,
    name: challenge.name,
    type: challenge.type,
    ttl: 300,
    rrdatas: [challenge.data],
  });
  const certificate = new gcp.certificatemanager.Certificate(
    name,
    { scope: "DEFAULT", managed: { domains: [hostname], dnsAuthorizations: [authorization.id] } },
    { dependsOn: certificateManagerApi },
  );
  new gcp.certificatemanager.CertificateMapEntry(name, {
    map: certificateMap.name,
    hostname,
    certificates: [certificate.id],
  });
  new gcp.dns.RecordSet(name, {
    managedZone: externalZone.name,
    name: pulumi.interpolate`${hostname}.`,
    type: "A",
    ttl: 300,
    rrdatas: [address.address],
  });
  return hostname;
}

/** Listmonk, the newsletter (cyc-seattle/platform#180), and the website's forms under it. */
export const mailHostname = servePublic("prod-mail", pulumi.interpolate`mail.${externalDomain}`);

export const gatewayNamespace = new k8s.core.v1.Namespace("gateway", { metadata: { name: "gateway" } }, { provider });

export const gateway = new k8s.apiextensions.CustomResource(
  "shared",
  {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "Gateway",
    metadata: {
      name: "shared",
      namespace: gatewayNamespace.metadata.name,
      annotations: { "networking.gke.io/certmap": certificateMap.name },
    },
    spec: {
      gatewayClassName: "gke-l7-global-external-managed",
      addresses: [{ type: "NamedAddress", value: address.name }],
      listeners: [
        // Only the redirect route below, in this namespace, attaches to it.
        { name: "http", protocol: "HTTP", port: 80, allowedRoutes: { namespaces: { from: "Same" } } },
        ...httpsListeners("dev", devDomain),
        ...httpsListeners("prod", prodDomain),
        httpsListener("prod", "https-prod-mail", mailHostname),
      ],
    },
  },
  { provider },
);

new k8s.apiextensions.CustomResource(
  "http-redirect",
  {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: { name: "http-redirect", namespace: gatewayNamespace.metadata.name },
    spec: {
      parentRefs: [{ name: gateway.metadata.name, sectionName: "http" }],
      rules: [{ filters: [{ type: "RequestRedirect", requestRedirect: { scheme: "https", statusCode: 301 } }] }],
    },
  },
  { provider },
);
