# Backups and restores

Prod's databases and files are copied twice a day to `csc-backups`, a Google Cloud project of their own,
with storage in `us-central1`, away from the `us-west1` region everything else runs in (#170). Losing
the Cloud SQL instance, the cluster, or the main project loses none of them.

Targets: lose at most 12 hours of data (minutes with Cloud SQL's own point-in-time recovery, while the
instance exists), and be running again within a few hours.

## What's copied

| What                                             | Where in `csc-backups`                                        | Kept                                        |
| ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------- |
| Each prod database, as gzipped plain SQL         | `csc-backups-databases/daily/<database>/<date>T<time>.sql.gz` | 35 days                                     |
| The same, from the 1st of each month's early run | `csc-backups-databases/monthly/<database>/<month>.sql.gz`     | 13 months                                   |
| Directus's uploaded files                        | `csc-backups-files/<project>-directus-files-prod/`            | as the source, plus 90 days of old versions |
| Prod's Pulumi state                              | `csc-backups-files/<project>-pulumi-prod/`                    | as the source, plus 90 days of old versions |

- **Every database on the prod instance** but `postgres` is copied, so an app's new database is copied
  from its first run with no change here. Database users aren't in the copies; Pulumi makes them.
- **Nobody can delete a database copy younger than 35 days**, including the deploys: the bucket has a
  retention policy, and the prod instance may only create and read copies. The policy isn't locked,
  because locking is permanent, so an Owner of `csc-backups` could still remove it.
- **A file deleted or replaced** at the source stays in the files bucket as an old version for 90 days.
- **Not copied:** dev, whose data is made up, and the hand-set secrets in Secret Manager.
  [Manual setup](manual-setup.md#5-secret-values-secret-manager) lists where each one comes from.
  Pulumi-generated secrets are in the copy of the state, encrypted with the main project's KMS keys.
- **Only the people in `bootstrap:humanDeployers`** can read `csc-backups`. The copies hold minors'
  medical and emergency details.

## How it runs

The `bootstrap` stack's `backups.ts` holds it all, so no deploy identity can change it.

1. Cloud Scheduler starts the `backup` Cloud Workflow (`stacks/bootstrap/backup.workflow.yaml`) at 2:00
   and 14:00 Pacific, as `backup-runner`.
2. The Workflow lists the prod instance's databases and asks Cloud SQL to export each in turn. Cloud SQL
   runs `pg_dump` and writes the file as the instance's own service account.
3. It then runs one Storage Transfer job per bucket, which copies new and changed files.
4. It logs a line with `backup: finished` for each database and bucket, or `backup: failed` and stops.

The `infra` stack's `backups.ts` emails the alert addresses when a run fails, and when a database or
bucket hasn't been copied in 23.5 hours, the longest a Cloud Monitoring absence condition waits. That's
why the Workflow runs twice a day: one missed run leaves a 24-hour gap, which alerts.

To add a bucket, such as an app's uploads, add its name to `backedUpBuckets` in
`stacks/bootstrap/backups.ts` and apply `bootstrap`.

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
   refresh the license ([backend.md](backend.md#never-destroy-it)), and starts the Directus image prod runs
   on it, unlicensed, on your machine.
4. Checks Directus answers, the copy has people and households, its newest activity is under 36 hours
   old, Authentik's copy has users, and a copied file matches its source.
5. Deletes the instance, even when a check fails, and prints a checklist to paste in the issue.

A failed check means a real restore would fail the same way. Fix it before closing the issue.

## A real restore

Restore to the instance's own backups first, while it exists: Cloud SQL's point-in-time recovery loses
minutes, where a copy loses up to 12 hours. Use the copies here when the instance or the project is gone.

1. Make the instance again: apply `infra`, or, if the main project is gone, `bootstrap` then `infra`
   in a new one. Apply each app's stack once, so its database and user exist, then stop its pods.
2. Let the new instance read the copies: add its service account to `csc-backups-databases` as
   `roles/storage.objectViewer` in `stacks/bootstrap/backups.ts`, and apply `bootstrap`.
3. Load each database into its empty database, as its own user:

   ```sh
   gcloud sql import sql <instance> gs://csc-backups-databases/daily/<database>/<file>.sql.gz \
     --database <database> --user <database>
   ```

4. Copy the files back: `gcloud storage cp -r gs://csc-backups-files/<bucket>/* gs://<bucket>/`.
5. Start the apps. Directus keeps its license only if its database's `project_id` and its `PUBLIC_URL`
   are unchanged, which a restore of the copy at the same address keeps
   ([backend.md](backend.md#never-destroy-it)). Read that section before starting Directus anywhere else.
