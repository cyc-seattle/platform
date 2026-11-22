// A Directus hook extension, mounted into Directus as-is: CommonJS, with no imports, since an
// extension's folder has no node_modules of its own.
//
// Publishes the public website when its content changes (cyc-seattle/csc-website#8): after a write
// to a website collection or a file in the Website folder, it starts csc-website's publish workflow.
// It signs in to GitHub as an App that can only start that repo's workflows. Without the App's ID
// and key it does nothing, so only prod publishes. A dispatch that fails is only logged: the
// workflow's nightly run publishes what it missed.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
const crypto = require("node:crypto");

const API = "https://api.github.com";
const TIMEOUT_MS = 10_000;
// A burst of edits, such as a reordered list, becomes one publish, once it has been quiet this long.
const QUIET_MS = 30_000;
// Steady editing still publishes this often.
const MAX_WAIT_MS = 5 * 60_000;

const base64url = (value) => Buffer.from(value).toString("base64url");

/** The token a GitHub App proves itself with: its ID, signed with its private key. */
function appJwt(appId, privateKey, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  // Backdated a minute, as GitHub advises, in case this clock runs ahead of GitHub's.
  const claims = { iat: seconds - 60, exp: seconds + 9 * 60, iss: String(appId) };
  const signed = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  return `${signed}.${crypto.sign("RSA-SHA256", Buffer.from(signed), privateKey).toString("base64url")}`;
}

/** Runs `run` once calls have stopped for `quietMs`, or `maxWaitMs` after the first, whichever is sooner. */
function debounced(run, quietMs, maxWaitMs) {
  let timer;
  let first;
  const fire = () => {
    timer = undefined;
    first = undefined;
    run();
  };
  return () => {
    const now = Date.now();
    first ??= now;
    clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, Math.min(quietMs, first + maxWaitMs - now)));
  };
}

async function github(fetchFn, path, token, body) {
  const response = await fetchFn(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "cyc-seattle-website-publish",
      "x-github-api-version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to ${path}`);
  return response;
}

/** Starts the publish workflow, as the App's installation on the repo. */
async function dispatch(config, privateKey, fetchFn = fetch) {
  const jwt = appJwt(config.appId, privateKey);
  const installation = await (await github(fetchFn, `/repos/${config.repository}/installation`, jwt)).json();
  // Narrowed to this repo and permission, whatever the installation was given.
  const access = await github(fetchFn, `/app/installations/${installation.id}/access_tokens`, jwt, {
    repositories: [config.repository.split("/")[1]],
    permissions: { actions: "write" },
  });
  const { token } = await access.json();
  await github(fetchFn, `/repos/${config.repository}/actions/workflows/${config.workflow}/dispatches`, token, {
    ref: config.ref,
  });
}

/** Calls `publish` after each write to the website's content. */
function listen({ filter, action }, { database, logger }, config, publish) {
  for (const collection of config.collections) {
    for (const event of ["create", "update", "delete", "sort"]) {
      action(`${collection}.items.${event}`, () => publish());
    }
  }
  // The site reads some fields of these, so a change to any other, such as a sync's bookkeeping, doesn't publish.
  for (const [collection, fields] of Object.entries(config.watched ?? {})) {
    action(`${collection}.items.create`, () => publish());
    action(`${collection}.items.delete`, () => publish());
    action(`${collection}.items.update`, ({ payload }) => {
      if (Object.keys(payload ?? {}).some((field) => fields.includes(field))) publish();
    });
  }

  // A file counts if it's in the Website folder or is being put there. A failed check never fails the write.
  const files = async (keys, folder) => {
    try {
      const found =
        folder === config.folder ||
        (await database("directus_files").whereIn("id", keys).where({ folder: config.folder }).first("id"));
      if (found) publish();
    } catch (error) {
      logger.error(error, "website-publish: couldn't check a file's folder");
    }
  };
  action("files.upload", ({ payload, key }) => files([key], payload?.folder));
  // Filters, since they run before the write: afterwards, a file that was deleted or moved out of
  // the folder no longer shows it was there.
  filter("files.update", async (payload, { keys }) => {
    await files(keys, payload?.folder);
    return payload;
  });
  filter("files.delete", async (keys) => {
    await files(keys);
    return keys;
  });
}

function register(events, context) {
  // Written beside this file by `backend`, from ./policies.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Directus loads this file as CommonJS.
  const config = require("./config.json");
  const { env, logger } = context;
  const privateKey = env["WEBSITE_PUBLISH_PRIVATE_KEY"];
  if (!config.appId || !privateKey) return;

  const publish = debounced(
    () => {
      dispatch(config, String(privateKey))
        .then(() => logger.info("website-publish: started the website's publish workflow"))
        .catch((error) => logger.error(error, "website-publish: couldn't start the website's publish workflow"));
    },
    QUIET_MS,
    MAX_WAIT_MS,
  );
  listen(events, context, config, publish);
}

module.exports = register;
module.exports.appJwt = appJwt;
module.exports.debounced = debounced;
module.exports.dispatch = dispatch;
module.exports.listen = listen;
