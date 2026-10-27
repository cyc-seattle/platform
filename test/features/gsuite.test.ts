import { expect } from "vitest";
import { asAdmin, newRunId, proxyOk, runCronJob } from "./cluster.ts";
import { describeAccessFeature, readOnly, Step } from "./steps/index.ts";

// The sync scenarios set up a program and its role holders in dev's CRM, run the gsuite-sync
// CronJob as a Job, and read the Workspace fake's Directory API through the Kubernetes API's service
// proxy. Their groups and people carry a run ID, so runs never depend on each other.

interface MembershipRow {
  id: string;
  added_at: string;
  removed_at: string | null;
}

Step("it can see only which sailor each registration is for", () => readOnly("participants", ["id", "person_id"]));
Step("it can see only each extra email or phone number, and whose it is", () =>
  readOnly("contact_points", ["id", "person_id", "kind", "normalized"]),
);

/** A program with a Google group, in the CRM and the Workspace fake, for one scenario. */
function programWithGroup() {
  const runId = newRunId();
  const groupEmail = `program.${runId}@example.test`;
  let groupId: string;
  let programId: string;
  let jobs = 0;

  return {
    async create(): Promise<void> {
      await proxyOk("workspace-fake", 8080, "POST", "/admin/directory/v1/groups", {
        email: groupEmail,
        name: `Program ${runId}`,
      });
      // Discovery matches the row to the live group by email. Staff link a program to its row by hand.
      const group = await asAdmin("POST", "/items/google_groups", { email: groupEmail, name: `Program ${runId}` });
      const program = await asAdmin("POST", "/items/programs", { name: `Program ${runId}`, google_group_id: group.id });
      groupId = group.id;
      programId = program.id;
    },

    /** A person with a role in the program, and their email. */
    async roleHolder(firstName: string): Promise<{ id: string; email: string }> {
      const email = `${firstName.toLowerCase()}.${runId}@example.test`;
      const person = await asAdmin("POST", "/items/people", { first_name: firstName, last_name: runId, email });
      const role = await asAdmin("POST", "/items/program_roles", { name: `${firstName} ${runId}` });
      await asAdmin("POST", "/items/program_role_assignments", {
        person_id: person.id,
        program_id: programId,
        program_role_id: role.id,
      });
      return { id: person.id, email };
    },

    async members(): Promise<string[]> {
      const body = await proxyOk(
        "workspace-fake",
        8080,
        "GET",
        `/admin/directory/v1/groups/${encodeURIComponent(groupEmail)}/members`,
      );
      return (body.members ?? []).map((member: { email: string }) => member.email);
    },

    async memberships(personId: string): Promise<MembershipRow[]> {
      const query = new URLSearchParams({ "filter[group_id][_eq]": groupId, "filter[person_id][_eq]": personId });
      return asAdmin("GET", `/items/google_group_memberships?${query}`);
    },

    async recordMembership(personId: string, email: string, addedAt: string): Promise<void> {
      await asAdmin("POST", "/items/google_group_memberships", {
        group_id: groupId,
        person_id: personId,
        email,
        added_at: addedAt,
        removed_at: null,
      });
    },

    // Job names must be unique.
    async sync(): Promise<void> {
      await runCronJob("gsuite-sync", jobs++ === 0 ? runId : `${runId}-${jobs}`);
    },
  };
}

describeAccessFeature("gsuite.feature", {
  "A coach joins their program's group": ({ Given, And, When, Then }) => {
    const program = programWithGroup();
    let coach: { id: string; email: string };

    Given("a program with a Google group", () => program.create());
    And("a person with a role in the program", async () => {
      coach = await program.roleHolder("Coach");
    });
    When("the Google sync runs", () => program.sync());
    Then("they're in the group", async () => {
      expect(await program.members()).toContain(coach.email);
    });
  },

  "Staff let someone who left back into the group": ({ Given, And, When, Then }) => {
    const program = programWithGroup();
    const addedAt = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    let leaver: { id: string; email: string };
    let removedRowId: string | undefined;

    Given("a program with a Google group", () => program.create());

    // The Workspace fake can't remove a member, so the person is out of the group from the start,
    // while the CRM still notes that gsuite-sync added them.
    And("a person with a role in the program, who has left the group", async () => {
      leaver = await program.roleHolder("Leaver");
      await program.recordMembership(leaver.id, leaver.email, addedAt);
    });

    When("the Google sync runs", () => program.sync());

    // The CRM notes that they left, which is what keeps gsuite-sync from adding them back.
    Then("they're still not in the group", async () => {
      expect(await program.members()).not.toContain(leaver.email);
      const rows = await program.memberships(leaver.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.removed_at).not.toBeNull();
      removedRowId = rows[0]!.id;
    });

    // Staff let someone back in by deleting the note that they left.
    When("staff let them back into the group", async () => {
      if (!removedRowId) {
        throw new Error("No removed membership row to delete: the step that finds it failed.");
      }
      await asAdmin("DELETE", `/items/google_group_memberships/${removedRowId}`);
    });

    And("the Google sync runs again", () => program.sync());

    Then("they're in the group again", async () => {
      expect(await program.members()).toContain(leaver.email);
      const rows = await program.memberships(leaver.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).not.toBe(removedRowId);
      expect(rows[0]!.removed_at).toBeNull();
      expect(Date.parse(rows[0]!.added_at)).toBeGreaterThan(Date.parse(addedAt));
    });
  },
});
