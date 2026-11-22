import { type GroupMember } from "@cyc-seattle/gsuite-sdk";
import { isValidEmail, normalizeEmail, type PersonRow } from "../../model/crm/index.ts";
import { isPerson, MASS_REMOVAL_LIMIT } from "./access-groups.ts";
import { type MembershipTables, planProgramMembers, programLeavers } from "./membership.ts";
import { type GoogleGroupMembershipRow } from "./schema.ts";

export interface MembershipRowUpdate {
  id: string;
  patch: Partial<Omit<GoogleGroupMembershipRow, "id">>;
}

/** What one program group's membership task writes: Google adds first, then the rows that record them. */
export interface MembershipWritePlan {
  add: string[];
  create: Omit<GoogleGroupMembershipRow, "id">[];
  update: MembershipRowUpdate[];
}

/** A person's row in one group. Rows are keyed by group and person, but a person merge can leave
 * two; a removed one wins, so a merge never undoes a removal. */
function rowFor(rows: readonly GoogleGroupMembershipRow[]): GoogleGroupMembershipRow | undefined {
  return rows.find((row) => row.removed_at != null) ?? rows[0];
}

/**
 * Plans one program group's membership writes from its planned people, its live members, and the
 * `google_group_memberships` rows the sync has already written for it (cyc-seattle/isthmia#265):
 *
 * | Live? | Row               | Action                                  |
 * | ----- | ----------------- | --------------------------------------- |
 * | yes   | none              | write a row                             |
 * | yes   | `removed_at` null | nothing                                 |
 * | yes   | `removed_at` set  | clear `removed_at`                      |
 * | no    | none              | add, and write a row                    |
 * | no    | `removed_at` null | set `removed_at`, don't add             |
 * | no    | `removed_at` set  | skip                                    |
 *
 * People are matched to rows by person, and to live members by their current email. A row whose
 * email differs from the person's current one recorded an old address, so it says nothing about
 * the new one: the sync adds the new address and updates the row. People who share an address
 * share its fate: if any of them has a row that records it removed, nobody re-adds it.
 */
export function planMembershipWrites(
  groupId: string,
  people: readonly Pick<PersonRow, "id" | "email">[],
  liveEmails: ReadonlySet<string>,
  rows: readonly GoogleGroupMembershipRow[],
  now: Date,
): MembershipWritePlan {
  const timestamp = now.toISOString();
  const live = new Set([...liveEmails].map(normalizeEmail));

  const rowsByPerson = new Map<string, GoogleGroupMembershipRow[]>();
  for (const row of rows) {
    if (row.group_id === groupId) {
      rowsByPerson.set(row.person_id, [...(rowsByPerson.get(row.person_id) ?? []), row]);
    }
  }

  const peopleByEmail = new Map<string, string[]>();
  for (const person of people) {
    if (!person.id || !person.email || !isValidEmail(person.email)) {
      continue;
    }
    const email = normalizeEmail(person.email);
    const ids = peopleByEmail.get(email) ?? [];
    if (!ids.includes(person.id)) {
      peopleByEmail.set(email, [...ids, person.id]);
    }
  }

  const plan: MembershipWritePlan = { add: [], create: [], update: [] };
  const create = (personId: string, email: string): void => {
    plan.create.push({ group_id: groupId, person_id: personId, email, added_at: timestamp, removed_at: null });
  };

  for (const [email, personIds] of [...peopleByEmail].sort(([a], [b]) => a.localeCompare(b))) {
    const entries = personIds.map((personId) => ({ personId, row: rowFor(rowsByPerson.get(personId) ?? []) }));

    if (live.has(email)) {
      for (const { personId, row } of entries) {
        if (!row?.id) {
          create(personId, email);
          continue;
        }
        const patch: MembershipRowUpdate["patch"] = {};
        if (row.removed_at != null) {
          patch.removed_at = null;
        }
        if (normalizeEmail(row.email) !== email) {
          patch.email = email;
        }
        if (Object.keys(patch).length > 0) {
          plan.update.push({ id: row.id, patch });
        }
      }
      continue;
    }

    const removed = entries.some(
      ({ row }) => row != null && (row.removed_at != null || normalizeEmail(row.email) === email),
    );
    if (removed) {
      for (const { row } of entries) {
        if (!row?.id) {
          continue;
        }
        const patch: MembershipRowUpdate["patch"] = {};
        if (row.removed_at == null) {
          patch.removed_at = timestamp;
        }
        if (normalizeEmail(row.email) !== email) {
          patch.email = email;
        }
        if (Object.keys(patch).length > 0) {
          plan.update.push({ id: row.id, patch });
        }
      }
      continue;
    }

    plan.add.push(email);
    for (const { personId, row } of entries) {
      if (row?.id) {
        plan.update.push({ id: row.id, patch: { email, added_at: timestamp } });
      } else {
        create(personId, email);
      }
    }
  }

  return plan;
}

/** The people whose row in `groupId` records them as removed - the audit treats them as intentionally absent. */
export function removedPersonIds(groupId: string, rows: readonly GoogleGroupMembershipRow[]): Set<string> {
  return new Set(rows.filter((row) => row.group_id === groupId && row.removed_at != null).map((row) => row.person_id));
}

/** Who a program's Google Group loses because their term ended, and the rows that recorded them. */
export interface ProgramGroupRemovals {
  remove: string[];
  /** The `google_group_memberships` rows to delete, so a new term adds them again. */
  forget: string[];
  /** More than `MASS_REMOVAL_LIMIT`, which waits for `allowMassRemoval`. */
  massRemoval: boolean;
}

/**
 * The plain members to take out of a Google Group because their last term for a program that fills
 * it has ended. `programIds` is every program that fills the group, since they share it. Someone
 * still there as a family, on any of those programs' rosters past or present, or with a current term
 * for any of them, stays. So does a manager, an owner, or anyone the sync didn't plan.
 */
export function planProgramGroupRemovals(
  programIds: readonly string[],
  groupId: string,
  tables: MembershipTables,
  live: readonly GroupMember[],
  rows: readonly GoogleGroupMembershipRow[],
  now: Date,
): ProgramGroupRemovals {
  const keep = new Set(
    programIds.flatMap((programId) => planProgramMembers(programId, tables, now, { includeInactiveCamps: true })),
  );
  const leavers = new Map<string, Set<string>>();
  for (const programId of programIds) {
    for (const person of programLeavers(programId, tables, now)) {
      if (!person.id || !person.email || !isValidEmail(person.email)) continue;
      const email = normalizeEmail(person.email);
      leavers.set(email, new Set([...(leavers.get(email) ?? []), person.id]));
    }
  }
  const plain = new Set(
    live.filter((member) => member.role === "MEMBER" && isPerson(member)).map((member) => normalizeEmail(member.email)),
  );
  const remove = [...leavers.keys()].filter((email) => plain.has(email) && !keep.has(email)).sort();
  const removed = new Set(remove);
  const forget = rows
    .filter(
      (row) =>
        row.id &&
        row.group_id === groupId &&
        removed.has(normalizeEmail(row.email)) &&
        leavers.get(normalizeEmail(row.email))?.has(row.person_id),
    )
    .map((row) => row.id as string);
  return { remove, forget, massRemoval: remove.length > MASS_REMOVAL_LIMIT };
}
