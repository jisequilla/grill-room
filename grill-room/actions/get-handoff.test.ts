import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import getHandoff from "./get-handoff.js";
import registerProject from "./register-project.js";
import setSessionProject from "./set-session-project.js";
import updateProject from "./update-project.js";

const repos = useTempGitRepos();

function addRemote(root: string): void {
  execFileSync("git", ["-C", root, "remote", "add", "origin", "https://example.invalid/repo.git"], {
    stdio: "ignore",
  });
}

describe("get-handoff recipeWarning", () => {
  useTestDatabase();

  async function sessionOn(options: { remote: boolean; deliveryRecipe: "pull-request" | "local-merge" }) {
    const root = repos.create();
    if (options.remote) addRemote(root);
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
      deliveryRecipe: options.deliveryRecipe,
    });
    const session = await createSession.run({
      title: "T",
      idea: "An idea",
      projectId: project.id,
    });
    return { project, session };
  }

  it("warns for a pull-request project with no remote, with no handoff generated", async () => {
    const { session } = await sessionOn({ remote: false, deliveryRecipe: "pull-request" });

    const result = await getHandoff.run({ sessionId: session.id });

    expect(result.handoff).toBeNull();
    expect(result.recipeWarning).toBe("pull-request-without-remote");
  });

  it("stops warning once the project is switched to local-merge", async () => {
    const { project, session } = await sessionOn({ remote: false, deliveryRecipe: "pull-request" });

    await updateProject.run({ id: project.id, deliveryRecipe: "local-merge" });

    expect((await getHandoff.run({ sessionId: session.id })).recipeWarning).toBeNull();
  });

  it("does not warn for a pull-request project with a remote", async () => {
    const { session } = await sessionOn({ remote: true, deliveryRecipe: "pull-request" });

    expect((await getHandoff.run({ sessionId: session.id })).recipeWarning).toBeNull();
  });

  it("does not warn for a session with no project", async () => {
    const { session } = await sessionOn({ remote: false, deliveryRecipe: "pull-request" });
    await setSessionProject.run({ sessionId: session.id, projectId: null });

    expect((await getHandoff.run({ sessionId: session.id })).recipeWarning).toBeNull();
  });
});
