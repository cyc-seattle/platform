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
