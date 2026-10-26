import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFeatureFromText } from "@amiceli/vitest-cucumber";
import { GoogleAuth } from "google-auth-library";
import { outputsObject, parsePlatformOutputs, stateBucket, type PlatformOutputs } from "../../src/outputs.ts";

export function feature(name: string): ReturnType<typeof loadFeatureFromText> {
  return loadFeatureFromText(readFileSync(join(import.meta.dirname, "../../features", name), "utf8"));
}

// Whatever identity runs the tests: deploy-dev in CI.
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function accessToken(): Promise<string> {
  const token = await auth.getAccessToken();
  if (!token) {
    throw new Error("Application Default Credentials gave no access token.");
  }
  return token;
}

/** Reads dev's outputs file the way a Pulumi program does, but through the JSON API. */
export async function devPlatform(): Promise<PlatformOutputs> {
  const project = process.env["GCP_PROJECT"];
  if (!project) {
    throw new Error("GCP_PROJECT isn't set. Run the tests under mise.");
  }
  const bucket = stateBucket(project, "dev");
  const source = `gs://${bucket}/${outputsObject}`;
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(outputsObject)}?alt=media`,
    { headers: { authorization: `Bearer ${await accessToken()}` } },
  );
  if (!response.ok) {
    throw new Error(`Can't read ${source}: ${response.status} ${await response.text()}`);
  }
  return parsePlatformOutputs(await response.text(), source);
}

export interface KubeResponse {
  status: number;
  body: any;
}

/** Calls the cluster's API through its DNS-based endpoint, with the caller's Google token. */
export async function kube(
  platform: PlatformOutputs,
  method: string,
  path: string,
  body?: unknown,
): Promise<KubeResponse> {
  const response = await fetch(`https://${platform.clusterEndpoint}${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  // A proxied service may answer with anything.
  const json = response.headers.get("content-type")?.startsWith("application/json");
  return { status: response.status, body: json && text ? JSON.parse(text) : text || undefined };
}

/** Whether the caller may create `resource` (`name.group`, as kubectl writes it) in `namespace`. */
export async function canCreate(platform: PlatformOutputs, resource: string, namespace?: string): Promise<boolean> {
  const [name, ...group] = resource.split(".");
  const review = await kube(platform, "POST", "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews", {
    apiVersion: "authorization.k8s.io/v1",
    kind: "SelfSubjectAccessReview",
    spec: { resourceAttributes: { verb: "create", resource: name, group: group.join("."), namespace } },
  });
  if (review.status !== 201) {
    throw new Error(`The access review failed: ${review.status} ${JSON.stringify(review.body)}`);
  }
  return review.body.status.allowed === true;
}

/** The caller's Kubernetes username, for failure messages. */
export async function whoami(platform: PlatformOutputs): Promise<string> {
  const review = await kube(platform, "POST", "/apis/authentication.k8s.io/v1/selfsubjectreviews", {
    apiVersion: "authentication.k8s.io/v1",
    kind: "SelfSubjectReview",
  });
  return review.body?.status?.userInfo?.username ?? "an unknown user";
}
