/** Row shape for the `programs` collection. See `schema.yaml`. */
export interface ProgramRow {
  id?: string;
  name: string;
  /** The finance account this program's revenue rolls up to. Hand-set by staff; no sync writes it.
   * Replaced by the product's `revenue_account_id` (cyc-seattle/workplace#6 step 10). */
  revenue_account: string | null;
  /** The `products` row this program is a subtype of, which must be of kind `program`. */
  product_id: string | null;
}
