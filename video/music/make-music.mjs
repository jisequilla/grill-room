// Synthesises the video's 36-second music bed: 100 BPM pulse, warm pad, a lift into the end card.
// Writes music/bed-raw.wav, then normalises it with ffmpeg (two-pass loudnorm) to music/bed.wav at -16 LUFS.
// Stereo at 32 kHz: the mix is low-passed at 7 kHz, and the file stays under 5 MB.
import { writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RATE = 32000;
const DURATION = 36;
const BPM = 100;
const BEAT = 60 / BPM; // 0.6 s
const BAR = BEAT * 4; // 2.4 s
const LIFT = 32.4; // the end card lands here
const N = Math.round(RATE * DURATION);
const left = new Float32Array(N);
const right = new Float32Array(N);

let seed = 0x9e3779b9;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 0xffffffff) * 2 - 1;
};

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
// Equal-power pan: -1 is hard left, 0 centre, 1 hard right.
const add = (i, v, pan = 0) => {
  if (i < 0 || i >= N) return;
  const a = ((pan + 1) * Math.PI) / 4;
  left[i] += v * Math.cos(a) * Math.SQRT2;
  right[i] += v * Math.sin(a) * Math.SQRT2;
};

// Pad: additive, softly rolled-off harmonics, two detuned voices per note, overlapping chord envelopes.
function pad(notes, start, end, gain) {
  const attack = 0.5;
  const release = 0.9;
  const s0 = Math.floor(start * RATE);
  const s1 = Math.min(N, Math.floor((end + release) * RATE));
  for (const note of notes) {
    const f = hz(note);
    for (const [detune, pan] of [[-0.0025, -0.6], [0.0025, 0.6]]) {
      const fd = f * (1 + detune);
      const phase0 = Math.abs(rand()) * Math.PI * 2;
      for (let i = s0; i < s1; i++) {
        const t = (i - s0) / RATE;
        const abs = i / RATE;
        let env = Math.min(1, t / attack);
        if (abs > end) env *= Math.max(0, 1 - (abs - end) / release);
        if (env <= 0) continue;
        let v = 0;
        for (let h = 1; h <= 6; h++) v += Math.sin(phase0 + 2 * Math.PI * fd * h * t) / h ** 1.8;
        const breathe = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.2 * abs + note);
        add(i, v * env * breathe * gain, pan);
      }
    }
  }
}

function kick(at, gain) {
  const s0 = Math.floor(at * RATE);
  const len = Math.floor(0.45 * RATE);
  let phase = 0;
  for (let k = 0; k < len; k++) {
    const t = k / RATE;
    const f = 42 + 70 * Math.exp(-t * 28);
    phase += (2 * Math.PI * f) / RATE;
    add(s0 + k, Math.sin(phase) * Math.exp(-t * 9) * gain);
  }
}

function tick(at, gain, decay = 70) {
  const s0 = Math.floor(at * RATE);
  const len = Math.floor(0.08 * RATE);
  let prev = 0;
  for (let k = 0; k < len; k++) {
    const n = rand();
    const hp = n - prev; // crude high-pass for a dry, papery tick
    prev = n;
    add(s0 + k, hp * Math.exp(-(k / RATE) * decay) * gain);
  }
}

function bass(note, at, dur, gain) {
  const f = hz(note);
  const s0 = Math.floor(at * RATE);
  const len = Math.floor(dur * RATE);
  for (let k = 0; k < len; k++) {
    const t = k / RATE;
    const env = Math.min(1, t / 0.01) * Math.exp(-t * 3.2) * Math.min(1, (len - k) / (0.05 * RATE));
    const v = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t);
    add(s0 + k, v * env * gain);
  }
}

function bell(note, at, gain, pan) {
  const f = hz(note);
  const s0 = Math.floor(at * RATE);
  const len = Math.floor(2.8 * RATE);
  for (let k = 0; k < len; k++) {
    const t = k / RATE;
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 1.6);
    const v = Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 4);
    add(s0 + k, v * env * gain, pan);
  }
}

// Riser: a noise swell through a sweeping one-pole low-pass plus a gliding sine, ending on the lift.
function riser(start, end, gain) {
  const s0 = Math.floor(start * RATE);
  const s1 = Math.floor(end * RATE);
  let lp = 0;
  let phase = 0;
  for (let i = s0; i < s1; i++) {
    const p = (i - s0) / (s1 - s0);
    const cutoff = 300 + 5000 * p * p;
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
    lp += a * (rand() - lp);
    phase += (2 * Math.PI * (hz(60) * (1 + p))) / RATE;
    add(i, (lp * 0.9 + Math.sin(phase) * 0.25) * p ** 2.2 * gain);
  }
}

