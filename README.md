# platform

Pulumi stacks for CYC Community Sailing Center's shared Google Cloud platform: the things no single
app owns. The apps that run on it live in their own repos, such as
[isthmia](https://github.com/cyc-seattle/isthmia).

## Stacks

| Stack                           | Holds                                                                                                            | Applied by                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`bootstrap`](stacks/bootstrap) | Service accounts and project IAM, the Pulumi state buckets and KMS keys, and the org's GitHub repos and settings | A human with project Owner and `gh` `admin:org`. Never CI.                              |
| [`cloud`](stacks/cloud)         | The VPC and the private services peering, the Cloud SQL instance, the DNS zones, and Artifact Registry           | A deployer, with `mise run deploy`. Later `deploy-runner`, from Actions after approval. |

`src/` holds the helpers the stacks share.

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

```sh
mise run preview-bootstrap
mise run deploy-bootstrap
mise run preview
mise run deploy
```

`deploy` applies `cloud`. The apps read `cloud`'s outputs through a StackReference.

`bootstrap`'s GitHub provider uses `gh auth token`, so log `gh` in as a cyc-seattle org owner with
the `admin:org` scope: `gh auth refresh -h github.com -s admin:org`. Deploys refresh first, so they
delete a label added by hand.

## State

Each environment's state lives in its own bucket, `gs://cyc-admin-scripts-pulumi-<stack>`, with its
secrets encrypted by the `state-<stack>` KMS key. `stacks/bootstrap/state.ts` creates both.
`mise.toml` picks the bucket from `PULUMI_STACK`, which defaults to `prod`, so stack names are
`organization/<project>/<stack>`.

`bootstrap`'s own state lives in the bucket it creates. Both the bucket and the key are protected.

## Development

```sh
mise run ci
```

Runs the type check, Prettier, ESLint, and the unit tests. Tests mock Pulumi with
`pulumi.runtime.setMocks` and never call a live API.
