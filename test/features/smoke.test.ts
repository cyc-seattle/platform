import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import { feature } from "./support";

describeFeature(feature("smoke.feature"), ({ Scenario }) => {
  let response: Response;

  Scenario("The smoke service answers over HTTPS at its dev hostname", ({ When, Then, And }) => {
    When("I request {string}", async (_, url: string) => {
      // A Spot eviction or a fresh load balancer can take minutes to serve.
      response = await vi.waitFor(
        async () => {
          const r = await fetch(url);
          expect(r.status).toBe(200);
          return r;
        },
        { timeout: 300_000, interval: 10_000 },
      );
    });
    Then("the response status is {int}", (_, status: number) => {
      expect(response.status).toBe(status);
    });
    And("the response body contains {string}", async (_, text: string) => {
      expect(await response.text()).toContain(text);
    });
  });

  Scenario("HTTP redirects to HTTPS", ({ When, Then }) => {
    When("I request {string} without following redirects", async (_, url: string) => {
      response = await fetch(url, { redirect: "manual" });
    });
    Then("the response redirects to {string}", (_, url: string) => {
      expect([301, 302, 307, 308]).toContain(response.status);
      // URL drops a default port, which a redirect may spell out.
      expect(new URL(response.headers.get("location") ?? "").href).toBe(url);
    });
  });
});
