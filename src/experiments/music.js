// 实验：探究乐音——音调、音色与拍
// 弦音计（钢丝弦、可移动的琴码、砝码施加张力）、一对 440 Hz 音叉（B 上有可移动的小滑块）、传声器与声卡示波器。
// 每次拨弦或敲音叉，声卡采集一段声音：上半屏是波形（带两条时间光标），下半屏是 1 s 汉宁窗的频谱（带频率光标和峰值读数）。
// 声音按模式叠加合成（physics/music.js），打开“扬声器”可以真的听到。
import * as THREE from 'three';
import { meta, thumb } from './music.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox, canvasTexture } from '../core/Models.js';
import { mean, stdev, rand, gauss, relErr, pct, clamp, fmtU, tFactor, linFit } from '../core/Stats.js';
import { MAJOR, noteFreq, cents, pluckRel, hannMag, decayAvg } from '../physics/music.js';

const G = 9.794, XA = -42, Y0 = 11, LMIN = 20, LMAX = 92;
const MASSES = [4, 5, 6, 7];
const TDIV = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5];
const SPANS = [500, 1000, 2500];
const T1 = 0.03, TW = 1; // 采集起点（激发后）与频谱窗长（s）
const FLOOR = 2e-5; // 背景噪声（相对满量程）
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class MusicExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.d = rand(0.248, 0.252) * 1e-3;
    this.mu = 7850 * Math.PI * (this.d / 2) ** 2;
    this.muLabel = Math.round(this.mu * (1 + gauss(0.002)) * 1e7) / 1e7;
    this.mErr = Object.fromEntries(MASSES.map((m) => [m, 1 + rand(-0.001, 0.001)]));
    this.box = Array.from({ length: 30 }, () => 10 ** (gauss(0.4) / 20)); // 音箱对各次谐波的响应（±0.4 dB）
    this.fA = 440 + gauss(0.03); this.fB0 = 440 + rand(0.2, 0.5);
    this.m = 7; this.L = 60; this.x0 = 15; this.s = 0;
    this.tb = 3; this.sp = 2; this.fc = 261.6; this.c1 = 1; this.c2 = 9; this.snd = false;
    this.cap = null; this.lastB = null; this._n = 0;
  }
  get T() { return this.m * this.mErr[this.m] * G; }
  /** 钢丝弦第 n 次谐波的频率（计入抗弯刚度） */
  fString(n, L = this.L / 100, T = this.T) {
    const B = (Math.PI ** 3 * 2e11 * this.d ** 4) / (64 * T * L * L);
    return ((n / (2 * L)) * Math.sqrt(T / this.mu) * Math.sqrt(1 + B * n * n)) / Math.sqrt(1 + B);
  }
  fForkB(s = this.s) { return this.fB0 - 0.135 * s; }

  // ======================= 激发与采集 =======================
  excite(kind) {
    const comps = [];
    if (kind === 'string') {
      const r = this.x0 / this.L;
      for (let n = 1; n <= 30; n++) {
        const f = this.fString(n); if (f > 3000) break;
        comps.push({ f, a: 0.35 * pluckRel(n, r) * this.box[n - 1], tau: 3.2 / (1 + 0.12 * (n - 1)), ph: 0 });
      }
    } else {
      const fork = (f, a) => { comps.push({ f, a, tau: 7, ph: Math.PI / 2 }); comps.push({ f: f * 6.25, a: a * 0.12, tau: 0.08, ph: 0 }); };
      if (kind !== 'forkB') fork(this.fA, 0.3);
      if (kind !== 'forkA') fork(this.fForkB(), 0.28);
    }
    this.cap = { kind, comps, L: this.L, x0: this.x0, m: this.m, s: this.s, id: ++this._n };
    if (kind === 'forkB') this.lastB = { s: this.s, f: this.fForkB() };
    if (this.snd) this.play(comps, kind === 'string' ? 3 : 5);
    this._key = ''; this.app.changed();
  }
  /** 采集信号在激发后 t 时刻的值 */
  sig(t) { let v = 0; for (const c of this.cap.comps) v += c.a * Math.exp(-t / c.tau) * Math.sin(2 * Math.PI * c.f * t + c.ph); return v; }
  /** 频谱幅值（相对满量程）与声级（dB） */
  mag(f) {
    let v = FLOOR * (1 + 0.5 * Math.sin(f * 0.731) * Math.sin(f * 0.193));
    if (this.cap) for (const c of this.cap.comps) { const x = (f - c.f) * TW; if (Math.abs(x) < 40) v += c.a * decayAvg(c.tau, T1, TW) * hannMag(x); }
    return v;
  }
  dB(f) { return 20 * Math.log10(this.mag(f)); }
  /** 最强的谱峰 */
  peak() { if (!this.cap) return null; let b = null; for (const c of this.cap.comps) { const a = c.a * decayAvg(c.tau, T1, TW); if (!b || a > b.a) b = { f: c.f, a }; } return b; }
  /** 某个分量的峰值声级（dB） */
  levelAt(f) { return this.dB(f); }

  play(comps, dur) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ac) this.ac = new AC();
    this.ac.resume();
    const sr = this.ac.sampleRate, n = Math.floor(sr * dur), buf = this.ac.createBuffer(1, n, sr), d = buf.getChannelData(0);
    for (const c of comps) { const w = (2 * Math.PI * c.f) / sr, k = Math.exp(-1 / (c.tau * sr)); let e = c.a * 0.7; for (let i = 0; i < n; i++) { d[i] += e * Math.sin(w * i + c.ph); e *= k; } }
    for (let i = 0; i < 64 && i < n; i++) d[i] *= i / 64; // 防止起始咔嗒声
    const src = this.ac.createBufferSource(); src.buffer = buf; src.connect(this.ac.destination); src.start();
  }
  dispose() { if (this.ac) { try { this.ac.close(); } catch { /* 已关闭 */ } this.ac = null; } }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 72, 92], target: [0, 6, -4] }, { name: '弦音计', pos: [0, 40, 50], target: [0, 8, 8] }, { name: '音叉', pos: [-26, 40, 34], target: [-27, 9, -22] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(140, 86));
    app.stage.setLightTarget(0, 6, 0);
    const wood = MAT.paint(0x8a5a32), dark = MAT.paint(0x2b3440), alu = MAT.alu();
    // 弦音计
    const g = new THREE.Group(); g.position.z = 10;
    g.add(mesh(new THREE.BoxGeometry(104, 8, 12), wood, 0, 4, 0));
    const tex = canvasTexture(2048, 64, (c, w, h) => {
      c.fillStyle = '#efe9d8'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d2832'; c.strokeStyle = '#1d2832'; c.font = 'bold 22px Consolas'; c.textAlign = 'center';
      for (let mm = 0; mm <= 1000; mm++) { const x = (mm / 1000) * w, len = mm % 10 === 0 ? 30 : mm % 5 === 0 ? 20 : 12; c.lineWidth = mm % 10 === 0 ? 2 : 1; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, len); c.stroke(); if (mm % 100 === 0 && mm > 0 && mm < 1000) c.fillText(String(mm / 10), x, 56); }
    });
    const rule = new THREE.Mesh(new THREE.PlaneGeometry(100, 3.2), new THREE.MeshBasicMaterial({ map: tex }));
    rule.rotation.x = -Math.PI / 2; rule.position.set(XA + 50, 8.02, 4.2); rule.userData.noHL = true; g.add(rule);
    const bridge = () => { const b = new THREE.Group(); b.add(mesh(new THREE.BoxGeometry(1.4, Y0 - 8, 5), MAT.paint(0xe8dcc0), 0, (Y0 - 8) / 2 + 8, 0)); return b; };
    const bA = bridge(); bA.position.x = XA; g.add(bA);
    this.bB = bridge(); this.bB.add(mesh(new THREE.BoxGeometry(0.3, 0.1, 3.4), MAT.paint(0xc41e3a), 0, 8.05, 3.6)); g.add(this.bB);
    g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 3, 10), MAT.chrome(), -50, 9.5, 0));
    const pul = mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.8, 28), alu, 53, Y0 - 2.4, 0); pul.rotation.x = Math.PI / 2; g.add(pul);
    this.wire = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), MAT.metal()); this.wire.rotation.z = Math.PI / 2; g.add(this.wire);
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 20, 6), MAT.metal(), 55.4, Y0 - 12.4, 0));
    this.wts = new THREE.Group(); this.wts.position.set(55.4, Y0 - 23, 0); g.add(this.wts);
    this.pick = mesh(new THREE.ConeGeometry(0.6, 2.4, 10), MAT.paint(0xc41e3a)); this.pick.rotation.z = Math.PI; g.add(this.pick);
    app.addComponent(new Component({
      key: 'sono', name: '弦音计', zone: 'none', fixed: true, required: true, object: g, labelY: Y0 + 9,
      icon: SVG('<rect x="4" y="22" width="56" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 18 H58" stroke="currentColor" stroke-width="1.2"/><path d="M14 18 v4 M44 18 v4" stroke="currentColor" stroke-width="2"/>'),
      desc: `钢丝弦一端固定，跨过琴码 A、B 和滑轮，下挂砝码，张力 T = mg（g = ${G} m/s²）。琴码 B 可沿米尺移动（零点对准琴码 A），红色拨片指示拨弦位置。弦线标签：直径 0.25 mm，μ = ${(this.muLabel * 1e4).toFixed(3)}×10⁻⁴ kg/m。`,
      controls: () => [
        { type: 'knob', label: '琴码 B 的位置（弦长）', get: () => this.L, set: (v) => { this.L = clamp(v, LMIN, LMAX); this.x0 = Math.min(this.x0, this.L / 2); app.changed(); }, min: LMIN, max: LMAX, step: 0.01, bigStep: 1, perRev: 2, fmt: () => '看米尺读数' },
        { type: 'select', label: '砝码', get: () => this.m, set: (v) => { this.m = +v; app.changed(); }, options: MASSES.map((m) => ({ value: m, label: `${m.toFixed(1)} kg` })) },
        { type: 'knob', label: '拨弦位置（离琴码 A）', get: () => this.x0, set: (v) => { this.x0 = clamp(v, 1, this.L / 2); app.changed(); }, min: 1, max: LMAX / 2, step: 0.1, bigStep: 1, perRev: 5, digits: 1, unit: 'cm' },
        { type: 'button', label: '拨弦', onClick: () => this.excite('string') },
      ],
    }));
    // 音叉
    const fg = new THREE.Group();
    const fork = (x, slider) => {
      const f = new THREE.Group(); f.position.set(x, 0, -24);
      f.add(mesh(new THREE.BoxGeometry(14, 6, 7), wood, 0, 3, 0));
      f.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 3, 10), MAT.chrome(), 0, 7.5, 0));
      for (const dx of [-0.9, 0.9]) f.add(mesh(new THREE.BoxGeometry(0.5, 12, 0.7), MAT.chrome(), dx, 15, 0));
      const u = mesh(new THREE.TorusGeometry(0.9, 0.25, 8, 16, Math.PI), MAT.chrome(), 0, 9, 0); u.rotation.z = Math.PI; f.add(u);
      if (slider) { this.sl = mesh(new THREE.BoxGeometry(3.2, 1.2, 1.6), MAT.brass()); f.add(this.sl); }
      fg.add(f);
    };
    fork(-36, false); fork(-18, true);
    app.addComponent(new Component({
      key: 'forks', name: '音叉（一对）', zone: 'none', fixed: true, object: fg, labelY: 25,
      desc: '两个标称 440 Hz 的音叉装在共鸣箱上。A 为标准音叉（440.0 Hz）；B 的一支叉臂上套有小滑块，滑块越往上频率越低。用橡皮槌敲击。',
      controls: () => [
        { type: 'knob', label: 'B 上滑块的位置（离叉臂根部）', get: () => this.s, set: (v) => { this.s = clamp(v, 0, 40); app.changed(); }, min: 0, max: 40, step: 0.5, bigStep: 5, perRev: 20, digits: 1, unit: 'mm' },
        { type: 'button', label: '敲音叉 A', onClick: () => this.excite('forkA') },
        { type: 'button', label: '敲音叉 B', onClick: () => this.excite('forkB') },
        { type: 'button', label: '同时敲 A 和 B', onClick: () => this.excite('forks') },
      ],
    }));
    // 传声器与声卡示波器
    const sg = new THREE.Group();
    sg.add(mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.8, 20), dark, 0, 0.4, 0));
    sg.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 16, 8), MAT.chrome(), 0, 8, 0));
    sg.add(mesh(new THREE.CylinderGeometry(1.1, 0.8, 3.4, 16), MAT.black(), 0, 17.4, 0));
    sg.position.set(-6, 0, -12);
    const sb = (this.scopeBox = meterBox(28, 13, 16, '声卡示波器')); sb.group.position.set(34, 0, -22); sg.add(sb.group); sb.group.position.sub(sg.position);
    app.addComponent(new Component({
      key: 'scope', name: '传声器与声卡示波器', zone: 'none', fixed: true, object: sg, labelY: 22,
      desc: '驻极体传声器接计算机声卡，采样率 44.1 kHz。每次拨弦或敲音叉后自动采集：波形显示从激发后 30 ms 开始，频谱取 1 s 数据加汉宁窗（分辨约 1 Hz），纵轴为相对满量程的分贝数。',
      controls: () => [
        { type: 'segment', label: '时基（每格）', options: TDIV.map((t, i) => ({ value: i, label: t < 0.1 ? `${t * 1000} ms` : `${t} s` })), get: () => this.tb, set: (v) => { this.tb = +v; app.changed(); } },
        { type: 'knob', label: '时间光标 1', get: () => this.c1, set: (v) => { this.c1 = clamp(v, 0, 10); app.changed(); }, min: 0, max: 10, step: 0.01, bigStep: 0.5, perRev: 2, digits: 2, unit: '格' },
        { type: 'knob', label: '时间光标 2', get: () => this.c2, set: (v) => { this.c2 = clamp(v, 0, 10); app.changed(); }, min: 0, max: 10, step: 0.01, bigStep: 0.5, perRev: 2, digits: 2, unit: '格' },
        { type: 'readout', label: 'Δt（光标 2 − 光标 1）', get: () => `${(((this.c2 - this.c1) * TDIV[this.tb]) * 1000).toFixed(1)} ms` },
        { type: 'segment', label: '频谱范围', options: SPANS.map((s, i) => ({ value: i, label: `0–${s} Hz` })), get: () => this.sp, set: (v) => { this.sp = +v; this.fc = Math.min(this.fc, SPANS[this.sp]); app.changed(); } },
        { type: 'knob', label: '频率光标', get: () => this.fc, set: (v) => { this.fc = Math.round(clamp(v, 0, SPANS[this.sp]) * 10) / 10; app.changed(); }, min: 0, max: 2500, step: 0.1, bigStep: 10, perRev: 50, digits: 1, unit: 'Hz' },
        { type: 'readout', label: '光标处', get: () => (this.cap ? `${this.fc.toFixed(1)} Hz，${this.dB(this.fc).toFixed(1)} dB` : '还没有采集') },
        { type: 'toggle', label: '扬声器（回放声音）', get: () => this.snd, set: (v) => { this.snd = v; if (v) { const AC = window.AudioContext || window.webkitAudioContext; if (AC && !this.ac) this.ac = new AC(); this.ac && this.ac.resume(); } } },
      ],
    }));
    this.view = app.addView({ id: 'scr', title: '声卡示波器：波形与频谱', w: 360, h: 330, res: 1.4 });
  }
  update() {
    const xB = XA + this.L;
    this.bB.position.x = xB;
    this.wire.scale.y = 53 - -50; this.wire.position.set(1.5, Y0 + 0.05, 0);
    this.pick.position.set(XA + this.x0, Y0 + 1.8, 0);
    if (this._m !== this.m) { this._m = this.m; this.wts.clear(); for (let k = 0; k < this.m; k++) this.wts.add(mesh(new THREE.CylinderGeometry(2.4, 2.4, 1.5, 24), MAT.metal(), 0, -k * 1.6, 0)); }
    if (this.sl) this.sl.position.set(0.9, 9.5 + this.s * 0.25, 0);
    const pk = this.peak();
    const s = pk ? pk.f.toFixed(1) : '----';
    if (s !== this._ss) { this._ss = s; this.scopeBox.setText(s, pk ? 'Hz' : '', pk ? '最强谱峰' : '等待采集'); }
    this.draw();
  }
  draw() {
    const v = this.view, g = v.ctx, W = v.W, H = v.H, cap = this.cap;
    g.fillStyle = '#14191d'; g.fillRect(0, 0, W, H);
    const fs = Math.round(H * 0.034);
    g.font = `${fs}px "IBM Plex Mono", monospace`;
    // 波形
    const wx0 = W * 0.06, wx1 = W * 0.97, wy0 = H * 0.04, wy1 = H * 0.42, wym = (wy0 + wy1) / 2;
    g.strokeStyle = 'rgba(150,170,180,.18)'; g.lineWidth = 1;
    for (let i = 0; i <= 10; i++) { const x = wx0 + ((wx1 - wx0) * i) / 10; g.beginPath(); g.moveTo(x, wy0); g.lineTo(x, wy1); g.stroke(); }
    for (let j = 0; j <= 4; j++) { const y = wy0 + ((wy1 - wy0) * j) / 4; g.beginPath(); g.moveTo(wx0, y); g.lineTo(wx1, y); g.stroke(); }
    const td = TDIV[this.tb];
    if (cap) {
      const n = Math.round(wx1 - wx0), sub = 16, A = (wy1 - wy0) / 2 / 0.9;
      g.strokeStyle = '#7fe0b0'; g.lineWidth = 1.1; g.beginPath();
      for (let i = 0; i < n; i++) {
        let lo = Infinity, hi = -Infinity;
        for (let k = 0; k < sub; k++) { const t = T1 + ((i + k / sub) / n) * 10 * td, y = this.sig(t); lo = Math.min(lo, y); hi = Math.max(hi, y); }
        const x = wx0 + i;
        if (i === 0) g.moveTo(x, wym - hi * A);
        g.lineTo(x, wym - hi * A); g.lineTo(x, wym - lo * A);
      }
      g.stroke();
    }
    for (const [c, col] of [[this.c1, '#f2c14e'], [this.c2, '#f28c4e']]) { const x = wx0 + ((wx1 - wx0) * c) / 10; g.strokeStyle = col; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, wy0); g.lineTo(x, wy1); g.stroke(); g.setLineDash([]); }
    g.fillStyle = '#9fb0b8'; g.textAlign = 'left';
    g.fillText(`${td < 0.1 ? td * 1000 + ' ms' : td + ' s'}/div   Δt = ${(((this.c2 - this.c1) * td) * 1000).toFixed(1)} ms`, wx0, wy1 + fs * 1.2);
    // 频谱
    const sx0 = W * 0.1, sx1 = W * 0.97, sy0 = H * 0.5, sy1 = H * 0.9, span = SPANS[this.sp], dbTop = 0, dbBot = -90;
    const X = (f) => sx0 + ((sx1 - sx0) * f) / span, Y = (db) => sy0 + ((sy1 - sy0) * (dbTop - db)) / (dbTop - dbBot);
    g.strokeStyle = 'rgba(150,170,180,.18)';
    for (let db = 0; db >= dbBot; db -= 10) { g.beginPath(); g.moveTo(sx0, Y(db)); g.lineTo(sx1, Y(db)); g.stroke(); }
    for (let i = 0; i <= 5; i++) { const x = sx0 + ((sx1 - sx0) * i) / 5; g.beginPath(); g.moveTo(x, sy0); g.lineTo(x, sy1); g.stroke(); }
    g.fillStyle = '#7d8c93'; g.textAlign = 'right';
    for (let db = 0; db >= dbBot; db -= 30) g.fillText(String(db), sx0 - 4, Y(db) + fs * 0.35);
    g.textAlign = 'center';
    for (let i = 0; i <= 5; i++) g.fillText(String((span * i) / 5), sx0 + ((sx1 - sx0) * i) / 5, sy1 + fs * 1.15);
    if (cap) {
      g.strokeStyle = '#6fb7ff'; g.lineWidth = 1; g.beginPath();
      const n = Math.round(sx1 - sx0), df = span / n;
      for (let i = 0; i <= n; i++) {
        const f0 = i * df; let m = this.mag(f0);
        for (const c of cap.comps) if (c.f >= f0 - df / 2 && c.f < f0 + df / 2) m = Math.max(m, this.mag(c.f)); // 窄峰落在像素之间时仍画出峰顶
        const y = Y(Math.max(dbBot, 20 * Math.log10(m)));
        i ? g.lineTo(sx0 + i, y) : g.moveTo(sx0, y);
      }
      g.stroke();
      const x = X(this.fc); g.strokeStyle = '#f2c14e'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, sy0); g.lineTo(x, sy1); g.stroke(); g.setLineDash([]);
    }
    g.textAlign = 'left'; g.fillStyle = '#9fb0b8';
    const pk = this.peak();
    g.fillText(cap ? `光标 ${this.fc.toFixed(1)} Hz  ${this.dB(this.fc).toFixed(1)} dB   峰值 ${pk.f.toFixed(1)} Hz` : '拨弦或敲音叉后自动采集', sx0, H * 0.975);
    const what = !cap ? '还没有采集声音' : cap.kind === 'string' ? `拨弦：弦长 ${cap.L.toFixed(2)} cm，拨弦处 ${cap.x0.toFixed(1)} cm，砝码 ${cap.m} kg` : cap.kind === 'forks' ? `同时敲 A、B（滑块 ${cap.s.toFixed(1)} mm）` : `敲音叉 ${cap.kind === 'forkA' ? 'A' : `B（滑块 ${cap.s.toFixed(1)} mm）`}`;
    v.foot(what);
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'scale', title: 'C 大调音阶（十二平均律，A4 = 440 Hz）', fixedRows: true,
        initRows: () => MAJOR.map((n) => ({ note: `${n.name}（${n.solfa}）`, ft: +noteFreq(n.k).toFixed(2) })),
        columns: [
          { key: 'note', label: '音名', type: 'text', readonly: true },
          { key: 'ft', label: '标准频率/Hz', digits: 2, readonly: true },
          { key: 'L', label: '弦长 L/cm', digits: 2, readTol: 0.06 },
          { key: 'f', label: '实测基频/Hz', digits: 1, readTol: 0.15 },
          { key: 'c', label: '偏差/音分', digits: 1, calc: (r) => cents(r.f, r.ft) },
          { key: 'v', label: '2Lf /(m/s)', digits: 2, calc: (r) => (2 * r.L * r.f) / 100 },
        ],
        buttons: [{ label: '记录这一次拨弦', onClick: (t) => this.recScale(t) }],
        note: '张力不变，移动琴码 B，拨弦后看频谱的峰值读数，使基频与标准频率相差不超过 5 音分（约 0.3%）。音分 = 1200·log₂(f/f₀)，100 音分为一个半音。',
      },
      {
        id: 'timbre', title: '拨弦位置与谐波（以基波为 0 dB）', maxRows: 6,
        columns: [
          { key: 'r', label: 'x₀/L', digits: 3, auto: true },
          ...[2, 3, 4, 5, 6].map((n) => ({ key: `h${n}`, label: `L${'₀₁₂₃₄₅₆'[n]}−L₁ /dB`, digits: 1, readTol: 1.5 })),
        ],
        buttons: [{ label: '记录这一次拨弦的谐波', onClick: (t) => this.recTimbre(t) }],
        note: '弦长不变，分别在 L/2、L/3、L/4、L/5 等处拨弦。用频率光标对准各次谐波的峰顶读声级，减去基波的声级。低于 −40 dB 的记为 −40。',
      },
      {
        id: 'beat', title: '两个音叉的拍', maxRows: 6,
        columns: [
          { key: 's', label: '滑块/mm', digits: 1, auto: true },
          { key: 'fB', label: '音叉 B /Hz', digits: 1, readTol: 0.15 },
          { key: 'dt', label: '光标间隔 Δt/s', digits: 3, auto: true },
          { key: 'n', label: 'Δt 内的拍数', digits: 0, readTol: 0.5 },
          { key: 'fb', label: '拍频 n/Δt /Hz', digits: 3, calc: (r) => r.n / r.dt },
          { key: 'df', label: '|f_A − f_B| /Hz', digits: 2, calc: (r) => Math.abs(440 - r.fB) },
        ],
        buttons: [{ label: '记录（先单独敲 B 测频率，再同时敲 A、B 看拍）', onClick: (t) => this.recBeat(t) }],
        note: '音叉 A 为 440.0 Hz。单独敲 B，读频谱峰值得到 f_B；同时敲 A、B，选合适的时基，把两条时间光标放在相隔若干个拍的两个“最弱处”，数出中间的拍数 n。',
      },
    ];
  }
  stringCapOK() {
    const a = this.app, c = this.cap;
    if (!c || c.kind !== 'string') return a.toast('先拨弦，让声卡采集一次弦的声音', 'warn'), false;
    if (Math.abs(c.L - this.L) > 1e-9 || c.m !== this.m || Math.abs(c.x0 - this.x0) > 1e-9) return a.toast('弦长、砝码或拨弦位置改过了，重新拨一次弦', 'warn'), false;
    return true;
  }
  recScale(t) {
    if (!this.stringCapOK()) return;
    const a = this.app, f = this.cap.comps[0].f;
    let best = -1, bc = Infinity;
    t.rows.forEach((r, i) => { const c = cents(f, r.ft); if (Math.abs(c) < Math.abs(bc)) { bc = c; best = i; } });
    if (Math.abs(bc) > 40) a.toast(`基频 ${f.toFixed(1)} Hz 离 C 大调的任何一个音都很远，调琴码 B`, 'warn');
    t.set(best, 'L', Math.round(this.L * 100) / 100);
    t.set(best, 'f', +f.toFixed(2));
    if (Math.abs(bc) > 5) t.flagAll(best, [`离 ${t.rows[best].note} 还${bc > 0 ? '高' : '低'} ${Math.abs(bc).toFixed(0)} 音分，没有调准（琴码 B 要${bc > 0 ? '往右，弦变长' : '往左，弦变短'}）`]);
  }
  harmonics() { const c = this.cap.comps, L1 = this.dB(c[0].f); return [2, 3, 4, 5, 6].map((n) => Math.max(-40, this.dB(c[n - 1].f) - L1)); }
  recTimbre(t) {
    if (!this.stringCapOK()) return;
    const a = this.app, r = this.x0 / this.L;
    if (this.cap.comps.length < 6) return a.toast('弦太短、基频太高，第 6 次谐波超出了频谱范围：把弦放长一些', 'warn');
    if (t.rows.some((x) => Math.abs(x.r - r) < 0.005)) a.toast('这个拨弦位置已经记过了', 'warn');
    const h = this.harmonics();
    t.flagAll(t.addRow({ r: +r.toFixed(4), ...Object.fromEntries(h.map((v, i) => [`h${i + 2}`, +v.toFixed(1)])), _L: this.L }), t.rows.length && Math.abs(t.rows[0]._L - this.L) > 0.05 ? ['弦长和第一行不同'] : []);
  }
  recBeat(t) {
    const a = this.app, c = this.cap;
    if (!this.lastB || this.lastB.s !== this.s) return a.toast('先在当前滑块位置单独敲一次音叉 B，测出它的频率', 'warn');
    if (!c || c.kind !== 'forks' || c.s !== this.s) return a.toast('再同时敲 A 和 B，在波形上看拍', 'warn');
    if (t.rows.some((r) => r.s === this.s)) a.toast('这个滑块位置已经测过了', 'warn');
    const dt = (this.c2 - this.c1) * TDIV[this.tb], fb = Math.abs(this.fA - this.lastB.f), n = dt * fb;
    if (dt <= 0) return a.toast('光标 2 应在光标 1 的右边', 'warn');
    if (Math.round(n) < 2) a.toast('两条光标之间不到 2 个拍：加大时基，或把光标拉开', 'warn');
    t.flagAll(t.addRow({ s: this.s, fB: +this.lastB.f.toFixed(2), dt: +dt.toFixed(4), n: Math.round(n) }), Math.abs(n - Math.round(n)) > 0.15 ? [`光标没有都对准拍的最弱处：两条光标之间约 ${n.toFixed(2)} 个拍，不是整数`] : []);
  }

  // ======================= 自动操作 =======================
  async adj(comp, key, to, ms = 500) { const a = this.app; a.select(a.comp(comp)); await a.tween(() => this[key], (v) => (this[key] = v), to, ms); this[key] = to; a.changed(); await a.wait(150); }
  /** 张力 T 下基频为 f 的弦长（cm） */
  Lfor(f) { let L = (Math.sqrt(this.T / this.mu) / (2 * f)) * 100; for (let i = 0; i < 6; i++) L *= this.fString(1, L / 100) / f; return L; }
  steps() {
    const app = this.app, tab = (id) => app.table(id);
    const scaleDone = () => tab('scale').rows.filter((r) => r.L > 0 && r.f > 0).length;
    return [
      {
        title: '调出 C 大调音阶',
        html: '<p>挂 7 kg 砝码。从 C4 开始：拨弦，看频谱上的峰值读数，按 $f\\propto1/L$ 估算该移多少，移动琴码 B 再拨，直到基频与标准频率相差不到 5 音分。依次调出 C4 到 C5 的 8 个音，每个音记下弦长和基频。打开“扬声器”可以听到声音。</p>',
        hint: '要升高一个半音，弦长要缩短到原来的 2^(−1/12) ≈ 0.944 倍。可以先由第一个音算出 2Lf，再估算其他音的弦长。',
        status: () => `已调好 ${scaleDone()} / 8 个音`,
        check: () => scaleDone() >= 8,
        diagnose: () => (this.m !== 7 ? [{ msg: `现在挂的是 ${this.m} kg 砝码；本步要求 7 kg，张力太小时 C4 的弦长超出导轨。`, fix: { label: '换 7 kg', run: async () => { this.m = 7; } } }] : []),
        auto: async () => {
          app.showTable(0); await app.view('弦音计');
          app.select(app.comp('sono')); this.m = 7; app.renderInspector();
          for (const n of MAJOR) {
            const i = tab('scale').rows.findIndex((r) => r.note.startsWith(n.name));
            if (tab('scale').rows[i].L > 0) continue;
            const L = Math.round(this.Lfor(noteFreq(n.k)) * 100) / 100;
            await this.adj('sono', 'L', L); this.x0 = Math.min(this.x0, L / 2);
            this.excite('string'); await app.wait(250);
            await app.record('scale', 0);
          }
        },
      },
      {
        title: '音色：改变拨弦位置',
        html: '<p>把弦长固定在 C4 的位置，分别在 $L/2$、$L/3$、$L/4$、$L/5$ 处拨弦。频谱范围选 0–2500 Hz，用频率光标依次读出第 1 到第 6 次谐波峰顶的声级，算出各次谐波比基波低多少分贝。</p>',
        hint: '在 L/3 处拨弦时，弦在那里不可能是波节，所以凡是在 L/3 处有波节的模式（3、6、9…次）都激不起来。',
        status: () => `已记录 ${tab('timbre').rows.length} 个拨弦位置`,
        check: () => tab('timbre').rows.length >= 3 && tab('timbre').rows.some((r) => Math.abs(r.r - 1 / 3) < 0.01 || Math.abs(r.r - 0.5) < 0.01),
        auto: async () => {
          app.showTable(1); await app.view('弦音计');
          if (this.m !== 7) { this.m = 7; }
          const L = Math.round(this.Lfor(noteFreq(0)) * 100) / 100;
          if (Math.abs(this.L - L) > 0.05 && !tab('timbre').rows.length) await this.adj('sono', 'L', L);
          app.select(app.comp('scope')); this.sp = 2; app.renderInspector();
          for (const k of [2, 3, 4, 5]) {
            if (tab('timbre').rows.length >= 4) break;
            const x = Math.round((this.L / k) * 10) / 10;
            if (tab('timbre').rows.some((r) => Math.abs(r.r - x / this.L) < 0.005)) continue;
            await this.adj('sono', 'x0', x, 300);
            this.excite('string'); await app.wait(200);
            for (const n of [1, 2, 3]) await this.adj('scope', 'fc', Math.round(this.cap.comps[n - 1].f * 10) / 10, 250);
            await app.record('timbre', 0);
          }
        },
      },
      {
        title: '拍：两个频率相近的音叉',
        html: '<p>把音叉 B 的滑块放在 3 个不同位置。每个位置先单独敲 B，用频谱的峰值读数测 $f_B$；再同时敲 A、B，在波形上看到响度周期性起伏——拍。选合适的时基，把两条时间光标放在相隔几个拍的两个最弱处，读出 $\\Delta t$，数出拍数 $n$。</p>',
        hint: '拍频只有几赫兹，时基要选 0.1–0.5 s/格。光标间隔里的拍越多，拍频测得越准。',
        status: () => `已测 ${tab('beat').rows.length} 个滑块位置`,
        check: () => tab('beat').rows.length >= 3,
        auto: async () => {
          app.showTable(2); await app.view('音叉');
          for (const s of [8, 18, 30]) {
            if (tab('beat').rows.some((r) => r.s === s)) continue;
            await this.adj('forks', 's', s, 400);
            this.excite('forkB'); await app.wait(300);
            this.excite('forks');
            const fb = Math.abs(this.fA - this.fForkB()), Tb = 1 / fb;
            let tb = TDIV.findIndex((td) => 10 * td * fb >= 3.2); if (tb < 0) tb = TDIV.length - 1;
            const td = TDIV[tb];
            app.select(app.comp('scope')); this.tb = tb; app.renderInspector();
            // 拍的最弱处：(ω_A − ω_B)t + 相位差 = π（两叉初相相同）
            const tm0 = Tb / 2, k0 = Math.ceil((T1 - tm0) / Tb + 1e-9), t1 = tm0 + Math.max(0, k0) * Tb, n = Math.floor((T1 + 10 * td - t1) / Tb);
            await this.adj('scope', 'c1', (t1 - T1) / td, 300); await this.adj('scope', 'c2', (t1 + n * Tb - T1) / td, 400);
            await app.wait(200);
            await app.record('beat', 0);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>由音阶的数据验证 $f\\propto1/L$，求弦上的波速和线密度；比较平均律与纯律；比较各拨弦位置的谐波与理论；验证拍频等于两音叉的频率差。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, S = a.table('scale').rows.filter((r) => r.L > 0 && r.f > 0), Tm = a.table('timbre').rows.filter((r) => r.r > 0), B = a.table('beat').rows.filter((r) => r.fB > 0 && r.dt > 0 && r.n > 0);
    if (S.length < 3 && Tm.length < 1 && B.length < 1) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = ''; const answers = [], plots = [];
    if (S.length >= 3) {
      const v = S.map((r) => (2 * r.L * r.f) / 100), vm = mean(v), uv = S.length > 1 ? (tFactor(S.length) * stdev(v)) / Math.sqrt(S.length) : 0, T = 7 * this.mErr[7] * G, muM = T / (vm * vm);
      const c4 = S.find((r) => r.note.startsWith('C4'));
      html += `<h3>1. 音调：C 大调音阶</h3><table><tr><th>音</th><th>L/cm</th><th>f/Hz</th><th>2Lf /(m/s)</th>${c4 ? '<th>L(C4)/L</th><th>平均律 2^(k/12)</th><th>纯律</th><th>平均律−纯律 /音分</th>' : ''}</tr>
        ${S.map((r) => { const n = MAJOR.find((x) => r.note.startsWith(x.name)), j = n.just[0] / n.just[1]; return `<tr><td>${r.note}</td><td>${r.L.toFixed(2)}</td><td>${r.f.toFixed(1)}</td><td>${((2 * r.L * r.f) / 100).toFixed(2)}</td>${c4 ? `<td>${(c4.L / r.L).toFixed(4)}</td><td>${(2 ** (n.k / 12)).toFixed(4)}</td><td>${n.just[0]}/${n.just[1]} = ${j.toFixed(4)}</td><td>${(1200 * Math.log2(2 ** (n.k / 12) / j)).toFixed(1)}</td>` : ''}</tr>`; }).join('')}</table>
        <p>各音的 $2Lf$ 基本相同，说明张力不变时 $f\\propto1/L$，$2Lf$ 就是弦上横波的速度 $v=\\sqrt{T/\\mu}$。</p>
        <div class="result-box">$v=${fmtU(vm, uv)}$ m/s，$\\mu=T/v^2=${(muM * 1e4).toFixed(3)}\\times10^{-4}$ kg/m（标签值 ${(this.muLabel * 1e4).toFixed(3)}×10⁻⁴，相对偏差 ${pct(relErr(muM, this.muLabel))}）</div>
        <p>十二平均律把八度等分为 12 个半音，每个半音的频率比都是 $2^{1/12}$，所以可以随意转调；纯律的音程是简单整数比（纯五度 3:2、大三度 5:4），和声更“纯”，但转调后就不准了。平均律的纯五度比纯律低 2 音分，大三度却高 14 音分。</p>`;
      answers.push({ label: '弦上的波速 $v=2Lf$', unit: 'm/s', value: vm, digits: 2, tolRel: 0.004 });
      plots.push({ title: 'f – 1/L', xLabel: '1/L / m⁻¹', yLabel: 'f / Hz', series: [{ type: 'scatter', data: S.map((r) => [100 / r.L, r.f]), label: '实验点' }, { type: 'line', data: [[0, 0], [100 / Math.min(...S.map((r) => r.L)) * 1.05, ((vm / 2) * 100 / Math.min(...S.map((r) => r.L))) * 1.05]], label: 'f = v/2L' }] });
    }
    if (Tm.length) {
      const th = (n, r) => Math.max(-40, 20 * Math.log10(Math.max(1e-6, pluckRel(n, r))));
      html += `<h3>2. 音色：拨弦位置与谐波</h3><table><tr><th>x₀/L</th>${[2, 3, 4, 5, 6].map((n) => `<th>n=${n} 实测</th><th>理论</th>`).join('')}</tr>
        ${Tm.map((r) => `<tr><td>${r.r.toFixed(3)}</td>${[2, 3, 4, 5, 6].map((n) => `<td>${isFinite(r['h' + n]) ? r['h' + n].toFixed(1) : '—'}</td><td>${th(n, r.r).toFixed(1)}</td>`).join('')}</tr>`).join('')}</table>
        <p>理论值按 $A_n\\propto\\dfrac{\\sin(n\\pi x_0/L)}{n}$ 计算（琴码处的横向力）。在 $x_0=L/k$ 处拨弦，第 $k$、$2k$、… 次谐波消失——这些模式在拨弦点恰好有波节。实测与理论的差别来自音箱对不同频率的放大不同、高次谐波衰减更快（频谱取的是 1 s 内的平均）。</p>
        <p>同一个音高（基频相同），谐波的组成不同，听起来就不一样：在弦的中点拨，只有奇次谐波，声音圆润空洞；靠近琴码拨，高次谐波丰富，声音明亮尖锐。这就是“音色”。</p>`;
      plots.push({ title: '谐波声级（相对基波）', xLabel: '谐波次数 n', yLabel: 'Lₙ − L₁ / dB', series: Tm.slice(0, 4).flatMap((r) => [{ type: 'scatter', data: [1, 2, 3, 4, 5, 6].map((n) => [n, n === 1 ? 0 : r['h' + n]]).filter((p) => isFinite(p[1])), label: `x₀/L=${r.r.toFixed(2)} 实测` }, { type: 'line', data: [1, 2, 3, 4, 5, 6].map((n) => [n, th(n, r.r)]), label: `理论` }]) });
      const r3 = Tm.find((r) => Math.abs(r.r - 1 / 3) < 0.01);
      if (r3 && isFinite(r3.h3)) answers.push({ label: '在 L/3 处拨弦时第 3 次谐波的相对声级', unit: 'dB', value: r3.h3, digits: 1, tolAbs: 1.5 });
    }
    if (B.length) {
      const fit = linFit(B.map((r) => Math.abs(440 - r.fB)), B.map((r) => r.n / r.dt));
      html += `<h3>3. 拍</h3><table><tr><th>滑块/mm</th><th>f_B/Hz</th><th>|f_A−f_B| /Hz</th><th>Δt/s</th><th>n</th><th>拍频/Hz</th></tr>${B.map((r) => `<tr><td>${r.s.toFixed(1)}</td><td>${r.fB.toFixed(1)}</td><td>${Math.abs(440 - r.fB).toFixed(2)}</td><td>${r.dt.toFixed(3)}</td><td>${r.n}</td><td>${(r.n / r.dt).toFixed(3)}</td></tr>`).join('')}</table>
        <p>两个同方向、频率相近的振动叠加：$A\\cos\\omega_At+A\\cos\\omega_Bt=2A\\cos\\dfrac{(\\omega_A-\\omega_B)t}{2}\\cos\\dfrac{(\\omega_A+\\omega_B)t}{2}$，合振幅以 $|f_A-f_B|$ 的频率起伏。${B.length >= 2 ? `拍频对频率差的直线斜率 ${fit.k.toFixed(3)}（理论 1）。` : ''}</p>
        <p>滑块越往上，叉臂末端的等效质量越大，频率越低。调琴时把待调的弦和标准音一起发声，拍越来越慢直到消失，就调准了。</p>`;
      if (B.length >= 2) answers.push({ label: '拍频–频率差直线的斜率', unit: '', value: fit.k, digits: 3, tolAbs: 0.03 });
      plots.push({ title: '拍频 – |f_A − f_B|', xLabel: '|f_A − f_B| / Hz', yLabel: '拍频 / Hz', series: [{ type: 'scatter', data: B.map((r) => [Math.abs(440 - r.fB), r.n / r.dt]), label: '实验点' }, { type: 'line', data: [[0, 0], [6, 6]], label: '拍频 = 频率差' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 乐音的三要素</h3><p>乐器发出的声音是周期性的振动，可以分解为基频 $f_1$ 和一系列谐波（泛音）的叠加。<b>音调</b>由基频决定，<b>响度</b>由振幅（声压级）决定，<b>音色</b>由各次谐波的相对强弱决定。</p>
<h3>2. 弦的振动</h3><p>两端固定、张力为 $T$、线密度为 $\\mu$、长为 $L$ 的弦，固有频率为</p>$$f_n=\\frac{n}{2L}\\sqrt{\\frac T\\mu},\\qquad n=1,2,3,\\cdots$$<p>在 $x_0$ 处把弦拉成三角形后放开，第 $n$ 个模式的初始振幅正比于 $\\dfrac{\\sin(n\\pi x_0/L)}{n^2}$。弦通过琴码推动音箱发声，声压正比于琴码处的横向力 $T\\,\\partial y/\\partial x$，所以 $n$ 次谐波的声压 $\\propto\\dfrac{\\sin(n\\pi x_0/L)}{n}$。</p>
<h3>3. 音律</h3><p>十二平均律：相邻半音的频率比为 $2^{1/12}$，以 A4 = 440 Hz 为标准，C4 = 261.63 Hz。两个频率的音程用音分表示：$1200\\log_2(f/f_0)$，一个半音 100 音分。</p>
<h3>4. 拍</h3><p>两个频率相近的声音叠加，合成声音的响度以 $|f_A-f_B|$ 的频率起伏，称为拍。</p>
<h3>5. 声卡示波器</h3><p>传声器把声压变成电压，声卡以 44.1 kHz 采样。频谱是 1 s 数据加汉宁窗后的傅里叶变换，单个正弦分量在频谱上是一个宽约 ±2 Hz 的峰；纵轴为相对满量程的分贝数 $20\\lg(A/A_{\\text{满}})$。</p>
<h3>6. 本仿真的计算模型</h3><p>声音按模式叠加合成：钢丝弦计入抗弯刚度（泛音比整数倍略高），各次谐波按各自的时间常数指数衰减（高次谐波衰减更快），音箱对各次谐波的响应有 ±0.4 dB 的起伏；音叉为正弦振动，另有一个约 6.25 倍频、很快衰减的“敲击音”。频谱由汉宁窗的解析频谱叠加得到。</p>`;
  }
}
