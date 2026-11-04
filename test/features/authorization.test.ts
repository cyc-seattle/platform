import { describeAccessFeature, setThey, Step, them } from "./steps/index.ts";
import { forget, newPerson, userFor } from "./steps/logins.ts";
import { admin, adminCreate } from "./steps/rows.ts";
import { onATeam, type Season } from "./steps/teams.ts";

// The hook that moves families between Community and Team (cyc-seattle/workplace#6 decision 27).

/**
 * Gives the signed-in user a family of their own, in place of the one they had: `family` makes the
 * person, and their login moves to it once it's made, so the hook never sees them half made. The
 * scenario changes a shared actor's family, so later scenarios get one of their own.
 */
async function aFamilyOfTheirOwn(family: (personId: string) => Promise<void>): Promise<void> {
  const they = them();
  const userId = await they.userId();
  if (they.actor !== undefined) {
    const user = await userFor(they.actor);
    forget(they.actor);
    setThey({ session: async () => user.session, userId: async () => user.userId });
  }
  const personId = await newPerson({ date_of_birth: "1980-01-01" });
  await family(personId);
  // One batch, in one transaction: unlinked first, the hook would link the old person back by email.
  const session = await admin();
  const filter = encodeURIComponent(JSON.stringify({ directus_user_id: { _eq: userId } }));
  const old = await session.ok("GET", `/items/people?filter=${filter}&fields=id`);
  await session.ok("PATCH", "/items/people", [
    ...old.map(({ id }: { id: string }) => ({ id, directus_user_id: null })),
    { id: personId, directus_user_id: userId },
  ]);
}

const theirChildOnATeam = (season: Season) =>
  aFamilyOfTheirOwn(async (parentId) => {
    const childId = await newPerson({ date_of_birth: "2014-01-01" });
    await adminCreate("contacts", { subject_id: childId, contact_id: parentId, relationship_type: "guardian" });
    await onATeam(childId, season);
  });

Step("their child signs up for a team", () => theirChildOnATeam("running"));
Step("they sign up for a team", () => aFamilyOfTheirOwn((personId) => onATeam(personId)));
Step("their child's last time on a team ended a month ago", () => theirChildOnATeam("ended"));
Step("their child's last time on a team ended 13 months ago", () => theirChildOnATeam("lapsed"));

describeAccessFeature("authorization.feature");
