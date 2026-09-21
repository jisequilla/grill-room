import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { SESSION_MODELS } from "../server/db/schema.js";
import getSetting from "./get-setting.js";

const DEFAULT_MODEL_SETTING_KEY = "defaultModel";
const FALLBACK_MODEL = "fable";

export default defineAction({
  description:
    "Read the global default interviewer model new sessions are pre-filled with. Falls back to fable when never set.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const { value } = await getSetting.run({ key: DEFAULT_MODEL_SETTING_KEY });
    const model = (SESSION_MODELS as readonly string[]).includes(value ?? "")
      ? (value as (typeof SESSION_MODELS)[number])
      : FALLBACK_MODEL;

    return { model };
  },
});
