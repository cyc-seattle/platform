# The shared inbox

Crew and staff answer info@ together in [FreeScout](https://freescout.net), at `https://inbox.<domain>`
(cyc-seattle/platform#182). `stacks/inbox` deploys it per environment. `features/inbox.feature`
gives the rules.

## How mail flows

- **In:** info@ is a Google group, and FreeScout reads only a real mailbox. The Workspace user
  `inbox@cyccommunitysailing.org` is a member of the group, and FreeScout reads its mail over IMAP
  every minute, signing in to Google with OAuth. The MX records don't change.
- **Out:** replies go through the Workspace SMTP relay, `smtp-relay.gmail.com:587`, which admits
  the cluster's NAT address ([manual-setup.md](manual-setup.md#4-the-workspace-smtp-relay-admits-the-cluster)).
  They're from info@, and threaded with what the sender wrote.
- FreeScout fetches only unread mail, and marks it read. Nobody should open inbox@ in Gmail, or
  FreeScout skips what they read.

## What `stacks/inbox` holds

- FreeScout, as a `WebService`, from our own image (`stacks/inbox/image`): PHP-FPM, nginx, and
  FreeScout's scheduler in one container, as www-data, on a read-only root filesystem. Dev builds the
  image, and prod runs the digest dev built, as for the syncs.
- Its database, `inbox`, on the environment's Cloud SQL instance. FreeScout supports PostgreSQL,
  though MySQL is its first choice, so try every module on dev before prod.
- Its disk, the PersistentVolumeClaim `inbox-data` (10 GiB, `standard-rwo`), mounted at `/data`: attachments,
  sessions, installed modules, and the `.env` FreeScout edits. It's protected, since the storage
  class deletes the disk with the claim. The Deployment stops the old pod before it starts a new one,
  because the disk attaches to one node at a time.
- The app key, which encrypts each mailbox's Google sign-in in the database, and the break-glass
  admin's password. Prod keeps both in Secret Manager too: `inbox-app-key` and `inbox-admin-password`.
- FreeScout's OIDC client, as outputs that `authentik` registers.
- In dev, GreenMail in place of Gmail, with a test mailbox, `info@example.test`, and a volunteer on
  it, which the image makes for the integration tests.

The image sets FreeScout's own mail (notifications and invitations) to the relay on every start
(`stacks/inbox/image/configure.php`). Each mailbox's connection is set in FreeScout's admin, since it
signs in to Google as its own user.

FreeScout refuses a mail server at a private address. Dev's env lists GreenMail's name and ClusterIP
in `APP_REMOTE_HOST_WHITE_LIST`.

## Signing in

Everyone signs in through Authentik, with FreeScout's paid OAuth & Social Login module. The
`authentik` stack registers the `Inbox` application, and binds it to one group, named by
`authentik:inboxGroup`. Only its members and Authentik's superusers get in. Its default name,
`FreeScout sign-in`, and its members, added by hand in Authentik's admin, hold until the access
design decides both (cyc-seattle/platform#334).

A first sign-in makes a FreeScout user with no mailboxes. An admin then puts them on each mailbox
they answer, under the mailbox's Permissions. FreeScout's admins see every mailbox.

When Authentik is down, the break-glass admin signs in with a password: its email is
`inbox:adminEmail`, and its password is in `inbox-admin-password`.

## Modules

Paid modules are bought once for each instance: a licence covers one. Prod and dev each have:

- **OAuth & Social Login**, for signing in through Authentik
- **API & Webhooks**, which the integration tests use, and later the contact form

A module is installed from FreeScout's admin with its licence key, onto the disk, so a restart keeps
it. No command enters a licence. [manual-setup.md](manual-setup.md#11-the-shared-inbox-inboxdomain)
has the steps. Until dev's API module is installed and `inbox:apiModule: true` is set in
`stacks/inbox/Pulumi.dev.yaml`, the scenarios that need it are skipped.

## Backups

- The `inbox` database is copied to `csc-backups` twice a day with every other prod database
  ([backups.md](backups.md)).
- The disk `inbox-data` holds the attachments and installed modules. The backups copy buckets, not
  disks, so it isn't copied yet.
- A restored database needs the same `inbox-app-key`. Without it, someone reconnects each mailbox
  by hand.
