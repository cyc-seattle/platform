import { randomBytes } from "node:crypto";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import type { PlatformOutputs } from "../../src/outputs";
import { canCreate, devPlatform, feature, kube, whoami } from "./support";

describeFeature(
  feature("isolation.feature"),
  ({ BeforeAllScenarios, AfterAllScenarios, Scenario, ScenarioOutline }) => {
    let platform: PlatformOutputs;
    let me: string;
    const routes: string[] = [];
    const routesPath = () => `/apis/gateway.networking.k8s.io/v1/namespaces/${platform.namespace}/httproutes`;

    BeforeAllScenarios(async () => {
      platform = await devPlatform();
      me = await whoami(platform);
    });

    AfterAllScenarios(async () => {
      for (const name of routes) {
        await kube(platform, "DELETE", `${routesPath()}/${name}`);
      }
    });

    Scenario("A dev route for a prod hostname is not accepted", ({ Given, Then }) => {
      let name: string;

      Given("an HTTPRoute in dev for {string}", async (_, hostname: string) => {
        name = `isolation-test-${randomBytes(3).toString("hex")}`;
        const created = await kube(platform, "POST", routesPath(), {
          apiVersion: "gateway.networking.k8s.io/v1",
          kind: "HTTPRoute",
          metadata: { name },
          spec: {
            parentRefs: [{ name: platform.gateway.name, namespace: platform.gateway.namespace }],
            hostnames: [hostname],
            rules: [{ backendRefs: [{ name: "smoke", port: 80 }] }],
          },
        });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        routes.push(name);
      });

      Then("the Gateway doesn't accept the route", async () => {
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

    Scenario("deploy-dev can deploy to dev", ({ Then, And }) => {
      const step = async (_: unknown, resource: string, namespace: string) => {
        expect(await canCreate(platform, resource, namespace), `${me} can't create ${resource} in ${namespace}`).toBe(
          true,
        );
      };
      Then("I can create {string} in namespace {string}", step);
      And("I can create {string} in namespace {string}", step);
    });

    ScenarioOutline("deploy-dev can't create anything in another namespace", ({ Then }, variables) => {
      Then('I can\'t create "<resource>" in namespace "<namespace>"', async () => {
        const { resource, namespace } = variables;
        expect(await canCreate(platform, resource, namespace), `${me} can create ${resource} in ${namespace}`).toBe(
          false,
        );
      });
    });

    ScenarioOutline("deploy-dev can't create anything cluster-wide", ({ Then }, variables) => {
      Then('I can\'t create "<resource>" outside any namespace', async () => {
        const { resource } = variables;
        expect(await canCreate(platform, resource), `${me} can create ${resource} cluster-wide`).toBe(false);
      });
    });
  },
);
