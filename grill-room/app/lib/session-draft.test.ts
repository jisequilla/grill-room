import { describe, expect, it, vi } from "vitest";

import {
  SESSION_DRAFT_KEY,
  clearSessionDraft,
  hasDraftText,
  parseSessionDraft,
  readSessionDraft,
  withKnownProject,
  writeSessionDraft,
  type SessionDraft,
} from "@/lib/session-draft";

const FULL: SessionDraft = {
  title: "T",
  idea: "I",
  model: "opus",
  answeringMode: "whole-round",
  docsFolder: "docs",
  projectId: "p1",
};
const FULL_RAW = JSON.stringify(FULL);
const DEFAULTS: SessionDraft = {
  title: "",
  idea: "",
  model: null,
  answeringMode: "whole-round",
  docsFolder: "",
  projectId: null,
};

describe("parseSessionDraft", () => {
  it.each<[string, string | null, SessionDraft | null]>([
    ["null", null, null],
    ["not json", "not json", null],
    ["json null", "null", null],
    ["number", "3", null],
    ["boolean", "true", null],
    ["array", "[]", null],
    ["string", '"s"', null],
    ["full object", FULL_RAW, FULL],
    [
      "unknown model",
      JSON.stringify({ ...FULL, model: "gpt" }),
      { ...FULL, model: null },
    ],
    [
      "missing model",
      JSON.stringify({ ...FULL, model: undefined }),
      { ...FULL, model: null },
    ],
    [
      "unknown mode",
      JSON.stringify({ ...FULL, answeringMode: "x" }),
      { ...FULL, answeringMode: "whole-round" },
    ],
    ["title only", '{"title":"T"}', { ...DEFAULTS, title: "T" }],
    ["empty object", "{}", DEFAULTS],
    [
      "wrong-typed title",
      '{"title":3,"idea":"I"}',
      { ...DEFAULTS, idea: "I" },
    ],
    [
      "wrong-typed project",
      '{"projectId":7,"idea":"I"}',
      { ...DEFAULTS, idea: "I" },
    ],
    [
      "whitespace kept",
      '{"title":"  ","idea":" x "}',
      { ...DEFAULTS, title: "  ", idea: " x " },
    ],
  ])("%s", (_name, raw, expected) => {
    expect(parseSessionDraft(raw)).toEqual(expected);
  });
});

describe("hasDraftText", () => {
  it.each([
    [{ title: "", idea: "", docsFolder: "" }, false],
    [{ title: "  ", idea: "\n", docsFolder: " " }, false],
    [{ title: "", idea: "x", docsFolder: "" }, true],
    [{ title: "", idea: "", docsFolder: "docs" }, true],
  ])("%j", (draft, expected) => {
    expect(hasDraftText(draft)).toBe(expected);
  });
});

describe("withKnownProject", () => {
  it.each<[string, string | null, string[], string | null]>([
    ["known", "p1", ["p1", "p2"], "p1"],
    ["gone", "gone", ["p1"], null],
    ["none", null, [], null],
  ])("%s", (_name, projectId, ids, expected) => {
    const draft = { ...FULL, projectId };
    expect(withKnownProject(draft, ids)).toEqual({
      ...FULL,
      projectId: expected,
    });
  });
});

function fakeStorage() {
  return {
    getItem: vi.fn<(key: string) => string | null>(() => null),
    setItem: vi.fn<(key: string, value: string) => void>(),
    removeItem: vi.fn<(key: string) => void>(),
  };
}

function throwingStorage() {
  const boom = () => {
    throw new Error("blocked");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

describe("readSessionDraft", () => {
  it("returns a stored draft with text", () => {
    const storage = fakeStorage();
    storage.getItem.mockReturnValue(FULL_RAW);
    expect(readSessionDraft(storage)).toEqual(FULL);
    expect(storage.getItem).toHaveBeenCalledWith(SESSION_DRAFT_KEY);
  });

  it("returns null for a stored draft without text", () => {
    const storage = fakeStorage();
    storage.getItem.mockReturnValue(
      JSON.stringify({ ...FULL, title: " ", idea: "", docsFolder: "" }),
    );
    expect(readSessionDraft(storage)).toBeNull();
  });

  it("returns null for bad JSON", () => {
    const storage = fakeStorage();
    storage.getItem.mockReturnValue("{nope");
    expect(readSessionDraft(storage)).toBeNull();
  });

  it("returns null when the storage throws", () => {
    expect(readSessionDraft(throwingStorage())).toBeNull();
  });

  it("returns null without storage", () => {
    expect(readSessionDraft(undefined)).toBeNull();
  });
});

describe("writeSessionDraft", () => {
  it("writes a draft with text", () => {
    const storage = fakeStorage();
    writeSessionDraft(storage, FULL);
    expect(storage.setItem).toHaveBeenCalledWith(SESSION_DRAFT_KEY, FULL_RAW);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("removes the key instead of writing a draft without text", () => {
    const storage = fakeStorage();
    writeSessionDraft(storage, { ...FULL, title: "", idea: " ", docsFolder: "" });
    expect(storage.removeItem).toHaveBeenCalledWith(SESSION_DRAFT_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("does not throw when the storage throws", () => {
    expect(() => writeSessionDraft(throwingStorage(), FULL)).not.toThrow();
  });

  it("is a no-op without storage", () => {
    expect(() => writeSessionDraft(undefined, FULL)).not.toThrow();
  });
});

describe("clearSessionDraft", () => {
  it("removes the key", () => {
    const storage = fakeStorage();
    clearSessionDraft(storage);
    expect(storage.removeItem).toHaveBeenCalledWith(SESSION_DRAFT_KEY);
  });

  it("does not throw when the storage throws", () => {
    expect(() => clearSessionDraft(throwingStorage())).not.toThrow();
  });

  it("is a no-op without storage", () => {
    expect(() => clearSessionDraft(undefined)).not.toThrow();
  });
});
