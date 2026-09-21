import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { SESSION_MODELS } from "../server/db/schema.js";
import setSetting from "./set-setting.js";

const DEFAULT_MODEL_SETTING_KEY = "defaultModel";

export default defineAction({
  description:
    "Set the global default interviewer model. New sessions pre-fill their model picker with this value.",
  schema: z.object({
    model: z.enum(SESSION_MODELS).describe("Model new sessions default to"),
  }),
  run: async ({ model }) => {
    await setSetting.run({ key: DEFAULT_MODEL_SETTING_KEY, value: model });
    return { model };
  },
});
