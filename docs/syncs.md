# The syncs

clubspot-sync and gsuite-sync are hourly CronJobs in the `backend` stack. [backend.md](backend.md#the-syncs)
says how they're built and deployed.

The code lives in `src/`, outside the published package:

- `src/model/crm/` and `src/model/clubspot/` are the row types for the collections in
  `schemas/`. The Clubspot ones are apart because they're Clubspot's shape, not the club's, and
  wouldn't survive a move off Clubspot.
- `src/syncs/runtime/` is what both syncs share: the Directus row client, the `sync_tasks` queue
  and its worker, sync runs, and audit findings.
- `src/syncs/clubspot/` and `src/syncs/gsuite/` are the syncs. Each has a `main.ts`, the CLI.

Node runs a sync's CLI straight from source, so `node src/syncs/<sync>/main.ts --help` lists its
options.

## clubspot-sync

An hourly CronJob that syncs one Clubspot club's camps, schedule, and registrations into the CRM's
Directus instance (`src/model/crm/`). Replaces the spreadsheet-backed reports in
`cyc-seattle/admin-functions` for that data. See issue cyc-seattle/isthmia#70.

### Running locally

Run the CLI against dev's Directus, with a token for a user that may write the CRM:

```sh
CLUBSPOT_EMAIL=... CLUBSPOT_PASSWORD=... \
DIRECTUS_URL=https://directus.<dev domain> DIRECTUS_TOKEN=... \
node src/syncs/clubspot/main.ts --club <clubspot-club-id> --dry-run
```

Options:

- `--club <id>` - the Clubspot club id to sync (env `CLUBSPOT_CLUB_ID`)
- `--directus-url <url>` - the base URL of the CRM's Directus instance (env `DIRECTUS_URL`)
- `--directus-token <token>` - a Directus static token for the sync's machine user (env
  `DIRECTUS_TOKEN`)
- `--dry-run` - log the writes the sync would make, without making them. Runs every discovered camp
  directly, bypassing the queue - see "Shape of the code" below.
- `--camp <id>` - sync only this camp, bypassing discovery and change detection
- `--since <iso-date>` - backfill: re-read `--camp`'s registrations from this date instead of its
  stored watermark. Requires `--camp`.
- `--seed-contact-points` - one-time migration (step 4): backfills `contact_points` from the
  `clubspot_participants` mirror, then adds a `staff` row for any `people.email`/`people.phone` with no
  contact point yet. Bypasses the camp sync entirely. Idempotent - safe to rerun - and supports
  `--dry-run`.
- `--approve-matching-duplicates` - one-time migration (step 5): approves every open
  `duplicate_person` finding whose group's rows all share one non-null `date_of_birth` -
  `docs/crm-schema.md`'s participant rule. A group with a null or a differing date of birth stays
  open. Bypasses the camp sync entirely. Approving only sets `status: "approved"`; the next normal
  run's merge executor applies it. Supports `--dry-run`, which logs the findings it would approve
  without writing anything.

Prefer the env vars over `--directus-token` and the Clubspot password flags. A flag value is
visible to anyone on the box who runs `ps` (cyc-seattle/isthmia#49).

### Verifying and backfilling one camp

`--camp <id>` syncs a single camp on demand, bypassing discovery and the backoff check - useful for
checking one camp's data or re-running it right after a mapping fix.

On its own, `--camp` still filters registrations to the camp's stored watermark (its last
successful sync), so re-running it against an already-synced camp only picks up recent changes.
To re-read further back - for a backfill after a mapping fix, say - add `--since <iso-date>` to
widen the registration window to start there instead:

```sh
node src/syncs/clubspot/main.ts --club <id> --camp <camp-id> --since 2026-01-01 --dry-run
```

`--dry-run` is the way to check a backfill before committing to it: it logs the writes without
making them. `--since` only widens the registration read; the schedule pass (`clubspot_camps`,
`clubspot_sessions`, `clubspot_classes`, `clubspot_session_classes`, `clubspot_entry_caps`) is already a full reconcile on every run, so
it needs no override.

