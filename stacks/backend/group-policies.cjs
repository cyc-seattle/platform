// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Keeps each user's own policy links equal to what their groups give (docs/access.md). It manages
// only links to the policies a group may give, and only for users on the roles it's told, so it
// never touches a machine user or the first admin account. It also moves a user between Community
// and Team as they join and leave a team, and never changes any other role, and gives each user
// their person's first and last name. It also keeps Authentik's sign-in groups equal to who holds
// each sign-in policy, and removes any other policy linked straight to a managed user, so a policy
// comes only from a role or a group.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const path = require("node:path");

const WATCHED = new Set(["groups", "group_members", "group_policies"]);
// What decides who is on a team.
const TEAM_WATCHED = new Set(["registrations", "offerings", "programs", "contacts"]);
// Coalesces a burst of changes, such as a sync updating many people, into one pass.
const DEBOUNCE_MS = 500;

/**
 * The links to add and remove, and the logins to link to a person. A login's person is its
 * `person_id`, and a person can have several. A login with none is linked by email, once: only when
 * one person has that email, or one of them is the parent of every other person with it, and that
 * person has no login yet. Families share an email, and the Clubspot sync rewrites it, so after that
 * the stored link is what counts. A person's email can be changed to one a stranger signs in with,
 * so only an admin links a second login.
 *
 * `emailCounts` is how many people have each lowercased email; `linkedPeople` are the people some
 * login is already linked to; `guardianLinks` are the guardian links between people who share an
 * email, as `{ subject, contact }`.
 */
function plan({ users, people, grants, links, emailCounts, linkedPeople, guardianLinks = [] }) {
  const managed = new Set(users.map((user) => user.id));
  const byEmail = new Map();
  for (const person of people) {
    const email = person.email?.toLowerCase();
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), person.id]);
  }
  const parent = parentByEmail(people, emailCounts, guardianLinks);
  const personOf = new Map();
  const taken = new Set(linkedPeople);
  for (const user of users) {
    if (user.person_id) {
      personOf.set(user.id, user.person_id);
      taken.add(user.person_id);
    }
  }
  const link = [];
  const unlinked = [];
  for (const user of users) {
    if (user.person_id) continue;
    const email = user.email?.toLowerCase();
    const matches = email ? (byEmail.get(email) ?? []) : [];
    if (matches.length === 0) continue;
    const count = emailCounts[email] ?? 0;
    const person = count === 1 && matches.length === 1 ? matches[0] : parent.get(email);
    if (person === undefined) {
      unlinked.push({ user: user.id, reason: "has an email more than one person has" });
      continue;
    }
    if (taken.has(person)) {
      unlinked.push({ user: user.id, reason: "has the email of a person who already has a login" });
      continue;
    }
    taken.add(person);
    personOf.set(user.id, person);
    link.push({ person, user: user.id });
  }

  const policiesOf = new Map();
  for (const { person_id, policy_id } of grants) {
    policiesOf.set(person_id, [...(policiesOf.get(person_id) ?? []), policy_id]);
  }
  const wanted = new Set();
  for (const [user, person] of personOf) {
    if (!managed.has(user)) continue;
    for (const policy of policiesOf.get(person) ?? []) wanted.add(`${user} ${policy}`);
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
  return { add, remove, link, unlinked, personOf };
}

/**
 * Per sign-in policy name, the lowercased emails of the active logins whose person a group gives it.
 * `policies` maps each sign-in policy's id to its name.
 */
function signInMembers({ users, personOf, grants, policies }) {
  const given = new Map();
  for (const { person_id, policy_id } of grants) {
    if (!(policy_id in policies)) continue;
    given.set(person_id, new Set([...(given.get(person_id) ?? []), policies[policy_id]]));
  }
  const members = Object.fromEntries(Object.values(policies).map((name) => [name, new Set()]));
  for (const user of users) {
    const email = user.email?.toLowerCase();
    // A suspended or archived login keeps its Directus links, but signs in to nothing.
    if (!email || user.status !== "active") continue;
    for (const name of given.get(personOf.get(user.id)) ?? []) members[name].add(email);
  }
  return Object.fromEntries(Object.entries(members).map(([name, emails]) => [name, [...emails].sort()]));
}

/**
 * The Authentik users to add to a group and take out of it, by pk. `members` are its users now,
 * `wanted` the lowercased emails it should hold, and `found` the pk of each wanted email's active
 * Authentik user. Someone who has never signed in has none, and joins on a later pass.
 */
function groupChanges({ members, wanted, found }) {
  const want = new Set(wanted);
  const have = new Set(members.map((member) => member.email?.toLowerCase()));
  return {
    add: wanted.filter((email) => !have.has(email) && found[email] !== undefined).map((email) => found[email]),
    remove: members.filter((member) => !want.has(member.email?.toLowerCase())).map((member) => member.pk),
  };
}

