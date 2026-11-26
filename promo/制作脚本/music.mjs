// 原创配乐：纯代码合成（无采样），输出 48 kHz 立体声 WAV
// node music.mjs out.wav A B C D E F G   —— 各段小节数：片头/目录/迈氏/群剪/工作台/数据处理/片尾
import fs from 'node:fs';

const [, , OUT, ...secArg] = process.argv;
const SR = 48000, BPM = 92.3077, BEAT = 60 / BPM, BAR = BEAT * 4; // BAR = 2.6 s
const SEC = secArg.length ? secArg.map(Number) : [2, 2, 2, 10, 3, 2, 2];
const names = ['title', 'home', 'mich', 'mont', 'bench', 'ana', 'end'];
const start = {}; let acc = 0;
SEC.forEach((n, i) => { start[names[i]] = acc; acc += n; });
const BARS = acc, TAIL = 4.5;
const N = Math.ceil((BARS * BAR + TAIL) * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const sendL = new Float32Array(N), sendR = new Float32Array(N);
const sec = (bar) => names.reduce((s, k) => (bar >= start[k] ? k : s), 'title');

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// F 大调：Dm9 – B♭maj7 – F/A – Csus2；片尾落在 F
const CH = [
  { root: 38, notes: [62, 65, 69, 72, 76] },   // Dm9
  { root: 34, notes: [62, 65, 69, 70, 74] },   // Bbmaj7
  { root: 33, notes: [60, 65, 69, 72, 77] },   // F/A
  { root: 36, notes: [60, 62, 67, 72, 74] },   // Csus2
];
const FINAL = { root: 29, notes: [60, 65, 69, 72, 76, 81] }; // Fmaj9

function add(buf, i0, arr, g = 1) { for (let i = 0; i < arr.length; i++) { const k = i0 + i; if (k >= 0 && k < N) buf[k] += arr[i] * g; } }
function put(t, mono, gain, pan = 0, send = 0) {
  const i0 = Math.round(t * SR), gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  add(L, i0, mono, gl); add(R, i0, mono, gr);
  if (send) { add(sendL, i0, mono, gl * send); add(sendR, i0, mono, gr * send); }
}
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

// 音色 ---------------------------------------------------------------
function pad(midi, dur) {
  const n = Math.round(dur * SR), out = new Float32Array(n), f = mtof(midi);
  const det = [-0.006, 0, 0.0065]; const ph = det.map(() => Math.random());
  let lp1 = 0, lp2 = 0; const a = 1 - Math.exp(-2 * Math.PI * 900 / SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR; let s = 0;
    for (let d = 0; d < 3; d++) { ph[d] = (ph[d] + f * (1 + det[d]) / SR) % 1; s += 2 * ph[d] - 1; }
    lp1 += a * (s - lp1); lp2 += a * (lp1 - lp2);
    const env = Math.min(1, t / 0.9) * Math.min(1, (dur - t) / 0.9);
    out[i] = lp2 * env * 0.33;
  }
  return out;
}
function epiano(midi, dur = 1.6, bright = 1) {
  const n = Math.round(dur * SR), out = new Float32Array(n), f = mtof(midi);
  for (let i = 0; i < n; i++) {
    const t = i / SR, I = 1.6 * bright * Math.exp(-t / 0.25);
    const m = Math.sin(2 * Math.PI * f * t);
    const c = Math.sin(2 * Math.PI * f * t + I * m) + 0.25 * Math.sin(2 * Math.PI * 2 * f * t) * Math.exp(-t / 0.15);
    out[i] = c * Math.exp(-t / 0.55) * Math.min(1, t / 0.004);
  }
  return out;
}
function bass(midi, dur) {
  const n = Math.round(dur * SR), out = new Float32Array(n), f = mtof(midi);
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = Math.min(1, t / 0.01) * Math.exp(-t / 0.9) * Math.min(1, (dur - t) / 0.05);
    const s = Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
    out[i] = Math.tanh(1.5 * s) * env;
  }
  return out;
}
function kick(big = false) {
  const dur = big ? 1.4 : 0.45, n = Math.round(dur * SR), out = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = 44 + 110 * Math.exp(-t / 0.045);
    ph += 2 * Math.PI * f / SR;
    out[i] = Math.sin(ph) * Math.exp(-t / (big ? 0.5 : 0.16)) + (t < 0.004 ? rnd() * 0.25 : 0);
  }
  return out;
}
function hat(open = false) {
  const dur = open ? 0.25 : 0.06, n = Math.round(dur * SR), out = new Float32Array(n); let hp = 0, prev = 0;
  for (let i = 0; i < n; i++) { const x = rnd(); hp = 0.85 * (hp + x - prev); prev = x; out[i] = hp * Math.exp(-(i / SR) / (open ? 0.08 : 0.018)); }
  return out;
}
function riser(dur, rev = false) {
  const n = Math.round(dur * SR), out = new Float32Array(n); let lp = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n, fc = 300 + 7000 * k * k, a = 1 - Math.exp(-2 * Math.PI * fc / SR);
    lp += a * (rnd() - lp); out[i] = lp * Math.pow(k, rev ? 3 : 1.6);
  }
  return out;
}

