# Integration tests

The Gherkin features in `features/` are the integration tests, with their steps in `test/features/`. They
run in two places:

- **On a throwaway stack in CI**, on every PR and every push to `main` (`.github/workflows/integration-ci.yml`).
  Every scenario runs here.
- **On dev, after each deploy and each night** (`integration.yml`, `nightly.yml`), only the scenarios tagged
  `@smoke`, which prove the deploy.

## The CI stack

`scripts/ci-stack` starts, in containers on the runner, what the features need from dev:

- Directus, from the same image, env, extensions and migrations as dev's, with `backend`'s config applied by
  `backend`'s own Pulumi program in its local mode (`backend:local`), so nothing calls Google Cloud or the cluster.
- Its Postgres, which also holds the Clubspot fake's, Authentik's and Listmonk's databases.
- The Clubspot and Workspace fakes, from the images dev runs (`stacks/backend/images.ts`), and Mailpit.
- Authentik, from the image and env dev runs, with `authentik`'s config applied by its own Pulumi program in
  its local mode (`authentik:local`). Its mail, such as a sign-in link, lands in Mailpit. Directus's
  group-policies hook fills its sign-in groups, as on dev.
- Listmonk, installed and configured with the `listmonk` stack's own settings (`stacks/listmonk/settings.ts`),
  sending to Mailpit, with the read-only API login the tests check the list with.

It doesn't run FreeScout: only the shared inbox's `@api` scenarios would reach it, and they need FreeScout's
API module, which is bought and installed by hand (`docs/inbox.md`). They wait for it, on dev and here alike.
Nothing checks the cluster itself here: `test/cluster.test.ts` checks the namespaces' network policies, the
Gateway's listeners, and what each deploy identity may do.

The syncs run in the test's own process against the fakes, here and on dev. The contact form posts to
Directus's forms endpoint, and its mail lands in Mailpit.

Each checkout's stack has its own Docker Compose project and host ports, both from a hash of its path, so
two checkouts on one machine can each run one. `CI_STACK_PORT` picks the first port instead. The ports
are in `.ci-stack/target.json`.

Applying the config takes about 6 minutes, so the configured databases, Directus's and Authentik's, are
cached, keyed on a hash of `schemas/`, `stacks/backend`, `stacks/authentik`, `src/directus`, `src/app`,
`scripts/ci-stack` and the lockfile. A run that hits the cache
restores it in seconds. The cache never holds the license: Actions shares `main`'s caches with every PR.

The suite is split across 4 jobs, each with its own stack. Each job takes about 3 minutes with a cached stack,
and 10 to 15 when it applies the config.

### The license

Unlicensed, Directus's Core tier allows only 25 collections and 3 users, so the CI stack needs the license key,
from the repository secret `DIRECTUS_LICENSE_KEY`, which the bootstrap stack copies from Secret Manager's
`directus-license-key`. Each run's Directus is new, with its own `project_id`, so it
makes its own activation, which stays pending and never counts as long as the instance is gone within 24 hours
([Directus's pending activations](https://directus.com/docs/licensing/overview#pending-activations)). The jobs
time out after 30 minutes. A PR from a fork gets no secrets, so its integration tests don't run.

## From another repo

Another repo, such as sail-team, runs its own tests against the same stack: platform at the release its
`@cyc-seattle/platform` dependency names, checked out beside its own code. Its Directus has the schema,
roles and policies that release deploys. In a workflow:

```yaml
- uses: actions/checkout@<sha> # the repo's own code
- id: platform
  run: echo "version=$(node -p 'require("@cyc-seattle/platform/package.json").version')" >> "$GITHUB_OUTPUT"
- uses: actions/checkout@<sha>
  with:
    repository: cyc-seattle/platform
    ref: v${{ steps.platform.outputs.version }}
    path: .platform
    # The planning engine is stamped with the latest release tag (stacks/backend/engine-files.ts).
    fetch-depth: 0
- uses: jdx/mise-action@<sha>
  with:
    working_directory: .platform
- run: mise run install
  working-directory: .platform
- id: key
  run: echo "key=$(mise exec -- node scripts/ci-stack/index.ts key)" >> "$GITHUB_OUTPUT"
  working-directory: .platform
- uses: actions/cache@<sha>
  with:
    path: .platform/.ci-stack-cache
    key: ${{ steps.key.outputs.key }}
- run: mise run ci-stack
  working-directory: .platform
  env:
    DIRECTUS_LICENSE_KEY: ${{ secrets.DIRECTUS_LICENSE_KEY }}
```

The `node -p` step runs after the repo's own install, which puts the package in `node_modules`. The repo needs
the `DIRECTUS_LICENSE_KEY` secret, from `stacks/bootstrap/directus-license.ts`, and a job timeout under 24 hours, as here.

The stack describes itself in `.platform/.ci-stack/target.json`, which `CiStackTarget` from
`@cyc-seattle/platform` types: Directus's address with its admin's email, password and static token,
Authentik's address and bootstrap token, Listmonk's, Mailpit's and the fakes' addresses, and the syncs' tokens.
Its ports differ from one checkout to another, so read them there. `mise run ci-stack-down`, in `.platform`,
stops it.

## What runs on dev

Only the scenarios tagged `@smoke` run on dev, with the syncs in the test's own process, reaching dev's fakes
through the cluster's API. `vitest.integration.config.ts` lists the files that hold one. Add a file there when
you tag one of its scenarios.

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
