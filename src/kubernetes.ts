import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { PlatformOutputs } from "./outputs";

export interface ClusterProviderArgs {
  /**
   * Keeps a kubeconfig that is unknown or changes, such as during a cluster update, from replacing
   * the provider and with it every Kubernetes resource it manages.
   */
  clusterIdentifier?: pulumi.Input<string>;
}

/**
 * A Kubernetes provider for the environment's cluster. It authenticates with the caller's own Google
 * access token, so Pulumi needs no gke-gcloud-auth-plugin (cyc-seattle/isthmia#215). The cluster
 * stack itself passes only the endpoint, because it writes the rest.
 */
export function clusterProvider(
  platform: pulumi.Input<{ clusterEndpoint: pulumi.Input<PlatformOutputs["clusterEndpoint"]> }>,
  name = "cluster",
  opts?: pulumi.CustomResourceOptions,
  args: ClusterProviderArgs = {},
): k8s.Provider {
  const token = gcp.organizations.getClientConfigOutput().accessToken;
  // The DNS-based endpoint serves a publicly trusted certificate, so the kubeconfig needs no CA.
  const kubeconfig = pulumi.all([pulumi.output(platform).clusterEndpoint, token]).apply(([endpoint, token]) =>
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [{ name: "cluster", cluster: { server: `https://${endpoint}` } }],
      users: [{ name: "user", user: { token } }],
      contexts: [{ name: "cluster", context: { cluster: "cluster", user: "user" } }],
      "current-context": "cluster",
    }),
  );
  return new k8s.Provider(
    name,
    { kubeconfig: pulumi.secret(kubeconfig), clusterIdentifier: args.clusterIdentifier },
    opts,
  );
}
