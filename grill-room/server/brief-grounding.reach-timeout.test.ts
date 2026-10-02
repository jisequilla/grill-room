import { describe, expect, it, vi } from "vitest";

import { measureReach, ReachUnmeasurable } from "./brief-grounding.js";
import { runGit } from "./git.js";

vi.mock("./git.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./git.js")>()),
  runGit: vi.fn(),
}));

describe("a git grep timeout", () => {
  it("a git grep timeout is reported as exit -1", async () => {
    vi.mocked(runGit).mockResolvedValue({ exitCode: -1, stdout: "", stderr: "" });

    const failure = await measureReach("/anywhere", "exportFolder").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ReachUnmeasurable);
    expect((failure as ReachUnmeasurable).exitCode).toBe(-1);
    expect((failure as ReachUnmeasurable).message).toMatch(/git grep exited -1\.$/);
  });
});
