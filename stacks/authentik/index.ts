import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as authentik from "@pulumi/authentik";
import {
  GoogleSource,
  ConfidentialOidcProvider,
  UnverifiedEmailUserWriteStage,
  VerifiedEmailUserWriteStage,
} from "./resources.ts";
import { appSecret, isDev, loadCluster, siblingList, siblingOutput, siblingSecret } from "../../src/app/cluster.ts";
import { AUTHENTIK_ACCESS_SECRET, SIGN_IN_POLICIES } from "../backend/policies.ts";
import { adminGroup } from "./admins.ts";
import { deployAuthentik } from "./cluster.ts";
import { EmbeddedOutpost } from "./embedded-outpost.ts";
import { localAuthentik, localLoginHost, localSibling } from "./local.ts";
import { prodSecrets } from "./prod-secrets.ts";
import { Secret } from "../../src/app/secret.ts";
import {
  loginHost,
  directusRedirectUri,
  LOCAL_DIRECTUS_REDIRECT_URI_PATTERN,
  listmonkRedirectUri,
  inboxRedirectUriPattern,
  lowercaseEmailScopeExpression,
  googleUserPropertiesExpression,
  signInNormalizeExpression,
  pendingVerificationDenialExpression,
  clearPendingVerificationExpression,
  signedInPolicyExpression,
  embeddedOutpostConfig,
  IMPLICIT_CONSENT_FLOW,
  PROVIDER_INVALIDATION_FLOW,
  INVALIDATION_FLOW,
  SOURCE_AUTHENTICATION_FLOW,
  SIGNING_CERTIFICATE,
  OPENID_SCOPE_MAPPING,
  PROFILE_SCOPE_MAPPING,
} from "./naming.ts";

// Authentik on the cluster, and its own configuration: sources, flows, groups, and
// applications. Directus's `authentik` auth provider, in platform's `backend` stack, needs the OIDC
// application declared here.
//
// Every resource below goes through the `authentik` Terraform-bridged provider, not GCP's -
// `provider: authentikProvider` is threaded through every resource's opts for that reason.

// Reads a secret's value by its literal name, so a value that must never become a stack output needs
// no StackReference.
function secretValue(secret: string): pulumi.Output<string> {
  return pulumi.secret(gcp.secretmanager.getSecretVersionOutput({ secret }).apply((version) => version.secretData));
}

const config = new pulumi.Config();

// An Authentik the CI job runs in containers (scripts/ci-stack), not one on the cluster: no GCP, no Kubernetes.
const local = config.getBoolean("local") ?? false;

const existing = isDev || local ? undefined : prodSecrets();
const app = local ? localAuthentik() : deployAuthentik(existing);

const sibling = (project: string, output: string) =>
  local ? pulumi.output(localSibling(project, output)) : siblingOutput(project, output);
const secretSibling = (project: string, output: string) =>
  local ? pulumi.secret(localSibling(project, output)) : siblingSecret(project, output);
const generated = {
  bootstrapToken: pulumi.output(app.then(({ bootstrapToken }) => bootstrapToken)),
};

const internalDomain = pulumi.output(app.then(({ domain }) => domain));

const authentikUrl = pulumi.output(app.then(({ url }) => url));
const bootstrapToken = pulumi.secret(generated.bootstrapToken);

// Pulumi's own service account and API token, which the `authentik` provider below signs in with in
// place of akadmin's bootstrap token. Only this provider signs in with the bootstrap token, and it
// manages nothing else. A fresh instance needs it to create the service account. To rotate the API
// token, replace it: `pulumi up --replace` with the token's URN. The `authentik` provider takes the
// new key in place, and the old token is deleted at the end of that update.
const bootstrapProvider = new authentik.Provider(
  "authentik-bootstrap",
  { url: authentikUrl, token: bootstrapToken },
  { dependsOn: [app.then(({ ready }) => ready)] },
);
const bootstrapOpts = { provider: bootstrapProvider };

// Pulumi manages flows, stages, sources, providers, groups, and the outpost, so it's a superuser.
const pulumiGroup = new authentik.Group("pulumi", { name: "Pulumi", isSuperuser: true }, bootstrapOpts);
const pulumiUser = new authentik.User(
  "pulumi",
  { username: "pulumi", name: "Pulumi", type: "service_account", groups: [pulumiGroup.id] },
  bootstrapOpts,
);
const apiToken = new authentik.Token(
  "pulumi-api-token",
  {
    identifier: "pulumi-api-token",
    description: "The authentik Pulumi project's API token",
    user: numericId(pulumiUser.id),
    intent: "api",
    expiring: false,
    retrieveKey: true,
  },
  bootstrapOpts,
);
const authentikToken = apiToken.key;

