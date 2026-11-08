import { type ContactRow, type HouseholdRow, type PersonRow } from "../../model/crm/index.ts";

/**
 * Households, made from the CRM's guardian links on every run. A household is everyone joined
 * through a sailor: the sailor, each of their guardians, and those guardians' other children, so
 * parents with separate Clubspot accounts land together. Clubspot decides who's linked to whom, and
 * a staff merge of two people changes the links, so the next run follows it. Emergency contacts
 * join no household.
 */

export type HouseholdPerson = Pick<PersonRow, "share_contact" | "household_id"> & { id: string };
export type HouseholdLink = Pick<ContactRow, "subject_id" | "contact_id" | "relationship_type">;

/**
 * Two households' answers as one, when their people come together: any no is a no, so one parent's
 * yes never shares a co-parent who said no. Otherwise any yes is a yes, and all blank stays blank.
 */
export function combineSharing(values: readonly (boolean | null | undefined)[]): boolean | null {
  if (values.includes(false)) return false;
  if (values.includes(true)) return true;
  return null;
}

export interface HouseholdPlan {
  create: HouseholdRow[];
  update: HouseholdRow[];
  /** Moves each person into their household, or out of one when they no longer belong in any. */
  people: { id: string; household_id: string | null }[];
  /** Households no one belongs to any more, deleted after `people` has moved everyone out. */
  delete: string[];
}

/** Groups `ids` into sets joined by `links`, each sorted, in the order of their first id. */
function components(ids: Iterable<string>, links: readonly [string, string][]): string[][] {
  const parent = new Map<string, string>();
  for (const id of ids) parent.set(id, id);
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const [a, b] of links) {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const groups = new Map<string, string[]>();
  for (const id of [...parent.keys()].sort()) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  return [...groups.values()];
}

/**
 * Plans every household from scratch, keeping each existing one where most of its people still
 * are, so an id, and the answer it holds, stays put as families change. A household split in two
 * gives the new one a copy of its answer. Two that join keep the answer `combineSharing` makes. A
 * household made where none was takes its people's own answers from before households held them,
 * which is how the first run moves `people.share_contact` onto households, and so does someone who
 * joins a household from none.
 */
export function planHouseholds(
  people: readonly HouseholdPerson[],
  links: readonly HouseholdLink[],
  sailors: readonly string[],
  households: readonly HouseholdRow[],
  newId: () => string,
): HouseholdPlan {
  const personById = new Map(people.map((person) => [person.id, person]));
  const householdById = new Map(households.map((household) => [household.id, household]));
  const guardianLinks = links
    .filter((link) => link.relationship_type === "guardian")
    .filter((link) => personById.has(link.subject_id) && personById.has(link.contact_id))
    .map((link): [string, string] => [link.subject_id, link.contact_id]);
  const members = new Set([...guardianLinks.flat(), ...sailors.filter((id) => personById.has(id))]);
  const groups = components(members, guardianLinks);

  // Each existing household goes to the group holding most of its people, the first on a tie.
  const counts = new Map<string, Map<number, number>>();
  groups.forEach((group, index) => {
    for (const id of group) {
      const current = personById.get(id)!.household_id;
      if (!current || !householdById.has(current)) continue;
      const byGroup = counts.get(current) ?? new Map<number, number>();
      byGroup.set(index, (byGroup.get(index) ?? 0) + 1);
      counts.set(current, byGroup);
    }
  });
  const claims = new Map<number, { id: string; count: number }[]>();
  for (const [householdId, byGroup] of counts) {
    const [index, count] = [...byGroup].sort(([ia, ca], [ib, cb]) => cb - ca || ia - ib)[0]!;
    claims.set(index, [...(claims.get(index) ?? []), { id: householdId, count }]);
  }

  const plan: HouseholdPlan = { create: [], update: [], people: [], delete: [] };
  const kept = new Set<string>();
  groups.forEach((group, index) => {
    const keeper = (claims.get(index) ?? []).sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1))[0]?.id;
    const inHousehold = (id: string) => householdById.has(personById.get(id)!.household_id ?? "");
    const sources = new Set(group.filter(inHousehold).map((id) => personById.get(id)!.household_id!));
    // Someone joining from no household brings their answer from before households held it.
    const share_contact = combineSharing([
      ...[...sources].map((id) => householdById.get(id)!.share_contact),
      ...group.filter((id) => !inHousehold(id)).map((id) => personById.get(id)!.share_contact),
    ]);
    let householdId: string;
    if (keeper) {
      householdId = keeper;
      kept.add(keeper);
      if (householdById.get(keeper)!.share_contact !== share_contact) {
        plan.update.push({ id: keeper, share_contact });
      }
    } else {
      householdId = newId();
      plan.create.push({ id: householdId, share_contact });
    }
    for (const id of group) {
      if (personById.get(id)!.household_id !== householdId) {
        plan.people.push({ id, household_id: householdId });
      }
    }
  });

  for (const person of people) {
    if (person.household_id && !members.has(person.id)) {
      plan.people.push({ id: person.id, household_id: null });
    }
  }
  plan.delete = households.filter((household) => !kept.has(household.id)).map((household) => household.id);
  return plan;
}
