export interface PlanInput {
  users: { id: string; email: string | null }[];
  people: { id: string; email: string | null; directus_user_id: string | null }[];
  grants: { person_id: string; policy_id: string }[];
  links: { id: string; user: string; policy: string }[];
  /** How many people have each lowercased email. */
  emailCounts: Record<string, number>;
  /** The users some person is already linked to. */
  linkedUsers: string[];
  /** The guardian links between people who share an email. */
  guardianLinks?: { subject: string; contact: string }[];
}

export interface Plan {
  add: { user: string; policy: string }[];
  remove: string[];
  /** People to link to a login, found by their email. */
  link: { person: string; user: string }[];
  /** People whose email matches a login the hook won't link them to, and why. */
  unlinked: { person: string; reason: string }[];
  /** Each person's login, stored or just linked. */
  userOf: Map<string, string>;
}

/** The user policy links to add, the ids of those to remove, and the people to link to a login. */
export function plan(input: PlanInput): Plan;

export interface TeamMovesInput {
  users: { id: string; role: string }[];
  /** Each person's login. */
  userOf: Map<string, string>;
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
  /** Each person's login. */
  userOf: Map<string, string>;
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
