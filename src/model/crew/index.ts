/**
 * Row shapes for Crew's collections (`schemas/crew.yaml`, docs/crew-schema.md), and when a term is
 * current. Staff enter them by hand; no sync writes them but a person merge, which moves a crew member.
 */

/** Someone who works for CSC, and what the website shows of them. One per person. */
export interface CrewMemberRow {
  id: string;
  person_id: string;
  website_bio: string | null;
  website_photo: string | null;
  on_website: boolean;
}

/** A job, such as Treasurer or Parent Coordinator. */
export interface CrewPositionRow {
  id: string;
  name: string;
  description: string | null;
}

/** One crew member in one position. Either date may be blank, for no bound on that side. */
export interface CrewTermRow {
  id: string;
  crew_member_id: string;
  position_id: string;
  program_id: string | null;
  program_area_id: string | null;
  starts_on: string | null;
  ends_on: string | null;
  note: string | null;
  staff_level_id: string | null;
  hourly_rate_cents: number | null;
  profit_share: boolean;
}

/** A qualification a crew member holds. A renewal is a new row. */
export interface CrewQualificationRow {
  id: string;
  crew_member_id: string;
  qualification_id: string;
  earned_on: string;
  expires_on: string | null;
  note: string | null;
}

/** The qualifications a position needs. */
export interface CrewPositionQualificationRow {
  id: string;
  position_id: string;
  qualification_id: string;
}

/** CSC's own calendar day, so a term's last day lasts until midnight in Seattle. */
export function seattleDate(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** Whether a term is current on `now`'s day in Seattle: both dates count, and a blank one has no bound. */
export function isCurrentTerm(term: Pick<CrewTermRow, "starts_on" | "ends_on">, now: Date): boolean {
  const today = seattleDate(now);
  return (term.starts_on == null || term.starts_on <= today) && (term.ends_on == null || term.ends_on >= today);
}
