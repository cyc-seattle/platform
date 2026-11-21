import winston from "winston";
import { type AddMemberResult, type GroupRole } from "@cyc-seattle/gsuite-sdk";

/** The slice of `DirectoryClient` the membership pass writes through - narrow enough that a
 * `DirectoryClient` instance satisfies it structurally, with no wrapping needed for a real run. */
export interface MemberAdder {
  addMember(groupKey: string, email: string, role: GroupRole): Promise<AddMemberResult>;
}

/** `DirectoryClient` has no built-in dry-run mode, unlike `DirectusClient` - this stands in for it
 * on the Google side of a `--dry-run` run, logging the write instead of making it. */
export function dryRunMemberAdder(): MemberAdder {
  return {
    async addMember(groupKey, email, role) {
      winston.info("Dry run: skipping add group member", { groupKey, email, role });
      return "added";
    },
  };
}

/** Takes a member out of a group: the one write a group in the CRM needs that a program's never does. */
export interface MemberRemover {
  removeMember(groupKey: string, email: string): Promise<void>;
}

/** Logs the removal instead of making it, for a `--dry-run` run. */
export function dryRunMemberRemover(): MemberRemover {
  return {
    async removeMember(groupKey, email) {
      winston.info("Dry run: skipping remove group member", { groupKey, email });
    },
  };
}