A successful backfill still advances the camp's stored `synced_through`, same as any other sync,
so it doesn't replay the backfilled window on the next normal run.

### Shape of the code

The code is in `src/syncs/clubspot/`. Each collection's mapping is a pure plan function, and a thin executor writes the plan. That keeps
almost all of the logic testable with no Directus and no Parse:

- `camps.ts` - discovers the camps for a club.
- `backoff.ts` - decides whether a camp is due for a sync this run, and how its watermark and
  backoff state change after one.
- `schedule.ts` - plans `clubspot_camps`, `clubspot_sessions`, `clubspot_classes`, `clubspot_session_classes`, `clubspot_entry_caps`.
- `people.ts` / `person-sync.ts` - person matching and the `people`/`contacts`/`medical_profiles`
  plan and its executor.
- `synced-fields.ts` - the one CRM field rule every curated field follows (cyc-seattle/isthmia#137): pure, and used by
  `person-sync.ts` for `people`, guardian/emergency-contact slots, and `medical_profiles`.
- `registrations.ts` - plans `clubspot_registrations`, `clubspot_registration_entries`, `clubspot_registration_billing`,
  `clubspot_custom_field_definitions`, `clubspot_custom_field_responses`.
- `merge.ts` - plans a `duplicate_person` group's merge onto its keeper; pure, like every other
  plan here.
- `audit.ts` - raises `duplicate_person` and `unlinked_participant` findings from `merge.ts`'s
  output.
- `merge-executor.ts` - applies an approved `duplicate_person` finding's plan, and the final guard
  that only deletes a duplicate once nothing references it.
- `sync-run.ts` - `syncCamp`, one camp's full reconcile, and `runSync`, the job entry point.
  A normal run discovers every camp and enqueues one `sync_camp` task per camp onto
  the sync queue's (`src/syncs/runtime/`), which drives each one on its own retry schedule, isolated from
  its siblings' failures. `--camp` and `--dry-run` bypass the queue for a direct, synchronous
  reconcile instead - useful for a one-off check, and necessary for `--dry-run`, which never
  persists the tasks the queue would otherwise need to drive itself.
- `main.ts` - the CLI.

### Behaviors worth knowing before you change this

**Clubspot is the source of truth for schedule and registration columns.** A manual edit to one is
overwritten on the next run that reconciles that row. `people`, `medical_profiles`, and a
guardian/emergency contact's own `people` row follow one different rule instead (cyc-seattle/isthmia#137, `synced-fields.ts`):
the newest linked participant's form answer wins, and a staff edit holds until Clubspot sends
something new. The `clubspot_participants` mirror itself keeps Clubspot's last non-blank answer for every
field - a blank form answer never overwrites a value already stored there (`people.ts`'s
`mergeParticipantMirrorFields`) - so `person-sync.ts` reads `base` (the mirror's own stored value)
and `v` (what Clubspot sends now) for every curated field; `v` equal to `base` writes nothing, `v`
different from `base` writes `v` and counts a replaced staff edit if the CRM value wasn't `base` or
null, and a null `v` is never written. Only the newest registration linked to a person may write at
all — an older one's form never overwrites a newer one's. Only a participant mirrored for the first
time ever - `base` entirely unknown, not merely a known blank - falls back to the person's previous
newest _other_ linked participant's own value (`resolveBase`); only with neither does a field fall
to filling a null CRM column and nothing else. See `docs/crm-schema.md` for the same rule described
from the schema side.

**Promoted fields follow the same one CRM field rule, in two passes, for two kinds of target.** A
`people` column (`school`) is written per registration, gated on the same newest-linked-participant
check as `people` and `medical_profiles`, with a fallback to the previous newest other
registration's own answer, resolved by target field rather than definition id, since each camp
clones its own custom field definitions with different ids. A `clubspot_registrations` column
(`share_contact`) is written the same way but ungated: each registration answers only for itself,
with no fallback. Both read `clubspot_custom_field_responses` as their mirror, keeping its own last
non-blank answer the same way `clubspot_participants` does: `base` is the response's own stored value before
this run's write, `v` is what Clubspot sends now; `v` equal to `base` writes nothing, `v` different
writes `v`. `planPromotedFields` then runs once more, at the end of every run across every camp, as
a fallback gap-fill for a registration the per-registration pass didn't reach this run: for `people`
it ranks every camp's responses for a person (non-archived before archived, then most recent, with
a stable tiebreak); for `clubspot_registrations` it fills a still-null `share_contact` from that
registration's own stored answer only, with no ranking. Label matching normalizes punctuation and
case, so `Race / Ethnicity` and `Race/Ethnicity` match without listing both. Nothing promotes until
the target's `clubspot_promoted_fields` row exists — it's created by hand, not by Pulumi.

**A person reference is pinned, not gap-filled.** `clubspot_participants.person_id` and `contacts.contact_id`
are set once, at creation, and never re-resolved. That is what makes a manual merge durable: staff
repoint the FK and delete the duplicate, and no later sync undoes it. See `docs/crm-schema.md` for
the merge procedure.

A session Clubspot has archived syncs like any other, with its row's `archived` written `true`.
Deleting a session in the Data Studio instead sets `archived` on a row Clubspot still reports
unarchived, so the next sync writes `archived: false` and it reappears — intended, since Clubspot
stays authoritative.

**The sync cancels rather than deletes**, except for `clubspot_session_classes`. A `clubspot_registration_entries` row
whose Clubspot join object vanished gets `status = cancelled`, not deleted. `clubspot_session_classes` is a
pure join with no status field of its own, so a class a session no longer offers is removed outright.

**A missing scalar is stored as null; an unresolvable reference is skipped.** `clubspot_sessions.start_date`/
`end_date` and `clubspot_registration_billing.currency` are written null rather than fabricated when Clubspot
has nothing. An entry cap or registration entry that points at a session not present in the CRM is
dropped with a warning instead of being written with a guessed reference.

**A value the SDK types as required, but finds absent, means the SDK's model of Clubspot is wrong -
the sync throws rather than inventing one.** The camp's sync fails, is logged, and counts toward
`runSync`'s `campsFailed`. This covers an unrecognized registration status, a registration
missing `status` or `confirmed_at`, a participant with no first name (`people.first_name` isn't
nullable, and an empty string would let the person matcher merge unrelated nameless people), and a
billing pointer that was never fetched. In a normal (queued) run, the queue also retries the
camp's task later on its own schedule - see Backoff below for how that's a different concern
from the camp's own polling cadence.

### Backoff

Each run lists every non-archived Clubspot camp for the club - archived sessions within a camp sync
regardless - then decides per camp whether it's due:

- A camp with no sync history, or whose last sync wrote something, is due every run.
- A sync that writes nothing doubles the camp's interval, up to a cap of one week. This state
  lives on the camp row itself - `synced_through` and `quiet_runs` - not in a run log, so a
  camp that was never due for a run is never touched and never appears in one.
- A due camp gets a full reconcile, not a partial one, so there's nothing for the interval to
  miss: an entry-cap change (no pointer back to its camp) or a delete (nothing in `updatedAt`
  reveals one) is picked up the same as any other change, without needing to be detected first.
- **Registrations** are still filtered on `updatedAt` between the camp's watermark and the
  moment its own sync starts - not the run's start, since earlier camps in the same run can take
  real time to process. The watermark is `clubspot_camps.synced_through`, advanced to that instant on
  every successful sync whether or not it wrote anything, or the epoch if the camp has never
  synced - so a camp coming back from a long backoff still gets registrations from the entire
  gap, not just since its last run, and consecutive syncs' windows tile with no gap between them.
- This is a different question from the queue's own `run_after`: `run_after` is "retry this failed
  task later"; this is "this camp has changed nothing for N runs, so poll it less often". A
  failed sync never reaches the code that writes `synced_through`/`quiet_runs`, so a failure has no
  effect on either one - the queue's retry schedule covers it instead.
- Every run re-enqueues every due camp, but the sync queue's (`src/syncs/runtime/`) carries a task's
  `attempts` and `last_error` forward as long as it isn't `done` or `cancelled`, so a camp
  failing every night stays visibly at that count instead of resetting to zero each run. Once
  `attempts` reaches `max_attempts`, the queue sets `needs_attention` on the row but keeps retrying
  it on its normal schedule - a stuck camp must self-heal once the underlying Clubspot outage
  clears, not sit parked until a human notices and re-enqueues it by hand.

## gsuite-sync

An hourly CronJob that syncs program group membership, owners, and settings from the CRM's Directus
instance (`src/model/crm/`) into Google Groups, and syncs `google_groups` itself the other way: a
discovery pass lists every group and its nesting from Workspace so staff never hand-type a group's
address. Mirrors `clubspot-sync` on the Google Workspace side.

Google is the source of truth for which groups exist and how they nest. The CRM stays the source
of truth for who should be in them, and for which group a program points at. Groups hang off
programs only - a class has no group of its own.

### Running locally

Run the CLI against dev's Directus. The discovery pass populates `google_groups` from Workspace;
nothing needs to be entered there by hand. What staff still set by hand is the link from a program to its group
(`programs.google_group_id`) - discovery can't infer that.

```sh
DIRECTUS_URL=https://directus.<dev domain> DIRECTUS_TOKEN=... \
node src/syncs/gsuite/main.ts --dry-run
```

Google API calls authenticate with Application Default Credentials — run the workplace's `mise run auth-adc` first.

Options:

- `--directus-url <url>` - the base URL of the CRM's Directus instance (env `DIRECTUS_URL`)
- `--directus-token <token>` - a Directus static token for the sync's machine user (env
  `DIRECTUS_TOKEN`)
