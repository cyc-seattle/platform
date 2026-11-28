/** [plan offering, catalog offering], as the maintainer reviewed them. */
export const REVIEWED: [string, string][];
export const SQL: string;
export function up(knex: { raw(sql: string): Promise<unknown> }): Promise<void>;
export function down(): Promise<void>;
