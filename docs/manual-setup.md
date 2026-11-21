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

## 3. Who merges and approves prod deploys

`bootstrap` creates two teams empty, and their members are added by hand (#212, #280):

- `maintainers` merge to `main` and approve prod deploys. With no member, nothing merges and no
  deploy is approved.
- `contributors` push branches and open PRs, but can't merge. Other org members only read.

```sh
gh api -X PUT orgs/cyc-seattle/teams/<maintainers or contributors>/memberships/<github-login> -f role=member
```

- [x] The current maintainer is a member of `maintainers`.

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
(`stacks/backend/prod-state.ts` and `stacks/authentik/prod-secrets.ts`), so they're listed for completeness.

| Secret ID                           | Used by       | Source of the value                                                                                    |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `clubspot-username`                 | clubspot-sync | TheClubSpot login email                                                                                |
| `clubspot-password`                 | clubspot-sync | TheClubSpot login password                                                                             |
| `directus-license-key`              | Directus      | The Open Innovation Grant's license key (§6). Required for the Community and Team roles' rules         |
| `directus-key`                      | Directus      | **Pulumi-generated.**                                                                                  |
| `directus-secret`                   | Directus      | **Pulumi-generated.**                                                                                  |
| `directus-db-password`              | Directus      | **Pulumi-generated**, and set on the `directus` Cloud SQL user too                                     |
| `directus-admin-bootstrap-password` | Directus      | **Pulumi-generated.** The built-in admin, which the `Directus*` resources sign in as                   |
| `directus-oidc-client-secret`       | Directus      | **Pulumi-generated** by Authentik before cyc-seattle/workplace#6. See [backend.md](backend.md#outputs) |
| `directus-community-role-id`        | nothing       | **Pulumi-generated**, from the Community role's ID. The cluster passes the ID to Directus directly     |
| `clubspot-sync-directus-token`      | clubspot-sync | **Pulumi-generated.** Its machine user's Directus token                                                |
| `gsuite-sync-directus-token`        | gsuite-sync   | **Pulumi-generated.** Its machine user's Directus token                                                |
| `csc-website-directus-token`        | csc-website   | **Pulumi-generated.** The website build's Directus token, which cyc-seattle/csc-website's build reads  |
| `csc-website-publish-key`           | Directus      | The private key of the GitHub App that starts the website's publish workflow (§6)                      |
| `google-oauth-client-id`            | Authentik     | The Google OAuth client's ID (§8)                                                                      |
| `google-oauth-client-secret`        | Authentik     | The Google OAuth client's secret (§8)                                                                  |
| `authentik-secret-key`              | Authentik     | **Pulumi-generated.**                                                                                  |
| `authentik-db-password`             | Authentik     | **Pulumi-generated**, and set on the `authentik` Cloud SQL user too                                    |
| `authentik-bootstrap-token`         | Authentik     | **Pulumi-generated.** akadmin's API token, used only to create the `pulumi` service account and token  |
| `authentik-api-token`               | Authentik     | **Pulumi-generated.** The `pulumi` service account's token, which `authentik` signs in with            |
| `authentik-bootstrap-password`      | Authentik     | **Pulumi-generated.** akadmin's break-glass login (§8)                                                 |
| `inbox-app-key`                     | FreeScout     | **Pulumi-generated.** Encrypts each mailbox's Google sign-in, so a restore needs it (§10)              |
| `inbox-admin-password`              | FreeScout     | **Pulumi-generated.** The break-glass admin, for when Authentik is down (§10)                          |
| `inbox-oauth-licence`               | nobody        | The OAuth & Social Login module's licence key, kept for a rebuild (§10)                                |
| `inbox-api-licence`                 | nobody        | The API & Webhooks module's licence key, kept for a rebuild (§10)                                      |

Dev reads only `dev-directus-license-key`, set by hand to the same grant key, and the
`dev-db-<name>-password` and `dev-csc-website-directus-token` secrets that the `infra` stack
creates. The integration tests read `dev-inbox-api-key` (§10). Its fakes take the place of the
Clubspot and Google credentials, and it has no Google sign-in.

## 6. Directus (`directus.<domain>`)

[backend.md](backend.md) describes what the `backend` stack deploys. Directus authenticates through
its own `authentik` OIDC provider and enforces roles itself, with no forward-auth gate in front. The
built-in admin (`directus-admin-bootstrap-password`, §5) is the break-glass login if Authentik is
down.

- [ ] Create a `clubspot_promoted_fields` row with `target_field: school` and the Clubspot labels to match
      (see [syncs.md](syncs.md#clubspot-sync)).
- [ ] Set `directus-license-key` (§5), or `dev-directus-license-key` in dev, before Directus first
      boots, and renew the grant each year.
- [ ] Make the GitHub App that publishes the website when its content changes
      ([website.md](website.md#publishing)), in prod only:
  1. In the `cyc-seattle` organization's settings, under **Developer settings → GitHub Apps**, create
     an App. Turn its webhook off, give it one repository permission, **Actions: Read and write**,
     and let it be installed only on this account.
  2. Install it on **Only select repositories**: `csc-website`.
  3. Generate a private key, and set the downloaded file as `csc-website-publish-key` (§5):
     `gcloud secrets versions add csc-website-publish-key --data-file=<the .pem file> --project cyc-admin-scripts`.
     Then delete the file.
  4. Set `backend:websitePublishAppId` in `stacks/backend/Pulumi.prod.yaml` to the App's ID, and
     deploy. Until then, nothing reads the key and Directus publishes nothing.

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

## 8. Authentik (`login.<domain>`)

The `authentik` stack deploys Authentik and configures its flows, sources, and applications. It
sends sign-in mail through the relay in §4.

- [x] In the Google Cloud console, an OAuth consent screen set to **External**, so families'
      personal Google accounts can sign in.
- [x] An OAuth 2.0 Client ID, type **Web application**, with the redirect URI
      `https://login.cycsail.team/source/oauth/callback/google/`. Its ID and secret go in
      `google-oauth-client-id` and `google-oauth-client-secret` (§5).
- [ ] Remove the retired redirect URIs `https://cycsail.team/oauth2/callback` and
      `https://directus.cycsail.team/auth/login/google/callback` from that client.

If Authentik's own sign-in is ever unreachable, sign in as `akadmin` with the password in
`authentik-bootstrap-password`:

```sh
gcloud secrets versions access latest --secret authentik-bootstrap-password --project cyc-admin-scripts
```

## 9. Delegate `cyccommunitysailing.org` to Cloud DNS

The website's domain is registered at Porkbun, which also serves its records. The `infra` stack's
external zone holds a copy of them (`stacks/infra/external-records.ts`), so switching name servers
changes no answer (#150). Mail is what breaks if a record is missing, so do this off-season, and not
during a newsletter send.

1. [ ] Apply prod `infra` with the records, then compare the zone with Porkbun. It queries both for
       every record name the zone declares and the common ones it might lack, and exits 1 on any
       difference. A record only Porkbun has goes into `external-records.ts` before you go on.

   ```sh
   mise run compare-dns
   ```

2. [ ] In Porkbun's DNS records for the domain, lower each record's TTL to 300 seconds, then wait
       out the old TTL (10 minutes). A wrong answer after the switch is then cached for only 5 minutes.
       The script doesn't compare TTLs.
3. [ ] Check DNSSEC is off at Porkbun: `host -t DS cyccommunitysailing.org` finds no record. Porkbun
       would sign with keys Cloud DNS doesn't hold, so a DS record left in place breaks the domain.
4. [ ] Run `mise run compare-dns` once more, then, at Porkbun, replace the domain's authoritative
       name servers with the zone's:

   ```sh
   pulumi stack output nameServers --cwd stacks/infra --stack prod
   ```

5. [ ] Check the switch. The `.org` registry serves the new name servers within minutes, but
       resolvers may keep the old ones for up to 2 days (their TTL is 86400). Both answer the same.

   - `host -t NS cyccommunitysailing.org` lists `ns-cloud-*.googledomains.com`.
   - `mise run compare-dns` now compares the zone with itself, so also ask public resolvers:
     `host -t MX cyccommunitysailing.org 8.8.8.8`, and the same at `1.1.1.1`.
   - Mail from outside reaches a Workspace inbox, and mail sent out shows `spf=pass` and
     `dmarc=pass` in its headers at the recipient.
   - The website loads at the bare domain and at `www`.

6. [ ] Leave Porkbun's records in place for at least 2 days. To roll back, put Porkbun's name servers
       back.
7. [ ] Add Google's DKIM: generate the key in the Admin console under **Apps → Google Workspace →
       Gmail → Authenticate email**, add its `google._domainkey` TXT record to `external-records.ts`,
       deploy, then press **Start authentication**.

From then on, the domain's records change only in `external-records.ts`, never at Porkbun.

## 10. The shared inbox (`inbox.<domain>`)

[inbox.md](inbox.md) describes what the `inbox` stack deploys. These steps come in order.

1. [ ] **Create the stacks.** Each Pulumi stack must exist before the first deploy, which never
       creates one. A deployer runs, from the repo root:

   ```sh
   PULUMI_STACK=dev mise exec -- pulumi stack init dev --cwd stacks/inbox --secrets-provider gcpkms://projects/cyc-admin-scripts/locations/us-west1/keyRings/pulumi/cryptoKeys/state-dev
   mise exec -- pulumi stack init prod --cwd stacks/inbox --secrets-provider gcpkms://projects/cyc-admin-scripts/locations/us-west1/keyRings/pulumi/cryptoKeys/state-prod
   ```

   Each adds an `encryptedkey` line to its `Pulumi.<stack>.yaml`. Commit both. Apply prod `infra`
   from the branch too, since it makes dev's `inbox` database.

2. [ ] **Make the mailbox user**, as a Workspace super-admin, in the Admin console:
   1. Billing → Subscriptions: check it's Google Workspace for Nonprofits, so a new user is free.
   2. Directory → Users → Add new user: `inbox@cyccommunitysailing.org`, named Inbox FreeScout. Let
      Google make the password. Nobody signs in to it but to connect FreeScout in step 6.
   3. Directory → Groups → info@ → Members → Add members: `inbox@`, delivery "Each email".
   4. In the info@ group's settings, check that anyone can post and that moderation holds nothing.
      Held mail never reaches inbox@.
   5. Apps → Google Workspace → Gmail → End User Access → IMAP access: on, for inbox@'s
      organizational unit.

3. [ ] **Make the Google sign-in for the mailbox**, in the Cloud console for `cyc-admin-scripts`:
   1. APIs & Services → Library → Gmail API → Enable.
   2. Credentials → Create credentials → OAuth client ID → Web application, named
      `FreeScout inbox`, with the authorized redirect URI `https://inbox.cycsail.team/mailbox/oauth`.
   3. The consent screen is External, for families' Google sign-in (§8), so Google treats the mail
      scope as unverified. In the Admin console, Security → Access and data control → API controls →
      Manage third-party app access → Configure new app: paste the client ID, and choose Trusted.
   4. Keep the client ID and secret for step 6. FreeScout keeps them, encrypted, in its database.

4. [ ] **Buy the modules**, at freescout.net, one licence each for prod and dev, since a licence
       covers one instance: OAuth & Social Login ($8) and API & Webhooks ($12.99). Keep prod's keys
       for a rebuild:

   ```sh
   printf %s '<key>' | gcloud secrets versions add inbox-oauth-licence --data-file=- --project cyc-admin-scripts
   printf %s '<key>' | gcloud secrets versions add inbox-api-licence --data-file=- --project cyc-admin-scripts
   ```

5. [ ] **Install the modules**, once each environment is deployed. Sign in at `/login` as the
       break-glass admin, `inbox:adminEmail`, with its password:
       `gcloud secrets versions access latest --secret inbox-admin-password --project cyc-admin-scripts`.
       Dev's is the `inbox` stack's `adminPassword` output. Then:
   1. Manage → Modules: paste each licence key, then Install, then Activate.
   2. Manage → Settings → OAuth: add a provider named Sign in, with Authentik's URLs
      (`https://login.<domain>/application/o/authorize/`, `.../token/`, and `.../userinfo/`), the
      scopes `openid email profile`, and the `inbox` stack's `oidcClientId` and `oidcClientSecret`
      outputs (`pulumi stack output --show-secrets --cwd stacks/inbox`). Turn on creating users
      automatically, and Force OAuth Login.
   3. Once you know the module's callback path, tighten `inboxRedirectUriPattern` in
      `stacks/authentik/naming.ts` to it.
   4. In dev only: Manage → API & Webhooks, copy the API key into `dev-inbox-api-key`, and set
      `inbox:apiModule: true` in `stacks/inbox/Pulumi.dev.yaml`, so the integration tests run the
      scenarios that need it:

      ```sh
      printf %s '<key>' | gcloud secrets versions add dev-inbox-api-key --data-file=- --project cyc-admin-scripts
      ```

6. [ ] **Connect info@**, in prod's FreeScout: Manage → Mailboxes → New mailbox, with the email
       `info@cyccommunitysailing.org` and the name CYC Community Sailing Center. Then, in its
       Connection Settings:
   - Fetching Emails: IMAP, `imap.gmail.com`, port 993, SSL, the client ID from step 3 as the
     username and its secret as the password, folder INBOX. Reset inbox@'s password in the Admin
     console, sign in to Google as inbox@ in a private window, then click Connect, and allow
     FreeScout. Connecting while signed in as anyone else fails with "Invalid credentials". Sign out
     after.
   - Sending Emails: SMTP, `smtp-relay.gmail.com`, port 587, TLS, with no username.

7. [ ] **Test it both ways**: email info@ from a personal address, check it arrives, reply from
       FreeScout, check the reply comes from info@ with `spf=pass` and `dmarc=pass` in its headers,
       answer it, and check the answer joins the conversation.

8. [ ] **Let people in**: add each person to the `Inbox` group in Authentik's admin, under
       Directory → Groups. They need to have signed in to something once, so Authentik knows them.
       After their first sign-in to FreeScout, put them on the mailbox under Manage → Mailboxes →
       info@ → Permissions.

9. [ ] **Cut over**, once volunteers have used FreeScout side by side with the group for the trial:
   1. Note the info@ group's members and settings, in case you need to put it back.
   2. Admin console → Directory → Groups → info@ → Delete group. Google frees the address once the
      group is gone, which can take a few minutes.
   3. Directory → Users → inbox@ → User information → Alternate email addresses (email aliases) →
      add `info`. Mail to info@ now lands in inbox@ directly.
   4. Email info@ again, and check it arrives in FreeScout and a reply still goes out from info@.

## When you add a new manual step

If you add infrastructure that needs an out-of-band action, add it here.
