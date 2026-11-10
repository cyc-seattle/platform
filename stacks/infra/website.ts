import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config.ts";

// The public website's Firebase Hosting site (#150). The bootstrap stack adds Firebase to the project
// and gives csc-website's workflows this site's ID, so apply it first. Its custom domains go here too,
// beside the zone that holds their records.
export const websiteSite = new gcp.firebase.HostingSite(
  "website",
  { project: projectId, siteId: "csc-website" },
  // Deleting it takes the live site down.
  { protect: true },
);
