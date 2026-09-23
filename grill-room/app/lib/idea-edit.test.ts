import { describe, expect, it, vi } from "vitest";

import {
  changeDraft,
  READING,
  saveIdeaEdit,
  startEditing,
} from "@/lib/idea-edit";

/** What the action client throws for a refusal: an Error carrying the code. */
function refusal(errorCode: string, message: string): Error {
  return Object.assign(new Error(message), { errorCode });
}

describe("idea editing", () => {
  it("opens prefilled with the current idea", () => {
    expect(startEditing("A PWA for marathon training")).toEqual({
      mode: "editing",
      draft: "A PWA for marathon training",
      error: null,
    });
  });

  it("saves the draft through the action and closes the editor", async () => {
    const save = vi.fn().mockResolvedValue({ id: "s1" });

    const next = await saveIdeaEdit("A PWA for one runner's 16-week plan", save);

    expect(save).toHaveBeenCalledWith("A PWA for one runner's 16-week plan");
    expect(next).toEqual(READING);
  });

  it("keeps an empty idea open with the idea-required refusal", async () => {
    const save = vi
      .fn()
      .mockRejectedValue(refusal("idea-required", "The idea cannot be empty."));

    const next = await saveIdeaEdit("   ", save);

    expect(next).toEqual({
      mode: "editing",
      draft: "   ",
      error: { code: "idea-required", message: "The idea cannot be empty." },
    });
  });

  it("keeps the draft when the save fails for any other reason", async () => {
    const save = vi
      .fn()
      .mockRejectedValue(refusal("has-rounds", "The idea can no longer be edited."));

    const next = await saveIdeaEdit("New idea", save);

    expect(next).toMatchObject({
      mode: "editing",
      draft: "New idea",
      error: { code: "has-rounds" },
    });
  });

  it("clears a refusal as soon as the draft changes", () => {
    expect(changeDraft("A real idea")).toEqual({
      mode: "editing",
      draft: "A real idea",
      error: null,
    });
  });
});
