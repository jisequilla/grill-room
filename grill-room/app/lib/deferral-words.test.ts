import { describe, expect, it } from "vitest";

import { readsAsDeferral } from "@/lib/deferral-words";

describe("readsAsDeferral", () => {
  it("matches 'wait until'", () => {
    expect(readsAsDeferral("Wait until dispute handling is settled")).toBe(
      true,
    );
  });

  it("matches 'wait until' after leading text", () => {
    expect(
      readsAsDeferral("48-72h, wait until dispute handling is settled"),
    ).toBe(true);
  });

  it("matches 'wait for'", () => {
    expect(readsAsDeferral("Wait for the vetting depth decision")).toBe(true);
  });

  it("matches 'tbd' alone", () => {
    expect(readsAsDeferral("TBD")).toBe(true);
  });

  it("matches 'tbd' with trailing text", () => {
    expect(readsAsDeferral("tbd, ask finance")).toBe(true);
  });

  it("matches 'to be decided'", () => {
    expect(readsAsDeferral("To be decided with legal")).toBe(true);
  });

  it("matches 'later' alone in 'decide later'", () => {
    expect(readsAsDeferral("Decide later")).toBe(true);
  });

  it("matches 'later' elsewhere in the sentence", () => {
    expect(readsAsDeferral("Later, once we have traffic")).toBe(true);
  });

  it("matches 'not yet'", () => {
    expect(readsAsDeferral("Not yet")).toBe(true);
  });

  it("matches 'depends on'", () => {
    expect(readsAsDeferral("Depends on the payment provider")).toBe(true);
  });

  it("matches 'once' followed by 'settled' in the same sentence", () => {
    expect(readsAsDeferral("Once dispute handling is settled")).toBe(true);
  });

  it("matches 'once' followed by 'decided' in the same sentence", () => {
    expect(readsAsDeferral("once pricing is decided")).toBe(true);
  });

  it("matches 'once' followed by 'known' in the same sentence", () => {
    expect(readsAsDeferral("once the volume is known")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(readsAsDeferral("Postgres, with a read replica")).toBe(false);
  });

  it("does not match 'later' inside a word", () => {
    expect(readsAsDeferral("Collateral is held for 48 h")).toBe(false);
  });

  it("does not match 'dependency' as 'depends on'", () => {
    expect(
      readsAsDeferral("Use Stripe; the dependency on webhooks is fine"),
    ).toBe(false);
  });

  it("does not match 'once' with no settled/decided/known after it", () => {
    expect(readsAsDeferral("Once a day, at midnight UTC")).toBe(false);
  });

  it("does not match 'decided' without 'once'", () => {
    expect(readsAsDeferral("We decided to use Postgres")).toBe(false);
  });

  it("does not match 'postponed', which is not on the list", () => {
    expect(readsAsDeferral("Postponed until legal signs off")).toBe(false);
  });

  it("does not match 'once' and 'decided' across a sentence boundary", () => {
    expect(
      readsAsDeferral("Once shipped. Pricing is decided elsewhere."),
    ).toBe(false);
  });

  it("matches 'once' and 'decided' in the same sentence across a comma", () => {
    expect(
      readsAsDeferral("Once shipped, pricing is decided by finance"),
    ).toBe(true);
  });

  it("does not match 'not' and 'yet' when they are not contiguous", () => {
    expect(readsAsDeferral("Yet another option, not the first")).toBe(false);
  });

  it("does not match an empty string", () => {
    expect(readsAsDeferral("")).toBe(false);
  });

  it("does not match a whitespace-only string", () => {
    expect(readsAsDeferral("   \n\t  ")).toBe(false);
  });
});
