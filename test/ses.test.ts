import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const calls: { token: string; inputs: any }[] = [];
const byName = (type: string, name: string) => created.find((r) => r.type === type && r.name === name)?.inputs;
const ofType = (type: string) => created.filter((r) => r.type === type);

const roleArn = "arn:aws:iam::111122223333:role/pulumi-deploy-runner";
const runner = "deploy-runner@example-project.iam.gserviceaccount.com";

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        created.push({ type: args.type, name: args.name, inputs: args.inputs });
        if (args.type === "pulumi:pulumi:StackReference") {
          return {
            id: args.name,
            state: { outputs: { deployRunner: { email: runner }, deployDev: {}, gkeNodes: {} } },
          };
        }
        if (args.type === "aws:sesv2/emailIdentity:EmailIdentity") {
          const dkimSigningAttributes = { tokens: ["tok0", "tok1", "tok2"] };
          return {
            id: "example.org",
            state: { ...args.inputs, dkimSigningAttributes, arn: "arn:aws:ses:us-west-2:1:identity/example.org" },
          };
        }
        if (args.type === "aws:sns/topic:Topic") {
          return { id: "topic", state: { ...args.inputs, arn: "arn:aws:sns:us-west-2:1:ses-feedback" } };
        }
        if (args.type === "aws:iam/accessKey:AccessKey") {
          return { id: "AKIAEXAMPLE", state: { ...args.inputs, sesSmtpPasswordV4: "smtp-password" } };
        }
        const name = args.type.startsWith("gcp:") ? { name: `${args.name}_name` } : {};
        return { id: `${args.name}_id`, state: { ...name, ...args.inputs } };
      },
      call: (args) => {
        calls.push({ token: args.token, inputs: args.inputs });
        if (args.token === "gcp:serviceaccount/getAccountIdToken:getAccountIdToken") {
          return { ...args.inputs, idToken: "id-token" };
        }
        return args.inputs;
      },
    },
    "infra",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  pulumi.runtime.setConfig("infra:bootstrapStack", "organization/bootstrap/prod");
  pulumi.runtime.setConfig("infra:externalDomain", "example.org");
  pulumi.runtime.setConfig("infra:internalDomain", "example.team");
  pulumi.runtime.setConfig("infra:shortDomain", "example.link");
  pulumi.runtime.setConfig("infra:awsRoleArn", roleArn);
  pulumi.runtime.setConfig("infra:listmonkFeedback", "true");
  await import("../stacks/infra/ses.ts");
  await new Promise((r) => setTimeout(r, 50));
});

describe("SES", () => {
  it("signs in to AWS with deploy-runner's ID token from a file, so no key is kept", async () => {
    const provider = byName("pulumi:providers:aws", "aws");
    expect(provider.region).toBe("us-west-2");
    const assume = JSON.parse(provider.assumeRoleWithWebIdentity);
    expect(assume).toMatchObject({ roleArn, sessionName: "pulumi-infra" });
    expect(assume).not.toHaveProperty("webIdentityToken");
    expect(fs.readFileSync(assume.webIdentityTokenFile, "utf8")).toBe("id-token");
    expect(path.dirname(assume.webIdentityTokenFile)).toBe(os.tmpdir());
    expect(calls.find((c) => c.token.endsWith("getAccountIdToken"))?.inputs).toEqual({
      targetAudience: "sts.amazonaws.com",
      targetServiceAccount: runner,
    });
  });

  it("signs mail from the external domain with SES's 2048-bit DKIM, in its zone", () => {
    expect(byName("aws:sesv2/emailIdentity:EmailIdentity", "ses-identity")).toMatchObject({
      emailIdentity: "example.org",
      dkimSigningAttributes: { nextSigningKeyLength: "RSA_2048_BIT" },
    });
    for (const i of [0, 1, 2]) {
      expect(byName("gcp:dns/recordSet:RecordSet", `ses-dkim-${i}`)).toMatchObject({
        managedZone: "external_name",
        name: `tok${i}._domainkey.example.org.`,
        type: "CNAME",
        rrdatas: [`tok${i}.dkim.amazonses.com.`],
      });
    }
  });

  it("returns bounces to bounce.<domain>, so SPF passes for the From domain too", () => {
    expect(
      byName("aws:sesv2/emailIdentityMailFromAttributes:EmailIdentityMailFromAttributes", "ses-mail-from"),
    ).toMatchObject({ mailFromDomain: "bounce.example.org", behaviorOnMxFailure: "USE_DEFAULT_VALUE" });
    expect(byName("gcp:dns/recordSet:RecordSet", "ses-mail-from-mx")).toMatchObject({
      name: "bounce.example.org.",
      type: "MX",
      rrdatas: ["10 feedback-smtp.us-west-2.amazonses.com."],
    });
    expect(byName("gcp:dns/recordSet:RecordSet", "ses-mail-from-spf")).toMatchObject({
      name: "bounce.example.org.",
      rrdatas: ['"v=spf1 include:amazonses.com ~all"'],
    });
  });

  it("sends bounces and complaints to Listmonk through SNS, not by email", () => {
    const topics = ofType("aws:ses/identityNotificationTopic:IdentityNotificationTopic").map((r) => r.inputs);
    expect(topics.map((t) => t.notificationType).sort()).toEqual(["Bounce", "Complaint"]);
    for (const topic of topics) {
      expect(topic).toMatchObject({ topicArn: "arn:aws:sns:us-west-2:1:ses-feedback", includeOriginalHeaders: true });
    }
    expect(
      byName("aws:sesv2/emailIdentityFeedbackAttributes:EmailIdentityFeedbackAttributes", "ses-feedback-forwarding"),
    ).toMatchObject({ emailForwardingEnabled: false });
    expect(byName("aws:sns/topicSubscription:TopicSubscription", "ses-feedback-listmonk")).toMatchObject({
      protocol: "https",
      endpoint: "https://mail.example.org/webhooks/service/ses",
      rawMessageDelivery: false,
    });
  });

  it("gives Listmonk an SMTP login that may only send as the domain, kept in Secret Manager", () => {
    const policy = JSON.parse(byName("aws:iam/userPolicy:UserPolicy", "listmonk-smtp-send").policy);
    expect(policy.Statement).toEqual([
      { Effect: "Allow", Action: "ses:SendRawEmail", Resource: "arn:aws:ses:us-west-2:1:identity/example.org" },
    ]);
    expect(byName("gcp:secretmanager/secret:Secret", "listmonk-ses-smtp").secretId).toBe("listmonk-ses-smtp");
    // A secret reaches the mock wrapped, with its value beside Pulumi's marker.
    const data = byName("gcp:secretmanager/secretVersion:SecretVersion", "listmonk-ses-smtp").secretData;
    expect(JSON.parse(typeof data === "string" ? data : data.value)).toEqual({
      username: "AKIAEXAMPLE",
      password: "smtp-password",
    });
  });
});