// Prod keeps a copy in Secret Manager, beside its other Authentik secrets. Dev shares the project, so
// it keeps none.
if (!isDev && !local) {
  const apiTokenSecret = new Secret("authentik-api-token");
  new gcp.secretmanager.SecretVersion(
    "authentik-api-token-version",
    { secret: apiTokenSecret.id, secretData: authentikToken },
    { parent: apiTokenSecret },
  );
}

// Its name and URN are older than the API token: changing only its token updates it in place, so
// nothing it manages is replaced.
const authentikProvider = new authentik.Provider(
  "authentik",
  { url: authentikUrl, token: authentikToken },
  { dependsOn: [app.then(({ ready }) => ready)] },
);
const opts = { provider: authentikProvider };
const invokeOpts = opts;

// Until Authentik is up, its lookups below can't run: a preview would call a server that isn't there.
// Tying their inputs to the readiness check's stdout leaves them unknown until then, so a preview
// skips them. Not its ID: the command provider makes one up during a preview.
const readyMarker = pulumi.output(app.then(({ ready }) => ready)).apply((ready) => ready.stdout);
function whenReady(value: string): pulumi.Input<string> {
  return readyMarker.apply(() => value);
}

// Off by default only where there's no OAuth client for it, as in dev.
const googleSignIn = config.getBoolean("googleSignIn") ?? true;

// Terraform ids are always strings, but a handful of Authentik fields (an Application's
// `protocolProvider`, an Outpost's `protocolProviders`, a Token's `user`) are typed as the
// underlying Django numeric pk - unlike Group/Flow/Stage/User, which use a UUID pk that stays a
// string end-to-end.
function numericId(id: pulumi.Input<string>): pulumi.Output<number> {
  return pulumi.output(id).apply((value) => Number(value));
}

// --- Well-known built-in flows every provider below needs. Looked up rather than managed, so this
// project never fights Authentik's own first-boot blueprint for objects it doesn't own.
const implicitConsentFlow = authentik.getFlowOutput({ slug: whenReady(IMPLICIT_CONSENT_FLOW) }, invokeOpts);
const providerInvalidationFlow = authentik.getFlowOutput({ slug: whenReady(PROVIDER_INVALIDATION_FLOW) }, invokeOpts);
// The one that signs out of Authentik itself, ending any impersonation. sail-team's Sign out ends there.
const invalidationFlow = authentik.getFlowOutput({ slug: whenReady(INVALIDATION_FLOW) }, invokeOpts);
const sourceAuthenticationFlow = authentik.getFlowOutput({ slug: whenReady(SOURCE_AUTHENTICATION_FLOW) }, invokeOpts);
// Without a signing key, ID tokens are HS256-signed with the client secret; Directus accepts RS256 only.
const signingCertificate = authentik.getCertificateKeyPairOutput({ name: whenReady(SIGNING_CERTIFICATE) }, invokeOpts);

function googleSignInSource(): GoogleSource {
  // Set by hand. Dev has no OAuth client yet.
  new Secret("google-oauth-client-id");
  new Secret("google-oauth-client-secret");

  // --- 1. The Google source's own enrollment flow: write the user, then log in - nothing verifies
  // the email because Google already has. A source's own enrollment flow needs no prompt stage
  // either: `handle_enroll` (authentik/core/sources/flow_manager.py) fills the flow's prompt
  // data from the source's property mappings (below) and never pre-sets a pending user, so
  // `create_when_required` takes its normal create-a-new-user path, active immediately, with this
  // stage's own `createUsersAsInactive: false`.
  const googleEnrollmentFlow = new authentik.Flow(
    "google-enrollment",
    { name: "Google sign-up", slug: "google-enrollment", title: "Create your account", designation: "enrollment" },
    opts,
  );

  const googleEnrollmentUserWriteStage = new VerifiedEmailUserWriteStage(
    "google-enrollment-user-write",
    { name: "Google enrollment: create account", userCreationMode: "create_when_required" },
    opts,
  );

  const googleEnrollmentLoginStage = new authentik.StageUserLogin(
    "google-enrollment-login",
    { name: "Google enrollment: login" },
    opts,
  );

  [googleEnrollmentUserWriteStage, googleEnrollmentLoginStage].forEach((stage, index) => {
    new authentik.FlowStageBinding(
      `google-enrollment-binding-${index}`,
      { target: googleEnrollmentFlow.uuid, stage: stage.id, order: (index + 1) * 10 },
      opts,
    );
  });

  const googleUserProperties = new authentik.PropertyMappingSourceOauth(
    "google-user-properties",
    { name: "Google: username from email", expression: googleUserPropertiesExpression() },
    opts,
  );

  // --- 2. The Google source: email-based user matching, falling through to the minimal enrollment
  // flow above for a first sign-in from an unmatched email (see GoogleSource's own doc comment).
  const googleSource = new GoogleSource(
    "google",
    {
      name: "Google",
      slug: "google",
      consumerKey: secretValue("google-oauth-client-id"),
      consumerSecret: secretValue("google-oauth-client-secret"),
      authenticationFlow: sourceAuthenticationFlow.id,
      enrollmentFlow: googleEnrollmentFlow.uuid,
      propertyMappings: [googleUserProperties.id],
    },
    opts,
  );
  return googleSource;
}

