# The newsletter and the website's forms

CSC's newsletter goes out from [Listmonk](https://listmonk.app), sending through Amazon SES, in place of
Mailchimp ([cyc-seattle/platform#180](https://github.com/cyc-seattle/platform/issues/180)). The public website's
two forms post under the same address ([cyc-seattle/csc-website#9](https://github.com/cyc-seattle/csc-website/issues/9)).

|                        | Prod                                   | Dev                                   |
| ---------------------- | -------------------------------------- | ------------------------------------- |
| Listmonk               | `https://mail.cyccommunitysailing.org` | `https://mail.dev.cycsail.team`       |
| Mail goes out through  | Amazon SES, us-west-2                  | Mailpit, which Authentik's stack runs |
| Bounces and complaints | SES → SNS → Listmonk                   | none                                  |

## Signing up

The website's newsletter form posts to Listmonk's own signup form, `/subscription/form`, with the CSC
Newsletter list's ID (`listmonk:listId`). The list is double opt-in: Listmonk emails a link, and the address is on
the list only once someone clicks it. That click, with its time and IP address, is the record that they asked.
Listmonk then sends the visitor back to the website's "Check your email" page, the one address its
`listmonk:trustedUrls` allows.

The form has a hidden `nonce` field that people never see. Listmonk turns away a signup that fills it in.

## The contact form

The contact form posts to `mail.<external domain>/forms/contact`. The Gateway sends `/forms/` there to Directus,
and the rest of the address to Listmonk. `stacks/backend/forms.cjs` answers it:

- It turns away a form from anywhere but the website (`backend:formsOrigins`), and drops one whose hidden
  `website` field a bot filled in, while telling the bot it was sent.
- It allows 3 messages an hour from one address, and `backend:formsPerIp` (10) from one IP. It keeps the counts in
  the Directus pod's memory, so they're gone after an hour or a restart. Dev allows 1,000 per IP, since every
  integration test posts from one runner.
- It emails `backend:contactTo`, info@, through the Workspace SMTP relay, from `noreply@` and with the visitor as
  Reply-To, then sends them to "Message sent". Nothing else keeps the message.

## Who can use Listmonk

Staff sign in through Authentik, which lets in only the Authentik groups Listmonk Write and Listmonk Send. Listmonk
can't read a role from the sign-in, so access comes from the two policies of those names that a group gives in the
Data Studio ([access.md](access.md#groups)), and the policy sync
([cyc-seattle/platform#334](https://github.com/cyc-seattle/platform/issues/334)) makes the groups:

| Policy         | Listmonk role | Can                                                                         |
| -------------- | ------------- | --------------------------------------------------------------------------- |
| Listmonk Write | Write         | Write and test issues; manage templates, pictures, subscribers, and imports |
| Listmonk Send  | Send          | All of Write, and send an issue to a list                                   |

A first sign-in makes an account with the Write role. access-334's sync
([cyc-seattle/platform#334](https://github.com/cyc-seattle/platform/issues/334)) gives each account the role its
policies give, and turns off an account whose policies are gone. It signs in to Listmonk's API with the
`listmonk-access-sync` Secret: `LISTMONK_URL`, `LISTMONK_API_USER`, and `LISTMONK_API_TOKEN`, sent as
`Authorization: token <user>:<token>`. Its role, Access sync, may only read and change accounts and read roles.
Look a role's ID up by name with `GET /api/roles/users`, since it differs between dev and prod.

Neither staff role changes Listmonk's settings or accounts. The built-in `admin` does, as the break-glass login:
`pulumi stack output adminPassword --show-secrets` in `stacks/listmonk`.

## Settings live in code

Listmonk keeps its settings in its database, where they outrank any environment variable. So before Listmonk starts,
its pod runs two steps: Listmonk's own install and upgrade, both safe to run again, then `psql` with the SQL
`stacks/listmonk/settings.ts` writes. That SQL sets:

- Listmonk's address, its From, and the SMTP server
- signing in through Authentik, with new accounts on the Write role
- the Write, Send, and API login roles, and the API logins: `access-sync`, and in dev `integration-tests`, which
  reads subscribers for the integration tests
- the CSC Newsletter list, public and double opt-in. Staff may rename it.
- bounces: one hard bounce or complaint blocks an address, and soft bounces only count
- pictures in the public bucket `<project>-listmonk-media-prod`, through Cloud Storage's S3 API, which
  `bootstrap` gives a key. Dev keeps them in the pod.

A change to any of them rolls the pod, which writes them again. Templates, the look of Listmonk's pages, and
everything staff make stay in Listmonk.

## SES

The `infra` stack holds SES ([manual-setup.md](manual-setup.md#11-the-newsletter-aws-ses-and-listmonk) makes the
account and role):

- The domain is verified with Easy DKIM, 2048-bit. Its 3 DKIM records and the `bounce.` Return-Path's MX and SPF
  are in the Cloud DNS zone, so SPF and DKIM both pass DMARC for the From domain.
- Pulumi signs in to AWS with deploy-runner's own Google ID token, which the AWS role trusts. No AWS key is kept
  for deploys.
- Listmonk's SMTP login is an IAM user that may only send as the domain. Its password is in Secret Manager as
  `listmonk-ses-smtp`. To rotate it, replace `aws:iam/accessKey:AccessKey::listmonk-smtp` in `infra`.
- Bounces and complaints go to the `ses-feedback` SNS topic as the domain's notifications, which Listmonk
  accepts, and not by email. With `infra:listmonkFeedback`, SNS posts them to Listmonk's
  `/webhooks/service/ses`.

## Backups

Listmonk's database is on the Cloud SQL instance, so the nightly copy takes it with the rest
([backups.md](backups.md)), and `bootstrap` copies its pictures bucket. A copy holds Listmonk's settings, the
SMTP password among them.
