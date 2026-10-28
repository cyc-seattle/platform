# Sources

What the skill's rules rest on. Where a book couldn't be read, the entry says what was read in its
place.

## Cucumber's docs and blog

- [Gherkin reference](https://cucumber.io/docs/gherkin/reference/). `Rule` represents "one
  business rule that should be implemented", illustrated by its scenarios. Keep `Background`
  "short", and don't use it "to set up complicated states, unless that state is actually something
  the client needs to know". A Then verifies "an outcome that is observable for the user (or
  external system)". Implementation details belong in the step definitions. Use 3 to 5 steps per
  example.
- [Writing better Gherkin](https://cucumber.io/docs/bdd/better-gherkin/). Prefer declarative steps.
  The test: "Will this wording need to change if the implementation does?"
- [Anti-patterns](https://cucumber.io/docs/guides/anti-patterns/). Organise step definitions by
  domain concept, not by feature. Avoid conjunction steps.
- [BDD](https://cucumber.io/docs/bdd/), [Discovery workshop](https://cucumber.io/docs/bdd/discovery-workshop),
  [Myths](https://cucumber.io/docs/bdd/myths), [Example Mapping](https://cucumber.io/docs/bdd/example-mapping)
  and [its introduction](https://cucumber.io/blog/bdd/example-mapping-introduction/). Formulation
  establishes "a shared language". A map has a story, its rules, examples and questions, and "one
  rule with many examples" means the rule is too complex.
- Aslak Hellesøy, ["The world's most misunderstood collaboration tool"](https://cucumber.io/blog/collaboration/the-worlds-most-misunderstood-collaboration-tool/).
  Cucumber is not a testing tool. A testing-led use makes scenarios imperative, brittle, and slow.

## Seb Rose and Gáspár Nagy

The BDD Books (_Discovery_, _Formulation_) themselves weren't available. These are the authors' own
posts and slides.

- Seb Rose, ["Keep your scenarios BRIEF"](https://cucumber.io/blog/bdd/keep-your-scenarios-brief):
  Business language, Real data, Intention revealing, Essential, Focused (one rule per scenario),
  Brief (five lines or fewer). Scenarios "should be thought of as documentation, rather than tests."
- Seb Rose, ["Gherkin Rules"](https://www.cucumber.io/blog/bdd/gherkin-rules): each example
  illustrates "one (and only one) rule". "Without its examples, a rule may be ambiguous. Without a
  rule, an example lacks context."
- Seb Rose, ["Introduction to Formulation"](https://cucumber.io/blog/bdd/introduction-to-formulation):
  state context in "a single, intention revealing statement", and leave its setup to the automation.
- Seb Rose, ["Writing better BDD scenarios"](https://accu.org/conf-docs/PDFs_2022/seb_rose_WritingBetterBDDScenarios-ACCU2022.pdf)
  (ACCU 2022): one rule per scenario, a single When, what not how, omit the obvious, make sure it
  can fail.
- Gáspár Nagy, ["Tree in the Forest: Managing Details in BDD Scenarios"](https://agilealliance.org/wp-content/uploads/2024/01/Nagy-G-TreeInTheForest-.pdf)
  (Agile 2024): essential details are those that influence the Then, or matter to the rule. Push
  the rest (entity properties, prerequisites, technical details, workflow steps) into the
  automation.

## Matt Wynne and Aslak Hellesøy, _The Cucumber Book_

Not read. Summaries quote its chapter on expressive scenarios: "make readability your main goal",
and its contrast of an imperative login scenario with a declarative one
([itsadeliverything.com](https://itsadeliverything.com/declarative-vs-imperative-gherkin-scenarios-for-cucumber)).

## Gojko Adzic

_Specification by Example_ and _Bridging the Communication Gap_ weren't read. These are his own posts
on the same ideas.

- ["Anatomy of a good acceptance test"](https://gojko.net/2010/06/16/anatomy-of-a-good-acceptance-test/):
  self-explanatory, focused, "a specification, not a script", in domain language, "about business
  functionality, not about software design".
- ["A fresh perspective on the specification/script problem"](https://gojko.net/2011/05/10/a-fresh-perspective-on-the-specificationscript-problem/).
- ["Focus on key examples"](https://gojko.net/2014/05/05/focus-on-key-examples/): a ton of
  scenarios is "a sure way to destroy a good user story". Show "only the important differences
  between examples", and "don't aim to replace testing fully with examples".
- ["Let's change the tune"](https://gojko.net/2010/08/04/lets-change-the-tune/): key examples,
  distilling the specification, living documentation.

## John Ferguson Smart, _BDD in Action_

Not read. [InfoQ's review and interview](https://www.infoq.com/articles/bdd-in-action) describes its
layers: business rules, business flow, and a technical layer that isolates "the more volatile,
low-level implementation details".

## Other articles

- Automation Panda, ["BDD 101: Writing Good Gherkin"](https://automationpanda.com/2017/01/30/bdd-101-writing-good-gherkin/):
  "Write Gherkin so that people who don't know the feature will understand it", and "One Scenario,
  One Behavior!"
- Automation Panda, ["Should Gherkin steps use first-person or third-person?"](https://automationpanda.com/2017/01/18/should-gherkin-steps-use-first-person-or-third-person/):
  "if 'I' am a user, what profile or privileges do I have?"
- Automation Panda, [Gherkin guidelines for AI](https://raw.githubusercontent.com/AutomationPanda/gherkin-guidelines-for-ai/main/gherkin-guidelines.md)
  (2026): use a Scenario Outline only for the same behaviour over inputs that change it, and treat
  a large table as a sign of drifting "into pure data-driven testing".
- Liz Keogh, ["Step away from the tools"](https://lizkeogh.com/2011/03/04/step-away-from-the-tools/)
  and ["Behavior-Driven Development – Shallow and Deep"](https://lizkeogh.com/2013/07/01/behavior-driven-development-shallow-and-deep/):
  "BDD isn't about testing; it's about examples of behaviour". Few end-to-end scenarios, many unit
  tests.
- Dan North, ["Introducing BDD"](https://dannorth.net/blog/introducing-bdd/).
- Jenny Martin, ["Data personas"](https://jennyjmar.com/2016/04/15/data-personas/).

## Access rules

No source above speaks to permission rules directly. The skill's guidance on them combines these:
name the actor's role or grant explicitly (Automation Panda on first person), one rule per scenario
(Rose), key examples rather than the full matrix (Adzic, Keogh, Example Mapping's "one rule with
many examples"), and an observable Then with the status code pushed into the glue (the Gherkin
reference, Nagy).

## Where they disagree

- **Background.** The Gherkin reference allows a short one of state the reader needs. Nagy pushes
  implicit context into the automation, and calls the choice a team decision. The skill takes the
  reference's line: a short Background the reader can keep in mind, nothing hidden.
- **Scenario Outline.** Older Automation Panda advice uses outlines freely. Adzic and the newer
  guidelines argue for a few key examples. The skill keeps outlines to a few meaningful rows.
- **Step count.** Cucumber says 3 to 5, Rose five or fewer, Automation Panda fewer than 10.
- **Person and tense.** Automation Panda and Rose write in the third person. _The Cucumber Book_
  and North's story template use "I". Rose writes Givens in the past tense, and Automation Panda
  writes every step in the present.
- **Personas or roles.** Cucumber's better-Gherkin page and Nagy favour named personas.
  Automation Panda's role-parameter steps stay reusable. This repo's review rejected a cast of
  characters set out in prose, so the skill prefers roles and grants.
- **Imperative steps.** Cucumber's docs allow them in some contexts. Most other sources reject them.
- **`Rule:`.** Rose treats it as central. Automation Panda's guidelines leave it out.
