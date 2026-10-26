import * as gcp from "@pulumi/gcp";
import { location } from "../../src/config.ts";
import { clusterProvider } from "../../src/kubernetes.ts";
import { enableService } from "../../src/services.ts";
import { gkeNodes } from "./identities.ts";
import { clusterPodsRange, clusterServicesRange, clusterSubnet, network } from "./network.ts";

const containerApi = enableService("container.googleapis.com");

export const cluster = new gcp.container.Cluster(
  "cyc",
  {
    name: "cyc",
    location,
    enableAutopilot: true,
    releaseChannel: { channel: "REGULAR" },
    network: network.id,
    subnetwork: clusterSubnet.id,
    ipAllocationPolicy: {
      clusterSecondaryRangeName: clusterPodsRange,
      servicesSecondaryRangeName: clusterServicesRange,
    },
    // GKE sets this on a cluster with no IP endpoint; declaring it keeps the preview clean.
    privateClusterConfig: { enablePrivateNodes: true, enablePrivateEndpoint: true },
    // Only the DNS-based endpoint, which IAM gates, so Actions runners need no IP allowlist (#215).
    controlPlaneEndpointsConfig: {
      dnsEndpointConfig: { allowExternalTraffic: true },
      ipEndpointsConfig: { enabled: false },
    },
    gatewayApiConfig: { channel: "CHANNEL_STANDARD" },
    // Autopilot takes the node service account here; the default Compute Engine one holds Editor.
    clusterAutoscaling: {
      autoProvisioningDefaults: {
        serviceAccount: gkeNodes.email,
        oauthScopes: ["https://www.googleapis.com/auth/cloud-platform"],
      },
    },
    // 01:00-07:00 PST, 02:00-08:00 PDT.
    maintenancePolicy: {
      recurringWindow: {
        startTime: "2026-01-01T09:00:00Z",
        endTime: "2026-01-01T15:00:00Z",
        recurrence: "FREQ=DAILY",
      },
    },
    deletionProtection: true,
  },
  { protect: true, dependsOn: containerApi },
);

/** The DNS-based control-plane endpoint's hostname. */
export const clusterEndpoint = cluster.controlPlaneEndpointsConfig.apply((config) => {
  const endpoint = config?.dnsEndpointConfig?.endpoint;
  if (!endpoint) {
    throw new Error("The cluster has no DNS-based endpoint.");
  }
  return endpoint;
});

export const provider = clusterProvider({ clusterEndpoint }, "cyc", undefined, { clusterIdentifier: cluster.id });
