# Manual setup steps

Most of the platform is code. A few steps can't be: they live in Google consoles or need a
super-admin, whose credentials the access policy keeps out of automation. This doc records each one,
so setting up a fresh environment doesn't rely on memory.

Legend: `[ ]` = to do for a new setup, `[x]` = done for the current production setup.

## 1. Project and organization (super-admin)

Done as a Workspace **super-admin** (`master@cyccommunitysailing.org`). Reserved to super-admins per
the access policy — not day-to-day deploy identities.

- [x] GCP project `cyc-admin-scripts` created under the org.
- [x] Org policy / project-root IAM as needed.
- [ ] Any Google API that must be enabled by hand (most are enabled in code via the `enableService`
      helper; enable by hand only if a chicken-and-egg case appears).

## 2. Deployer identity and access

Done as a Workspace **super-admin**, granting a human, not code, since these are IAM-policy grants
on the org's and project's break-glass access.

- [ ] `roles/resourcemanager.organizationAdmin` on the org, so the deployer can manage IAM without
      super-admin credentials.
- [ ] `roles/owner` on project `cyc-admin-scripts`, so `pulumi up` works.

```sh
gcloud organizations add-iam-policy-binding <ORG_ID> --member="user:<deployer-email>" --role="roles/resourcemanager.organizationAdmin" --condition=None
```

Google refuses `roles/owner` for an external principal over the API. Grant it in the
[IAM console](https://console.cloud.google.com/iam-admin/iam?project=cyc-admin-scripts) instead:
add the principal, role **Basic → Owner**, then have them accept the emailed invitation.

Then add the deployer to `bootstrap:humanDeployers` in `stacks/bootstrap/Pulumi.prod.yaml`, and
apply `bootstrap`. That grants the Pulumi state buckets and keys.

## 3. Who approves prod deploys

The `prod` environment of `isthmia` and `platform` needs an approval from the `maintainers` team,
which `bootstrap` creates empty (#212). Add each maintainer by hand, or nobody can approve a deploy:

```sh
gh api -X PUT orgs/cyc-seattle/teams/maintainers/memberships/<github-login> -f role=member
```

- [x] The current maintainer is a member.

## 4. The Workspace SMTP relay admits the cluster

Prod's pods send mail through `smtp-relay.gmail.com:587`, which admits senders by IP. The cluster's
Cloud NAT sends from one static address, the `infra` stack's `natAddress` output. As a Workspace
super-admin, add it in the Admin console under **Apps → Google Workspace → Gmail → Routing → SMTP
relay service**, to the allowed IP addresses of the relay's rule:

```sh
pulumi stack output natAddress --cwd stacks/infra --stack prod
```

- [x] The relay admits `natAddress`.

## 5. Secret values (Secret Manager)

Pods read their secrets from Kubernetes Secrets that the deploy writes. Secret Manager holds the
external credentials, set by hand: Pulumi declares only the container, and the value is added out of
band and never committed:

```sh
printf %s 'THE_VALUE' | gcloud secrets versions add SECRET_ID --data-file=- --project cyc-admin-scripts
```

The rest, marked below, are internal keys with no meaningful human choice. Pulumi generates them as
`random` resources. Prod's also keep the Secret Manager copies they had on the VM
(`stacks/backend/prod-state.ts`), so they're listed for completeness.

| Secret ID                           | Used by       | Source of the value                                                                                    |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `clubspot-username`                 | clubspot-sync | TheClubSpot login email                                                                                |
| `clubspot-password`                 | clubspot-sync | TheClubSpot login password                                                                             |
| `directus-license-key`              | Directus      | The Open Innovation Grant's license key (§6). Required for the Community and Guardian roles' rules     |
| `directus-key`                      | Directus      | **Pulumi-generated.**                                                                                  |
| `directus-secret`                   | Directus      | **Pulumi-generated.**                                                                                  |
| `directus-db-password`              | Directus      | **Pulumi-generated**, and set on the `directus` Cloud SQL user too                                     |
| `directus-admin-bootstrap-password` | Directus      | **Pulumi-generated.** The built-in admin, which the `Directus*` resources sign in as                   |
| `directus-oidc-client-secret`       | Directus      | **Pulumi-generated** by Authentik before cyc-seattle/workplace#6. See [backend.md](backend.md#outputs) |
| `directus-community-role-id`        | nothing       | **Pulumi-generated**, from the Community role's ID. The cluster passes the ID to Directus directly     |
| `clubspot-sync-directus-token`      | clubspot-sync | **Pulumi-generated.** Its machine user's Directus token                                                |
| `gsuite-sync-directus-token`        | gsuite-sync   | **Pulumi-generated.** Its machine user's Directus token                                                |

Dev reads only `dev-directus-license-key`, set by hand to the same grant key, and the
`dev-db-<name>-password` secrets that the `infra` stack creates. Its fakes take the place of the
Clubspot and Google credentials.

## 6. Directus (`directus.<domain>`)

[backend.md](backend.md) describes what the `backend` stack deploys. Directus authenticates through
its own `authentik` OIDC provider and enforces roles itself, with no forward-auth gate in front. The
built-in admin (`directus-admin-bootstrap-password`, §5) is the break-glass login if Authentik is
down.

- [ ] Create a `clubspot_promoted_fields` row with `target_field: school` and the Clubspot labels to match
      (see [syncs.md](syncs.md#clubspot-sync)).
- [ ] Set `directus-license-key` (§5), or `dev-directus-license-key` in dev, before Directus first
      boots, and renew the grant each year.

MCP needs no manual step: `backend` writes its settings row ([backend.md](backend.md#mcp)). Connect a
client with `claude mcp add --transport http directus https://directus.<domain>/mcp`, then authorize
in the browser.

> **License:** Directus 12's unlicensed Core tier refuses every permission with a relational filter
> (`403 custom_permission_rules_enabled is a restricted resource`), and the roles depend on them. CYC
> holds a license through Directus's [Open Innovation Grant](https://directus.com/oig): free for a
> nonprofit of its size, valid one year, and renewable. `stacks/backend/cluster.ts` passes it to
> Directus as `LICENSE_KEY`. [backend.md](backend.md#never-destroy-it) says what spends an activation.

## 7. Groups Administrator role for gsuite-sync

`gsuite-sync` writes group membership and settings as itself. It holds the Groups Administrator
role directly, rather than impersonating an admin through domain-wide delegation.

- [ ] As a Workspace super-admin, open Admin console → Account → Admin roles → **Groups Admin** →
      Assign service accounts, and add `gsuite-sync@cyc-admin-scripts.iam.gserviceaccount.com`.
- [ ] Before the first real run, confirm with `gsuite-sync --dry-run` against one throwaway group
      that the Groups Settings API also accepts this credential. Google's announcement of
      role-assignable service accounts covers the Directory API and says nothing about Groups
      Settings. If it 403s, drop the settings pass rather than adding delegation for it.

## When you add a new manual step

If you add infrastructure that needs an out-of-band action, add it here.
