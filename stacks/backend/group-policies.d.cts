export interface PlanInput {
  /** The managed users, each with the person their login is linked to, if any. */
  users: { id: string; email: string | null; person_id: string | null }[];
  people: { id: string; email: string | null }[];
  grants: { person_id: string; policy_id: string }[];
  links: { id: string; user: string; policy: string }[];
  /** How many people have each lowercased email. */
  emailCounts: Record<string, number>;
  /** The people some login, managed or not, is already linked to. */
  linkedPeople: string[];
  /** The guardian links between people who share an email. */
  guardianLinks?: { subject: string; contact: string }[];
}

export interface Plan {
  add: { user: string; policy: string }[];
  remove: string[];
  /** Logins to link to a person, found by their email. */
  link: { person: string; user: string }[];
  /** Logins whose email the hook can't link to one person, and why. */
  unlinked: { user: string; reason: string }[];
  /** Each login's person, stored or just linked. */
  personOf: Map<string, string>;
}

/** The user policy links to add, the ids of those to remove, and the logins to link to a person. */
export function plan(input: PlanInput): Plan;

export interface TeamMovesInput {
  users: { id: string; role: string }[];
  /** Each login's person. */
  personOf: Map<string, string>;
  /** The people on a team. */
  onTeam: Set<string>;
  community: string;
  team: string;
}

/** The users to move between the Community and Team roles, and the role each moves to. */
export function teamMoves(input: TeamMovesInput): { user: string; role: string }[];

export interface RenamesInput {
  users: { id: string; first_name?: string | null; last_name?: string | null }[];
  people: { id: string; first_name?: string | null; last_name?: string | null }[];
  /** Each login's person. */
  personOf: Map<string, string>;
}

/** The users whose first and last name differ from their person's, and the names to give them. */
export function renames(input: RenamesInput): { user: string; first_name: string | null; last_name: string | null }[];

/** The slice of knex `applyMoves` uses. */
export interface MovesDatabase {
  transaction<T>(run: (trx: unknown) => Promise<T>): Promise<T>;
}

export interface ApplyMovesInput {
  database: MovesDatabase;
  /** Directus's UsersService on a transaction. */
  usersService: (trx: unknown) => {
    updateMany(ids: string[], data: { role: string }, options: { emitEvents: boolean }): Promise<unknown>;
  };
  moves: { user: string; role: string }[];
  /** Each role's id, by name. */
  roleIds: Record<string, string>;
  /** The roles the hook may move a user off. */
  family: string[];
}

/** Moves the users still on a `family` role, under a row lock. Returns how many moved to each role. */
export function applyMoves(input: ApplyMovesInput): Promise<Record<string, number>>;

/** Runs `pass` now, or once more after the one running, however many times it's asked meanwhile. */
export function coalesce(pass: () => Promise<unknown>): () => Promise<unknown>;

export interface SignInMembersInput {
  /** The managed users. Only an active one gets a sign-in group. */
  users: { id: string; email: string | null; status?: string | null }[];
  /** Each login's person. */
  personOf: Map<string, string>;
  grants: { person_id: string; policy_id: string }[];
  /** Each sign-in policy's name, by id. */
  policies: Record<string, string>;
}

/** Per sign-in policy name, the lowercased emails of the active logins whose person a group gives it. */
export function signInMembers(input: SignInMembersInput): Record<string, string[]>;

export interface GroupChangesInput {
  /** The group's Authentik users now. */
  members: { pk: number; email?: string | null }[];
  /** The lowercased emails the group should hold. */
  wanted: string[];
  /** Each wanted email's active Authentik user's pk, where it has one. */
  found: Record<string, number>;
}

/** The Authentik users to add to a group and take out of it, by pk. */
export function groupChanges(input: GroupChangesInput): { add: number[]; remove: number[] };

/** Calls Authentik's API at a path under `/api/v3`, and returns the parsed body. */
export type AuthentikRequest = (
  route: string,
  options?: { method?: "GET" | "POST"; body?: unknown },
) => Promise<unknown>;

/**
 * Makes each Authentik group in `members`, by name, hold exactly those emails' users, taking people
 * out first. A group that fails is logged, and the rest still run.
 */
export function syncAuthentik(input: {
  members: Record<string, string[]>;
  request: AuthentikRequest;
  logger: { info(message: string): void; warn(...args: unknown[]): void };
}): Promise<void>;