const googleSource = googleSignIn ? googleSignInSource() : undefined;

// --- 3. The sign-in flow: one flow for both a returning and a first-time email, with no separate
// enrollment screen. Identification always sets a pending user - the real match, or Authentik's own
// placeholder for an unmatched email - so the write stage after it always has a user to normalize
// and save; see `signInNormalizeExpression`'s doc comment. Each stage below binds its own policy,
// re-evaluated per request, so `request.user` reflects what the previous stage just resolved. A
// flow of our own, not stages grafted onto Authentik's built-in default-authentication-flow, so
// this project never fights the blueprint reconciler that owns that flow's bindings.
const emailCodeFlow = new authentik.Flow(
  "email-code-authentication",
  {
    name: "Email code authentication",
    slug: "email-code-authentication",
    title: "Sign in",
    designation: "authentication",
  },
  opts,
);

const identificationStage = new authentik.StageIdentification(
  "email-code-identification",
  {
    name: "Email code: identification",
    // Matches by email only, with no password stage bound - the Google button (via `sources`)
    // and "enter your email" are the only two ways in. No `enrollmentFlow`: an unmatched email
    // continues in this same flow instead of a "Sign up" link to a separate one.
    userFields: ["email"],
    // Otherwise "Jane@Gmail.com" misses the stored "jane@gmail.com" and creates a second account.
    caseInsensitiveMatching: true,
    sources: googleSource ? [googleSource.uuid] : [],
  },
  opts,
);

const signInNormalizePolicy = new authentik.PolicyExpression(
  "sign-in-normalize-email",
  { name: "Sign-in: normalize the identified email", expression: signInNormalizeExpression() },
  opts,
);

const signInUserWriteStage = new UnverifiedEmailUserWriteStage(
  "sign-in-user-write",
  { name: "Email code: create or update account", userCreationMode: "create_when_required" },
  opts,
);

const emailStage = new authentik.StageEmail(
  "email-code-email",
  {
    name: "Email code: email",
    subject: "Sign in to CYC Community Sailing Center",
    template: "email/sign-in.html",
    // The container already carries the Workspace SMTP relay settings (AUTHENTIK_EMAIL__*); this
    // stage reuses them rather than repeating the relay host/port here.
    useGlobalSettings: true,
    // The only thing that activates a user the write stage above created inactive.
    activateUserOnSuccess: true,
  },
  opts,
);

const loginStage = new authentik.StageUserLogin("email-code-login", { name: "Email code: login" }, opts);

new authentik.FlowStageBinding(
  "email-code-binding-0",
  { target: emailCodeFlow.uuid, stage: identificationStage.id, order: 10 },
  opts,
);

// Re-evaluated on every request to this stage, not at plan-build time (before identification has
// set a pending user to normalize) - see `signInNormalizeExpression`'s doc comment.
const signInUserWriteBinding = new authentik.FlowStageBinding(
  "email-code-binding-1",
  {
    target: emailCodeFlow.uuid,
    stage: signInUserWriteStage.id,
    order: 20,
    evaluateOnPlan: false,
    reEvaluatePolicies: true,
  },
  opts,
);

new authentik.PolicyBinding(
  "sign-in-normalize-email-binding",
  { target: signInUserWriteBinding.id, policy: signInNormalizePolicy.id, order: 0 },
  opts,
);