// 编曲 ---------------------------------------------------------------
const ARP = [0, 2, 1, 3, 2, 4, 3, 1]; // 八分音符琶音的和弦音序
for (let b = 0; b < BARS; b++) {
  const s = sec(b), t0 = b * BAR, last = b === BARS - 1 || s === 'end';
  const ch = s === 'end' ? FINAL : CH[b % 4];
  // 铺底
  const pdur = s === 'end' ? BAR * (BARS - b) + 3.5 : BAR + 0.9;
  if (!(s === 'end' && b > start.end)) for (const m of ch.notes.slice(0, 4)) put(t0 - 0.3, pad(m - 12 + (s === 'title' ? 0 : 0), pdur), s === 'mont' ? 0.11 : 0.09, (m % 5 - 2) * 0.25, 0.6);
  // 电钢琴琶音：片头稀疏，群剪满
  const dense = s === 'mont' || s === 'mich' ? 8 : s === 'end' ? 0 : 4;
  for (let k = 0; k < 8; k++) {
    if (dense === 4 && k % 2) continue;
    if (dense === 0) break;
    const note = ch.notes[ARP[k] % ch.notes.length] + 12;
    const vel = (k === 0 ? 1 : 0.7) * (s === 'title' ? 0.7 : 1);
    put(t0 + k * BEAT / 2, epiano(note, 1.4, vel), 0.12 * vel, k % 2 ? 0.35 : -0.35, 0.45);
  }
  // 低音
  if (['home', 'mich', 'mont', 'ana'].includes(s)) {
    put(t0, bass(ch.root, BEAT * 1.4), 0.14);
    put(t0 + BEAT * 1.5, bass(ch.root, BEAT * 1.0), 0.1);
    if (s === 'mont') put(t0 + BEAT * 3, bass(ch.root + 12, BEAT * 0.9), 0.07);
  }
  // 鼓
  if (s === 'mich' || s === 'mont' || s === 'ana') {
    put(t0, kick(), 0.3); put(t0 + 2 * BEAT, kick(), 0.22);
    if (s === 'mont') { put(t0 + 3.5 * BEAT, kick(), 0.13); for (let k = 0; k < 8; k++) put(t0 + k * BEAT / 2 + 0.01, hat(k === 7), k % 2 ? 0.07 : 0.035, 0.3, 0.1); }
  }
}
// 冲击与过门：群剪开始、片尾落点
put(start.mont * BAR - BAR, riser(BAR), 0.10, 0, 0.3);
put(start.mont * BAR, kick(true), 0.35, 0, 0.5);
put(start.end * BAR - BAR * 0.75, riser(BAR * 0.75, true), 0.08, 0, 0.3);
put(start.end * BAR, kick(true), 0.32, 0, 0.6);
for (const [i, m] of FINAL.notes.entries()) put(start.end * BAR + i * 0.09, epiano(m + 12, 3.5, 0.8), 0.07, (i - 2.5) * 0.2, 0.7);

// 混响（Freeverb 式：8 梳状 + 4 全通）-------------------------------
function freeverb(inp, spread) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round((d + spread) * SR / 44100));
  const aps = [556, 441, 341, 225].map((d) => Math.round((d + spread) * SR / 44100));
  const out = new Float32Array(N), fb = 0.86, damp = 0.3;
  for (const d of combs) {
    const buf = new Float32Array(d); let idx = 0, f = 0;
    for (let i = 0; i < N; i++) { const y = buf[idx]; f = y * (1 - damp) + f * damp; buf[idx] = inp[i] * 0.015 + f * fb; out[i] += y; idx = (idx + 1) % d; }
  }
  for (const d of aps) {
    const buf = new Float32Array(d); let idx = 0;
    for (let i = 0; i < N; i++) { const b = buf[idx], y = -out[i] + b; buf[idx] = out[i] + b * 0.5; out[i] = y; idx = (idx + 1) % d; }
  }
  return out;
}
const rvL = freeverb(sendL, 0), rvR = freeverb(sendR, 23);
let peak = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh((L[i] + rvL[i] * 0.9) * 1.1); R[i] = Math.tanh((R[i] + rvR[i] * 0.9) * 1.1); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const g = 0.89 / peak;

// 写 WAV（16 bit）
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4); }
fs.writeFileSync(OUT, buf);
console.log('bars', BARS, 'len', (N / SR).toFixed(2), 's', JSON.stringify(start));
