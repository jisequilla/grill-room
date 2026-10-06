import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getProject, hasGitRemote, measuredVisibility } from "../server/projects.js";

export default defineAction({
  description: "Read one registered project by id, with `hasRemote`: whether its repository lists any git remote (null when git cannot tell), and `folderVisibility`: whether git ignores each export folder now (`durable` and `working`, each `ignored`, `tracked` or null when git cannot tell), measured on every read and never stored.",
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
    return {
      ...project,
      hasRemote: await hasGitRemote(project.rootPath),
      folderVisibility: {
        durable: await measuredVisibility(project.rootPath, project.durableExportFolder),
        working: await measuredVisibility(project.rootPath, project.workingExportFolder),
      },
    };
  },
});
