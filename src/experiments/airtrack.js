// 实验：气垫导轨上的碰撞——验证动量守恒定律
// 滑块运动、碰撞和光电门计时都由 physics/airtrack.js 计算：气膜黏性阻力 F = −b·v、导轨倾斜的重力分量、
// 按恢复系数处理的一维碰撞；计时器记下的是挡光片两齿前沿先后挡光的时间间隔（由子步插值得到，精确到 0.01 ms）。
// 导轨的调平螺钉有随机的初始偏差；没调平时，静止放着的滑块会自己慢慢滑动，碰撞前滑块 2 也不再静止。
import * as THREE from 'three';
import { meta, thumb } from './airtrack.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox, canvasTexture } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss } from '../core/Stats.js';
import { AirTrack, Glider } from '../physics/airtrack.js';
import { airtrackFig } from './mechFigs2.js';

const L = 1.5, GX = [0.5, 1.0], X1 = 0.2, X2 = 0.75; // 导轨长、两光电门的默认位置、两滑块的起始位置（m）
const GLEN = 0.21, FLAG = 0.007; // 滑块长、挡光片半宽（m）
const FEET = 1.2; // 两端支脚间距（m），调平螺钉在右端
const TY = 14; // 导轨棱顶的高度（cm）
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;
const KINDS = { e1: '弹性 m₁≈m₂', e2: '弹性 m₁>m₂', e3: '弹性 m₁<m₂', in: '完全非弹性' };
const NREP = 3;
const X3 = (x) => (x - L / 2) * 100;

