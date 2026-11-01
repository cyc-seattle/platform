import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import * as docker from "@pulumi/docker-build";
import * as random from "@pulumi/random";
import { clusterProvider, readPlatformOutputs, type PlatformOutputs } from "../index.ts";

// What every project that runs on the cluster shares (cyc-seattle/isthmia#231).

/** Mailpit and the fakes exist only in dev. */
export const isDev = pulumi.getStack() === "dev";

export interface Cluster {
  /** Plain values, so a hostname under the domain can be a plain string, as `WebService` takes. */
  platform: PlatformOutputs;
  provider: k8s.Provider;
}

let cluster: Promise<Cluster> | undefined;

/** The environment's platform values and cluster provider, read once. */
export function loadCluster(): Promise<Cluster> {
  cluster ??= readPlatformOutputs().then((platform) => ({ platform, provider: clusterProvider(platform) }));
  return cluster;
}

/** A Kubernetes Secret in the environment's namespace. */
export function appSecret(
  { platform, provider }: Cluster,
  name: string,
  stringData: Record<string, pulumi.Input<string>>,
  opts?: pulumi.CustomResourceOptions,
): k8s.core.v1.Secret {
  return new k8s.core.v1.Secret(
    name,
    { metadata: { name, namespace: platform.namespace }, stringData },
    { ...opts, provider },
  );
}

/** An env var read from a key of a Secret. */
export function secretEnv(name: string, secret: k8s.core.v1.Secret, key: string): k8s.types.input.core.v1.EnvVar {
  return { name, valueFrom: { secretKeyRef: { name: secret.metadata.name, key } } };
}

export interface AppDatabase {
  /** The database's name, which is also its user's. */
  name: string;
  /**
   * Holds `host`, `database`, `username`, `password`, and `uri`, a connection URI with the password
   * escaped. `mise run db-shell` reads it.
   */
  secret: k8s.core.v1.Secret;
  host: string;
  /** The secret's `uri`. */
  uri: pulumi.Output<string>;
}

/** The Secret `mise run db-shell <database>` reads. Kubernetes names can't hold `_`. */
export function databaseSecretName(database: string): string {
  return `${database.replace(/_/g, "-")}-db`;
}

/** A Postgres connection URI, with the password escaped. */
export function databaseUri(host: string, name: string, password: string): string {
  return `postgres://${name}:${encodeURIComponent(password)}@${host}:5432/${name}`;
}

/**
 * A database and its user, both `name`, on the environment's Cloud SQL instance. In dev, platform
 * creates them and keeps the password in Secret Manager: Cloud SQL ignores IAM conditions on user
 * and database calls, so deploy-dev can't make them (cyc-seattle/isthmia#231). Elsewhere this project creates them
 * through the Admin API, so no deploy needs a route to the private IP. Users the API creates belong
 * to `cloudsqlsuperuser`, which owns the databases it creates, so the app can create its tables.
 * Both outlive `pulumi destroy`: Directus's license activation is tied to its database (cyc-seattle/isthmia#172). With
 * `existingPassword`, the database and user exist already, and this writes only the Secret.
 */
export function appDatabase(cluster: Cluster, name: string, existingPassword?: pulumi.Output<string>): AppDatabase {
  const { project, sqlConnectionName, sqlHost: host } = cluster.platform;
  let password: pulumi.Output<string>;
  if (existingPassword) {
    // Prod's databases came from the VM, and its project's state already holds them (./cloud.ts).
    password = existingPassword;
  } else if (isDev) {
    password = gcp.secretmanager
      .getSecretVersionAccessOutput({ secret: `dev-db-${name}-password` })
      .apply((version) => version.secretData);
  } else {
    const instance = sqlConnectionName.split(":")[2] ?? sqlConnectionName;
    password = new random.RandomPassword(`${name}-db-password`, { length: 32, special: false }).result;
    const user = new gcp.sql.User(`${name}-db-user`, { project, instance, name, password, deletionPolicy: "ABANDON" });
    new gcp.sql.Database(`${name}-db`, { project, instance, name, deletionPolicy: "ABANDON" }, { dependsOn: user });
  }
  const uri = pulumi.secret(password.apply((value) => databaseUri(host, name, value)));
  const secret = appSecret(cluster, databaseSecretName(name), {
    host,
    database: name,
    username: name,
    password: pulumi.secret(password),
    uri,
  });
  return { name, secret, host, uri };
}

