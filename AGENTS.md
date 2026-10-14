# AGENTS.md

Guidance for coding agents working in this repository.

## Overview

Pulumi stacks, in TypeScript, for CYC's shared Google Cloud platform. A stack lives here only when no
single app owns it. The apps live in their own repos and depend on this one, never the reverse.
[README.md](README.md) lists the stacks.

- `stacks/<name>/` is one Pulumi project. Each has a `package.json` marker, because Pulumi's nodejs
  language host resolves a program's entry point from the nearest one.
- `src/` holds helpers the stacks import directly. `src/index.ts` exports the published package,
  `@cyc-seattle/platform`; the build compiles only what it imports.
- `features/` holds the Gherkin integration tests, with their steps in `test/features/`. They run
  against dev with `mise run integration`, never in `ci`.
- The code is CommonJS, like isthmia's Pulumi code (cyc-seattle/isthmia#127). Import paths carry no
  `.js` extension.

Run `mise tasks` to list every task. `mise run ci` runs the checks and the tests.

## Working in this repo

- Plans live on GitHub issues. `.plans/` is git-ignored, for local drafts.
- PR titles are conventional commits. PRs merge by squash.
- Never push to `main`.

## Deploys

- `bootstrap` is applied by a human with project Owner and `gh` `admin:org`, never by CI
  (cyc-seattle/isthmia#118).
- Preview before every apply. Every preview of an unchanged stack must show no changes.
- Run `pulumi` under mise. Without mise's env, it uses whatever backend it last logged in to.

## Code style

- A resource is a subclass with secure defaults and explicit grant methods, like `StateBucket` and
  `ServiceAccount`.
- New IAM grants are least-privilege.
- An IAM member resource takes `deleteBeforeReplace: true`. It is read-modify-write against one
  shared policy, so the default replacement strips the member it just added (cyc-seattle/isthmia#153).
- Unit tests live in `test/`, and mock Pulumi with `pulumi.runtime.setMocks`.

### Comments

Comments explain **why**, not what. Keep them to a line or two. Write one where a reader would
otherwise get it wrong: a non-obvious constraint, a surprising API behavior, or a decision that looks
arbitrary but isn't.

- Don't narrate the code, restate the diff, or argue for the approach you chose.
- Cite an issue instead of recounting its discussion.
- In docs, record the outcome, not the path to it, and use a role name or `<placeholder>` instead of
  an email address or a numeric account ID.
