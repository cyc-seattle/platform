// Proposes which catalog offering each plan offering is (cyc-seattle/platform#395), for the maintainer to review
// before the migration that links plan offerings to the catalog carries the list. It only reads: every request
// is a GET.
//
// An offering is one Clubspot class in one session, so a plan offering matches a catalog offering of the same
// product with the same first and last day. Where several sessions share those days, one named "Entire Program"
// is the whole program's. Plan offerings that are the same in several of a year's Financial Plans (product,
// name and dates) are listed once.
//
//   DIRECTUS_URL=https://directus.<domain> DIRECTUS_TOKEN=<a token that reads plans and the catalog> \
//     node scripts/propose-offering-matches.ts > <file>.md

export interface PlanOffering {
  id: string;
  plan_id: string;
  product_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
}

export interface FinancialPlan {
  id: string;
  name: string;
  fiscal_year: number;
}

export interface CatalogOffering {
  id: string;
  product_id: string;
  name: string | null;
  starts_on: string | null;
  ends_on: string | null;
  archived_at: string | null;
  registration_form: string | null;
  confirmed_count: number;
}

export interface Product {
  id: string;
  name: string;
  kind: string;
}

/** Plan offerings that are the same in a year's Financial Plans. */
export interface Planned {
  year: number;
  product_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  /** Each plan offering's id. */
  ids: string[];
  /** The Financial Plans that have it. */
  in: FinancialPlan[];
}

export type Proposal =
  | { kind: "match"; planned: Planned; catalog: CatalogOffering; why: string }
  | { kind: "choose"; planned: Planned; candidates: CatalogOffering[]; why: string }
  | { kind: "new"; planned: Planned; why: string };

/** Groups plan offerings that are the same in a year's Financial Plans. */
export function plannedOfferings(offerings: PlanOffering[], planToFinancial: Map<string, FinancialPlan>): Planned[] {
  const groups = new Map<string, Planned>();
  for (const o of offerings) {
    const fp = planToFinancial.get(o.plan_id);
    if (fp === undefined) continue;
    const id = [fp.fiscal_year, o.product_id, o.name, o.starts_on, o.ends_on].join("|");
    const group = groups.get(id) ?? {
      year: fp.fiscal_year,
      product_id: o.product_id,
      name: o.name,
      starts_on: o.starts_on,
      ends_on: o.ends_on,
      ids: [],
      in: [],
    };
    group.ids.push(o.id);
    if (!group.in.includes(fp)) group.in.push(fp);
    groups.set(id, group);
  }
  return [...groups.values()].sort(
    (a, b) => a.year - b.year || a.starts_on.localeCompare(b.starts_on) || a.name.localeCompare(b.name),
  );
}

const ENTIRE = /entire program/i;

/** Proposes a catalog offering for each planned offering, or none. */
export function proposeMatches(
  planned: Planned[],
  products: Map<string, Product>,
  catalog: CatalogOffering[],
): Proposal[] {
  const live = catalog.filter((c) => c.archived_at === null);
  return planned.map((p): Proposal => {
    const product = products.get(p.product_id);
    const same = live.filter(
      (c) => c.product_id === p.product_id && c.starts_on === p.starts_on && c.ends_on === p.ends_on,
    );
    if (same.length === 1) return { kind: "match", planned: p, catalog: same[0]!, why: "Same product and dates." };
    if (same.length > 1) {
      const entire = same.filter((c) => ENTIRE.test(c.name ?? ""));
      if (entire.length === 1)
        return { kind: "match", planned: p, catalog: entire[0]!, why: 'Same product and dates, and "Entire Program".' };
      return { kind: "choose", planned: p, candidates: same, why: "Several have the same product and dates." };
    }
    const why =
      product?.kind !== "program"
        ? `${product?.name ?? "Its product"} isn't a program, so it has no catalog offering yet.`
        : "No catalog offering has the same product and dates.";
    return { kind: "new", planned: p, why };
  });
}

/** A catalog offering more than one proposal matches. */
export function doubleMatched(proposals: Proposal[]): Map<string, Proposal[]> {
  const by = new Map<string, Proposal[]>();
  for (const p of proposals) if (p.kind === "match") by.set(p.catalog.id, [...(by.get(p.catalog.id) ?? []), p]);
  return new Map([...by].filter(([, ps]) => ps.length > 1));
}

function describe(c: CatalogOffering, products: Map<string, Product>): string {
  const parts = [
    `${products.get(c.product_id)?.name ?? c.product_id}${c.name ? `, ${c.name}` : ""}`,
    `${c.starts_on ?? "?"} to ${c.ends_on ?? "?"}`,
    c.registration_form ?? "no form",
    `${c.confirmed_count} confirmed`,
  ];
  return `${parts.join("; ")} (\`${c.id}\`)`;
}

