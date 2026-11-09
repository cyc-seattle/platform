/** Row shapes for the `people`, `contacts`, and `medical_profiles` collections. See `schemas/crm.yaml`. */
export interface PersonRow {
  id?: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  /** Optional, unlike every other column here: only the promoted-fields pass writes it, never person-sync. */
  school_id?: string | null;
  /** The school in their own words, when `school_id` is null because it isn't on the list ("Other"). */
  school?: string | null;
  /** What this adult last answered before households held the answer. Only read, to seed a new household. */
  share_contact?: boolean | null;
  /** The name apps show, set by the person or their household. Never synced. */
  display_name?: string | null;
  /** Set only by the households pass, from guardian links. */
  household_id?: string | null;
}

/** A sailor and their guardians, with the guardians' other children (`schemas/crm.yaml`). */
export interface HouseholdRow {
  id: string;
  /** Whether the household's adults share their email and phone with teams. Null means never answered. */
  share_contact: boolean | null;
}

/** A school a sailor can sail for (`schemas/crm.yaml`). */
export interface SchoolRow {
  id: string;
  name: string;
  /** Other ways families write it, matched like the name. Null means none. */
  aliases: string[] | null;
}

export type ContactRelationshipType = "guardian" | "emergency_contact";

export interface ContactRow {
  id?: string;
  subject_id: string;
  contact_id: string;
  relationship_type: ContactRelationshipType;
  contact_order: number;
  relationship_detail: string | null;
}

export interface MedicalProfileRow {
  id?: string;
  person_id: string;
  allergies: string | null;
  medications: string | null;
  conditions: string | null;
  physician_name: string | null;
  physician_phone: string | null;
  last_tetanus: string | null;
  weight: number | null;
}
