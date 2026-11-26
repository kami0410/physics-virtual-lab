// 实验：磁耦合谐振式无线输电
// 两只相同的平面螺旋线圈（8 匝，内半径 5.0 cm，匝距 5 mm，利兹线等效半径 0.75 mm）正对放在导轨上，间距 d 可调。
// 发射回路：信号源 + 功率放大器（正弦 1.0 V 峰值，输出电阻 1 Ω）串联电容 C₁（标称 10.00 nF，实际 ±0.5%）和发射线圈；
// 接收回路：接收线圈串联固定电容 C₂（比 C₁ 小 2%–4%）+ 微调电容 C_t（0–800 pF）和负载电阻 R_L；也可以拆下电容与负载，测开路感应电压。
// 线圈自感、互感由几何尺寸按诺依曼公式算出（自感另有 ±2% 的制作偏差），电路按相量法求正弦稳态（physics/wpt.js，
// 结果与 spice-ts 的交流分析逐点核对过，见 tests/physics-tools.mjs）。
import * as THREE from 'three';
import { meta, thumb } from './wpt.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, clamp, relErr, pct, linFit } from '../core/Stats.js';
import { coilL, coilM, coilMoff, wptSolve, peaks } from '../physics/wpt.js';

const COIL = { N: 8, r0: 0.05, p: 0.005, rw: 0.00075 };
const C1N = 10e-9, VS = 1, RS = 1, F1 = 250, F2 = 750; // kHz
const RLS = [2, 5, 10, 20];
const SQ2 = Math.SQRT2;
const TXX = -22; // 发射线圈平面的位置（场景 x，cm）；导轨刻度从这里算起，读数就是间距 d
const AL_RHO = 0.2, AL_YAW = 1.5; // 对正的标准：横向偏 0.2 cm、转角 1.5° 以内
const SVG = (inner) => `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;

export class WptExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.Lg = coilL(COIL); this.L = this.Lg * (1 + rand(-0.02, 0.02));
    this.C1 = C1N * (1 + rand(-0.005, 0.005)); this.C2f = this.C1 * (1 - rand(0.02, 0.04));
    this.R1 = rand(0.25, 0.35); this.R2 = rand(0.25, 0.35);
    this.f = 400; this.open = false; this.trim = 0; this.RL = 5;
    this.rho = 0; this.yaw = 0; // 接收线圈的横向偏移（cm）和转角（°）
    this._mk = '';
  }
  /** 线圈间距 d（cm）：接收线圈滑座的导轨读数；不在导轨上时视为很远 */
  get d() { const c = this.app.comp && this.app.comp('rx'); return c && c.placed ? c.pos : 200; }
  set d(v) { const c = this.app.comp('rx'); if (c && c.placed) this.app.setRailPos(c, Math.round(v * 10) / 10); }
  get rxOn() { const c = this.app.comp && this.app.comp('rx'); return !!(c && c.placed); }
  aligned() { return Math.abs(this.rho) <= AL_RHO && Math.abs(this.yaw) <= AL_YAW; }
  /** 沿导轨方向目测接收线圈：只能看出大致的偏移和转角 */
  lookText() {
    const r = Math.round(this.rho * 2) / 2, y = Math.round(this.yaw / 2) * 2, out = [];
    if (Math.abs(r) >= 0.5) out.push(`中心偏${r > 0 ? '前' : '后'}约 ${Math.abs(r).toFixed(1)} cm`);
    if (Math.abs(y) >= 2) out.push(`线圈平面${y > 0 ? '逆' : '顺'}时针转了约 ${Math.abs(y)}°`);
    return out.length ? out.join('，') : '目测已基本同轴正对（更小的偏差要看接收电压是否最大）';
  }
  get f01() { return 1 / (2 * Math.PI * Math.sqrt(this.L * this.C1)) / 1e3; } // kHz
  get C2() { return this.C2f + this.trim * 1e-12; }
  /** 几何耦合系数（按接收线圈的实际位姿，数值诺依曼积分） */
  kAt(d, rho = this.rho, yaw = this.yaw) {
    if (d > 100) return 0;
    const key = `${d},${rho},${yaw}`;
    if (this._mk !== key) { this._mk = key; this._m = coilMoff(COIL, d / 100, rho / 100, (yaw * Math.PI) / 180, 32) / this.Lg; }
    return this._m;
  }
  par(over = {}) {
    const o = { open: this.open, d: this.d, RL: this.RL, ...over };
    return { Vs: VS, Rs: RS, R1: this.R1, R2: this.R2, f0r: 5e5, L1: this.L, L2: this.L, C1: this.C1, C2: this.C2, RL: o.RL, M: this.kAt(o.d) * this.L, open: o.open || !this.rxOn };
  }
  sol(f = this.f, over) { return wptSolve(f * 1e3, this.par(over)); }
  /** 仪表读数（有效值）：I₁ mA、U₂ mV、P₁ mW */
  reads() {
    const s = this.sol(), r4 = (v) => +v.toPrecision(4);
    return { I1: r4((s.I1 / SQ2) * 1e3), U2: r4((s.U2 / SQ2) * 1e3), P1: r4(s.P1 * 1e3), P2: s.P2 * 1e3 };
  }
  peakList() {
    const k = `${this.d},${this.open},${this.RL},${this.trim},${this.rho},${this.yaw},${this.rxOn}`;
    if (k !== this._pk) { this._pk = k; this._pl = peaks((f) => this.sol(f).U2, F1, F2, 400); }
    return this._pl;
  }
  f0rec() { const r = this.app.table('f0').rows[0]; return typeof r?.val === 'number' ? r.val : null; }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 56, 92], target: [0, 10, -2] }, { name: '线圈', pos: [-6, 26, 46], target: [-6, 12, 0] }, { name: '仪器', pos: [24, 30, 40], target: [24, 8, -16] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 86));
    app.stage.setLightTarget(0, 8, 0);
    const Y = 13, S = 100; // 场景单位：1 cm = 1
    const rail = new THREE.Group();
    rail.add(mesh(new THREE.BoxGeometry(72, 1.2, 5), MAT.alu(), 6, 0.6, 0));
    for (let x = -28; x <= 40; x += 1) { const dd = x - TXX; rail.add(mesh(new THREE.BoxGeometry(0.12, 0.05, dd % 10 === 0 ? 2.2 : dd % 5 === 0 ? 1.6 : 1.0), MAT.paint(0x222222), x, 1.23, 1.4)); }
    app.addRail({ id: 'wpt', origin: new THREE.Vector3(TXX, 0, 0), min: 3, max: 60, accepts: ['rx'] });
    const coilMesh = () => {
      const g = new THREE.Group(), pts = [];
      for (let t = 0; t <= COIL.N * 2 * Math.PI; t += 0.08) { const r = (COIL.r0 + (COIL.p * t) / (2 * Math.PI)) * S; pts.push(new THREE.Vector3(0, r * Math.sin(t), r * Math.cos(t))); }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 600, 0.12, 6), MAT.paint(0xb06a2c)));
      g.add(mesh(new THREE.CylinderGeometry(9.5, 9.5, 0.4, 48), new THREE.MeshStandardMaterial({ color: 0xe8e2d0, transparent: true, opacity: 0.35 }), -0.35, 0, 0).rotateZ(Math.PI / 2));
      g.add(mesh(new THREE.BoxGeometry(1.2, Y - 9, 3), MAT.paint(0x3a3f44), 0, -(Y - 9) / 2 - 9 + 0.6 + 0.4, 0));
      g.add(mesh(new THREE.BoxGeometry(4, 0.8, 5), MAT.paint(0x3a3f44), 0, -Y + 1.6, 0));
      g.position.y = Y; return g;
    };
    this.tx = coilMesh(); this.tx.position.x = TXX; rail.add(this.tx);
    app.addComponent(new Component({
      key: 'coils', name: '导轨与发射线圈', zone: 'none', fixed: true, required: true, object: rail, labelY: 26,
      icon: SVG('<ellipse cx="18" cy="20" rx="5" ry="14"/><path d="M4 36h56"/>'),
      desc: `发射线圈固定在导轨左端，与右面的信号源、电容 C₁ = 10.00 nF（标称）串联。线圈 ${COIL.N} 匝，内半径 ${(COIL.r0 * 100).toFixed(1)} cm，匝距 ${COIL.p * 1000} mm。导轨刻度的零点在发射线圈平面上，接收线圈滑座的读数就是两线圈的间距 d。`,
    }));
    // 接收线圈：导轨上的滑座，可横向微调和转动
    const rxG = new THREE.Group();
    this.rx = coilMesh(); this.rx.rotation.y = Math.PI; this.rx.position.x = 0; rxG.add(this.rx);
    this.bulbM = MAT.emissive(0xffd36b, 0);
    this.bulb = mesh(new THREE.SphereGeometry(1.1, 16, 12), this.bulbM, 4, 2.2, 7); rxG.add(this.bulb);
    this.rlBox = mesh(new THREE.BoxGeometry(6, 2.4, 3.4), MAT.paint(0x6b5a35), 4, 1.2, 7); rxG.add(this.rlBox);
    rxG.add(mesh(new THREE.BoxGeometry(5, 1, 6), MAT.paint(0x2d3338), 0, 1.7, 0));
    rxG.add(mesh(new THREE.BoxGeometry(0.15, 0.3, 2.6), MAT.paint(0xc41e3a), 0, 1.3, 1.6)); // 指针
    app.addComponent(new Component({
      key: 'rx', name: '接收线圈（滑座）', zone: 'rail', rail: 'wpt', defaultPos: 50, required: true, object: rxG, labelY: 24,
      icon: SVG('<ellipse cx="32" cy="20" rx="6" ry="15"/><path d="M20 36h24"/>'),
      desc: '与发射线圈相同。放上导轨后拖动滑座改变间距；线圈支架可以在滑座上横向移动、绕竖直轴转动——两线圈必须同轴正对，否则耦合变弱，测出的 k 偏离诺依曼公式。接收回路串联固定电容 C₂、微调电容 C_t（0–800 pF）和负载电阻 R_L（负载旁有指示灯）；也可以改成开路（拆下电容和负载），这时测到的是感应电动势。',
      controls: () => [
        { type: 'knob', label: '支架横向位置', get: () => this.rho, set: (v) => { this.rho = Math.round(clamp(v, -4, 4) * 100) / 100; }, step: 0.05, bigStep: 0.5, perRev: 2, fmt: () => '前后移动' },
        { type: 'knob', label: '支架转角', get: () => this.yaw, set: (v) => { this.yaw = Math.round(clamp(v, -30, 30) * 10) / 10; }, step: 0.2, bigStep: 2, perRev: 10, fmt: () => '绕竖直轴转' },
        { type: 'readout', label: '沿导轨方向看', get: () => this.lookText() },
        { type: 'segment', label: '接收回路', options: [{ value: false, label: '谐振（接 C₂、C_t、R_L）' }, { value: true, label: '开路（测感应电压）' }], get: () => this.open, set: (v) => { this.open = v; app.changed(); } },
        { type: 'knob', label: '微调电容 C_t', get: () => this.trim, set: (v) => { this.trim = Math.round(clamp(v, 0, 800)); app.changed(); }, min: 0, max: 800, step: 1, bigStep: 20, perRev: 100, digits: 0, unit: 'pF' },
        { type: 'segment', label: '负载电阻 R_L', options: RLS.map((r) => ({ value: r, label: `${r} Ω` })), get: () => this.RL, set: (v) => { this.RL = v; app.changed(); } },
      ],
    }));
    // 信号源与仪表
    const gen = (this.gBox = meterBox(18, 9, 12, '信号源 + 功放')); gen.group.position.set(-34, 0, -20); scene.add(gen.group);
    app.addComponent(new Component({
      key: 'gen', name: '信号源与功率放大器', zone: 'none', fixed: true, required: true, object: gen.group, labelY: 11,
      icon: SVG('<rect x="6" y="8" width="52" height="24"/><path d="M14 20q4-8 8 0t8 0 8 0"/>'),
      desc: '正弦信号经功率放大器输出，峰值 1.0 V，输出电阻 1 Ω。频率 250–750 kHz，分辨率 10 Hz。',
      controls: () => [
        { type: 'knob', label: '频率', get: () => this.f, set: (v) => { this.f = Math.round(clamp(v, F1, F2) * 100) / 100; app.changed(); }, min: F1, max: F2, step: 0.01, bigStep: 1, perRev: 10, digits: 2, unit: 'kHz' },
      ],
    }));
    const im = (this.iBox = meterBox(16, 9, 10, '发射电流 / 功率')); im.group.position.set(-10, 0, -22); scene.add(im.group);
    const um = (this.uBox = meterBox(16, 9, 10, '接收电压')); um.group.position.set(10, 0, -22); scene.add(um.group);
    const meters = new THREE.Group().add(im.group, um.group); scene.add(meters);
    app.addComponent(new Component({
      key: 'meter', name: '测量仪表', zone: 'none', fixed: true, object: meters, labelY: 11,
      desc: '发射回路串有高频电流探头，功率分析仪给出发射电流有效值 I₁ 和送入发射回路的平均功率 P₁；接收电压表测负载（或开路时线圈两端）电压的有效值 U₂。右上的扫频窗口显示 U₂ 随频率的变化，并自动标出峰值频率。',
      controls: () => [{ type: 'readout', label: '发射电流 I₁', get: () => `${this.reads().I1} mA` }, { type: 'readout', label: '输入功率 P₁', get: () => `${this.reads().P1} mW` }, { type: 'readout', label: '接收电压 U₂', get: () => `${this.reads().U2} mV` }, { type: 'readout', label: '扫频峰值', get: () => this.peakList().map((f) => `${f.toFixed(1)} kHz`).join('、') || '—' }],
    }));
    this.view = app.addView({ id: 'sweep', title: '扫频：U₂ – f', w: 300, h: 200, res: 1.6 });
  }
  onPlace(c) {
    if (c.key === 'rx') {
      const s = () => (Math.random() < 0.5 ? -1 : 1);
      this.rho = Math.round(s() * rand(0.8, 2.2) * 100) / 100; this.yaw = Math.round(s() * rand(4, 12) * 10) / 10;
    }
  }
  update() {
    this.rx.position.z = this.rho; this.rx.rotation.y = Math.PI + (this.yaw * Math.PI) / 180;
    const r = this.reads();
    this.bulbM.emissiveIntensity = this.open ? 0 : Math.min(4, r.P2 / 20);
    const g = `${this.f.toFixed(2)}`; if (g !== this._g) { this._g = g; this.gBox.setText(g, 'kHz', '正弦 1.0 V 峰值'); }
    const i = `${r.I1}|${r.P1}`; if (i !== this._i) { this._i = i; this.iBox.setText(String(r.I1), 'mA', `P₁ = ${r.P1} mW`); }
    const u = `${r.U2}|${this.open}`; if (u !== this._u) { this._u = u; this.uBox.setText(String(r.U2), 'mV', this.open ? '开路（感应电压）' : `负载 R_L = ${this.RL} Ω`); }
    this.draw();
  }
  draw() {
    const v = this.view, g = v.ctx, W = v.W, H = v.H, pl = W * 0.1, pr = W * 0.03, pt = H * 0.08, pb = H * 0.14;
    const n = 220, ys = []; let ym = 0;
    for (let i = 0; i <= n; i++) { const y = this.sol(F1 + ((F2 - F1) * i) / n).U2; ys.push(y); ym = Math.max(ym, y); }
    g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, W, H);
    const X = (f) => pl + ((f - F1) / (F2 - F1)) * (W - pl - pr), Yy = (y) => H - pb - (y / (ym * 1.1)) * (H - pt - pb);
    g.strokeStyle = 'rgba(60,70,60,.18)'; g.lineWidth = 1;
    for (let f = 300; f < F2; f += 100) { g.beginPath(); g.moveTo(X(f), pt); g.lineTo(X(f), H - pb); g.stroke(); }
    g.fillStyle = '#3a4550'; g.font = `${H * 0.06}px Consolas, monospace`; g.textAlign = 'center';
    for (let f = 300; f < F2; f += 100) g.fillText(String(f), X(f), H - pb * 0.35);
    g.strokeStyle = '#2f6b3a'; g.lineWidth = 2; g.beginPath();
    ys.forEach((y, i) => { const x = X(F1 + ((F2 - F1) * i) / n); if (i) g.lineTo(x, Yy(y)); else g.moveTo(x, Yy(y)); }); g.stroke();
    g.strokeStyle = '#b3261e'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(this.f), pt); g.lineTo(X(this.f), H - pb); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#2f6b3a';
    for (const f of this.peakList()) { const y = this.sol(f).U2; g.beginPath(); g.moveTo(X(f), Yy(y) - 3); g.lineTo(X(f) - 4, Yy(y) - 10); g.lineTo(X(f) + 4, Yy(y) - 10); g.fill(); }
    v.foot(`f / kHz · 峰：${this.peakList().map((f) => f.toFixed(1)).join('、') || '—'}`);
  }

  // ======================= 数据表 =======================
  tables() {
    const t3 = (r) => 0.003 * Math.abs(r) + 0.01;
    return [
      {
        id: 'f0', title: '谐振频率与调谐', fixedRows: true,
        initRows: () => [{ what: '发射线圈谐振频率 f₀ / kHz（接收线圈远离）' }, { what: '接收回路微调电容 C_t / pF（调到 U₂ 最大）' }],
        columns: [{ key: 'what', label: '测量', type: 'text', readonly: true }, { key: 'val', label: '读数', readTol: 0.5 }],
        buttons: [{ label: '记录', onClick: (t) => this.recF0(t) }],
        note: '先把接收线圈移到 40 cm 以外，调频率使发射电流最大；再把接收线圈移到 20 cm 左右，频率不动，调微调电容使接收电压最大。',
      },
      {
        id: 'k', title: '互感法测耦合系数（接收开路）', maxRows: 14,
        columns: [{ key: 'd', label: 'd/cm', digits: 1, auto: true }, { key: 'I1', label: 'I₁/mA', readTol: t3 }, { key: 'U2', label: 'U₂/mV', readTol: t3 }],
        buttons: [{ label: '记录', onClick: (t) => this.recK(t) }],
        note: '接收回路改为开路，频率保持在 f₀，改变间距，记下发射电流和接收线圈的感应电压。',
      },
      {
        id: 'split', title: '频率分裂（谐振接法）', maxRows: 8,
        columns: [{ key: 'd', label: 'd/cm', digits: 1, auto: true }, { key: 'fL', label: '低频峰 f_L/kHz', digits: 1, auto: true }, { key: 'fH', label: '高频峰 f_H/kHz', digits: 1, auto: true }],
        buttons: [{ label: '记录扫频峰值', onClick: (t) => this.recSplit(t) }],
        note: '接收回路恢复谐振接法，线圈靠近到扫频曲线出现两个峰，记下两个峰的频率。',
      },
      {
        id: 'eff', title: '传输效率与距离（f = f₀）', maxRows: 16,
        columns: [{ key: 'd', label: 'd/cm', digits: 1, auto: true }, { key: 'I1', label: 'I₁/mA', readTol: t3 }, { key: 'P1', label: 'P₁/mW', readTol: t3 }, { key: 'U2', label: 'U₂/mV', readTol: t3 }],
        buttons: [{ label: '记录', onClick: (t) => this.recEff(t) }],
        note: '频率固定在 f₀，负载电阻不变，改变间距，记下输入功率和负载电压。',
      },
    ];
  }
  atF0() { const f0 = this.f0rec(); if (f0 == null) { this.app.toast('先测发射线圈的谐振频率 f₀', 'warn'); return false; } return true; }
  /** 频率偏离已测的 f₀ 时的问题说明 */
  offF0() { const f0 = this.f0rec(); return f0 != null && Math.abs(this.f - f0) > 0.05 ? `频率 ${this.f} kHz 不是 f₀ = ${f0} kHz` : null; }
  recF0(t) {
    const a = this.app, r0 = t.rows[0];
    if (typeof r0?.val !== 'number' || (r0._pend && r0._pend.val)) {
      const fl = [];
      if (this.d < 40) fl.push(`接收线圈只在 ${this.d} cm 处，它的耦合会使发射电流的峰偏移`);
      if (Math.abs(this.f - this.f01) / this.f01 > 0.0015) fl.push('发射电流还没有调到最大，这个频率不是谐振频率');
      t.set(0, 'val', this.f); return t.flagAll(0, fl);
    }
    if (!this.atF0()) return;
    const fl = [];
    if (this.open) fl.push('接收回路是开路，调微调电容不起作用');
    if (this.d > 30) fl.push('接收线圈太远，接收电压太小，最大值不好判断');
    const o = this.offF0(); if (o) fl.push(o);
    if (Math.abs(this.C2 - this.C1) / this.C1 > 0.004) fl.push('接收电压还没有调到最大，接收回路没有调谐到 f₀');
    t.set(1, 'val', this.trim); t.flagAll(1, fl);
  }
  tuned() { return Math.abs(this.C2 - this.C1) / this.C1 <= 0.004; }
  recK(t) {
    const a = this.app;
    if (!this.atF0()) return;
    if (t.rows.some((r) => Math.abs(r.d - this.d) < 0.05)) a.toast('这个间距已经测过了', 'warn');
    const fl = [];
    if (!this.open) fl.push('接收回路是谐振接法，U₂ 是负载电压而不是感应电动势，算出的 k 不对');
    const o = this.offF0(); if (o) fl.push(o);
    if (!this.aligned()) fl.push('两线圈没有同轴正对，耦合系数偏离诺依曼公式');
    const r = this.reads(); t.flagAll(t.addRow({ d: this.d, I1: r.I1, U2: r.U2 }), fl);
  }
  recSplit(t) {
    const a = this.app;
    if (this.open) a.toast('接收回路要用谐振接法', 'warn');
    const p = this.peakList();
    if (p.length < 2) return a.toast('扫频曲线只有一个峰：线圈再靠近一些', 'warn');
    if (t.rows.some((r) => Math.abs(r.d - this.d) < 0.05)) a.toast('这个间距已经测过了', 'warn');
    const fl = [];
    if (!this.tuned()) fl.push('接收回路没有调谐好，两个峰高低不等、位置也偏了');
    if (t.rows.length && t.rows[0]._RL !== this.RL) fl.push(`负载电阻和第一行（${t.rows[0]._RL} Ω）不同`);
    t.flagAll(t.addRow({ d: this.d, fL: Math.round(p[0] * 10) / 10, fH: Math.round(p.at(-1) * 10) / 10, _RL: this.RL }), fl);
  }
  recEff(t) {
    const a = this.app;
    if (this.open) a.toast('接收回路要用谐振接法', 'warn');
    if (!this.atF0()) return;
    if (t.rows.some((r) => Math.abs(r.d - this.d) < 0.05)) a.toast('这个间距已经测过了', 'warn');
    const fl = [];
    if (!this.tuned()) fl.push('接收回路没有调谐好，传输效率偏低');
    const o = this.offF0(); if (o) fl.push(o);
    if (t.rows.length && t.rows[0]._RL !== this.RL) fl.push(`负载电阻和第一行（${t.rows[0]._RL} Ω）不同`);
    if (!this.aligned()) fl.push('两线圈没有同轴正对');
    const r = this.reads(); t.flagAll(t.addRow({ d: this.d, I1: r.I1, P1: r.P1, U2: r.U2, _RL: this.RL }), fl);
  }

  // ======================= 自动操作 =======================
  async seg(comp, key, v) { const a = this.app; a.select(a.comp(comp)); if (this[key] !== v) { this[key] = v; a.renderInspector(); a.changed(); await a.wait(120); } }
  async adj(comp, key, to, ms = 250) { const a = this.app; a.select(a.comp(comp)); if (Math.abs(this[key] - to) > 1e-9) await a.tween(() => this[key], (v) => (this[key] = v), to, ms); this[key] = to; a.changed(); await a.wait(60); }
  async toF0() { const f0 = this.f0rec() ?? Math.round(this.f01 * 100) / 100; await this.adj('gen', 'f', f0, 200); }
  async tune() { if (!this.tuned()) await this.adj('rx', 'trim', Math.round((this.C1 - this.C2f) * 1e12), 300); }
  async alignRx() {
    const a = this.app; a.select(a.comp('rx'));
    if (Math.abs(this.rho) > 0.05) await this.adj('rx', 'rho', Math.round(rand(-0.05, 0.05) * 100) / 100, 400);
    if (Math.abs(this.yaw) > 0.3) await this.adj('rx', 'yaw', Math.round(rand(-0.3, 0.3) * 10) / 10, 400);
  }
  steps() {
    const app = this.app, rows = (id) => app.table(id).completeRows(), f0t = () => app.table('f0').rows;
    const has = (i) => typeof f0t()[i]?.val === 'number' && !(f0t()[i]._pend && f0t()[i]._pend.val);
    return [
      {
        title: '发射线圈的谐振频率',
        html: '<p>把接收线圈移到 40 cm 以外（耦合可以忽略）。调信号源频率，使发射电流 $I_1$ 最大，这时的频率就是发射回路的谐振频率 $f_0$。</p>',
        hint: '先用大步长找到电流的大致峰值，再用 10 Hz 的细调找最大值。',
        check: () => has(0),
        auto: async () => { app.showTable(0); await app.view('全景'); if (this.rxOn && this.d < 40) await this.adj('rx', 'd', 50, 300); await this.adj('gen', 'f', Math.round(this.f01 * 100) / 100, 500); await app.record('f0', 0); },
      },
      {
        title: '放上接收线圈，与发射线圈同轴正对',
        html: '<p>把接收线圈装到导轨上。线圈支架放上去时总有些偏斜：选中它，沿导轨方向看两线圈是否同轴，用<b>支架横向位置</b>和<b>支架转角</b>把它摆正。目测摆到基本正对后，可以把接收回路改成开路、把线圈移到 10 cm 左右，细调这两项使接收电压最大。</p>',
        hint: '横向偏 1 cm 时，10 cm 间距下互感约小 1.5%；偏 2 cm 约小 4%。转角的影响在近距离时反而使互感略大（线圈一侧靠近了），远距离时使互感变小。',
        status: () => (this.rxOn ? this.lookText() : '接收线圈还在器材柜里'),
        check: () => this.rxOn && this.aligned(),
        diagnose: () => (!this.rxOn ? [{ msg: '接收线圈还没放上导轨。', fix: { label: '帮我放上', run: () => app.autoPlace('rx', { pos: 30 }) } }] : !this.aligned() ? [{ msg: `接收线圈没有正对：${this.lookText()}。`, fix: { label: '帮我摆正', run: () => this.alignRx() } }] : []),
        auto: async () => { await app.view('线圈'); if (!this.rxOn) await app.autoPlace('rx', { pos: 30 }); await this.alignRx(); },
      },
      {
        title: '调谐接收线圈',
        html: '<p>接收线圈移到 20 cm 左右，接收回路用谐振接法，频率保持 $f_0$ 不动，调微调电容 $C_t$ 使接收电压 $U_2$ 最大，接收回路就和发射回路调到了同一谐振频率。</p>',
        check: () => has(1),
        diagnose: () => (!has(0) ? [{ msg: '先测发射线圈的谐振频率。' }] : !this.rxOn ? [{ msg: '接收线圈还没放上导轨。', fix: { label: '帮我放上', run: () => app.autoPlace('rx', { pos: 20 }) } }] : []),
        auto: async () => { app.showTable(0); await app.view('线圈'); if (!this.rxOn) await app.autoPlace('rx', { pos: 20 }); await this.seg('rx', 'open', false); await this.adj('rx', 'd', 20, 300); await this.toF0(); await this.tune(); await app.record('f0', 0); },
      },
      {
        title: '互感法测耦合系数',
        html: '<p>接收回路改为开路，频率保持 $f_0$。间距 $d$ 依次取 4、5、6、8、10、12、15、20、25、30 cm，记下发射电流 $I_1$ 和感应电压 $U_2$。$M=U_2/(\\omega I_1)$，$k=M/L$。</p>',
        status: () => `已测 ${rows('k').length} 个间距`,
        check: () => rows('k').length >= 5,
        auto: async () => {
          app.showTable(1); await app.view('全景'); await this.seg('rx', 'open', true); await this.toF0();
          for (const d of [4, 5, 6, 8, 10, 12, 15, 20, 25, 30]) { if (rows('k').some((r) => Math.abs(r.d - d) < 0.05)) continue; await this.adj('rx', 'd', d, 200); await app.record('k', 0); }
        },
      },
      {
        title: '观察频率分裂',
        html: '<p>接收回路恢复谐振接法（$R_L$ = 5 Ω）。把线圈逐渐靠近，观察扫频曲线：远时只有一个峰，近到一定程度分裂成两个峰，靠得越近两峰分得越开。在 3、4、5、6、8 cm 处记下两个峰的频率。</p>',
        hint: '两个峰对应两个耦合回路的"同相"和"反相"两种振动模式，频率近似为 $f_0/\\sqrt{1\\pm k}$。',
        status: () => `已测 ${rows('split').length} 个间距`,
        check: () => rows('split').length >= 3,
        auto: async () => {
          app.showTable(2); await app.view('线圈'); await this.seg('rx', 'open', false); await this.seg('rx', 'RL', rows('split')[0]?._RL ?? 5); await this.tune();
          for (const d of [3, 4, 5, 6, 8]) { if (rows('split').some((r) => Math.abs(r.d - d) < 0.05)) continue; await this.adj('rx', 'd', d, 200); if (this.peakList().length >= 2) await app.record('split', 0); }
        },
      },
      {
        title: '传输效率与负载功率',
        html: '<p>频率固定在 $f_0$，$R_L$ = 5 Ω。间距由 4 cm 逐渐增大到 30 cm，记下输入功率 $P_1$ 和负载电压 $U_2$。在负载功率最大的位置附近多测几点。</p>',
        hint: '负载功率 $P_2=U_2^2/R_L$，效率 $\\eta=P_2/P_1$。',
        status: () => `已测 ${rows('eff').length} 个间距`,
        check: () => rows('eff').length >= 6,
        auto: async () => {
          app.showTable(3); await app.view('全景'); await this.seg('rx', 'open', false); await this.seg('rx', 'RL', rows('eff')[0]?._RL ?? 5); await this.tune(); await this.toF0();
          for (const d of [4, 6, 8, 9, 10, 11, 12, 13, 14, 16, 20, 25, 30]) { if (rows('eff').some((r) => Math.abs(r.d - d) < 0.05)) continue; await this.adj('rx', 'd', d, 200); await app.record('eff', 0); }
        },
      },
      {
        title: '数据处理',
        html: '<p>由谐振频率求自感；算各间距的耦合系数并与诺依曼公式比较；由分裂频率估算耦合系数；作效率、负载功率随间距变化的曲线。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, f0 = this.f0rec(), K = a.table('k').completeRows(), Sp = a.table('split').completeRows(), E = a.table('eff').completeRows();
    if (f0 == null) return { html: '<p>请先测发射线圈的谐振频率。</p>', ok: false };
    let html = ''; const answers = [], plots = [];
    const w = 2 * Math.PI * f0 * 1e3, L = 1 / (w * w * C1N), Lu = L * 1e6;
    html += `<h3>1. 线圈自感</h3><p>串联谐振时 $\\omega_0L=1/(\\omega_0C_1)$，取 $C_1$ = 10.00 nF：</p><div class="result-box">$L=\\dfrac{1}{4\\pi^2f_0^2C_1}=${Lu.toFixed(3)}$ μH</div><p>按线圈几何尺寸用诺依曼公式算得 ${(this.Lg * 1e6).toFixed(3)} μH，实际线圈 ${(this.L * 1e6).toFixed(3)} μH（仿真设定值），测量值的相对误差 ${pct(relErr(L, this.L))}，主要来自电容 $C_1$ 的误差（±0.5%）。</p>`;
    answers.push({ label: '线圈自感 $L$', unit: 'μH', value: Lu, digits: 3, tolRel: 0.003 });
    const kOf = (r) => r.U2 / (w * r.I1 * L);
    const kth = (d) => coilM(COIL, d / 100) / this.Lg;
    if (K.length >= 2) {
      const ks = K.map((r) => ({ d: r.d, k: kOf(r) })).sort((x, y) => x.d - y.d);
      const ref = ks.reduce((b, x) => (Math.abs(x.d - 10) < Math.abs(b.d - 10) ? x : b));
      html += `<h3>2. 耦合系数</h3><p>接收开路时 $U_2=\\omega MI_1$，两线圈相同，$k=M/L=U_2/(\\omega LI_1)$：</p><table><tr><th>d/cm</th>${ks.map((x) => `<td>${x.d}</td>`).join('')}</tr><tr><th>k（实验）</th>${ks.map((x) => `<td>${x.k.toFixed(4)}</td>`).join('')}</tr><tr><th>k（诺依曼公式）</th>${ks.map((x) => `<td>${kth(x.d).toFixed(4)}</td>`).join('')}</tr></table>
        <div class="result-box">$d$ = ${ref.d} cm：$k=${ref.k.toFixed(4)}$</div><p>与诺依曼公式的计算值 ${kth(ref.d).toFixed(4)} 相对偏差 ${pct(relErr(ref.k, kth(ref.d)))}。耦合系数随距离迅速减小：间距比线圈半径大得多时 $M\\propto d^{-3}$（磁偶极子的近似）。</p>`;
      answers.push({ label: `耦合系数 $k$（$d$ = ${ref.d} cm）`, unit: '', value: ref.k, digits: 4, tolRel: 0.01 });
      const far = ks.filter((x) => x.d >= 15);
      if (far.length >= 2) { const f = linFit(far.map((x) => Math.log(x.d)), far.map((x) => Math.log(x.k))); html += `<p>$d$ ≥ 15 cm 的几点，$\\ln k$–$\\ln d$ 直线斜率 ${f.k.toFixed(2)}，正在向 −3 靠近。</p>`; }
      const dd = Array.from({ length: 60 }, (_, i) => 3 + i * 0.5);
      plots.push({ title: '耦合系数 k – 间距 d', xLabel: 'd / cm', yLabel: 'k', series: [{ type: 'scatter', data: ks.map((x) => [x.d, x.k]), label: '互感法' }, { type: 'line', data: dd.map((d) => [d, kth(d)]), label: '诺依曼公式' }] });
    }
    if (Sp.length) {
      const rows = Sp.map((r) => ({ d: r.d, fL: r.fL, fH: r.fH, k: (r.fH ** 2 - r.fL ** 2) / (r.fH ** 2 + r.fL ** 2) })).sort((x, y) => x.d - y.d);
      html += `<h3>3. 频率分裂</h3><p>两个相同的谐振回路耦合后，有两个本征频率 $f_{L,H}=f_0/\\sqrt{1\\pm k}$，由此 $k\\approx\\dfrac{f_H^2-f_L^2}{f_H^2+f_L^2}$：</p><table><tr><th>d/cm</th>${rows.map((x) => `<td>${x.d}</td>`).join('')}</tr><tr><th>f_L/kHz</th>${rows.map((x) => `<td>${x.fL}</td>`).join('')}</tr><tr><th>f_H/kHz</th>${rows.map((x) => `<td>${x.fH}</td>`).join('')}</tr><tr><th>k（分裂法）</th>${rows.map((x) => `<td>${x.k.toFixed(3)}</td>`).join('')}</tr><tr><th>k（诺依曼公式）</th>${rows.map((x) => `<td>${kth(x.d).toFixed(3)}</td>`).join('')}</tr></table>
        <p>分裂法得到的 $k$ 偏小，间距越大偏得越多：上式只对无损耗回路成立，接收回路串有负载电阻，品质因数只有六七，两个峰被"拉"向中间；耦合弱到一定程度两峰就并成一个。</p>`;
    }
    if (E.length >= 3) {
      const RL = E[0]._RL ?? this.RL;
      const rows = E.map((r) => { const P2 = (r.U2 / 1000) ** 2 / RL * 1000; return { d: r.d, P1: r.P1, P2, eta: P2 / r.P1 }; }).sort((x, y) => x.d - y.d);
      const best = rows.reduce((b, x) => (x.P2 > b.P2 ? x : b));
      html += `<h3>4. 传输效率与负载功率</h3><table><tr><th>d/cm</th>${rows.map((x) => `<td>${x.d}</td>`).join('')}</tr><tr><th>P₂/mW</th>${rows.map((x) => `<td>${x.P2.toFixed(1)}</td>`).join('')}</tr><tr><th>η</th>${rows.map((x) => `<td>${(x.eta * 100).toFixed(1)}%</td>`).join('')}</tr></table>
        <p>传输效率随间距增大单调下降；负载功率却在 $d$ ≈ ${best.d} cm 处最大（${best.P2.toFixed(1)} mW）。这一位置叫<b>临界耦合</b>：反射到发射回路的电阻 $\\omega^2M^2/(R_2+R_L)$ 恰好等于发射回路自身的电阻 $R_s+R_1$，信号源给出的功率最大。更近（过耦合）时反射电阻过大，发射电流反而减小，扫频曲线也在这时开始分裂。此处 $k$ ≈ ${kth(best.d).toFixed(3)}。</p>`;
      plots.push({ title: '负载功率与效率 – 间距', xLabel: 'd / cm', yLabel: 'P₂ / mW；η × 100', series: [{ type: 'scatter', data: rows.map((x) => [x.d, x.P2]), label: 'P₂/mW' }, { type: 'line', data: rows.map((x) => [x.d, x.P2]), label: '' }, { type: 'scatter', data: rows.map((x) => [x.d, x.eta * 100]), label: 'η×100' }, { type: 'line', data: rows.map((x) => [x.d, x.eta * 100]), label: '' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 磁耦合谐振</h3><p>发射线圈与电容组成串联谐振回路，接收线圈同样组成谐振回路。两线圈之间靠互感 $M$ 耦合，耦合系数 $k=M/\\sqrt{L_1L_2}$。两个回路调到同一谐振频率 $f_0=1/(2\\pi\\sqrt{LC})$ 时，即使 $k$ 很小，接收回路也能得到可观的能量——各自的电抗相互抵消，回路电流只受电阻限制。</p>
<h3>2. 电路方程</h3>$$\\begin{cases}(R_s+R_1+jX_1)\\dot I_1+j\\omega M\\dot I_2=\\dot U_s\\\\ j\\omega M\\dot I_1+(R_2+R_L+jX_2)\\dot I_2=0\\end{cases}$$<p>谐振时 $X_1=X_2=0$，效率</p>$$\\eta=\\frac{\\omega^2M^2R_L}{(R_2+R_L)\\left[R_1(R_2+R_L)+\\omega^2M^2\\right]}$$<p>随 $M$ 增大而单调增大；负载功率在 $\\omega^2M^2=(R_s+R_1)(R_2+R_L)$ 时最大（临界耦合）。</p>
<h3>3. 频率分裂</h3><p>$k$ 较大时，两个耦合回路有两个本征频率 $f_0/\\sqrt{1\\pm k}$，负载电压的频率特性出现双峰；耦合较弱时，两峰在损耗的作用下合成一个峰。</p>
<h3>4. 互感的计算</h3><p>两个同轴圆环（半径 $a$、$b$，间距 $d$）的互感</p>$$M=\\mu_0\\sqrt{ab}\\left[\\left(\\frac2m-m\\right)K(m)-\\frac2mE(m)\\right],\\quad m^2=\\frac{4ab}{(a+b)^2+d^2}$$<p>$K$、$E$ 为完全椭圆积分。平面螺旋线圈看作 ${COIL.N} 个同心圆环，互感为各圈两两互感之和，自感为各圈自感与圈间互感之和。</p>
<h3>5. 本仿真的计算模型</h3><p>线圈参数由几何尺寸算出（自感另加 ±2% 的制作偏差），线圈交流电阻计入趋肤效应（∝√f）；电路按相量法求正弦稳态，结果与开源 SPICE 引擎 spice-ts 的交流分析逐点一致。</p>`;
  }
}
