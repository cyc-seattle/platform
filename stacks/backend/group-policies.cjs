// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Keeps each user's own policy links equal to what their groups give (docs/access.md). It manages
// only links to the policies a group may give, and only for users on the roles it's told, so it
// never touches a role, a machine user, the first admin account, or a per-account admin grant.

const WATCHED = new Set(["groups", "group_members", "group_policies"]);
// Coalesces a burst of changes, such as a sync updating many people, into one pass.
const DEBOUNCE_MS = 500;

/**
 * The links to add and remove, and the people to link to a login. A person's user is their
 * `directus_user_id`. A person with none is linked by email, once: only when they're the one person
 * with that email and no person is linked to the managed user who has it. Families share an email,
 * and the Clubspot sync rewrites it, so after that the stored link is what counts.
 *
 * `emailCounts` is how many people have each lowercased email; `linkedUsers` are the users some
 * person is already linked to.
 */
function plan({ users, people, grants, links, emailCounts, linkedUsers }) {
  const managed = new Set(users.map((user) => user.id));
  const byEmail = new Map(users.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user.id]));
  const taken = new Set(linkedUsers);
  const userOf = new Map();
  const link = [];
  const unlinked = [];
  for (const person of people) {
    if (person.directus_user_id) {
      userOf.set(person.id, person.directus_user_id);
      continue;
    }
    const email = person.email?.toLowerCase();
    const user = email ? byEmail.get(email) : undefined;
    if (user === undefined) continue;
    if ((emailCounts[email] ?? 0) !== 1) {
      unlinked.push({ person: person.id, reason: "shares their email with another person" });
    } else if (taken.has(user)) {
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
  return { add, remove, link, unlinked };
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

  const grantableIds = async (db) =>
    (await db("directus_policies").select("id").whereIn("name", config.grantable)).map((row) => row.id);

  async function reconcile() {
    const ids = await grantableIds(database);
    const users = (
      await database("directus_users")
        .join("directus_roles", "directus_roles.id", "directus_users.role")
        .select("directus_users.id", "directus_users.email")
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
    const people =
      personIds.length === 0
        ? []
        : await database("people").select("id", "email", "directus_user_id").whereIn("id", personIds);
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

    const { add, remove, link, unlinked } = plan({ users, people, grants, links, emailCounts, linkedUsers });
    for (const { person, reason } of unlinked) {
      logger.warn(`group-policies: person ${person} ${reason}, so an admin must link their login by hand`);
    }
    const schema = await getSchema();
    if (link.length > 0) {
      const items = new services.ItemsService("people", { schema, knex: database });
      for (const { person, user } of link) {
        await items.updateOne(person, { directus_user_id: user }, { emitEvents: false });
      }
      logger.info(`group-policies: linked ${link.length} people to their logins`);
    }
    if (add.length === 0 && remove.length === 0) return;
    // Through the service, so Directus clears its permission caches.
    const access = new services.AccessService({ schema, knex: database });
    if (remove.length > 0) await access.deleteMany(remove);
    if (add.length > 0) await access.createMany(add);
    logger.info(`group-policies: gave ${add.length} and took away ${remove.length} policy links`);
  }

  let timer;
  let running = Promise.resolve();
  function request() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      running = running.then(reconcile).catch((error) => logger.error(error, "group-policies: reconcile failed"));
    }, DEBOUNCE_MS);
  }

  for (const event of ["items.create", "items.update", "items.delete"]) {
    action(event, ({ collection }) => {
      if (WATCHED.has(collection)) request();
    });
  }
  action("people.items.update", ({ payload }) => {
    if ("email" in payload || "directus_user_id" in payload) request();
  });
  action("users.create", request);
  action("users.update", ({ payload }) => {
    if ("role" in payload || "email" in payload) request();
  });
  // Catches anything the actions missed, such as a cascade, which emits no event.
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
