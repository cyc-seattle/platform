import type { ContactPointRow } from "../crm/index.ts";

/**
 * `contact_points.participant_id` is a provider extension field: a real column on `crm`'s
 * `contact_points` collection, declared in `schemas/clubspot.yaml` rather than `schemas/crm.yaml`,
 * because it points at `clubspot_participants`.
 */
export interface ContactPointParticipantFields {
  participant_id: string | null;
}

export type ContactPointWithParticipant = ContactPointRow & ContactPointParticipantFields;
