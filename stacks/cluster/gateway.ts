import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import { enableService } from "../../src/services";
import { provider } from "./cluster";
import { httpsListeners } from "./environment";
import { cloudOutput } from "./refs";

const certificateManagerApi = enableService("certificatemanager.googleapis.com");

const internalZoneName = cloudOutput("internalZoneName");

/** Prod's base domain. Its apps are it and its subdomains. */
export const prodDomain = cloudOutput("internalDomain");

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
