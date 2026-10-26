import * as gcp from "@pulumi/gcp";
import * as random from "@pulumi/random";
import { getStringList, projectId } from "../../src/config.ts";
import { devPostgres } from "./database.ts";
import { enableService } from "../../src/services.ts";

/**
 * Creates dev's app databases here, not in isthmia's dev stacks (#231): Cloud SQL ignores IAM
 * conditions on its user and database calls, so `deploy-dev` can't hold a role scoped to `cyc-dev`.
 * Each name becomes a database and a user of that name, and the user's password lands in the
 * Secret Manager secret `dev-db-<name>-password`, which `deploy-dev` already reads.
 */
export const devDatabaseNames = getStringList("devDatabases");

// Every app's secrets need it too. isthmia's retired `infrastructure` stack enabled it before.
const secretManagerApi = enableService("secretmanager.googleapis.com");

export const devDatabases = devDatabaseNames.map((name) => {
  const database = new gcp.sql.Database(name, { name, instance: devPostgres.name });

  // Alphanumeric only, so the password drops into a connection URL unescaped.
  const password = new random.RandomPassword(`${name}-password`, { length: 32, special: false });

  const user = new gcp.sql.User(
    name,
    // The user owns what its app creates, and Postgres refuses to drop a role that owns objects.
    // The database goes away with the instance, so abandon the user rather than fail the delete.
    { name, instance: devPostgres.name, password: password.result, deletionPolicy: "ABANDON" },
    { dependsOn: [database] },
  );

  const secret = new gcp.secretmanager.Secret(
    `dev-db-${name}-password`,
    {
      project: projectId,
      secretId: `dev-db-${name}-password`,
      replication: { auto: {} },
    },
    { dependsOn: [secretManagerApi] },
  );
  const version = new gcp.secretmanager.SecretVersion(`dev-db-${name}-password`, {
    secret: secret.id,
    secretData: password.result,
  });

  return { database, user, secret, version };
});
