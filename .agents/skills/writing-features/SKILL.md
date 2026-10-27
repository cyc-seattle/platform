---
name: writing-features
description: Write, rewrite, or review the Gherkin features in `features/` and their step definitions in `test/features/`, so each feature reads as living documentation of business rules, in the domain's language. Use when the user wants to add or change a feature or scenario, specify who can see or change what (roles, policies, service accounts), split or merge features, write step definitions, or review a feature or a PR that touches `features/`.
---

# Writing Features

A feature is a specification first and a test second. It records a business rule in words the
people who own the rule would sign off on: the club's staff, its volunteers, and the maintainer.
The automation then keeps that record honest. If a reader needs the step definitions, the issue
tracker, or the fixture code to understand a scenario, the feature has failed, however well it
tests.

Cucumber's creator, Aslak Hellesøy: "If you think Cucumber is a testing tool, please read on, because you are
wrong." [references/sources.md](references/sources.md) lists the sources behind every rule here,
and where they disagree. [references/examples.md](references/examples.md) holds worked
before-and-after examples from this repo.

## When writing or rewriting a feature

1. **Find the rules first.** Before writing Gherkin, list the business rules the feature must
   pin, one sentence each, the way Example Mapping does: a story (the feature), its rules, an
   example or two per rule, and the open questions. Ask the user about anything you would have to
   guess. A rule you can't state in one sentence is two rules, or not yet understood.
2. **Pick the feature's scope.** One feature covers one area of the domain that one person or team
   owns: a permission set, a sync, a page. Every scenario in it must be about that area. A scenario
   about someone else's access, or a property every domain shares, goes in another feature (see
   "Scope" below).
3. **Write the description**, then a `Rule:` per rule, then an `Example:` per key example.
4. **Write the steps declaratively**, in the domain's words, then reuse or add step definitions.
5. **Run the review checklist** below over the result before you hand it back.

## The rules

### The feature describes the domain, not the project

The description under `Feature:` gives the context a reader needs to judge the rules: what the
area is, who uses it, and why the rules are what they are. It's not the place for:

- code: collection names, file paths, function names, query strings;
- the plan: issue numbers, PR links, steps of a migration, "turns these scenarios green";
- the test's mechanics: run IDs, how fixtures are seeded, what's cleaned up afterwards.

Those belong in the step definitions, a code comment, or the PR. A `#` comment in a feature is for
a maintainer reading the file, and the same rule applies: why a scenario exists, not how it runs.

### Givens state the situation, readable without the steps

