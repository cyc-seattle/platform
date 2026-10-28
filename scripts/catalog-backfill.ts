// What scripts/backfill-catalog.ts writes, worked out from the rows it reads, so a dry run and the
// tests see exactly what an apply would do. cyc-seattle/isthmia#213 §7 gives the steps.

export interface BackfillRows {
  programs: { id: string; name: string; revenue_account: string | null; product_id: string | null }[];
  products: { id: string; kind: string; revenue_account_id: string | null }[];
  accounts: { id: string; number: string }[];
  camps: { clubspot_sales_account: string | null }[];
}

export interface NewAccount {
  id: string;
  number: string;
  name: string;
  type: "revenue";
}

export interface NewProduct {
  id: string;
  name: string;
  kind: "program";
  revenue_account_id: string | null;
}

export interface BackfillPlan {
  accounts: NewAccount[];
  products: NewProduct[];
  /** Each program without a product, and the new product it links to. */
  programs: { id: string; product_id: string }[];
  /** Each existing product with no account, and the account its program's code names. */
  productAccounts: { id: string; revenue_account_id: string }[];
  /** Products already booked to an account other than their program's code. Left for staff. */
  conflicts: number;
  /** Programs whose product isn't of kind program. The audit reports them; this leaves them. */
  wrongKind: number;
}

const code = (value: string | null): string | undefined => value?.trim() || undefined;

/**
 * Safe to run again: it skips programs that have a product, codes that are already an account's
 * number, and products that already have an account. `newId` makes each new row's id, so a
 * product can point at an account made in the same run.
 */
export function planBackfill(rows: BackfillRows, newId: () => string): BackfillPlan {
  const accountByNumber = new Map(rows.accounts.map((account) => [account.number, account.id]));
  const accounts: NewAccount[] = [];
  const codes = [...rows.programs.map((p) => p.revenue_account), ...rows.camps.map((c) => c.clubspot_sales_account)];
  for (const number of new Set(codes.map(code).filter((value) => value !== undefined))) {
    if (!accountByNumber.has(number)) {
      // The CRM holds only the code. An admin names the account in the Data Studio.
      const account: NewAccount = { id: newId(), number, name: number, type: "revenue" };
      accounts.push(account);
      accountByNumber.set(number, account.id);
    }
  }

  const productById = new Map(rows.products.map((product) => [product.id, product]));
  const plan: BackfillPlan = { accounts, products: [], programs: [], productAccounts: [], conflicts: 0, wrongKind: 0 };
  for (const program of rows.programs) {
    const number = code(program.revenue_account);
    const accountId = number === undefined ? null : accountByNumber.get(number)!;
    const product = program.product_id ? productById.get(program.product_id) : undefined;
    if (!program.product_id) {
      const created: NewProduct = { id: newId(), name: program.name, kind: "program", revenue_account_id: accountId };
      plan.products.push(created);
      plan.programs.push({ id: program.id, product_id: created.id });
    } else if (product) {
      if (product.kind !== "program") {
        plan.wrongKind++;
      }
      if (accountId && !product.revenue_account_id) {
        plan.productAccounts.push({ id: product.id, revenue_account_id: accountId });
      } else if (accountId && product.revenue_account_id !== accountId) {
        plan.conflicts++;
      }
    }
  }
  return plan;
}
