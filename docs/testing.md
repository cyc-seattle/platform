# Integration tests

The Gherkin features in `features/` are the integration tests, with their steps in `test/features/`. They
run in two places:

- **On a throwaway stack in CI**, on every PR and every push to `main` (`.github/workflows/integration-ci.yml`).
  This is where nearly every scenario runs.
- **On dev, after each deploy and each night** (`integration.yml`, `nightly.yml`), only the scenarios that need
  dev or that prove the deploy.

## The CI stack

`scripts/ci-stack` starts, in containers on the runner, what the features need from dev:

- Directus, from the same image, env, extensions and migrations as dev's, with `backend`'s config applied by
  `backend`'s own Pulumi program in its local mode (`backend:local`), so nothing calls Google Cloud or the cluster.
- Its Postgres, which also holds the Clubspot fake's database.
- The Clubspot and Workspace fakes, from the images dev runs (`stacks/backend/images.ts`), and Mailpit.

The syncs run in the test's own process against the fakes, as they mostly do on dev. The contact form posts to
Directus's forms endpoint, and its mail lands in Mailpit.

Applying the config takes about 6 minutes, so the configured database is cached, keyed on a hash of
`schemas/`, `stacks/backend`, `src/directus`, `scripts/ci-stack` and the lockfile. A run that hits the cache
restores it in seconds. The cache never holds the license: Actions shares `main`'s caches with every PR.

The suite is split across 4 jobs, each with its own stack. Each job takes 5 to 8 minutes with a cached stack,
and about 6 more when it applies the config.

### The license

Unlicensed, Directus's Core tier allows only 25 collections and 3 users, so the CI stack needs the license key,
from the repository secret `DIRECTUS_LICENSE_KEY`. Each run's Directus is new, with its own `project_id`, so it
makes its own activation, which stays pending and never counts as long as the instance is gone within 24 hours
([Directus's pending activations](https://directus.com/docs/licensing/overview#pending-activations)). The jobs
time out after 30 minutes. A PR from a fork gets no secrets, so its integration tests don't run.

## What runs on dev

Two tags pick the scenarios dev runs:

- `@dev`: needs what only dev has, such as Authentik, FreeScout, or the cluster itself. It never runs on the CI
  stack. `smoke`, `isolation`, `inbox` and `newsletter` are wholly `@dev`.
- `@smoke`: runs on the CI stack, and also on dev to prove the deploy, such as a sync's scenario that runs its
  CronJob as a Job on dev, and in-process on the CI stack.

`vitest.integration.config.ts` lists the files that hold either tag. Add a file there when you tag one of its
scenarios.

## Running them

On the CI stack, with Docker and the license key in `DIRECTUS_LICENSE_KEY`:

```sh
mise run ci-stack
mise run integration-ci
mise run ci-stack-down
```

`mise run integration-ci -- test/features/planning-1.test.ts` runs one file. Stop the stack when you're done:
a local Directus left running for 24 hours spends an activation.

On dev, as deploy.yml does: `PULUMI_STACK=dev mise run integration`.

## Screenshots and demos

Take screenshots and give demos on a CI stack of your own, filled with sample data, never on prod. With Docker
and the license key in `DIRECTUS_LICENSE_KEY`:

```sh
mise run ci-stack
mise run ci-seed
```

`ci-seed` runs the Givens in `test/seed/sample-data.feature`, the features' own steps, and keeps what they
make: a team of seven sailors and the five children's parents, a family in a program that isn't a team, a sailor
with parents and emergency contacts, a crew member with the catalog, an announcement and a link, and a Financial
Plan. Its rows are named "Sample", such as `Camp Sample`. Run again, it finds its marker and adds nothing. If a
step fails, it deletes what it made, so you can run it again. It prints the logins it made, which all have the
password `sample-password`.

Point the app at Directus on `http://localhost:8055`, in place of dev's. Sign in to the Data Studio there as
`admin@example.com` with `ci-admin-password`, or in the app as one of the sample logins.

Run `mise run ci-stack-down` the same day you start it. Directus's license allows a throwaway instance only if
it's gone within 24 hours ([Never destroy it](backend.md#never-destroy-it)), and the next `ci-stack` starts empty.
