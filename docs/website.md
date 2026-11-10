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
| `website_profiles`                            | Crew bios, not linked to People, so a public bio can't show private fields                             |
| `website_policies`, `website_policy_versions` | Policies and their dated versions. The site shows the latest version that has taken effect             |
| `website_sponsor_levels`, `website_sponsors`  | Sponsorship levels, in cents, and sponsors                                                             |

The rest are the join tables behind the sorted lists. Pictures are files in the Website folder, which
the `cyc0007` migration makes with a fixed ID. Directus keeps files in the environment's Cloud
Storage bucket ([backend.md](backend.md)).

The site's build reads them as the Website Build user ([access.md](access.md#the-website-build)).

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
