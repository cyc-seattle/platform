/**
 * Row shapes for the catalog's `offerings` (`schemas/core.yaml`) and the CRM's `registrations`
 * (`schemas/crm.yaml`). Staff make offerings and link each to its Clubspot class. clubspot-sync makes the
 * registrations from the Clubspot mirrors, and keeps each offering's confirmed count.
 */

/** What CSC sells: one program for one dated period, linked to a Clubspot class in one session, or in all of them. */
export interface OfferingRow {
  id: string;
  program_id: string;
  starts_on: string | null;
  ends_on: string | null;
  capacity: number | null;
  /** Null until staff link it to its Clubspot class. */
  clubspot_class_id: string | null;
  /** Null when the class's cap covers every session, so the class is one offering. */
  clubspot_session_id: string | null;
  confirmed_count: number;
  archived_at: string | null;
}

/** One person registered in one offering, from one Clubspot registration entry. */
export interface CrmRegistrationRow {
  id: string;
  person_id: string;
  offering_id: string;
  status: "confirmed" | "waitlist" | "cancelled";
  clubspot_entry_id: string;
}