/**
 * A tag for an image built from `inputs`, files and folders relative to `root`. It's a hash of their
 * contents, so a commit that changes none of them reuses the image, and prod sees no change.
 */
export function inputsTag(root: string, inputs: readonly string[]): string {
  const files = inputs
    .flatMap((input) =>
      fs.statSync(path.join(root, input)).isDirectory()
        ? fs
            .readdirSync(path.join(root, input), { recursive: true, encoding: "utf8" })
            .map((file) => path.posix.join(input, file.split(path.sep).join("/")))
        : [input],
    )
    .filter((file) => fs.statSync(path.join(root, file)).isFile())
    .sort();
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash
      .update(file)
      .update("\0")
      .update(fs.readFileSync(path.join(root, file)))
      .update("\0");
  }
  return `in-${hash.digest("hex").slice(0, 20)}`;
}

export interface AppImageArgs {
  /** The build context, relative to the project's directory. */
  context: string;
  /** The Dockerfile, relative to the project's directory. Defaults to the context's `Dockerfile`. */
  dockerfile?: string;
  target?: string;
  /** From `inputsTag`. */
  tag: string;
}

/**
 * An image built and pushed to the environment's registry as `<name>:<tag>`. `ref` pins the digest.
 * The push authenticates with the running credentials' access token.
 */
export function appImage({ platform }: Cluster, name: string, args: AppImageArgs): docker.Image {
  const registry = { address: platform.registry.split("/")[0] ?? platform.registry };
  const cache = `${platform.registry}/${name}:buildcache`;
  return new docker.Image(
    name,
    {
      tags: [`${platform.registry}/${name}:${args.tag}`],
      context: { location: args.context },
      ...(args.dockerfile !== undefined && { dockerfile: { location: args.dockerfile } }),
      ...(args.target !== undefined && { target: args.target }),
      platforms: ["linux/amd64"],
      push: true,
      // Defaults to true: every preview would otherwise build the image (cyc-seattle/isthmia#114).
      buildOnPreview: false,
      cacheFrom: [{ registry: { ref: cache } }],
      cacheTo: [{ registry: { ref: cache, mode: docker.CacheMode.Max, imageManifest: true, ociMediaTypes: true } }],
      registries: [
        {
          ...registry,
          username: "oauth2accesstoken",
          password: gcp.organizations.getClientConfigOutput({}).accessToken,
        },
      ],
    },
    // The provider deletes an image's tags with it. A dev deploy drops the resource once its tag is
    // in the registry, and prod may run that tag (cyc-seattle/platform#72).
    { retainOnDelete: true },
  );
}

/**
 * The image `<name>:<tag>`, as `<registry>/<name>@<digest>`. Each tag is pushed once: if it's in the
 * registry, every environment runs it as it is. Otherwise dev builds it, and prod fails, so prod
 * runs what dev ran (cyc-seattle/isthmia#231).
 */
export async function deployedImage(
  cluster: Cluster,
  name: string,
  args: AppImageArgs,
): Promise<pulumi.Output<string>> {
  const { registry } = cluster.platform;
  const [host = "", project = "", repositoryId = ""] = registry.split("/");
  const byDigest = (image: string) => `${registry}/${name}@${image.slice(image.indexOf("@") + 1)}`;
  let error: unknown;
  const found = await gcp.artifactregistry
    .getDockerImage({
      location: host.replace(/-docker\.pkg\.dev$/, ""),
      project,
      repositoryId,
      imageName: `${name}:${args.tag}`,
    })
    .then(
      (image) => image.selfLink,
      (reason: unknown) => {
        error = reason;
        return undefined;
      },
    );
  if (found !== undefined) {
    return pulumi.output(byDigest(found));
  }
  if (!isDev) {
    throw new Error(
      `Can't find ${registry}/${name}:${args.tag}. Dev builds it: deploy this commit to dev first. (${String(error)})`,
    );
  }
  return appImage(cluster, name, args).ref.apply(byDigest);
}
