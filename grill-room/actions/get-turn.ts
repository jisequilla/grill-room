import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getTurnWithRuns } from "../server/turn-records.js";

export default defineAction({
  description:
    "Read one turn record: its kind, model, timing and outcome, with its runs and attempts in order (a run per manual retry, an attempt per model call, each with its kind, one-line reason and raw output, plus its usage from the command line's result — inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, costUsd, cliTurns, cliDurationMs, cliApiDurationMs and sessionId — and toolCalls, its tool calls counted by name; each null when unknown). Feeds the attempt log shown next to whatever the turn produced.",
  schema: z.object({
    turnId: z.string().min(1).describe("Turn id"),
  }),
  http: { method: "GET" },
  run: async ({ turnId }) => {
    const turn = await getTurnWithRuns(turnId);
    if (!turn) fail(`Turn not found: ${turnId}`, { statusCode: 404 });
    return turn;
  },
});
