// A Directus display extension, mounted into Directus as-is: one ES module with no imports, since
// Directus bundles it into the Data Studio as written.
//
// Money is stored as whole cents. Directus's own displays can't divide, so without this a table
// shows 12500 where staff expect $125.00.

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** `12500` as `$125.00`. An empty value is empty, and one that isn't a number comes back as it was. */
export function formatCents(value) {
  if (value === null || value === undefined || value === "") return "";
  const cents = Number(value);
  return Number.isFinite(cents) ? dollars.format(cents / 100) : String(value);
}

export default {
  id: "cents-as-dollars",
  name: "Cents as dollars",
  description: "Shows an amount stored in cents as dollars, such as 12500 as $125.00.",
  icon: "attach_money",
  types: ["integer", "bigInteger"],
  options: null,
  handler: formatCents,
  // Vue renders a string a render function returns as text.
  component: {
    props: { value: { type: [Number, String], default: null } },
    render() {
      return formatCents(this.value);
    },
  },
};
