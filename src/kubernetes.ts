import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { PlatformOutputs } from "./outputs.ts";

export interface ClusterProviderArgs {
  /**
   * Keeps a kubeconfig that is unknown or changes, such as during a cluster update, from replacing
   * the provider and with it every Kubernetes resource it manages.
   */
  clusterIdentifier?: pulumi.Input<string>;
}

/**
 * A Kubernetes provider for the environment's cluster. Its kubeconfig runs gke-gcloud-auth-plugin
 * with Application Default Credentials, so it is the same on every run, unlike one that embeds an
 * access token. The plugin must be on PATH: `mise run install` adds it. The cluster stack passes
 * only the endpoint, because it writes the rest.
 */
export function clusterProvider(
  platform: pulumi.Input<{ clusterEndpoint: pulumi.Input<PlatformOutputs["clusterEndpoint"]> }>,
  name = "cluster",
  opts?: pulumi.CustomResourceOptions,
  args: ClusterProviderArgs = {},
): k8s.Provider {
  // The DNS-based endpoint serves a publicly trusted certificate, so the kubeconfig needs no CA.
  const kubeconfig = pulumi.output(platform).clusterEndpoint.apply((endpoint) =>
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [{ name: "cluster", cluster: { server: `https://${endpoint}` } }],
      users: [
        {
          name: "user",
          user: {
            exec: {
              apiVersion: "client.authentication.k8s.io/v1beta1",
              command: "gke-gcloud-auth-plugin",
              args: ["--use_application_default_credentials"],
              installHint: "Run `mise run install`, and run Pulumi under mise.",
              provideClusterInfo: true,
            },
          },
        },
      ],
      contexts: [{ name: "cluster", context: { cluster: "cluster", user: "user" } }],
      "current-context": "cluster",
    }),
  );
  return new k8s.Provider(name, { kubeconfig, clusterIdentifier: args.clusterIdentifier }, opts);
}
