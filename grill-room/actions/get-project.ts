import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getProject } from "../server/projects.js";

export default defineAction({
  description: "Read one registered project by id.",
  schema: z.object({
    id: z.string().min(1).describe("Project id"),
  }),
  http: { method: "GET" },
  run: async ({ id }) => {
    const project = await getProject(id);
    if (!project) {
      fail(`Project not found: ${id}`, {
        errorCode: "project-not-found",
        statusCode: 404,
      });
    }
    return project;
  },
});
