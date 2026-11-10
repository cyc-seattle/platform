// Names that a role's resource and the rules about it must agree on. Plain data, so the backend's
// policies, which the hook extensions' configs come from, can import it without Pulumi.

/** The csc-website build's role, and its policy's name, which the query guard looks its rules up by. */
export const WEBSITE_BUILD = "Website Build";
