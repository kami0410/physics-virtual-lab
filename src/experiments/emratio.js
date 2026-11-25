// 实验：电子荷质比的测定（精细射束管 + 亥姆霍兹线圈，圆周轨道法）
// 电子束的轨道由 physics/electronorbit.js 在线圈的真实磁场（电流环精确解，非均匀）与地磁场中逐点积分得到；
// 学生调线圈电流，使电子束恰好打在 6、8、10 cm 的标记上。地磁场沿线圈轴的分量使每个测量值都偏，
// 用 1/r–I 直线的斜率求 e/m 可以把它消去（截距就是地磁场的贡献）。
import * as THREE from 'three';
import { meta, thumb } from './emratio.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { mean, rand, relErr, pct, clamp, gauss, fmtU, linFit } from '../core/Stats.js';
import { traceOrbit, helmholtzB0, EM } from '../physics/electronorbit.js';
import { emFig } from './modernFigs.js';

const R = 0.15, N = 130; // 线圈半径（m）、每个线圈的匝数；两线圈间距 = R
const KAPPA = helmholtzB0(N, 1, R); // 中心处每安培的磁感应强度（T/A）
const START = [0.05, -0.04, 0]; // 枪口（m，线圈中心为原点）
const MARKS = [0.02, 0.04, 0.06, 0.08, 0.10]; // 标记离枪口的距离 = 轨道直径
const BULB = { c: [0, 0, 0], r: 0.08 };
const Y0 = 26; // 线圈中心在场景中的高度（cm）
const UV = [200, 250];
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class EMRatioExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.Bh = rand(2.9e-5, 3.6e-5); this.Bv = -rand(3.6e-5, 4.6e-5); // 地磁场水平、竖直分量（T）
    this.theta = Math.round(rand(0, 360)); // 线圈轴与磁北的夹角（°）
    this.heat = false; this.warm = 0; this.U = 0; this.I = 0; this.dir = Math.random() < 0.5 ? 1 : -1; this.mark = 0.08; // 换向开关的初始位置随机
    this.kU = 1 + rand(-0.003, 0.003); this.kI = 1 + rand(-0.002, 0.002); // 电表误差
    this._key = ''; this.orb = null;
  }
  get BE() { const t = (this.theta * Math.PI) / 180; return [this.Bh * Math.sin(t), this.Bv, this.Bh * Math.cos(t)]; }
  coils(I = this.I * this.dir) { return [{ R, N, I, z: -R / 2 }, { R, N, I, z: R / 2 }]; }
  get beamOn() { return this.heat && this.warm > 0.3 && this.U > 20; }
  /** 当前轨道（参数变化时重算） */
  orbit() {
    const key = [this.beamOn, this.U, this.I, this.dir, this.theta].join();
    if (key !== this._key) { this._key = key; this.orb = this.beamOn ? traceOrbit({ U: this.U, coils: this.coils(), BE: this.BE, start: START, dir: [0, 1, 0], bulb: BULB }) : null; }
    return this.orb;
  }
  /** 电子束打到的位置离枪口多远（m）；没形成闭合圆时为 null */
  get hitD() { const o = this.orbit(); return o && o.hitX != null ? START[0] - o.hitX : null; }
  /** 使电子束恰好打到距离 d 的标记所需的电流（A，二分） */
  Ifor(d, U = this.U) {
    let lo = 0.2, hi = 3.5;
    for (let k = 0; k < 34; k++) { const I = (lo + hi) / 2, o = traceOrbit({ U, coils: this.coils(I), BE: this.BE, start: START, dir: [0, 1, 0], n: 240 }); const dd = o.hitX == null ? 1 : START[0] - o.hitX; if (dd > d) lo = I; else hi = I; }
    return (lo + hi) / 2;
  }
  tick(dt) {
    const w0 = this.warm;
    this.warm = this.heat ? Math.min(1, this.warm + dt * (this.app.running ? this.app.speed : 1) / 12) : Math.max(0, this.warm - dt / 4);
    if (w0 !== this.warm) this.app.changed();
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [40, 50, 90], target: [0, Y0, 0] }, { name: '射束管', pos: [0, Y0 + 4, 46], target: [0, Y0, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(140, 70));
    app.stage.setLightTarget(0, Y0, 0);
    const g = (this.rig = new THREE.Group());
    const cu = new THREE.MeshStandardMaterial({ color: 0xb26a3c, metalness: 0.6, roughness: 0.35 });
    for (const z of [-R * 50, R * 50]) { const t = mesh(new THREE.TorusGeometry(R * 100, 1.3, 16, 64), cu, 0, Y0, z); g.add(t); }
    const frame = MAT.paint(0x2b3440);
    g.add(mesh(new THREE.BoxGeometry(40, 2, 26), frame, 0, 1, 0));
    for (const z of [-R * 50, R * 50]) g.add(mesh(new THREE.BoxGeometry(3, Y0 - R * 100 + 1, 3), frame, 0, (Y0 - R * 100 + 1) / 2 + 1, z));
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xe9f2ef, transparent: true, opacity: 0.16, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
    g.add(mesh(new THREE.SphereGeometry(BULB.r * 100, 40, 28), glass, 0, Y0, 0));
    g.add(mesh(new THREE.CylinderGeometry(1.6, 2.2, 8, 20), MAT.black(), 0, Y0 - BULB.r * 100 - 3, 0)); // 管座
    // 电子枪与标记
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.4, 12), MAT.metal(), START[0] * 100, Y0 + START[1] * 100 - 1.3, 0));
    g.add(mesh(new THREE.BoxGeometry(11, 0.25, 0.25), MAT.metal(), START[0] * 100 - 5.5, Y0 + START[1] * 100 - 0.6, 0));
    const glowM = new THREE.MeshBasicMaterial({ color: 0x9be7c4 });
    for (const d of MARKS) g.add(mesh(new THREE.BoxGeometry(0.25, 0.9, 0.5), glowM, (START[0] - d) * 100, Y0 + START[1] * 100 - 0.2, 0));
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beam = new THREE.Mesh(new THREE.BufferGeometry(), this.beamMat); this.beam.userData.noHL = true; g.add(this.beam);
    app.addComponent(new Component({
      key: 'tube', name: '射束管与亥姆霍兹线圈', zone: 'none', fixed: true, required: true, object: g, labelY: Y0 + 20,
      icon: SVG('<circle cx="32" cy="20" r="13" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="32" cy="20" r="7" fill="none" stroke="currentColor" stroke-dasharray="2 2"/>'),
      desc: `球形精细射束管内充有低压氢气，电子枪竖直向上发射电子，电子与气体分子碰撞发光，显出轨迹。枪口所在的水平线上有离枪口 2、4、6、8、10 cm 的发光标记。管外一对亥姆霍兹线圈（半径 ${R * 100} cm，每个 ${N} 匝，间距等于半径）产生垂直于轨道平面的磁场。`,
      controls: () => [
        { type: 'knob', label: '仪器朝向（线圈轴与磁北的夹角）', get: () => this.theta, set: (v) => { this.theta = ((Math.round(v) % 360) + 360) % 360; app.changed(); }, min: 0, max: 359, step: 1, bigStep: 15, perRev: 90, digits: 0, unit: '°' },
      ],
    }));
    const mu = (this.mU = meterBox(14, 8, 10, '加速电压 U')), mi = (this.mI = meterBox(14, 8, 10, '线圈电流 I'));
    mu.group.position.set(34, 0, 8); mi.group.position.set(50, 0, 8);
    const box = new THREE.Group(); box.add(mu.group, mi.group);
    app.addComponent(new Component({
      key: 'supply', name: '电源', zone: 'none', fixed: true, object: box, labelY: 12,
      desc: '射束管电源：灯丝电压固定（6.3 V），加速电压 0–300 V；线圈电源：电流 0–3 A，带换向开关。两块数字表分别显示加速电压与线圈电流。',
      controls: () => [
        { type: 'toggle', label: '灯丝（预热约 10 s）', get: () => this.heat, set: (v) => { this.heat = v; app.changed(); } },
        { type: 'knob', label: '加速电压', get: () => this.U, set: (v) => { this.U = clamp(Math.round(v), 0, 300); app.changed(); }, min: 0, max: 300, step: 1, bigStep: 10, perRev: 50, digits: 0, unit: 'V' },
        { type: 'knob', label: '线圈电流', get: () => this.I, set: (v) => { this.I = clamp(Math.round(v * 1000) / 1000, 0, 3); app.changed(); }, min: 0, max: 3, step: 0.002, bigStep: 0.1, perRev: 0.5, digits: 3, unit: 'A' },
        { type: 'segment', label: '线圈电流方向', get: () => this.dir, set: (v) => { this.dir = +v; app.changed(); }, options: [{ label: '正向', value: 1 }, { label: '反向', value: -1 }] },
      ],
    }));
    this.fv = app.addView({ id: 'front', title: '正视射束管（沿线圈轴看）', w: 280, h: 280, res: 1.6 });
  }
  update() {
    const o = this.orbit();
    const su = this.U.toFixed(0), si = this.I.toFixed(3);
    if (su !== this._su) { this._su = su; this.mU.setText((this.U * this.kU).toFixed(0), 'V'); }
    if (si !== this._si || this.dir !== this._sd) { this._si = si; this._sd = this.dir; this.mI.setText((this.I * this.kI).toFixed(3), 'A', this.dir > 0 ? '正向' : '反向'); }
    if (o !== this._o) {
      this._o = o; this.beam.geometry.dispose();
      if (o && o.pts.length > 3) {
        const pts = o.pts.filter((_, i) => i % 3 === 0).map((p) => new THREE.Vector3(p[0] * 100, Y0 + p[1] * 100, p[2] * 100));
        this.beam.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.min(400, pts.length * 2), 0.14, 6, false);
      } else this.beam.geometry = new THREE.BufferGeometry();
    }
    this.beamMat.opacity = 0.85 * clamp((this.warm - 0.3) / 0.7, 0, 1);
    this.drawFront(o);
  }
  drawFront(o) {
    const v = this.fv, g = v.ctx, W = v.W, H = v.H, s = (W * 0.42) / BULB.r, cx = W / 2, cy = H * 0.5;
    const P = (x, y) => [cx + x * s, cy - y * s];
    g.fillStyle = '#07090c'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(200,220,215,.35)'; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, BULB.r * s, 0, 7); g.stroke();
    const [gx, gy] = P(START[0], START[1]);
    g.fillStyle = '#5b6470'; g.fillRect(gx - 4, gy, 8, 16);
    g.strokeStyle = '#3d454f'; g.lineWidth = 2; g.beginPath(); g.moveTo(gx, gy + 3); g.lineTo(P(START[0] - 0.105, 0)[0], gy + 3); g.stroke();
    g.fillStyle = '#9be7c4'; g.font = `${H * 0.034}px "IBM Plex Mono"`; g.textAlign = 'center';
    for (const d of MARKS) { const [x] = P(START[0] - d, 0); g.fillRect(x - 1.2, gy - 2, 2.4, 6); g.fillText(String(d * 100), x, gy + 18); }
    if (o) {
      const a = clamp((this.warm - 0.3) / 0.7, 0, 1);
      for (const [w, al] of [[5, 0.12], [2.2, 0.5], [1, 0.9]]) {
        g.strokeStyle = `rgba(120,210,255,${al * a})`; g.lineWidth = w; g.beginPath();
        o.pts.forEach((p, i) => { const [x, y] = P(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      }
    }
    let foot;
    if (!this.heat) foot = '灯丝没有加热';
    else if (this.warm < 0.3) foot = '灯丝预热中……';
    else if (this.U <= 20) foot = '加速电压太低，看不到电子束';
    else if (!o || (o.end === 'glass' && o.hitX == null)) foot = this.I < 0.2 ? '电子束几乎是直线，打到玻璃壁上：给线圈通电流' : '电子束偏转后打到玻璃壁上：检查电流方向，或加大电流';
    else if (o.hitX == null) foot = '电子束弯成的圆太小，没有回到标记所在的高度';
    else { const d = this.hitD * 100; foot = `电子束在 ${d.toFixed(1)} cm 附近回到枪口高度${MARKS.some((m) => Math.abs(m * 100 - d) < 0.12) ? '，恰好打在标记上' : ''}`; }
    v.foot(foot);
  }
  globalControls() {
    return [{ type: 'segment', label: '对准的标记（轨道直径）', get: () => this.mark, set: (v) => { this.mark = +v; this.app.changed(); }, options: MARKS.slice(1).map((d) => ({ label: `${d * 100} cm`, value: d })) }];
  }

  // ======================= 数据表 =======================
  tables() {
    return [{
      id: 'em', title: '加速电压、轨道直径与线圈电流', maxRows: 10,
      columns: [
        { key: 'U', label: 'U/V', digits: 0, readTol: 0.6 },
        { key: 'd', label: '直径 D/cm', digits: 1, readonly: true },
        { key: 'I', label: 'I/A', digits: 3, readTol: 0.0006 },
        { key: 'B', label: 'B₀/mT', digits: 3, calc: (r) => KAPPA * r.I * 1000 },
        { key: 'em', label: 'e/m /(10¹¹ C/kg)', digits: 3, calc: (r) => (8 * r.U) / (KAPPA * KAPPA * r.I * r.I * (r.d / 100) ** 2) / 1e11 },
      ],
      buttons: [{ label: '记录 U、I（当前对准的标记）', onClick: (t) => this.rec(t) }],
      note: `B₀ = (4/5)^{3/2} μ₀NI/R = ${(KAPPA * 1000).toFixed(4)} mT/A × I。每个加速电压下，使电子束依次打在 6、8、10 cm 的标记上，记下电流。`,
    }];
  }
  rec(t) {
    const a = this.app, d = this.hitD;
    if (!this.beamOn) return a.toast('看不到电子束：打开灯丝，加上加速电压', 'warn');
    if (d == null) return a.toast('电子束没有回到枪口高度（没有形成完整的半圆），不能读直径', 'warn');
    if (Math.abs(d - this.mark) > 0.0015) a.toast(`电子束打在 ${(d * 100).toFixed(1)} cm 处，没有对准 ${this.mark * 100} cm 的标记`, 'warn');
    if (t.rows.some((r) => Math.abs(r.U - this.U * this.kU) < 1 && r.d === this.mark * 100)) a.toast('这个电压、这个标记已经测过了', 'warn');
    t.addRow({ U: Math.round(this.U * this.kU), d: this.mark * 100, I: Math.round(this.I * this.kI * 1000) / 1000 });
  }

  // ======================= 自动操作 =======================
  async knob(get, set, to, ms = 600) { await this.app.tween(get, set, to, ms); set(to); this.app.changed(); }
  async measure(U) {
    const a = this.app;
    a.select(a.comp('supply'));
    await this.knob(() => this.U, (v) => (this.U = Math.round(v)), U);
    for (const d of [0.06, 0.08, 0.10]) {
      if (a.table('em').rows.some((r) => Math.abs(r.U - U) < 3 && r.d === d * 100)) continue;
      this.mark = d; a.renderInspector();
      await this.knob(() => this.I, (v) => (this.I = v), Math.round((this.Ifor(d) + gauss(0.002)) * 1000) / 1000, 700);
      await a.wait(300); await a.record('em', 0);
    }
  }
  steps() {
    const app = this.app, rows = (U) => app.table('em').rows.filter((r) => isFinite(r.I) && r.I > 0 && (U == null || Math.abs(r.U - U) < 5));
    const dset = (U) => new Set(rows(U).map((r) => r.d)).size;
    const orbitDiag = () => {
      const out = [], o = this.orbit();
      if (!this.heat) return [{ msg: '灯丝没有打开，管内没有电子。', fix: { label: '打开灯丝', run: async () => { this.heat = true; } } }];
      if (this.U < 100) return [{ msg: `加速电压 ${this.U} V 太低，电子束暗且容易散开。调到 200 V。`, fix: { label: '调到 200 V', run: () => this.knob(() => this.U, (v) => (this.U = Math.round(v)), 200) } }];
      if (o && o.end === 'glass' && o.hitX == null && this.I > 0.3) {
        const op = traceOrbit({ U: this.U, coils: this.coils(this.I * -this.dir), BE: this.BE, start: START, dir: [0, 1, 0], bulb: BULB });
        if (op.hitX != null) out.push({ msg: '电子束向右弯、打到玻璃上了：线圈电流方向反了，洛伦兹力指向另一侧。把换向开关拨到另一边。', fix: { label: '换向', run: async () => { this.dir = -this.dir; } } });
        else out.push({ msg: '电流太小，电子束弯得不够，打到了玻璃壁上。加大线圈电流。' });
      } else if (!o || this.I < 0.3) out.push({ msg: '线圈没有电流（或很小），电子束是直线。加线圈电流。' });
      const d = this.hitD;
      if (d != null && Math.abs(d - this.mark) > 0.0015) out.push({ msg: `电子束打在 ${(d * 100).toFixed(1)} cm 处，要对准 ${this.mark * 100} cm 的标记：电流${d > this.mark ? '加大' : '减小'}一点（电流越大，圆越小）。`, fix: { label: '帮我对准', run: () => this.knob(() => this.I, (v) => (this.I = v), Math.round(this.Ifor(this.mark) * 1000) / 1000) } });
      return out;
    };
    return [
      {
        title: '加热灯丝，加上加速电压',
        html: '<p>打开灯丝，预热约 10 s，把加速电压调到 200 V。管内出现一条竖直向上的淡蓝色电子束（线圈不通电时，电子束只受很弱的地磁场作用，几乎是直线）。</p>',
        status: () => `${this.heat ? (this.warm < 1 ? '预热中' : '灯丝已热') : '灯丝关'}，U = ${this.U} V`,
        check: () => this.beamOn && this.warm >= 1 && Math.abs(this.U - 200) <= 10,
        diagnose: orbitDiag,
        auto: async () => {
          await app.view('全景'); app.select(app.comp('supply'));
          this.heat = true; app.renderInspector();
          await this.knob(() => this.U, (v) => (this.U = Math.round(v)), 200);
          await app.until(() => this.warm >= 1, 30000);
        },
      },
      {
        title: '给线圈通电流，使电子束弯成圆',
        html: '<p>慢慢加大线圈电流，电子束在洛伦兹力作用下弯成圆。如果电子束向另一侧弯、打到玻璃上，说明电流方向反了，用换向开关改过来。</p>',
        check: () => this.hitD != null,
        diagnose: orbitDiag,
        auto: async () => {
          await app.view('射束管'); app.select(app.comp('supply'));
          if (this.dir < 0 && traceOrbit({ U: this.U, coils: this.coils(1.4), BE: this.BE, start: START, dir: [0, 1, 0], bulb: BULB }).hitX == null) { this.dir = 1; app.renderInspector(); }
          await this.knob(() => this.I, (v) => (this.I = v), 1.4, 900);
          if (this.hitD == null) { this.dir = -this.dir; app.renderInspector(); await app.wait(300); }
        },
      },
      {
        title: `U = ${UV[0]} V：对准 6、8、10 cm 三个标记`,
        html: `<p>加速电压 ${UV[0]} V。在“测量与读数”里选择要对准的标记，调线圈电流使电子束恰好打在标记中心（视线与射束管正对，避免视差），记下电流。三个标记都测。</p>`,
        hint: '电流越大，磁场越强，圆越小。接近标记时用小步长微调。',
        status: () => `已测 ${dset(UV[0])} / 3 个标记`,
        check: () => dset(UV[0]) >= 3,
        diagnose: orbitDiag,
        auto: async () => { app.showTable(0); await this.measure(UV[0]); },
      },
      {
        title: `U = ${UV[1]} V：再测三个标记`,
        html: `<p>把加速电压改为 ${UV[1]} V，重复上一步。</p>`,
        status: () => `已测 ${dset(UV[1])} / 3 个标记`,
        check: () => dset(UV[1]) >= 3,
        diagnose: orbitDiag,
        auto: async () => { app.showTable(0); await this.measure(UV[1]); },
      },
      {
        title: '数据处理',
        html: '<p>每个加速电压下作 $1/r$–$I$ 图，由斜率求 $e/m$；与逐点用公式算出的结果比较，并估计地磁场的影响。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const all = this.app.table('em').rows.filter((r) => isFinite(r.U) && isFinite(r.I) && isFinite(r.d) && r.I > 0 && r.U > 0);
    if (!all.length) return { html: '<p>请先测量。</p>', ok: false };
    const pt = all.map((r) => (8 * r.U) / (KAPPA * KAPPA * r.I * r.I * (r.d / 100) ** 2));
    const groups = [...new Set(all.map((r) => Math.round(r.U / 5) * 5))].map((U) => ({ U, rows: all.filter((r) => Math.abs(r.U - U) < 5) })).filter((gp) => new Set(gp.rows.map((r) => r.d)).size >= 2);
    let html = `<h3>1. 逐点计算</h3><p>$\\dfrac em=\\dfrac{2U}{B^2r^2}=\\dfrac{8U}{B^2D^2}$，$B=${(KAPPA * 1000).toFixed(4)}\\,\\text{mT/A}\\times I$。</p>
      <table><tr><th>U/V</th><th>D/cm</th><th>I/A</th><th>B/mT</th><th>e/m /(10¹¹ C/kg)</th></tr>${all.map((r, i) => `<tr><td>${r.U}</td><td>${r.d}</td><td>${r.I.toFixed(3)}</td><td>${(KAPPA * r.I * 1000).toFixed(3)}</td><td>${(pt[i] / 1e11).toFixed(3)}</td></tr>`).join('')}</table>
      <p>逐点平均：${(mean(pt) / 1e11).toFixed(3)}×10¹¹ C/kg。逐点计算的结果里含有地磁场的影响：地磁场沿线圈轴的分量 $B_E$ 与线圈磁场叠加，实际磁场是 $\\kappa I+B_E$。</p>`;
    let em = mean(pt), uem = 0;
    const plots = [];
    if (groups.length) {
      html += '<h3>2. 作图法消去地磁场</h3><p>$\\dfrac1r=\\sqrt{\\dfrac e{2mU}}\\,(\\kappa I+B_E)$：$1/r$ 与 $I$ 成直线，斜率 $k=\\kappa\\sqrt{e/(2mU)}$，与地磁场无关；截距反映地磁场。</p><table><tr><th>U/V</th><th>斜率 k /(m⁻¹A⁻¹)</th><th>截距 /m⁻¹</th><th>e/m = 2Uk²/κ² /(10¹¹ C/kg)</th><th>B_E = κ·截距/k /μT</th></tr>';
      const ems = [];
      for (const gp of groups) {
        const f = linFit(gp.rows.map((r) => r.I), gp.rows.map((r) => 200 / r.d)), e = (2 * gp.U * f.k * f.k) / (KAPPA * KAPPA);
        ems.push({ e, u: (2 * e * f.uk) / f.k });
        html += `<tr><td>${gp.U}</td><td>${f.k.toFixed(3)}</td><td>${f.b.toFixed(3)}</td><td>${(e / 1e11).toFixed(4)}</td><td>${((KAPPA * f.b) / f.k * 1e6).toFixed(1)}</td></tr>`;
        plots.push({ title: `1/r–I（U = ${gp.U} V）`, xLabel: 'I / A', yLabel: '1/r / m⁻¹', series: [{ type: 'scatter', data: gp.rows.map((r) => [r.I, 200 / r.d]), label: '实验点' }, { type: 'line', data: [0, Math.max(...gp.rows.map((r) => r.I)) * 1.05].map((x) => [x, f.k * x + f.b]), label: '拟合直线' }] });
      }
      html += '</table>';
      em = mean(ems.map((x) => x.e)); uem = Math.sqrt(ems.reduce((s, x) => s + x.u * x.u, 0)) / ems.length;
      html += `<div class="result-box">$e/m=${fmtU(em / 1e11, uem / 1e11)}\\times10^{11}$ C/kg（作图法）</div>`;
    } else html += `<div class="result-box">$e/m=${(em / 1e11).toFixed(3)}\\times10^{11}$ C/kg（逐点平均；同一电压下测 2 个以上标记才能用作图法）</div>`;
    html += `<p>其余误差来源：线圈磁场并不均匀——轨道上大部分点离线圈中心几厘米，磁场比中心略弱（约 0.3%），使 e/m 偏小；读电流时电子束对标记的判断；电表误差。</p>`;
    html += `<div class="result-box warn">公认值 e/m = 1.7588×10¹¹ C/kg，测量值相对误差 ${pct(relErr(em, EM), 2)}。</div>`;
    return { html, ok: true, answers: [{ label: '$e/m$', unit: '×10¹¹ C/kg', value: em / 1e11, digits: 3, tolRel: 0.004 }], plots };
  }

  principle() {
    return `<h3>1. 电子在均匀磁场中的圆周运动</h3>${emFig()}<p>电子经电压 $U$ 加速后速度为 $v$：$\\frac12mv^2=eU$。垂直射入磁感应强度为 $B$ 的均匀磁场，洛伦兹力提供向心力：$evB=\\dfrac{mv^2}r$。消去 $v$ 得</p>$$\\frac em=\\frac{2U}{B^2r^2}$$
<h3>2. 亥姆霍兹线圈</h3><p>两个半径为 $R$、匝数为 $N$ 的共轴线圈，间距等于 $R$，通以同向电流 $I$ 时，中心附近的磁场相当均匀：</p>$$B_0=\\left(\\frac45\\right)^{3/2}\\frac{\\mu_0NI}R$$
<h3>3. 测量方法</h3><p>电子枪竖直向上发射，电子束弯成圆后回到枪口高度，打在离枪口距离等于轨道直径 $D=2r$ 的地方。管内在这条水平线上有 2、4、6、8、10 cm 的标记，调电流使电子束打在标记上，就知道了 $r$。</p>
<h3>4. 本仿真的计算模型</h3><p>磁场按两个线圈的电流环精确公式（广义完全椭圆积分）逐点计算，并叠加地磁场（水平分量约 3×10⁻⁵ T，竖直分量约 4×10⁻⁵ T，随仪器朝向改变）。电子的运动用 Boris 算法积分相对论运动方程，所以电子束的形状包含了磁场不均匀、地磁场使轨道略成螺旋等真实效应。</p>`;
  }
}
