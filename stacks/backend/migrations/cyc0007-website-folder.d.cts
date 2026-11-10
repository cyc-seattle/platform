export const WEBSITE_FOLDER: string;
export const SQL: string;
export function up(knex: { raw(sql: string): Promise<unknown> }): Promise<void>;
export function down(): Promise<void>;
