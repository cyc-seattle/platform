// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Keeps each user's own policy links equal to what their groups give (docs/access.md). It manages
// only links to the policies a group may give, and only for users on the roles it's told, so it
// never touches a machine user or the first admin account. It also moves a user between Community
// and Team as they join and leave a team, and never changes any other role, and gives each user
// their person's first and last name.

const WATCHED = new Set(["groups", "group_members", "group_policies"]);
// What decides who is on a team.
const TEAM_WATCHED = new Set(["registrations", "offerings", "programs", "contacts"]);
// Coalesces a burst of changes, such as a sync updating many people, into one pass.
const DEBOUNCE_MS = 500;

/**
 * The links to add and remove, and the people to link to a login. A person's user is their
 * `directus_user_id`. A person with none is linked by email, once: only when they're the one person
 * with that email, or the parent of every other person with it, and no person is linked to the
 * managed user who has it. Families share an email, and the Clubspot sync rewrites it, so after that
 * the stored link is what counts.
 *
 * `emailCounts` is how many people have each lowercased email; `linkedUsers` are the users some
 * person is already linked to; `guardianLinks` are the guardian links between people who share an
 * email, as `{ subject, contact }`.
 */
function plan({ users, people, grants, links, emailCounts, linkedUsers, guardianLinks = [] }) {
  const managed = new Set(users.map((user) => user.id));
  const byEmail = new Map(users.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user.id]));
  const taken = new Set(linkedUsers);
  const userOf = new Map();
  const link = [];
  const unlinked = [];
  const parent = parentByEmail(people, emailCounts, guardianLinks);
  for (const person of people) {
    if (person.directus_user_id) {
      userOf.set(person.id, person.directus_user_id);
      continue;
    }
    const email = person.email?.toLowerCase();
    const user = email ? byEmail.get(email) : undefined;
    if (user === undefined) continue;
    const count = emailCounts[email] ?? 0;
    if (count !== 1 && parent.has(email)) {
      if (parent.get(email) !== person.id) continue;
    } else if (count !== 1) {
      unlinked.push({ person: person.id, reason: "shares their email with another person" });
      continue;
    }
    if (taken.has(user)) {
      unlinked.push({ person: person.id, reason: "has the email of a login another person is linked to" });
    } else {
      taken.add(user);
      userOf.set(person.id, user);
      link.push({ person: person.id, user });
    }
  }

  const wanted = new Set();
  for (const { person_id, policy_id } of grants) {
    const user = userOf.get(person_id);
    if (user !== undefined && managed.has(user)) wanted.add(`${user} ${policy_id}`);
  }

  const kept = new Set();
  const remove = [];
  for (const access of links) {
    if (!managed.has(access.user)) continue;
    const key = `${access.user} ${access.policy}`;
    if (wanted.has(key) && !kept.has(key)) {
      kept.add(key);
    } else {
      remove.push(access.id);
    }
  }
  const add = [...wanted]
    .filter((key) => !kept.has(key))
    .map((key) => {
      const [user, policy] = key.split(" ");
      return { user, policy };
    });
  return { add, remove, link, unlinked, userOf };
}

/**
 * Per lowercased email that several unlinked people share, the one who is the parent of all the
 * others, if there is one: a family that signs its children up with a parent's email.
 */
function parentByEmail(people, emailCounts, guardianLinks) {
  const groups = new Map();
  for (const person of people) {
    const email = person.email?.toLowerCase();
    if (!email || person.directus_user_id || (emailCounts[email] ?? 0) < 2) continue;
    groups.set(email, [...(groups.get(email) ?? []), person.id]);
  }
  const children = new Map();
  for (const { subject, contact } of guardianLinks) {
    children.set(contact, new Set([...(children.get(contact) ?? []), subject]));
  }
  const parent = new Map();
  for (const [email, ids] of groups) {
    // Someone with the email who isn't loaded, or is already linked, leaves it ambiguous.
    if (ids.length !== emailCounts[email]) continue;
    const parents = ids.filter((id) => ids.every((other) => other === id || children.get(id)?.has(other)));
    if (parents.length === 1) parent.set(email, parents[0]);
  }
  return parent;
}

