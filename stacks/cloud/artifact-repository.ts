import * as gcp from "@pulumi/gcp";
import { location } from "../../src/config.ts";
import { deployDevMember, deployRunnerMember, gkeNodesMember } from "./identities.ts";
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
  },
  { dependsOn: artifactRegistryApi },
);

// Human deployers get access through project `roles/owner` instead.
new gcp.artifactregistry.RepositoryIamMember("artifact-member-deploy-runner", {
  project: artifactRepository.project,
  location: artifactRepository.location,
  repository: artifactRepository.name,
  role: "roles/artifactregistry.writer",
  member: deployRunnerMember,
});

// Dev deploys push their images; the cluster's nodes pull them (#215). An IAM member is
// read-modify-write against one shared policy, so a default replacement strips it (#153).
new gcp.artifactregistry.RepositoryIamMember(
  "artifact-member-deploy-dev",
  {
    project: artifactRepository.project,
    location: artifactRepository.location,
    repository: artifactRepository.name,
    role: "roles/artifactregistry.writer",
    member: deployDevMember,
  },
  { deleteBeforeReplace: true },
);

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
