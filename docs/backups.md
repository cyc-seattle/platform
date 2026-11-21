# Backups and restores

Prod's databases and files are copied twice a day to `csc-backups`, a Google Cloud project of their own,
with storage in `us-central1`, away from the `us-west1` region everything else runs in (#170). Losing
the Cloud SQL instance, the cluster, or the main project loses none of them.

Targets: lose at most 12 hours of data (minutes with Cloud SQL's own point-in-time recovery, while the
instance exists), and be running again within a few hours.

## What's copied

| What                                       | Where in `csc-backups`                                                  | Kept                                        |
| ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------- |
| Each prod database, as gzipped plain SQL   | `csc-backups-databases/daily/<database>/<date>T<time>.sql.gz`           | 35 days                                     |
| The same, from each month's first good run | `csc-backups-databases/monthly/<database>/<month>/<date>T<time>.sql.gz` | 13 months                                   |
| Directus's uploaded files                  | `csc-backups-files/<project>-directus-files-prod/`                      | as the source, plus 90 days of old versions |
| Prod's Pulumi state                        | `csc-backups-files/<project>-pulumi-prod/`                              | as the source, plus 90 days of old versions |

- **Every database on the prod instance** but `postgres` is copied, so an app's new database is copied
  from its first run with no change here. Database users aren't in the copies; Pulumi makes them.
- **Nobody can delete a database copy younger than 35 days**, including the deploys: the bucket has a
  retention policy, and the prod instance may only create copies. The policy isn't locked, because
  locking is permanent, so an Owner of `csc-backups` could still remove it. So the bucket never has to
  replace a file, each copy is named by the second it was made.
- **Nothing in the prod project can read a copy.** The Workflow can list their names, to see whether
  this month's copy exists. The instance can't read one: anyone with `cloudsql.admin` on prod, the
  deploys included, could import it and read it, so a restore grants read by hand for its length.
- **A file deleted or replaced** at the source stays in the files bucket as an old version for 90 days.
- **Not copied:** dev, whose data is made up, and the hand-set secrets in Secret Manager.
  [Manual setup](manual-setup.md#5-secret-values-secret-manager) lists where each one comes from.
  Pulumi-generated secrets are in the copy of the state, encrypted with the main project's KMS keys.
- **Only the people in `bootstrap:humanDeployers`** can read `csc-backups`. The copies hold minors'
  medical and emergency details.

## How it runs

The `bootstrap` stack's `backups.ts` holds it all, so no deploy identity can change it.

1. Cloud Scheduler starts the `backup` Cloud Workflow (`stacks/bootstrap/backup.workflow.yaml`) at 10:00
   and 22:00 UTC (2:00 and 14:00 Pacific in winter, 3:00 and 15:00 in summer), as `backup-runner`. UTC
   has no skipped or repeated hour, which would leave a 24-hour gap and set off the absence alert.
2. The Workflow lists the prod instance's databases and asks Cloud SQL to export each in turn. Cloud SQL
   runs `pg_dump` and writes the file as the instance's own service account. When a database has no
   copy in `monthly/` for the month yet, it exports one there too, so a failed run on the 1st is made
   up by the next good one.
3. It then runs one Storage Transfer job per bucket, waits for it, and fails if the transfer fails or
   any file in it does.
4. It logs a line with `backup: finished` for each database and bucket, or `backup: failed` and stops.

The `infra` stack's `backups.ts` emails the alert addresses when a run fails, and when a database or
bucket hasn't been copied in 23.5 hours, the longest a Cloud Monitoring absence condition waits. That's
why the Workflow runs twice a day: one missed run leaves a 24-hour gap, which alerts.

To add a bucket, such as an app's uploads, add its name to `backedUpBuckets` in
`stacks/bootstrap/backups.ts` and apply `bootstrap`.

Because it copies them, `bootstrap` needs prod's Cloud SQL instance and every bucket in `backedUpBuckets`
to exist, and its preview fails without them. [Rebuilding the main project](#if-the-main-project-is-lost)
works around that.

## A missed backup

1. Find the run: `gcloud workflows executions list backup --location us-west1`, then
   `gcloud workflows executions describe <id> --workflow backup --location us-west1` for its error.
2. A Cloud SQL export fails if another operation is running on the instance, such as maintenance or a
   deploy's database change. Run it again:
   `gcloud workflows run backup --location us-west1`.
3. A permission error after a change to the instance or a bucket means a grant in
   `stacks/bootstrap/backups.ts` no longer matches. Preview and apply `bootstrap`.
4. Check the copies landed: `gcloud storage ls gs://csc-backups-databases/daily/directus/ | tail -2`.

## The restore drill

Each quarter, the `restore-drill` workflow opens an issue assigned to the maintainer. Run, from a
checkout, with Docker running:

```sh
mise run restore-drill
```

It takes about 30 minutes and costs a few cents. It:

1. Makes a throwaway `db-f1-micro` instance in `csc-backups`, reachable only through the Cloud SQL Auth
   Proxy with your login.
2. Loads the latest `directus` and `authentik` copies into it.
3. Clears the copy's `license_key` and `license_token`, so the throwaway Directus can't activate or
   refresh the license ([backend.md](backend.md#never-destroy-it)), and turns off every flow, so it
   can't email anyone or call another service. It then starts the Directus image prod runs on the
   copy, unlicensed, on your machine.
4. Checks Directus answers, the copy has people and households, its newest activity is under 36 hours
   old, Authentik's copy has users, and a copied file matches its source.
5. Deletes the instance, even when a check fails, and prints a checklist to paste in the issue.

It stops before making anything if port 15432 or 18055 is already in use.

A failed check means a real restore would fail the same way. Fix it before closing the issue.

## A real restore

Restore to the instance's own backups first, while it exists: Cloud SQL's point-in-time recovery loses
minutes, where a copy loses up to 12 hours. Use the copies here when the instance or the project is gone.

1. Make the instance again: apply `infra`, or, if the main project is gone, follow
   [the rebuild](#if-the-main-project-is-lost) first. Apply each app's stack once, so its database and
   user exist, then stop its pods.
2. Let the instance read the copies, for the restore only. Nothing in Pulumi grants this, on purpose:

   ```sh
   account="$(gcloud sql instances describe <instance> --format 'value(serviceAccountEmailAddress)')"
   gcloud storage buckets add-iam-policy-binding gs://csc-backups-databases \
     --member "serviceAccount:$account" --role roles/storage.objectViewer
   ```

3. Load each database into its empty database, as its own user:

   ```sh
   gcloud sql import sql <instance> gs://csc-backups-databases/daily/<database>/<file>.sql.gz \
     --database <database> --user <database>
   ```

4. Take the read away again:

   ```sh
   gcloud storage buckets remove-iam-policy-binding gs://csc-backups-databases \
     --member "serviceAccount:$account" --role roles/storage.objectViewer
   ```

5. Copy the files back: `gcloud storage cp -r gs://csc-backups-files/<bucket>/* gs://<bucket>/`.
6. Start the apps. Directus keeps its license only if its database's `project_id` and its `PUBLIC_URL`
   are unchanged, which a restore of the copy at the same address keeps
   ([backend.md](backend.md#never-destroy-it)). Read that section before starting Directus anywhere else.

## If the main project is lost

`csc-backups` and its copies survive, but `bootstrap`'s state, which manages them, was in the lost
project. In the new project:

1. Set `bootstrap:backupCopies` to `false` in its stack config. `bootstrap` then keeps `csc-backups`
   and its buckets but stops looking for a prod instance and buckets that don't exist yet.
2. Bring the existing project and buckets under the new state before the first apply, or it tries to
   make them again and fails:

   ```sh
   pulumi import gcp:organizations/project:Project csc-backups csc-backups --cwd stacks/bootstrap
   pulumi import gcp:storage/bucket:Bucket databases csc-backups/csc-backups-databases --cwd stacks/bootstrap
   pulumi import gcp:storage/bucket:Bucket files csc-backups/csc-backups-files --cwd stacks/bootstrap
   ```

3. Apply `bootstrap`, then `infra`, then restore as above.
4. Set `backupCopies` back to `true`, or remove it, and apply `bootstrap` again, so copying starts.

The copy of the old state in `csc-backups-files` lists every resource the old project had, but its
secrets were encrypted with the lost project's KMS keys, so Pulumi makes them again.
