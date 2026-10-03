import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import getProject from "./get-project.js";
import registerProject from "./register-project.js";
import updateProject from "./update-project.js";

const repos = useTempGitRepos();

describe("update-project", () => {
  useTestDatabase();

  async function aProject() {
    return registerProject.run({
      root: repos.create(),
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
  }

  it("register-project stores a given tickets in flight", async () => {
    const project = await registerProject.run({
      root: repos.create(),
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
      maxTicketsInFlight: 5,
    });

    expect(project.maxTicketsInFlight).toBe(5);
    expect((await getProject.run({ id: project.id })).maxTicketsInFlight).toBe(5);
  });

  it("passes preflightStep through to the project", async () => {
    const project = await aProject();
    expect(project.preflightStep).toBe(true);

    const updated = await updateProject.run({ id: project.id, preflightStep: false });

    expect(updated.preflightStep).toBe(false);
    expect(await getProject.run({ id: project.id })).toMatchObject({ preflightStep: false });
  });

  it("update-project refuses tickets in flight of 11 with status 400 and its code", async () => {
    const project = await aProject();

    await expect(updateProject.run({ id: project.id, maxTicketsInFlight: 11 })).rejects.toMatchObject({
      errorCode: "invalid-max-tickets-in-flight",
      statusCode: 400,
      message: "Tickets in flight must be a whole number from 1 to 10: 11",
    });
    expect((await getProject.run({ id: project.id })).maxTicketsInFlight).toBe(3);
  });

  it("refuses tickets in flight that is not a number before the registry sees it", async () => {
    const project = await aProject();

    // The framework turns a numeric string such as "3" into 3 before the
    // schema checks it, as it does for every field; text that is no number
    // is refused by the schema. The action route answers 400 for exactly
    // this message prefix ("Invalid action parameters"), and the refusal
    // carries no registry code.
    const refused = await Promise.resolve()
      .then(() =>
        updateProject.run({ id: project.id, maxTicketsInFlight: "three" as unknown as number }),
      )
      .then(
        () => null,
        (error: unknown) => error as Error & { errorCode?: string; statusCode?: number },
      );
    expect(refused).toBeInstanceOf(Error);
    expect(refused!.message).toMatch(
      /^Invalid action parameters — maxTicketsInFlight: Invalid input: expected number, received string\./,
    );
    expect(refused!.errorCode).toBeUndefined();
    expect(refused!.statusCode).toBeUndefined();
    expect(await getProject.run({ id: project.id })).toEqual(project);
  });

  it("changes tickets in flight, and get-project reports it", async () => {
    const project = await aProject();

    const updated = await updateProject.run({ id: project.id, maxTicketsInFlight: 2 });

    expect(updated.maxTicketsInFlight).toBe(2);
    expect((await getProject.run({ id: project.id })).maxTicketsInFlight).toBe(2);
  });
});
