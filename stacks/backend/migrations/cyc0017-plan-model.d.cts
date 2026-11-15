export const SQL: string;
export const INTERNAL: [string, string, string][];
export const NOTES: string[];
export const DROPPED: Record<string, string[]>;
export function up(knex: { raw(sql: string): Promise<unknown> }): Promise<void>;
export function down(): Promise<void>;