/**
 * Makes each Authentik group in `members`, by name, hold exactly those emails' users. `request`
 * calls Authentik's API with a path and options, and returns the parsed body.
 */
async function syncAuthentik({ members, request, logger }) {
  for (const [name, wanted] of Object.entries(members)) {
    try {
      await syncAuthentikGroup({ name, wanted, request, logger });
    } catch (error) {
      logger.warn(error, `group-policies: couldn't update Authentik's ${name} group`);
    }
  }
}

/**
 * One sign-in group. Takes people out before looking anyone up or adding them, so a failure part way
 * never keeps in someone who should be out.
 */
async function syncAuthentikGroup({ name, wanted, request, logger }) {
  const { results } = await request(`/core/groups/?name=${encodeURIComponent(name)}&include_users=true`);
  const group = results.find((result) => result.name === name);
  if (!group) {
    logger.warn(`group-policies: Authentik has no ${name} group yet`);
    return;
  }
  const current = group.users_obj ?? [];
  const { remove } = groupChanges({ members: current, wanted, found: {} });
  for (const pk of remove) await request(`/core/groups/${group.pk}/remove_user/`, { method: "POST", body: { pk } });

  const have = new Set(current.map((member) => member.email?.toLowerCase()));
  const found = {};
  for (const email of wanted.filter((email) => !have.has(email))) {
    const users = await request(`/core/users/?email=${encodeURIComponent(email)}&is_active=true`);
    const user = users.results.find((result) => result.email?.toLowerCase() === email);
    if (user) found[email] = user.pk;
  }
  const { add } = groupChanges({ members: current, wanted, found });
  for (const pk of add) await request(`/core/groups/${group.pk}/add_user/`, { method: "POST", body: { pk } });
  if (add.length > 0 || remove.length > 0) {
    logger.info(`group-policies: added ${add.length} to and took ${remove.length} out of Authentik's ${name} group`);
  }
}

