# platform

Pulumi stacks for CYC Community Sailing Center's shared Google Cloud platform: the things no single
app owns. The apps that run on it live in their own repos, such as
[isthmia](https://github.com/cyc-seattle/isthmia).

## Stacks

| Stack                           | Holds                                                                                                                                                                                                   | Applied by                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`bootstrap`](stacks/bootstrap) | Service accounts and project IAM, the Pulumi state buckets and KMS keys, and the org's GitHub repos and settings                                                                                        | A human with project Owner and `gh` `admin:org`. Never CI.                                                        |
| [`cloud`](stacks/cloud)         | The VPC, the cluster subnet and its Cloud NAT, the private services peering, the prod and dev Cloud SQL instances, the DNS zones, and Artifact Registry                                                 | `deploy-runner`, from Actions after approval. A deployer, with `mise run deploy`, when breaking glass.            |
| [`cluster`](stacks/cluster)     | The GKE Autopilot cluster, the shared Gateway, its address, certificates, and DNS records, the `dev` namespace with its RBAC, quota, and network policy, and each environment's `platform/outputs.json` | `deploy-runner`, from Actions after approval. A deployer, with `mise run deploy`, when breaking glass.            |
| [`smoke`](stacks/smoke)         | One `WebService` in dev, at `smoke.dev.cycsail.team`, for the integration tests                                                                                                                         | `deploy-dev`, from Actions on every PR. A deployer, with `PULUMI_STACK=dev mise run deploy`, when breaking glass. |

## @cyc-seattle/platform

`src/` is the `@cyc-seattle/platform` package, which the stacks here and the apps' stacks import:

- `getPlatformOutputs()` reads an environment's `platform/outputs.json` from its state bucket. The
  `cluster` stack writes it. Dev stacks can't read prod's backend, so this replaces a
  StackReference for platform values (cyc-seattle/isthmia#215).
- `clusterProvider(platform)` builds a Kubernetes provider for the cluster from the caller's Google
  access token.
- `WebService` runs an HTTP service behind the environment's Gateway, with secure defaults. Its pods
  get no IAM; grant roles to its `member`, a Workload Identity principal.
- `enableService` enables a Google Cloud API.

`mise run build` builds it into `dist/`, which is all it publishes.

## Setup

[mise](https://mise.jdx.dev/) provides the tools.

```sh
mise trust
mise run install
mise run auth-adc
```

`mise run auth-adc` logs Application Default Credentials in as your own account. Pulumi uses them
for GCP and for the state bucket. [docs/manual-setup.md](docs/manual-setup.md) lists the access a
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
`prod` runs `mise run deploy` on the same commit once approved. A PR from a fork gets no OIDC token,
so its `dev` job is skipped.

`PULUMI_STACK` picks what the tasks run (`scripts/each-stack`): `dev` is `smoke`, and `prod` is
`cloud`, then `cluster`. `integration` is dev only.

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

`mise run deploy` applies `cloud`, then `cluster`. Prod stacks read `cloud`'s outputs through a
StackReference. Dev stacks can't read prod state, so `cluster` writes each environment's platform
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
