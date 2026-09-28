import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import {
  SessionList,
  effectiveFilter,
  filterSessions,
  nextFilter,
} from "@/components/sessions/session-list";
import type { ReadinessVerdict } from "@/components/sessions/readiness-badge";

function session(
  id: string,
  readinessVerdict: ReadinessVerdict | null,
  projectId: string | null = null,
) {
  return {
    id,
    title: `Session ${id}`,
    state: "interviewing" as const,
    updatedAt: "2026-09-24T10:00:00.000Z",
    readinessVerdict,
    projectId,
  };
}

const A = session("a", null, "p1");
const B = session("b", null, null);
const C = session("c", null, "p2");

/** A client already holding the project list, since a static render never fetches. */
function clientWithProjects(projects: { id: string; name: string }[] | null) {
  const client = new QueryClient();
  if (projects) client.setQueryData(["action", "list-projects", {}], projects);
  return client;
}

function render(
  sessions: ReturnType<typeof session>[],
  projects: { id: string; name: string }[] | null,
  props: { hideProject?: boolean } = {},
) {
  return renderToStaticMarkup(
    <QueryClientProvider client={clientWithProjects(projects)}>
      <MemoryRouter>
        <SessionList sessions={sessions} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
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

const ids = (list: { id: string }[]) => list.map((item) => item.id);

describe("SessionList", () => {
  it("shows a readiness badge only for sessions whose idea was judged", () => {
    const html = render(
      [
        session("ready-one", "ready"),
        session("not-ready-one", "not-ready"),
        session("unjudged", null),
      ],
      null,
    );

    const byId = rows(html);
    expect(byId.get("ready-one")).toContain('data-testid="session-readiness-badge"');
    expect(byId.get("ready-one")).toContain('data-verdict="ready"');
    expect(byId.get("not-ready-one")).toContain('data-verdict="not-ready"');
    expect(byId.get("unjudged")).toBeDefined();
    expect(byId.get("unjudged")).not.toContain("session-readiness-badge");
  });

  it("shows the project name in the row and renders the filter when a project is loaded", () => {
    const html = render([A], [{ id: "p1", name: "Alpha" }]);

    expect(rows(html).get("a")).toContain("Alpha");
    expect(html).toContain('data-testid="session-project-filter"');
    expect(html).toContain('data-testid="session-project-filter-all"');
    expect(html).toContain('data-testid="session-project-filter-p1"');
    expect(html).toContain('data-testid="session-project-filter-unassigned"');
  });

  it("leaves out the project column and the filter under hideProject", () => {
    const html = render([A], [{ id: "p1", name: "Alpha" }], {
      hideProject: true,
    });

    expect(rows(html).get("a")).toBeDefined();
    expect(html).not.toContain("Alpha");
    expect(html).not.toContain("session-project-filter");
  });

  it("renders no filter before the projects have loaded", () => {
    const html = render([session("a", null, null)], null);

    expect(rows(html).get("a")).toBeDefined();
    expect(html).not.toContain("session-project-filter");
  });

  it("renders no filter when the project list is empty", () => {
    const html = render([session("a", null, null)], []);

    expect(rows(html).get("a")).toBeDefined();
    expect(html).not.toContain("session-project-filter");
  });

  it("renders a session whose project is not loaded with no project cell", () => {
    const html = render([session("a", null, "p-gone")], [
      { id: "p1", name: "Alpha" },
    ]);

    const row = rows(html).get("a");
    expect(row).toBeDefined();
    expect(row).not.toContain("session-project\"");
    expect(row).not.toContain("Alpha");
  });

  it("shows no filter-empty message when there are no sessions at all", () => {
    const html = render([], [{ id: "p1", name: "Alpha" }]);

    expect(html).not.toContain("No sessions match this filter.");
    expect(rows(html).size).toBe(0);
  });
});

describe("filterSessions", () => {
  it("All keeps every session", () => {
    expect(ids(filterSessions([A, B, C], "all"))).toEqual(["a", "b", "c"]);
  });

  it("a project id keeps that project's sessions", () => {
    expect(ids(filterSessions([A, B, C], "p1"))).toEqual(["a"]);
  });

  it("Unassigned keeps the sessions with no project", () => {
    expect(ids(filterSessions([A, B, C], "unassigned"))).toEqual(["b"]);
  });

  it("a project with no sessions leaves nothing", () => {
    expect(filterSessions([A], "p2")).toEqual([]);
  });

  it("a session naming a project that is gone shows under All but not under Unassigned", () => {
    const gone = session("a", null, "p-gone");
    expect(ids(filterSessions([gone], "all"))).toEqual(["a"]);
    expect(filterSessions([gone], "unassigned")).toEqual([]);
  });

  it("no sessions stay none", () => {
    expect(filterSessions([], "all")).toEqual([]);
  });
});

describe("nextFilter", () => {
  it("ignores the empty value Radix emits when the active item is clicked", () => {
    expect(nextFilter("p1", "")).toBe("p1");
  });

  it("takes any other emitted value", () => {
    expect(nextFilter("p1", "unassigned")).toBe("unassigned");
  });
});

describe("effectiveFilter", () => {
  it("falls back to All when the selected project is no longer loaded", () => {
    expect(effectiveFilter("p1", ["p2"])).toBe("all");
    expect(ids(filterSessions([A, B], effectiveFilter("p1", ["p2"])))).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps a loaded project, All and Unassigned", () => {
    expect(effectiveFilter("p1", ["p1", "p2"])).toBe("p1");
    expect(effectiveFilter("all", [])).toBe("all");
    expect(effectiveFilter("unassigned", [])).toBe("unassigned");
  });
});