export class AirTrackExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.s0 = rand(0.35, 0.8) * (Math.random() < 0.5 ? -1 : 1); // 螺钉在这个位置时导轨才水平（mm）
    this.screw = 0;
    this.track = new AirTrack({ L, gates: GX, b: rand(2.2e-3, 2.8e-3) });
    this.track.air = false;
    this.mBase = [rand(178, 186) / 1000, rand(178, 186) / 1000];
    this.mW = [0, 1].map(() => (50 + gauss(0.02)) / 1000); // 一对配重中每块的质量
    this.w = [0, 0]; // 两滑块上加的配重块数（0 或 2）
    this.mode = 'spring';
    this.vp = 0.45; this.timeScale = 1; this.shot = null;
    this.g = [new Glider({ m: this.mass(0), x: X1, len: 0.21 }), new Glider({ m: this.mass(1), x: X2, len: 0.21 })];
    this.track.gliders.push(...this.g);
    this.track.gates.forEach((q) => (q.x = -1)); // 光电门还没装到导轨上
    this.gSync = [X1 * 100, X2 * 100];
    this.applyCfg();
  }
  /** 装在导轨上的光电门，按位置从左到右排（m）；没装的不算 */
  gateXs() { return ['gate1', 'gate2'].map((k) => this.app.comp(k)).filter((c) => c && c.placed).map((c) => c.pos / 100).sort((p, q) => p - q); }
  /** 按位置排序后的计时器记录（左门、右门） */
  gs() { return [...this.track.gates].filter((q) => q.x >= 0).sort((p, q) => p.x - q.x); }
  /** 两光电门和滑块的摆放是否能测出一次完整的碰撞；返回问题说明或 null */
  layoutIssue() {
    const xs = this.gateXs(), [g1, g2] = this.g;
    if (xs.length < 2) return '导轨上要装两个光电门';
    const [a, b] = xs;
    if (b - a < GLEN + 0.06) return `两光电门只相距 ${((b - a) * 100).toFixed(1)} cm：滑块 2 放在中间时，滑块 1 的挡光片还没过完光电门 1 就撞上了。至少要隔开约 ${Math.ceil((GLEN + 0.06) * 100)} cm`;
    if (a < 0.3) return `左边的光电门离导轨左端只有 ${(a * 100).toFixed(1)} cm：滑块 1 没有地方起步`;
    if (b > L - GLEN / 2 - 0.03) return `右边的光电门太靠近右端（${(b * 100).toFixed(1)} cm）：滑块 2 过门之前就撞到缓冲器上了`;
    if (g1.x + FLAG > a - 0.005) return '滑块 1 要放在左边光电门的左侧，推出后先通过光电门 1';
    if (g2.x - GLEN - FLAG < a + 0.005) return '滑块 2 离光电门 1 太近：滑块 1 的挡光片还没完全通过光电门 1 就撞上了。把滑块 2 往右挪';
    if (g2.x + FLAG > b - 0.005) return '滑块 2 已经在光电门 2 的右边（或正挡着它）：要放在两光电门之间';
    return null;
  }
  /** 把滑块 i 放到导轨上 x 处（m），静止；与另一滑块重叠时贴着它放 */
  dropAt(i, x) {
    const g = this.g[i], o = this.g[1 - i];
    x = clamp(x, GLEN / 2, L - GLEN / 2);
    if (Math.abs(x - o.x) < GLEN) x = x < o.x ? o.x - GLEN : o.x + GLEN;
    if (x < GLEN / 2 || x > L - GLEN / 2) x = clamp(x < o.x ? o.x - GLEN - 0.001 : o.x + GLEN + 0.001, GLEN / 2, L - GLEN / 2);
    g.x = x; g.v = 0; g.held = false; g.joined = null; o.joined = null;
    this.gSync[i] = x * 100;
    const c = this.app.comp && this.app.comp('g' + (i + 1)); if (c) c.pos = x * 100;
    this.app.changed();
  }
  mass(i) { return this.mBase[i] + this.w[i] * this.mW[0]; }
  applyCfg() { this.g.forEach((g, i) => (g.m = this.mass(i))); this.track.e = this.mode === 'spring' ? 0.97 : 0; }
  get theta() { return (this.screw - this.s0) / 1000 / FEET; }
  get level() { return Math.abs(this.theta) < 1.5e-5; }
  get kind() { return this.mode !== 'spring' ? 'in' : Math.abs(this.mass(0) - this.mass(1)) < 0.02 ? 'e1' : this.mass(0) > this.mass(1) ? 'e2' : 'e3'; }

  tick(dt) {
    const a = this.app, sdt = Math.min(0.25, dt * (a.running ? a.speed : this.timeScale));
    if (!(sdt > 0)) return;
    this.track.theta = this.theta;
    const moving = this.track.air && this.g.some((g) => !g.held && (Math.abs(g.v) > 1e-6 || Math.abs(this.theta) > 1e-9));
    this.track.step(sdt);
    if (moving) a.changed();
  }

  // ======================= 操作 =======================
  /** 自动操作：按当前光电门位置摆好两个滑块 */
  placeG1() { const xs = this.gateXs(); this.dropAt(0, Math.max(GLEN / 2 + 0.01, (xs[0] ?? GX[0]) - 0.22)); }
  placeG2() {
    const xs = this.gateXs(), a = xs[0] ?? GX[0], b = xs[1] ?? GX[1];
    const lo = a + GLEN + FLAG + 0.02, hi = b - FLAG - 0.02;
    if (this.g[0].x > a - 0.05) this.placeG1();
    this.dropAt(1, lo < hi ? lo + (hi - lo) * 0.4 : (a + b) / 2);
  }
  resetTimer() { this.track.resetTimer(); this.track.cols = []; this.app.changed(); }
  push() {
    const a = this.app, g = this.g[0];
    if (!this.track.air) return a.toast('气泵没开：滑块压在导轨上推不动，硬推会划伤导轨', 'warn');
    if (Math.abs(g.v) > 0.02) return a.toast('滑块 1 还在运动，先让它停下', 'warn');
    const li = this.layoutIssue(); if (li) a.toast(li, 'warn');
    if (this.track.gates.some((q) => q.log.length)) a.toast('计时器里还有上一次的数据，记得先复位', 'warn');
    this.shot = { m1: this.mass(0), m2: this.mass(1), kind: this.kind, t: this.track.t };
    g.v = this.vp * (1 + gauss(0.04));
    a.changed();
  }
  /** 计时器第 gi 个光电门的记忆（显示值，ms） */
  mem(gi) { return this.track.gates[gi].log.map((l) => Math.round(l.dt * 1e5) / 100); }
  canPlace(c) {
    if ((c.key === 'gate1' || c.key === 'gate2') && this.g.some((g) => Math.abs(g.v) > 0.02)) return '滑块在运动，等它停下再装光电门';
    return null;
  }
  /** 从计时器记忆中找出本次碰撞的三个时间（按挡光的滑块和方向区分，这在实验中由学生观察判断） */
  times() {
    const [G1, G2] = this.gs().length === 2 ? this.gs() : [{ log: [] }, { log: [] }], t0 = this.shot ? this.shot.t : -1;
    const r = (l) => (l ? Math.round(l.dt * 1e5) / 100 : NaN);
    const before = G1.log.find((l) => l.glider === 0 && l.dir > 0 && l.t > t0);
    const col = this.track.cols.find((c) => c.t > t0);
    const after1 = col && [...G2.log, ...G1.log].filter((l) => l.glider === 0 && l.t > col.t).sort((p, q) => p.t - q.t)[0];
    const after2 = col && G2.log.find((l) => l.glider === 1 && l.dir > 0 && l.t > col.t);
    return { t10: r(before), t1: r(after1), d1: after1 ? after1.dir : 1, t2: r(after2), col, n1: G1.log.filter((l) => l.glider === 0 && l.dir > 0).length };
  }
  /** 本次碰撞的数据是否都出来了 */
  trialDone() {
    const s = this.times(), g1 = this.g[0];
    return isFinite(s.t10) && isFinite(s.t2) && (isFinite(s.t1) || g1.held || Math.abs(g1.v) < 0.02);
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [-20, 95, 175], target: [0, 8, 0] }, { name: '碰撞区', pos: [5, 42, 92], target: [5, 12, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(200, 80));
    app.stage.setLightTarget(0, 12, 0);
    // ---- 导轨 ----
    const tr = new THREE.Group(), half = 4.2 / Math.SQRT2;
    const holes = canvasTexture(1024, 64, (c, W, H) => { c.fillStyle = '#b9c1ca'; c.fillRect(0, 0, W, H); c.fillStyle = '#47505a'; for (let x = 6; x < W; x += 13.6) for (const y of [18, 46]) { c.beginPath(); c.arc(x, y, 2.2, 0, 7); c.fill(); } });
    const beam = mesh(new THREE.BoxGeometry(150, 4.2, 4.2), new THREE.MeshStandardMaterial({ map: holes, metalness: 0.6, roughness: 0.35 }), 0, TY - half, 0);
    beam.rotation.x = Math.PI / 4; tr.add(beam);
    tr.add(mesh(new THREE.BoxGeometry(150, 1.6, 7), MAT.paint(0x56606b), 0, TY - 2 * half - 0.8, 0));
    for (const x of [-75.4, 75.4]) tr.add(mesh(new THREE.BoxGeometry(0.8, 4, 6), MAT.dark(), x, TY - half, 0)); // 端头缓冲器
    this.legR = new THREE.Group(); tr.add(this.legR);
    const yb = TY - 2 * half - 1.6;
    tr.add(mesh(new THREE.CylinderGeometry(0.5, 0.6, yb, 12), MAT.metal(), -60, yb / 2, 0));
    for (const z of [-2.5, 2.5]) this.legR.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, yb, 12), MAT.metal(), 60, yb / 2, z));
    this.screwKnob = mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.8, 16), MAT.black(), 60, 1.5, 0); tr.add(this.screwKnob);
    // 导轨侧面的米尺（cm）
    const scaleTex = canvasTexture(2048, 64, (c, W, H) => {
      c.fillStyle = '#e8e2cf'; c.fillRect(0, 0, W, H); c.fillStyle = '#222'; c.font = '22px Consolas'; c.textAlign = 'center';
      for (let cm = 0; cm <= 150; cm++) { const x = (cm / 150) * (W - 8) + 4, t = cm % 10 === 0 ? 30 : cm % 5 === 0 ? 20 : 11; c.fillRect(x - 1, 0, 2, t); if (cm % 10 === 0) c.fillText(String(cm), Math.min(W - 18, Math.max(18, x)), 56); }
    });
    const sc = mesh(new THREE.PlaneGeometry(150, 2.2), new THREE.MeshStandardMaterial({ map: scaleTex, roughness: 0.7 }), 0, TY - 2 * half - 0.4, 3.52); tr.add(sc);
    // 光电门（装在导轨上，可沿导轨移动）
    this.leds = [];
    app.addRail({ id: 'gate', origin: new THREE.Vector3(X3(0), 0, 0), min: 8, max: 142, accepts: ['gate1', 'gate2'] });
    app.addRail({ id: 'glide', origin: new THREE.Vector3(X3(0), 0, 0), min: GLEN * 50, max: L * 100 - GLEN * 50, accepts: ['g1', 'g2'] });
    [0, 1].forEach((k) => {
      const f = new THREE.Group(), m = MAT.paint(k ? 0x3a4d3a : 0x2d3a46);
      f.add(mesh(new THREE.BoxGeometry(1.2, 15, 1.2), m, 0, TY - 3.5, -6.5));
      f.add(mesh(new THREE.BoxGeometry(1.2, 1.2, 11.5), m, 0, TY + 5, -1.3));
      for (const z of [-3.6, 3.6]) f.add(mesh(new THREE.BoxGeometry(1, 2.6, 1), m, 0, TY + 3.4, z));
      f.add(mesh(new THREE.BoxGeometry(3, 1.4, 9), m, 0, TY - 10.6, -4)); // 夹在导轨底座上的滑块
      f.add(mesh(new THREE.BoxGeometry(0.15, 3, 0.15), MAT.paint(0xc41e3a), 0, TY - 2 * half - 0.4, 3.7)); // 对米尺的指针
      const led = mesh(new THREE.SphereGeometry(0.22, 10, 8), MAT.emissive(0xff3b30, 1.2), 0, TY + 3, -3.05); f.add(led); this.leds.push(led);
      app.addComponent(new Component({
        key: 'gate' + (k + 1), name: `光电门 ${k + 1}`, zone: 'rail', rail: 'gate', defaultPos: GX[k] * 100, required: true, object: f, labelY: TY + 9,
        icon: SVG('<path d="M20 34V8h24v26" stroke="currentColor" fill="none" stroke-width="3"/><circle cx="32" cy="14" r="2.5" fill="currentColor"/>'),
        desc: '夹在导轨底座上，可沿导轨移动；读数看红色指针对着的米尺刻度。挡光片的齿依次挡住光束，计时器记下两次挡光的间隔。两个门离碰撞点越近，碰前碰后测速受气膜阻力的影响越小，但滑块 2 必须能放在两门之间、滑块 1 的挡光片要在碰撞前完全通过左边的门。',
        controls: () => [{ type: 'readout', label: '位置（米尺读数）', get: () => `${this.app.comp('gate' + (k + 1)).pos.toFixed(1)} cm` }],
      }));
    });
    // 气泵
    const pump = mesh(new THREE.BoxGeometry(14, 10, 11), MAT.paint(0x8c8f88), 65, 5, -26); tr.add(pump);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(60, 8, -21), new THREE.Vector3(66, 10, -12), new THREE.Vector3(76, 11, -3), new THREE.Vector3(76, TY - 3, 0)]), 30, 0.6, 8), MAT.black());
    tr.add(hose);
    this.pumpLed = mesh(new THREE.SphereGeometry(0.35, 10, 8), MAT.emissive(0x3ecf6c, 0), 61, 8, -20.4); tr.add(this.pumpLed);
    app.addComponent(new Component({
      key: 'track', name: '气垫导轨与气泵', zone: 'none', fixed: true, required: true, object: tr, labelY: TY + 8,
      icon: SVG('<path d="M4 26h56M8 26l24-10 24 10" stroke="currentColor" fill="none" stroke-width="1.5"/><path d="M10 32v4M54 32v4" stroke="currentColor"/>'),
      desc: '导轨长 1.5 m，侧面有米尺。表面有两排小孔，气泵送气后在导轨与滑块之间形成约 0.1 mm 的气膜，滑块几乎无摩擦地运动。右端支脚上有调平螺钉（螺距 0.5 mm）。光电门从器材柜装到导轨上，位置自己定；滑块可以直接在导轨上拖动摆放。',
      controls: () => [
        { type: 'toggle', label: '气泵', get: () => this.track.air, set: (v) => { this.track.air = v; if (!v) this.g.forEach((g) => (g.v = 0)); app.changed(); } },
        { type: 'knob', label: '调平螺钉（右端）', get: () => this.screw, set: (v) => { this.screw = clamp(Math.round(v * 1000) / 1000, -2, 2); app.changed(); }, min: -2, max: 2, step: 0.005, bigStep: 0.1, perRev: 0.5, fmt: () => '转动螺钉升降右端' },
        { type: 'segment', label: '滑块相碰的一端装', get: () => this.mode, set: (v) => { this.mode = v; this.applyCfg(); app.changed(); }, options: [{ label: '弹簧圈（弹性碰撞）', value: 'spring' }, { label: '尼龙搭扣（完全非弹性）', value: 'velcro' }] },
      ],
    }));
    // ---- 滑块 ----
    this.gm = [0, 1].map((i) => {
      const g = new THREE.Group(), col = i === 0 ? 0x8a5a44 : 0x4e6f86, m = MAT.paint(col);
      for (const s of [-1, 1]) { const p = mesh(new THREE.BoxGeometry(20, 0.35, 4.4), m, 0, TY - 1.56 + 0.25, s * 1.81); p.rotation.x = s * Math.PI / 4; g.add(p); }
      g.add(mesh(new THREE.BoxGeometry(20, 0.4, 2.2), m, 0, TY + 0.5, 0));
      const fl = MAT.dark();
      g.add(mesh(new THREE.BoxGeometry(1.4, 0.4, 0.1), fl, 0, TY + 0.9, 0));
      for (const x of [-0.5, 0.5]) g.add(mesh(new THREE.BoxGeometry(0.4, 3.4, 0.1), fl, x, TY + 2.6, 0));
      const end = i === 0 ? 10.2 : -10.2;
      const spring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.07, 6, 20), MAT.chrome()); spring.position.set(end + (i === 0 ? 0.3 : -0.3), TY + 0.2, 0); spring.rotation.y = Math.PI / 2; g.add(spring);
      const velcro = mesh(new THREE.BoxGeometry(0.5, 1.6, 2), MAT.paint(0x22262b), end, TY + 0.2, 0); g.add(velcro);
      const wts = new THREE.Group();
      for (const s of [-1, 1]) { const c = mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.3, 20), MAT.chrome(), 0, TY - 2.6, s * 3.6); c.rotation.x = Math.PI / 2; wts.add(c); }
      g.add(wts);
      return { g, spring, velcro, wts };
    });
    const cmpG = (i) => new Component({
      key: 'g' + (i + 1), name: `滑块 ${i + 1}`, zone: 'rail', rail: 'glide', fixed: true, defaultPos: (i ? X2 : X1) * 100, object: this.gm[i].g, labelY: TY + 6,
      icon: SVG('<path d="M10 28l22-12 22 12" stroke="currentColor" fill="none" stroke-width="2"/><path d="M30 16v-8h4v8" stroke="currentColor" fill="none"/>'),
      desc: `${i === 0 ? '拖到左边光电门的左侧，再推出去撞静止的滑块 2。' : '每次碰撞前拖到两光电门之间放稳。'}可以直接在导轨上拖动（拖住运动中的滑块就是用手把它按停）。滑块本身质量（物理天平称得）${(this.mBase[i] * 1000).toFixed(2)} g；配重每块 ${(this.mW[0] * 1000).toFixed(2)} g，成对加在两侧。顶上装 U 形挡光片，两齿前沿间距 Δx = 10.00 mm。`,
      controls: () => [
        { type: 'segment', label: '配重', get: () => this.w[i], set: (v) => { this.w[i] = v; this.applyCfg(); app.changed(); }, options: [{ label: '不加', value: 0 }, { label: '加两块', value: 2 }] },
        ...(i === 0
          ? [
            { type: 'slider', label: '推的力度（推出时的大致速度）', get: () => this.vp, set: (v) => (this.vp = v), min: 0.2, max: 0.7, step: 0.01, digits: 2, unit: 'm/s' },
            { type: 'button', label: '向右推出滑块 1', onClick: () => this.push() },
          ]
          : []),
        { type: 'readout', label: '位置（滑块中心）', get: () => `${(this.g[i].x * 100).toFixed(1)} cm` },
        { type: 'readout', label: '当前质量', get: () => `${(this.mass(i) * 1000).toFixed(2)} g` },
      ],
    });
    app.addComponent(cmpG(0)); app.addComponent(cmpG(1));
    // ---- 计时器 ----
    const mb = (this.meter = meterBox(18, 9, 12, '数字毫秒计')); mb.group.position.set(-55, 0, 24); mb.group.rotation.y = 0.25;
    app.addComponent(new Component({
      key: 'timer', name: '数字毫秒计', zone: 'none', fixed: true, object: mb.group, labelY: 12,
      desc: '工作在 S2 挡：挡光片第一个齿挡光时开始计时、第二个齿挡光时停止，显示两次挡光的时间间隔 Δt（ms），v = Δx/Δt。两个光电门各能记住最近 4 次的数据，每次碰撞前要按复位清除。',
      controls: () => [{ type: 'button', label: '复位（清除记忆）', onClick: () => this.resetTimer() }],
    }));
    this.tv = app.addView({ id: 'timer', title: '计时器记忆（S2 挡，ms）', w: 300, h: 190, res: 1.6 });
  }
  update() {
    const tr = this.track;
    // 光电门位置 → 计时器；滑块：学生拖动过的按新位置放稳，否则组件跟随物理位置
    ['gate1', 'gate2'].forEach((k, j) => { const c = this.app.comp(k); tr.gates[j].x = c && c.placed ? c.pos / 100 : -1; });
    this.g.forEach((g, i) => {
      const c = this.app.comp('g' + (i + 1));
      if (c && Math.abs(c.pos - this.gSync[i]) > 1e-6) this.dropAt(i, c.pos / 100);
      if (c) { c.pos = this.gSync[i] = g.x * 100; c.root.position.set(X3(g.x), 0, 0); }
      const o = this.gm[i];
      o.spring.visible = this.mode === 'spring'; o.velcro.visible = this.mode !== 'spring'; o.wts.visible = this.w[i] > 0;
    });
    this.screwKnob.rotation.y = this.screw * 4 * Math.PI;
    this.pumpLed.material.emissiveIntensity = tr.air ? 2 : 0;
    this.leds.forEach((l, k) => (l.material.emissiveIntensity = this.g.some((g) => g.prongs().some(([a, b]) => tr.gates[k].x >= a && tr.gates[k].x <= b)) ? 3 : 1));
    const m1 = this.mem(0), m2 = this.mem(1), last = (m) => (m.length ? m[m.length - 1].toFixed(2) : '----');
    const s = `${last(m1)}|${last(m2)}`;
    if (s !== this._s) { this._s = s; this.meter.setText(last(m2) !== '----' ? last(m2) : last(m1), 'ms', `门1 ${m1.length} 次  门2 ${m2.length} 次`); }
    this.drawTimer(m1, m2);
  }
  drawTimer(m1, m2) {
    const v = this.tv, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#1d2228'; g.fillRect(0, 0, W, H);
    g.font = `${H * 0.075}px "IBM Plex Mono", Consolas, monospace`; g.textAlign = 'left';
    [m1, m2].forEach((m, k) => {
      const x0 = W * (0.06 + k * 0.49);
      g.fillStyle = '#9aa5ab'; g.fillText(`光电门 ${k + 1}`, x0, H * 0.14);
      g.fillStyle = '#0b1410'; g.fillRect(x0 - 4, H * 0.2, W * 0.42, H * 0.6);
      for (let r = 0; r < 4; r++) {
        const val = m[r];
        g.fillStyle = val != null ? '#7dff9e' : '#2c4a36';
        g.fillText(`${r + 1}  ${val != null ? val.toFixed(2).padStart(7) : '   ----'}`, x0 + 4, H * (0.3 + r * 0.135));
      }
    });
    const g1 = this.g[0], g2 = this.g[1];
    let foot;
    if (!this.track.air) foot = '气泵没开，滑块压在导轨上';
    else if (g1.v > 0.02 || g2.v > 0.02 || g1.v < -0.02 || g2.v < -0.02) foot = `滑块 1 ${(g1.v * 100).toFixed(1)} cm/s，滑块 2 ${(g2.v * 100).toFixed(1)} cm/s（仅供观察）`;
    else if (!this.level) { const vd = Math.abs(9.794 * this.theta) * 1000; foot = `静止放着的滑块在向${this.theta > 0 ? '左' : '右'}${vd > 2 ? '滑' : '慢慢挪动'}：导轨${this.theta > 0 ? '右' : '左'}端偏高`; }
    else foot = '导轨已水平：静止放着的滑块不再滑动';
    v.foot(foot);
  }

  // ======================= 数据表 =======================
  tables() {
    const DX = 10.0; // mm
    const v = (t, d = 1) => (isFinite(t) ? (d * DX) / t : 0); // m/s
    return [{
      id: 'col', title: '碰撞前后的计时', maxRows: 14,
      columns: [
        { key: 'kind', label: '类型', type: 'text', readonly: true },
        { key: 'm1', label: 'm₁/g', digits: 2, readonly: true },
        { key: 'm2', label: 'm₂/g', digits: 2, readonly: true },
        { key: 't10', label: 'Δt₁₀/ms', digits: 2, readTol: 0.006 },
        { key: 't1', label: 'Δt₁′/ms', digits: 2, readTol: 0.006 },
        { key: 't2', label: 'Δt₂′/ms', digits: 2, readTol: 0.006 },
        { key: 'R', label: 'p′/p₀', digits: 4, calc: (r) => (r.m1 * v(r.t1, r._d1 || 1) + r.m2 * v(r.t2)) / (r.m1 * v(r.t10)) },
        { key: 'K', label: 'E′/E₀', digits: 4, calc: (r) => (r.m1 * v(r.t1) ** 2 + r.m2 * v(r.t2) ** 2) / (r.m1 * v(r.t10) ** 2) },
      ],
      buttons: [{ label: '记录本次碰撞（质量与计时器数据）', onClick: (t) => this.rec(t) }],
      note: 'Δt₁₀：碰前滑块 1 过光电门 1；Δt₁′、Δt₂′：碰后两滑块过光电门的时间。滑块 1 碰后几乎静止、没有通过光电门时 Δt₁′ 空着，按 v₁′ = 0 处理；碰后反弹回光电门 1 时速度取负。Δx = 10.00 mm。',
    }];
  }
  rec(t) {
    const a = this.app;
    if (!this.shot) return a.toast('还没有做碰撞：放好两个滑块，复位计时器，推出滑块 1', 'warn');
    const s = this.times();
    if (s.n1 > 1) a.toast('计时器里混有上一次的数据：每次碰撞前要先复位', 'warn');
    if (!isFinite(s.t10)) return a.toast('滑块 1 碰前没有通过光电门 1', 'warn');
    if (!s.col) return a.toast('两滑块还没相碰', 'warn');
    if (!isFinite(s.t2)) return a.toast('滑块 2 碰后还没通过光电门 2', 'warn');
    if (!isFinite(s.t1) && !this.g[0].held && Math.abs(this.g[0].v) > 0.02) return a.toast('滑块 1 还在运动，等它通过光电门后再记录', 'warn');
    if (t.rows.some((r) => r._t === this.shot.t)) a.toast('这次碰撞已经记过了', 'warn');
    const fl = [];
    if (Math.abs(s.col.vb) > 0.004) fl.push(`碰撞前滑块 2 不是静止的（在${s.col.vb > 0 ? '向右' : '向左'}滑）：导轨没调平，或没放稳`);
    if (!this.level) fl.push('导轨没有调平');
    const sh = this.shot;
    t.flagAll(t.addRow({ kind: KINDS[sh.kind], m1: Math.round(sh.m1 * 1e5) / 100, m2: Math.round(sh.m2 * 1e5) / 100, t10: s.t10, ...(isFinite(s.t1) ? { t1: s.t1 } : {}), t2: s.t2, _d1: s.d1, _t: sh.t, _k: sh.kind }), fl);
  }

  // ======================= 自动操作 =======================
  async trial() {
    const a = this.app;
    a.select(a.comp('g1')); this.placeG1(); await a.wait(150);
    a.select(a.comp('g2')); this.placeG2(); await a.wait(150);
    a.select(a.comp('timer')); this.resetTimer(); await a.wait(150);
    a.select(a.comp('g1')); this.push();
    await a.until(() => this.trialDone(), 60000);
    await a.wait(250);
    await a.record('col', 0);
  }
  async setup(mode, w1, w2) {
    const a = this.app;
    if (!this.track.air) { a.select(a.comp('track')); this.track.air = true; a.renderInspector(); }
    if (!this.level) await this.levelIt();
    if (this.mode !== mode) { a.select(a.comp('track')); this.mode = mode; a.renderInspector(); await a.wait(200); }
    if (this.w[0] !== w1) { a.select(a.comp('g1')); this.w[0] = w1; a.renderInspector(); await a.wait(200); }
    if (this.w[1] !== w2) { a.select(a.comp('g2')); this.w[1] = w2; a.renderInspector(); await a.wait(200); }
    this.applyCfg(); a.changed();
  }
  async levelIt() {
    const a = this.app;
    a.select(a.comp('track'));
    const z = Math.round((this.s0 + gauss(0.004)) * 1000) / 1000;
    await a.tween(() => this.screw, (v) => (this.screw = v), z, 900); this.screw = z; a.changed();
  }
  rowsOf(k) { return this.app.table('col').rows.filter((r) => r._k === k && isFinite(r.t10) && isFinite(r.t2)); }
  steps() {
    const app = this.app;
    const cfgDiag = (mode, w1, w2) => {
      const out = [];
      if (!this.track.air) out.push({ msg: '气泵没开。', fix: { label: '打开气泵', run: async () => { this.track.air = true; } } });
      const li = this.layoutIssue(); if (li && this.g.every((g) => Math.abs(g.v) < 0.02)) out.push({ msg: li + '。', fix: { label: '帮我摆好两个滑块', run: async () => { this.placeG2(); } } });
      if (!this.level) out.push({ msg: '导轨还没调平：碰前滑块 2 不静止，滑块速度也一路在变。', fix: { label: '帮我调平', run: () => this.levelIt() } });
      if (this.mode !== mode) out.push({ msg: `这一步滑块相碰的一端要装${mode === 'spring' ? '弹簧圈' : '尼龙搭扣'}。`, fix: { label: '换上', run: async () => { this.mode = mode; this.applyCfg(); } } });
      if (this.w[0] !== w1 || this.w[1] !== w2) out.push({ msg: `配重不对：这一步${w1 ? '滑块 1 加两块配重' : '滑块 1 不加配重'}，${w2 ? '滑块 2 加两块' : '滑块 2 不加'}。`, fix: { label: '帮我改', run: async () => { this.w = [w1, w2]; this.applyCfg(); } } });
      return out;
    };
    const trialStep = (title, k, mode, w1, w2, html) => ({
      title, html,
      status: () => `已记录 ${this.rowsOf(k).length} / ${NREP} 次`,
      check: () => this.rowsOf(k).length >= NREP,
      diagnose: () => cfgDiag(mode, w1, w2),
      auto: async () => { app.showTable(0); await this.setup(mode, w1, w2); for (let n = 0; n < 6 && this.rowsOf(k).length < NREP; n++) await this.trial(); },
    });
    return [
      {
        title: '开气泵，调平导轨',
        html: '<p>打开气泵，把滑块 2 静止地放在导轨中部，观察它是否自己滑动。滑向哪边，说明那一端偏低；转动右端的调平螺钉，直到滑块放在导轨上任何位置都基本不动（静态调平）。</p>',
        hint: '螺钉每转一圈升降 0.5 mm。越接近水平滑块滑得越慢，要耐心观察几秒钟。',
        check: () => this.track.air && this.level,
        diagnose: () => {
          if (!this.track.air) return [{ msg: '先打开气泵。', fix: { label: '打开气泵', run: async () => { this.track.air = true; } } }];
          if (this.level) return [];
          return [{ msg: `滑块向${this.theta > 0 ? '左' : '右'}滑，导轨${this.theta > 0 ? '右' : '左'}端偏高：调平螺钉往${this.theta > 0 ? '小' : '大'}的方向转${Math.abs(this.theta) * FEET * 1000 > 0.2 ? '' : '一点点'}。`, fix: { label: '帮我调平', run: () => this.levelIt() } }];
        },
        auto: async () => {
          app.select(app.comp('track')); this.track.air = true; app.renderInspector(); await app.wait(300);
          app.select(app.comp('g2')); this.dropAt(1, X2); await app.wait(600);
          await this.levelIt(); this.dropAt(1, X2);
        },
      },
      {
        title: '把两个光电门装到导轨上',
        html: '<p>从器材柜把两个光电门装到导轨上，拖动调整位置（看指针对着的米尺读数）。滑块 2 要能静止地放在两门之间，并且滑块 1 的挡光片要在两滑块相碰<b>之前</b>完全通过左边的门、滑块 2 碰后要在撞到右端缓冲器之前通过右边的门。</p>',
        hint: `滑块长 ${GLEN * 100} cm。两门间距太小放不下滑块 2；太大则碰前、碰后的测速点离碰撞点远，气膜阻力造成的速度损失就大，p′/p₀ 偏离 1 更多。一般隔开 35～45 cm。`,
        status: () => { const xs = this.gateXs(); return xs.length ? `光电门在 ${xs.map((x) => (x * 100).toFixed(1)).join(' cm、')} cm${xs.length === 2 ? `，相距 ${((xs[1] - xs[0]) * 100).toFixed(1)} cm` : ''}` : '导轨上还没有光电门'; },
        check: () => { const xs = this.gateXs(); return xs.length === 2 && xs[1] - xs[0] >= GLEN + 0.06 && xs[0] >= 0.3 && xs[1] <= L - GLEN / 2 - 0.03; },
        diagnose: () => {
          const xs = this.gateXs(), out = [];
          for (const k of ['gate1', 'gate2']) if (!app.comp(k).placed) out.push({ msg: `「${app.comp(k).name}」还在器材柜里。`, fix: { label: '帮我装上', run: () => app.autoPlace(k) } });
          if (xs.length === 2) { const li = this.layoutIssue(); if (li && !/滑块/.test(li.slice(0, 4))) out.push({ msg: li + '。', fix: { label: '移到 55 cm 和 95 cm', run: async () => { app.setRailPos(app.comp('gate1'), 55); app.setRailPos(app.comp('gate2'), 95); } } }); }
          return out;
        },
        auto: async () => {
          for (const [k, x] of [['gate1', 55], ['gate2', 95]]) { await app.autoPlace(k, { pos: x }); await app.moveTo(k, x + rand(-1, 1), 500); }
          this.placeG2(); app.changed();
        },
      },
      trialStep('弹性碰撞：m₁ ≈ m₂', 'e1', 'spring', 0, 0, '<p>两滑块相碰端装弹簧圈，都不加配重。把滑块 2 拖到两光电门之间放稳、滑块 1 拖到左边光电门的左侧，计时器复位，推出滑块 1。碰后滑块 1 几乎停下，滑块 2 以接近 $v_{10}$ 的速度离开。记录 3 次。</p>'),
      trialStep('弹性碰撞：m₁ > m₂', 'e2', 'spring', 2, 0, '<p>给滑块 1 加两块配重，再做 3 次。碰后两滑块都向右运动，先后通过光电门 2：先过的是滑块 2。</p>'),
      trialStep('完全非弹性碰撞', 'in', 'velcro', 0, 0, '<p>相碰端换成尼龙搭扣，两滑块不加配重。碰后两滑块粘在一起以同一速度运动。记录 3 次。</p>'),
      {
        title: '数据处理',
        html: '<p>$v=\\Delta x/\\Delta t$。比较碰撞前后的总动量 $p_0=m_1v_{10}$、$p\'=m_1v_1\'+m_2v_2\'$ 和总动能；弹性碰撞求恢复系数 $e=(v_2\'-v_1\')/v_{10}$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const rs = this.app.table('col').rows.filter((r) => isFinite(r.m1) && isFinite(r.t10) && isFinite(r.t2));
    if (!rs.length) return { html: '<p>请先记录碰撞数据。</p>', ok: false };
    const DX = 10.0, v = (t, d = 1) => (isFinite(t) ? (d * DX) / t : 0);
    const calc = rs.map((r) => {
      const v10 = v(r.t10), v1 = v(r.t1, r._d1 || 1), v2 = v(r.t2), p0 = r.m1 * v10, p1 = r.m1 * v1 + r.m2 * v2;
      return { r, v10, v1, v2, p0, p1, R: p1 / p0, K: (r.m1 * v1 * v1 + r.m2 * v2 * v2) / (r.m1 * v10 * v10), e: (v2 - v1) / v10, Kth: r.m1 / (r.m1 + r.m2) };
    });
    const el = calc.filter((c) => c.r._k !== 'in'), inel = calc.filter((c) => c.r._k === 'in');
    const f = (x, d = 4) => x.toFixed(d);
    let html = `<h3>1. 各次碰撞</h3><p>$v=\\Delta x/\\Delta t$，$\\Delta x$ = 10.00 mm；动量单位 g·m/s。</p>
      <table><tr><th>类型</th><th>m₁/g</th><th>m₂/g</th><th>v₁₀/(m/s)</th><th>v₁′/(m/s)</th><th>v₂′/(m/s)</th><th>p₀</th><th>p′</th><th>p′/p₀</th><th>E′/E₀</th></tr>
      ${calc.map((c) => `<tr><td>${c.r.kind}</td><td>${c.r.m1.toFixed(2)}</td><td>${c.r.m2.toFixed(2)}</td><td>${f(c.v10)}</td><td>${f(c.v1)}</td><td>${f(c.v2)}</td><td>${f(c.p0, 2)}</td><td>${f(c.p1, 2)}</td><td>${f(c.R)}</td><td>${f(c.K)}</td></tr>`).join('')}</table>`;
    const answers = [];
    if (el.length) {
      const R = mean(el.map((c) => c.R)), e = mean(el.map((c) => c.e));
      html += `<h3>2. 弹性碰撞</h3><div class="result-box">$\\overline{p'/p_0}=${f(R)}$（${el.length} 次，标准差 ${f(el.length > 1 ? stdev(el.map((c) => c.R)) : 0)}），恢复系数 $\\bar e=${f(e, 3)}$</div>
        <p>动量在 ${pct(1 - Math.min(...el.map((c) => c.R)))} 以内守恒。动能比 E′/E₀ 平均 ${f(mean(el.map((c) => c.K)))}，弹簧圈碰撞并非完全弹性（$e<1$），损失的动能主要变成弹簧圈的振动和热。</p>`;
      answers.push({ label: '弹性碰撞 $\\overline{p\'/p_0}$', unit: '', value: R, digits: 3, tolRel: 0.004 }, { label: '恢复系数 $\\bar e$', unit: '', value: e, digits: 3, tolRel: 0.01 });
    }
    if (inel.length) {
      const R = mean(inel.map((c) => c.R)), K = mean(inel.map((c) => c.K)), Kth = mean(inel.map((c) => c.Kth));
      html += `<h3>3. 完全非弹性碰撞</h3><div class="result-box">$\\overline{p'/p_0}=${f(R)}$，$\\overline{E'/E_0}=${f(K)}$</div>
        <p>两滑块粘在一起，理论上 $E'/E_0=\\dfrac{m_1}{m_1+m_2}$ = ${f(Kth)}，实测值与之相对差 ${pct(relErr(K, Kth))}。</p>`;
      answers.push({ label: '完全非弹性 $\\overline{E\'/E_0}$', unit: '', value: K, digits: 3, tolRel: 0.006 });
    }
    const xs = this.gateXs();
    html += `<div class="result-box warn">p′/p₀ 略小于 1：滑块 1 过光电门 1 之后、滑块 2 碰后到达光电门 2 之前，都要在气膜上滑过一段距离（现在两门相距 ${xs.length === 2 ? ((xs[1] - xs[0]) * 100).toFixed(1) : '—'} cm），黏性阻力使速度每 10 cm 损失约 0.3%。两门放得越开，偏差越大；导轨没调平时偏差更大，而且偏大偏小取决于倾斜方向。</div>`;
    return { html, ok: true, answers, plots: [{ title: '各次碰撞的 p′/p₀', xLabel: '序号', yLabel: 'p′/p₀', series: [{ type: 'scatter', data: calc.map((c, i) => [i + 1, c.R]), label: '实验点' }, { type: 'line', data: [[0.5, 1], [calc.length + 0.5, 1]], label: '守恒' }] }] };
  }

  principle() {
    return `<h3>1. 动量守恒</h3><p>系统所受合外力为零时总动量不变。两滑块在水平气垫导轨上相碰，竖直方向重力与气膜支持力平衡，水平方向的阻力很小，碰撞前后：</p>$$m_1v_{10}+m_2v_{20}=m_1v_1'+m_2v_2'$$<p>本实验 $v_{20}=0$。</p>
<h3>2. 两种碰撞</h3>${airtrackFig()}<p><b>弹性碰撞</b>：相碰端装弹簧圈，碰后两滑块分开，恢复系数 $e=\\dfrac{v_2'-v_1'}{v_{10}-v_{20}}$ 接近 1。$m_1=m_2$ 时，滑块 1 几乎停下，把速度“交给”滑块 2。<br><b>完全非弹性碰撞</b>：相碰端装尼龙搭扣，碰后两滑块粘在一起，$v'=\\dfrac{m_1v_{10}}{m_1+m_2}$，动能只剩 $\\dfrac{m_1}{m_1+m_2}$。</p>
<h3>3. 光电门测速</h3><p>U 形挡光片两齿前沿相距 $\\Delta x$，计时器测出两次挡光的间隔 $\\Delta t$，$v=\\Delta x/\\Delta t$——这是滑块通过光电门时的平均速度，$\\Delta x$ 很小，可看作瞬时速度。</p>
<h3>4. 本仿真的计算模型</h3><p>滑块受气膜黏性阻力 $F=-bv$（$b\\approx\\eta A/\\delta$ ≈ 2.5×10⁻³ kg/s）和导轨倾斜的重力分量 $-mg\\sin\\theta$，运动方程按解析解逐步推进；碰撞按恢复系数处理（弹簧圈 $e$ = 0.97，尼龙搭扣 $e$ = 0），动量严格守恒；挡光时刻由子步内插值求得。导轨调平螺钉有随机初始偏差。光电门和滑块的位置由你摆放：测速点离碰撞点越远，阻力造成的损失越多，这一项直接反映在 p′/p₀ 上。</p>`;
  }
}
