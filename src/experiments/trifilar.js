// 实验：三线摆测转动惯量（扭转振动周期 · 圆环 · 平行轴定理）
// 运动按 physics/trifilar.js 的精确方程积分：振幅大时周期变长；直接扭动下盘会激起整体摆动，干扰判断平衡位置。
// 秒表由学生按：起停时刻是否在平衡位置、反应时间都会进入结果。
import * as THREE from 'three';
import { meta, thumb } from './trifilar.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss, fmtU } from '../core/Stats.js';
import { Caliper, Tape, Stopwatch } from '../core/gauges.js';
import { Trifilar } from '../physics/trifilar.js';
import { trifilarFig } from './mechFigs.js';

const G = 9.794;
const YU = 95; // 上盘中心高度 cm
const RD = 8.0; // 下盘半径 cm
const NP = 30; // 每次计时的周期数
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;
const GEO = [
  ['a', '上盘悬点间距 a / mm', 'cal'], ['b', '下盘悬点间距 b / mm', 'cal'], ['H', '两盘间距 H / cm', 'tape'],
  ['D1', '圆环内径 D₁ / mm', 'cal'], ['D2', '圆环外径 D₂ / mm', 'cal'], ['d', '圆柱直径 d / mm', 'cal'], ['Lc', '两圆柱外侧间距 / mm', 'cal'],
];
const CFG = { o: '下盘', r: '下盘 + 圆环', c: '下盘 + 两圆柱' };

