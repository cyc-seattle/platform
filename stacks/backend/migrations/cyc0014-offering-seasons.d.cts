export const SQL: string;
export const SEASONS: string[];
export function up(knex: { raw(sql: string): Promise<unknown> }): Promise<void>;
export function down(): Promise<void>;
