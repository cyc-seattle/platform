import * as gcp from "@pulumi/gcp";
import { location } from "../../src/config";
import { enableService } from "../../src/services";

const computeApi = enableService("compute.googleapis.com");
const servicenetworkingApi = enableService("servicenetworking.googleapis.com");

// The shared VPC. Its logical names predate this stack (cyc-seattle/isthmia#215).
export const network = new gcp.compute.Network(
  "substrate",
  { autoCreateSubnetworks: false },
  { dependsOn: computeApi },
);

// Private Google access lets the VMs in it reach Google APIs without a public route.
export const subnet = new gcp.compute.Subnetwork("substrate", {
  network: network.id,
  region: location,
  ipCidrRange: "10.0.0.0/24",
  privateIpGoogleAccess: true,
});

// Reserve an internal range and peer it with Google's service networking, so Cloud SQL can be
// assigned a private IP inside the VPC.
const privateRange = new gcp.compute.GlobalAddress("private-services", {
  purpose: "VPC_PEERING",
  addressType: "INTERNAL",
  prefixLength: 16,
  network: network.id,
});

export const privateServicesConnection = new gcp.servicenetworking.Connection(
  "private-services",
  {
    network: network.id,
    service: "servicenetworking.googleapis.com",
    reservedPeeringRanges: [privateRange.name],
  },
  { dependsOn: servicenetworkingApi },
);

export const clusterPodsRange = "pods";
export const clusterServicesRange = "services";

// The GKE cluster's nodes, with secondary ranges for its pods and services (#215). Clear of the VM
// subnet above and the private services range (10.159.0.0/16), and in the same VPC, so pods reach
// Cloud SQL's private IP directly.
export const clusterSubnet = new gcp.compute.Subnetwork("cluster", {
  network: network.id,
  region: location,
  ipCidrRange: "10.1.0.0/24",
  privateIpGoogleAccess: true,
  secondaryIpRanges: [
    { rangeName: clusterPodsRange, ipCidrRange: "10.2.0.0/17" },
    { rangeName: clusterServicesRange, ipCidrRange: "10.3.0.0/20" },
  ],
});

// Egress for the cluster's private nodes. Only the cluster subnet uses it; the VM keeps its own IP.
const clusterRouter = new gcp.compute.Router("cluster", { network: network.id, region: location });

new gcp.compute.RouterNat("cluster", {
  router: clusterRouter.name,
  region: location,
  natIpAllocateOption: "AUTO_ONLY",
  sourceSubnetworkIpRangesToNat: "LIST_OF_SUBNETWORKS",
  subnetworks: [{ name: clusterSubnet.id, sourceIpRangesToNats: ["ALL_IP_RANGES"] }],
  logConfig: { enable: true, filter: "ERRORS_ONLY" },
});