- `--group-owners <emails>` - comma-separated break-glass super-admin emails granted `OWNER` on
  every group (env `GSUITE_SYNC_GROUP_OWNERS`). Required, with no default: ownership is a security
  boundary, so the deployed value lives in the infrastructure that grants it
  (the `groupOwners` Pulumi config key, read in
  `stacks/backend/gsuite-sync.ts`) rather than in the sync's source.
- `--customer <id>` - the Workspace customer id the discovery pass lists groups for (env
  `GSUITE_SYNC_CUSTOMER`). Required, with no default: the service account holds a direct Groups
  Administrator role rather than impersonating a domain user, so the `my_customer` alias 404s for
  it and a real customer id must be supplied.
- `--dry-run` - log the writes the sync would make, without making them. The audit and membership
  passes still read live Google state, since reads have no side effects.

Prefer the env vars over `--directus-token`. A flag value is visible to anyone on the box who runs
`ps` (cyc-seattle/isthmia#49).

### Shape of the code

The code is in `src/syncs/gsuite/`. Each pass is a pure plan function, and a thin executor writes the plan, following the
`clubspot-sync` convention:

- `discovery.ts` - plans `google_groups` upserts and nesting from live Workspace state.
- `camps.ts` - whether a class's camp is current or upcoming, so its participants count
  (`isCampActive`).
- `membership.ts` - plans a program group's members: participants and guardians reached through
  classes of active camps, and anyone holding a current `program_role_assignments` row.
- `group-memberships.ts` - plans a program group's adds and `google_group_memberships` writes from
  its planned people, its live members, and the rows already recorded.
- `nesting.ts` - plans which groups nest under a program group.
- `owners.ts` - plans owner assignments from the configured owner list.
- `settings.ts` - plans which groups have a settings template to apply.
- `audit.ts` / `audit-settings.ts` - plan the findings an audit run should raise.
- `directory-writer.ts` / `settings-writer.ts` - the `MemberAdder` and `SettingsApplier` executors,
  and their dry-run variants.
- `discovery-writer.ts` - lists Workspace groups and membership, and writes the discovery plan.
- `audit-writer.ts` - reads live Google state and reconciles it against `audit_findings`.
- `run.ts` - enqueues one task per due unit of work onto the sync queue's (`src/syncs/runtime/`), then
  drains it. `main.ts` is the CLI.

### Behaviours worth knowing before you change this

[docs/google-groups-nesting.md](google-groups-nesting.md) says how Google resolves
membership and posting through nested groups. Read it before you change group structure or posting
settings.

**Discovery runs before every other pass, on its own queue.** Membership, settings, nesting, and
owners all read `google_groups`, so discovery has to finish writing it first. It uses a separate
`sync_tasks` queue value from the rest (`gsuite-sync-discovery` vs `gsuite-sync`) so that ordering
is guaranteed rather than left to the shared queue's claim order.

**Discovery only ever adds a `parent_id`, never clears one.** It sets a group's `parent_id` when
live Workspace membership shows it nested under another group, but leaves an existing `parent_id`
alone when it finds no live nesting - that value may be hand-set, waiting for the nesting pass to
apply it to Workspace. Once applied, the next discovery run derives the same `parent_id` from live
state, which is what makes today's hand-set `parent_id` redundant going forward.

**Discovery mirrors `description` from Workspace the same way it does `name`.** One direction only:
nothing writes a `google_groups` row's `description` back to a Workspace group.

**Discovery never touches `settings_template`, or a program's `google_group_id`.** Those are
staff-set and can't be inferred from Workspace - discovery only creates a row and refreshes its
`name`, `description`, and `archived` state. `settings_template` is a template _name_ staff pick
from a Directus dropdown (`announcement`,
`crew`, `inbox`, or `clubspot_participants`), not a settings payload - the settings pass resolves it against
`@cyc-seattle/gsuite-sdk`'s `resolveGroupSettingsTemplate`, which throws on an unrecognized name rather
than leaving the group unmanaged.

**A `google_groups` row is archived, never deleted, when its group disappears from Workspace.**
Deleting would silently break whatever program points at it. Archiving keeps `settings_template`
and `parent_id` intact, so a group that reappears with the same email picks up right where it left
off, unarchived on the next discovery run. Every write pass and most of the audit skip an archived
row; the audit still raises `missing_group` for one if a program still points at it - the one case
that needs a human.

**Every write pass is add-only.** A person removed from `clubspot_registration_entries`, or a role revoked
in `program_role_assignments`, simply stops being re-added on the next run — nobody is ever removed
from a Google Group by this job.

**The membership pass never re-adds someone who left a group (cyc-seattle/isthmia#265).** It records each person it
sees in a program group in `google_group_memberships`, keyed by group and person. Each run it lists
the group's live members once, then for each planned person:

| Live member? | Row               | Action                                          |
| ------------ | ----------------- | ----------------------------------------------- |
| yes          | none              | write a row with `added_at` = now               |
| yes          | `removed_at` null | nothing                                         |
| yes          | `removed_at` set  | clear `removed_at`: a person put them back      |
| no           | none              | add them, and write a row with `added_at` = now |
| no           | `removed_at` null | set `removed_at` = now, and don't add them      |
| no           | `removed_at` set  | skip                                            |

Leaving and being removed by a manager look the same, and both are permanent until staff delete
the row; a new registration doesn't bring the person back. To keep someone out, set `removed_at`
on their row and take them out of the group. To let the sync add them again, delete the row.

A row's `email` is the address the sync last saw for that person. When a person's email changes,
the sync adds the new address and updates the row, unless the row is removed. People who share an
address share its row state: if any of them is recorded as removed, nobody re-adds the address.
The audit treats a removed person as intentionally absent, and raises nothing for them.

**A program's membership task is enqueued on `google_group_id` alone, not on having a due class.**
A program whose only current activity is a `program_role_assignments` row — off-season, or set up
before its first class exists — still needs its role holders synced (cyc-seattle/isthmia#149). Whether a class's camp is active, below, decides which
_participants_ get added once the task runs; it plays no part in whether the task runs at all.

**A class only contributes participants while its camp is current or upcoming** (`isCampActive`,
cyc-seattle/isthmia#265): the camp isn't archived, and its `end_date` hasn't passed or is unset. People who register
in spring for a summer camp get the group's emails before it starts. Last season's members stay in
the group anyway, because the job never removes anyone. Program role assignments have their own
`starts_on`/`ends_on` instead.

**The audit pass reports, it never prunes.** It compares live membership and settings against the
plan and writes `audit_findings` rows for the differences, including members the sync didn't add.
Resolving a finding is a human decision, not something a later run does automatically.

**A member from a past season is `stale_member`, not `unexpected_member`.** The audit computes two
plans: `current`, from active camps, and `all`, which also counts camps that have ended or been
archived. A live member in `all` but not `current` has a real registration, just not for a current
or upcoming camp, so it's flagged distinctly from someone who was never planned at all. Since the
job never removes anyone, every member of last season who hasn't registered again is one.

**Only groups a program points at have their membership audited.** An unmapped group has no plan
beyond its owners, so auditing it would report every member as unexpected. `missing_group` and
settings drift still cover every non-archived group.

**An unusable email is skipped, not fatal.** Clubspot contact fields hold phone numbers and
typos, and the Directory API rejects a whole add on one bad address, so membership skips anything
`isValidEmail` rejects and the audit raises `invalid_email` for that person. Fix it in Directus:
clubspot-sync only fills empty `people` fields (cyc-seattle/isthmia#137), so a correction made only in Clubspot never
replaces the bad value. Fixing Clubspot too keeps Clubspot's own emails to the family working.

**Group managers are not audited.** They're managed by hand until roles have one model across
Directus and Google Groups (cyc-seattle/isthmia#156), so a `MANAGER` is never reported as `unexpected_member` or
`stale_member`. The sync never demotes one either — adding an existing manager as `MEMBER` leaves
their role alone. Owners are still audited.

**`mismatched_revenue_account` flags a Clubspot Camp with more than one revenue account.** A camp
has a single sales account (`clubspot_camps.clubspot_sales_account`), so every class in it should map to
programs whose products book to one account (`products.revenue_account_id`). A product with no
account isn't a conflict by itself. Only two or more distinct
accounts are. Tagged `clubspot-sync`, like `class_without_program`: a finance/Clubspot concern this
pass happens to compute.

**A program must be a product of kind `program`.** Directus can't compare a field across
collections, so the audit raises `program_product_wrong_kind` for a program whose product is some
other kind.

**A dismissed finding never re-raises for the same fingerprint.** A finding's identity is
`source` + `kind` + `subject` + a hash of its detail. Once staff dismiss a row, the same condition
recurring never reopens it, so staff never have to re-triage a finding they already resolved. Only
a change to the underlying detail produces a new fingerprint and a fresh row.

**Group owners come from config, not the CRM.** `--group-owners` (or its default) is the whole
input to the owners pass. Ownership is a break-glass boundary and is deliberately not editable from
the Directus admin UI.

**A program group must not be used as an oauth2-proxy allowlist.** Nested group membership resolves
in-domain only — `hasMember` doesn't follow a cross-domain member through a nested group on
Workspace Business Standard, and the tier that would fix it (`checkTransitiveMembership`) needs
Enterprise or Cloud Identity Premium. See cyc-seattle/isthmia#65 and cyc-seattle/isthmia#98.

**A re-enqueue never resets a struggling task's failure count.** Every run re-enqueues every due
unit of work, but the sync queue's (`src/syncs/runtime/`) carries a task's `attempts` and `last_error`
forward as long as it isn't `done` or `cancelled`, so a task failing every night stays visibly at
that count instead of resetting to zero each run. Once `attempts` reaches `max_attempts`, the queue
sets `needs_attention` on the row but keeps retrying it on its normal backoff schedule — a stuck
task must self-heal once the underlying Google outage clears, not sit parked until a human notices
and re-enqueues it by hand.

### Open questions

- **Sync notifications.** Deferred (cyc-seattle/isthmia#122). `sync_tasks.needs_attention` makes a chronically failing
  task visible in the Directus admin UI today.