A Given says what's true before the action, in words that need no lookup. `Given this run's users
and rows on dev's Directus` hides everything that matters. `Given a user with the CRM Reader
policy` says it. Ask: could a reader predict the Then from the Given and When alone? If not, an
essential detail is missing from the scenario.

Don't put the situation in prose either. A description that introduces a cast of characters and
their relationships, which scenarios then refer to by name, is a fixture written in English: the
reader has to hold it all in their head and can't tell which part a scenario depends on. Each
scenario's Givens carry what that scenario needs.

### One rule per scenario, grouped under `Rule:`

- Group a feature's scenarios under `Rule:` keywords, one per business rule. The rule's title is
  the rule, stated as a fact: `Rule: Medical records need a Medical policy, even for a CRM Writer`.
- Each scenario illustrates one rule. Use `Example:` for it, since that's what it is.
- One When per scenario. Two Whens usually mean two behaviours, and so two scenarios. The exception
  is a rule about a sequence, like a sync run that's undone and then repeated.
- A Then checks the rule's outcome, observable to a user, not an internal state. "Make sure it
  can fail": a Then that holds whatever the system does specifies nothing.
- Aim for three to five steps. Write them in the third person ("they", "a guardian"), not "I": "I"
  hides who the actor is and what they're allowed to do.

### Declarative steps: what, not how

Write the behaviour, not the clicks, requests, or queries that produce it. "When they look up a
sailor's guardians", not "When they GET /items/contacts with filter[subject_id][_eq]". The step
definition holds the how, so a change to Directus or the UI changes the glue, never the feature.

Keep only the essential detail. A value appears in a scenario when changing it changes the outcome.
Incidental data (IDs, dates that don't matter, field lists) goes in the glue.

### Use the domain's names, and the right kind of name

- Name every actor by what it is in the domain, and keep kinds apart. A **policy** (CRM Reader),
  a **role** (Coach), a **person** in a role (a Parent Coordinator), and a **service account**
  (clubspot-sync's machine user) are different kinds of thing. Don't call them all "logins", and
  don't mix kinds in one Examples column.
- Use names the reader already knows. Introduce a new term in the description before a scenario
  uses it. A feature titled "What the engine's machine user can do" fails a reader who has never
  heard of "the engine".
- Say "a sailor's medical profile", not `medical_profiles`. The glue maps the domain noun to the
  collection.

### Good names

- The feature's title names the area and its question: "Who can see and change the CRM".
- A rule's title states the rule. A scenario's title states the example's point, so the list of
  titles reads as a summary of the behaviour.
- Name the people in examples only when the name helps a reader tell them apart in one scenario.
  A role ("a guardian", "another family's guardian") usually reads better than a cast. Some
  sources favour named personas, but only ones the whole team already knows. A cast introduced in
  one feature's description is a fixture, not a persona.

### Scope: only real requirements, in the feature they belong to

- Each scenario must be a requirement of this feature's area. If you can't name who asked for it,
  question it.
- A property every domain shares, such as "MCP reaches what the REST API does", isn't a rule of any
  one domain. Specify it once, in a feature about that property, or leave it to a unit test.
- A service's access belongs with that service's other rules, not in the feature of each
  collection it touches. gsuite-sync reading the catalog is a gsuite-sync rule.
- A feature about a permission set covers every policy in that set. A CRM feature that only
  covers CRM Writer leaves out CRM Reader and the Medical policies, and hides how they relate.
- Rules that are part of one permission set live in one feature. The Community role's roster rules
  are part of the CRM's permissions, so they sit with the CRM's other rules.

## Background, Scenario Outline, and data tables

These remove repetition, and each can also hide intent. Use them when the reader still sees the
whole rule.

- **Background** holds Givens that every scenario in the feature, or every example in a `Rule:`,
  needs and that a reader can keep in mind: `Given a sailor registered in a camp running today`.
  Keep it to a few lines. Never put the scenarios' differences there, and never use it for setup
  the reader doesn't need to know about: that's a hook in the glue. If only some scenarios need a
  Given, it isn't background. A `Rule:` can have its own Background.
- **Scenario Outline** is for one rule shown on several examples that differ only in data, where
  each row is a case a reader cares about. Name the columns for what they are (`policy`,
  `record`), never `login` or `value`. Don't use an outline to run every combination: an exhaustive
  matrix is a test, not a specification (see below). Keep the Examples short enough to read.
- **Data tables** suit a step that takes a list or a record:
  `Given a sailor with these guardians:`. A table that lists API query strings is the how, written down.

## Permissions and access rules

Most of this repo's features specify who can see and change what in Directus. They follow the
rules above, plus these:

- **The actor is the grant, stated in the Given.** `Given a user with the CRM Reader policy`,
  `Given a user with the Coach role`, `Given clubspot-sync's service account`. The glue creates that
  user and grants exactly that. A scenario about a combination says so:
  `Given a user with the CRM Writer policy and no Medical policy`.
- **One feature per permission set**, covering every policy in it. One `Rule:` per thing a policy
  allows or denies, stated as the business sees it:
  `Rule: A CRM Reader sees people and their contacts, and changes nothing`.
- **Deny rules earn their place when they matter to the business.** "A Coach can't read medical
  profiles" is a rule someone would ask about. "A Coach can't delete sync_runs" usually isn't.
- **Show each rule on its key examples**, the records a reader would ask about. When the rule
  must hold for a whole set, name the set in the step
  (`Then they can read every record in the CRM`) and let the glue walk it.
- **Field-level and query-level rules** read as the business rule they protect:
  `Rule: A family can't find out a hidden contact detail by filtering or searching`, with examples like
  "filtering by an email's first letters". The glue holds the query strings.
