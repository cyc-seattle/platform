import { randomBytes } from "node:crypto";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import type { PlatformOutputs } from "../../src/outputs";
import { canCreate, devPlatform, feature, kube, whoami } from "./support";

describeFeature(feature("isolation.feature"), ({ Background, AfterAllScenarios, Scenario, ScenarioOutline }) => {
  let platform: PlatformOutputs;
  let me: string;
  const routes: string[] = [];
  const routesPath = () => `/apis/gateway.networking.k8s.io/v1/namespaces/${platform.namespace}/httproutes`;

  // The answer to "I ask to create", with what was asked, for the Then step's message.
  let allowed: boolean;
  let asked: string;

  AfterAllScenarios(async () => {
    for (const name of routes) {
      await kube(platform, "DELETE", `${routesPath()}/${name}`);
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
