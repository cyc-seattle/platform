# AGENTS.md

Guidance for coding agents working in this repository.

Follow `cyc:conventions` (the rules shared by every cyc-seattle repo).

## Overview

Pulumi stacks, in TypeScript, for CYC's shared Google Cloud platform. A stack lives here only when no
single app owns it. The apps live in their own repos and depend on this one, never the reverse.
[README.md](README.md) lists the stacks.

- `stacks/<name>/` is one Pulumi project. Each has a `package.json` marker, because Pulumi's nodejs
  language host resolves a program's entry point from the nearest one.
- `src/` holds helpers the stacks import directly. `src/index.ts` exports the published package,
  `@cyc-seattle/platform`, and `src/planning/index.ts` its `planning` subpath; the build compiles
  only what they import. Its API (`Workload`,
  `WebService`, `ScheduledJob`, `PlatformOutputs`) is a contract the apps code against, so extend it
  rather than renaming. A `feat:` or `fix:` merge to `main` releases it.
- `schemas/<domain>.yaml` is the Directus data model, one file per domain. `src/directus/` merges
  them into one snapshot and applies it. `src/schema/index.ts` is their TypeScript types, published
  as `@cyc-seattle/platform/schema` for apps to pass to `@directus/sdk`. It's generated: after a
  schema change, run `mise run schema-types`, and CI fails until you do. The `backend` stack deploys Directus with them, in dev and
  prod. A schema change reaches dev only once it merges to `main`.
