import { afterEach, describe, expect, it } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
  type AssessReadinessRequest,
} from "../server/interviewer/index.js";
import { anAssessReadinessResult } from "../server/interviewer/test-fixtures.js";
import { useTestDatabase } from "../test/db.js";
import assessReadiness from "./assess-readiness.js";
import createSession from "./create-session.js";

function readinessRequests(
  requests: readonly { kind: string }[],
): AssessReadinessRequest[] {
  return requests.filter(
    (request): request is AssessReadinessRequest =>
      request.kind === "assess-readiness",
  );
}

describe("assess-readiness", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("hands a retry the reason and the previous answer, then stores the accepted result", async () => {
    const session = await createSession.run({
      title: "Marathon tracker",
      idea: "A local app that helps a runner follow a 16-week marathon plan.",
      model: "opus",
    });
    // A `ready` verdict with no evidence breaks the app's own rule, so the
    // first attempt is refused and retried; the second passes.
    const refused = anAssessReadinessResult({ verdict: "ready", evidence: [] });
    const accepted = anAssessReadinessResult();
    const interviewer = scriptInterviewer([
      { kind: "assess-readiness", result: refused },
      { kind: "assess-readiness", result: accepted },
    ]);

    const judged = await assessReadiness.run({ sessionId: session.id });

    const requests = readinessRequests(interviewer.requests);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ rejectionReason: null, previousResult: null });
    expect(requests[1]!.rejectionReason).toMatch(/at least one evidence item/);
    expect(requests[1]!.previousResult).toEqual(refused);

    expect(judged.readiness!.result).toEqual(accepted);
  });
});
