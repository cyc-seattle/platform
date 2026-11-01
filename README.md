# platform

Pulumi stacks for CYC Community Sailing Center's shared Google Cloud platform: the things no single
app owns. The apps that run on it live in their own repos, such as
[isthmia](https://github.com/cyc-seattle/isthmia).

## Stacks

| Stack                           | Holds                                                                                                                                                                                                                                                                                                                                                                                                                             | Applied by                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`bootstrap`](stacks/bootstrap) | Service accounts and project IAM, the Pulumi state buckets and KMS keys, and the org's GitHub repos and settings                                                                                                                                                                                                                                                                                                                  | A human with project Owner and `gh` `admin:org`. Never CI.                                                        |
| [`infra`](stacks/infra)         | The VPC, the cluster subnet and its Cloud NAT on a static address, the private services peering, the prod and dev Cloud SQL instances, the DNS zones, Artifact Registry, the GKE Autopilot cluster, the shared Gateway, its address, certificates, and dev's DNS records, the `dev` and `prod` namespaces with their quotas and network policies, dev's RBAC, the prod Job alerts, and each environment's `platform/outputs.json` | `deploy-runner`, from Actions after approval. A deployer, with `mise run deploy`, when breaking glass.            |
| [`smoke`](stacks/smoke)         | One `WebService` in dev, at `smoke.dev.cycsail.team`, for the integration tests                                                                                                                                                                                                                                                                                                                                                   | `deploy-dev`, from Actions on every PR. A deployer, with `PULUMI_STACK=dev mise run deploy`, when breaking glass. |
| [`backend`](stacks/backend)     | Directus, with the schema apply from `schemas/`, its roles, policies, and permission rules, the sync machine users, its OIDC client, and MCP, and the clubspot-sync and gsuite-sync CronJobs, with dev's Clubspot and Workspace fakes                                                                                                                                                                                             | `deploy-dev`, from Actions on every PR, and `deploy-runner` on a push to `main`, after `infra`.                   |

## @cyc-seattle/platform

`src/` is the `@cyc-seattle/platform` package, which the stacks here and the apps' stacks import:

