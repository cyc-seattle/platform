import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import type { PlatformOutputs } from "../src/outputs.ts";
import { checkHostname, WebService, type WebServiceArgs } from "../src/web-service.ts";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const find = (type: string, name: string) => created.find((r) => r.type === type && r.name === name)!.inputs;
const valueOf = <T>(output: pulumi.Output<T>): Promise<T> => (output as any).promise();

const platform = (env: string): PlatformOutputs => ({
  project: "example-project",
  projectNumber: "123456789",
  region: "us-west1",
  cluster: "cyc",
  clusterEndpoint: "gke-example.us-west1.gke.goog",
  namespace: env,
  gateway: { name: "shared", namespace: "gateway" },
  domain: `${env}.example.org`,
  sqlConnectionName: `example-project:us-west1:${env}`,
  sqlHost: "10.159.0.5",
  gatewayAddress: "203.0.113.10",
  registry: "us-west1-docker.pkg.dev/example-project/docker",
});

let provider: k8s.Provider;
const args = (env: string): WebServiceArgs => ({
  platform: platform(env),
  provider,
  hostname: `web.${env}.example.org`,
  image: "example/web:1",
  port: 8080,
  requests: { cpu: "50m", memory: "128Mi" },
  readinessProbe: { httpGet: { path: "/ready", port: 8080 } },
});

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (a) => {
        created.push({ type: a.type, name: a.name, inputs: a.inputs });
        return { id: `${a.name}_id`, state: a.inputs };
      },
      call: (a) => a.inputs,
    },
    "smoke",
  );
  provider = new k8s.Provider("cluster", {});
  new WebService("dev-web", args("dev"));
  new WebService("prod-web", args("prod"));
  new WebService("slow-web", { ...args("dev"), healthCheck: { checkIntervalSec: 30, timeoutSec: 10 } });
  await new Promise((r) => setImmediate(r));
});

const deployment = (name: string) => find("kubernetes:apps/v1:Deployment", name);
const podSpec = (name: string) => deployment(name).spec.template.spec;

describe("WebService security defaults", () => {
  it("runs as non-root with the RuntimeDefault seccomp profile", () => {
    expect(podSpec("dev-web").securityContext).toEqual({
      runAsNonRoot: true,
      seccompProfile: { type: "RuntimeDefault" },
    });
  });

  it("locks the container down", () => {
    expect(podSpec("dev-web").containers[0].securityContext).toEqual({
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: { drop: ["ALL"] },
    });
  });

  it("mounts no service account token", () => {
    expect(podSpec("dev-web").automountServiceAccountToken).toBe(false);
    expect(find("kubernetes:core/v1:ServiceAccount", "dev-web").automountServiceAccountToken).toBe(false);
  });

  it("runs as the given user when the image's user is a name", () => {
    new WebService("named-user", { ...args("dev"), runAsUser: 65532 });
    return new Promise<void>((resolve) =>
      setImmediate(() => {
        expect(podSpec("named-user").securityContext).toMatchObject({ runAsUser: 65532, runAsGroup: 65532 });
        resolve();
      }),
    );
  });
});

describe("WebService placement", () => {
  it("uses Spot pods in dev", () => {
    expect(podSpec("dev-web").nodeSelector).toEqual({ "cloud.google.com/gke-spot": "true" });
  });

  it("doesn't use Spot pods in prod", () => {
    expect(podSpec("prod-web").nodeSelector).toEqual({});
  });

  it("puts every resource in the environment's namespace", () => {
    for (const r of created.filter((c) => c.name === "dev-web" && c.type.startsWith("kubernetes:"))) {
      expect(r.inputs.metadata.namespace).toBe("dev");
    }
  });
});

