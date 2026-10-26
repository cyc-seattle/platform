import { humanDeployers } from "./human-deployers.ts";
import { ServiceAccount } from "../../src/service-account.ts";

// Identity the clubspot-sync Cloud Run job acts as.
export const clubspotSyncRunner = new ServiceAccount(
  "clubspot-sync",
  "Service account that runs the clubspot-sync job.",
);

clubspotSyncRunner.allowImpersonation(humanDeployers);
