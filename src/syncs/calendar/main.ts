import { fileURLToPath } from "node:url";
import { Command } from "@commander-js/extra-typings";
import { LoggingOption, VerboseOption } from "@cyc-seattle/commodore";
import { google } from "googleapis";
import winston from "winston";
import { loadCalendarSync } from "./calendar.ts";

const program = new Command("calendar-sync")
  .description("Syncs events from a Google Spreadsheet to Google Calendar")
  .requiredOption("--spreadsheet-id <id>", "Google Spreadsheet ID or URL")
  .option("--events-worksheet <name>", "Events worksheet name", "Events")
  .option("--calendars-worksheet <name>", "Calendars worksheet name", "Calendars")
  .addOption(new LoggingOption())
  .addOption(new VerboseOption("info"))
  .hook("preAction", (command) => {
    const opts = command.opts();
    winston.configure({
      level: opts.verbose ?? "info",
      format: opts.logging,
      transports: new winston.transports.Stream({ stream: process.stderr }),
    });
  })
  .action(async (options) => {
    try {
      const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/spreadsheets"],
      });
      const sync = await loadCalendarSync(
        auth,
        options.spreadsheetId,
        options.calendarsWorksheet,
        options.eventsWorksheet,
      );
      const result = await sync.sync();
      winston.info("Sync completed", { created: result.created, updated: result.updated });
    } catch (error) {
      winston.error("Sync failed", { error });
      process.exit(1);
    }
  });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await program.parseAsync();
}
