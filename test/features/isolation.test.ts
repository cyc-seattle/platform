import { randomBytes } from "node:crypto";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import type { PlatformOutputs } from "../../src/outputs.ts";
import { canCreate, devPlatform, feature, kube, whoami, type KubeResponse } from "./support.ts";

// Tries a TCP connection to each `host:port` argument, and prints how each went as one JSON object.
const connectScript = `
const net = require("node:net");
const tries = process.argv.slice(1).map((target) => new Promise((resolve) => {
  const [host, port] = target.split(":");
  const socket = net.connect({ host, port: Number(port) });
  socket.setTimeout(10000);
  socket.on("connect", () => { socket.destroy(); resolve([target, "connected"]); });
  socket.on("timeout", () => { socket.destroy(); resolve([target, "timeout"]); });
  socket.on("error", (e) => resolve([target, e.code]));
}));
Promise.all(tries).then((results) => console.log(JSON.stringify(Object.fromEntries(results))));
`;

/** A short-lived pod, admissible under the restricted Pod Security Standard, that runs `connectScript`. */
function connectionTestPod(name: string, targets: string[]) {
  const resources = { cpu: "50m", memory: "128Mi" };
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name, labels: { "app.kubernetes.io/name": "mail-egress-test" } },
    spec: {
      restartPolicy: "Never",
      activeDeadlineSeconds: 300,
      automountServiceAccountToken: false,
      nodeSelector: { "cloud.google.com/gke-spot": "true" },
      // The image's `node` user.
      securityContext: { runAsNonRoot: true, runAsUser: 1000, seccompProfile: { type: "RuntimeDefault" } },
      containers: [
        {
          name: "connect",
          image: "node:22-alpine",
          command: ["node", "-e", connectScript, ...targets],
          resources: { requests: resources, limits: resources },
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            capabilities: { drop: ["ALL"] },
          },
        },
      ],
    },
  };
}

describeFeature(feature("isolation.feature"), ({ Background, AfterAllScenarios, Scenario, ScenarioOutline }) => {
  let platform: PlatformOutputs;
  let me: string;
  const routes: string[] = [];
  const routesPath = () => `/apis/gateway.networking.k8s.io/v1/namespaces/${platform.namespace}/httproutes`;
  const pods: string[] = [];
  const podsPath = () => `/api/v1/namespaces/${platform.namespace}/pods`;

  // The answer to "I ask to create", with what was asked, for the Then step's message.
  let allowed: boolean;
  let asked: string;

  AfterAllScenarios(async () => {
    for (const name of routes) {
      await kube(platform, "DELETE", `${routesPath()}/${name}`);
    }
    for (const name of pods) {
      await kube(platform, "DELETE", `${podsPath()}/${name}`);
    }
  });

  Background(({ Given }) => {
    Given("I am signed in to dev's cluster", async () => {
      platform = await devPlatform();
      me = await whoami(platform);
    });
  });

  Scenario("A dev route for a prod hostname is not accepted", ({ When, Then }) => {
    let name: string | undefined;

    When("I create an HTTPRoute in dev for {string}", async (_, hostname: string) => {
      const candidate = `isolation-test-${randomBytes(3).toString("hex")}`;
      const created = await kube(platform, "POST", routesPath(), {
        apiVersion: "gateway.networking.k8s.io/v1",
        kind: "HTTPRoute",
        metadata: { name: candidate },
        spec: {
          parentRefs: [{ name: platform.gateway.name, namespace: platform.gateway.namespace }],
          hostnames: [hostname],
          rules: [{ backendRefs: [{ name: "smoke", port: 80 }] }],
        },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      name = candidate;
      routes.push(name);
    });

    Then("the Gateway doesn't accept the route", async () => {
      // Steps still run after a failed one, so don't wait on a route that doesn't exist.
      expect(name, "no route was created").toBeDefined();
      // Wait for the Gateway controller to report on the route; it reports Accepted either way.
      const accepted = await vi.waitFor(
        async () => {
          const route = await kube(platform, "GET", `${routesPath()}/${name}`);
          const parent = route.body?.status?.parents?.find((p: any) => p.parentRef?.name === platform.gateway.name);
          const condition = parent?.conditions?.find((c: any) => c.type === "Accepted");
          expect(condition, "the Gateway controller hasn't reported on the route yet").toBeDefined();
          return condition;
        },
        { timeout: 300_000, interval: 10_000 },
      );
      expect(accepted.status, `${accepted.reason}: ${accepted.message}`).toBe("False");
    });
  });

  Scenario("deploy-dev reaches a dev Service through the API's service proxy", ({ When, Then }) => {
    let answer: KubeResponse;

    When(
      "I GET {string} from the Service {string} on port {int} through the API's service proxy",
      async (_, path: string, service: string, port: number) => {
        answer = await kube(
          platform,
          "GET",
          `/api/v1/namespaces/${platform.namespace}/services/${service}:${port}/proxy${path}`,
        );
      },
    );

    Then("it answers with status {int}", (_, status: number) => {
      expect(answer.status, JSON.stringify(answer.body)).toBe(status);
    });
  });

  Scenario("A dev pod can't reach a mail server outside the cluster", ({ When, Then }) => {
    let results: Record<string, string>;

    When(
      "a pod in dev connects to {string}, {string}, {string}, and {string}",
      async (_, a: string, b: string, c: string, d: string) => {
        const targets = [a, b, c, d];
        const name = `mail-egress-test-${randomBytes(3).toString("hex")}`;
        const created = await kube(platform, "POST", podsPath(), connectionTestPod(name, targets));
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        pods.push(name);

        // Autopilot may first have to start a node.
        await vi.waitFor(
          async () => {
            const pod = await kube(platform, "GET", `${podsPath()}/${name}`);
            expect(["Succeeded", "Failed"], `the pod is ${pod.body?.status?.phase}`).toContain(pod.body?.status?.phase);
          },
          { timeout: 300_000, interval: 5_000 },
        );
        const log = await kube(platform, "GET", `${podsPath()}/${name}/log`);
        results = JSON.parse(String(log.body));
      },
    );

    Then("only {string} answers", (_, target: string) => {
      const answered = Object.keys(results).filter((t) => results[t] === "connected");
      expect(answered, JSON.stringify(results)).toEqual([target]);
    });
  });

  ScenarioOutline("deploy-dev can deploy to dev", ({ When, Then }, variables) => {
    When('I ask to create "<resource>" in namespace "dev"', async () => {
      asked = `${variables["resource"]} in dev`;
      allowed = await canCreate(platform, variables["resource"], "dev");
    });
    Then("the cluster allows it", () => {
      expect(allowed, `${me} can't create ${asked}`).toBe(true);
    });
  });

  ScenarioOutline("deploy-dev can't create anything in another namespace", ({ When, Then }, variables) => {
    When('I ask to create "<resource>" in namespace "<namespace>"', async () => {
      asked = `${variables["resource"]} in ${variables["namespace"]}`;
      allowed = await canCreate(platform, variables["resource"], variables["namespace"]);
    });
    Then("the cluster forbids it", () => {
      expect(allowed, `${me} can create ${asked}`).toBe(false);
    });
  });

  ScenarioOutline("deploy-dev can't create anything cluster-wide", ({ When, Then }, variables) => {
    When('I ask to create "<resource>" outside any namespace', async () => {
      asked = `${variables["resource"]} cluster-wide`;
      allowed = await canCreate(platform, variables["resource"]);
    });
    Then("the cluster forbids it", () => {
      expect(allowed, `${me} can create ${asked}`).toBe(false);
    });
  });
});
