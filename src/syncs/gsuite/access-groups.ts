import { type GroupMember } from "@cyc-seattle/gsuite-sdk";
import { isValidEmail, normalizeEmail, type PersonRow } from "../../model/crm/index.ts";
import { type DirectusClient } from "../runtime/index.ts";
import { type GoogleGroupRow, type ProgramWithGoogleGroup } from "./schema.ts";

// A group in the CRM (`schemas/access.yaml`), such as the Board of Directors, can fill a Google
// Group: its members become exactly the group's members (docs/access.md). This module is the one
// place that decides which Google Groups a program or a group fills.

/** A `groups` row, with the Google Group it fills (`groups.google_group_id`, in `schemas/gsuite.yaml`). */
export interface AccessGroupRow {
  id?: string;
  name: string;
  google_group_id: string | null;
}

/** A `group_members` row: one person in one group. */
export interface AccessGroupMemberRow {
  group_id: string;
  person_id: string;
}

/** What fills one Google Group: a program, or a group in the CRM. */
export type GroupSource = { program: string } | { group: string };

/** Each Google Group's sources, by `google_groups` id. */
export function googleGroupSources(
  programs: readonly Pick<ProgramWithGoogleGroup, "id" | "google_group_id">[],
  accessGroups: readonly AccessGroupRow[],
): Map<string, GroupSource[]> {
  const sources = new Map<string, GroupSource[]>();
  const add = (googleGroupId: string | null | undefined, source: GroupSource) => {
    if (googleGroupId) sources.set(googleGroupId, [...(sources.get(googleGroupId) ?? []), source]);
  };
  for (const program of programs) {
    if (program.id) add(program.google_group_id, { program: program.id });
  }
  for (const group of accessGroups) {
    if (group.id) add(group.google_group_id, { group: group.id });
  }
  return sources;
}

/**
 * The Google Groups a CRM group fills along with anything else, which the sync fills from none of
 * them until only one does. A CRM group takes out whoever isn't in it, so it can't share. Programs
 * only add, so several can share one Google Group, as they always have.
 */
export function contestedGoogleGroups(sources: ReadonlyMap<string, GroupSource[]>): Set<string> {
  return new Set(
    [...sources].filter(([, from]) => from.length > 1 && from.some((source) => "group" in source)).map(([id]) => id),
  );
}

/** The people in a group, each once. */
export function accessGroupPeople(
  groupId: string,
  members: readonly AccessGroupMemberRow[],
  people: readonly PersonRow[],
): PersonRow[] {
  const ids = new Set(members.filter((member) => member.group_id === groupId).map((member) => member.person_id));
  return people.filter((person) => person.id && ids.has(person.id));
}

/** More removals than this in one run, or every plain member, waits for `allowMassRemoval`. */
export const MASS_REMOVAL_LIMIT = 5;

/** The slice of `DirectoryClient` planning a CRM group's Google Group reads through. */
export interface AccessGroupDirectory {
  listMembers(groupKey: string): Promise<GroupMember[]>;
  getMember(groupKey: string, memberKey: string): Promise<GroupMember | null>;
}

/** A Google Group's changes, and whether they'd take out so many that a person must allow it. */
export interface AccessGroupPlan {
  add: string[];
  remove: string[];
  massRemoval: boolean;
}

/** A member who is one person with an address: not a nested group, nor a whole domain (CUSTOMER). */
export function isPerson(member: GroupMember): boolean {
  return Boolean(member.email) && (member.type === undefined || member.type === "USER" || member.type === "EXTERNAL");
}

/** Everyone's main email, each once. One that isn't usable is skipped, and the audit reports it. */
function wantedEmails(people: readonly Pick<PersonRow, "email">[]): string[] {
  return [
    ...new Set(
      people.flatMap((person) => (person.email && isValidEmail(person.email) ? [normalizeEmail(person.email)] : [])),
    ),
  ].sort();
}

/**
 * The addresses to add to a group's Google Group and take out of it. `resolved` maps an address the
 * CRM wants, which Google lists under another, to the primary address Google answers with: an alias.
 * Only a plain member who is a person is taken out: never a manager or owner, a nested group, or a
 * whole domain.
 */
export function planAccessGroupMembers(
  people: readonly Pick<PersonRow, "email">[],
  live: readonly GroupMember[],
  resolved: ReadonlyMap<string, string> = new Map(),
): AccessGroupPlan {
  const wanted = wantedEmails(people);
  const present = new Set(live.filter((member) => member.email).map((member) => normalizeEmail(member.email)));
  const keep = new Set([...wanted, ...resolved.values()]);
  const plain = live.filter((member) => member.role === "MEMBER" && isPerson(member));
  const remove = plain
    .map((member) => normalizeEmail(member.email))
    .filter((email) => !keep.has(email))
    .sort();
  return {
    add: wanted.filter((email) => !present.has(email) && !resolved.has(email)),
    remove,
    massRemoval: remove.length > MASS_REMOVAL_LIMIT || (remove.length > 0 && remove.length === plain.length),
  };
}

/**
 * Plans a CRM group's Google Group from live state. Each address the CRM wants that Google doesn't
 * list is looked up, since Google lists a member who joined by an alias at their primary address.
 */
export async function planAccessGroup(
  people: readonly Pick<PersonRow, "email">[],
  groupEmail: string,
  directory: AccessGroupDirectory,
): Promise<AccessGroupPlan> {
  const live = await directory.listMembers(groupEmail);
  const present = new Set(live.filter((member) => member.email).map((member) => normalizeEmail(member.email)));
  const resolved = new Map<string, string>();
  for (const email of wantedEmails(people).filter((email) => !present.has(email))) {
    const member = await directory.getMember(groupEmail, email);
    if (member?.email) resolved.set(email, normalizeEmail(member.email));
  }
  return planAccessGroupMembers(people, live, resolved);
}

/** A Google Group's name for a finding: its address, or its row's id if the row is gone. */
export function googleGroupLabel(groups: readonly GoogleGroupRow[], id: string): string {
  return groups.find((group) => group.id === id)?.email ?? `google_groups row ${id}`;
}

/** The groups in the CRM, and who's in each, as the Google sync may read them. */
export function readAccessGroups(directus: DirectusClient): Promise<[AccessGroupRow[], AccessGroupMemberRow[]]> {
  return Promise.all([
    directus.readItems<AccessGroupRow>("groups", { fields: ["id", "name", "google_group_id"], limit: -1 }),
    directus.readItems<AccessGroupMemberRow>("group_members", { fields: ["group_id", "person_id"], limit: -1 }),
  ]);
}
