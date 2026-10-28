export interface PlanInput {
  users: { id: string; email: string | null }[];
  people: { id: string; email: string | null; directus_user_id: string | null }[];
  grants: { person_id: string; policy_id: string }[];
  links: { id: string; user: string; policy: string }[];
  /** How many people have each lowercased email. */
  emailCounts: Record<string, number>;
  /** The users some person is already linked to. */
  linkedUsers: string[];
}

export interface Plan {
  add: { user: string; policy: string }[];
  remove: string[];
  /** People to link to a login, found by their email. */
  link: { person: string; user: string }[];
  /** People whose email matches a login the hook won't link them to, and why. */
  unlinked: { person: string; reason: string }[];
}

/** The user policy links to add, the ids of those to remove, and the people to link to a login. */
export function plan(input: PlanInput): Plan;