/** Calls Authentik's API with the address and token in `dir`, or returns undefined until they're there. */
function authentikRequester(dir) {
  let url, token;
  try {
    url = fs.readFileSync(path.join(dir, "url"), "utf8").trim();
    token = fs.readFileSync(path.join(dir, "token"), "utf8").trim();
  } catch {
    return undefined;
  }
  return async (route, { method = "GET", body } = {}) => {
    const response = await fetch(`${url}/api/v3${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Authentik answered ${method} ${route} with ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
}

/**
 * Per lowercased email that several people share, the one who is the parent of all the others, if
 * there is one: a family that signs its children up with a parent's email.
 */
function parentByEmail(people, emailCounts, guardianLinks) {
  const groups = new Map();
  for (const person of people) {
    const email = person.email?.toLowerCase();
    if (!email || (emailCounts[email] ?? 0) < 2) continue;
    groups.set(email, [...(groups.get(email) ?? []), person.id]);
  }
  const children = new Map();
  for (const { subject, contact } of guardianLinks) {
    children.set(contact, new Set([...(children.get(contact) ?? []), subject]));
  }
  const parent = new Map();
  for (const [email, ids] of groups) {
    // Someone with the email who isn't loaded leaves it ambiguous.
    if (ids.length !== emailCounts[email]) continue;
    const parents = ids.filter((id) => ids.every((other) => other === id || children.get(id)?.has(other)));
    if (parents.length === 1) parent.set(email, parents[0]);
  }
  return parent;
}

/**
 * The users to move between Community and Team. A user on either is Team while their person
 * (`personOf`) is on a team (`onTeam`), and Community otherwise. Every other role stays as it is.
 */
function teamMoves({ users, personOf, onTeam, community, team }) {
  const moves = [];
  for (const user of users) {
    if (user.role !== community && user.role !== team) continue;
    const role = onTeam.has(personOf.get(user.id)) ? team : community;
    if (role !== user.role) moves.push({ user: user.id, role });
  }
  return moves;
}

/**
 * The users whose first and last name differ from their person's. `personOf` maps a user to their
 * person, and a user it doesn't map keeps the name they have.
 */
function renames({ users, people, personOf }) {
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

  // Authentik is a copy: a pass that can't reach it still applies Directus's links, and the next
  // pass catches Authentik up.
  let authentikWarned = false;
  let grantableWarned = false;
  async function copyToAuthentik({ users, personOf, grants }) {
    const request = authentikRequester(config.authentikDir);
    if (!request) {
      if (!authentikWarned) logger.warn("group-policies: no Authentik token yet, so sign-in groups wait");
      authentikWarned = true;
      return;
    }
    authentikWarned = false;
    const rows = await database("directus_policies").select("id", "name").whereIn("name", config.signIn);
    const policies = Object.fromEntries(rows.map((row) => [row.id, row.name]));
    try {
      await syncAuthentik({ members: signInMembers({ users, personOf, grants, policies }), request, logger });
    } catch (error) {
      logger.warn(error, "group-policies: couldn't update Authentik's sign-in groups");
    }
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
          "directus_users.person_id",
          "directus_users.status",
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
    const linkedIds = [...new Set(users.map((user) => user.person_id).filter(Boolean))];
    const emails = [
      ...new Set(users.filter((user) => !user.person_id && user.email).map((user) => user.email.toLowerCase())),
    ];
    // Everyone a managed user is, or could be linked to: the people the logins' emails name, all of
    // them, so the hook can tell which one is the parent.
    const people = await database("people")
      .select("id", "email", "first_name", "last_name")
      .where((where) => {
        where.whereIn("id", linkedIds);
        if (emails.length > 0) where.orWhereIn(database.raw("lower(email)"), emails);
      });
    // Every policy linked straight to a user, so the plan removes any a group doesn't give. With no
    // grantable policies found, the config and Directus disagree, so it changes no links at all.
    if (ids.length === 0) {
      if (!grantableWarned) logger.warn("group-policies: Directus has none of the policies a group can give");
      grantableWarned = true;
    } else {
      grantableWarned = false;
    }
    const links =
      ids.length === 0 ? [] : await database("directus_access").select("id", "user", "policy").whereNotNull("user");
    const emailCounts = {};
    for (const person of people) {
      const email = person.email?.toLowerCase();
      if (email && emails.includes(email)) emailCounts[email] = (emailCounts[email] ?? 0) + 1;
    }

    // Only the people a login could be linked to by email need checking.
    const candidates = people.filter((person) => person.email && emails.includes(person.email.toLowerCase()));
    const linkedPeople =
      candidates.length === 0
        ? []
        : (
            await database("directus_users")
              .distinct("person_id")
              .whereIn(
                "person_id",
                candidates.map((person) => person.id),
              )
          ).map((row) => row.person_id);

    const shared = people.filter((person) => person.email && emailCounts[person.email.toLowerCase()] > 1);
    const sharedIds = shared.map((person) => person.id);
    const guardianLinks =
      sharedIds.length === 0
        ? []
        : await database("contacts")
            .select("subject_id as subject", "contact_id as contact")
            .where("relationship_type", "guardian")
            .whereIn("subject_id", sharedIds)
            .whereIn("contact_id", sharedIds);

    const { add, remove, link, unlinked, personOf } = plan({
      users,
      people,
      grants,
      links,
      emailCounts,
      linkedPeople,
      guardianLinks,
    });
    // Logged once per login and reason, not on every 15-minute run.
    const warnings = new Set(unlinked.map(({ user, reason }) => `group-policies: login ${user} ${reason}`));
    for (const warning of warnings) {
      if (!warned.has(warning)) logger.warn(`${warning}, so an admin must link it to its person by hand`);
    }
    warned = warnings;
    const schema = await getSchema();
    const usersService = new services.UsersService({ schema, knex: database });
    for (const { person, user } of link) {
      await usersService.updateOne(user, { person_id: person }, { emitEvents: false });
    }
    if (link.length > 0) logger.info(`group-policies: linked ${link.length} logins to their people`);
    if (add.length > 0 || remove.length > 0) {
      // Through the service, so Directus clears its permission caches.
      const access = new services.AccessService({ schema, knex: database });
      if (remove.length > 0) await access.deleteMany(remove);
      if (add.length > 0) await access.createMany(add);
      logger.info(`group-policies: gave ${add.length} and took away ${remove.length} policy links`);
    }

    if (ids.length > 0) await copyToAuthentik({ users, personOf, grants });

    const named = renames({ users, people, personOf });
    if (named.length > 0) {
      for (const { user, first_name, last_name } of named) {
        await usersService.updateOne(user, { first_name, last_name }, { emitEvents: false });
      }
      logger.info(`group-policies: named ${named.length} users from their people`);
    }

    const families = new Set(
      users.filter((user) => user.role === config.community || user.role === config.team).map((user) => user.id),
    );
    const familyIds = [...new Set([...personOf].filter(([user]) => families.has(user)).map(([, person]) => person))];
    const moves = teamMoves({
      users,
      personOf,
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
    if (["email", "logins", "first_name", "last_name"].some((field) => field in payload)) request();
  });
  // Deleting a person empties their logins' person_id, which emits no event of its own.
  action("people.items.delete", request);
  action("users.create", request);
  action("users.update", ({ payload }) => {
    if (["role", "email", "person_id"].some((field) => field in payload)) request();
  });
  // A policy an admin links straight to a login is taken away at once, not at the next scheduled run. The
  // hook's own links set this off too, and that pass finds nothing to change.
  action("access.create", request);
  action("access.update", request);
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
module.exports.signInMembers = signInMembers;
module.exports.groupChanges = groupChanges;
module.exports.syncAuthentik = syncAuthentik;
