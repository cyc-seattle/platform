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
- [ ] `roles/compute.osLoginExternalUser` on the org, for IAP SSH to isthmia's VM. Owner doesn't
      cover OS Login for an external principal.

```sh
gcloud organizations add-iam-policy-binding <ORG_ID> --member="user:<deployer-email>" --role="roles/resourcemanager.organizationAdmin" --condition=None
gcloud organizations add-iam-policy-binding <ORG_ID> --member="user:<deployer-email>" --role="roles/compute.osLoginExternalUser" --condition=None
```

Google refuses `roles/owner` for an external principal over the API. Grant it in the
[IAM console](https://console.cloud.google.com/iam-admin/iam?project=cyc-admin-scripts) instead:
add the principal, role **Basic → Owner**, then have them accept the emailed invitation.

Then add the deployer to `bootstrap:humanDeployers` in `stacks/bootstrap/Pulumi.prod.yaml`, and
apply `bootstrap`. That grants the Pulumi state buckets and keys, and the IAP SSH roles.

## When you add a new manual step

If you add infrastructure that needs an out-of-band action, add it here.
