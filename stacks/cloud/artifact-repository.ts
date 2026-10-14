import * as gcp from "@pulumi/gcp";
import { location } from "../../src/config";
import { deployRunnerMember } from "./identities";
import { enableService } from "../../src/services";

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
