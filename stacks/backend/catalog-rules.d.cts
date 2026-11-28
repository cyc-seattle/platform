/** A connection inside one transaction: `query` returns rows, `exec` runs one statement. */
interface Db {
  query(sql: string): Promise<Record<string, unknown>[]>;
  exec(sql: string): Promise<unknown>;
}

/** Installs the catalog's rules on the offerings and Clubspot tables, and returns what it added. */
export function installCatalogRules(db: Db): Promise<{ missing: string[]; installed: string[] }>;
