---
name: directus-schema
description: Make a collection in `schemas/*.yaml` easy for club staff to read in the Directus Data Studio. Use when adding or changing a collection, a field, a link between tables, a dropdown, or a default view in `stacks/backend/default-views.ts`, or when reviewing a PR that does.
---

# Directus schemas staff can read

Staff use the Data Studio, not the YAML. A schema can be correct and still give them a table that
opens in random order, shows IDs instead of names, or calls a field "Ga Share". Every change to
`schemas/*.yaml` is also a change to what staff see, so write it for them.

`test/data-studio.test.ts` checks every rule below that the YAML can show, and `mise run ci` runs
it. The rest are for you and the reviewer, who checks them in dev's Data Studio after the PR deploys.

## Name each row

- Every collection has a `display_template` that names the row in words: a person's name, a camp's
  name, or a plan and its date. It shows wherever another row links to this one.
- A template never shows an ID. Follow a link to a name: `{{camp_id.name}}`, not `{{camp_id}}`.
- Two rows should never look the same. If a class can have a cap in each session, the cap's
  template names the session too.

## Show a link by name

- A link field (many-to-one) sets `special: [m2o]`, `display: related-values`, and a
  `display_options.template` that names the linked row, usually the linked collection's own
  template.
- A list of linked rows (one-to-many or many-to-many) sets `display: related-values` and a
  template. For a many-to-many list, the template goes through the join table:
  `{{person_id.first_name}} {{person_id.last_name}}`.
- Links through a join table are many-to-many (`list-m2m`, `special: [m2m]`), so "Add existing"
  lists the real rows, not the join table's rows.
- A link's label drops "ID": `translations: [{ language: en-US, translation: Camp }]` for `camp_id`.

## Hide IDs

- Hide each row ID (`hidden: true`), Clubspot's text IDs included.
- Hide `key`, `*_key`, and `*_keys` fields, and a UUID that links to nothing. Directus can't follow
  them, so they'd only ever show a code.
- Don't link to `directus_users`. Directus adds a database foreign key even when asked not to,
  which can stop a user being deleted, and staff who aren't admins can't see other users anyway.

## Open each table usefully

- Every collection the sidebar shows has an entry in `stacks/backend/default-views.ts`: a sort and
  the columns staff need, in the order they read them. Newest first suits dated rows. Names suit
  lists of people and things.
- The columns never include a hidden field or a row ID. Medical details and other private text stay
  off the list; they belong on the row's own page.
- Every collection the sidebar shows sits in a folder (`group`).
- A table that only pairs two others is hidden (`hidden: true`), and reached through a many-to-many
  list instead, unless nothing else links to it.

## Show values in words

- A dropdown's choices have words for their `text` ("Net assets", not `net_assets`), and the field
  shows them with `display: labels` and the same choices in `display_options.choices`.
- A status is a dropdown, unless it's another system's code whose full list isn't known.
- Money is stored in whole cents in a field ending `_cents`, and uses `display: cents-as-dollars`,
  so a table shows 12500 as $125.00. Directus's `formatted-value` can't divide, and ignores its
  `currency` option. The label drops "cents", and the note says "In cents: 12500 is $125.00."
  because a row's own page still edits the number.
- A rate or share stored as a fraction says so in its note: "0.8 means 80%."
- A date, time, or timestamp uses the `datetime` interface, not `input`.
- A key with an acronym staff may not know (G&A, COGS, BYOB, MTDC, 990) has a label or a note that
  spells it out.

## Write notes for staff

- A note says what the field means to a staffer, in their words. It doesn't name a code file, an
  issue, or another field by its key (`people.email`), and it doesn't say "Reverse of".
- Notes for developers go in a YAML comment or in `docs/`.

## Keep synced fields read-only

- A field a sync writes is `readonly: true`, since the next sync would overwrite an edit. The syncs
  write through the API, which ignores it. A field staff set by hand on a synced table, such as a
  class's program, stays editable, and matches the writer rules in `stacks/backend/policies.ts`.
- The collection's note says where to make a change instead: "Copied from Clubspot, so edit it there."

## Exceptions

An exception goes in the matching list at the top of `test/data-studio.test.ts`, with a sentence
saying why. Prefer fixing the schema. Add an exception only when the rule would make the Data
Studio worse, such as hiding the only way into a table.

## Check it in dev

After the PR deploys to dev, open each changed collection in the Data Studio, signed in as a
staffer who hasn't saved their own view of it:

- The table opens in a sensible order, with the columns staff need and names in place of IDs.
- Each link and list shows names, and "Add existing" offers the real rows.
- Labels and notes read clearly to someone who has never seen the YAML.
