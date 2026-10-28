/** A product's `kind`. A kind with fields of its own has a subtype collection, such as `programs`. */
export type ProductKind = "program" | "charter" | "storage_lease" | "merchandise" | "event_hosting" | "other";

/** Row shape for the `products` collection, in `core`'s schema. */
export interface ProductRow {
  id?: string;
  name: string;
  kind: ProductKind;
  revenue_account_id: string | null;
}

/** Row shape for the `accounts` collection, in `core`'s schema: one line of the chart of accounts. */
export interface AccountRow {
  id?: string;
  /** The chart-of-accounts code, unique across accounts. */
  number: string;
  name: string;
  type: "revenue" | "expense" | "asset" | "liability" | "net_assets";
}
