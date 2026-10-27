# AGENTS.md

Guidance for coding agents working in this repository.

## Overview

Pulumi stacks, in TypeScript, for CYC's shared Google Cloud platform. A stack lives here only when no
single app owns it. The apps live in their own repos and depend on this one, never the reverse.
[README.md](README.md) lists the stacks.

- `stacks/<name>/` is one Pulumi project. Each has a `package.json` marker, because Pulumi's nodejs
  language host resolves a program's entry point from the nearest one.
- `src/` holds helpers the stacks import directly. `src/index.ts` exports the published package,
  `@cyc-seattle/platform`; the build compiles only what it imports. Its API (`Workload`,
  `WebService`, `ScheduledJob`, `PlatformOutputs`) is a contract the apps code against, so extend it
  rather than renaming. A `feat:` or `fix:` merge to `main` releases it.
- `schemas/<domain>.yaml` is the Directus data model, one file per domain. `src/directus/` merges
  them into one snapshot and applies it. The `backend` stack deploys Directus with them, in dev and
  prod. `mise run directus-local` applies them to a local
  Directus.
- `src/app/` holds the deploy helpers the app stacks share, such as `appSecret` and `appDatabase`.
  `src/index.ts` doesn't export them.
- `packages/` is a pnpm workspace of private packages: the two syncs, clubspot-sync and gsuite-sync,
  and the `crm`, `clubspot`, and `directus` libraries they share, plus `planning-engine`, the
  planning engine as a pure library. Each builds to `dist/` with `tsc`,
  and the root `Dockerfile` builds the sync images from them. A package reads its workspace
  dependencies' `dist/`, so `mise run check` and `mise run test` build them first.
- `features/` holds the Gherkin integration tests, with their steps in `test/features/`. They run
  against dev with `mise run integration`, never in `ci`. A feature is living documentation of
  business rules, so write and review one with
  [`writing-features`](.agents/skills/writing-features/SKILL.md).
- The code is ESM (`"type": "module"`), run by Node 22's type stripping. Relative import paths end in
  `.ts`, and the code uses only erasable syntax (`erasableSyntaxOnly`).

Run `mise tasks` to list every task. `mise run ci` runs the checks and the tests.

## Working in this repo

- Plans live on GitHub issues. `.plans/` is git-ignored, for local drafts.
- `.agents/skills/` holds this repo's own skills. `cleanup-duplicate-people` and `cleanup-schools`
  each work through one kind of CRM data problem, proposing a code fix that stops it recurring,
  then per-row edits for the user to approve. Claude Code reads skills only from `.claude/skills`,
  so link them there once: `mkdir -p .claude && ln -s ../.agents/skills .claude/skills`.
- PR titles are conventional commits. PRs merge by squash, or by merge commit to keep a branch's
  history (cyc-seattle/workplace#6). Either way, the PR title is the commit's title.
- Never push to `main`.

## Deploys

- `infra`, `smoke`, and `backend` deploy from Actions (`.github/workflows/pull-request.yml`), through
  the org's reusable `deploy.yml` pinned to a tag, which the WIF provider requires. A PR deploys
  `smoke` and `backend` to dev and runs the integration tests. A push to `main` also previews prod,
  then applies it once a maintainer approves. `prod` is skipped when the preview shows no changes.
- The tasks pick projects from `PULUMI_STACK` in `scripts/each-stack`: `dev` is `smoke`, then
  `backend`, and `prod` is `infra`, then `backend`. Its preview appends each project's `true` or `false` to
  `DEPLOY_CHANGES_FILE`, which `deploy.yml` reads to skip a no-op prod deploy. The workflow calls
  `preview`, `deploy`, `integration`, and `install`, so keep those names.
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
- Never `pulumi destroy` `backend`. Its state holds Directus's database, and Directus's license
  activation is bound to that database and its `PUBLIC_URL` (cyc-seattle/isthmia#172). Ask the
  maintainer before any change that could activate a new Directus. `docs/backend.md` has the rest.

## Schemas

- A change to the planning design or its collections updates the ER diagrams in
  `docs/planning-schema.md` in the same PR.

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
  `.js`. That holds in `packages/` too.
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

### Comments

Comments explain **why**, not what. Keep them to a line or two. Write one where a reader would
otherwise get it wrong: a non-obvious constraint, a surprising API behavior, or a decision that looks
arbitrary but isn't.

- Don't narrate the code, restate the diff, or argue for the approach you chose.
- Cite an issue instead of recounting its discussion.
- In docs, record the outcome, not the path to it, and use a role name or `<placeholder>` instead of
  an email address or a numeric account ID.
