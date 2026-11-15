export const SQL: string;
export const LEVELS: [name: string, role: string, grade: string, old: string[]][];
export const ROLES: string[];
export function up(knex: { raw(sql: string): Promise<unknown> }): Promise<void>;
export function down(): Promise<void>;
