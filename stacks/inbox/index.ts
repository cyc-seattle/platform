import * as pulumi from "@pulumi/pulumi";
import { deployInbox } from "./cluster.ts";

// FreeScout, the shared inbox for info@ (cyc-seattle/platform#182). Authentik, in this repo's
// `authentik` stack, registers its OIDC client from the outputs below.

const config = new pulumi.Config();
// The break-glass admin, who signs in with a password when Authentik is down.
const adminEmail = config.require("adminEmail");
// FreeScout's own mail, such as notifications, comes from this address. Replies come from the mailbox's.
const mailFrom = config.get("mailFrom") ?? "inbox@cyccommunitysailing.org";

const app = deployInbox(adminEmail, mailFrom);

export const url = pulumi.output(app.then(({ url }) => url));
export const oidcClientId = pulumi.output(app.then(({ oidcClientId }) => oidcClientId));
export const oidcClientSecret = pulumi.secret(app.then(({ oidcClientSecret }) => oidcClientSecret));
export const adminPassword = pulumi.secret(app.then(({ adminPassword }) => adminPassword));