function swellHit(at, gain) {
  const s0 = Math.floor(at * RATE);
  const len = Math.floor(2.5 * RATE);
  let lp = 0;
  for (let k = 0; k < len; k++) {
    const t = k / RATE;
    const a = 1 - Math.exp((-2 * Math.PI * (2500 * Math.exp(-t * 2) + 200)) / RATE);
    lp += a * (rand() - lp);
    add(s0 + k, lp * Math.exp(-t * 2.2) * gain);
  }
}

// Harmony: Fmaj7, Am7, Dm9, Bbmaj7 per bar; a Csus4 to C before the lift; Fmaj9 on the end card.
const progression = [
  [53, 57, 60, 64],
  [52, 57, 60, 64, 67],
  [50, 57, 60, 64, 65],
  [50, 53, 57, 58, 62],
];
const roots = [41, 45, 38, 46];
const liftAt = 31.2;
for (let bar = 0; bar * BAR < liftAt; bar++) {
  const start = bar * BAR;
  const end = Math.min(liftAt, start + BAR);
  pad(progression[bar % 4], start, end, bar === 0 ? 0.028 : 0.036);
}
pad([48, 53, 55, 60], liftAt, liftAt + BEAT, 0.05);
pad([48, 52, 55, 60], liftAt + BEAT, LIFT, 0.055);
pad([41, 48, 57, 64, 67, 72], LIFT, DURATION - 0.6, 0.06);

// Hook (0-3.6 s): a dry clock tick on each beat, the guesses.
for (let t = 0; t < 3.6 - 0.01; t += BEAT) tick(t, 0.18, 55);

// Pulse from the idea (3.6 s) up to one beat before the lift.
for (let t = 3.6; t < LIFT - BEAT - 0.01; t += BEAT) {
  kick(t, 0.55);
  const bar = Math.floor(t / BAR);
  const root = t >= liftAt ? 36 : roots[bar % 4];
  const beatInBar = Math.round((t % BAR) / BEAT) % 4;
  if (beatInBar === 0 || beatInBar === 2) bass(root, t, BEAT * 1.8, 0.16);
}
for (let t = 9.6 + BEAT / 2; t < LIFT - BEAT; t += BEAT) tick(t, 0.09);
for (let t = 16.8; t < LIFT - BEAT; t += BEAT) tick(t + BEAT / 4, 0.04, 90);

// The lift into the end card.
riser(29.4, LIFT, 0.35);
kick(LIFT, 0.7);
bass(29, LIFT, 3, 0.2);
swellHit(LIFT, 0.12);
[65, 69, 72, 76].forEach((note, i) => bell(note + 12, LIFT + i * (BEAT / 2), 0.07, i % 2 ? 0.4 : -0.4));

// Gentle fade in, fade out over the last 1.8 s.
const fadeIn = 0.15 * RATE;
const fadeOutStart = (DURATION - 1.8) * RATE;
for (const ch of [left, right]) {
  for (let i = 0; i < N; i++) {
    if (i < fadeIn) ch[i] *= i / fadeIn;
    if (i > fadeOutStart) ch[i] *= Math.max(0, 1 - (i - fadeOutStart) / (N - fadeOutStart)) ** 1.5;
  }
}

// One-pole low-pass for warmth, then peak-normalise to leave headroom for loudnorm.
const warm = 1 - Math.exp((-2 * Math.PI * 7000) / RATE);
let peak = 0;
for (const ch of [left, right]) {
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp += warm * (ch[i] - lp);
    ch[i] = lp;
    peak = Math.max(peak, Math.abs(lp));
  }
}

function writeWav(path) {
  const bytes = N * 4;
  const buf = Buffer.alloc(44 + bytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(bytes, 40);
  const s16 = (x) => Math.round(Math.max(-1, Math.min(1, x * (0.5 / peak))) * 32767);
  for (let i = 0; i < N; i++) {
    buf.writeInt16LE(s16(left[i]), 44 + i * 4);
    buf.writeInt16LE(s16(right[i]), 46 + i * 4);
  }
  writeFileSync(path, buf);
}

const raw = join(here, "bed-raw.wav");
const final = join(here, "bed.wav");
writeWav(raw);

const target = "I=-16:TP=-1.5:LRA=11";
const stats = JSON.parse(
  execFileSync(
    "sh",
    ["-c", `ffmpeg -hide_banner -nostats -i "${raw}" -af loudnorm=${target}:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p'`],
    { encoding: "utf8" },
  ),
);
const second = `loudnorm=${target}:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-af", second, "-ar", String(RATE), "-ac", "2", "-c:a", "pcm_s16le", final]);
unlinkSync(raw);
console.log(`wrote ${final} (${DURATION}s, ${BPM} BPM, measured ${stats.input_i} LUFS before normalising)`);
