/** Whether an IP address is one a link may reach: not private, loopback, link-local, or the like. */
export function isPublicAddress(address: string): boolean;
/** The URL, if it's an https address on the default port, resolved against `base`, or undefined. */
export function allowedUrl(value: string, base?: string | URL): URL | undefined;
/** A page's preview fields, from its Open Graph tags or its title and description. */
export function parsePreview(
  html: string,
  pageUrl: string | URL,
): { preview_title: string | null; preview_description: string | null; preview_image: string | null };
