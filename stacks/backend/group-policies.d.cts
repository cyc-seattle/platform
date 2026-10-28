export interface PlanInput {
  users: { id: string; email: string | null }[];
  people: { id: string; email: string | null; directus_user_id: string | null }[];
  grants: { person_id: string; policy_id: string }[];
  links: { id: string; user: string; policy: string }[];
}

/** The user policy links to add, and the ids of those to remove, so users have what their groups give. */
export function plan(input: PlanInput): { add: { user: string; policy: string }[]; remove: string[] };
