/** Row shape for the `programs` collection. See `schema.yaml`. */
export interface ProgramRow {
  id?: string;
  name: string;
  /** The `products` row this program is a subtype of, which must be of kind `program`. */
  product_id: string;
}
