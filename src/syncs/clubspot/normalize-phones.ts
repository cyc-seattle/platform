import winston from "winston";
import { type PersonRow } from "../../model/crm/index.ts";
import { type DirectusClient } from "../runtime/index.ts";
import { toE164 } from "./people.ts";

export interface PhonePlan {
  updates: { id: string; phone: string }[];
  /** The ids of people whose phone doesn't parse, left as typed. */
  unparsed: string[];
}

/** Rewrites each phone that parses into E.164, where it isn't already. */
export function planPhoneNormalization(people: readonly Pick<PersonRow, "id" | "phone">[]): PhonePlan {
  const updates: { id: string; phone: string }[] = [];
  const unparsed: string[] = [];
  for (const person of people) {
    const phone = toE164(person.phone);
    if (!person.id || phone === null) {
      continue;
    }
    if (!phone.startsWith("+")) {
      unparsed.push(person.id);
    } else if (phone !== person.phone) {
      updates.push({ id: person.id, phone });
    }
  }
  return { updates, unparsed };
}

/**
 * `--normalize-phones`, run once by hand: brings the phones Clubspot synced as bare digits into
 * E.164, the form the sync and the club's apps write now. A dry run logs the same counts.
 */
export async function normalizePhones(directus: DirectusClient): Promise<{ normalized: number; unparsed: number }> {
  const people = await directus.readItems<PersonRow>("people", {
    limit: -1,
    fields: ["id", "phone"],
    filter: { phone: { _nnull: true } },
  });
  const { updates, unparsed } = planPhoneNormalization(people);
  if (updates.length > 0) {
    await directus.updateItems<PersonRow>("people", updates);
  }
  // Ids only: a phone that won't parse is still someone's phone.
  for (const id of unparsed) {
    winston.info("Phone left as typed: it doesn't parse", { personId: id });
  }
  return { normalized: updates.length, unparsed: unparsed.length };
}
