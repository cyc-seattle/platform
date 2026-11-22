// The CI stack: Directus, its database, Mailpit, and the Clubspot and Workspace fakes in containers on
// the runner, with the same images, env, extensions and migrations as dev, and `backend`'s config
// applied through a local Pulumi backend. The integration tests run against it (docs/testing.md).
//
//   node scripts/ci-stack/index.ts key    prints the cache key: a hash of everything the config comes from
//   node scripts/ci-stack/index.ts up     starts the stack and writes $CI_STACK_DIR/target.json
//   node scripts/ci-stack/index.ts down   stops it
//
// A configured database is cached in $CI_STACK_CACHE, since applying the config takes minutes and
// restoring it seconds. The cache never holds the license: Actions shares main's caches with every PR.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { discoverSchemaFiles } from "../../src/directus/client.ts";
import { extensionDirs, migrationFiles } from "../../stacks/backend/directus-files.ts";
import { backendPolicies } from "../../stacks/backend/extensions.ts";
import { clubspotFakeImage, directusImage, workspaceFakeImage } from "../../stacks/backend/images.ts";
import { directusEnv, mailEnv } from "../../stacks/backend/workloads.ts";

const root = path.resolve(import.meta.dirname, "../..");
const backend = path.join(root, "stacks/backend");
const dir = path.resolve(process.env["CI_STACK_DIR"] ?? path.join(root, ".ci-stack"));
const cache = path.resolve(process.env["CI_STACK_CACHE"] ?? path.join(root, ".ci-stack-cache"));
const compose = ["compose", "-p", "ci-stack", "-f", path.join(import.meta.dirname, "compose.yaml")];

const configFile = path.join(import.meta.dirname, "Pulumi.ci.yaml");
const config = (yaml.load(fs.readFileSync(configFile, "utf8")) as { config: Record<string, unknown> }).config;
const get = <T>(key: string) => config[`backend:${key}`] as T;

/** What the cached database depends on. */
function cacheKey(): string {
  const hash = createHash("sha256").update(directusImage);
  const walk = (entry: string) => {
    const full = path.join(root, entry);
    if (fs.statSync(full).isDirectory()) {
      for (const child of fs.readdirSync(full).sort()) walk(path.join(entry, child));
    } else {
      hash.update(entry).update(fs.readFileSync(full));
    }
  };
  for (const entry of ["schemas", "stacks/backend", "src/directus", "scripts/ci-stack", "pnpm-lock.yaml"]) walk(entry);
  return `ci-stack-${hash.digest("hex").slice(0, 32)}`;
}

const run = (
  cmd: string,
  args: string[],
  options: { env?: Record<string, string>; cwd?: string; input?: Buffer } = {},
) =>
  execFileSync(cmd, args, {
    cwd: options.cwd ?? root,
    stdio: [options.input ? "pipe" : "inherit", "inherit", "inherit"],
    ...(options.input && { input: options.input }),
    env: { ...process.env, ...options.env },
  });
const output = (cmd: string, args: string[], env: Record<string, string> = {}, cwd = root) =>
  execFileSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });

