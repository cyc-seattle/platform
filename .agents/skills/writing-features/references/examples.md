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
Feature: Who can see and change the catalog
  The catalog lists what the club offers and how it accounts for it: its products, the revenue
  accounts they post to, the qualifications a sailor can hold, the boat classes, and the kinds of
  resource a program uses. Planners read it to build plans. Only the few people who set prices
  and accounts may change it.
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
  Rule: A Catalog Reader reads the catalog, and changes nothing

    Example: A planner looks up a product's price
      Given a user with the Catalog Reader policy
      And a product in the catalog
      When they look up the product
      Then they see its price and revenue account
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
      Given a guardian whose child sails on a team in a camp running now

    Example: A teammate who opted in shows their email
      Given a teammate on the same team who opted in to sharing
      When the guardian views the team's roster
      Then they see the teammate's email

    Example: A teammate who hasn't answered shows only their name
      Given a teammate on the same team who hasn't answered the sharing question
      When the guardian views the team's roster
      Then they see the teammate's name
      But not their email or phone
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
  Rule: Whoever plans reads the catalog, and changes nothing in it

    Scenario Outline: Each plan policy reads the catalog
      Given a user with the <policy> policy
      When they look up a product
      Then they see it
      But they can't change it

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
  The CRM holds the club's people: sailors, their families, and the volunteers who run programs.
  Medical records are the most sensitive data the club keeps, so they're granted apart from the
  rest of the CRM. Families see their own team through the Community role.

  Rule: A CRM Reader sees people and their contacts, and changes nothing
  Rule: A CRM Writer keeps people and their contacts
  Rule: Medical records need a Medical policy, even for a CRM Writer
  Rule: A Medical Reader reads medical records, and a Medical Writer also changes them
  Rule: A family sees everyone on their child's team, by name
  Rule: A family sees a teammate's contact details only if the teammate opted in to sharing
```

Each rule then gets an example or two, as above.

## A term the reader doesn't know

Before (`engine.feature` in #48): `Feature: What the engine's machine user can do`.

The review: "WTF is 'the engine'?" Name it as the domain does ("the planning engine, which builds a
season's schedule from its plans"), and define it in the description before any scenario uses it.

## A parameter with no name

Before (`test/features/planning.test.ts` in #48):

```ts
"{string} can start a plan for a product, with a draft",
```

The review: "`{string}` is a terrible variable name, don't you think?" After, a named parameter type
says what fills it, and only a policy's name matches:

```ts
parameter("policy", policyNames);

Step("a user with the {policy} policy", (_, policy: string) => setThey(actor({ policies: [policy] })));
Step("they can start a plan for a product, with a draft", async () => { ... });
```

## What already reads well

`gsuite-sync.feature` and `clubspot-sync.feature` show the shape to keep: a short Given per fact the
outcome depends on, one action, and Thens a staff member could check by hand.

```gherkin
  Scenario: A participant's registration becomes a person with a guardian
    Given a camp running today in the Clubspot fake
    And a participant registered in it, with a guardian
    When clubspot-sync runs
    Then the CRM has the participant as a person
    And the person's guardian is a person, linked as their guardian
```

Their descriptions still explain the test's mechanics (seeding through Parse's REST API, the run's
ID, the service proxy). That belongs in the glue.
