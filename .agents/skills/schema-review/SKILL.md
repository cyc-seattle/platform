---
name: schema-review
description: Review the data model in a change to the Directus schema, before it's built and before it merges. Use on a proposal for new collections, fields, links or dropdowns, on a diff or PR that touches `schemas/*.yaml` or `stacks/backend/migrations/`, or before asking for review of one.
---

# Review a schema change

A schema can pass every test and still confuse the people who use it: a Financial Plan that holds
"Plans" through "Financial plans plans", next to a separate "plan copies". This review checks the
model itself: its names, its links, its leftovers, and that the maintainer agreed to it.

How the Data Studio shows a collection (templates, labels, hidden IDs, default views) is the
[`directus-schema`](../directus-schema/SKILL.md) skill. Apply it too; this one doesn't repeat it.
Nor does it repeat the schema rules in `AGENTS.md`, under "Schemas": check those as written.

The review is read-only. It reports findings; the author fixes them.

## What to review

- **A proposal**, before anything is built: the issue or plan that lists the new collections,
  fields, links and dropdowns. Review it the same way, and stop the build until the maintainer has
  signed off.
- **A diff or PR**: `git diff origin/main...HEAD -- schemas/ stacks/backend/migrations/ docs/ features/`,
  or `gh pr diff <number>`. Read each changed collection in full in `schemas/*.yaml`, not only the
  changed lines, and look for the code that uses it in `src/`, `stacks/`, and the app that reads it.

## Names

- A collection or field is named for what staff call it. Its key and its label say the same thing:
  `version_sets` labelled "Financial Plan" is a finding.
- One concept has one word across every collection. A plan, a plan copy, a version and a member
  should not all name the same thing.
- No doubled or generated names, such as "Financial plans plans". Directus makes these for a join
  table; give it a real name, or hide it behind a many-to-many list.

## Leftovers

- Every collection, field and link the change adds or keeps is read or written by code, or by
  staff for a reason someone can state. Search for its key.
- A change that replaces something removes the old one in the same PR. The schema apply never
  deletes, so the removal is a migration in `stacks/backend/migrations/`.

## Links

- Use the simplest shape that fits. A many-to-one beats a join table unless the relation really is
  many-to-many.
- Two collections have one path for one relation. A second link that says the same thing, or one
  you could reach through another, is a finding.

## Dropdowns

- Every choices list, and every value added to one, is one the maintainer agreed to. No values for
  cases nobody has yet, and no "Other" unless agreed.
- Two states are a boolean, not a dropdown.

## Notes and descriptions

- A field's `note` is at most 280 characters, with inline markdown only: bold, italic, code and
  links.
- Longer text goes in a `description` field, which allows simple markdown.

## Features

- A feature in `features/` describes what the system does for people. A step that restates a field
  name, a type or a dropdown's values is a finding; the schema already says it.

## Sign-off

The maintainer agrees to every new field, link and dropdown before it's built. Look for that in the
issue or the PR. Without it, the review blocks.

To get it, list them for the maintainer:

| Collection.field                     | Type              | Links to            | Choices      |
| ------------------------------------ | ----------------- | ------------------- | ------------ |
| `plan_offerings.catalog_offering_id` | uuid, many-to-one | `catalog_offerings` |              |
| `version_sets.status`                | string, dropdown  |                     | Draft, Saved |

## Report

Report in this order:

1. **Blocking:** each finding with its `file:line`, the rule, and the fix.
2. **Questions for the maintainer:** anything the rules leave to them.
3. **Sign-off table:** the new fields, links and dropdowns, marked agreed or not yet.
