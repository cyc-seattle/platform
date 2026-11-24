import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { TEST_MAILBOX } from "../../stacks/inbox/cluster.ts";
import { proxyOk } from "./cluster.ts";
import { addToGroup, createUser, newGroup, personFor } from "./steps/logins.ts";
import { accessToken, devPlatform, kube, secretValue } from "./support.ts";

const FREESCOUT_AGENT = "FreeScout Agent";

// What the shared inbox's feature reaches on dev: Authentik's API as its admin, FreeScout's API with
// the API module's key, and GreenMail, which stands in for Gmail, through the cluster's API.

/**
 * Whether dev's FreeScout has the API module, from the inbox stack's dev config. It's bought and
 * installed by hand (docs/inbox.md), so the scenarios that need it wait for `inbox:apiModule: true`.
 */
export function devInboxHasApi(): boolean {
  const config = readFileSync(join(import.meta.dirname, "../../stacks/inbox/Pulumi.dev.yaml"), "utf8");
  return /^\s*inbox:apiModule:\s*true\s*$/m.test(config);
}

async function authentik(method: string, path: string, body?: unknown): Promise<any> {
  const platform = await devPlatform();
  const token = await secretValue(platform, "authentik", "AUTHENTIK_BOOTSTRAP_TOKEN");
  const response = await fetch(`https://login.${platform.domain}/api/v3${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`Authentik ${method} ${path}: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

const authentikUsers: number[] = [];

/**
 * An Authentik user named for the run, as a first sign-in makes. One allowed to use the shared inbox
 * is in a group in Directus that gives the FreeScout Agent policy, and the group-policies hook puts
 * them in Authentik's group of that name.
 */
export async function newAuthentikUser(runId: string, allowed: boolean): Promise<number> {
  // Not example.test: Directus refuses a login whose email has a TLD it doesn't know.
  const email = `inbox-${runId}@example.com`;
  const user = await authentik("POST", "/core/users/", {
    username: `inbox-${runId}`,
    name: `Inbox test ${runId}`,
    email,
    is_active: true,
  });
  authentikUsers.push(user.pk);
  if (allowed) {
    const login = await createUser(email, "Crew");
    const { groupId } = await newGroup(FREESCOUT_AGENT);
    await addToGroup(groupId, await personFor(login));
    const name = encodeURIComponent(FREESCOUT_AGENT);
    await eventually(
      "the group-policies hook to let them in",
      async () => {
        const { results } = await authentik("GET", `/core/groups/?name=${name}&include_users=false`);
        return results[0]?.users.includes(user.pk) || undefined;
      },
      1,
    );
  }
  return user.pk;
}

/** Whether Authentik lets the user into the shared inbox's application. */
export async function canSignIn(userPk: number): Promise<boolean> {
  return (await authentik("GET", `/core/applications/inbox/check_access/?for_user=${userPk}`)).passing === true;
}

export async function deleteAuthentikUsers(): Promise<void> {
  for (const pk of authentikUsers.splice(0)) {
    await authentik("DELETE", `/core/users/${pk}/`);
  }
}

let apiKey: Promise<string> | undefined;

/** The API module's key, which an admin copies into Secret Manager once the module is installed. */
async function freescoutKey(): Promise<string> {
  apiKey ??= (async () => {
    const { project } = await devPlatform();
    const response = await fetch(
      `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/dev-inbox-api-key/versions/latest:access`,
      { headers: { authorization: `Bearer ${await accessToken()}` } },
    );
    if (!response.ok) {
      throw new Error(`Can't read dev-inbox-api-key: ${response.status} ${await response.text()}`);
    }
    const { payload } = (await response.json()) as { payload: { data: string } };
    return Buffer.from(payload.data, "base64").toString("utf8");
  })();
  return apiKey;
}

/** A call to FreeScout's API, which must succeed. */
export async function freescout(method: string, path: string, body?: unknown): Promise<any> {
  const { domain } = await devPlatform();
  const response = await fetch(`https://inbox.${domain}/api${path}`, {
    method,
    headers: {
      "X-FreeScout-API-Key": await freescoutKey(),
      "content-type": "application/json",
      accept: "application/json",
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`FreeScout ${method} ${path}: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

export interface Email {
  from: string;
  subject: string;
  text: string;
  inReplyTo?: string;
}

/**
 * Sends an email to dev's test mailbox through GreenMail's SMTP port, from a Job in dev's namespace,
 * since the cluster's API proxies only HTTP.
 */
export async function sendToInbox(runId: string, email: Email): Promise<void> {
  const platform = await devPlatform();
  const jobs = `/apis/batch/v1/namespaces/${platform.namespace}/jobs`;
  const name = `send-mail-${runId}-${Date.now().toString(36)}`;
  const message = [
    `From: ${email.from}`,
    `To: ${TEST_MAILBOX}`,
    `Subject: ${email.subject}`,
    ...(email.inReplyTo ? [`In-Reply-To: ${email.inReplyTo}`, `References: ${email.inReplyTo}`] : []),
    "Content-Type: text/plain; charset=utf-8",
    "",
    email.text,
    "",
  ].join("\r\n");
  const created = await kube(platform, "POST", jobs, {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name },
    spec: {
      backoffLimit: 2,
      ttlSecondsAfterFinished: 600,
      template: {
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          nodeSelector: { "cloud.google.com/gke-spot": "true" },
          securityContext: { runAsNonRoot: true, runAsUser: 65534, seccompProfile: { type: "RuntimeDefault" } },
          containers: [
            {
              name: "send",
              image: "busybox:1.37",
              command: ["sh", "-c", 'printf "%s" "$MESSAGE" | sendmail -S greenmail:3025 -f "$FROM" "$TO"'],
              env: [
                { name: "MESSAGE", value: message },
                { name: "FROM", value: email.from },
                { name: "TO", value: TEST_MAILBOX },
              ],
              resources: { requests: { cpu: "50m", memory: "32Mi" }, limits: { cpu: "50m", memory: "32Mi" } },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
            },
          ],
        },
      },
    },
  });
  if (created.status !== 201) {
    throw new Error(`Can't create the Job ${name}: ${created.status} ${JSON.stringify(created.body)}`);
  }
  // A Spot pod can wait minutes for a node.
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const job = await kube(platform, "GET", `${jobs}/${name}`);
    if ((job.body?.status?.succeeded ?? 0) > 0) {
      return;
    }
    if ((job.body?.status?.failed ?? 0) > 2) {
      throw new Error(`The Job ${name} couldn't send the email.`);
    }
    await sleep(5_000);
  }
  throw new Error(`The Job ${name} didn't send the email in 10 minutes.`);
}

/** Waits for `find` to return something, up to `minutes`. FreeScout fetches mail once a minute. */
export async function eventually<T>(what: string, find: () => Promise<T | undefined>, minutes = 5): Promise<T> {
  const deadline = Date.now() + minutes * 60_000;
  while (Date.now() < deadline) {
    const found = await find();
    if (found !== undefined) {
      return found;
    }
    await sleep(10_000);
  }
  throw new Error(`Gave up waiting ${minutes} minutes for ${what}.`);
}

/** The test mailbox's ID in FreeScout. */
export async function testMailboxId(): Promise<number> {
  const mailboxes = (await freescout("GET", "/mailboxes"))._embedded.mailboxes as { id: number; email: string }[];
  const mailbox = mailboxes.find((m) => m.email === TEST_MAILBOX);
  if (!mailbox) {
    throw new Error(`FreeScout has no mailbox ${TEST_MAILBOX}. The image makes it in dev.`);
  }
  return mailbox.id;
}

/** The conversation whose subject holds `subject`, with its threads, once FreeScout has fetched it. */
export async function conversationAbout(subject: string): Promise<any> {
  const mailboxId = await testMailboxId();
  return eventually(`FreeScout to fetch "${subject}"`, async () => {
    const page = await freescout(
      "GET",
      `/conversations?mailboxId=${mailboxId}&subject=${encodeURIComponent(subject)}&embed=threads`,
    );
    return (page._embedded?.conversations ?? [])[0];
  });
}

export interface ReceivedEmail {
  subject: string;
  messageId: string;
  from: string;
}

/** The emails GreenMail holds for `address`. */
export async function inboxOf(address: string): Promise<ReceivedEmail[]> {
  const messages: { subject: string; messageId: string; mimeMessage: string }[] = await proxyOk(
    "greenmail",
    8080,
    "GET",
    `/api/user/${encodeURIComponent(address)}/messages/INBOX`,
  ).catch(() => []);
  return messages.map((m) => ({
    subject: m.subject,
    messageId: m.messageId,
    from: /^From:\s*(.*)$/im.exec(m.mimeMessage)?.[1]?.trim() ?? "",
  }));
}
