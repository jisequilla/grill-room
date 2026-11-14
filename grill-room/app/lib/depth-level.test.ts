import { describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import {
  changedValue,
  depthControlState,
  levelOnProfileLoad,
  setupActionsDisabled,
  setupSubmission,
  submitSetup,
  type DepthControlInput,
} from "@/lib/depth-level";

describe("setupSubmission", () => {
  it("setupSubmission S1", () => {
    expect(
      setupSubmission({
        action: "skip",
        pickedDepth: "full-spec",
        pickedLevel: "builder",
        profileLevel: "technical-not-building",
      }),
    ).toEqual({ depth: "first-working-version", levelToWrite: null });
  });

  it("setupSubmission S2", () => {
    expect(
      setupSubmission({
        action: "create",
        pickedDepth: "proof-of-concept",
        pickedLevel: "technical-not-building",
        profileLevel: "technical-not-building",
      }),
    ).toEqual({ depth: "proof-of-concept", levelToWrite: null });
  });

  it("setupSubmission S3", () => {
    expect(
      setupSubmission({
        action: "create",
        pickedDepth: "first-working-version",
        pickedLevel: "builder",
        profileLevel: "technical-not-building",
      }),
    ).toEqual({ depth: "first-working-version", levelToWrite: "builder" });
  });

  it("setupSubmission S4", () => {
    expect(
      setupSubmission({
        action: "create",
        pickedDepth: "full-spec",
        pickedLevel: null,
        profileLevel: null,
      }),
    ).toEqual({ depth: "full-spec", levelToWrite: null });
  });

  it("setupSubmission S5", () => {
    expect(
      setupSubmission({
        action: "create",
        pickedDepth: "full-spec",
        pickedLevel: "not-technical",
        profileLevel: null,
      }),
    ).toEqual({ depth: "full-spec", levelToWrite: "not-technical" });
  });

  it("setupSubmission S6", () => {
    expect(
      setupSubmission({
        action: "create",
        pickedDepth: "full-spec",
        pickedLevel: null,
        profileLevel: "builder",
      }),
    ).toEqual({ depth: "full-spec", levelToWrite: null });
  });

  it("setupSubmission S7", () => {
    expect(
      setupSubmission({
        action: "create",
        pickedDepth: "first-working-version",
        pickedLevel: "technical-not-building",
        profileLevel: "technical-not-building",
      }),
    ).toEqual({ depth: "first-working-version", levelToWrite: null });
  });
});

describe("levelOnProfileLoad", () => {
  it("levelOnProfileLoad P1", () => {
    expect(
      levelOnProfileLoad({
        userPicked: false,
        pickedLevel: null,
        profileLevel: "builder",
      }),
    ).toBe("builder");
  });

  it("levelOnProfileLoad P2", () => {
    expect(
      levelOnProfileLoad({
        userPicked: true,
        pickedLevel: "not-technical",
        profileLevel: "builder",
      }),
    ).toBe("not-technical");
  });

  it("levelOnProfileLoad P3", () => {
    expect(
      levelOnProfileLoad({
        userPicked: false,
        pickedLevel: null,
        profileLevel: null,
      }),
    ).toBeNull();
  });
});

describe("submitSetup", () => {
  it("submitSetup W1", async () => {
    const createSession = vi.fn().mockResolvedValue({ id: "s1" });
    const setLevel = vi.fn().mockResolvedValue(undefined);

    const result = await submitSetup({
      submission: { depth: "full-spec", levelToWrite: "builder" },
      setLevel,
      createSession,
    });

    expect(result).toEqual({ ok: true, sessionId: "s1" });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith("full-spec");
    expect(setLevel).toHaveBeenCalledTimes(1);
    expect(setLevel).toHaveBeenCalledWith("builder");
    expect(createSession.mock.invocationCallOrder[0]).toBeLessThan(
      setLevel.mock.invocationCallOrder[0]!,
    );
  });

  it("submitSetup W2", async () => {
    const error = new Error("refused");
    const createSession = vi.fn().mockRejectedValue(error);
    const setLevel = vi.fn().mockResolvedValue(undefined);

    const result = await submitSetup({
      submission: { depth: "full-spec", levelToWrite: "builder" },
      setLevel,
      createSession,
    });

    expect(result).toEqual({ ok: false, failed: "session", error });
    expect(setLevel).not.toHaveBeenCalled();
  });

  it("submitSetup W3", async () => {
    const error = new Error("level refused");
    const createSession = vi.fn().mockResolvedValue({ id: "s3" });
    const setLevel = vi.fn().mockRejectedValue(error);

    const result = await submitSetup({
      submission: { depth: "full-spec", levelToWrite: "builder" },
      setLevel,
      createSession,
    });

    expect(result).toEqual({
      ok: false,
      failed: "level",
      sessionId: "s3",
      error,
    });
  });

  it("submitSetup W4", async () => {
    const createSession = vi.fn().mockResolvedValue({ id: "s4" });
    const setLevel = vi.fn().mockResolvedValue(undefined);

    const result = await submitSetup({
      submission: { depth: "first-working-version", levelToWrite: null },
      setLevel,
      createSession,
    });

    expect(result).toEqual({ ok: true, sessionId: "s4" });
    expect(setLevel).not.toHaveBeenCalled();
  });
});

describe("setupActionsDisabled", () => {
  it("setupActionsDisabled D1", () => {
    expect(
      setupActionsDisabled({ profileLoaded: false, submitting: false }),
    ).toEqual({ create: true, back: true, skip: false, cancel: false });
  });

  it("setupActionsDisabled D2", () => {
    expect(
      setupActionsDisabled({ profileLoaded: true, submitting: true }),
    ).toEqual({ create: true, back: true, skip: true, cancel: true });
  });

  it("setupActionsDisabled D3", () => {
    expect(
      setupActionsDisabled({ profileLoaded: true, submitting: false }),
    ).toEqual({ create: false, back: false, skip: false, cancel: false });
  });
});

describe("depthControlState", () => {
  const cases: Array<[string, DepthControlInput, ReturnType<typeof depthControlState>]> = [
    [
      "H1",
      { hasRound: false, state: "interviewing", turnStatus: "idle", depth: "first-working-version", pendingDepth: null, specCurrent: false },
      { shownDepth: "first-working-version", disabled: false, noteKey: "workspace.depthAppliesNow", warningKeys: [] },
    ],
    [
      "H2",
      { hasRound: false, state: "interviewing", turnStatus: "working", depth: "first-working-version", pendingDepth: "full-spec", specCurrent: false },
      { shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesWhenStepFinishes", warningKeys: [] },
    ],
    [
      "H3",
      { hasRound: false, state: "interviewing", turnStatus: "working", depth: "first-working-version", pendingDepth: null, specCurrent: false },
      { shownDepth: "first-working-version", disabled: false, noteKey: "workspace.depthAppliesWhenStepFinishes", warningKeys: [] },
    ],
    [
      "H4",
      { hasRound: false, state: "interviewing", turnStatus: "failed", depth: "first-working-version", pendingDepth: "full-spec", specCurrent: false },
      { shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesWhenStepFinishes", warningKeys: [] },
    ],
    [
      "H5",
      { hasRound: true, state: "interviewing", turnStatus: "idle", depth: "full-spec", pendingDepth: null, specCurrent: false },
      { shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesNextRound", warningKeys: [] },
    ],
    [
      "H6",
      { hasRound: true, state: "interviewing", turnStatus: "working", depth: "full-spec", pendingDepth: null, specCurrent: false },
      { shownDepth: "full-spec", disabled: true, noteKey: "workspace.depthAppliesNextRound", warningKeys: [] },
    ],
    [
      "H7",
      { hasRound: false, state: "done-proposed", turnStatus: "working", depth: "proof-of-concept", pendingDepth: null, specCurrent: false },
      { shownDepth: "proof-of-concept", disabled: true, noteKey: "workspace.depthAppliesNextRound", warningKeys: ["workspace.depthReopensWarning"] },
    ],
    [
      "H8",
      { hasRound: true, state: "done-proposed", turnStatus: "idle", depth: "full-spec", pendingDepth: null, specCurrent: false },
      { shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesNextRound", warningKeys: ["workspace.depthReopensWarning"] },
    ],
    [
      "H9",
      { hasRound: true, state: "interviewing", turnStatus: "idle", depth: "full-spec", pendingDepth: null, specCurrent: true },
      { shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesNextRound", warningKeys: ["workspace.depthStaleWarning"] },
    ],
    [
      "H10",
      { hasRound: true, state: "confirmed", turnStatus: "idle", depth: "full-spec", pendingDepth: null, specCurrent: true },
      { shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesNextRound", warningKeys: ["workspace.depthReopensWarning", "workspace.depthStaleWarning"] },
    ],
    [
      "H11",
      { hasRound: true, state: "done-proposed", turnStatus: "idle", depth: "full-spec", pendingDepth: null, specCurrent: true },
      { shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesNextRound", warningKeys: ["workspace.depthReopensWarning"] },
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(`depthControlState ${name}`, () => {
      expect(depthControlState(input)).toEqual(expected);
    });
  }
});

describe("changedValue", () => {
  it("changedValue X1", () => {
    expect(changedValue("full-spec", "full-spec")).toBeNull();
  });

  it("changedValue X2", () => {
    expect(changedValue("full-spec", "proof-of-concept")).toBe(
      "proof-of-concept",
    );
  });

  it("changedValue X3", () => {
    expect(changedValue(null, "builder")).toBe("builder");
  });
});

const NEW_SESSIONS_KEYS = [
  "next",
  "back",
  "skip",
  "setupTitle",
  "setupDescription",
  "depthLabel",
  "levelLabel",
  "levelSaveFailed",
  "depthProofOfConcept",
  "depthProofOfConceptHelp",
  "depthFirstWorkingVersion",
  "depthFirstWorkingVersionHelp",
  "depthFullSpec",
  "depthFullSpecHelp",
  "levelBuilder",
  "levelBuilderHelp",
  "levelTechnicalNotBuilding",
  "levelTechnicalNotBuildingHelp",
  "levelNotTechnical",
  "levelNotTechnicalHelp",
] as const;

const NEW_WORKSPACE_KEYS = [
  "depthSelectLabel",
  "levelSelectLabel",
  "levelNotSet",
  "depthAppliesNow",
  "depthAppliesWhenStepFinishes",
  "depthAppliesNextRound",
  "levelAppliesNextRound",
  "depthReopensWarning",
  "depthStaleWarning",
  "depthChangeFailed",
  "levelChangeFailed",
] as const;

it("V1 new copy avoids preflight and open question", () => {
  const sessions = messages.sessions as Record<string, string>;
  const workspace = messages.workspace as Record<string, string>;
  const values = [
    ...NEW_SESSIONS_KEYS.map((key) => sessions[key]),
    ...NEW_WORKSPACE_KEYS.map((key) => workspace[key]),
  ];
  expect(values).toHaveLength(31);
  for (const value of values) {
    expect(typeof value).toBe("string");
    expect(value).not.toMatch(/preflight|pre-flight|open question/i);
  }
});
