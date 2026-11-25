import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const start = fs.readFileSync(path.join(import.meta.dirname, "../stacks/inbox/image/freescout-start"), "utf8");

describe("the inbox image", () => {
  // schedule:run --no-interaction never starts one, so without it queued mail is never sent.
  it("runs a queue worker for FreeScout's emails and default queues", () => {
    expect(start).toMatch(/php artisan queue:work --queue="\$worker_queue"/);
    expect(start).toMatch(/worker_queue="emails,default,/);
  });
});
