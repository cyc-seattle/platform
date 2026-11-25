// What the CI stack (scripts/ci-stack) writes to `.ci-stack/target.json`: where each service answers on
// the runner, and how to sign in to it. Another repo reads it to run its own tests against the stack
// (docs/testing.md).

export interface CiStackTarget {
  directus: {
    /** Where both a browser and a test reach Directus. Any `http://localhost` origin may call it with credentials. */
    url: string;
    adminEmail: string;
    adminPassword: string;
    /** The built-in admin's static token. */
    adminToken: string;
    communityRoleId: string;
    /** The sign-in provider, for `<url>/auth/login/<signInProvider>?redirect=<one of redirects>`. */
    signInProvider: string;
    /** Where the sign-in may send the browser back besides Directus itself: `CI_STACK_REDIRECTS`, as given. */
    redirects: string[];
  };
  /** Where the website's forms post, in place of prod's `https://mail.<domain>`. */
  formsUrl: string;
  /** Each Service's URL on the runner, by its in-cluster `name:port`, such as `mailpit:8025`. */
  services: Record<string, string>;
  /**
   * Authentik's address, for a browser and a test alike, its bootstrap token, and the issuer Directus signs in
   * with. Its sign-in emails a link, which lands in Mailpit.
   */
  authentik: { url: string; token: string; directusIssuer: string };
  /** Listmonk's address, the newsletter list's ID, and the tests' read-only API login. */
  listmonk: { url: string; listId: string; apiUser: string; apiToken: string };
  /** Each sync's env, as its CronJob would give it. */
  cronJobs: Record<string, Record<string, string>>;
}
