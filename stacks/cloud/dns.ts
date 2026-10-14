import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { enableService } from "../../src/services";

const config = new pulumi.Config();

//   externalDomain — public-facing website
//   internalDomain — admin, staff, and volunteer portals
//   shortDomain    — link shortener
export const externalDomain = config.require("externalDomain");
export const internalDomain = config.require("internalDomain");
export const shortDomain = config.require("shortDomain");

const dnsApi = enableService("dns.googleapis.com");

/**
 * A public Cloud DNS managed zone for a domain. Creating the zone is **inert**: nothing resolves
 * through it until the domain's registrar delegates to this zone's name servers. The apps add their
 * own records.
 */
export class ManagedZone extends gcp.dns.ManagedZone {
  constructor(name: string, domain: pulumi.Input<string>, opts?: pulumi.CustomResourceOptions) {
    super(
      name,
      {
        // Cloud DNS requires the fully-qualified name with a trailing dot.
        dnsName: pulumi.interpolate`${domain}.`,
        description: pulumi.interpolate`DNS zone for ${domain}`,
        visibility: "public",
      },
      { dependsOn: dnsApi, ...opts },
    );
  }
}

export const externalZone = new ManagedZone("external", externalDomain);
export const internalZone = new ManagedZone("internal", internalDomain);
export const shortZone = new ManagedZone("short", shortDomain);
