import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listProjects } from "../server/projects.js";

export default defineAction({
  description: "List every registered project, by name.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listProjects(),
});
