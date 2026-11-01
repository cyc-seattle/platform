import * as gcp from "@pulumi/gcp";
import { enableService } from "../../src/services.ts";

// Keeps the project's logs inside Cloud Logging's free 50 GiB a month (cyc-seattle/isthmia#264). An
// exclusion applies to the `_Default` sink only, so `_Required`'s audit logs stay.

const loggingApi = enableService("logging.googleapis.com");

const exclusions: Record<string, { description: string; filter: string }> = {
  "node-info": {
    description: "GKE node logs below WARNING: kubelet, container runtime, and image streaming",
    filter: 'resource.type="k8s_node" AND severity<WARNING',
  },
  "kube-system-info": {
    description: "kube-system pod logs below WARNING",
    filter: 'resource.type="k8s_container" AND resource.labels.namespace_name="kube-system" AND severity<WARNING',
  },
  "load-balancer-ok": {
    description: "Load balancer request logs for requests that didn't fail",
    filter: 'resource.type="http_load_balancer" AND httpRequest.status<400',
  },
};

for (const [name, args] of Object.entries(exclusions)) {
  new gcp.logging.ProjectExclusion(name, { name, ...args }, { dependsOn: loggingApi });
}
