// Builds the Grill Room video into a root element and returns a paused GSAP timeline.
// One source for both cuts: the layout ("landscape" or "portrait") only changes CSS.
// Timing is on a 100 BPM grid (beat 0.6 s); every scene change lands on a beat.
(function () {
  const BEAT = 0.6;
  const CUT = {
    hook: 0,
    idea: 3.6,
    round: 9.6,
    tree: 16.8,
    spec: 21.6,
    tickets: 27.6,
    end: 32.4,
    finish: 36,
  };
  const EASE = "expo.out";
  const EASE_IN = "power2.in";

  const MARK = (cls) =>
    `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true">
      <rect class="m-frame" x="1" y="1" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2" pathLength="1"/>
      <rect class="m-bar m-bar-1" x="1" y="5.5" width="18" height="2" fill="var(--primary)"/>
      <rect class="m-bar m-bar-2" x="1" y="9" width="18" height="2" fill="currentColor"/>
      <rect class="m-bar m-bar-3" x="1" y="12.5" width="18" height="2" fill="currentColor"/>
    </svg>`;
  const CHECK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;
  const PENCIL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>`;
  const FLAG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 14V2.5M3.5 3h8l-1.6 3 1.6 3h-8"/></svg>`;
  const FILE = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 1.8h5l3 3v9.4H4z M9 1.8v3h3"/></svg>`;

  const stamp = (kind, text) => `<span class="stamp ${kind}"><i class="glyph"></i>${text}</span>`;
  const chars = (text) =>
    Array.from(text)
      .map((c) => `<span class="ch">${c === " " ? "&nbsp;" : c}</span>`)
      .join("");

  const caption = (step, lines) =>
    `<div class="caption">
      <div class="step">${step}</div>
      <h2>${lines.map((l) => `<span class="line">${l}</span>`).join("")}</h2>
    </div>`;

  const IDEA = "A booking app for a small climbing gym.";

  const ROUND = [
    {
      q: "How do members book a session?",
      kind: "ACCEPTED THE RECOMMENDATION",
      icon: CHECK,
      answer: "Fixed 1-hour slots",
    },
    {
      q: "Who sets a slot's capacity?",
      kind: "OWN ANSWER",
      icon: PENCIL,
      answer: "Staff, per slot, from the front desk",
    },
    {
      q: "What happens when a slot is full?",
      kind: "ACCEPTED THE RECOMMENDATION",
      icon: CHECK,
      answer: "A waitlist; the first in line gets the spot",
    },
  ];

  const TREE = [
    { name: "How members book a session", depth: 0, from: "round" },
    { name: "Who sets a slot's capacity", depth: 1, from: "round" },
    { name: "What happens when a slot is full", depth: 1, from: "round" },
    { name: "How long a waitlist offer holds", depth: 2, from: "new" },
    { name: "Cancellation window", depth: 1, from: "new" },
    { name: "How members pay", depth: 0, from: "new" },
    { name: "Card on file or pay at the desk", depth: 1, from: "new" },
  ];

  const WAVES = [
    { label: "Wave 1 · no blockers", tickets: [["01", "Slots and bookings schema", null]] },
    {
      label: "Wave 2",
      tickets: [
        ["02", "Staff capacity page", "01"],
        ["03", "Member booking flow", "01"],
      ],
    },
    {
      label: "Wave 3",
      tickets: [
        ["04", "Waitlist for full slots", "03"],
        ["05", "Cancellation window", "03"],
      ],
    },
  ];

  const BRIEFS = [
    "briefs/01-slots-and-bookings-schema.md",
    "briefs/02-staff-capacity-page.md",
    "briefs/03-member-booking-flow.md",
    "briefs/04-waitlist-for-full-slots.md",
    "briefs/05-cancellation-window.md",
  ];

  // Deterministic scatter for the guesses.
  function scatter(layout) {
    let s = 20260928;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    const w = layout === "portrait" ? 1080 : 1920;
    const h = layout === "portrait" ? 1920 : 1080;
    const count = layout === "portrait" ? 40 : 48;
    const cols = layout === "portrait" ? 5 : 10;
    const rows = Math.ceil(count / cols);
    const marks = [];
    // Keep the hook line clear: no guess may sit behind it.
    const clear = layout === "portrait" ? { x0: 0, x1: w, y0: 620, y1: 1300 } : { x0: 180, x1: 1740, y0: 330, y1: 760 };
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = ((col + 0.15 + rnd() * 0.7) / cols) * w;
      const y = ((row + 0.15 + rnd() * 0.7) / rows) * h;
      const size = 44 + Math.round(rnd() * rnd() * 150);
      const mark = { x, y, size, owed: rnd() < 0.22, rot: Math.round((rnd() - 0.5) * 24), delay: rnd() };
      const cx = x + size * 0.3;
      const cy = y + size * 0.5;
      if (cx > clear.x0 - size * 0.3 && cx < clear.x1 + size * 0.3 && cy > clear.y0 - size * 0.5 && cy < clear.y1 + size * 0.5) continue;
      marks.push(mark);
    }
    return marks;
  }

  function markup(layout) {
    const guesses = scatter(layout)
      .map(
        (m) =>
          `<span class="q${m.owed ? " owed" : ""}" data-delay="${m.delay.toFixed(3)}" style="left:${m.x.toFixed(0)}px;top:${m.y.toFixed(0)}px;font-size:${m.size}px;--rot:${m.rot}deg">?</span>`,
      )
      .join("");

    const roundCards = ROUND.map(
      (c, i) => `
      <div class="card round-card frontier-card" id="rc${i}">
        <div class="q-row">
          <span class="idx">0${i + 1}</span>
          <span class="q-title">${c.q}</span>
          <span class="stamp-swap">${stamp("frontier", "Frontier")}${stamp("settled", "Settled")}</span>
        </div>
        ${
          i === 0
            ? `<div class="choices"><div class="choices-inner">
              <div class="choice rec"><span class="check">${CHECK}</span><span>Fixed 1-hour slots</span><span class="stamp rec">Recommended</span></div>
              <div class="band"><p>Slots let staff cap each hour.</p><span class="btn primary accept">Accept</span></div>
              <div class="choice">Open check-in, no booking</div>
              <div class="choice">Book a whole day</div>
            </div></div>`
            : ""
        }
        <div class="answer"><div class="answer-band">
          <div class="label">${c.icon}${c.kind}</div>
          <div class="text">${c.answer}</div>
        </div></div>
      </div>`,
    ).join("");

    const treeRows = TREE.map((r, i) => {
      const indent = Array.from({ length: r.depth }, (_, d) => `<i class="${d === r.depth - 1 ? "elbow" : ""}"></i>`).join("");
      return `<div class="tree-row" id="tr${i}">
        <span class="indent">${indent}</span>
        <span class="name">${r.name}</span>
        <span class="stamp-swap">${stamp("frontier", "Frontier")}${stamp("settled", "Settled")}</span>
      </div>`;
    }).join("");

    const settledCounts = TREE.map((_, i) => `<span class="sc" id="sc${i + 1}">${i + 1} of ${TREE.length} settled</span>`).join("");

    const waves = WAVES.map(
      (w, wi) => `<div class="wave" id="wave${wi}">
        <div class="label">${w.label}</div>
        <div class="wave-tickets">
          ${w.tickets
            .map(
              ([n, t, b]) => `<div class="card ticket">
                <div class="num">${n}</div>
                <div class="t">${t}</div>
                <span class="chip">${b ? `blocked by ${b}` : "ready"}</span>
              </div>`,
            )
            .join("")}
        </div>
      </div>`,
    ).join("");

    const briefs = BRIEFS.map((p) => `<div class="brief">${FILE}<span class="path">${p}</span></div>`).join("");

    return `
    <section class="scene hook" id="s-hook">
      ${guesses}
      <h1 id="hook-title">Every plan is full of guesses.</h1>
    </section>

    <section class="scene split" id="s-idea">
      ${caption("01 · Idea", ["Start with a", "loose idea."])}
      <div class="stage-wrap"><div class="stage">
        <div class="card session-card">
          <div class="hairline" id="idea-hairline"></div>
          <div class="session-head">${MARK("mark-sm")}<span class="title">New session</span></div>
          <div class="label field-label">Idea</div>
          <div class="field" id="idea-field">${chars(IDEA)}<span class="caret" id="idea-caret"></span></div>
          <div class="session-row">
            <div class="segmented"><span class="on">Whole round</span><span>One at a time</span></div>
            <span class="btn primary" id="start-btn">Start the interview</span>
          </div>
          <div class="working meta" id="idea-working"><span>The interviewer is writing round 1</span><span>0:01</span></div>
        </div>
      </div></div>
    </section>

    <section class="scene split" id="s-round">
      ${caption("02 · Round", ["Grill Room asks.", "You decide."])}
      <div class="stage-wrap"><div class="stage">
        <div class="round-head"><span class="label">This round</span><span class="label">Round 1</span></div>
        ${roundCards}
        <div class="submit-bar">
          <div class="segs"><span class="seg"><i></i></span><span class="seg"><i></i></span><span class="seg"><i></i></span></div>
          <span class="count" id="round-count">
            <span>0 of 3 answered</span><span>1 of 3 answered</span><span>2 of 3 answered</span><span>3 of 3 answered</span>
          </span>
          <span class="btn primary submit" id="submit-btn">Submit round</span>
        </div>
      </div></div>
    </section>

    <section class="scene split" id="s-tree">
      ${caption("03 · Design tree", ["Every answer", "settles a", "decision."])}
      <div class="stage-wrap"><div class="stage">
        <div class="label tree-head">Design tree</div>
        <div class="card tree">
          ${treeRows}
          <div class="tree-foot">
            <span class="count" id="tree-count"><span class="sc" id="sc0">0 of ${TREE.length} settled</span>${settledCounts}</span>
            <span>0 loose ends</span>
          </div>
        </div>
      </div></div>
    </section>

    <section class="scene split" id="s-spec">
      ${caption("04 · Spec", ["Nothing left open.", "Now a spec."])}
      <div class="stage-wrap"><div class="stage">
        <div class="spec-wrap">
          <div class="card done-card" id="done-card">
            <div class="lede label">
              <div id="lede-done">${FLAG}The interviewer proposes you are done</div>
              <div id="lede-ok" class="ok">${CHECK}Shared understanding confirmed</div>
            </div>
            <div class="summary">Members book capped 1-hour slots; a full slot takes a waitlist.</div>
            <div class="tally"><b>7 settled</b> · 0 loose ends · 1 set aside</div>
            <div class="confirm-bar">
              <span>Everything is answered or set aside.</span>
              <span class="btn-swap">
                <span class="btn primary" id="confirm-btn">Confirm shared understanding</span>
                <span class="btn primary" id="open-btn">Open the output</span>
              </span>
            </div>
          </div>
          <div class="card spec-page doc" id="spec-page">
            <div class="status-line"><span class="dot"></span>SPEC · current · written from 7 decisions</div>
            <h1 class="sl">Climbing gym booking</h1>
            <h3 class="sl">Problem Statement</h3>
            <p class="sl">Members arrive to a full wall, and staff have no way to cap a session.</p>
            <h3 class="sl">Solution</h3>
            <p class="sl">Members book 1-hour slots that staff cap. A full slot takes a waitlist.</p>
            <h3 class="sl">User Stories</h3>
            <ol>
              <li class="sl"><span class="n">1.</span>As a member, I book a 1-hour slot.</li>
              <li class="sl"><span class="n">2.</span>As staff, I set each slot's capacity.</li>
              <li class="sl"><span class="n">3.</span>As a member, I join the waitlist for a full slot.</li>
            </ol>
          </div>
        </div>
      </div></div>
    </section>

    <section class="scene split" id="s-tickets">
      ${caption("05 · Handoff", ["Tickets in waves.", "Briefs for agents."])}
      <div class="stage-wrap"><div class="stage">
        <div class="tickets-wrap">
          <div class="waves" id="waves">${waves}</div>
          <div class="card handoff doc" id="handoff">
            <div class="file">${FILE}HANDOFF.md</div>
            <h1 class="hl">Climbing gym booking</h1>
            <h3 class="hl">Execution plan</h3>
            <div class="plan hl"><span>Longest chain</span> 01 → 03 → 04</div>
            <div class="plan hl"><span>Wave widths</span> 1 · 2 · 2</div>
            <div class="plan hl"><span>In flight</span> at most 3 at a time</div>
            <h3 class="hl">Briefs</h3>
            <div class="briefs">${briefs}</div>
          </div>
        </div>
      </div></div>
    </section>

    <section class="scene end" id="s-end">
      <div class="lockup">
        ${MARK("mark-lg")}
        <div class="wordmark">${chars("grill room")}</div>
      </div>
      <p class="tagline">Remove the guesses before you build.</p>
    </section>`;
  }

  function sceneIn(tl, id, at) {
    tl.fromTo(id, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: "power1.out" }, at);
    tl.fromTo(`${id} .caption .step`, { autoAlpha: 0, x: -16 }, { autoAlpha: 1, x: 0, duration: 0.6, ease: EASE }, at + 0.05);
    tl.fromTo(`${id} .caption .line`, { autoAlpha: 0, y: 36 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE, stagger: 0.12 }, at + 0.1);
    tl.fromTo(`${id} .stage`, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE }, at + 0.15);
  }

  function sceneOut(tl, id, cut) {
    tl.to(`${id} .caption`, { autoAlpha: 0, y: -20, duration: 0.3, ease: EASE_IN }, cut - 0.3);
    tl.to(`${id} .stage`, { autoAlpha: 0, y: -24, duration: 0.3, ease: EASE_IN }, cut - 0.3);
    tl.set(id, { autoAlpha: 0 }, cut);
  }

  function press(tl, target, at) {
    tl.to(target, { scale: 0.94, duration: 0.09, ease: "power2.out" }, at);
    tl.to(target, { scale: 1, duration: 0.3, ease: "back.out(3)" }, at + 0.09);
  }

  function settle(tl, root, at) {
    tl.to(root.querySelector(".stamp.frontier"), { autoAlpha: 0, duration: 0.2 }, at);
    tl.fromTo(root.querySelector(".stamp.settled"), { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: "back.out(2.5)" }, at + 0.05);
  }

  function build(root, layout) {
    root.innerHTML = markup(layout);
    const q = (s) => root.querySelector(s);
    const qa = (s) => Array.from(root.querySelectorAll(s));
    const tl = gsap.timeline({ paused: true });
    tl.set({}, {}, CUT.finish);

    // 1. Hook: guesses scatter in on the beat, the line lands, everything clears on the cut.
    tl.set("#s-hook", { autoAlpha: 1 }, 0);
    const marks = qa(".hook .q");
    marks.forEach((m, i) => {
      const at = 0.05 + (i % 6) * BEAT * 0.5 + Number(m.dataset.delay) * 0.25;
      tl.fromTo(
        m,
        { autoAlpha: 0, scale: 0.4, rotation: 0 },
        { autoAlpha: m.classList.contains("owed") ? 0.9 : 0.42, scale: 1, rotation: parseFloat(m.style.getPropertyValue("--rot")), duration: 0.5, ease: "back.out(2)" },
        at,
      );
      tl.to(m, { y: -18 - Number(m.dataset.delay) * 30, duration: 3, ease: "none" }, at);
      tl.to(m, { autoAlpha: 0, scale: 0.6, duration: 0.35, ease: EASE_IN }, CUT.idea - 0.4 + Number(m.dataset.delay) * 0.05);
    });
    tl.fromTo("#hook-title", { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: EASE }, 0.6);
    tl.to("#hook-title", { autoAlpha: 0, y: -30, duration: 0.3, ease: EASE_IN }, CUT.idea - 0.3);
    tl.set("#s-hook", { autoAlpha: 0 }, CUT.idea);

    // 2. A loose idea types itself into a new session.
    sceneIn(tl, "#s-idea", CUT.idea);
    const typed = qa("#idea-field .ch");
    const typeStart = CUT.idea + 0.9;
    const perChar = 2.7 / typed.length;
    typed.forEach((c, i) => tl.set(c, { display: "inline" }, typeStart + i * perChar));
    const typeEnd = typeStart + typed.length * perChar;
    [0, 1, 2, 3].forEach((k) => {
      tl.set("#idea-caret", { autoAlpha: 0 }, typeEnd + 0.3 + k * 0.6);
      tl.set("#idea-caret", { autoAlpha: 1 }, typeEnd + 0.6 + k * 0.6);
    });
    tl.set("#idea-working", { autoAlpha: 0 }, CUT.idea);
    const startAt = CUT.idea + 4.2;
    press(tl, "#start-btn", startAt);
    tl.set("#idea-caret", { autoAlpha: 0 }, startAt);
    tl.fromTo("#idea-hairline", { scaleX: 0 }, { scaleX: 1, duration: CUT.round - startAt - 0.3, ease: "power1.inOut" }, startAt + 0.2);
    tl.fromTo("#idea-working", { autoAlpha: 0, y: -6 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: EASE }, startAt + 0.25);
    sceneOut(tl, "#s-idea", CUT.round);

    // 3. A round: three questions, a recommendation accepted, every card settles.
    sceneIn(tl, "#s-round", CUT.round);
    qa(".round-card .stamp.settled").forEach((s) => tl.set(s, { autoAlpha: 0 }, CUT.round));
    const counts = qa("#round-count > span");
    counts.forEach((c, i) => tl.set(c, { autoAlpha: i === 0 ? 1 : 0 }, CUT.round));
    tl.fromTo(".round-card", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: EASE, stagger: 0.1 }, CUT.round + 0.2);
    const pick = CUT.round + 1.8;
    press(tl, "#rc0 .accept", pick);
    tl.to("#rc0 .choice.rec", { borderColor: "#ece7e1", backgroundColor: "#2e2924", duration: 0.2 }, pick + 0.1);
    tl.set("#rc0 .choice.rec .check", { display: "block" }, pick + 0.1);
    const answer = (i, at) => {
      const card = q(`#rc${i}`);
      if (i === 0) tl.to("#rc0 .choices", { height: 0, duration: 0.5, ease: "power3.inOut" }, at);
      const band = card.querySelector(".answer");
      tl.to(band, { height: "auto", duration: 0.5, ease: "power3.inOut" }, at + (i === 0 ? 0.15 : 0));
      tl.fromTo(band.firstElementChild, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 }, at + 0.25);
      tl.to(card, { borderColor: "#35302a", duration: 0.3 }, at);
      tl.to(card.querySelector(".idx"), { boxShadow: "0 0 0 0px #f26b38", color: "#a39a91", duration: 0.3 }, at);
      settle(tl, card, at + 0.1);
      tl.to(qa(".seg i")[i], { scaleX: 1, duration: 0.4, ease: EASE }, at + 0.1);
      tl.set(counts[i], { autoAlpha: 0 }, at + 0.1);
      tl.set(counts[i + 1], { autoAlpha: 1 }, at + 0.1);
    };
    answer(0, CUT.round + 2.4);
    answer(1, CUT.round + 3.6);
    answer(2, CUT.round + 4.8);
    tl.to("#submit-btn", { opacity: 1, duration: 0.25 }, CUT.round + 5.1);
    press(tl, "#submit-btn", CUT.round + 6.0);
    sceneOut(tl, "#s-round", CUT.tree);

    // 4. The design tree grows; each new node arrives on the frontier and settles on the next beat.
    sceneIn(tl, "#s-tree", CUT.tree);
    const rows = qa(".tree-row");
    const sc = qa("#tree-count .sc");
    sc.forEach((c, i) => tl.set(c, { autoAlpha: i === 0 ? 1 : 0 }, CUT.tree));
    rows.forEach((r) => tl.set(r, { autoAlpha: 0 }, CUT.tree));
    let settledSoFar = 0;
    const bump = (at) => {
      tl.set(sc[settledSoFar], { autoAlpha: 0 }, at);
      settledSoFar += 1;
      tl.set(sc[settledSoFar], { autoAlpha: 1 }, at);
    };
    rows.forEach((r, i) => {
      const fromRound = TREE[i].from === "round";
      const at = fromRound ? CUT.tree + 0.35 + i * 0.15 : CUT.tree + 1.2 + (i - 3) * BEAT;
      tl.fromTo(r, { autoAlpha: 0, x: -14 }, { autoAlpha: 1, x: 0, duration: 0.45, ease: EASE }, at);
      if (fromRound) {
        tl.set(r.querySelector(".stamp.frontier"), { autoAlpha: 0 }, CUT.tree);
        tl.set(r.querySelector(".stamp.settled"), { autoAlpha: 1 }, CUT.tree);
        bump(at);
      } else {
        tl.set(r.querySelector(".stamp.settled"), { autoAlpha: 0 }, CUT.tree);
        tl.set(r.querySelector(".stamp.frontier"), { autoAlpha: 1 }, CUT.tree);
        settle(tl, r, at + BEAT);
        bump(at + BEAT + 0.05);
      }
    });
    sceneOut(tl, "#s-tree", CUT.spec);

    // 5. The done panel is confirmed and resolves into a spec page.
    sceneIn(tl, "#s-spec", CUT.spec);
    tl.set(["#lede-ok", "#open-btn"], { autoAlpha: 0 }, CUT.spec);
    tl.set("#spec-page", { autoAlpha: 0 }, CUT.spec);
    const confirmAt = CUT.spec + 1.8;
    press(tl, "#confirm-btn", confirmAt);
    tl.to(["#lede-done", "#confirm-btn"], { autoAlpha: 0, duration: 0.2 }, confirmAt + 0.25);
    tl.fromTo(["#lede-ok", "#open-btn"], { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: EASE }, confirmAt + 0.3);
    const specAt = CUT.spec + 3.0;
    press(tl, "#open-btn", specAt - 0.3);
    tl.to("#done-card", { autoAlpha: 0, y: -30, scale: 0.97, duration: 0.45, ease: "power3.in" }, specAt);
    tl.fromTo("#spec-page", { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: EASE }, specAt + 0.2);
    tl.fromTo("#spec-page .sl", { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: EASE, stagger: 0.14 }, specAt + 0.45);
    sceneOut(tl, "#s-spec", CUT.tickets);

    // 6. Tickets fan out into parallel waves, then the handoff lists one brief per ticket.
    sceneIn(tl, "#s-tickets", CUT.tickets);
    tl.set("#handoff", { autoAlpha: 0 }, CUT.tickets);
    qa(".wave").forEach((w, wi) => {
      const at = CUT.tickets + 0.3 + wi * BEAT;
      tl.fromTo(w.querySelector(".label"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, at);
      tl.fromTo(
        w.querySelectorAll(".ticket"),
        { autoAlpha: 0, y: -26, scale: 0.92 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.55, ease: "back.out(1.6)", stagger: 0.1 },
        at,
      );
    });
    const handoffAt = CUT.tickets + 2.4;
    tl.to("#waves", { autoAlpha: 0, y: -24, duration: 0.4, ease: "power3.in" }, handoffAt);
    tl.fromTo("#handoff", { autoAlpha: 0, y: 50 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: EASE }, handoffAt + 0.2);
    tl.fromTo("#handoff .hl", { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: EASE, stagger: 0.08 }, handoffAt + 0.35);
    tl.fromTo("#handoff .brief", { autoAlpha: 0, x: -12 }, { autoAlpha: 1, x: 0, duration: 0.4, ease: EASE, stagger: 0.2 }, handoffAt + 0.7);
    sceneOut(tl, "#s-tickets", CUT.end);

    // 7. End card: the Grate assembles, its hot bar lands on the lift, then the wordmark and the line.
    tl.set("#s-end", { autoAlpha: 1 }, CUT.end);
    tl.fromTo("#s-end .m-frame", { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, CUT.end);
    tl.set("#s-end .m-frame", { strokeDasharray: "none" }, CUT.end + 0.62);
    ["#s-end .m-bar-3", "#s-end .m-bar-2", "#s-end .m-bar-1"].forEach((b, i) => {
      tl.fromTo(b, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.45, ease: EASE }, CUT.end + 0.3 + i * (BEAT / 2));
    });
    tl.fromTo("#s-end .wordmark .ch", { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: EASE, stagger: 0.04 }, CUT.end + 0.6);
    tl.fromTo("#s-end .tagline", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE }, CUT.end + 1.5);

    return tl;
  }

  window.buildGrillRoomVideo = (layout) => build(document.getElementById("frame"), layout);
})();