function writeFiles(licenseKey: string): void {
  const schemas = discoverSchemaFiles(path.join(root, "schemas")).map(({ name, path: file }) => ({
    name,
    schema: yaml.load(fs.readFileSync(file, "utf8")),
  }));
  const { extensions } = backendPolicies(schemas, {
    contactTo: get("contactTo"),
    formsOrigins: get("formsOrigins"),
    externalDomain: get("externalDomain"),
    formsPerIp: get("formsPerIp"),
    formsHostname: get("formsHostname"),
    websitePublishAppId: undefined,
    frozenPlansDeletable: get("frozenPlansDeletable"),
  });
  fs.rmSync(dir, { recursive: true, force: true });
  for (const { name, files } of extensionDirs(extensions)) {
    fs.mkdirSync(path.join(dir, "extensions", name), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, "extensions", name, file), content);
    }
  }
  fs.mkdirSync(path.join(dir, "migrations"), { recursive: true });
  for (const [file, content] of Object.entries(migrationFiles())) {
    fs.writeFileSync(path.join(dir, "migrations", file), content);
  }

  const env: Record<string, string> = {};
  for (const { name, value } of [
    ...directusEnv({
      domain: "localhost",
      adminEmail: get("directusAdminEmail"),
      dbHost: "postgres",
      communityRoleId: get("communityRoleId"),
      oidcClientId: "none",
      poolMax: 10,
      filesBucket: "none",
    }),
    ...mailEnv(true),
  ]) {
    env[name as string] = value as string;
  }
  for (const key of Object.keys(env).filter((key) => /^(STORAGE_GCS_|AUTH_AUTHENTIK_)/.test(key))) {
    delete env[key];
  }
  Object.assign(env, {
    PUBLIC_URL: get<string>("localUrl"),
    DB_PASSWORD: "directus",
    KEY: "ci-key",
    SECRET: "ci-secret",
    ADMIN_PASSWORD: get<string>("localAdminPassword"),
    // The first sign-in still gives the Community role: the tests make those users directly.
    AUTH_PROVIDERS: "",
    STORAGE_LOCATIONS: "local",
    STORAGE_LOCAL_ROOT: "/directus/uploads",
    LOG_LEVEL: "warn",
    LICENSE_KEY: licenseKey,
  });
  fs.writeFileSync(
    path.join(dir, "directus.env"),
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    {
      mode: 0o600,
    },
  );
}

const composeEnv = () => ({
  CI_STACK_DIR: dir,
  DIRECTUS_IMAGE: directusImage,
  CLUBSPOT_FAKE_IMAGE: clubspotFakeImage,
  WORKSPACE_FAKE_IMAGE: workspaceFakeImage,
});
const psql = (sql: string) =>
  run(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "directus",
      "-d",
      "directus",
      "-c",
      sql,
    ],
    { env: composeEnv() },
  );

/** Applies `backend`'s config with a stack whose state lives only in this run. Returns the syncs' tokens. */
function applyConfig(): { clubspot: string; gsuite: string } {
  const env = {
    PULUMI_BACKEND_URL: `file://${path.join(dir, "pulumi")}`,
    PULUMI_CONFIG_PASSPHRASE: "ci",
    PULUMI_SKIP_UPDATE_CHECK: "true",
  };
  const stack = ["--stack", "organization/backend/ci"];
  fs.mkdirSync(path.join(dir, "pulumi"), { recursive: true });
  // Pulumi rewrites a stack's config file, so it gets a copy.
  fs.copyFileSync(configFile, path.join(backend, "Pulumi.ci.yaml"));
  try {
    run("pulumi", ["stack", "select", "--create", ...stack, "--secrets-provider", "passphrase"], { env, cwd: backend });
    run("pulumi", ["up", "--yes", "--skip-preview", "--suppress-progress", "--parallel", "32", ...stack], {
      env,
      cwd: backend,
    });
    return JSON.parse(
      output(
        "pulumi",
        ["stack", "output", "syncTokens", "--show-secrets", "--json", ...stack],
        env,
        backend,
      ).toString(),
    );
  } finally {
    fs.rmSync(path.join(backend, "Pulumi.ci.yaml"), { force: true });
  }
}

/**
 * Starts whatever isn't running. Directus exits if the license service refuses its activation, as it does
 * for a moment when several runs activate at once ("Activation in progress"), so it gets a few tries.
 */
function startAll(): void {
  for (let attempt = 1; ; attempt++) {
    try {
      run("docker", [...compose, "up", "-d", "--wait"], { env: composeEnv() });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      console.log(`The stack didn't start (attempt ${attempt}), so it tries again.`);
      execFileSync("sleep", [String(10 * attempt)]);
    }
  }
}