- `getPlatformOutputs()` reads an environment's `platform/outputs.json` from its state bucket. The
  `infra` stack writes it. It holds the environment's namespace and domain, the Gateway and its
  address (`gatewayAddress`, for an app's own DNS records), and the Cloud SQL instance's connection
  name and private IP (`sqlHost`). Dev stacks can't read prod's backend, so this replaces a
  StackReference for platform values (cyc-seattle/isthmia#215).
- `clusterProvider(platform)` builds a Kubernetes provider for the cluster. Its kubeconfig runs
  `gke-gcloud-auth-plugin` with Application Default Credentials, so Pulumi must run under mise,
  where `mise run install` puts the plugin on `PATH`.
- `Workload` runs a long-lived process with no route: a Deployment, a ServiceAccount, and, when it
  has `ports`, a ClusterIP Service that other pods in the namespace reach at `host`. With more than
  one replica, `spreadAcrossZones` spreads them, and `minAvailable` adds a PodDisruptionBudget.
  `podAnnotations` sets annotations such as `cluster-autoscaler.kubernetes.io/safe-to-evict`.
- `WebService` is a `Workload` behind the environment's Gateway at `hostname`. Its Service exposes
  `port` as port 80, and its readiness probe must be an HTTP GET, which the load balancer's health
  check reuses.
- `ScheduledJob` runs a CronJob on `schedule`, in `America/Los_Angeles` unless `timeZone` says
  otherwise. A run never overlaps the one before it, gets an hour, and doesn't retry, by default.
- All three run non-root with a read-only root filesystem, no capabilities, and no service account
  token, on Spot pods in dev only. Their limits equal their requests. Their pods get no IAM; grant
  roles to `member`, a Workload Identity principal, or set `serviceAccountAnnotations` to run as a
  Google service account.
- `enableService` enables a Google Cloud API.

`mise run build` builds it into `dist/`, which is all it publishes. `.github/workflows/release.yml`
releases each merge to `main` with semantic-release, versioned by the conventional commits.

## Environments

Every app runs on the one GKE Autopilot cluster, in its environment's namespace. Prod runs on
regular capacity, and dev on Spot pods. isthmia's apps (Authentik, Directus, the portal, and the
two syncs as CronJobs) run in both, and dev adds Mailpit and the Clubspot and Workspace fakes. In dev,
platform's `backend` deploys Directus, the syncs, and the fakes, and dev's sync CronJobs are
suspended: the integration features and `mise run reset` run them as Jobs (cyc-seattle/isthmia#271).

| Stack  | Namespace | Domain             | Deploy identity |
| ------ | --------- | ------------------ | --------------- |
| `dev`  | `dev`     | `dev.cycsail.team` | `deploy-dev`    |
| `prod` | `prod`    | `cycsail.team`     | `deploy-runner` |

Each namespace denies ingress from other namespaces except the load balancer's. Dev also admits the
Kubernetes API's service proxy, which the integration tests use, and denies egress to the mail ports
(25, 465, 587) outside the cluster. `infra` writes dev's A records; each prod app writes its own,
pointing at `gatewayAddress`.

`deploy-dev` reads Secret Manager secrets whose IDs start with `dev-`. Read them with
`gcp.secretmanager.getSecretVersionAccess`, which needs only the accessor role.

`infra` creates each app's dev database, user, and password secret (`dev-db-<name>-password`) on
`cyc-dev`, for each name in `infra:devDatabases`. To add an app's dev database, add its name there in a
platform PR: Cloud SQL ignores IAM conditions on its user and database calls, so `deploy-dev` can't
hold a role scoped to `cyc-dev`.

A Job that fails in `prod`, or a CronJob there with no successful Job in 3 hours, raises an alert.
It emails each address in `infra:alertEmails`, a secret in the stack's config, which holds the
maintainer's address (#20).

## Setup

[mise](https://mise.jdx.dev/) provides the tools.

```sh
mise trust
mise run install
```

Pulumi uses Application Default Credentials for GCP and for the state bucket. Log them in as your own
account with `mise run auth-adc` in the [workplace](https://github.com/cyc-seattle/workplace), which
links this checkout's `.gcloud/` to its one login. [docs/manual-setup.md](docs/manual-setup.md) lists the access a
deployer needs first.

## Deploy

### From Actions

`.github/workflows/pull-request.yml` deploys through the org's reusable `deploy.yml`, which
authenticates with Workload Identity Federation and stores no credentials. Each job runs in a
GitHub environment that holds its identity and state bucket:

| Event          | Jobs, in order                                                                            |
| -------------- | ----------------------------------------------------------------------------------------- |
| Pull request   | `ci`, then `dev`: `mise run deploy` as `deploy-dev`, then `mise run integration`          |
| Push to `main` | `ci`, `dev`, then `prod-preview`, then `prod`, which waits for the `maintainers` approval |

`prod-preview` runs `mise run preview` as `deploy-runner` and writes the diff to the job summary.
`prod` runs `mise run deploy` on the same commit once approved. It runs only when the preview shows
changes, so a merge that changes nothing in prod asks for no approval. Dev builds the sync images
for every commit, and prod's CronJobs run the one built for theirs, so until cyc-seattle/isthmia#258
every merge previews `backend`'s CronJobs as changed. A PR from a fork gets no OIDC token, so its
`dev` job is skipped.

`PULUMI_STACK` picks what the tasks run (`scripts/each-stack`): `dev` is `smoke`, then `backend`, and
`prod` is `infra`, then `backend`. `integration` is dev only.

`bootstrap` is never deployed from Actions (cyc-seattle/isthmia#118). It holds the identities that
CI assumes, and a human with project Owner and `gh` `admin:org` applies it with the tasks below.

### From a laptop

Local deploys stay as the break-glass path. A deployer applies with the same tasks:

```sh
mise run preview-bootstrap
mise run deploy-bootstrap
mise run preview
mise run deploy
PULUMI_STACK=dev mise run deploy
```

`mise run deploy` applies `infra`, then `backend`. isthmia's prod stacks read its outputs through a StackReference.
Dev stacks can't read prod state, so `infra` writes each environment's platform
values to `platform/outputs.json` in that environment's state bucket.

`bootstrap`'s GitHub provider uses `gh auth token`, so log `gh` in as a cyc-seattle org owner with
the `admin:org` scope: `gh auth refresh -h github.com -s admin:org`. Deploys refresh first, so they
delete a label added by hand.

## State

Each environment's state lives in its own bucket, `gs://cyc-admin-scripts-pulumi-<stack>`, with its
secrets encrypted by the `state-<stack>` KMS key. `stacks/bootstrap/state.ts` creates both.
`mise.toml` picks the bucket from `PULUMI_STACK`, which defaults to `prod`, so stack names are
`organization/<project>/<stack>`. It sets `GOOGLE_APPLICATION_CREDENTIALS` to the shared `.gcloud/`
login only when it isn't already set, so Actions' credentials win.

`bootstrap`'s own state lives in the bucket it creates. Both the bucket and the key are protected.

## Development

```sh
mise run ci
```

Runs the type check, Prettier, ESLint, and the unit tests. Tests mock Pulumi with
`pulumi.runtime.setMocks` and never call a live API.

```sh
mise run integration
```

Runs the Gherkin scenarios in `features/` against dev, after `PULUMI_STACK=dev mise run deploy`. They run as
whatever identity Application Default Credentials hold. The isolation scenarios expect `deploy-dev`,
so as a human, log Application Default Credentials in with `--impersonate-service-account` first.
