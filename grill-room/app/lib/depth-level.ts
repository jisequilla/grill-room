import {
  DEFAULT_DEPTH,
  type Depth,
  type TechnicalLevel,
} from "@shared/session-constants";

import type { SessionState } from "@/lib/decisions";

export type SetupAction = "create" | "skip";

export interface SetupSubmission {
  depth: Depth;
  /** The level to write to the owner's profile, or null to leave it as it is. */
  levelToWrite: TechnicalLevel | null;
}

/**
 * What the setup step sends. Skip sends the default depth and leaves the
 * profile alone, whatever was picked. Create sends the picked depth and writes
 * the picked level only when it differs from the profile's; a level is never
 * cleared.
 */
export function setupSubmission({
  action,
  pickedDepth,
  pickedLevel,
  profileLevel,
}: {
  action: SetupAction;
  pickedDepth: Depth;
  pickedLevel: TechnicalLevel | null;
  profileLevel: TechnicalLevel | null;
}): SetupSubmission {
  if (action === "skip") return { depth: DEFAULT_DEPTH, levelToWrite: null };
  const levelToWrite =
    pickedLevel !== null && pickedLevel !== profileLevel ? pickedLevel : null;
  return { depth: pickedDepth, levelToWrite };
}

/**
 * The level the setup step shows: the owner's own pick once they made one,
 * else the profile's, which may arrive after the dialog opened.
 */
export function levelOnProfileLoad({
  userPicked,
  pickedLevel,
  profileLevel,
}: {
  userPicked: boolean;
  pickedLevel: TechnicalLevel | null;
  profileLevel: TechnicalLevel | null;
}): TechnicalLevel | null {
  return userPicked ? pickedLevel : profileLevel;
}

export type SetupResult =
  | { ok: true; sessionId: string }
  | { ok: false; failed: "session"; error: unknown }
  | { ok: false; failed: "level"; sessionId: string; error: unknown };

/**
 * Creates the session, then writes the level. The session comes first so a
 * refused create never leaves the profile changed.
 */
export async function submitSetup({
  submission,
  setLevel,
  createSession,
}: {
  submission: SetupSubmission;
  setLevel: (level: TechnicalLevel) => Promise<unknown>;
  createSession: (depth: Depth) => Promise<{ id: string }>;
}): Promise<SetupResult> {
  let session: { id: string };
  try {
    session = await createSession(submission.depth);
  } catch (error) {
    return { ok: false, failed: "session", error };
  }
  if (submission.levelToWrite !== null) {
    try {
      await setLevel(submission.levelToWrite);
    } catch (error) {
      return { ok: false, failed: "level", sessionId: session.id, error };
    }
  }
  return { ok: true, sessionId: session.id };
}

/**
 * Which setup-step buttons are disabled. Create and Back read the profile, so
 * they wait for it; every button waits for a submission in flight.
 */
export function setupActionsDisabled({
  profileLoaded,
  submitting,
}: {
  profileLoaded: boolean;
  submitting: boolean;
}): { create: boolean; back: boolean; skip: boolean; cancel: boolean } {
  const waitsForProfile = !profileLoaded || submitting;
  return {
    create: waitsForProfile,
    back: waitsForProfile,
    skip: submitting,
    cancel: submitting,
  };
}

export interface DepthControlInput {
  hasRound: boolean;
  state: SessionState;
  turnStatus: string;
  depth: Depth;
  pendingDepth: Depth | null;
  specCurrent: boolean;
}

export interface DepthControlState {
  shownDepth: Depth;
  disabled: boolean;
  noteKey: string;
  warningKeys: string[];
}

/**
 * The header depth control, from the rule `set-session-depth` applies: before
 * the interview starts a pick applies now, or queues while a turn is working;
 * after it starts a pick applies from the next round and is refused while a
 * turn is working.
 */
export function depthControlState({
  hasRound,
  state,
  turnStatus,
  depth,
  pendingDepth,
  specCurrent,
}: DepthControlInput): DepthControlState {
  const started = hasRound || state !== "interviewing";
  const working = turnStatus === "working";
  const noteKey =
    pendingDepth !== null || (!started && working)
      ? "workspace.depthAppliesWhenStepFinishes"
      : started
        ? "workspace.depthAppliesNextRound"
        : "workspace.depthAppliesNow";
  const warningKeys: string[] = [];
  if (state === "done-proposed" || state === "confirmed") {
    warningKeys.push("workspace.depthReopensWarning");
  }
  if (specCurrent && state !== "done-proposed") {
    warningKeys.push("workspace.depthStaleWarning");
  }
  return {
    shownDepth: pendingDepth ?? depth,
    disabled: started && working,
    noteKey,
    warningKeys,
  };
}

/** The picked value when it changes anything, else null: no call to make. */
export function changedValue<T>(current: T | null, picked: T): T | null {
  return current === picked ? null : picked;
}
