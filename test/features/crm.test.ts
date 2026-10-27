import "./steps/community.ts";
import { canSet, describeAccessFeature, Step } from "./steps/index.ts";

Step("they can set a class's program", () => canSet("classes", "program_id"));
Step("they can match a registration's sailor to a person in the CRM", () => canSet("participants", "person_id"));

describeAccessFeature("crm.feature");
