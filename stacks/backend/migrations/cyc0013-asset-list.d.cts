export const SQL: string;
export const DROPPED: Record<string, string[]>;
export function up(knex: { raw(sql: string): Promise<unknown> }): Promise<void>;
export function down(): Promise<void>;