export function report(proposals: Proposal[], products: Map<string, Product>, today: string): string {
  const lines = [
    "# Plan offerings and their catalog offerings",
    "",
    `Proposed by \`scripts/propose-offering-matches.ts\` from prod on ${today}, read-only, for cyc-seattle/platform#395.`,
    "A plan offering matches a catalog offering of the same product with the same first and last day. Plan offerings",
    "that are the same in several of a year's Financial Plans are listed once. **Match** links them all to that",
    "catalog offering. **Choose** needs the maintainer to pick one, or none. **New** gets a catalog offering of its",
    "own, on no form and linked to no Clubspot class. Correct any line, and the migration carries the list as reviewed.",
    "",
  ];
  const counts = (["match", "choose", "new"] as const).map(
    (k) => `${proposals.filter((p) => p.kind === k).length} ${k}`,
  );
  lines.push(`In all: ${counts.join(", ")}.`, "");
  const twice = doubleMatched(proposals);
  if (twice.size > 0) {
    lines.push("## One catalog offering for several plan offerings", "");
    for (const [, ps] of twice) {
      const first = ps[0]!;
      if (first.kind !== "match") continue;
      const names = ps.map(
        (p) => `${p.planned.year} ${products.get(p.planned.product_id)?.name ?? ""} ${p.planned.name}`,
      );
      lines.push(`- ${describe(first.catalog, products)}: ${names.join("; ")}`);
    }
    lines.push("");
  }
  for (const year of [...new Set(proposals.map((p) => p.planned.year))]) {
    lines.push(`## ${year}`, "");
    for (const kind of ["match", "choose", "new"] as const) {
      const ofKind = proposals.filter((p) => p.planned.year === year && p.kind === kind);
      if (ofKind.length === 0) continue;
      lines.push(`### ${{ match: "Match", choose: "Choose", new: "New" }[kind]} (${ofKind.length})`, "");
      for (const p of ofKind) {
        const o = p.planned;
        const product = products.get(o.product_id)?.name ?? o.product_id;
        lines.push(
          `- **${product} ${o.name}**, ${o.starts_on} to ${o.ends_on}, in ${o.in.map((f) => `"${f.name}"`).join(", ")}.`,
        );
        if (p.kind === "match") lines.push(`  - → ${describe(p.catalog, products)}. ${p.why}`);
        if (p.kind === "choose") {
          lines.push(`  - ${p.why}`);
          for (const c of p.candidates) lines.push(`  - ? ${describe(c, products)}`);
        }
        if (p.kind === "new") lines.push(`  - ${p.why}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const base = process.env["DIRECTUS_URL"];
  const token = process.env["DIRECTUS_TOKEN"];
  if (!base || !token)
    throw new Error("Usage: DIRECTUS_URL=… DIRECTUS_TOKEN=… node scripts/propose-offering-matches.ts");
  const get = async <T>(collection: string, fields: string[]): Promise<T[]> => {
    const url = `${base}/items/${collection}?limit=-1&fields=${fields.join(",")}`;
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`GET ${collection}: ${response.status} ${await response.text()}`);
    return ((await response.json()) as { data: T[] }).data;
  };
  const [financial, plans, planOfferings, productRows, catalogRows] = await Promise.all([
    get<FinancialPlan>("financial_plans", ["id", "name", "fiscal_year"]),
    get<{ id: string; financial_plan_id: string }>("plans", ["id", "financial_plan_id"]),
    get<PlanOffering>("plan_offerings", ["id", "plan_id", "product_id", "name", "starts_on", "ends_on"]),
    get<Product>("products", ["id", "name", "kind"]),
    get<Omit<CatalogOffering, "registration_form"> & { registration_form_id: { name: string } | null }>("offerings", [
      "id",
      "product_id",
      "name",
      "starts_on",
      "ends_on",
      "archived_at",
      "confirmed_count",
      "registration_form_id.name",
    ]),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const fpById = new Map(financial.map((f) => [f.id, f]));
  const planToFinancial = new Map(
    plans.flatMap((p) => (fpById.has(p.financial_plan_id) ? [[p.id, fpById.get(p.financial_plan_id)!]] : [])),
  );
  const products = new Map(productRows.map((p) => [p.id, p]));
  const catalog = catalogRows.map(({ registration_form_id, ...c }) => ({
    ...c,
    registration_form: registration_form_id?.name ?? null,
  }));
  const proposals = proposeMatches(plannedOfferings(planOfferings, planToFinancial), products, catalog);
  process.stdout.write(report(proposals, products, today) + "\n");
}

if (process.argv[1] === import.meta.filename) await main();
