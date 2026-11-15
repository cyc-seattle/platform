export const SQL: string;
export const ORIGINAL: string;
export const FALL: string;
export const RESOLVED: string;
export const RESULTS: string[];
export function up(knex: { raw(sql: string): Promise<unknown> }): Promise<void>;
export function down(): Promise<void>;
