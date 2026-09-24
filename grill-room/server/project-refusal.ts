import { fail } from "@agent-native/core/action";

import type { ProjectFactsRefusal } from "./project-facts.js";
import type { ProjectRefusal } from "./projects.js";

const STATUS_BY_CODE: Partial<Record<ProjectRefusal["errorCode"], number>> = {
  "project-not-found": 404,
  "project-exists": 409,
};

/**
 * Surface a refusal from the project registry as an action failure, keeping
 * its error code so the form can put the message beside the field at fault.
 */
export function failWithProjectRefusal(refusal: ProjectRefusal): never {
  fail(refusal.message, {
    errorCode: refusal.errorCode,
    statusCode: STATUS_BY_CODE[refusal.errorCode] ?? 400,
  });
}

const FACTS_STATUS_BY_CODE: Partial<Record<ProjectFactsRefusal["errorCode"], number>> = {};

/**
 * Surface a refusal from `collectProjectFacts` as an action failure, in the
 * same style as {@link failWithProjectRefusal}.
 */
export function failWithProjectFactsRefusal(refusal: ProjectFactsRefusal): never {
  fail(refusal.message, {
    errorCode: refusal.errorCode,
    statusCode: FACTS_STATUS_BY_CODE[refusal.errorCode] ?? 400,
  });
}
