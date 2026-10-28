---
name: writing-features
description: Write, rewrite, or review the Gherkin features in `features/` and their step definitions in `test/features/`, so each feature reads as living documentation of the domain's data model and business rules, in plain English a club staffer would use. Use when the user wants to add or change a feature or scenario, specify who can see or change what (roles, policies, service accounts), split or merge features, write step definitions, or review a feature or a PR that touches `features/`.
---

# Writing Features

A feature is a specification first and a test second. It records how one area of the club works:
what its data is, and who can see and change it. It says this in words the people who own the
rules would sign off on: the club's staff, its volunteers, and the maintainer. The tests then check
that the club's system still does what the feature says. If a reader needs the step definitions, the issue
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
2. **Pick the feature's scope.** One feature covers one domain, named after it: `crm.feature`,
   `catalog.feature`, `clubspot.feature`, `authentication.feature`. It covers the domain's data model
   (what it holds, and the rules that data follows) and its permissions (who can see and change
   it). Every scenario in it must be about that domain. A scenario about another domain, or a
   property every domain shares, goes in another feature (see "Scope" below).
3. **Write the description**, then a `Rule:` per rule, then an `Example:` per key example.
4. **Write the steps declaratively**, in the domain's words, then reuse or add step definitions.
5. **Read every line aloud** and rewrite any line a club staffer wouldn't say (see "Plain
   language" below).
6. **Run the review checklist** below over the result before you hand it back.

## Plain language

Every line of a feature (its title, description, Rules, Examples, and steps) must pass one test:

> Would a normal person of average intelligence who works at a sailing club understand it on first
> read? And does it sound like something a person would actually say?

The maintainer's verdict on a feature that failed this test: it reads like AI slop. Their example:
"A CRM Writer keeps people and their contacts" is not how humans speak. Say "A CRM Writer can edit
the CRM".

### Write it the way people talk

- Use plain subject, verb, object sentences: "A Medical Reader can see sailors' medical
  information".
- Use everyday verbs: can see, can change, can add, can edit, can delete. Pick one word for each
  action and keep it everywhere. Don't write "sees" in one rule and "reads" in the next. "Change"
  means add, edit, or delete: say so once in each feature's description, then don't swap in "edit"
  for it.
- Make the person who sees something the subject: "the parent sees the teammate's email", not "the
  teammate's email shows".
- Say a refusal one way: "the CRM doesn't allow it". Not "is refused" in one example and "rejects
  it" in the next.
- Use "or" in a negative list: "can't see sessions or registrations", not "sessions and registrations".
- Name a set once in the description, then use the name: define "a person's details" and write
  "it can delete people's details", not the same five-item list in every step.
- Use the words staff use: parent, sailor, team, roster, registration, sign-up answers. Don't use
  the system's words: collection, record, row, subtype, machine user, contact point, promoted field.
- Give a concrete example where an abstract noun would go: "a sailor's school", not "a promoted
  field".
- When you need a technical term, such as a policy's name, say what it means in plain words the
  first time: "CRM Writer: can add, edit, and delete people and their details."
- Write one idea per sentence. Split a sentence that stacks clauses.

### Patterns to rewrite

