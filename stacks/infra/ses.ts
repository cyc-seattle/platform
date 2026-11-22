import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as pulumi from "@pulumi/pulumi";
// One service at a time: the whole package's types exhaust tsc's memory.
import { Provider } from "@pulumi/aws/provider.js";
import * as iam from "@pulumi/aws/iam/index.js";
import * as ses from "@pulumi/aws/ses/index.js";
import * as sesv2 from "@pulumi/aws/sesv2/index.js";
import * as sns from "@pulumi/aws/sns/index.js";
import * as gcp from "@pulumi/gcp";
import { externalDomain, externalZone } from "./dns.ts";
import { deployRunner } from "./identities.ts";

// Amazon SES, which sends the newsletter from the external domain (cyc-seattle/platform#180). Until the
// maintainer makes CSC's AWS account and its role (docs/manual-setup.md §12), `awsRoleArn` is unset and
// this makes nothing.

const config = new pulumi.Config();
const roleArn = config.get("awsRoleArn");

export const sesRegion = "us-west-2";
/** The Return-Path subdomain, so SPF passes for the From domain too, not only DKIM. */
export const mailFromDomain = pulumi.interpolate`bounce.${externalDomain}`;

/** The audience CSC's AWS role trusts in deploy-runner's ID token. */
export const awsAudience = "sts.amazonaws.com";

function record(name: string, rr: Omit<gcp.dns.RecordSetArgs, "managedZone" | "ttl">): gcp.dns.RecordSet {
  return new gcp.dns.RecordSet(name, { managedZone: externalZone.name, ttl: 300, ...rr });
}

export function deploySes(roleArn: string) {
  // The role trusts deploy-runner's Google ID token, so no AWS key is kept anywhere. The token goes in
  // a file, not the provider's inputs, since a new one each run would show as a change in every preview.
  const tokenFile = path.join(os.tmpdir(), "cyc-infra-aws-token");
  const idToken = gcp.serviceaccount.getAccountIdTokenOutput({
    targetAudience: awsAudience,
    targetServiceAccount: deployRunner.email,
  }).idToken;
  const provider = new Provider("aws", {
    region: sesRegion,
    assumeRoleWithWebIdentity: {
      roleArn,
      sessionName: "pulumi-infra",
      webIdentityTokenFile: idToken.apply((token) => {
        fs.writeFileSync(tokenFile, token, { mode: 0o600 });
        return tokenFile;
      }),
    },
  });
  const opts = { provider };

  const identity = new sesv2.EmailIdentity(
    "ses-identity",
    { emailIdentity: externalDomain, dkimSigningAttributes: { nextSigningKeyLength: "RSA_2048_BIT" } },
    opts,
  );
  // Easy DKIM's 3 keys, which SES rotates behind these names.
  for (const i of [0, 1, 2]) {
    const token = identity.dkimSigningAttributes.apply((a) => a?.tokens?.[i] ?? "");
    record(`ses-dkim-${i}`, {
      name: pulumi.interpolate`${token}._domainkey.${externalDomain}.`,
      type: "CNAME",
      rrdatas: [pulumi.interpolate`${token}.dkim.amazonses.com.`],
    });
  }

  new sesv2.EmailIdentityMailFromAttributes(
    "ses-mail-from",
    { emailIdentity: identity.emailIdentity, mailFromDomain, behaviorOnMxFailure: "USE_DEFAULT_VALUE" },
    opts,
  );
  record("ses-mail-from-mx", {
    name: pulumi.interpolate`${mailFromDomain}.`,
    type: "MX",
    rrdatas: [`10 feedback-smtp.${sesRegion}.amazonses.com.`],
  });
  record("ses-mail-from-spf", {
    name: pulumi.interpolate`${mailFromDomain}.`,
    type: "TXT",
    rrdatas: ['"v=spf1 include:amazonses.com ~all"'],
  });

  // Bounces and complaints go to Listmonk through SNS. Listmonk takes complaints only as an identity's
  // notifications, not a configuration set's events. Email forwarding off, so none reach info@.
  const topic = new sns.Topic("ses-feedback", { name: "ses-feedback" }, opts);
  for (const notificationType of ["Bounce", "Complaint"]) {
    new ses.IdentityNotificationTopic(
      `ses-feedback-${notificationType.toLowerCase()}`,
      { identity: identity.emailIdentity, notificationType, topicArn: topic.arn, includeOriginalHeaders: true },
      opts,
    );
  }
  new sesv2.EmailIdentityFeedbackAttributes(
    "ses-feedback-forwarding",
    { emailIdentity: identity.emailIdentity, emailForwardingEnabled: false },
    { ...opts, dependsOn: [topic] },
  );
  // Listmonk confirms the subscription when it gets it, so only once it answers at its address.
  if (config.getBoolean("listmonkFeedback")) {
    new sns.TopicSubscription(
      "ses-feedback-listmonk",
      {
        topic: topic.arn,
        protocol: "https",
        endpoint: pulumi.interpolate`https://mail.${externalDomain}/webhooks/service/ses`,
        // Listmonk reads SNS's envelope, so the message comes wrapped.
        rawMessageDelivery: false,
      },
      opts,
    );
  }

  // Listmonk's SMTP login. SES's SMTP needs a long-lived key; it may only send as the domain.
  const user = new iam.User("listmonk-smtp", { name: "listmonk-smtp" }, opts);
  new iam.UserPolicy(
    "listmonk-smtp-send",
    {
      user: user.name,
      policy: pulumi.jsonStringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: "ses:SendRawEmail", Resource: identity.arn }],
      }),
    },
    opts,
  );
  const key = new iam.AccessKey("listmonk-smtp", { user: user.name }, opts);

  const smtpSecret = new gcp.secretmanager.Secret("listmonk-ses-smtp", {
    secretId: "listmonk-ses-smtp",
    replication: { auto: {} },
  });
  new gcp.secretmanager.SecretVersion("listmonk-ses-smtp", {
    secret: smtpSecret.id,
    secretData: pulumi.secret(pulumi.jsonStringify({ username: key.id, password: key.sesSmtpPasswordV4 })),
  });

  return { identityArn: identity.arn, feedbackTopicArn: topic.arn };
}

export const sesSetup = roleArn === undefined ? undefined : deploySes(roleArn);
