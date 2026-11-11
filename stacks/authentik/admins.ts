import * as pulumi from "@pulumi/pulumi";
import * as authentik from "@pulumi/authentik";

/**
 * Directus's admins, as Authentik superusers, so they can impersonate someone to see what they see
 * (docs/access.md). It's superuser, not just the impersonate permission, because Authentik lets
 * anyone with that permission impersonate a superuser too.
 *
 * Each admin joins once their Authentik account is active, on the deploy after their first sign-in.
 */
export function adminGroup(emails: pulumi.Input<string[]>, opts: { provider: authentik.Provider }): authentik.Group {
  const users = pulumi
    .output(emails)
    .apply((list) => Promise.all(list.map((email) => authentik.getUsers({ email, isActive: true }, opts))))
    .apply((found) =>
      found
        .flatMap(({ users }) => users.map(({ pk }) => pk))
        .filter((pk): pk is number => pk !== undefined)
        .sort((a, b) => a - b),
    );
  return new authentik.Group("admins", { name: "Admins", isSuperuser: true, users }, opts);
}
