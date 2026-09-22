import { describe, expect, it } from "vitest";

import {
  isApplicable,
  parseBatchInput,
  resolveBatchRows,
  type ResolvableDecision,
} from "./reopen-batch-input";

const tree: ResolvableDecision[] = [
  {
    id: "d1",
    key: "dashboard-access",
    questionTitle: "How is the dashboard reached?",
    state: "settled",
  },
  {
    id: "d2",
    key: "host-identity",
    questionTitle: "How is a host identified?",
    state: "settled",
  },
  {
    id: "d3",
    key: "host-storage",
    questionTitle: "How is host data stored?",
    state: "stale",
  },
  {
    id: "d4",
    key: null,
    questionTitle: "What runs on the second machine?",
    state: "blocked",
  },
];

describe("parseBatchInput", () => {
  it("reads a markdown table, skipping its header and rule", () => {
    const result = parseBatchInput(
      [
        "| Decision | New answer |",
        "| --- | --- |",
        "| dashboard-access | Over the tailnet |",
        "| host-identity | The machine's own id |",
      ].join("\n"),
    );

    expect(result).toEqual({
      error: null,
      rows: [
        { decision: "dashboard-access", answer: "Over the tailnet" },
        { decision: "host-identity", answer: "The machine's own id" },
      ],
    });
  });

  it("reads a table with no header row at all", () => {
    expect(
      parseBatchInput("| dashboard-access | Over the tailnet |").rows,
    ).toEqual([{ decision: "dashboard-access", answer: "Over the tailnet" }]);
  });

  it("keeps a first row that is data rather than a header", () => {
    // "How is the dashboard reached?" starts with a word the header test would
    // otherwise recognise, so the second cell has to disagree for it to count.
    expect(
      parseBatchInput(
        "| Question mark handling | Leave them alone |\n| host-identity | Machine id |",
      ).rows,
    ).toHaveLength(2);
  });

  it("ignores extra columns, keeping the first two", () => {
    expect(
      parseBatchInput("| dashboard-access | Over the tailnet | was: locally |")
        .rows,
    ).toEqual([{ decision: "dashboard-access", answer: "Over the tailnet" }]);
  });

  it("reads a JSON array, taking any of the names a row can use", () => {
    expect(
      parseBatchInput(
        JSON.stringify([
          { decisionKey: "dashboard-access", answer: "Over the tailnet" },
          { title: "How is a host identified?", newAnswer: "Machine id" },
        ]),
      ),
    ).toEqual({
      error: null,
      rows: [
        { decision: "dashboard-access", answer: "Over the tailnet" },
        { decision: "How is a host identified?", answer: "Machine id" },
      ],
    });
  });

  it("reports an empty paste, a broken JSON array, and text with no rows in it", () => {
    expect(parseBatchInput("   ").error).toBe("empty");
    expect(parseBatchInput("[{oops}]").error).toBe("bad-json");
    expect(parseBatchInput("just a sentence").error).toBe("no-rows");
  });
});

describe("resolveBatchRows", () => {
  function resolve(decision: string) {
    return resolveBatchRows([{ decision, answer: "an answer" }], tree)[0]!;
  }

  it("matches a key exactly", () => {
    expect(resolve("dashboard-access")).toMatchObject({
      match: "key",
      resolved: { id: "d1" },
    });
  });

  it("matches a full title", () => {
    expect(resolve("How is a host identified?")).toMatchObject({
      match: "title",
      resolved: { id: "d2" },
    });
  });

  it("matches a title prefix, ignoring case, when only one decision starts that way", () => {
    expect(resolve("how is the dashboard")).toMatchObject({
      match: "prefix",
      resolved: { id: "d1" },
    });
  });

  it("refuses to guess when a prefix matches more than one decision", () => {
    expect(resolve("How is")).toEqual({
      decision: "How is",
      answer: "an answer",
      resolved: null,
      match: null,
      ambiguous: [
        "How is the dashboard reached?",
        "How is a host identified?",
        "How is host data stored?",
      ],
    });
  });

  it("leaves a row that matches nothing unresolved, with nothing to choose from", () => {
    expect(resolve("something nobody asked")).toMatchObject({
      resolved: null,
      match: null,
      ambiguous: [],
    });
  });

  it("matches a decision that has no key by its title", () => {
    expect(resolve("What runs on the second machine?")).toMatchObject({
      match: "title",
      resolved: { id: "d4", state: "blocked" },
    });
  });
});

describe("isApplicable", () => {
  it("is false while any row is unresolved or has no answer", () => {
    const unresolved = resolveBatchRows(
      [{ decision: "nope", answer: "an answer" }],
      tree,
    );
    const blank = resolveBatchRows(
      [{ decision: "dashboard-access", answer: "  " }],
      tree,
    );

    expect(isApplicable(unresolved)).toBe(false);
    expect(isApplicable(blank)).toBe(false);
    expect(isApplicable([])).toBe(false);
  });

  it("is true once every row resolves to a decision with an answer", () => {
    const rows = resolveBatchRows(
      [
        { decision: "dashboard-access", answer: "Over the tailnet" },
        { decision: "What runs on the second", answer: "Nothing" },
      ],
      tree,
    );

    expect(isApplicable(rows)).toBe(true);
  });
});
