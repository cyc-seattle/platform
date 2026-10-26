# The backend stack

`stacks/backend` runs Directus per environment, at `https://directus.<domain>`, on the environment's
Cloud SQL database `directus`. It came from isthmia's `crm` project with its resource names unchanged,
and its state moved over with `pulumi state move` (cyc-seattle/workplace#6). It holds:

- Directus, as a `WebService`, with the Community query guard mounted as a hook extension
- the schema apply, from every `schemas/<domain>.yaml` merged into one snapshot
- the roles, policies, and permission rules, including the Community policies and the query guard,
  which cyc-seattle/workplace#6 steps 15 to 19 remove
- the admins' accounts, and the clubspot-sync and gsuite-sync machine users with their tokens
- Directus's OIDC client at Authentik
- the MCP settings

Dev deploys it on every PR. Prod still runs isthmia's `crm` until cyc-seattle/workplace#6 step 6.

## Outputs

| Output                     | Read by                                     |
| -------------------------- | ------------------------------------------- |
| `clubspotSyncToken`        | clubspot-sync, as its Directus token        |
| `gsuiteSyncToken`          | gsuite-sync, as its Directus token          |
| `directusOidcClientId`     | isthmia's `authentik`, to register Directus |
| `directusOidcClientSecret` | isthmia's `authentik`, to register Directus |

`backend` generates the OIDC client and Authentik registers it, so platform never reads isthmia's
outputs. Until Authentik reads these outputs (cyc-seattle/workplace#6 step 5), it holds a different
client, and signing in to Directus through Authentik fails. The built-in admin still signs in.

## Never destroy it

Directus's license activation is bound to its database and its `PUBLIC_URL`, and the key allows few
activations (cyc-seattle/isthmia#172). Never `pulumi destroy` `backend`, and never drop, recreate, or
rename its database or change its URL. Move its resources with `pulumi state move` instead. Ask the
maintainer before any change that could activate a new Directus.

## MCP

Directus 12.3.1 serves MCP at `/mcp`. It needs both:

- the environment: `MCP_ENABLED` (on by default) and, for OAuth sign-in, `MCP_OAUTH_ENABLED`
- the `directus_settings` row, which the Data Studio shows under Settings → AI: `mcp_enabled`,
  `mcp_oauth_enabled`, `mcp_oauth_cimd_enabled`, `mcp_oauth_dcr_enabled`, and `mcp_allow_deletes`

`backend` sets both. The `DirectusSettings` resource writes the settings row through the admin API.
`backend:mcp` turns MCP on, and it's off when unset. Dev sets it. Deletes and dynamic client
registration are always off.

A client registers by its metadata document (CIMD). Both the document and the redirects must be on
`claude.ai` or `claude.com`. Loopback redirects, which desktop clients use, are always allowed.
Custom-scheme redirects, which Directus allows for Cursor and Raycast by default, are not.

### What MCP can reach

MCP adds no access. Its tools act as the signed-in user:

- The items tool reads and writes through Directus's `ItemsService`, with the user's own
  permissions.
- Tools that change the schema, flows, or operations are hidden from anyone who isn't an admin.

Directus 12 has **no per-policy or per-role switch for MCP.** Every signed-in user can use it:

- through OAuth, since the consent page needs only a Directus session, which every role gets when it
  signs in through Authentik
- with a session cookie or a static token, whatever their role

So MCP can't keep Community users out. It stays off in prod until cyc-seattle/workplace#6 step 19
removes the Community item permissions.

### The query guard

The guard (cyc-seattle/isthmia#235) is a filter on `items.query`. The items tool's reads call
`ItemsService.readByQuery`, which emits `items.query` for every read, including the reads after a
create or an update. So the guard checks an MCP tool call's filter, sort, group, aggregate, and
`deep` exactly as it checks a REST query.