// Re-evaluated on every request, same reasoning as the write stage's own binding above -
// `request.user` needs to be the pending user identification and the write stage just resolved.
const emailStageBinding = new authentik.FlowStageBinding(
  "email-code-binding-2",
  { target: emailCodeFlow.uuid, stage: emailStage.id, order: 30, evaluateOnPlan: false, reEvaluatePolicies: true },
  opts,
);

const pendingVerificationDenialPolicy = new authentik.PolicyExpression(
  "pending-verification-denial",
  { name: "Sign-in: deny a deactivated, already-verified user", expression: pendingVerificationDenialExpression() },
  opts,
);

new authentik.PolicyBinding(
  "pending-verification-denial-binding",
  { target: emailStageBinding.id, policy: pendingVerificationDenialPolicy.id, order: 0 },
  opts,
);

// Same override as above, so `request.user` reflects the now-active user the email stage just saved.
const loginStageBinding = new authentik.FlowStageBinding(
  "email-code-binding-3",
  { target: emailCodeFlow.uuid, stage: loginStage.id, order: 40, evaluateOnPlan: false, reEvaluatePolicies: true },
  opts,
);

const clearPendingVerificationPolicy = new authentik.PolicyExpression(
  "clear-pending-verification",
  { name: "Sign-in: clear the pending-verification attribute", expression: clearPendingVerificationExpression() },
  opts,
);

new authentik.PolicyBinding(
  "clear-pending-verification-binding",
  { target: loginStageBinding.id, policy: clearPendingVerificationPolicy.id, order: 0 },
  opts,
);

// A Brand matching the login host exactly is how this flow becomes "the" authentication flow a
// browser reaches at that host - Authentik picks the most specific domain match regardless of
// `default`, so this doesn't touch the placeholder default brand Authentik ships at first boot.
new authentik.Brand(
  "login",
  {
    // Authentik matches a Brand on the request's host and port, and the CI stack's browser reaches it at
    // `localUrl`, so scripts/ci-stack rewrites this when a restored cache came from another port.
    domain: local ? localLoginHost() : internalDomain.apply((domain) => loginHost(domain)),
    flowAuthentication: emailCodeFlow.uuid,
    // Unset, Authentik picks the first sign-out flow by slug, which only happens to be this one.
    flowInvalidation: invalidationFlow.id,
  },
  // Authentik fills in its default images, and the provider diffs them against the empty input,
  // the same bug as goauthentik/terraform-provider-authentik#981.
  { ...opts, ignoreChanges: ["brandingFavicon", "brandingLogo"] },
);

// --- 4. Users cannot change their own email. Already Authentik's shipped default; declared
// explicitly so a future Authentik upgrade changing that default can't silently reopen it.
// Impersonation is on, for admins to see what someone sees; Authentik's default asks them for a reason.
new authentik.SystemSettings("system-settings", { defaultUserChangeEmail: false, impersonation: true }, opts);

// --- 5. The sign-in groups, one per sign-in policy in Directus, which an app lets in. The
// group-policies hook in `backend` keeps each equal to the policy's holders (docs/access.md), so this
// project leaves their members alone. The provider's update sends the whole group, with the members
// Pulumi last saw, which would put back people the hook took out. So any change replaces the group
// with an empty one, which the hook fills on its next pass.
const signInGroups = SIGN_IN_POLICIES.map(({ key, name }) => ({
  key,
  group: new authentik.Group(
    `sign-in-${key}`,
    { name },
    // Authentik's group names are unique, so the old one goes first.
    { ...opts, ignoreChanges: ["users"], replaceOnChanges: ["*"], deleteBeforeReplace: true },
  ),
}));

