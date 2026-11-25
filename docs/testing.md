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

The suite is split across 4 jobs, each with its own stack. Each job takes 5 to 8 minutes with a cached stack,
and about 6 more when it applies the config.

### The license

Unlicensed, Directus's Core tier allows only 25 collections and 3 users, so the CI stack needs the license key,
from the repository secret `DIRECTUS_LICENSE_KEY`. Each run's Directus is new, with its own `project_id`, so it
makes its own activation, which stays pending and never counts as long as the instance is gone within 24 hours
([Directus's pending activations](https://directus.com/docs/licensing/overview#pending-activations)). The jobs
time out after 30 minutes. A PR from a fork gets no secrets, so its integration tests don't run.

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
