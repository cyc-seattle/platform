import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { location, projectId } from "../../src/config.ts";
import { deployRunnerMember, gkeNodesMember } from "./identities.ts";
import { enableService } from "../../src/services.ts";

const artifactRegistryApi = enableService("artifactregistry.googleapis.com");

export const artifactRepository = new gcp.artifactregistry.Repository(
  "artifact-repository",
  {
    location,
    repositoryId: "artifact-docker-repository",
    format: "DOCKER",
    dockerConfig: {
      immutableTags: false,
    },
    // Each deploy pushed every image under a new commit tag, and nothing deleted them (#72). A
    // KEEP outranks a DELETE, so the 10 newest versions of each image stay for a prod rollback (#171).
    cleanupPolicies: [
      { id: "delete-old", action: "DELETE", condition: { tagState: "ANY", olderThan: "7d" } },
      { id: "keep-recent", action: "KEEP", mostRecentVersions: { keepCount: 10 } },
    ],
  },
  { dependsOn: artifactRegistryApi },
);

export const artifactRepositoryUrl = pulumi.interpolate`${location}-docker.pkg.dev/${projectId}/${artifactRepository.repositoryId}`;

// Human deployers get access through project `roles/owner` instead.
new gcp.artifactregistry.RepositoryIamMember("artifact-member-deploy-runner", {
  project: artifactRepository.project,
  location: artifactRepository.location,
  repository: artifactRepository.name,
  role: "roles/artifactregistry.writer",
  member: deployRunnerMember,
});

// The cluster's nodes pull the images (#215). An IAM member is read-modify-write against one shared
// policy, so a default replacement strips it (#153).
new gcp.artifactregistry.RepositoryIamMember(
  "artifact-member-gke-nodes",
  {
    project: artifactRepository.project,
    location: artifactRepository.location,
    repository: artifactRepository.name,
    role: "roles/artifactregistry.reader",
    member: gkeNodesMember,
  },
  { deleteBeforeReplace: true },
);