export class TrifilarExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    // ---- 真值 ----
    this.r = rand(2.9, 3.1) / 100; this.R = rand(6.9, 7.1) / 100; this.H = rand(47, 52) / 100;
    this.m0 = rand(0.42, 0.48); this.I0 = (this.m0 * (RD / 100) ** 2) / 2 * (1 + rand(-0.01, 0.01));
    this.m1 = rand(0.40, 0.46); this.D1 = rand(88, 92) / 1000; this.D2 = rand(118, 122) / 1000;
    this.Iring = (this.m1 * (this.D1 ** 2 + this.D2 ** 2)) / 8;
    this.m2 = [rand(0.18, 0.2), 0]; this.m2[1] = this.m2[0] * (1 + rand(-0.003, 0.003));
    this.dc = rand(29, 31) / 1000; this.xc = rand(44, 46) / 1000;
    this.Icyl = (this.m2[0] + this.m2[1]) * (this.xc ** 2 + this.dc ** 2 / 8);
    // 天平称量值（g，含 ±0.05% 的称量误差）
    const w = (m) => Math.round(m * 1000 * (1 + gauss(0.0004)) * 10) / 10;
    this.mw = { m0: w(this.m0), m1: w(this.m1), m2: [w(this.m2[0]), w(this.m2[1])] };
    // ---- 摆 ----
    this.p = new Trifilar({ R: this.R, r: this.r, H: this.H, g: G });
    this.p.c = 2.2e-6; // 空气阻尼
    this.setLoad();
    this.amp0 = Math.round(rand(10, 15)); // 起振扭转角（°），学生应减小到 5° 以内
    this.tilt = [rand(0.6, 1.5) * (Math.random() < 0.5 ? -1 : 1), rand(0.5, 1.2) * (Math.random() < 0.5 ? -1 : 1)];
    this.sw = new Stopwatch(); this.cross = 0; this.auto = null; this.startInfo = null; this.lastCross = -1e9;
    this.cal = new Caliper(); this.tape = new Tape({ label: '两盘间距 H' });
    this.meas = 'a'; this.setMeas('a');
    this.timeScale = 1; this.assist = false;
  }

  /** 按台上放的物体更新总质量和转动惯量 */
  setLoad() {
    const a = this.app, ring = a.comp && a.comp('ring') && a.comp('ring').placed, cyl = a.comp && a.comp('cyls') && a.comp('cyls').placed;
    this.p.M = this.m0 + (ring ? this.m1 : 0) + (cyl ? this.m2[0] + this.m2[1] : 0);
    this.p.I = this.I0 + (ring ? this.Iring : 0) + (cyl ? this.Icyl : 0);
    this.cfg = ring ? 'r' : cyl ? 'c' : 'o';
  }
  objSize(k) { return { a: this.r * Math.sqrt(3) * 1000, b: this.R * Math.sqrt(3) * 1000, D1: this.D1 * 1000, D2: this.D2 * 1000, d: this.dc * 1000, Lc: (2 * this.xc + this.dc) * 1000 }[k]; }
  setMeas(k) {
    this.meas = k;
    if (k === 'H') this.tape.measure(this.H * 100, { sigma: 0.04 });
    else this.cal.setObject(this.objSize(k));
  }

  // ======================= 运动 =======================
  release(gentle) {
    const p = this.p, a = (this.amp0 * Math.PI) / 180;
    p.th = a; p.w = gentle ? 0 : rand(-0.3, 0.3);
    const tl = Math.hypot(this.tilt[0], this.tilt[1]);
    p.sw = (gentle ? 0.0006 : rand(0.012, 0.02)) + tl * 0.004; p.swPh = rand(0, 6.28);
    this.gentle = gentle;
    this.app.changed();
  }
  stopDisk() { this.p.th = 0; this.p.w = 0; this.p.sw = 0; this.app.changed(); }

  tick(dt) {
    const a = this.app, sdt = Math.min(2, dt * (a.running ? a.speed * (this.auto ? 4 : 1) : this.timeScale));
    if (!(sdt > 0)) return;
    const moving = Math.abs(this.p.th) > 1e-5 || Math.abs(this.p.w) > 1e-5 || this.p.sw > 1e-5;
    const evs = [];
    if (moving) this.p.step(sdt, (tc) => evs.push(tc)); else this.p.t += sdt;
    const tEnd = this.p.t;
    this.sw.tick(sdt);
    for (const tc of evs) {
      this.cross++; this.lastCross = tc;
      const au = this.auto;
      if (!au) continue;
      if (au.phase === 'arm') { this.sw.reset(); this.sw.run = true; this.sw.t = tEnd - tc + gauss(0.02); au.phase = 'run'; au.stopAt = this.cross + au.N; this.startInfo = this.info(); }
      else if (au.phase === 'run' && this.cross >= au.stopAt) { this.sw.run = false; this.sw.t = Math.max(0, this.sw.t - (tEnd - tc) + gauss(0.02)); this.auto = null; }
    }
    if (moving || this.sw.run) a.changed();
  }
  /** 计时开始时的状态，用于记录时检查 */
  info() { return { amp: (this.p.amp * 180) / Math.PI, sw: this.p.sw, cfg: this.cfg, gentle: this.gentle, phase: this.phaseErr() }; }
  /** 当前位置离平衡位置有多远（以周期计）：用于判断学生是否在平衡位置按表 */
  phaseErr() { const T = this.p.T0, d = (this.p.t - this.lastCross) % T; return Math.min(d, Math.abs(d - T / 2), T - d) / T; }

  swStart() {
    if (this.sw.run) return;
    this.sw.reset(); this.sw.start(0); this.startInfo = this.info();
    this.app.changed();
  }
  swStop() { if (!this.sw.run) return; this.sw.stop(gauss(0.035) * this.timeScale); this.stopPhase = this.phaseErr(); this.app.changed(); }

  // ======================= 场景 =======================
  cameras() {
    const yd = YU - this.H * 100;
    return [
      { name: '全景', pos: [70, 120, 170], target: [-12, 58, 0] },
      { name: '下盘', pos: [26, yd + 34, 52], target: [-4, yd, 0] },
      { name: '上盘', pos: [22, YU + 18, 40], target: [-4, YU - 4, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 50, 0);
    const yd0 = YU - this.H * 100;
    // ---------- 三线摆架 ----------
    const fr = new THREE.Group();
    const dark = MAT.paint(0x2b3440), steel = MAT.metal();
    fr.add(mesh(new THREE.BoxGeometry(56, 2.4, 40), dark, -6, 1.2, 0));
    fr.add(mesh(new THREE.CylinderGeometry(1.6, 1.8, YU + 10, 18), steel, -30, (YU + 10) / 2 + 2.4, 0));
    fr.add(mesh(new THREE.BoxGeometry(34, 2.6, 4), dark, -14, YU + 6, 0));
    this.upper = new THREE.Group(); this.upper.position.set(0, YU, 0); fr.add(this.upper);
    this.upper.add(mesh(new THREE.CylinderGeometry(4.6, 4.6, 1.2, 36), MAT.alu(), 0, 0, 0));
    this.upper.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 5, 10), steel, 0, 3.2, 0));
    for (let k = 0; k < 3; k++) { const an = Math.PI / 2 + (k * 2 * Math.PI) / 3; this.upper.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.4, 10), MAT.black(), (this.r * 100 + 1.2) * Math.cos(an), 1.2, (this.r * 100 + 1.2) * Math.sin(an))); }
    // 平衡位置标线（固定在底座上的竖直细杆）
    fr.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, yd0 + 2, 8), MAT.paint(0xb91c1c), RD + 1.4, (yd0 + 2) / 2 + 2.4, 0));
    // 下盘
    this.lower = new THREE.Group(); fr.add(this.lower);
    const diskM = new THREE.MeshStandardMaterial({ color: 0xb08d47, metalness: 0.75, roughness: 0.32 });
    this.lower.add(mesh(new THREE.CylinderGeometry(RD, RD, 0.8, 64), diskM, 0, 0, 0));
    this.lower.add(mesh(new THREE.BoxGeometry(RD * 0.9, 0.05, 0.25), MAT.black(), RD * 0.55, 0.42, 0)); // 刻线
    for (const s of [-1, 1]) this.lower.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 12), MAT.black(), s * this.xc * 100, 0.42, 0));
    for (let k = 0; k < 3; k++) { const an = Math.PI / 2 + (k * 2 * Math.PI) / 3; this.lower.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8), MAT.black(), this.R * 100 * Math.cos(an), 0.1, this.R * 100 * Math.sin(an))); }
    // 悬线
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xe5e7eb })); fr.add(this.lines);
    this.bubble = mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), -3, 0.65, 3); this.lower.add(this.bubble);
    this.lower.add(mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.3, 24), new THREE.MeshStandardMaterial({ color: 0xd9e7c5, roughness: 0.3 }), -3, 0.5, 3));
    app.addComponent(new Component({
      key: 'frame', name: '三线摆', zone: 'none', fixed: true, required: true, object: fr, labelY: YU + 14,
      desc: `上下两个圆盘用三根等长细线相连，悬点各成等边三角形。下盘质量 m₀ = ${this.mw.m0.toFixed(1)} g（天平称得）。上盘的三个旋钮可调节悬线长度，使下盘水平。红色细杆是平衡位置的标线。`,
      controls: () => [
        { type: 'knob', label: '上盘旋钮 1（调线长）', get: () => this.tilt[0], set: (v) => (this.tilt[0] = clamp(v, -3, 3)), step: 0.01, bigStep: 0.1, perRev: 0.5, fmt: () => '旋转' },
        { type: 'knob', label: '上盘旋钮 2（调线长）', get: () => this.tilt[1], set: (v) => (this.tilt[1] = clamp(v, -3, 3)), step: 0.01, bigStep: 0.1, perRev: 0.5, fmt: () => '旋转' },
        { type: 'readout', label: '下盘水准泡', get: () => (Math.hypot(...this.tilt) < 0.1 ? '居中' : `偏离 ${(Math.hypot(...this.tilt) / 0.1).toFixed(1)} 格`) },
        { type: 'knob', label: '起振扭转角', get: () => this.amp0, set: (v) => (this.amp0 = clamp(Math.round(v), 1, 30)), step: 1, bigStep: 5, perRev: 10, digits: 0, unit: '°', sub: '小角度时才是简谐振动，一般不超过 5°' },
        { type: 'button', label: '轻转上盘后放开（下盘扭转振动）', onClick: () => this.release(true) },
        { type: 'button', label: '直接用手扭动下盘后放开', onClick: () => this.release(false) },
        { type: 'button', label: '使下盘停下', onClick: () => this.stopDisk() },
        { type: 'readout', label: '下盘摆动', get: () => (this.p.sw > 0.004 ? '下盘在晃动（整体摆动）' : '平稳') },
      ],
    }));
    // ---------- 待测物体 ----------
    app.addSlot({ id: 'disk', pos: new THREE.Vector3(0, yd0 + 0.4, 0), accepts: ['ring', 'cyls'] });
    const ringG = new THREE.Group();
    const ri = (this.D1 * 100) / 2, ro = (this.D2 * 100) / 2;
    ringG.add(new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(ri, 0), new THREE.Vector2(ro, 0), new THREE.Vector2(ro, 1.6), new THREE.Vector2(ri, 1.6), new THREE.Vector2(ri, 0)], 72), new THREE.MeshStandardMaterial({ color: 0x5b6470, metalness: 0.8, roughness: 0.3 })));
    app.addComponent(new Component({
      key: 'ring', name: '圆环', zone: 'slot', defaultSlot: 'disk', object: ringG, labelY: 8,
      icon: SVG('<circle cx="32" cy="20" r="14" fill="none" stroke="currentColor" stroke-width="6"/>'),
      desc: `钢制圆环，质量 m₁ = ${this.mw.m1.toFixed(1)} g（天平称得）。放在下盘上时要与下盘同心。`,
    }));
    const cylG = new THREE.Group(), cm = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.85, roughness: 0.25 });
    for (const s of [-1, 1]) cylG.add(mesh(new THREE.CylinderGeometry((this.dc * 100) / 2, (this.dc * 100) / 2, 3, 36), cm, s * this.xc * 100, 1.5, 0));
    app.addComponent(new Component({
      key: 'cyls', name: '两个圆柱', zone: 'slot', defaultSlot: 'disk', object: cylG, labelY: 8,
      icon: SVG('<rect x="12" y="10" width="12" height="20" rx="2" fill="currentColor"/><rect x="40" y="10" width="12" height="20" rx="2" fill="currentColor"/>'),
      desc: `两个相同的钢圆柱，质量分别为 ${this.mw.m2[0].toFixed(1)} g、${this.mw.m2[1].toFixed(1)} g。对称地插在下盘的两个孔中，中心离转轴距离 x。`,
    }));
    this.tv = app.addView({ id: 'top', title: '下盘（俯视）与秒表', w: 250, h: 250, res: 1.6 });
    this.gv = app.addView({ id: 'tool', title: '量具读数', w: 330, h: 150, res: 1.8 });
  }

  canPlace(comp) {
    if ((comp.key === 'ring' || comp.key === 'cyls') && (Math.abs(this.p.th) > 0.002 || this.p.sw > 0.002)) return '下盘还在转动，先让它停下再放物体';
    return null;
  }
  onPlace() { this.setLoad(); }
  onRemove() { this.setLoad(); }

  update() {
    const p = this.p, yd0 = YU - this.H * 100;
    const [z] = p.zz(p.th), [z0] = p.zz(0);
    const sx = p.sw * 100 * Math.sin(p.swPh), yd = yd0 + (z0 - z) * 100;
    const k = (Math.PI / 180) * 2;
    this.lower.position.set(sx, yd, 0);
    this.lower.rotation.set(this.tilt[0] * k, -p.th, this.tilt[1] * k, 'YXZ');
    for (const key of ['ring', 'cyls']) { const c = this.app.comp(key); if (c.placed) { c.root.position.set(sx, yd + 0.4, 0); c.root.rotation.y = -p.th; } }
    const pos = this.lines.geometry.attributes.position;
    for (let i = 0; i < 3; i++) {
      const an = Math.PI / 2 + (i * 2 * Math.PI) / 3;
      pos.setXYZ(2 * i, this.r * 100 * Math.cos(an), YU - 0.6, this.r * 100 * Math.sin(an));
      const v = new THREE.Vector3(this.R * 100 * Math.cos(an), 0.4, this.R * 100 * Math.sin(an)).applyEuler(this.lower.rotation).add(this.lower.position);
      pos.setXYZ(2 * i + 1, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    this.bubble.position.set(-3 - this.tilt[1] * 0.6, 0.65, 3 - this.tilt[0] * 0.6);
    this.drawTop();
    this.drawTool();
  }

  drawTop() {
    const v = this.tv, g = v.ctx, W = v.W, H = v.H, p = this.p;
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    const cx = W / 2 - W * 0.06, cy = H * 0.44, Rp = W * 0.34;
    const sx = p.sw * 100 * Math.sin(p.swPh) * (Rp / RD);
    // 下盘
    g.save(); g.translate(cx + sx, cy); g.rotate(-p.th);
    const gr = g.createRadialGradient(-Rp * 0.3, -Rp * 0.3, Rp * 0.1, 0, 0, Rp);
    gr.addColorStop(0, '#d8b871'); gr.addColorStop(1, '#8f6d2f');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, Rp, 0, 7); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(Rp * 0.1, 0); g.lineTo(Rp, 0); g.stroke();
    const a = this.app;
    if (a.comp('ring').placed) { g.strokeStyle = '#4b5563'; g.lineWidth = ((this.D2 - this.D1) * 100 / 2) * (Rp / RD); g.beginPath(); g.arc(0, 0, (((this.D1 + this.D2) / 4) * 100 * Rp) / RD, 0, 7); g.stroke(); }
    if (a.comp('cyls').placed) { g.fillStyle = '#9aa3ad'; for (const s of [-1, 1]) { g.beginPath(); g.arc((s * this.xc * 100 * Rp) / RD, 0, (this.dc * 50 * Rp) / RD, 0, 7); g.fill(); } }
    for (let k = 0; k < 3; k++) { const an = -Math.PI / 2 - (k * 2 * Math.PI) / 3; g.fillStyle = '#111'; g.beginPath(); g.arc((this.R * 100 * Rp / RD) * Math.cos(an), (this.R * 100 * Rp / RD) * Math.sin(an), 3, 0, 7); g.fill(); }
    g.restore();
    // 平衡位置标线
    g.fillStyle = '#c41e3a'; g.fillRect(cx + Rp + 4, cy - 1.2, Rp * 0.22, 2.4); g.beginPath(); g.arc(cx + Rp + 4, cy, 3, 0, 7); g.fill();
    // 秒表
    this.sw.draw(g, W * 0.08, H * 0.82, W * 0.62, H * 0.15);
    g.fillStyle = '#c9ced3'; g.font = `${H * 0.045}px "Microsoft YaHei"`; g.textAlign = 'left';
    g.fillText('电子秒表', W * 0.74, H * 0.88);
    if (this.assist) { g.fillStyle = '#8fe3a5'; g.font = `${H * 0.045}px Consolas`; g.fillText(`θm ${((p.amp * 180) / Math.PI).toFixed(1)}°`, W * 0.74, H * 0.94); g.fillText(`过线 ${this.cross}`, W * 0.74, H * 0.07); }
    const amp = (p.amp * 180) / Math.PI;
    v.foot(p.sw > 0.004 ? '下盘在整体晃动，很难判断何时经过平衡位置' : amp < 0.05 ? '下盘静止。设定扭转角后轻转上盘使它起振' : amp > 6 ? `扭转角约 ${amp.toFixed(0)}°，太大了（应不超过 5°）` : '刻线经过红色标线（平衡位置）时按秒表');
  }

  drawTool() {
    const v = this.gv, g = v.ctx, W = v.W, H = v.H;
    if (this.meas === 'H') this.tape.draw(g, W, H, { assist: this.assist, mark: '下盘上表面' });
    else this.cal.draw(g, W, H, { assist: this.assist });
    const p = this.meas === 'H' ? null : this.cal.problem();
    const name = GEO.find((x) => x[0] === this.meas)[1].replace(/ \/.*/, '');
    v.foot(p ? `${name} —— ${p}` : name);
  }

  globalControls() {
    const a = this.app;
    const out = [
      { type: 'button', label: this.sw.run ? '秒表：停止' : '秒表：开始', onClick: () => { if (this.sw.run) this.swStop(); else this.swStart(); a.renderInspector(); } },
      { type: 'button', label: '秒表：清零', onClick: () => { this.sw.reset(); a.changed(); } },
      { type: 'readout', label: '秒表', get: () => this.sw.shown },
      { type: 'select', label: '测量哪个长度', get: () => this.meas, set: (v) => { this.setMeas(v); a.renderInspector(); a.changed(); }, options: GEO.map(([value, label]) => ({ value, label: label.replace(/ \/.*/, '') })) },
    ];
    if (this.meas === 'H') out.push({ type: 'button', label: '重新量一次', onClick: () => { this.setMeas('H'); a.changed(); } });
    else out.push(...this.cal.controls(() => a.changed()));
    out.push(
      { type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×2', value: 2 }, { label: '×4', value: 4 }] },
      { type: 'toggle', label: '读数辅助（振幅、过线次数、量具数值）', get: () => this.assist, set: (v) => (this.assist = v) },
    );
    return out;
  }

  // ======================= 数据表 =======================
  tables() {
    const rows = [];
    for (const k of ['o', 'r', 'c']) for (let i = 1; i <= 3; i++) rows.push({ k, what: `${CFG[k]}  #${i}` });
    return [
      {
        id: 'per', title: `周期（每次测 ${NP} 个周期）`, fixedRows: true,
        initRows: () => rows.map((r) => ({ ...r })),
        columns: [{ key: 'what', label: '摆上的物体', type: 'text', readonly: true }, { key: 't', label: `${NP}T / s`, digits: 2, readTol: 0.011 }, { key: 'T', label: 'T / s', digits: 4, calc: (r) => r.t / NP }],
        buttons: [{ label: '记录秒表读数', onClick: (t) => this.recT(t) }],
        note: `刻线经过平衡位置时开始计时，并从下一次同方向经过时数“1”，数到 ${NP} 时停表。按现在下盘上放的物体填入对应的行。`,
      },
      {
        id: 'geo', title: '几何量', fixedRows: true,
        initRows: () => GEO.map(([k, what]) => ({ k, what })),
        columns: [{ key: 'what', label: '待测量', type: 'text', readonly: true }, { key: 'v', label: '测量值', digits: 2, readTol: 0.05 }],
        buttons: [{ label: '记录当前量具读数', onClick: (t) => this.recGeo(t) }],
        note: '悬点间距、圆环内外径、圆柱直径和两圆柱外侧间距用游标卡尺测，两盘间距 H 用米尺测。',
      },
    ];
  }
  recT(t) {
    const a = this.app, s = this.startInfo;
    if (this.sw.run) return a.toast('秒表还在走，先停表', 'warn');
    if (!(this.sw.value > 0)) return a.toast('秒表读数为零', 'warn');
    if (!s) return a.toast('没有完整的一次计时', 'warn');
    if (s.cfg !== this.cfg) return a.toast('计时过程中换过下盘上的物体，这次计时无效', 'warn');
    const i = t.rows.findIndex((r) => r.k === this.cfg && (r.t == null || r.t === ''));
    if (i < 0) return a.toast(`「${CFG[this.cfg]}」已经测满 3 次`, 'warn');
    if (s.amp > 6) a.toast(`开始计时时扭转角约 ${s.amp.toFixed(0)}°，偏大，周期会偏大`, 'warn');
    if (s.sw > 0.004) a.toast('计时时下盘在整体晃动（直接扭动下盘造成的），平衡位置判断不准', 'warn');
    const T = this.p.T0, n = this.sw.value / T;
    if (Math.abs(n - NP) > 0.3) a.toast(`这段时间约为 ${n.toFixed(1)} 个周期，与 ${NP} 相差较多：可能数错了次数，或没在平衡位置启停`, 'warn');
    if (Math.hypot(...this.tilt) > 0.15) a.toast('提示：下盘没有调水平', 'warn');
    t.set(i, 't', this.sw.value);
  }
  recGeo(t) {
    const a = this.app, k = this.meas;
    if (k !== 'H') { const p = this.cal.problem(); if (p) return a.toast(p, 'warn'); }
    const i = t.rows.findIndex((r) => r.k === k);
    t.set(i, 'v', Math.round((k === 'H' ? this.tape.reading : this.cal.reading) * 100) / 100);
  }

  // ======================= 自动操作 =======================
  async knob(get, set, to, ms = 500) { await this.app.tween(get, set, to, ms); set(to); this.app.changed(); }
  async timeOnce() {
    const a = this.app;
    this.stopDisk(); await a.wait(200);
    this.release(true); await a.wait(1200);
    this.auto = { N: NP, phase: 'arm' };
    if (!(await a.until(() => !this.auto))) { this.auto = null; return; }
    await a.record('per');
  }
  steps() {
    const app = this.app, done = (k) => app.table('per').rows.filter((r) => r.k === k && isFinite(r.t) && r.t !== '' && r.t != null).length;
    return [
      {
        title: '调节下盘水平',
        html: '<p>调节上盘的旋钮改变悬线长度，使下盘上的水准泡居中。下盘不水平时，扭转振动会混入整体摆动。</p>',
        check: () => Math.hypot(...this.tilt) < 0.1,
        auto: async () => {
          await app.view('上盘'); app.select(app.comp('frame'));
          await this.knob(() => this.tilt[0], (v) => (this.tilt[0] = v), rand(-0.03, 0.03));
          await this.knob(() => this.tilt[1], (v) => (this.tilt[1] = v), rand(-0.03, 0.03));
        },
      },
      {
        title: `测下盘的周期 T₀`,
        html: `<p>把起振扭转角设为 5° 以内，<b>轻轻转动上盘</b>再放回，使下盘作扭转振动（不要直接扭下盘）。待振动稳定后，在刻线经过平衡位置时按秒表，测 ${NP} 个周期的时间，重复 3 次。</p>`,
        hint: '从平衡位置开始计时：这时下盘转得最快，经过标线的时刻最容易判断准。',
        check: () => done('o') >= 3,
        auto: async () => {
          await app.view('下盘'); app.select(app.comp('frame'));
          await this.knob(() => this.amp0, (v) => (this.amp0 = Math.round(v)), 4, 300);
          app.showTable(0);
          for (let i = done('o'); i < 3; i++) await this.timeOnce();
        },
      },
      {
        title: '放上圆环，测周期 T₁',
        html: '<p>让下盘停下，把圆环放在下盘上，与下盘同心。同样测 3 次。</p>',
        check: () => done('r') >= 3,
        auto: async () => {
          this.stopDisk(); await app.autoPlace('ring'); this.setLoad();
          for (let i = done('r'); i < 3; i++) await this.timeOnce();
        },
      },
      {
        title: '换上两个圆柱，测周期 T₂',
        html: '<p>取下圆环，把两个圆柱对称地插入下盘的两个孔中，测 3 次周期。由此可以验证平行轴定理。</p>',
        check: () => done('c') >= 3,
        auto: async () => {
          this.stopDisk(); app.remove(app.comp('ring')); await app.autoPlace('cyls'); this.setLoad();
          for (let i = done('c'); i < 3; i++) await this.timeOnce();
          this.stopDisk();
        },
      },
      {
        title: '测量几何量',
        html: '<p>用游标卡尺测上、下盘悬点间距 a、b，圆环内外径，圆柱直径和两圆柱外侧间距；用米尺测两盘间距 H。悬点到中心的距离 $r=a/\\sqrt3$，$R=b/\\sqrt3$。</p>',
        check: () => app.table('geo').rows.every((r) => isFinite(r.v) && r.v !== '' && r.v != null),
        auto: async () => {
          app.showTable(1);
          for (const [k] of GEO) {
            this.setMeas(k); app.renderInspector(); app.changed();
            if (k !== 'H') { const s = this.objSize(k); this.cal.open = s + 8; await this.knob(() => this.cal.open, (v) => this.cal.push(v), s - 1, 400); }
            await app.wait(300); await app.record('geo');
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>计算下盘、圆环和圆柱的转动惯量，与理论值比较，验证平行轴定理。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app;
    const per = a.table('per').rows.filter((r) => isFinite(r.t) && r.t !== '' && r.t != null);
    const Tk = (k) => { const v = per.filter((r) => r.k === k).map((r) => r.t / NP); return v; };
    const gv = Object.fromEntries(a.table('geo').rows.map((r) => [r.k, r.v === '' || r.v == null ? NaN : +r.v]));
    const T0s = Tk('o');
    if (T0s.length < 1) return { html: '<p>请先测下盘的周期。</p>', ok: false };
    if (!['a', 'b', 'H'].every((k) => gv[k] > 0)) return { html: '<p>请先测悬点间距 a、b 和两盘间距 H。</p>', ok: false };
    const r = gv.a / Math.sqrt(3) / 1000, R = gv.b / Math.sqrt(3) / 1000, H = gv.H / 100;
    const K = (G * R * r) / (4 * Math.PI ** 2 * H);
    const m0 = this.mw.m0 / 1000, m1 = this.mw.m1 / 1000, m2 = (this.mw.m2[0] + this.mw.m2[1]) / 1000;
    const T0 = mean(T0s), I0 = m0 * K * T0 * T0;
    const uT = (v) => (v.length > 1 ? Math.hypot(stdev(v) / Math.sqrt(v.length), 0.01 / NP / Math.sqrt(3)) : 0.01 / NP);
    const f = (x, n = 4) => x.toFixed(n);
    const rI0 = Math.sqrt((0.02 / Math.sqrt(3) / gv.a) ** 2 + (0.02 / Math.sqrt(3) / gv.b) ** 2 + (0.05 / gv.H) ** 2 + (2 * uT(T0s) / T0) ** 2);
    let html = `<h3>1. 下盘</h3><p>$r=a/\\sqrt3=${f(r * 1000, 2)}$ mm，$R=b/\\sqrt3=${f(R * 1000, 2)}$ mm，H = ${f(gv.H, 2)} cm；$T_0$ = ${T0s.map((x) => x.toFixed(4)).join('、')} s，平均 ${f(T0)} s。</p>
      $$I_0=\\frac{m_0gRr}{4\\pi^2H}T_0^2=${f(I0 * 1e3, 4)}\\times10^{-3}\\ \\text{kg·m}^2$$<div class="result-box">$I_0=${fmtU(I0 * 1e3, I0 * 1e3 * rI0)}\\times10^{-3}$ kg·m²（相对不确定度 ${pct(rI0, 2)}）</div>`;
    const tail = [`下盘转动惯量参考值 ${(this.I0 * 1e3).toFixed(4)}×10⁻³ kg·m²，相对误差 ${pct(relErr(I0, this.I0), 2)}`];
    const answers = [{ label: '$I_0$', unit: '10⁻³ kg·m²', value: I0 * 1e3, digits: 4, tolRel: 0.005 }];
    const plots = [];
    const T1s = Tk('r');
    if (T1s.length && gv.D1 > 0 && gv.D2 > 0) {
      const T1 = mean(T1s), I1 = (m0 + m1) * K * T1 * T1, Ir = I1 - I0;
      const Ith = (m1 * ((gv.D1 / 1000) ** 2 + (gv.D2 / 1000) ** 2)) / 8;
      html += `<h3>2. 圆环</h3><p>$T_1$ 平均 ${f(T1)} s。$I_1=\\dfrac{(m_0+m_1)gRr}{4\\pi^2H}T_1^2=${f(I1 * 1e3)}\\times10^{-3}$ kg·m²，圆环 $I=I_1-I_0=${f(Ir * 1e3)}\\times10^{-3}$ kg·m²。</p>
        <p>理论值 $\\dfrac{m_1}{8}(D_1^2+D_2^2)=${f(Ith * 1e3)}\\times10^{-3}$ kg·m²，测量值与理论值相对偏差 ${pct((Ir - Ith) / Ith, 2)}。</p>`;
      tail.push(`圆环参考值 ${(this.Iring * 1e3).toFixed(4)}×10⁻³ kg·m²，相对误差 ${pct(relErr(Ir, this.Iring), 2)}`);
      answers.push({ label: '$I_{环}$', unit: '10⁻³ kg·m²', value: Ir * 1e3, digits: 4, tolRel: 0.01 });
    }
    const T2s = Tk('c');
    if (T2s.length && gv.d > 0 && gv.Lc > 0) {
      const T2 = mean(T2s), I2 = (m0 + m2) * K * T2 * T2, Ic = (I2 - I0) / 2;
      const x = (gv.Lc - gv.d) / 2 / 1000, d = gv.d / 1000, mc = m2 / 2;
      const Icm = (mc * d * d) / 8, Ith = mc * x * x + Icm;
      html += `<h3>3. 平行轴定理</h3><p>$T_2$ 平均 ${f(T2)} s。$I_2=\\dfrac{(m_0+2m)gRr}{4\\pi^2H}T_2^2=${f(I2 * 1e3)}\\times10^{-3}$ kg·m²，每个圆柱绕转轴 $I=(I_2-I_0)/2=${f(Ic * 1e3)}\\times10^{-3}$ kg·m²。</p>
        <p>圆柱中心到转轴 $x=\\dfrac{(\\text{外侧间距})-d}{2}=${f(x * 1000, 2)}$ mm。按平行轴定理 $I=I_C+mx^2=\\dfrac{md^2}{8}+mx^2=${f(Ith * 1e3)}\\times10^{-3}$ kg·m²，测量值与之相对偏差 ${pct((Ic - Ith) / Ith, 2)}。其中 $mx^2$ 占 ${pct((mc * x * x) / Ith, 1)}。</p>`;
      tail.push(`每个圆柱的参考值 ${(this.Icyl / 2 * 1e3).toFixed(4)}×10⁻³ kg·m²，相对误差 ${pct(relErr(Ic, this.Icyl / 2), 2)}`);
      answers.push({ label: '$I_{柱}$', unit: '10⁻³ kg·m²', value: Ic * 1e3, digits: 4, tolRel: 0.015 });
      plots.push({ title: '周期比较', xLabel: '组别', yLabel: 'T / s', series: [{ type: 'scatter', data: [[1, T0], [2, mean(T1s.length ? T1s : [T0])], [3, T2]] }] });
    }
    html += `<div class="result-box warn">${tail.join('；')}。</div>`;
    return { html, ok: true, answers, plots: [] };
  }

  principle() {
    return `<h3>1. 三线摆</h3>${trifilarFig()}<p>上、下圆盘由三根等长的细线相连，悬点分别在半径 $r$、$R$ 的圆周上成等边三角形。下盘绕中心轴转过小角 $\\theta$ 时会升高，重力势能增加，下盘作扭转振动。忽略空气阻力，由机械能守恒可得周期</p>$$T=2\\pi\\sqrt{\\frac{IH}{MgRr}}\\quad\\Rightarrow\\quad I=\\frac{MgRr}{4\\pi^2H}T^2$$<p>$M$、$I$ 是下盘（连同放在上面的物体）的质量和对中心轴的转动惯量，$H$ 是两盘间的竖直距离。</p>
<h3>2. 叠加与平行轴定理</h3><p>放上物体后测得总转动惯量 $I_1$，物体的转动惯量 $I=I_1-I_0$。质量为 $m$ 的物体绕平行于质心轴、相距 $x$ 的轴转动时，$I=I_C+mx^2$。均匀圆环 $I=\\dfrac{m}{8}(D_1^2+D_2^2)$，圆柱绕自身轴 $I_C=\\dfrac{md^2}{8}$。</p>
<h3>3. 周期的测量</h3><p>用累积放大法：测 ${NP} 个周期的总时间 $t$，$T=t/${NP}$。秒表本身的误差和人的反应时间（约 0.05 s）被平均到每个周期上只剩约 0.002 s。从平衡位置开始和停止计时，因为这时下盘转得最快，经过标线的时刻判断得最准。</p>
<h3>4. 本仿真的计算模型</h3><p>按悬线长度不变的几何约束写出拉格朗日方程，用四阶龙格–库塔法直接积分，不作小角近似，所以扭转角大时周期会变长（10° 时约长 0.2%）。直接用手扭下盘会同时激起下盘的整体摆动；下盘不水平时，放手后也会有摆动。下盘质量分布不完全均匀，转动惯量与 $m_0R_d^2/2$ 有 ±1% 的差别。秒表按你点击的时刻启停，人的反应时间约有 ±0.035 s 的随机误差。</p>`;
  }
}
