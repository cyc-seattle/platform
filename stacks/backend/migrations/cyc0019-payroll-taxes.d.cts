export const SQL: string;
export const TAXES: [name: string, wageShare: number | null, hourlyCents: number | null][];
export function up(knex: { raw(sql: string): Promise<unknown> }): Promise<void>;
export function down(): Promise<void>;