/**
 * The users to move between Community and Team. A user on either is Team while a person linked to
 * them is on a team (`onTeam`), and Community otherwise. Every other role stays as it is.
 */
function teamMoves({ users, userOf, onTeam, community, team }) {
  const teamUsers = new Set();
  for (const [person, user] of userOf) {
    if (onTeam.has(person)) teamUsers.add(user);
  }
  const moves = [];
  for (const user of users) {
    if (user.role !== community && user.role !== team) continue;
    const role = teamUsers.has(user.id) ? team : community;
    if (role !== user.role) moves.push({ user: user.id, role });
  }
  return moves;
}

/**
 * The users whose first and last name differ from their person's. `userOf` maps a person to their
 * user, and a user it doesn't map keeps the name they have.
 */
function renames({ users, people, userOf }) {
  const personOf = new Map([...userOf].map(([person, user]) => [user, person]));
  const byId = new Map(people.map((person) => [person.id, person]));
  const updates = [];
  for (const user of users) {
    const person = byId.get(personOf.get(user.id));
    if (!person) continue;
    const first_name = person.first_name ?? null;
    const last_name = person.last_name ?? null;
    if (first_name === (user.first_name ?? null) && last_name === (user.last_name ?? null)) continue;
    updates.push({ user: user.id, first_name, last_name });
  }
  return updates;
}

/**
 * Moves each user to their new role, but only if they're still on one of the `family` roles: an
 * admin may have changed their role since the hook read it. The row lock makes an admin's change
 * that lands meanwhile wait, then win. Through the service, so Directus clears its permission caches.
 * Returns how many users moved to each role.
 */
async function applyMoves({ database, usersService, moves, roleIds, family }) {
  const moved = {};
  for (const role of new Set(moves.map((move) => move.role))) {
    const ids = moves.filter((move) => move.role === role).map((move) => move.user);
    await database.transaction(async (trx) => {
      const still = (
        await trx("directus_users")
          .select("id")
          .whereIn("id", ids)
          .whereIn(
            "role",
            family.map((name) => roleIds[name]),
          )
          .forUpdate()
      ).map((row) => row.id);
      if (still.length === 0) return;
      await usersService(trx).updateMany(still, { role: roleIds[role] }, { emitEvents: false });
      moved[role] = still.length;
    });
  }
  return moved;
}

/**
 * Runs `pass` now, or once more after the one running, however many times it's asked meanwhile. A
 * steady stream of changes, such as a sync's, would otherwise queue passes faster than they finish.
 */
function coalesce(pass) {
  let running;
  let again = false;
  function run() {
    if (running) {
      again = true;
      return running;
    }
    running = Promise.resolve()
      .then(pass)
      .finally(() => {
        running = undefined;
        if (again) {
          again = false;
          run();
        }
      });
    return running;
  }
  return run;
}

/** A `DirectusError` by duck type, which Directus's error handler answers with its status. */
function invalid(reason) {
  const error = new Error(reason);
  error.name = "DirectusError";
  error.code = "INVALID_PAYLOAD";
  error.status = 400;
  error.extensions = { reason };
  return error;
}

