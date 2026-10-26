import { clusterProvider, getPlatformOutputs, WebService } from "../../src/index.ts";

const platform = getPlatformOutputs();

const smoke = new WebService("smoke", {
  platform,
  provider: clusterProvider(platform),
  hostname: "smoke.dev.cycsail.team",
  image: "gcr.io/google-samples/hello-app:2.0",
  port: 8080,
  requests: { cpu: "50m", memory: "128Mi" },
  readinessProbe: { httpGet: { path: "/", port: 8080 } },
  // The image's user is `nonroot`, a name, which runAsNonRoot can't check. 65532 is its UID.
  runAsUser: 65532,
});

export const url = smoke.url;