- `src/planning/` is the planning engine, published as `@cyc-seattle/platform/planning` so an app can
  load it without Pulumi. [`docs/planning-engine.md`](https://cyc-seattle.github.io/platform/planning-engine/) gives its rules.
- `src/app/` holds the deploy helpers the app stacks share, such as `appSecret` and `appDatabase`.
  `src/index.ts` doesn't export them.
- `src/syncs/` holds the two deployed syncs, clubspot-sync and gsuite-sync, and the `runtime/` they
  share, plus calendar-sync, which someone runs by hand.
  `src/model/` holds the CRM and Clubspot row types they use. The published package never reaches
  either (`test/published.test.ts`), so the syncs' dependencies are `devDependencies`. The root
  `Dockerfile` bundles each sync with esbuild into a one-file image. [`docs/syncs.md`](https://cyc-seattle.github.io/platform/syncs/) describes them.
- `docs/` is published as the docs site, <https://cyc-seattle.github.io/platform/>, by `docs-site/`
  (Astro Starlight) and `.github/workflows/docs.yml`, on every push to `main`. Write each page for
  GitHub too: no title frontmatter, a first heading for the title, and relative links. A new page
  goes in a section of `docs-site/astro.config.ts`'s sidebar, and in `docs/README.md`.
- `features/` holds the Gherkin integration tests, with their steps in `test/features/`. They run on
  a throwaway stack in each CI job (`integration-ci.yml`, `mise run ci-stack` then
  `mise run integration-ci`), and only those tagged `@smoke` run against dev after a deploy.
  [`docs/testing.md`](https://cyc-seattle.github.io/platform/testing/) explains. A feature is living documentation of
  business rules, so write and review one with the `write-feature` skill from
  [`cyc-seattle/agent-skills`](https://github.com/cyc-seattle/agent-skills). Here, the `Step` helper
  registers each text under every keyword, `parameter()` in `test/features/steps/index.ts` defines a
  parameter type, and a feature tagged `@licensed` needs a licensed Directus.
- The code is ESM (`"type": "module"`), run by Node 22's type stripping. Relative import paths end in
  `.ts`, and the code uses only erasable syntax (`erasableSyntaxOnly`).

Run `mise tasks` to list every task. `mise run ci` runs the checks and the tests.

## Working in this repo

- Plans live on GitHub issues. `.plans/` is git-ignored, for local drafts.
- `.agents/skills/` holds this repo's own skills. `cleanup-duplicate-people` and `cleanup-schools`
  each work through one kind of CRM data problem, proposing a code fix that stops it recurring,
  then per-row edits for the user to approve. `allocate-plan` fills in a Financial Plan's blocks in
  a new draft, for a planner to keep or delete. A schema change to planning updates it in the same
  PR. Claude Code reads skills only from `.claude/skills`,
  so link them there once: `mkdir -p .claude && ln -s ../.agents/skills .claude/skills`.
- PR titles are conventional commits. A maintainer squashes a PR, or merges it with a merge commit to
  keep a branch's history (cyc-seattle/workplace#6). Either way, the PR title is the commit's title.
- Never push to `main`.

## Branches and merges

- There's no merge queue (#280). A PR merges once `ci / ci` and `pr-title / pr-title` pass, and only
  org admins and `maintainers` can merge it. `contributors` push branches and open PRs. Even a
  maintainer merges by bypassing the rule, with `gh pr merge --squash --admin` once checks pass, so
  auto-merge never fires.
- Never force-push. To bring a branch up to date, merge `origin/main` into it.
- Dev's environments take only `main`, so a branch can't deploy to dev, by hand or otherwise.
- When a dev deploy or its tests fail, reproduce the failure locally against dev before you push a fix:
  `PULUMI_STACK=dev mise run integration`, or `PULUMI_STACK=dev mise run preview` for a deploy.

## Deploys

- `infra`, `smoke`, and `backend` deploy from Actions (`.github/workflows/release.yml`), through
  the org's reusable `deploy.yml` pinned to a tag, which the WIF provider requires. A PR's push runs
  only CI. Each push to `main` deploys dev, then previews prod and applies it once a maintainer
  approves. `prod` waits for dev, so a broken deploy stops there, and is skipped when the preview
  shows no changes.
- After each dev deploy, `integration.yml` runs the `@smoke` features against dev. One run goes at
  a time, and a newer one replaces any that's waiting, so pushes during a run are tested together.
  A waiting deploy goes ahead of a test run. A failure opens or comments on the issue
  `Integration tests failed on dev`, listing the PRs merged since the last green run, and a green
  run closes it.
- The tasks pick projects from `PULUMI_STACK` in `scripts/each-stack`: `dev` is `smoke`, `backend`,
  `inbox`, `listmonk`, then `authentik`, and `prod` is `infra`, `backend`, `inbox`, `listmonk`, then `authentik`. `DEPLOY_PROJECTS` narrows the list. Its preview
  appends each project's `true` or `false` to `DEPLOY_CHANGES_FILE`, which `deploy.yml` reads to skip
  a no-op prod deploy. The workflow calls `preview`, `deploy`, `integration`, and `install`, so keep
  those names.
- `nightly.yml` deploys `main` to dev each night and runs the integration tests, under the same dev
  lock as the deploys. It tests platform and sail-team together, so it keeps its own issue: a failed
  night opens or comments on the `Nightly integration run failed` issue,
  assigned to the maintainer, and a green night closes it. Run it early with `gh workflow run nightly.yml`.
- `bootstrap` is applied by a human with project Owner and `gh` `admin:org`, never by CI
  (cyc-seattle/isthmia#118). Use `preview-bootstrap` and `deploy-bootstrap`.
- Local deploys are the break-glass path. `mise.toml` leaves `GOOGLE_APPLICATION_CREDENTIALS` alone
  when it's set, because Actions' auth step sets it.
- Preview before every apply. Every preview of an unchanged stack must show no changes.
- A new field in `platform/outputs.json` breaks the dev deploy until `infra` writes it, and
  `infra` applies only after dev passes. Apply `infra` from the branch first.
- The Kubernetes provider execs `gke-gcloud-auth-plugin` with Application Default Credentials, in place
  of an access token that would change its kubeconfig on every run. `mise run install` installs the
  plugin into mise's gcloud, so run `pulumi` under mise.
- Adding an app's dev database means adding its name to `infra:devDatabases` in a platform PR. Cloud SQL
  ignores IAM conditions on its user and database calls, so `deploy-dev` can't create them itself.
- Run `pulumi` under mise. Without mise's env, it uses whatever backend it last logged in to.

## Shared stacks, the cluster, and Directus

- Never `pulumi destroy` a shared stack.
- Prod's Pulumi state is read-only: preview and read it, never write it. Before you change dev's
  state, back it up with `pulumi stack export --file <path outside the repo>`.
- Run `kubectl` only under the workplace's mise env, from the workplace or a checkout in it. Its
  `KUBECONFIG` holds only CYC's cluster. Never change the machine's current kube context.
- Read dev's Directus logs with `mise exec -- kubectl -n dev logs deploy/directus`, from the
  workplace. Use `kubectl` on dev only to read.
- Directus's license allows 5 activations, and each one is bound to the database and `PUBLIC_URL`
  (cyc-seattle/isthmia#172). Never drop, recreate, or rename Directus's database, in dev or prod,
  and never change its `PUBLIC_URL`. Ask the maintainer before any change that could activate a
  new Directus that lives past 24 hours. A throwaway one gone sooner, like the CI stack's, spends
  nothing. [`docs/backend.md`](https://cyc-seattle.github.io/platform/backend/) has the rest.

## Schemas

- Staff read every collection in the Data Studio. Write and review a schema change with
  [`directus-schema`](.agents/skills/directus-schema/SKILL.md). `test/data-studio.test.ts` checks
  the rules it can from the YAML.
- Review every schema change, and every proposal for one, with
  [`schema-review`](.agents/skills/schema-review/SKILL.md), before it's built and before it merges.
  The maintainer agrees to new fields, links and dropdowns before they're built.
- The schema apply never renames or deletes a collection. A change it can't make, such as a rename,
  goes in `stacks/backend/migrations/` as a Directus migration, which Directus runs once at start,
  before the apply. It must do nothing when run again or on a new database, and be tested in PGlite.
- A change to the planning design or its collections updates the ER diagrams in
  [`docs/planning-schema.md`](https://cyc-seattle.github.io/platform/planning-schema/) in the same PR.
- A subtype, such as `programs` of `products`, is its own collection (cyc-seattle/isthmia#213 §2):
  - The base holds the shared fields and a `kind`. A kind with no fields of its own gets no
    collection.
  - The subtype keeps its own `id` and links to the base by `<base>_id`: a unique, required M2O
    whose picker filters on the subtype's `kind`. The foreign key restricts delete, so a base row
    with a subtype row can't be deleted. The base reads it back
    through a one-row O2M alias.
  - Directus can't compare fields across collections, so nothing stops a subtype row's base having
    the wrong `kind`. `test/subtypes.test.ts` lists every subtype and checks its schema, so add a new
    one there.
- A change to how the engine calculates a number updates [`docs/planning-engine.md`](https://cyc-seattle.github.io/platform/planning-engine/) in the same PR. A
  Financial Plan's results record the `@cyc-seattle/platform` release that calculated them, so such a change
  must be a `feat:` or `fix:`, which releases a new version.

## Code style

- A resource is a subclass with secure defaults and explicit grant methods, like `StateBucket` and
  `ServiceAccount`.
- New IAM grants are least-privilege.
- An IAM member resource takes `deleteBeforeReplace: true`. It is read-modify-write against one
  shared policy, so the default replacement strips the member it just added (cyc-seattle/isthmia#153).
- Unit tests live in `test/`, and mock Pulumi with `pulumi.runtime.setMocks`.

### Modules

The rules for ESM come from cyc-seattle/workplace#6.

- Relative imports end in `.ts`, so `../../src` is `../../src/index.ts`. The build rewrites them to
  `.js`.
- Use only erasable syntax: no enums, namespaces, or parameter properties. Node strips the types and
  runs the rest as written.
- Use `import.meta.dirname`, never `__dirname` or `require`. Neither `tsc`, eslint, nor vitest flags
  them, but Node fails on them at run time.
- Never use top-level await in anything `src/index.ts` reaches. The apps' CommonJS code loads the
  package through Node's `require(esm)`, which fails on a graph that awaits at the top level.
- A stack's `package.json` sets `"type": "module"`, and its `Pulumi.yaml` sets `typescript: false`.
  Without the type, Pulumi loads the stack through its vendored ts-node, which rejects `.ts` paths.
- Code a dynamic provider reaches follows two more rules, because Pulumi serializes it into state:
  - Load an npm package with `await import()` inside the function that uses it. A top-level import of
    an ESM package is copied into state by value.
  - Import a Node builtin as a default import (`import fs from "node:fs"`). A named or namespace
    import fails to serialize.

### Words people read

Write and review every word a person reads in an app with the `ui-copy` skill from
[`cyc-seattle/agent-skills`](https://github.com/cyc-seattle/agent-skills). That includes the planning
engine's warning messages, which Sail Team shows to planners.

### Comments

Comments explain **why**, not what. Keep them to a line or two. Write one where a reader would
otherwise get it wrong: a non-obvious constraint, a surprising API behavior, or a decision that looks
arbitrary but isn't.

- Don't narrate the code, restate the diff, or argue for the approach you chose.
- Cite an issue instead of recounting its discussion.
- In docs, record the outcome, not the path to it, and use a role name or `<placeholder>` instead of
  an email address or a numeric account ID.
