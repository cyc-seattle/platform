import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import { location } from "../../src/config";
import { enableService } from "../../src/services";
import { cloudOutput, gkeNodes } from "./refs";

const containerApi = enableService("container.googleapis.com");

export const cluster = new gcp.container.Cluster(
  "cyc",
  {
    name: "cyc",
    location,
    enableAutopilot: true,
    releaseChannel: { channel: "REGULAR" },
    network: cloudOutput("networkId"),
    subnetwork: cloudOutput("clusterSubnetId"),
    ipAllocationPolicy: {
      clusterSecondaryRangeName: cloudOutput("clusterPodsRangeName"),
      servicesSecondaryRangeName: cloudOutput("clusterServicesRangeName"),
    },
    privateClusterConfig: { enablePrivateNodes: true },
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

// An access token for whoever runs Pulumi, so it needs no gke-gcloud-auth-plugin. The DNS endpoint
// serves a publicly trusted certificate, so the kubeconfig carries no CA.
const kubeconfig = pulumi
  .all([clusterEndpoint, gcp.organizations.getClientConfigOutput().accessToken])
  .apply(([endpoint, token]) =>
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [{ name: "cyc", cluster: { server: `https://${endpoint}` } }],
      users: [{ name: "pulumi", user: { token } }],
      contexts: [{ name: "cyc", context: { cluster: "cyc", user: "pulumi" } }],
      "current-context": "cyc",
    }),
  );

// clusterIdentifier keeps a pending cluster update, which makes the kubeconfig unknown, from
// replacing the provider and with it every Kubernetes resource.
export const provider = new k8s.Provider("cyc", {
  kubeconfig: pulumi.secret(kubeconfig),
  clusterIdentifier: cluster.id,
});