function register({ filter, action, schedule }, { services, database, getSchema, env, logger }) {
  // Written beside this file by `backend`, from ./policies.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
  const config = require("./config.json");
  const bootstrapAdmin = String(env["ADMIN_EMAIL"] ?? "").toLowerCase();
  // The warnings the last pass logged.
  let warned = new Set();

  const grantableIds = async (db) =>
    (await db("directus_policies").select("id").whereIn("name", config.grantable)).map((row) => row.id);

  /** The people signed up for a team, and the parents of each, among `familyIds`. */
  async function onATeam(familyIds) {
    if (familyIds.length === 0) return new Set();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - config.teamMonths);
    const sailors = database("registrations")
      .join("offerings", "offerings.id", "registrations.offering_id")
      .join("programs", "programs.id", "offerings.program_id")
      .select("registrations.person_id")
      .where("registrations.status", "confirmed")
      .where("programs.team", true)
      .where((where) => where.whereNull("offerings.ends_on").orWhere("offerings.ends_on", ">=", cutoff));
    const onTeam = await database("people").select("id").whereIn("id", familyIds).whereIn("id", sailors.clone());
    const parents = await database("contacts")
      .select("contact_id as id")
      .where("relationship_type", "guardian")
      .whereIn("contact_id", familyIds)
      .whereIn("subject_id", sailors.clone());
    return new Set([...onTeam, ...parents].map((row) => row.id));
  }

  async function reconcile() {
    const ids = await grantableIds(database);
    const users = (
      await database("directus_users")
        .join("directus_roles", "directus_roles.id", "directus_users.role")
        .select(
          "directus_users.id",
          "directus_users.email",
          "directus_users.first_name",
          "directus_users.last_name",
          "directus_roles.name as role",
        )
        .whereIn("directus_roles.name", config.roles)
    ).filter((user) => (user.email ?? "").toLowerCase() !== bootstrapAdmin);
    const grants =
      ids.length === 0
        ? []
        : await database("group_members")
            .join("group_policies", "group_policies.group_id", "group_members.group_id")
            .select("group_members.person_id", "group_policies.policy_id")
            .whereIn("group_policies.policy_id", ids);
    const personIds = [...new Set(grants.map((grant) => grant.person_id))];
    const userIds = users.map((user) => user.id);
    const userEmails = [...new Set(users.filter((user) => user.email).map((user) => user.email.toLowerCase()))];
    // Everyone a managed user is, or could be linked to: the Team role needs a family's person too.
    const people = await database("people")
      .select("id", "email", "first_name", "last_name", "directus_user_id")
      .where((where) => {
        where.whereIn("id", personIds).orWhereIn("directus_user_id", userIds);
        if (userEmails.length > 0) where.orWhereIn(database.raw("lower(email)"), userEmails);
      });
    const links =
      ids.length === 0
        ? []
        : await database("directus_access").select("id", "user", "policy").whereNotNull("user").whereIn("policy", ids);
    const emails = [
      ...new Set(people.filter((person) => !person.directus_user_id && person.email).map((p) => p.email.toLowerCase())),
    ];
    const emailCounts = {};
    const linkedUsers = [];
    if (emails.length > 0) {
      const counts = await database("people")
        .select(database.raw("lower(email) as email"))
        .count("* as count")
        .whereIn(database.raw("lower(email)"), emails)
        .groupByRaw("lower(email)");
      for (const row of counts) emailCounts[row.email] = Number(row.count);
      const candidates = users.filter((user) => user.email && emails.includes(user.email.toLowerCase()));
      if (candidates.length > 0) {
        const rows = await database("people")
          .select("directus_user_id")
          .whereIn(
            "directus_user_id",
            candidates.map((user) => user.id),
          );
        linkedUsers.push(...rows.map((row) => row.directus_user_id));
      }
    }

    const shared = people.filter(
      (person) => !person.directus_user_id && person.email && emailCounts[person.email.toLowerCase()] > 1,
    );
    const sharedIds = shared.map((person) => person.id);
    const guardianLinks =
      sharedIds.length === 0
        ? []
        : await database("contacts")
            .select("subject_id as subject", "contact_id as contact")
            .where("relationship_type", "guardian")
            .whereIn("subject_id", sharedIds)
            .whereIn("contact_id", sharedIds);

    const { add, remove, link, unlinked, userOf } = plan({
      users,
      people,
      grants,
      links,
      emailCounts,
      linkedUsers,
      guardianLinks,
    });
    // Logged once per person and reason, not on every 15-minute run.
    const warnings = new Set(unlinked.map(({ person, reason }) => `group-policies: person ${person} ${reason}`));
    for (const warning of warnings) {
      if (!warned.has(warning)) logger.warn(`${warning}, so an admin must link their login by hand`);
    }
    warned = warnings;
    const schema = await getSchema();
    if (link.length > 0) {
      const items = new services.ItemsService("people", { schema, knex: database });
      for (const { person, user } of link) {
        await items.updateOne(person, { directus_user_id: user }, { emitEvents: false });
      }
      logger.info(`group-policies: linked ${link.length} people to their logins`);
    }
    if (add.length > 0 || remove.length > 0) {
      // Through the service, so Directus clears its permission caches.
      const access = new services.AccessService({ schema, knex: database });
      if (remove.length > 0) await access.deleteMany(remove);
      if (add.length > 0) await access.createMany(add);
      logger.info(`group-policies: gave ${add.length} and took away ${remove.length} policy links`);
    }

    const named = renames({ users, people, userOf });
    if (named.length > 0) {
      const usersService = new services.UsersService({ schema, knex: database });
      for (const { user, first_name, last_name } of named) {
        await usersService.updateOne(user, { first_name, last_name }, { emitEvents: false });
      }
      logger.info(`group-policies: named ${named.length} users from their people`);
    }

    const families = new Set(
      users.filter((user) => user.role === config.community || user.role === config.team).map((user) => user.id),
    );
    const familyIds = [...userOf].filter(([, user]) => families.has(user)).map(([person]) => person);
    const moves = teamMoves({
      users,
      userOf,
      onTeam: await onATeam(familyIds),
      community: config.community,
      team: config.team,
    });
    if (moves.length === 0) return;
    const roles = await database("directus_roles")
      .select("id", "name")
      .whereIn("name", [config.community, config.team]);
    const roleIds = Object.fromEntries(roles.map((role) => [role.name, role.id]));
    for (const role of [config.community, config.team]) {
      if (!(role in roleIds)) throw new Error(`group-policies: Directus has no ${role} role`);
    }
    const moved = await applyMoves({
      database,
      usersService: (knex) => new services.UsersService({ schema, knex }),
      moves,
      roleIds,
      family: [config.community, config.team],
    });
    for (const [role, count] of Object.entries(moved)) {
      logger.info(`group-policies: moved ${count} users to ${role}`);
    }
  }

  const run = coalesce(() => reconcile().catch((error) => logger.error(error, "group-policies: reconcile failed")));
  let timer;
  function request() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      run();
    }, DEBOUNCE_MS);
  }

  for (const event of ["items.create", "items.update", "items.delete"]) {
    action(event, ({ collection }) => {
      if (WATCHED.has(collection) || TEAM_WATCHED.has(collection)) request();
    });
  }
  action("people.items.create", request);
  action("people.items.update", ({ payload }) => {
    if (["email", "directus_user_id", "first_name", "last_name"].some((field) => field in payload)) request();
  });
  action("users.create", request);
  action("users.update", ({ payload }) => {
    if ("role" in payload || "email" in payload) request();
  });
  // Catches anything the actions missed, such as a cascade, which emits no event, and closes the
  // team window as time passes.
  schedule("*/15 * * * *", request);

  async function checkPolicy(payload, db) {
    if (!("policy_id" in payload)) return;
    const id = typeof payload.policy_id === "object" ? payload.policy_id?.id : payload.policy_id;
    if (!(await grantableIds(db)).includes(id)) {
      throw invalid(`A group can only give one of these policies: ${config.grantable.join(", ")}.`);
    }
  }
  for (const event of ["group_policies.items.create", "group_policies.items.update"]) {
    filter(event, async (payload, _meta, { database: db }) => {
      await checkPolicy(payload, db ?? database);
      return payload;
    });
  }
}

module.exports = register;
module.exports.plan = plan;
module.exports.teamMoves = teamMoves;
module.exports.renames = renames;
module.exports.applyMoves = applyMoves;
module.exports.coalesce = coalesce;
