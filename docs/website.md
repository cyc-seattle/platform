# The public website's content

The public website, cyccommunitysailing.org, is a static site in cyc-seattle/csc-website, built from
Directus (cyc-seattle/platform#150). Staff don't edit it. Coding agents change its content through
Directus's API and MCP, as an admin, so every text field is Markdown.

## The collections

`schemas/website.yaml` holds them, in the Data Studio's Website folder:

| Collection                                    | Holds                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `website_settings`                            | One row: the menu, the footer's contact details and social links, the logo, and an announcement banner |
| `website_pages`, `website_page_sections`      | The fixed pages, by slug, and the blocks below a page's body                                           |
| `website_categories`                          | Program categories, with their status, and sorted lists of programs, FAQ topics, crew, and photos      |
| `website_programs`                            | Program pages. Hidden ones have no page. Each can link to programs in the catalog                      |
| `website_faq_topics`, `website_faqs`          | Sets of questions, one question per row                                                                |
| `website_crew_sections`                       | The lists on Our Crew, each a sorted list of Crew's positions                                          |
| `website_policies`, `website_policy_versions` | Policies and their dated versions. The site shows the latest version that has taken effect             |
| `website_sponsor_levels`, `website_sponsors`  | Sponsorship levels, in cents, and sponsors                                                             |

The rest are the join tables behind the sorted lists. Pictures are files in the Website folder, which
the `cyc0007` migration makes with a fixed ID. Directus keeps files in the environment's Cloud
Storage bucket ([backend.md](backend.md)).

The site's crew come from Crew ([crew-schema.md](crew-schema.md)). A list on Our Crew shows, for each
of its positions in order, the crew members in it today who are on the website, by name. A category's
Meet Our Crew shows the list it names. The build reads a crew member's bio, photo, and first and last
name, and shows the first name alone unless staff chose to show their full name
([crew-schema.md](crew-schema.md)). It reads nothing else about them in the CRM.

A program page links to the catalog programs it covers (`website_programs.catalog_programs`), and
shows what's on sale of them, from the catalog (cyc-seattle/platform#332): each offering that isn't
archived, with its dates, price, capacity and confirmed count, its registration form, and, once the
form's Clubspot camp is public, whether that camp takes registrations. It reads each program's name and
ages too, and nothing else of the catalog: no registration, no offering's link to Clubspot, and no
program's money ([crm-schema.md](crm-schema.md#collections)).

The site's build reads them as the Website Build user ([access.md](access.md#the-website-build)).

## Publishing

The site is built ahead of time, so a content change shows only after a build. Prod's Directus starts
one itself: the `website-publish` hook (`stacks/backend/website-publish.cjs`) runs
cyc-seattle/csc-website's `publish` workflow after a row in a `website_*` collection, a crew member,
term, or position, or a file in the Website folder, is created, changed, sorted, or deleted. Of what's
on sale, it starts one when a program, offering, registration form, or Clubspot camp comes or goes, or
when a field the site reads changes, or the field that decides whether the site sees the row:
`archived_at` or the camp's `public`. A camp's sync bookkeeping, such as `synced_through`, publishes
nothing (`WEBSITE_CATALOG_READS` in `stacks/backend/policies.ts`). It waits until edits have stopped for 30
seconds, and no more than 5 minutes, so a burst of edits is one build. The workflow's nightly run
publishes anything a failed start missed, and a term that starts or ends that day.

The hook signs in to GitHub as a GitHub App installed only on csc-website, which can only start that
repo's workflows ([manual-setup.md](manual-setup.md#6-directus-directusdomain)).

## Loading the proof of concept

The proof of concept copied Wix's content into JSON and pictures. `mise run load-website` loads it
into a Directus, by hand. No deploy runs it.

```sh
DIRECTUS_URL=https://directus.<domain> DIRECTUS_TOKEN=<an admin's static token> \
  mise run load-website -- <path to the proof of concept>
```

It asks you to type the Directus's host before it writes. Each row's ID comes from what the row is,
and a picture is uploaded only if the Website folder has no file of its name, so a second run adds
nothing. A picture an earlier run uploaded with no type, which Directus serves as
`application/octet-stream`, is uploaded again over itself, keeping its ID.

It also puts every row and list back as the proof of concept has them, so after agents start
editing the content, running it again undoes their edits.
