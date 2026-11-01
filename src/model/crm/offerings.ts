/**
 * Row shapes for the `offerings` and `registrations` collections. See `schemas/crm.yaml`. clubspot-sync
 * makes both from the Clubspot mirrors, and no one edits them by hand.
 */

/** A program sold for one dated period: a Clubspot class in one session, or in all of them. */
export interface OfferingRow {
  id: string;
  program_id: string;
  starts_on: string | null;
  ends_on: string | null;
  capacity: number | null;
  clubspot_class_id: string;
  /** Null when the class's cap covers every session, so the class is one offering. */
  clubspot_session_id: string | null;
}

/** One person registered in one offering, from one Clubspot registration entry. */
export interface CrmRegistrationRow {
  id: string;
  person_id: string;
  offering_id: string;
  status: "confirmed" | "waitlist" | "cancelled";
  clubspot_entry_id: string;
}