describe("WebService resources", () => {
  it("sets its limits to its requests", () => {
    expect(podSpec("dev-web").containers[0].resources).toEqual({
      requests: { cpu: "50m", memory: "128Mi" },
      limits: { cpu: "50m", memory: "128Mi" },
    });
  });

  it("exposes its HTTP port as port 80, and any other port at its own number", () => {
    new WebService("two-ports", { ...args("dev"), ports: [{ name: "metrics", port: 9300 }] });
    return new Promise<void>((resolve) =>
      setImmediate(() => {
        expect(find("kubernetes:core/v1:Service", "two-ports").spec.ports).toEqual([
          { name: "http", port: 80, targetPort: "http" },
          { name: "metrics", port: 9300, targetPort: "metrics" },
        ]);
        expect(podSpec("two-ports").containers[0].ports).toEqual([
          { name: "http", containerPort: 8080 },
          { name: "metrics", containerPort: 9300 },
        ]);
        resolve();
      }),
    );
  });

  it("rejects a second port named http", () => {
    expect(() => new WebService("dup-http", { ...args("dev"), ports: [{ name: "http", port: 9000 }] })).toThrow(
      /can't name a port "http"/,
    );
  });
});

describe("WebService routing", () => {
  it("routes its hostname from the environment's Gateway to its Service", () => {
    expect(find("kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", "dev-web").spec).toEqual({
      parentRefs: [{ name: "shared", namespace: "gateway" }],
      hostnames: ["web.dev.example.org"],
      rules: [{ backendRefs: [{ name: "dev-web", port: 80 }] }],
    });
  });

  it("health-checks the readiness probe's path", () => {
    expect(find("kubernetes:networking.gke.io/v1:HealthCheckPolicy", "dev-web").spec).toEqual({
      default: {
        config: { type: "HTTP", httpHealthCheck: { portSpecification: "USE_SERVING_PORT", requestPath: "/ready" } },
      },
      targetRef: { group: "", kind: "Service", name: "dev-web" },
    });
  });

  it("sets the load balancer's check timing when given", () => {
    expect(find("kubernetes:networking.gke.io/v1:HealthCheckPolicy", "slow-web").spec.default).toMatchObject({
      checkIntervalSec: 30,
      timeoutSec: 10,
    });
  });
});

// WebService runs this inside an apply on the domain. A failing apply there rejects the HTTPRoute's
// registration, which the mocks report as an unhandled rejection, so the rule is tested on its own.
describe("checkHostname", () => {
  it.each(["web.dev.example.org", "a.b.dev.example.org", "dev.example.org", "Web.Dev.Example.org"])(
    "accepts %s in dev.example.org",
    (hostname) => {
      expect(checkHostname(hostname, "dev.example.org")).toBe(hostname);
    },
  );

  it.each(["web.prod.example.org", "web.example.org", "webdev.example.org", "dev.example.org.evil.com"])(
    "rejects %s outside dev.example.org",
    (hostname) => {
      expect(() => checkHostname(hostname, "dev.example.org")).toThrow(
        `Hostname ${hostname} isn't in the environment's domain, dev.example.org.`,
      );
    },
  );
});

describe("WebService identity", () => {
  it("exposes its Workload Identity principal", async () => {
    const web = new WebService("member", args("dev"));
    expect(await valueOf(web.member)).toBe(
      "principal://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/example-project.svc.id.goog/subject/ns/dev/sa/member",
    );
  });

  it("names its ServiceAccount and host after itself", async () => {
    const web = new WebService("named", args("dev"));
    expect(await valueOf(web.serviceAccountName)).toBe("named");
    expect(web.host).toBe("named");
  });

  it("creates no IAM", () => {
    expect(created.filter((r) => r.type.startsWith("gcp:"))).toEqual([]);
  });
});

describe("WebService requirements", () => {
  it("requires CPU and memory requests", () => {
    expect(() => new WebService("no-requests", { ...args("dev"), requests: { cpu: "50m" } as any })).toThrow(
      /needs CPU and memory requests/,
    );
  });

  it("requires a readiness probe", () => {
    expect(() => new WebService("no-probe", { ...args("dev"), readinessProbe: undefined as any })).toThrow(
      /needs an HTTP readiness probe/,
    );
  });

  it("requires the readiness probe to be an HTTP GET", () => {
    const readinessProbe = { tcpSocket: { port: 8080 } } as any;
    expect(() => new WebService("tcp-probe", { ...args("dev"), readinessProbe })).toThrow(
      /needs an HTTP readiness probe/,
    );
  });
});
