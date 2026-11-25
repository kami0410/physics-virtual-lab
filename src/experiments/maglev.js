// 实验：电磁混合磁悬浮
// U 形铁芯（每极截面 3 cm × 3 cm）上绕 600 匝线圈，磁轭中嵌一块钕铁硼永磁体提供偏置磁通；浮子是一块钢板，悬在两极下方。
// 静力测量：浮子固定在测微台上（气隙 3–14 mm 可调），测微台下装拉压力传感器（已扣除浮子重力），线圈接可调恒流源。
// 悬浮：电涡流位移传感器测气隙，控制器按 PID（定位）或 PD + 零功率积分（零功率）输出电流指令，功率放大器（电流型，
// 时间常数 0.3 ms，限幅 ±3 A）驱动线圈。浮子下方 12 mm 处有托架。
// 永磁等效电流 i₀、等效气隙 δ 个体随机，浮子质量由随机的零功率间隙反推（称量值给出）。模型见 physics/maglev.js。
import * as THREE from 'three';
import { meta, thumb } from './maglev.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, gauss, clamp, relErr, pct, linFit, mean } from '../core/Stats.js';
import { force, eqCurrent, linCoef, step, ringMeasure } from '../physics/maglev.js';

const GRAV = 9.8, RC = 4, H = 1e-4, GMAX = 12e-3, GSET = 6e-3;
const DMS = [0, 50, 100, 150, 200]; // g
const SVG = (inner) => `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;

export class MaglevExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.p = { A: 9e-4, N: 600, i0: rand(2.3, 2.7), delta: rand(3.5, 4.5) * 1e-3 };
    this.m = Math.round((force(rand(6.2, 6.6) * 1e-3, 0, this.p) / GRAV) * 1000) / 1000; // kg，称量值即真值
    this.mode = 'static'; this.gStat = 8; this.iStat = 0; // mm、A
    this.cmode = 'pos'; this.Kp = 0.8; this.Kd = 1.0; this.gset = 6; this.dm = 0;
    this.s = { g: GMAX, v: 0, i: 0, I: 0, gs: GMAX }; this.contact = 1; this.ramp = false;
    this.trace = []; this.tt = 0; this.calm = 0; this.ring = null; this.cap = null; this.nz = 0;
  }
  get mt() { return this.m + this.dm / 1000; }
  ctrl() { const Kp = this.Kp * 1000; return { mode: this.cmode, Kp, Kd: this.Kd, Ki: Kp / 5, Kz: 3e-3, imax: 3, tau: 3e-4 }; }
  // ---------- 读数 ----------
  Fread() { return Math.round((force(this.gStat / 1000, this.iStat, this.p) + this.nz * 0.0006) * 1000) / 1000; }
  gRead() { return this.mode === 'static' ? this.gStat : Math.round((this.s.g * 1000 + this.nz * 0.0008) * 1000) / 1000; }
  iRead() { return this.mode === 'static' ? this.iStat : Math.round(this.s.i * 1000) / 1000; }
  levitating() { return this.mode === 'lev' && this.contact === 0; }
  calmNow() { return this.levitating() && !this.ramp && !this.cap && Math.abs(this.s.v) < 5e-5 && Math.abs(this.s.g - this.s.gs) < 3e-6 && (this.cmode === 'pos' ? Math.abs(this.s.gs - this.gset / 1000) < 1e-7 : Math.abs(this.s.i) < 0.004); }
  steady() { return this.calm >= 0.4 && this.calmNow(); }

  liftOff() {
    const s = this.s; this.mode = 'lev';
    s.g = GMAX; s.v = 0; s.i = 0; s.I = 0; s.gs = GMAX; this.ramp = true; this.contact = 1; this.ring = null; this.cap = null; this.trace = [];
  }
  tap() { if (!this.levitating()) return this.app.toast('浮子没有悬浮起来', 'warn'); this.s.v += 0.01; this.ring = null; this.cap = { t: 0, pts: [], Kp: this.Kp, Kd: this.Kd }; this.app.changed(); }

  tick(dt) {
    const a = this.app, sdt = Math.min(0.25, dt * (a.running ? a.speed : 1));
    this.nz = clamp(this.nz * 0.7 + gauss(0.6), -2, 2);
    if (this.mode !== 'lev' || !(sdt > 0)) { a.changed(); return; }
    const n = Math.ceil(sdt / H), c = this.ctrl(), s = this.s, tgt = this.gset / 1000;
    for (let k = 0; k < n; k++) {
      if (this.ramp) { const dg = 5e-3 * H; s.gs = Math.abs(s.gs - tgt) <= dg ? tgt : s.gs - Math.sign(s.gs - tgt) * dg; if (s.gs === tgt) this.ramp = false; }
      else if (c.mode === 'pos') s.gs += clamp(tgt - s.gs, -5e-3 * H, 5e-3 * H); // 设定值变化也按 5 mm/s 跟随
      this.contact = step(s, c, this.p, this.mt, GRAV, H, 0.5e-3, GMAX);
      this.tt += H;
      if (this.cap) {
        this.cap.t += H;
        if (Math.round(this.cap.t / H) % 10 === 0) this.cap.pts.push([this.cap.t, s.g - s.gs]);
        if (this.cap.t >= 2.5) { const r = ringMeasure(this.cap.pts); this.ring = r ? { ...r, Kp: this.cap.Kp, Kd: this.cap.Kd, i: s.i } : { fail: true }; this.cap = null; }
      }
      if (k % 20 === 0) { this.trace.push([this.tt, s.g, s.i]); this.calm = this.calmNow() ? this.calm + 20 * H : 0; }
    }
    while (this.trace.length && this.tt - this.trace[0][0] > 2) this.trace.shift();
    if (this.contact && !this.ramp && this.cap) { this.cap = null; this.ring = { fail: true }; }
    a.changed();
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 50, 84], target: [0, 14, -2] }, { name: '悬浮装置', pos: [-14, 30, 34], target: [-14, 20, 0] }, { name: '控制器', pos: [22, 26, 36], target: [22, 8, -10] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(140, 80));
    app.stage.setLightTarget(0, 10, 0);
    const X = -14, TOP = 30, G2U = 0.25; // 1 mm 气隙在场景中画成 0.25（放大 2.5 倍）
    const rig = new THREE.Group(); rig.position.x = X; scene.add(rig);
    const steel = MAT.paint(0x4b5560), fr = MAT.alu();
    for (const x of [-12, 12]) rig.add(mesh(new THREE.BoxGeometry(1.6, 36, 1.6), fr, x, 18, -6));
    rig.add(mesh(new THREE.BoxGeometry(26, 1.6, 4), fr, 0, 36, -4.5));
    rig.add(mesh(new THREE.BoxGeometry(28, 1, 14), MAT.paint(0x2b3440), 0, 0.5, -1));
    // 磁铁：U 形铁芯 + 永磁体 + 线圈
    rig.add(mesh(new THREE.BoxGeometry(14, 2.4, 3), steel, 0, TOP + 3.6, 0));
    for (const x of [-5.5, 5.5]) { rig.add(mesh(new THREE.BoxGeometry(3, 5, 3), steel, x, TOP, 0)); rig.add(mesh(new THREE.CylinderGeometry(2.6, 2.6, 3.6, 28), MAT.paint(0xb06a2c), x, TOP + 0.2, 0)); }
    rig.add(mesh(new THREE.BoxGeometry(3, 2.5, 3.1), MAT.paint(0xb3261e), 0, TOP + 3.6, 0));
    rig.add(mesh(new THREE.BoxGeometry(1.2, 6, 1.2), fr, 0, TOP + 7, -1.5));
    // 浮子与砝码
    this.flo = new THREE.Group(); rig.add(this.flo);
    this.flo.add(mesh(new THREE.BoxGeometry(15, 1.4, 4), MAT.paint(0x7d8a96), 0, -0.7, 0));
    this.flo.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 8), fr, 0, -3.2, 0));
    this.wts = [];
    for (let k = 0; k < 4; k++) { const w = mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.7, 24), MAT.chrome(), 0, -2.2 - k * 0.8, 0); this.wts.push(w); this.flo.add(w); }
    this.floY = (gmm) => TOP - 2.5 - gmm * G2U;
    // 托架与测微台
    rig.add(mesh(new THREE.BoxGeometry(18, 0.8, 5), MAT.paint(0x3a3f44), 0, this.floY(12) - 1.8, 0));
    for (const x of [-8, 8]) rig.add(mesh(new THREE.BoxGeometry(0.8, this.floY(12) - 1.8, 0.8), fr, x, (this.floY(12) - 1.8) / 2, 0));
    this.stand = new THREE.Group(); rig.add(this.stand);
    this.stand.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 12), MAT.chrome(), 0, 0, 0));
    this.stand.add(mesh(new THREE.CylinderGeometry(2, 2, 2.4, 24), MAT.paint(0x1f2937), 0, -4, 0));
    this.sensor = mesh(new THREE.CylinderGeometry(0.8, 0.8, 4, 16), MAT.paint(0x24303c), 9, TOP - 1, 0); rig.add(this.sensor);
    app.addComponent(new Component({
      key: 'rig', name: '悬浮装置', zone: 'none', fixed: true, required: true, object: rig, labelY: 40,
      icon: SVG('<path d="M14 6h36v8H14zM14 14v10M50 14v10"/><rect x="12" y="30" width="40" height="5"/><path d="M32 6V2" stroke="#b3261e"/>'),
      desc: `U 形铁芯每极截面 3 cm × 3 cm，线圈 600 匝（电阻 ${RC} Ω），磁轭里嵌有永磁体（红色）。浮子质量 ${this.m.toFixed(3)} kg（已称，不含砝码），当地重力加速度 9.80 m/s²。静力测量时浮子固定在测微台上，气隙由测微台读出，吸力由下面的拉压力传感器读出（已扣除浮子重力）。悬浮时测微台降下，浮子由控制器托住；没有托住时落在 12 mm 处的托架上。`,
      controls: () => [
        { type: 'segment', label: '工作方式', options: [{ value: 'static', label: '静力测量' }, { value: 'lev', label: '悬浮' }], get: () => this.mode, set: (v) => { if (v === this.mode) return; if (v === 'lev') this.liftOff(); else { this.mode = 'static'; this.ring = null; this.cap = null; } app.renderInspector(); app.changed(); } },
        ...(this.mode === 'static' ? [
          { type: 'knob', label: '气隙 g（测微台）', get: () => this.gStat, set: (v) => { this.gStat = Math.round(clamp(v, 3, 14) * 100) / 100; app.changed(); }, min: 3, max: 14, step: 0.01, bigStep: 0.5, perRev: 1, digits: 2, unit: 'mm' },
          { type: 'knob', label: '线圈电流（恒流源）', get: () => this.iStat, set: (v) => { this.iStat = Math.round(clamp(v, -2, 2) * 1000) / 1000; app.changed(); }, min: -2, max: 2, step: 0.001, bigStep: 0.1, perRev: 0.5, digits: 3, unit: 'A' },
          { type: 'readout', label: '吸力 F', get: () => `${this.Fread().toFixed(3)} N` },
        ] : [
          { type: 'segment', label: '附加砝码', options: DMS.map((d) => ({ value: d, label: `${d} g` })), get: () => this.dm, set: (v) => { this.dm = v; this.ring = null; this.calm = 0; app.changed(); } },
          { type: 'button', label: '重新起浮', onClick: () => { this.liftOff(); app.changed(); } },
          { type: 'button', label: '轻敲浮子（测振荡）', onClick: () => this.tap() },
        ]),
      ],
    }));
    // 控制器与仪表
    const gm = (this.gBox = meterBox(16, 9, 10, '气隙')); gm.group.position.set(14, 0, -14);
    const im = (this.iBox = meterBox(16, 9, 10, '线圈电流')); im.group.position.set(32, 0, -14);
    const ctrlG = new THREE.Group().add(gm.group, im.group); scene.add(ctrlG);
    app.addComponent(new Component({
      key: 'ctrl', name: '控制器', zone: 'none', fixed: true, object: ctrlG, labelY: 12,
      icon: SVG('<rect x="6" y="8" width="52" height="24"/><circle cx="20" cy="20" r="5"/><circle cx="40" cy="20" r="5"/>'),
      desc: '数字 PID 控制器。定位方式：电流 = K_p·Δg + K_d·Δg′ + K_i∫Δg（K_i = K_p/5 s⁻¹），把浮子保持在设定气隙。零功率方式：去掉位置积分，改为把设定气隙按线圈电流的积分慢慢移动，直到线圈电流为零——浮子停在永磁吸力恰好等于重力的位置。比例增益太小时无法悬浮。',
      controls: () => [
        { type: 'segment', label: '控制方式', options: [{ value: 'pos', label: '定位（PID）' }, { value: 'zp', label: '零功率' }], get: () => this.cmode, set: (v) => { if (v === this.cmode) return; this.cmode = v; if (v === 'pos') { this.s.I = this.s.i / (this.ctrl().Ki || 1); this.s.gs = this.s.g; } this.ring = null; this.calm = 0; app.changed(); } },
        { type: 'knob', label: '比例增益 K_p', get: () => this.Kp, set: (v) => { this.Kp = Math.round(clamp(v, 0.1, 1.5) * 100) / 100; this.ring = null; this.calm = 0; app.changed(); }, min: 0.1, max: 1.5, step: 0.01, bigStep: 0.1, perRev: 0.5, digits: 2, unit: 'A/mm' },
        { type: 'knob', label: '微分增益 K_d', get: () => this.Kd, set: (v) => { this.Kd = Math.round(clamp(v, 0, 3) * 100) / 100; this.ring = null; this.calm = 0; app.changed(); }, min: 0, max: 3, step: 0.01, bigStep: 0.1, perRev: 0.5, digits: 2, unit: 'A·s/m' },
        { type: 'knob', label: '设定气隙（定位方式）', get: () => this.gset, set: (v) => { this.gset = Math.round(clamp(v, 4, 10) * 100) / 100; this.calm = 0; app.changed(); }, min: 4, max: 10, step: 0.01, bigStep: 0.5, perRev: 1, digits: 2, unit: 'mm' },
        { type: 'readout', label: '线圈功耗', get: () => `${(this.iRead() ** 2 * RC).toFixed(3)} W` },
        { type: 'readout', label: '振荡测量', get: () => this.ringText() },
      ],
    }));
    this.view = app.addView({ id: 'gap', title: '气隙–时间（电涡流传感器）', w: 300, h: 200, res: 1.6 });
  }
  ringText() { if (this.cap) return '记录中…'; const r = this.ring; if (!r) return '—（轻敲浮子开始测量）'; if (r.fail) return '没有测到衰减振荡'; return `f_d = ${r.fd.toFixed(3)} Hz，峰值比 ${r.r.toFixed(3)}`; }
  update() {
    const lev = this.mode === 'lev', gmm = lev ? this.s.g * 1000 : this.gStat;
    this.flo.position.y = this.floY(gmm);
    this.wts.forEach((w, k) => (w.visible = lev && this.dm >= (k + 1) * 50));
    this.stand.visible = !lev; this.stand.position.y = this.floY(gmm) - 2.8;
    const g = lev ? (this.contact === -1 ? '吸附' : this.contact === 1 && !this.ramp ? '落下' : this.gRead().toFixed(3)) : this.gStat.toFixed(2);
    if (g !== this._g) { this._g = g; this.gBox.setText(g, /\d/.test(g) ? 'mm' : '', lev ? (this.cmode === 'pos' ? '悬浮 · 定位' : '悬浮 · 零功率') : '测微台'); }
    const i = this.iRead().toFixed(3), sub = lev ? `功耗 ${(this.iRead() ** 2 * RC).toFixed(2)} W` : `吸力 ${this.Fread().toFixed(3)} N`;
    if (i + sub !== this._i) { this._i = i + sub; this.iBox.setText(i, 'A', sub); }
    this.draw();
  }
  draw() {
    const v = this.view, c = v.ctx, W = v.W, Hh = v.H, pl = W * 0.13, pb = Hh * 0.1, pt = Hh * 0.06;
    c.fillStyle = '#f3f4f2'; c.fillRect(0, 0, W, Hh);
    c.strokeStyle = 'rgba(54,69,79,.15)'; c.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = pl + ((W - pl) * k) / 4; c.beginPath(); c.moveTo(x, pt); c.lineTo(x, Hh - pb); c.stroke(); }
    if (this.mode !== 'lev' || !this.trace.length) { v.foot('静力测量方式：浮子固定在测微台上'); return; }
    const t1 = this.tt, t0 = t1 - 2, gc = this.s.gs, tr = this.trace;
    let span = 0.05e-3; for (const p of tr) span = Math.max(span, Math.abs(p[1] - gc) * 1.15);
    span = Math.min(span, 8e-3);
    const Xp = (t) => pl + ((t - t0) / 2) * (W - pl), Yp = (g) => pt + (0.5 + (g - gc) / (2 * span)) * (Hh - pt - pb);
    c.strokeStyle = 'rgba(54,69,79,.35)'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(pl, Yp(gc)); c.lineTo(W, Yp(gc)); c.stroke(); c.setLineDash([]);
    c.strokeStyle = '#2b5876'; c.lineWidth = 1.8; c.beginPath();
    tr.forEach((p, k) => (k ? c.lineTo(Xp(p[0]), Yp(p[1])) : c.moveTo(Xp(p[0]), Yp(p[1])))); c.stroke();
    c.fillStyle = '#36454f'; c.font = `${Hh * 0.055}px Consolas, monospace`; c.textAlign = 'right';
    c.fillText(`+${(span * 1e3).toFixed(3)}`, pl - 4, pt + 8); c.fillText((gc * 1e3).toFixed(2), pl - 4, Yp(gc) + 4); c.fillText(`−${(span * 1e3).toFixed(3)}`, pl - 4, Hh - pb);
    v.foot(`气隙/mm · 时间窗 2 s · ${this.ringText()}`);
  }

  // ======================= 数据表 =======================
  tables() {
    const tf = (r) => 0.002 * Math.abs(r) + 0.002;
    return [
      {
        id: 'Fi', title: '吸力与电流（g = 6.00 mm）', maxRows: 12,
        columns: [{ key: 'i', label: '电流 i/A', digits: 3, auto: true }, { key: 'F', label: '吸力 F/N', digits: 3, readTol: tf }],
        buttons: [{ label: '记录', onClick: (t) => this.recFi(t) }],
        note: '静力测量方式，测微台调到 6.00 mm，电流从 −1.5 A 到 +1.5 A 每隔 0.5 A 测一次。负电流削弱永磁体的磁通。',
      },
      {
        id: 'Fg', title: '吸力与气隙（i = 0）', maxRows: 12,
        columns: [{ key: 'g', label: '气隙 g/mm', digits: 2, auto: true }, { key: 'F', label: '吸力 F/N', digits: 3, readTol: tf }],
        buttons: [{ label: '记录', onClick: (t) => this.recFg(t) }],
        note: '线圈电流为零，只有永磁体的吸力。气隙取 4–12 mm。',
      },
      {
        id: 'zp', title: '零功率悬浮', maxRows: 8,
        columns: [{ key: 'dm', label: '附加砝码/g', digits: 0, auto: true }, { key: 'g', label: '悬浮气隙/mm', digits: 3, readTol: 0.004 }, { key: 'i', label: '线圈电流/A', digits: 3, readTol: 0.003 }],
        buttons: [{ label: '记录', onClick: (t) => this.recZp(t) }],
        note: '悬浮、零功率方式，稳定后记录气隙和电流；再逐个加砝码。',
      },
      {
        id: 'osc', title: '闭环振荡（定位于 6.00 mm，不加砝码）', maxRows: 10,
        columns: [{ key: 'Kp', label: 'K_p/(A/mm)', digits: 2, auto: true }, { key: 'i', label: '平衡电流/A', digits: 3, auto: true }, { key: 'fd', label: '振荡频率 f_d/Hz', digits: 3, readTol: 0.01 }, { key: 'r', label: '相邻峰值比', digits: 3, readTol: 0.01 }],
        buttons: [{ label: '记录', onClick: (t) => this.recOsc(t) }],
        note: '定位方式，设定气隙 6.00 mm，K_d 保持不变。改变 K_p，每次稳定后轻敲浮子，读出衰减振荡的频率和相邻峰值比。',
      },
    ];
  }
  recFi(t) {
    const a = this.app;
    if (this.mode !== 'static') return a.toast('改到"静力测量"方式', 'warn');
    if (Math.abs(this.gStat - 6) > 0.005) return a.toast('测微台要调到 6.00 mm', 'warn');
    if (t.rows.some((r) => Math.abs(r.i - this.iStat) < 0.01)) return a.toast('这个电流已经测过了', 'warn');
    t.addRow({ i: this.iStat, F: this.Fread() });
  }
  recFg(t) {
    const a = this.app;
    if (this.mode !== 'static') return a.toast('改到"静力测量"方式', 'warn');
    if (Math.abs(this.iStat) > 0.0005) return a.toast('线圈电流要调到 0', 'warn');
    if (t.rows.some((r) => Math.abs(r.g - this.gStat) < 0.05)) return a.toast('这个气隙已经测过了', 'warn');
    t.addRow({ g: this.gStat, F: this.Fread() });
  }
  recZp(t) {
    const a = this.app;
    if (!this.levitating()) return a.toast('浮子没有悬浮起来', 'warn');
    if (this.cmode !== 'zp') return a.toast('控制方式要选"零功率"', 'warn');
    if (!this.steady()) return a.toast('还没有稳定：等线圈电流回到零、气隙不再变化', 'warn');
    if (t.rows.some((r) => r.dm === this.dm)) return a.toast('这个负载已经测过了', 'warn');
    t.addRow({ dm: this.dm, g: this.gRead(), i: this.iRead() });
  }
  recOsc(t) {
    const a = this.app, r = this.ring;
    if (this.mode !== 'lev' || this.cmode !== 'pos') return a.toast('要在悬浮、定位方式下测', 'warn');
    if (Math.abs(this.gset - 6) > 0.005 || this.dm) return a.toast('设定气隙 6.00 mm、不加砝码', 'warn');
    if (!r || r.fail) return a.toast('先等浮子稳定，再轻敲浮子测一次振荡', 'warn');
    if (t.rows.length && Math.abs(t.rows[0]._Kd - r.Kd) > 1e-9) return a.toast(`K_d 要和第一行相同（${t.rows[0]._Kd}）`, 'warn');
    if (t.rows.some((x) => Math.abs(x.Kp - r.Kp) < 0.005)) return a.toast('这个 K_p 已经测过了', 'warn');
    t.addRow({ Kp: r.Kp, i: Math.round(r.i * 1000) / 1000, fd: +r.fd.toFixed(3), r: +r.r.toFixed(3), _Kd: r.Kd });
  }

  // ======================= 自动操作 =======================
  async seg(comp, key, v) { const a = this.app; a.select(a.comp(comp)); if (this[key] !== v) { this[key] = v; this.calm = 0; a.renderInspector(); a.changed(); await a.wait(120); } }
  async adj(comp, key, to, ms = 250) { const a = this.app; a.select(a.comp(comp)); if (Math.abs(this[key] - to) > 1e-9) await a.tween(() => this[key], (v) => (this[key] = v), to, ms); this[key] = to; this.calm = 0; a.changed(); await a.wait(60); }
  async toStatic() { const a = this.app; a.select(a.comp('rig')); if (this.mode !== 'static') { this.mode = 'static'; this.ring = null; this.cap = null; a.renderInspector(); a.changed(); await a.wait(150); } }
  async toLev() {
    const a = this.app; a.select(a.comp('rig'));
    if (this.Kp < 0.45) await this.adj('ctrl', 'Kp', 0.8);
    if (this.Kd < 0.5) await this.adj('ctrl', 'Kd', 1.0);
    if (this.mode !== 'lev' || !this.levitating()) { this.liftOff(); a.renderInspector(); a.changed(); }
    await a.until(() => this.levitating() && !this.ramp, 20000);
  }
  steps() {
    const app = this.app, rows = (id) => app.table(id).completeRows();
    return [
      {
        title: '吸力与线圈电流',
        html: '<p>静力测量方式，测微台调到 6.00 mm。线圈电流从 −1.5 A 到 +1.5 A，每隔 0.5 A 记下吸力。</p>',
        hint: '电流为零时仍有相当大的吸力——这是永磁体提供的偏置磁通。正电流使磁通增强，负电流使磁通减弱。',
        status: () => `已测 ${rows('Fi').length} 点`,
        check: () => rows('Fi').length >= 5,
        auto: async () => {
          app.showTable(0); await app.view('悬浮装置'); await this.toStatic(); await this.adj('rig', 'gStat', 6, 300);
          for (const i of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) { if (rows('Fi').some((r) => Math.abs(r.i - i) < 0.01)) continue; await this.adj('rig', 'iStat', i, 200); await app.record('Fi', 0); }
          await this.adj('rig', 'iStat', 0, 200);
        },
      },
      {
        title: '吸力与气隙',
        html: '<p>线圈电流调到零，气隙依次取 4、5、6、7、8、10、12 mm，记下永磁体单独产生的吸力。</p>',
        status: () => `已测 ${rows('Fg').length} 点`,
        check: () => rows('Fg').length >= 5,
        auto: async () => {
          app.showTable(1); await app.view('悬浮装置'); await this.toStatic(); await this.adj('rig', 'iStat', 0, 200);
          for (const g of [4, 5, 6, 7, 8, 10, 12]) { if (rows('Fg').some((r) => Math.abs(r.g - g) < 0.05)) continue; await this.adj('rig', 'gStat', g, 200); await app.record('Fg', 0); }
        },
      },
      {
        title: '零功率悬浮',
        html: '<p>改为悬浮方式，控制方式选"零功率"（$K_p$ = 0.8 A/mm，$K_d$ = 1.0 A·s/m）。浮子稳定后记录气隙和线圈电流；再依次加 50、100、150、200 g 砝码，每次稳定后记录。</p>',
        hint: '零功率控制把浮子移到永磁吸力恰好等于重力的位置，线圈只在受扰动时短暂通电。负载加重，浮子要上移（气隙减小）才能得到更大的吸力。',
        status: () => `已测 ${rows('zp').length} 个负载`,
        check: () => rows('zp').length >= 3,
        auto: async () => {
          app.showTable(2); await app.view('全景'); await this.seg('ctrl', 'cmode', 'zp'); await this.toLev();
          for (const dm of DMS) {
            if (rows('zp').some((r) => r.dm === dm)) continue;
            await this.seg('rig', 'dm', dm); await app.until(() => this.steady(), 30000); await app.record('zp', 0);
          }
          await this.seg('rig', 'dm', 0);
        },
      },
      {
        title: '闭环振荡与刚度',
        html: '<p>改为定位方式，设定气隙 6.00 mm，不加砝码，$K_d$ 保持 1.0 A·s/m。$K_p$ 依次取 0.5、0.6、0.8、1.0、1.2 A/mm，每次稳定后轻敲浮子，记下衰减振荡的频率 $f_d$ 和相邻峰值比。</p>',
        hint: '$K_p$ 越大，"电磁弹簧"越硬，振荡频率越高。$K_p$ 小于 $k_x/k_i$（约 0.3 A/mm）时浮子无法悬浮——永磁体的负刚度胜过了控制的正刚度。',
        status: () => `已测 ${rows('osc').length} 个 K_p`,
        check: () => rows('osc').length >= 4,
        auto: async () => {
          app.showTable(3); await app.view('全景');
          await this.seg('rig', 'dm', 0); await this.adj('ctrl', 'gset', 6, 200);
          const Kd0 = rows('osc')[0]?._Kd ?? 1.0;
          await this.adj('ctrl', 'Kd', Kd0, 200);
          if (this.cmode !== 'pos') { app.select(app.comp('ctrl')); this.cmode = 'pos'; this.calm = 0; this.s.I = this.s.i / this.ctrl().Ki; this.s.gs = this.s.g; app.renderInspector(); app.changed(); }
          await this.toLev();
          for (const Kp of [0.5, 0.6, 0.8, 1.0, 1.2]) {
            if (rows('osc').some((r) => Math.abs(r.Kp - Kp) < 0.005)) continue;
            await this.adj('ctrl', 'Kp', Kp, 200);
            if (!this.levitating()) await this.toLev();
            await app.until(() => this.steady(), 30000);
            app.select(app.comp('rig')); this.tap(); await app.until(() => this.ring && !this.cap, 20000);
            await app.record('osc', 0);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>由 $\\sqrt F$–$i$ 直线求永磁体的等效电流，由 $1/\\sqrt F$–$g$ 直线求等效气隙；比较零功率间隙的测量值与预测值；由 $\\omega_n^2$–$K_p$ 直线求负刚度和电流刚度。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, FI = a.table('Fi').completeRows(), FG = a.table('Fg').completeRows(), ZP = a.table('zp').completeRows(), OS = a.table('osc').completeRows();
    if (FI.length + FG.length + ZP.length + OS.length < 2) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = ''; const answers = [], plots = [];
    let i0 = null, dl = null, fg = null;
    if (FI.length >= 3) {
      const f = linFit(FI.map((r) => r.i), FI.map((r) => Math.sqrt(r.F))); i0 = f.b / f.k;
      html += `<h3>1. 吸力与电流</h3><p>$F\\propto(i+i_0)^2$，所以 $\\sqrt F$ 与 $i$ 成直线：斜率 ${f.k.toFixed(4)} N<sup>1/2</sup>/A，截距 ${f.b.toFixed(4)} N<sup>1/2</sup>（r = ${f.r.toFixed(6)}）。</p>
        <div class="result-box">永磁体等效电流 $i_0=\\dfrac{\\text{截距}}{\\text{斜率}}=${i0.toFixed(3)}$ A，等效磁动势 $Ni_0$ = ${(600 * i0).toFixed(0)} A</div><p>仿真设定值 ${this.p.i0.toFixed(3)} A，相对误差 ${pct(relErr(i0, this.p.i0))}。要用纯电磁铁得到同样的吸力，线圈需要一直通 ${i0.toFixed(2)} A 的电流，功耗 ${(i0 * i0 * RC).toFixed(1)} W。</p>`;
      answers.push({ label: '永磁体等效电流 $i_0$', unit: 'A', value: i0, digits: 3, tolRel: 0.01 });
      plots.push({ title: '√F – i', xLabel: 'i / A', yLabel: '√F / N^½', series: [{ type: 'scatter', data: FI.map((r) => [r.i, Math.sqrt(r.F)]), label: '实验点' }, { type: 'line', data: [-i0, Math.max(...FI.map((r) => r.i))].map((x) => [x, f.k * x + f.b]), label: '拟合' }] });
    }
    if (FG.length >= 3) {
      fg = linFit(FG.map((r) => r.g), FG.map((r) => 1 / Math.sqrt(r.F))); dl = (2 * fg.b) / fg.k;
      html += `<h3>2. 吸力与气隙</h3><p>$F\\propto(2g+\\delta)^{-2}$，所以 $1/\\sqrt F$ 与 $g$ 成直线：斜率 ${fg.k.toFixed(5)}，截距 ${fg.b.toFixed(5)}（r = ${fg.r.toFixed(6)}）。</p>
        <div class="result-box">等效气隙 $\\delta=\\dfrac{2\\times\\text{截距}}{\\text{斜率}}=${dl.toFixed(2)}$ mm</div><p>它是永磁体（相对磁导率接近 1）和铁芯磁阻折合成的气隙长度。仿真设定值 ${(this.p.delta * 1000).toFixed(2)} mm，相对误差 ${pct(relErr(dl, this.p.delta * 1000))}。</p>`;
      answers.push({ label: '等效气隙 $\\delta$', unit: 'mm', value: dl, digits: 2, tolRel: 0.02 });
      plots.push({ title: '1/√F – g', xLabel: 'g / mm', yLabel: '1/√F / N^-½', series: [{ type: 'scatter', data: FG.map((r) => [r.g, 1 / Math.sqrt(r.F)]), label: '实验点' }, { type: 'line', data: [3, 13].map((x) => [x, fg.k * x + fg.b]), label: '拟合' }] });
    }
    if (ZP.length) {
      const rows = ZP.slice().sort((x, y) => x.dm - y.dm);
      const pred = (dm) => (fg ? (1 / Math.sqrt((this.m + dm / 1000) * GRAV) - fg.b) / fg.k : null);
      html += `<h3>3. 零功率悬浮</h3><table><tr><th>砝码/g</th>${rows.map((r) => `<td>${r.dm}</td>`).join('')}</tr><tr><th>气隙/mm</th>${rows.map((r) => `<td>${r.g.toFixed(3)}</td>`).join('')}</tr>${fg ? `<tr><th>由静力曲线预测/mm</th>${rows.map((r) => `<td>${pred(r.dm).toFixed(3)}</td>`).join('')}</tr>` : ''}<tr><th>电流/A</th>${rows.map((r) => `<td>${r.i.toFixed(3)}</td>`).join('')}</tr></table>
        <p>稳定后线圈电流都在零附近，浮子完全由永磁体托住，线圈几乎不耗电。负载越重，浮子停得越高（气隙越小）。${fg ? '预测值由第 2 部分的直线令 $F=(m+\\Delta m)g$ 求得，与测量值吻合。' : ''}</p>`;
    }
    if (OS.length >= 3) {
      const pts = OS.map((r) => { const s = r.fd * Math.log(r.r); return { Kp: r.Kp * 1000, w2: (2 * Math.PI * r.fd) ** 2 + s * s }; });
      const f = linFit(pts.map((x) => x.Kp), pts.map((x) => x.w2)), ki = f.k * this.m, kx = -f.b * this.m, ieq = mean(OS.map((r) => r.i));
      const tru = linCoef(GSET, eqCurrent(GSET, this.m * GRAV, this.p), this.p);
      html += `<h3>4. 闭环振荡与刚度</h3><p>浮子受扰动后作衰减振荡。由振荡频率 $f_d$ 和相邻峰值比 $\\rho$ 得衰减系数 $\\sigma=f_d\\ln\\rho$，无阻尼固有角频率 $\\omega_n^2=(2\\pi f_d)^2+\\sigma^2$。$\\omega_n^2=(k_iK_p-k_x)/m$，与 $K_p$ 成直线：斜率 ${f.k.toFixed(4)} m/(A·s²)，截距 ${f.b.toFixed(1)} s⁻²（r = ${f.r.toFixed(6)}）。</p>
        <div class="result-box">电流刚度 $k_i=m\\times\\text{斜率}=${ki.toFixed(3)}$ N/A；负刚度 $k_x=-m\\times\\text{截距}=${(kx / 1000).toFixed(3)}$ N/mm</div>
        <p>与工作点（6.00 mm，${ieq.toFixed(3)} A）的模型值 $k_i$ = ${tru.ki.toFixed(3)} N/A、$k_x$ = ${(tru.kx / 1000).toFixed(3)} N/mm 比较，相对偏差分别为 ${pct(relErr(ki, tru.ki))} 和 ${pct(relErr(kx, tru.kx))}。</p>`;
      if (i0 != null && dl != null) {
        const F = this.m * GRAV, kxs = (4 * F) / (2 * GSET + dl / 1000), kis = (2 * F) / (ieq + i0);
        html += `<p>由静力测量推算：$k_x=\\dfrac{4F}{2g+\\delta}$ = ${(kxs / 1000).toFixed(3)} N/mm，$k_i=\\dfrac{2F}{i+i_0}$ = ${kis.toFixed(3)} N/A（$F=mg$）。静态和动态两种方法得到的刚度一致，说明线性化模型在小振幅下成立。能稳定悬浮的最小比例增益 $K_p=k_x/k_i$ ≈ ${(kx / ki / 1000).toFixed(3)} A/mm。</p>`;
      }
      answers.push({ label: '电流刚度 $k_i$', unit: 'N/A', value: ki, digits: 3, tolRel: 0.01 }, { label: '负刚度 $k_x$', unit: 'N/mm', value: kx / 1000, digits: 3, tolRel: 0.01 });
      plots.push({ title: 'ω_n² – K_p', xLabel: 'K_p / (A/m)', yLabel: 'ω_n² / s⁻²', series: [{ type: 'scatter', data: pts.map((x) => [x.Kp, x.w2]), label: '实验点' }, { type: 'line', data: [kx / ki, Math.max(...pts.map((x) => x.Kp))].map((x) => [x, f.k * x + f.b]), label: '拟合' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 混合磁路与吸力</h3><p>U 形铁芯、两段气隙和浮子构成闭合磁路，永磁体串在磁路中，相当于一个磁动势 $Ni_0$，其内阻（永磁体的相对磁导率接近 1）折合成气隙长度 $\\delta$。线圈电流 $i$ 与永磁体的磁动势叠加，磁通 $\\Phi=\\mu_0AN(i+i_0)/(2g+\\delta)$，两极吸力之和</p>$$F=\\frac{\\Phi^2}{\\mu_0A}=\\frac{\\mu_0AN^2(i+i_0)^2}{(2g+\\delta)^2}$$
<h3>2. 不稳定性与控制</h3><p>吸力随气隙减小而增大：浮子稍微上移，吸力变大，继续上移——这相当于一根"负刚度"的弹簧，$k_x=-\\partial F/\\partial g=4F/(2g+\\delta)$。控制器测出气隙偏差，调节电流产生回复力，电流刚度 $k_i=\\partial F/\\partial i=2F/(i+i_0)$。比例–微分控制下</p>$$m\\Delta\\ddot g+k_iK_d\\Delta\\dot g+(k_iK_p-k_x)\\Delta g=0$$<p>$K_p>k_x/k_i$ 时等效刚度为正，浮子可以稳定悬浮，固有角频率 $\\omega_n^2=(k_iK_p-k_x)/m$。</p>
<h3>3. 零功率控制</h3><p>平衡时若线圈电流不为零，就要持续耗电。零功率控制让设定气隙按电流的积分缓慢移动，直到电流为零——浮子停在永磁吸力恰好等于重力的位置 $g_0$，线圈只在受扰动时短暂通电。这正是混合悬浮的优点。</p>
<h3>4. 本仿真的计算模型</h3><p>吸力按上式计算（不计漏磁和铁芯饱和）；浮子运动以 0.1 ms 步长积分，功率放大器为 0.3 ms 的一阶惯性并限幅 ±3 A，控制器的积分时间为 5 s。永磁体等效电流、等效气隙和浮子质量个体随机。</p>`;
  }
}
