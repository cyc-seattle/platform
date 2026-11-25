// What the CI stack (scripts/ci-stack) writes to `.ci-stack/target.json`: where each service answers on
// the runner, and how to sign in to it. Another repo reads it to run its own tests against the stack
// (docs/testing.md).

export interface CiStackTarget {
  directus: {
    url: string;
    adminEmail: string;
    adminPassword: string;
    /** The built-in admin's static token. */
    adminToken: string;
    communityRoleId: string;
  };
  /** Where the website's forms post, in place of dev's `https://mail.<domain>`. */
  formsUrl: string;
  /** Each Service's URL on the runner, by its in-cluster `name:port`, such as `mailpit:8025`. */
  services: Record<string, string>;
  /** Authentik's address, and its bootstrap token. */
  authentik: { url: string; token: string };
  /** Listmonk's address, the newsletter list's ID, and the tests' read-only API login. */
  listmonk: { url: string; listId: string; apiUser: string; apiToken: string };
  /** Each sync's env, as dev's CronJob gives it. */
  cronJobs: Record<string, Record<string, string>>;
}