- **Service accounts** get their own feature, or a rule in the feature of the service that uses
  them, not a row in a policy's Examples.

### What belongs in unit tests instead

A feature runs against dev's Directus, takes minutes, and is read by people. Push down to unit
tests in `test/` (Pulumi mocks) or `packages/*/test/` anything a reader wouldn't ask about:

- the exhaustive policy × collection × action matrix, checked against the policy definitions in
  `src/directus/` and `schemas/`;
- which fields a policy's permission lists, and each filter operator a guard must refuse;
- edge cases in a helper (case-folding an email, parsing a query).

Keep a live scenario for each rule that only Directus can prove, such as a relational rule that
needs the license, and for each rule a person would want to read.

## Step definitions: a small domain vocabulary

The steps across `test/features/` form one vocabulary for the domain. Each step is a phrase a
reader would use, and the glue holds every how.

- Reuse a step before adding one. Read the existing steps first (`grep -rn 'Step(' test/features`).
- Write steps as a domain API: `a user with the {string} policy`, `they can read {string}`, each
  with one meaning everywhere.
- Name parameters in the text. vitest-cucumber has no custom parameter types, so a bare `{string}`
  says nothing about what fills it. Put the noun next to it (`the {string} policy`,
  `a {string} record`) and name the callback's parameter to match (`policy`, `record`).
- A step's definition must not depend on which scenario runs it, beyond the state its Givens set.
- Keep the glue thin: a step calls domain helpers (`as(user)`, `newRow(record)`), and the helpers
  call Directus. The helpers are shared; the steps are just phrases bound to them.

## This repo's tooling

The integration tests run with `@amiceli/vitest-cucumber` 7.0.0, through `mise run integration`
against dev. They never run in `mise run ci`.

- It parses `Feature:` descriptions, `Background:`, `Rule:` with its own `Background:`, `Example:`
  and `Scenario:`, `Scenario Outline:` with `Examples:`, tags, data tables, and doc strings.
- The test file must name every scenario in the feature, or the run fails. Scenarios under a
  `Rule:` go inside `Rule(name, ({ RuleBackground, RuleScenario, RuleScenarioOutline }) => ...)`.
  `defineSteps` at the feature level covers rule scenarios too.
- Parameter types are fixed: `{string}`, `{int}`, `{number}`, `{word}`, `{list}`, `{boolean}`,
  `{date}`, `{char}`, `{any}`.
- A keyword-free step matches in a Scenario but not in a Scenario Outline, so this repo's `Step`
  helper registers each text under Given, When, Then, and And.
- A feature tagged `@licensed` needs a licensed Directus. Check how its test file skips it before
  adding one.

## Review checklist

Apply this to a feature or a PR touching `features/`. For each failure, quote the line and say
which rule it breaks.

- [ ] The title names an area of the domain; the description gives the business context, and holds
      no code, issue or PR references, plan steps, or test mechanics.
- [ ] A reader who knows the club but not the code understands every scenario without opening
      another file.
- [ ] Every scenario sits under a `Rule:` that states one rule, and illustrates only that rule.
- [ ] Every Given states the situation the scenario depends on. Nothing is hidden in a vague
      Given (`this run's rows`) or in a cast of characters in the description.
- [ ] Steps are declarative: no HTTP verbs, paths, query strings, collection names, or field lists.
- [ ] Every value in a scenario changes its outcome. Incidental data is in the glue.
- [ ] Actors are named for what they are (policy, role, person, service account) and kinds aren't
      mixed. No "login".
- [ ] Every term is the domain's, or the description defines it.
- [ ] Every scenario is a requirement of this feature's area. Nothing generic, nothing that belongs
      to another service or domain. A permission set's feature covers all its policies.
- [ ] Background holds only what every scenario needs and a reader can keep in mind.
- [ ] Each Scenario Outline is one rule over a few meaningful cases, with columns named for what
      they hold. No exhaustive matrices.
- [ ] Rules a reader wouldn't ask about are unit tests instead.
- [ ] Step texts name what each parameter is, and reuse the existing vocabulary.
