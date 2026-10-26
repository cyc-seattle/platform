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

## When you add a new manual step

If you add infrastructure that needs an out-of-band action, add it here.
