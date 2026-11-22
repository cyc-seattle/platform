import { expect } from "vitest";
import { asAdmin, newRunId, proxyOk, runCronJob } from "./cluster.ts";
import { describeAccessFeature, readOnly, Step } from "./steps/index.ts";
import { runGoogleSync, runGoogleSyncForGroup } from "./syncs.ts";

// The sync scenarios set up a program and its role holders in dev's CRM, run gsuite-sync on that
// program, and read the Workspace fake's Directory API through the Kubernetes API's service proxy.
// Their groups and people carry a run ID, so runs never depend on each other. The first scenario runs
// the CronJob as a Job instead, which proves the deployed image and its config.

interface MembershipRow {
  id: string;
  added_at: string;
  removed_at: string | null;
}

Step("it can see only which sailor each registration is for", () =>
  readOnly("clubspot_participants", ["id", "person_id"]),
);
Step("it can see only each group's name and Google group, and who is in it", async () => {
  await readOnly("groups", ["id", "name", "google_group_id"]);
  await readOnly("group_members", ["id", "group_id", "person_id"]);
});
Step("it can see only each extra email or phone number, and whose it is", () =>
  readOnly("contact_points", ["id", "person_id", "kind", "normalized"]),
);

/** A program with a Google group, in the CRM and the Workspace fake, for one scenario. */
function programWithGroup() {
  const runId = newRunId();
  const groupEmail = `program.${runId}@example.test`;
  let groupId: string;
  let programId: string;

  return {
    async create(): Promise<void> {
      await proxyOk("workspace-fake", 8080, "POST", "/admin/directory/v1/groups", {
        email: groupEmail,
        name: `Program ${runId}`,
      });
      // Discovery matches the row to the live group by email. Staff link a program to its row by hand.
      const group = await asAdmin("POST", "/items/google_groups", { email: groupEmail, name: `Program ${runId}` });
      const product = await asAdmin("POST", "/items/products", { name: `Program ${runId}`, kind: "program" });
      const program = await asAdmin("POST", "/items/programs", {
        name: `Program ${runId}`,
        product_id: product.id,
        google_group_id: group.id,
      });
      groupId = group.id;
      programId = program.id;
    },

    /** A person on Crew with a term for the program in `positionName`, from and to the given days. */
    async termHolder(
      positionName: string,
      dates: { starts_on?: string; ends_on?: string } = {},
    ): Promise<{ id: string; email: string }> {
      const email = `${positionName.toLowerCase()}.${runId}@example.test`;
      const person = await asAdmin("POST", "/items/people", { first_name: positionName, last_name: runId, email });
      const member = await asAdmin("POST", "/items/crew_members", { person_id: person.id });
      const position = await asAdmin("POST", "/items/crew_positions", { name: `${positionName} ${runId}` });
      await asAdmin("POST", "/items/crew_terms", {
        crew_member_id: member.id,
        position_id: position.id,
        program_id: programId,
        ...dates,
      });
      return { id: person.id, email };
    },
    /** Someone put in the Google group by hand, as the sync would have when their term began. */
    async addToGroup(email: string): Promise<void> {
      await proxyOk(
        "workspace-fake",
        8080,
        "POST",
        `/admin/directory/v1/groups/${encodeURIComponent(groupEmail)}/members`,
        {
          email,
          role: "MEMBER",
        },
      );
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

    sync(): Promise<void> {
      return runGoogleSync(programId);
    },

    syncAsJob(): Promise<void> {
      return runCronJob("gsuite-sync", runId);
    },
  };
}

/** A group in the CRM that fills a Google group, in the CRM and the Workspace fake, for one scenario. */
function crmGroupWithGoogleGroup() {
  const runId = newRunId();
  const groupEmail = `group.${runId}@example.test`;
  let googleGroupId: string;
  let groupId: string;
  let serial = 0;
  return {
    /**
     * The Google group, and a group in the CRM that fills it. Unless `empty`, the group has a member
     * who stays, already synced in, so taking one person out never empties the Google group.
     */
    async create({ empty = false } = {}): Promise<void> {
      await proxyOk("workspace-fake", 8080, "POST", "/admin/directory/v1/groups", {
        email: groupEmail,
        name: `Group ${runId}`,
      });
      const googleGroup = await asAdmin("POST", "/items/google_groups", { email: groupEmail, name: `Group ${runId}` });
      googleGroupId = googleGroup.id;
      const group = await asAdmin("POST", "/items/groups", { name: `Group ${runId}`, google_group_id: googleGroupId });
      groupId = group.id;
      if (!empty) {
        await this.addPerson();
        await this.sync();
      }
    },
    /** A person an admin adds to the group, with their email and their membership's id. */
    async addPerson(): Promise<{ email: string; memberId: string }> {
      const email = `member${++serial}.${runId}@example.test`;
      const person = await asAdmin("POST", "/items/people", { first_name: "Member", last_name: runId, email });
      const member = await asAdmin("POST", "/items/group_members", { group_id: groupId, person_id: person.id });
      return { email, memberId: member.id };
    },
    async removeMember(memberId: string): Promise<void> {
      await asAdmin("DELETE", `/items/group_members/${memberId}`);
    },
    /** Someone added to the Google group by hand, in Workspace, with `role`. */
    async addByHand(role: "MEMBER" | "MANAGER"): Promise<string> {
      const email = `by-hand${++serial}.${runId}@example.test`;
      await proxyOk(
        "workspace-fake",
        8080,
        "POST",
        `/admin/directory/v1/groups/${encodeURIComponent(groupEmail)}/members`,
        {
          email,
          role,
        },
      );
      return email;
    },
    /** A program whose Google group is this group's too. */
    async sharedWithAProgram(): Promise<void> {
      const product = await asAdmin("POST", "/items/products", { name: `Program ${runId}`, kind: "program" });
      await asAdmin("POST", "/items/programs", {
        name: `Program ${runId}`,
        product_id: product.id,
        google_group_id: googleGroupId,
      });
    },
    /** The Google group's members, by email, with their role. */
    async members(): Promise<Record<string, string>> {
      const body = await proxyOk(
        "workspace-fake",
        8080,
        "GET",
        `/admin/directory/v1/groups/${encodeURIComponent(groupEmail)}/members`,
      );
      return Object.fromEntries(
        (body.members ?? []).map((member: { email: string; role: string }) => [member.email, member.role]),
      );
    },
    sync(): Promise<void> {
      return runGoogleSyncForGroup(groupId);
    },
  };
}

/** A day `days` from today, as a date. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60_000).toISOString().slice(0, 10);
}

Step(
  "it can see only each term's crew member, program, program area, and dates, and each crew member's person",
  async () => {
    await readOnly("crew_terms", ["id", "crew_member_id", "program_id", "program_area_id", "starts_on", "ends_on"]);
    await readOnly("crew_members", ["id", "person_id"]);
  },
);

describeAccessFeature("gsuite.feature", {
  "A coach whose term starts next month isn't added yet": ({ Given, And, When, Then }) => {
    const program = programWithGroup();
    let coach: { email: string };
    Given("a program with a Google group", () => program.create());
    And("a coach whose term for the program starts next month", async () => {
      coach = await program.termHolder("Coach", { starts_on: daysFromNow(30) });
    });
    When("the Google sync runs", () => program.sync());
    Then("they're not in the group", async () => {
      expect(await program.members()).not.toContain(coach.email);
    });
  },
  "A coach whose term ended leaves the group": ({ Given, And, When, Then }) => {
    const program = programWithGroup();
    let coach: { email: string };
    Given("a program with a Google group", () => program.create());
    And("a coach in the group, whose term for the program ended last month", async () => {
      coach = await program.termHolder("Coach", { starts_on: daysFromNow(-120), ends_on: daysFromNow(-30) });
      await program.addToGroup(coach.email);
    });
    When("the Google sync runs", () => program.sync());
    Then("they're not in the group", async () => {
      expect(await program.members()).not.toContain(coach.email);
    });
  },
  "A new board member gets the board's email": ({ Given, When, And, Then }) => {
    const group = crmGroupWithGoogleGroup();
    let added: { email: string };
    Given("a group in the CRM that fills a Google group", () => group.create());
    When("an admin adds someone to the group", async () => {
      added = await group.addPerson();
    });
    And("the Google sync runs for the group", () => group.sync());
    Then("they're in the Google group", async () => {
      expect(await group.members()).toHaveProperty([added.email], "MEMBER");
    });
  },
  "Someone taken out of the group leaves the Google group": ({ Given, When, And, Then }) => {
    const group = crmGroupWithGoogleGroup();
    let member: { email: string; memberId: string };
    Given("a member of a group in the CRM that fills a Google group", async () => {
      await group.create();
      member = await group.addPerson();
      await group.sync();
      expect(await group.members()).toHaveProperty([member.email]);
    });
    When("an admin takes them out of the group", () => group.removeMember(member.memberId));
    And("the Google sync runs for the group", () => group.sync());
    Then("they're not in the Google group", async () => {
      expect(await group.members()).not.toHaveProperty([member.email]);
    });
  },
  "Someone added to the Google group by hand is taken out": ({ Given, And, When, Then }) => {
    const group = crmGroupWithGoogleGroup();
    let outsider: string;
    Given("a group in the CRM that fills a Google group", () => group.create());
    And("someone not in the group, added to the Google group by hand", async () => {
      outsider = await group.addByHand("MEMBER");
    });
    When("the Google sync runs for the group", () => group.sync());
    Then("they're not in the Google group", async () => {
      expect(await group.members()).not.toHaveProperty([outsider]);
    });
  },
  "The Google sync won't empty a Google group by itself": ({ Given, When, Then }) => {
    const group = crmGroupWithGoogleGroup();
    let members: string[];
    Given("a Google group with members, which a group in the CRM with no one in it starts to fill", async () => {
      await group.create({ empty: true });
      members = [await group.addByHand("MEMBER"), await group.addByHand("MEMBER")];
    });
    When("the Google sync runs for the group", () => group.sync());
    Then("they're all still in the Google group", async () => {
      const live = await group.members();
      for (const email of members) expect(live).toHaveProperty([email], "MEMBER");
    });
  },
  "The Google group's manager stays": ({ Given, And, When, Then }) => {
    const group = crmGroupWithGoogleGroup();
    let manager: string;
    Given("a group in the CRM that fills a Google group", () => group.create());
    And("a manager of the Google group who isn't in the group", async () => {
      manager = await group.addByHand("MANAGER");
    });
    When("the Google sync runs for the group", () => group.sync());
    Then("they're still a manager of the Google group", async () => {
      expect(await group.members()).toHaveProperty([manager], "MANAGER");
    });
  },
  "A program and a group fill the same Google group": ({ Given, And, When, Then }) => {
    const group = crmGroupWithGoogleGroup();
    let added: { email: string };
    Given("a group in the CRM that fills a Google group", () => group.create());
    And("a program whose Google group is the same one", () => group.sharedWithAProgram());
    When("an admin adds someone to the group", async () => {
      added = await group.addPerson();
    });
    // The run for one group refuses a contested Google group, as the full run skips it.
    And("the Google sync runs for the group", () => expect(group.sync()).rejects.toThrow(/failed/));
    Then("they're not in the Google group", async () => {
      expect(await group.members()).not.toHaveProperty([added.email]);
    });
  },
  "A coach joins their program's group": ({ Given, And, When, Then }) => {
    const program = programWithGroup();
    let coach: { id: string; email: string };

    Given("a program with a Google group", () => program.create());
    And("a coach in the program", async () => {
      coach = await program.termHolder("Coach");
    });
    When("the Google sync runs", () => program.syncAsJob());
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
    And("a coach in the program who has left the group", async () => {
      leaver = await program.termHolder("Coach");
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
