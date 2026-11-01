export const RENAMED: string[];
export const PREFIX: string;
export const SQL: string;
export function up(knex: { raw(sql: string): Promise<unknown> }): Promise<void>;
export function down(): Promise<void>;
