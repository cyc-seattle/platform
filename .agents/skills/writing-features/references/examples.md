# Worked examples

Before-and-after pairs from this repo's features, and from review comments on
[cyc-seattle/platform#48](https://github.com/cyc-seattle/platform/pull/48), which split the access
features by domain. The "after" versions show the shape, not the final wording: settle the rules
with the people who own them.

## A description that explains the plan instead of the domain

Before (`catalog.feature` in #48):

```gherkin
Feature: Who can see and change the catalog
  The catalog is the `core` domain: products, accounts, qualifications and their covers, boat
  classes, and resource kinds. Code defines Catalog Reader and Catalog Writer, and an admin grants
  them through groups. Step 9 of https://github.com/cyc-seattle/workplace/issues/6 builds the
  catalog and its policies, and turns these scenarios green, except gsuite-sync's, which step 10
  does.

  Each login named for a policy is a Community user in a group that grants only that policy. The
  run's rows include a product in the catalog.
```

The review: "The comment of a feature should explain context to understand the requirements of the
feature. Not code, not the plan or issues or PRs."

After:

```gherkin
Feature: The catalog
  The catalog lists what the club sells and how it accounts for the money. A product is something
  the club sells year after year, such as the J-Pod Race Team, boat charters, or storage. Planners
  use the catalog to build plans. Only the few people who set prices and accounts can change it.
```

The `core` domain, the step numbers, and the run's rows go to the PR body or the glue.

## A Given that hides the situation

Before (`directus-roles.feature`, and every access feature in #48):

```gherkin
  Background:
    Given this run's users and rows on dev's Directus
```

The review: "The whole point of cucumber tests is to be readable and not hide information behind
vague statements like 'this run's users and rows in dev's Directus'. Givens should be readable by
humans without referring to the steps", for example "Given a user with policy X, Y, Z".

After: each example's Givens name the user's grant and the records the rule is about.

```gherkin
  Rule: A Catalog Reader can see the catalog, but can't change it

    Example: A Catalog Reader looks up a product
      Given a user with the Catalog Reader policy
      And a product in the catalog
      When they look up the product
      Then they see its revenue account
      But they can't change it
```

That the users and rows are fresh for each run, and are deleted afterwards, is the glue's business.

## A cast of characters in prose

Before (`community-rules.feature`):

```gherkin
  Marge Simpson signs in for Bart (13), who shares her email. Bart sails in both of Summer Session
  2's classes. He shares contacts for the Laser Race Team but not for Opti Green. Ned Flanders signs
  in for Todd (12), who sails Laser and hasn't answered the sharing question. ...

  Scenario: A guardian reads contacts only for teammates who opted in
    When "Marge" reads people
    Then they see the email of "Marge, Lenny, Kirk"
    And they see no email or phone for "Bart, Ned, Todd, Moe, Milhouse"
```

The review: "Don't write prose in a feature... actually implement it in the [...] features!" The
scenario depends on four paragraphs the reader must hold in mind, and doesn't say which facts in
them make Lenny's email visible and Todd's hidden.

After: the Givens carry just the facts this rule turns on.

```gherkin
  Rule: A family sees a teammate's contact details only if the teammate opted in to sharing

    Background:
      Given a parent whose child sails on a team

    Example: A teammate who opted in shows their email
      Given an adult teammate who opted in to sharing
      When they look at the roster
      Then they see the teammate's email

    Example: A teammate who hasn't answered shows only their name
      Given a teammate who hasn't answered the sharing question, and their parent
      When they look at the roster
      Then they see the teammate's name
      But not the email or phone of the teammate or the teammate's parent
```

## Actors of different kinds in one column

Before (`catalog.feature` in #48):

```gherkin
  Scenario Outline: The plan policies and the engine read the catalog, and change none of it
    Then "<login>" can read "the catalog"
    And "<login>" can't change "the catalog"

    Examples:
      | login       |
      | Plan Reader |
      | Plan Writer |
      | Engine      |
```

The review: "Plan Reader and Writer are not 'logins'. They are policies." And: "'Engine' is not the
same kind of thing as Plan Reader/Writer — it is not a policy but a service account. It does not
belong in the catalog permissions feature."

After: the column names the kind, and the service account goes to its own service's feature.

```gherkin
  Rule: Planners can see the catalog, but can't change it

    Scenario Outline: Each planning policy can see the catalog
      Given a user with the <policy> policy
      Then they can see the catalog
      But they can't change the catalog

      Examples:
        | policy      |
        | Plan Reader |
        | Plan Writer |
```

## A scenario that belongs to another feature

Before (`catalog.feature` in #48):

```gherkin
  Scenario: gsuite-sync reads products and their revenue accounts
    Then "gsuite-sync" can read "products"
    And "gsuite-sync" can read "accounts"
```

The review: "This does not belong in this feature." It's a rule about what gsuite-sync needs, so it
goes with gsuite-sync's other rules, where a reader of gsuite-sync looks for it.

## A generic property filed under one domain

Before (`planning.feature` in #48):

```gherkin
  Scenario: MCP reaches what the REST API does, and no more
    Then "Plan Writer" can create, read, update, and delete "the draft" over MCP
```

The review: "This is NOT a requirement... or if it is, it's a generic requirement for all domains,
not just 'planning'." Specify it once, for every domain, or not at all.

## A permission set's feature that covers one policy

Before (`crm.feature` in #48): `Feature: What the CRM Writer policy reaches`.

The review: "This should not just be 'CRM Writer'. There are 4 policies I can see: CRM Reader,
CRM Writer, Medical Reader and Writer." And on `community-rules.feature`: "this can be merged with
the CRM as it's part of the CRM's permission set."

After: one feature for the CRM's permission set, with a rule per thing its policies allow or deny.

```gherkin
Feature: Who can see and change the CRM
  The CRM is the club's list of people: sailors, their parents, and the coaches, volunteers, and
  staff who run programs. Each sailor's medical information is the most private information the
  club has, so staff need a separate permission to see it.

  Rule: A CRM Reader can see the CRM, but can't change it
  Rule: A CRM Writer can edit the CRM
  Rule: A CRM Reader or CRM Writer can't see medical information without a Medical policy
  Rule: A Medical Reader can see every sailor's medical information, but can't change it
  Rule: A family can see everyone on their child's team by name, whether or not they opted in to sharing
  Rule: A family can see a teammate's email and phone only if the teammate opted in to sharing
```

Each rule then gets an example or two, as above.

## A term the reader doesn't know

Before (`engine.feature` in #48): `Feature: What the engine's machine user can do`.

The review: "WTF is 'the engine'?" Name a thing the way the club does, and say what it is in the
description before any scenario uses it. Here the feature went away: the planning engine doesn't
sign in, so it has no permissions to specify.

## A parameter with no name

Before (`test/features/planning.test.ts` in #48):

```ts
"{string} can start a plan for a product, with a draft",
```

The review: "`{string}` is a terrible variable name, don't you think?" A named parameter type says
what fills it, and accepts only the names the features use:

```ts
parameter("policy", policyNames);
Step("a user with the {policy} policy", (_, policy: string) => setThey(actor({ policies: [policy] })));
Step("they start a plan for a product", () => notBuilt("11"));
```

## Wording that reads like AI slop

The review of the round after the restructure: the features had the right rules in the wrong words.

> "keeps the CRM" doesn't make sense. Use plain english like "A CRM Writer can edit the CRM".

> "and changes nothing" -> "but cannot change them"

> "Programs are the catalog's" is more AI-junk. "Programs belong to the Catalog domain". Don't be
> sloppy.

> You use "sees the" and "reads the"... in different places. Be consistent.

Before:

```gherkin
  Rule: A CRM Reader sees the CRM and Clubspot's records, and changes nothing
  Rule: A CRM Writer keeps the CRM
  Rule: Clubspot's records change in Clubspot, so a CRM Writer only links them to the CRM
  Rule: Programs are the catalog's, so the CRM policies read them and change none
  Rule: Crew read the rosters, and change nothing
  Rule: A family reads no one's address book
```

After:

```gherkin
  Rule: A CRM Reader can see the CRM, but can't change it
  Rule: A CRM Writer can edit the CRM
  Rule: A CRM Writer can link a class to its program, and a sailor to their person in the CRM
  Rule: Programs belong to the catalog, so a CRM Reader or CRM Writer can see them but can't change them
  Rule: Crew can see the rosters, but can't change them
  Rule: A family can't see anyone's other emails and phone numbers
```

The steps changed with them: "can see" everywhere "read" or "sees" was, and "a parent" for "a
guardian", since that's what staff say. "Parent" is defined once in the description, as anyone
listed as a sailor's parent or guardian.

## A feature about permissions only

The review: "Feature files should be about not only the permission rules, but also the domain
models." A feature now opens with the rules its data follows, which an admin checks on dev:

```gherkin
  Rule: A sailor can have more than one parent and emergency contact

    Example: A sailor with two parents and an emergency contact
      Given a sailor with two parents and an emergency contact
      When an admin looks up the sailor's parents and emergency contacts
      Then they see both parents and the emergency contact
```

## What reads well

`clubspot.feature`'s sync example shows the shape to keep: a short Given for each fact the outcome
depends on, one action, and Thens a staff member could check by hand.

```gherkin
    Example: A sailor's registration adds the sailor and their parent to the CRM
      Given a class running today in Clubspot
      And a sailor registered for it, with a parent
      When the Clubspot sync runs
      Then the CRM has the sailor as a person
      And the CRM has the sailor's parent as a person, listed as their parent
```

The Given says "in Clubspot", not "in the Clubspot fake". That the test uses a stand-in for
Clubspot is the glue's business.