These came from review comments on [cyc-seattle/platform#48](https://github.com/cyc-seattle/platform/pull/48).

| Slop                                                                                    | Plain                                                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A CRM Writer keeps the CRM                                                              | A CRM Writer can change the CRM                                                       |
| A CRM Reader sees the CRM, and changes nothing                                          | A CRM Reader can see the CRM, but can't change it                                     |
| Programs are the catalog's                                                              | Programs belong to the catalog                                                        |
| Crew read the rosters (in one rule), Crew see no medical profiles (in the next)         | Crew can see the rosters. Crew can't see medical information                          |
| A service account which reaches only what it syncs                                      | An account of its own, which can only do the work the sync needs                      |
| Groups grant nothing beyond policies                                                    | Groups only give policies to people                                                   |
| A family reads no one's address book                                                    | A family can't see anyone's extra emails and phone numbers                            |
| Signing in matches a person in the CRM by email, whatever its case                      | Signing in finds a person in the CRM by their email, even if they type it in capitals |
| A Parent Coordinator's role that has ended shows no one                                 | Parent Coordinators whose program role has ended see no one                           |
| Given a group in the Workspace fake                                                     | Given a program with a Google group                                                   |
| the leaver's membership row records that they left                                      | they're still not in the group                                                        |
| When staff delete that note                                                             | When staff let them back into the group                                               |
| Teammates show by name                                                                  | The parent sees every teammate by name                                                |
| Rule: A Plan Writer can edit any draft … Then they can change a draft                   | Rule: A Plan Writer can change any draft … Then they can change a draft               |
| is refused / the catalog refuses it / they're refused                                   | the CRM doesn't allow it                                                              |
| can't see sessions, classes, and registrations                                          | can't see sessions, classes, or registrations                                         |
| it can delete people, their parents and emergency contacts, their other emails…         | it can delete people's details (with "details" defined in the description)            |
| clubspot-sync runs / gsuite-sync's service account                                      | the Clubspot sync runs / the Google sync's service account                            |
| Then they get the same people as a search for something no one has                      | Then they don't find the teammate                                                     |
| # One example, because each sync run takes minutes                                      | (nothing: say why in the step code)                                                   |
| A CRM Writer can change the CRM (when the CRM includes registrations they can't change) | A CRM Writer can change people and their details                                      |
| Each account has its own number (with service accounts in the next file)                | Each revenue account has its own number                                               |
| billing (in one file), what they paid (in another)                                      | payments, everywhere                                                                  |
| Crew can't see sailors' medical information (but a Crew parent sees their own child's)  | Crew can't see other families' medical information                                    |
| A person's roles (in one file), the Crew role (in the next)                             | A person's program roles, the Crew role                                               |
| Only planners can see plans (when an admin can too)                                     | Only admins and planners can see plans                                                |
| what came from Clubspot / what it copies from Clubspot (two sets, nearly the same)      | Clubspot's events and registrations / what it copies from Clubspot, each defined once |
| sharing for each camp (Clubspot's container)                                            | sharing for each program                                                              |
| Crew are the club's coaches and volunteers                                              | Crew are the people an admin trusts with every roster                                 |
| Example: Merging two people deletes the duplicate (its steps only check permission)     | Example: The Clubspot sync can delete a duplicate person                              |
| whether or not they opted in                                                            | whether or not the teammate's family opted in                                         |
| But not the email or phone of the teammate or the teammate's parent                     | But they don't see the teammate's or their parent's email or phone                    |
| Given another family on the team, whose parent signs in                                 | Given another parent on the team                                                      |

Watch for:

- odd verbs and made-up idioms: keeps, reaches, holds, carries, grants nothing beyond;
- jargon and internal names a club staffer wouldn't know;
- abstract nouns in place of plain actions, and passive or roundabout phrasing;
- clever compression: "Clubspot's records change in Clubspot, so a CRM Writer only links them";
- vague words that mean something only to the author, such as "the engine" or "the cast";
- test mechanics in a step or a comment: what a search is compared against, which requests a page
  sends, how long a run takes, what the test's stand-in can't do. Those go in the step code;
- the code's name for a service, such as "clubspot-sync". Say "the Clubspot sync", as staff do;
- a kind of thing a staffer can't picture, such as "a volunteer in another role". Name the program
  role: "a family member on race committee".
- a pronoun with two possible owners: "whether or not they opted in", after a parent and a teammate.

### Make the rules agree

A reader takes each rule at its word, so a rule that another rule, an example, or another feature
contradicts is wrong, however plain it reads.

- Use one word for one thing, in every feature. "Account" can't mean a revenue account in one file
  and a sign-in account in the next: say "revenue account". Don't call one thing two names, such as
  "billing" and "what they paid". "Role" alone means Community, Crew, or Admin; a role someone has
  in one program, such as coach or Parent Coordinator, is a "program role" everywhere.
- Use the club's own nouns, not a vendor's. Summer Camp is a program; Clubspot's "camp" is only its
  container for events, so no rule is "for each camp". Where a feature must name what a vendor
  sends, say it in plain words once, and keep the vendor's noun out of the rules.
- Don't define two sets that nearly overlap, such as "what came from Clubspot" and "what it copies
  from Clubspot". A reader can't tell which a rule means. Name each set for what sets it apart,
  define it once, and check that every rule using it holds for every item in it.
- Define a set in the feature that uses it, before its first use. A set defined only in another
  feature is undefined here.
- Say exactly what a rule covers. "A CRM Writer can change the CRM" is false when the description
  says the CRM includes registrations and medical information, which they can't change. Name the
  set: "people and their details".
- Scope an absolute rule that has an exception. "Crew can't see medical information" contradicts
  "a Crew parent sees their own child's"; write "other families' medical information".
- Say where a rule holds, rather than who it leaves out. "Anyone in a role but Parent Coordinator
  sees no one" leaves a reader asking about Crew, who see every roster. Write "A program role lets
  someone see more only in that program".
- Name the exception in the rule, not elsewhere: "Each plan is for one product, apart from the
  Operations Plan".
- Each example shows its rule, and only that. An example about who decides doesn't belong under a
  rule about what's shared: split it into a rule of its own. An example's title says what its steps
  check: "Merging two people deletes the duplicate" over steps that only check a permission
  promises more than it tests.
- When a rule here limits what another feature allows, such as "only planners can see products"
  while the Google sync sees them, add the exception to the rule.
- An "only" rule names admins too. "Only planners can see plans" is false the moment an example
  shows an admin looking at one: write "Only admins and planners can see plans".
- State a permission as a permission. "It deletes something only when it merges two people"
  promises a condition the example can't check, when the example shows only that it can delete
  people. Write "It can delete people, but nothing else".

### Check it before you push

Read every line of the feature aloud, as if to a coach on the dock. Rewrite any line that you
wouldn't say to them, that needs a second read, or that uses a word they'd ask about. Then read the
step texts in the glue the same way, since they're the same words.

## The rules

### The feature describes the domain, not the project

The description under `Feature:` gives the context a reader needs to judge the rules: what the
area is, who uses it, and why the rules are what they are. It's not the place for:

- code: collection names, file paths, function names, query strings;
- the plan: issue numbers, PR links, steps of a migration, "turns these scenarios green";
- the test's mechanics: run IDs, how fixtures are seeded, what's cleaned up afterwards.

Those belong in the step definitions, a code comment, or the PR. A `#` comment in a feature is for
a maintainer reading the file, and the same rule applies: why a scenario exists, not how it runs.

### The feature covers the data model too

A feature isn't only about permissions. It also says what the domain holds and the rules that data
follows: "A sailor can have more than one parent and emergency contact", "Each sailor has one set
of medical information", "A product that runs a program can't be deleted". An admin can check these
on dev, since they hold for everyone. Write them first in the feature, before its permission rules,
because a reader needs the model to make sense of who can change it.

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
  the rule, stated as a fact: `Rule: A CRM Reader or CRM Writer can't see medical information without a Medical policy`.
- Each scenario illustrates one rule. Use `Example:` for it, since that's what it is.
- One When per scenario. Two Whens usually mean two behaviours, and so two scenarios. The exception
  is a rule about a sequence, like a sync run that's undone and then repeated.
- A Then checks the rule's outcome, observable to a user, not an internal state. "Make sure it
  can fail": a Then that holds whatever the system does specifies nothing.
- Aim for three to five steps. Write them in the third person ("they", "a parent"), not "I": "I"
  hides who the actor is and what they're allowed to do.

### Declarative steps: what, not how

Write the behaviour, not the clicks, requests, or queries that produce it. "When they look up a
sailor's parents", not "When they GET /items/contacts with filter[subject_id][_eq]". The step
definition holds the how, so a change to Directus or the UI changes the glue, never the feature.

Keep only the essential detail. A value appears in a scenario when changing it changes the outcome.
Incidental data (IDs, dates that don't matter, field lists) goes in the glue.

### Use the domain's names, and the right kind of name

- Name every actor by what it is in the domain, and keep kinds apart. A **policy** (CRM Reader),
  a **role** (Crew), a **person** with a program role (a Parent Coordinator), and a **service account**
  (the account the Clubspot sync signs in with) are different kinds of thing. Don't call them all "logins", and
  don't mix kinds in one Examples column.
- Use names the reader already knows. Introduce a new term in the description before a scenario
  uses it. A feature titled "What the engine's machine user can do" fails a reader who has never
  heard of "the engine".
- Say "a sailor's medical information", not `medical_profiles`. The glue maps the domain noun to
  the collection.

### Good names

- The feature's title names the area, in a few words: "The CRM", "The catalog", "Signing in".
- A rule's title states the rule. A scenario's title states the example's point, so the list of
  titles reads as a summary of the behaviour.
- Name the people in examples only when the name helps a reader tell them apart in one scenario.
  A role ("a parent", "another family's parent") usually reads better than a cast. Some
  sources favour named personas, but only ones the whole team already knows. A cast introduced in
  one feature's description is a fixture, not a persona.

### Scope: only real requirements, in the feature they belong to

- Each scenario must be a requirement of this feature's area. If you can't name who asked for it,
  question it.
- A property every domain shares, such as "MCP can do whatever the REST API can", isn't a rule of any
  one domain. Specify it once, in a feature about that property, or leave it to a unit test.
- A service's access belongs with that service's other rules, not in the feature of each domain
  whose data it uses. The Google sync seeing the catalog is a rule in `gsuite.feature`.
- Signing in has its own feature, `authentication.feature`. Roles and groups, which decide what
  someone can do once signed in, are in `authorization.feature`.
- A feature about a permission set covers every policy in that set. A CRM feature that only
  covers CRM Writer leaves out CRM Reader and the Medical policies, and hides how they relate.
- Rules that are part of one permission set live in one feature. The Community role's roster rules
  are part of the CRM's permissions, so they sit with the CRM's other rules.

## Background, Scenario Outline, and data tables

These remove repetition, and each can also hide intent. Use them when the reader still sees the
whole rule.

- **Background** holds Givens that every scenario in the feature, or every example in a `Rule:`,
  needs and that a reader can keep in mind: `Given a sailor signed up for a program running today`.
  Keep it to a few lines. Never put the scenarios' differences there, and never use it for setup
  the reader doesn't need to know about: that's a hook in the glue. If only some scenarios need a
  Given, it isn't background. A `Rule:` can have its own Background.
- **Scenario Outline** is for one rule shown on several examples that differ only in data, where
  each row is a case a reader cares about. Name the columns for what they hold (`policy`,
  `role`), never `login` or `value`. Don't use an outline to run every combination: an exhaustive
  matrix is a test, not a specification (see below). Keep the Examples short enough to read.
- **Data tables** suit a step that takes a list or a record:
  `Given a sailor with these parents:`. A table that lists API query strings is the how, written down.

## Permissions and access rules

Besides its data model, each feature says who can see and change what. Those rules follow the
rules above, plus these:

- **The actor is the grant, stated in the Given.** `Given a user with the CRM Reader policy`,
  `Given a user with the Crew role`, `Given the Clubspot sync's service account`. The glue creates that
  user and grants exactly that. A scenario about a combination says so:
  `Given a user with the CRM Writer policy and no Medical policy`.
- **One feature per domain**, covering every policy in its permission set. One `Rule:` per thing a
  policy allows or denies, stated as the business sees it:
  `Rule: A CRM Reader can see the CRM, but can't change it`.
- **Deny rules earn their place when they matter to the business.** "Crew can't see medical
  information" is a rule someone would ask about. "Crew can't delete the syncs' run logs" usually
  isn't.
- **Show each rule on its key examples**, the cases a reader would ask about. When the rule
  must hold for a whole set, name the set in the step
  (`Then they can see the CRM`) and let the glue walk it.
- **Field-level and query-level rules** read as the business rule they protect:
  `Rule: A family can't find out a hidden contact detail by filtering or searching`, with examples like
  "filtering by an email's first letters". The glue holds the query strings.
- **Service accounts** get rules in the feature of the domain their service works on, such as
  the Clubspot sync's in `clubspot.feature`, not a row in a policy's Examples.

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
- Write steps as a domain API: `a user with the {policy} policy`, `they can see {records}`, each
  with one meaning everywhere.
- Name parameters for what they hold. A bare `{string}` says nothing about what fills it. Define a
  parameter type with `parameter(name, names)` in `test/features/steps/index.ts`, which accepts
  only the names the features use, so the text needs no quotes and an unknown name fails to match.
- Step texts are feature text, so they follow "Plain language" too.
- A step's definition must not depend on which scenario runs it, beyond the state its Givens set.
- Keep the glue thin: a step calls domain helpers (`as(user)`, `newRow(record)`), and the helpers
  call Directus. The helpers are shared; the steps are just phrases bound to them.

## This repo's tooling

The integration tests run with `@amiceli/vitest-cucumber` 7.0.0, through `mise run integration`
against dev. They never run in `mise run ci`.

- It parses `Feature:` descriptions, `Background:`, `Rule:` with its own `Background:`, `Example:`
  and `Scenario:`, `Scenario Outline:` with `Examples:`, tags, data tables, and doc strings.
- A description line that starts with a step keyword, such as "When it finds", is parsed as a
  step, and the run fails with `MissingSteppableError`. Reflow the line, or reword it.
- The test file must name every scenario in the feature, or the run fails. Scenarios under a
  `Rule:` go inside `Rule(name, ({ RuleBackground, RuleScenario, RuleScenarioOutline }) => ...)`.
  `defineSteps` at the feature level covers rule scenarios too.
- Its built-in parameter types are `{string}`, `{int}`, `{number}`, `{word}`, `{list}`,
  `{boolean}`, `{date}`, `{char}`, and `{any}`. `defineParameterExpression` adds one of your own,
  which `parameter()` wraps.
- A keyword-free step matches in a Scenario but not in a Scenario Outline, so this repo's `Step`
  helper registers each text under Given, When, Then, and And.
- A feature tagged `@licensed` needs a licensed Directus. Check how its test file skips it before
  adding one.

## Review checklist

Apply this to a feature or a PR touching `features/`. For each failure, quote the line and say
which rule it breaks.

- [ ] Read aloud, every line is something a club staffer would say and understand on first read.
      No odd verbs, jargon, internal names, or stacked clauses. Each action uses the same word
      everywhere.
- [ ] The feature covers its domain's data model as well as its permissions.
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
- [ ] Each term means one thing in every feature, and each set is defined in the feature that uses
      it. No rule contradicts another rule, its own examples, or another feature.
- [ ] Every scenario is a requirement of this feature's area. Nothing generic, nothing that belongs
      to another service or domain. A permission set's feature covers all its policies.
- [ ] Background holds only what every scenario needs and a reader can keep in mind.
- [ ] Each Scenario Outline is one rule over a few meaningful cases, with columns named for what
      they hold. No exhaustive matrices.
- [ ] Rules a reader wouldn't ask about are unit tests instead.
- [ ] Step texts name what each parameter is, and reuse the existing vocabulary.
