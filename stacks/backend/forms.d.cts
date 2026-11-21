export interface FormsConfig {
  /** Where a contact form message goes: info@. */
  to: string;
  /** The website's addresses a form may come from, such as `https://cyccommunitysailing.org`. */
  allowedOrigins: string[];
  /** Where to send the visitor back to when the form's own address isn't one of them. */
  siteUrl: string;
}

export interface Fields {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  message: string;
}

export interface Message {
  to: string;
  replyTo: { name: string; address: string };
  subject: string;
  text: string;
}

export type Checked = { outcome: "drop" } | { outcome: "refuse"; reason: string } | { outcome: "send"; fields: Fields };

/** Allows `limit` calls per key in any `windowMs`. */
export function limiter(limit: number, windowMs: number): (key: string, now?: number) => boolean;
/** What to do with a submitted form. */
export function check(form: Record<string, unknown>, origin: string, allowedOrigins: string[]): Checked;
/** The email info@ gets. */
export function compose(fields: Fields, to: string): Message;

interface Request {
  body?: unknown;
  ip?: string;
  get(header: string): string | undefined;
  [Symbol.asyncIterator](): AsyncIterator<string>;
}
interface Response {
  redirect(status: number, url: string): void;
}
/** The router for `config`. `send` sends one email. */
export function routes(
  router: { post(path: string, handler: (req: Request, res: Response) => Promise<void>): void },
  config: FormsConfig,
  send: (message: Message) => Promise<void>,
  logger: { error(error: unknown, message: string): void },
): void;