// The hook's account, which can see users and change only the sign-in groups' members. It can't
// make anyone a superuser: adding to a superuser group takes a permission it doesn't have.
const accessSyncRole = new authentik.RbacRole("directus-access-sync", { name: "Directus access sync" }, opts);
new authentik.RbacPermissionRole(
  "directus-access-sync-view-users",
  { role: accessSyncRole.id, permission: "authentik_core.view_user" },
  opts,
);
function signInGroup(key: string): authentik.Group {
  const found = signInGroups.find((entry) => entry.key === key);
  if (!found) throw new Error(`authentik: no sign-in policy has the key ${key}`);
  return found.group;
}
for (const { key, group } of signInGroups) {
  for (const codename of ["view_group", "add_user_to_group", "remove_user_from_group"]) {
    // With its app label even on one object: Authentik's assign_perm splits on the dot either way, and
    // fails with a 500 on a bare codename. The provider reads it back the same way.
    new authentik.RbacPermissionRole(
      `directus-access-sync-${key}-${codename}`,
      {
        role: accessSyncRole.id,
        model: "authentik_core.group",
        objectId: group.id,
        permission: `authentik_core.${codename}`,
      },
      opts,
    );
  }
}
const accessSyncUser = new authentik.User(
  "directus-access-sync",
  {
    username: "directus-access-sync",
    name: "Directus access sync",
    type: "service_account",
    roles: [accessSyncRole.id],
  },
  opts,
);
const accessSyncToken = new authentik.Token(
  "directus-access-sync-token",
  {
    identifier: "directus-access-sync-token",
    description: "The group-policies hook's token, to fill the sign-in groups",
    user: numericId(accessSyncUser.id),
    intent: "api",
    expiring: false,
    retrieveKey: true,
  },
  opts,
);
// Directus mounts it, optionally, since `backend` deploys first. The CI stack writes it from the output below.
if (!local) {
  void loadCluster().then((cluster) =>
    appSecret(cluster, AUTHENTIK_ACCESS_SECRET, { url: authentikUrl, token: accessSyncToken.key }),
  );
}
export const localAccessToken = local ? pulumi.secret(accessSyncToken.key) : undefined;

// --- 6. Directus's admins, as Authentik superusers.
adminGroup(local ? [] : siblingList("backend", "directusAdmins"), opts);

// --- 7. The embedded outpost. It gated isthmia's portal, which is retired (cyc-seattle/sail-team#1), so it
// serves no provider now. Authentik owns it, so this project only ever updates it.
// The embedded outpost's Authentik-assigned id (`GET /api/v3/outposts/instances/`), different on
// each instance. The `import` option below adopts the live resource rather than creating a second.
// Without it, EmbeddedOutpost finds the outpost at apply time.
const embeddedOutpostId = config.get("embeddedOutpostId");

// The embedded outpost every Authentik instance ships with at first boot. Imported, via the
// `import` resource option, rather than created - Authentik's own blueprint reconciler
// (`managed: goauthentik.io/outposts/embedded`) still owns this resource, so adopting the live one
// keeps this project from standing up a second outpost or fighting that reconciler over it.
// `config`'s keys other than `authentik_host` are copied verbatim from the live outpost
// (`embeddedOutpostConfig`'s doc comment). Pinning `authentik_host` keeps the forward-auth redirect
// from falling back to the container's own `http://localhost` on a blank default.
if (embeddedOutpostId !== undefined) {
  new authentik.Outpost(
    "embedded-outpost",
    {
      name: "authentik Embedded Outpost",
      protocolProviders: [],
      config: internalDomain.apply((domain) => embeddedOutpostConfig(domain)),
    },
    // Dropping this resource must never delete Authentik's own outpost.
    { ...opts, import: embeddedOutpostId, retainOnDelete: true },
  );
} else {
  new EmbeddedOutpost("embedded-outpost", {
    url: authentikUrl,
    token: authentikToken,
    providers: [],
    config: internalDomain.apply((domain) => embeddedOutpostConfig(domain)),
  });
}

// --- 8. The Directus OIDC provider and application. The client comes from platform's `backend`
// stack, which deploys Directus.
const directusEmailScopeMapping = new authentik.PropertyMappingProviderScope(
  "directus-email-lowercase",
  { name: "Directus: email (lowercased)", scopeName: "email", expression: lowercaseEmailScopeExpression() },
  opts,
);
const openidScopeMapping = authentik.getPropertyMappingProviderScopeOutput(
  { managed: whenReady(OPENID_SCOPE_MAPPING) },
  invokeOpts,
);
const profileScopeMapping = authentik.getPropertyMappingProviderScopeOutput(
  { managed: whenReady(PROFILE_SCOPE_MAPPING) },
  invokeOpts,
);

const directusClient = {
  id: sibling("backend", "directusOidcClientId"),
  secret: secretSibling("backend", "directusOidcClientSecret"),
};

