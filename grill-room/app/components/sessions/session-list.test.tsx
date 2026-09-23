import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { SessionList } from "@/components/sessions/session-list";
import type { ReadinessVerdict } from "@/components/sessions/readiness-badge";

function session(id: string, readinessVerdict: ReadinessVerdict | null) {
  return {
    id,
    title: `Session ${id}`,
    state: "interviewing" as const,
    updatedAt: "2026-09-24T10:00:00.000Z",
    readinessVerdict,
  };
}

/** Each list row's markup, keyed by the session it links to. */
function rows(html: string): Map<string, string> {
  const byId = new Map<string, string>();
  for (const row of html.split("<li").slice(1)) {
    const id = /href="\/sessions\/([^"]+)"/.exec(row)?.[1];
    if (id) byId.set(id, row);
  }
  return byId;
}

describe("SessionList", () => {
  it("shows a readiness badge only for sessions whose idea was judged", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SessionList
            sessions={[
              session("ready-one", "ready"),
              session("not-ready-one", "not-ready"),
              session("unjudged", null),
            ]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const byId = rows(html);
    expect(byId.get("ready-one")).toContain('data-testid="session-readiness-badge"');
    expect(byId.get("ready-one")).toContain('data-verdict="ready"');
    expect(byId.get("not-ready-one")).toContain('data-verdict="not-ready"');
    expect(byId.get("unjudged")).toBeDefined();
    expect(byId.get("unjudged")).not.toContain("session-readiness-badge");
  });
});
