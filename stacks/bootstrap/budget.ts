import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config.ts";
import { enableService } from "../../src/services.ts";

// A monthly budget on the whole billing account, so a project outside this repo counts too (#171).
// Its emails go to the account's Billing Account Administrators and Users. Applying it needs
// Billing Account Costs Manager on the account.

const budgetsApi = enableService("billingbudgets.googleapis.com");

// The Budget API refuses a person's credentials unless the call names a quota project.
const budgetsProvider = new gcp.Provider("billing-budgets", {
  project: projectId,
  billingProject: projectId,
  userProjectOverride: true,
});

const main = gcp.organizations.getProjectOutput({ projectId });

export const monthlyBudget = new gcp.billing.Budget(
  "monthly",
  {
    billingAccount: main.billingAccount.apply((account) => {
      if (!account) {
        throw new Error(`${projectId} has no billing account.`);
      }
      return account;
    }),
    displayName: "Monthly cloud bill",
    amount: { specifiedAmount: { currencyCode: "USD", units: "150" } },
    thresholdRules: [
      { thresholdPercent: 0.5 },
      { thresholdPercent: 0.9 },
      { thresholdPercent: 1.0 },
      // Forecast, so a month heading over warns before it's spent.
      { thresholdPercent: 1.0, spendBasis: "FORECASTED_SPEND" },
    ],
  },
  { provider: budgetsProvider, dependsOn: budgetsApi },
);