function up(): void {
  // A Directus made from scratch activates the license as pending, which never counts if the instance
  // is gone within 24 hours (docs/backend.md). Unlicensed, Directus's Core tier refuses the schema.
  const licenseKey = process.env["DIRECTUS_LICENSE_KEY"];
  if (!licenseKey) {
    throw new Error("Set DIRECTUS_LICENSE_KEY: unlicensed Directus allows only 25 collections.");
  }
  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
  writeFiles(licenseKey);
  run("docker", [...compose, "up", "-d", "--wait", "postgres"], { env: composeEnv() });

  const key = cacheKey();
  const dump = path.join(cache, `${key}.sql`);
  const tokensFile = path.join(cache, `${key}.json`);
  let tokens: { clubspot: string; gsuite: string };
  if (fs.existsSync(dump) && fs.existsSync(tokensFile)) {
    run(
      "docker",
      [...compose, "exec", "-T", "postgres", "psql", "-q", "-v", "ON_ERROR_STOP=1", "-U", "directus", "-d", "directus"],
      {
        env: composeEnv(),
        input: fs.readFileSync(dump),
      },
    );
    // A project of its own, so each run's activation is its own pending one.
    psql("UPDATE directus_settings SET project_id = gen_random_uuid(), license_key = NULL, license_token = NULL");
    tokens = JSON.parse(fs.readFileSync(tokensFile, "utf8"));
    startAll();
    console.log(`Restored ${key} and started the stack in ${elapsed()}.`);
  } else {
    startAll();
    console.log(`Started the stack in ${elapsed()}. Applying the config, which ${key} hasn't cached.`);
    tokens = applyConfig();
    console.log(`Applied the config in ${elapsed()}.`);
    // Directus stopped, so nothing writes the license back while it's taken out of the dump.
    run("docker", [...compose, "stop", "directus"], { env: composeEnv() });
    psql("UPDATE directus_settings SET license_key = NULL, license_token = NULL");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(
      dump,
      output(
        "docker",
        [...compose, "exec", "-T", "postgres", "pg_dump", "-U", "directus", "-d", "directus", "--no-owner"],
        composeEnv(),
      ),
    );
    fs.writeFileSync(tokensFile, JSON.stringify(tokens));
    startAll();
    console.log(`Cached the configured database and restarted Directus in ${elapsed()}.`);
  }

  // What the tests reach, in place of dev's (test/features/target.ts).
  const target = {
    directus: {
      url: get<string>("localUrl"),
      adminEmail: get<string>("directusAdminEmail"),
      adminPassword: get<string>("localAdminPassword"),
      communityRoleId: get<string>("communityRoleId"),
    },
    formsUrl: get<string>("localUrl"),
    services: {
      "mailpit:8025": "http://localhost:8025",
      "clubspot-fake:1337": "http://localhost:1337",
      "workspace-fake:8080": "http://localhost:8080",
    },
    cronJobs: {
      "clubspot-sync": {
        DIRECTUS_TOKEN: tokens.clubspot,
        CLUBSPOT_SERVER_URL: "http://clubspot-fake:1337/parse",
        CLUBSPOT_CLUB_ID: "seedClub01",
        // The fake's seed (cyc-seattle/clubspot-sdk's README), for tests only.
        CLUBSPOT_EMAIL: "dockmaster@example.test",
        CLUBSPOT_PASSWORD: "fake-password",
      },
      "gsuite-sync": {
        DIRECTUS_TOKEN: tokens.gsuite,
        GSUITE_ROOT_URL: "http://workspace-fake:8080",
        GSUITE_SYNC_GROUP_OWNERS: "owner@example.test",
        GSUITE_SYNC_CUSTOMER: "C00000000",
      },
    },
  };
  fs.writeFileSync(path.join(dir, "target.json"), JSON.stringify(target, null, 2));
  console.log(`The CI stack is ready in ${elapsed()}: ${path.join(dir, "target.json")}`);
}

const command = process.argv[2];
if (command === "key") {
  console.log(cacheKey());
} else if (command === "up") {
  up();
} else if (command === "down") {
  run("docker", [...compose, "down", "-v", "--remove-orphans"], { env: composeEnv() });
} else {
  throw new Error("Usage: node scripts/ci-stack/index.ts key|up|down");
}