const directusProvider = new ConfidentialOidcProvider(
  "directus-oidc",
  {
    name: "Directus",
    clientId: directusClient.id,
    clientSecret: directusClient.secret,
    signingKey: signingCertificate.id,
    authorizationFlow: implicitConsentFlow.id,
    invalidationFlow: providerInvalidationFlow.id,
    // matching_mode/url are Terraform's own snake_case keys for this field - the bridge passes a
    // Map(String) through verbatim rather than camelCasing its contents.
    allowedRedirectUris: [
      local
        ? { matching_mode: "regex", redirect_uri_type: "authorization", url: LOCAL_DIRECTUS_REDIRECT_URI_PATTERN }
        : {
            matching_mode: "strict",
            redirect_uri_type: "authorization",
            url: internalDomain.apply((domain) => directusRedirectUri(domain)),
          },
    ],
    propertyMappings: [openidScopeMapping.id, profileScopeMapping.id, directusEmailScopeMapping.id],
  },
  opts,
);

const directusApplication = new authentik.Application(
  "directus",
  { name: "Directus", slug: "directus", protocolProvider: numericId(directusProvider.providerOauth2Id) },
  opts,
);

// --- 9. Authentik 2026.8 denies access to an application with no policy bound at all - the Directus
// gate is meant to be "any signed-in user", so it needs this one bound explicitly.
// `target` takes the application's `uuid`, not its Terraform `id` (which Application uses for its
// slug) - the field the Application resource itself calls "Generated." rather than "ID of the
// object" is the one that's actually the object's pk.
const signedInPolicy = new authentik.PolicyExpression(
  "signed-in-users",
  { name: "Signed-in users", expression: signedInPolicyExpression() },
  opts,
);

new authentik.PolicyBinding(
  "directus-signed-in-binding",
  { target: directusApplication.uuid, policy: signedInPolicy.id, order: 0 },
  opts,
);

// --- 10. The shared inbox's OIDC provider and application (cyc-seattle/platform#182). The client
// comes from this repo's `inbox` stack. Only holders of the FreeScout Agent policy get in.

const inboxProvider = new ConfidentialOidcProvider(
  "inbox-oidc",
  {
    name: "Inbox",
    clientId: sibling("inbox", "oidcClientId"),
    clientSecret: secretSibling("inbox", "oidcClientSecret"),
    signingKey: signingCertificate.id,
    authorizationFlow: implicitConsentFlow.id,
    invalidationFlow: providerInvalidationFlow.id,
    allowedRedirectUris: [
      {
        matching_mode: "regex",
        redirect_uri_type: "authorization",
        url: internalDomain.apply((domain) => inboxRedirectUriPattern(domain)),
      },
    ],
    propertyMappings: [openidScopeMapping.id, profileScopeMapping.id, directusEmailScopeMapping.id],
  },
  opts,
);

const inboxApplication = new authentik.Application(
  "inbox",
  { name: "Inbox", slug: "inbox", protocolProvider: numericId(inboxProvider.providerOauth2Id) },
  opts,
);

// A group binding: only its members pass. Authentik superusers pass any binding.
new authentik.PolicyBinding(
  "inbox-group-binding",
  { target: inboxApplication.uuid, group: signInGroup("freescout-agent").id, order: 0 },
  opts,
);

// --- 11. Listmonk, the newsletter. The client comes from platform's `listmonk` stack. Listmonk makes an
// account on a first sign-in, so only holders of Listmonk Write or Listmonk Send get this far.
const listmonkProvider = new ConfidentialOidcProvider(
  "listmonk-oidc",
  {
    name: "Listmonk",
    clientId: sibling("listmonk", "oidcClientId"),
    clientSecret: secretSibling("listmonk", "oidcClientSecret"),
    signingKey: signingCertificate.id,
    authorizationFlow: implicitConsentFlow.id,
    invalidationFlow: providerInvalidationFlow.id,
    allowedRedirectUris: [
      {
        matching_mode: "strict",
        redirect_uri_type: "authorization",
        url: sibling("listmonk", "url").apply(listmonkRedirectUri),
      },
    ],
    // Listmonk finds the account by email, so it gets the same lowercased one as Directus.
    propertyMappings: [openidScopeMapping.id, profileScopeMapping.id, directusEmailScopeMapping.id],
  },
  opts,
);

const listmonkApplication = new authentik.Application(
  "listmonk",
  { name: "Newsletter", slug: "listmonk", protocolProvider: numericId(listmonkProvider.providerOauth2Id) },
  opts,
);

// A member of either group passes.
["listmonk-write", "listmonk-send"].forEach((key, order) => {
  new authentik.PolicyBinding(
    `${key}-group-binding`,
    { target: listmonkApplication.uuid, group: signInGroup(key).id, order },
    opts,
  );
});
