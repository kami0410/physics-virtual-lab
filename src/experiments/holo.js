// 实验：全息照相（三维漫反射物体的透射全息图：等光程、光强比、曝光量、冲洗与再现）
import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { MAT, mesh, labTable, laserMesh, meterBox, canvasTexture, ICONS } from '../core/Models.js';
import { OptBench, BeamDraw } from '../core/beams.js';
import { mean, gauss, rand, clamp } from '../core/Stats.js';

const H = 14; // 光束高度 cm
const LAM = 0.6328; // μm
const E0_SPEC = 80; // 干板盒上标注的最佳曝光量 μJ/cm²
const L_CAV = 20; // 激光谐振腔长 cm（三个纵模）
const D2R = Math.PI / 180;
// 台面坐标（cm，x 向右，z 向观察者）
const LASER = [-50, -60], SH = [-42, -60], BS = [-30, -60], E1 = [-30, -50], M1X = -30, M2 = [30, -60];
const OBJ = [5, 12], PL = [0, -20], VIEW = [0, -50];
const E2 = [M2[0] + 0.3 * (OBJ[0] - M2[0]), M2[1] + 0.3 * (OBJ[1] - M2[1])];
const DIV = 0.06; // 扩束镜后光束发散（半宽/距离）
const OBJ_R = 2.2; // 物体有效半径 cm
const I_N = 1.3; // 观察画面的亮度基准 μW/cm²
const PLATE_W = 12, PLATE_H = 9;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const V3 = (p, y = H) => new THREE.Vector3(p[0], y, p[1]);
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const U2 = [(OBJ[0] - M2[0]) / dist(M2, OBJ), (OBJ[1] - M2[1]) / dist(M2, OBJ)];
function besselJ1(x) { let s = 0, t = x / 2; for (let m = 0; m < 25; m++) { s += t; t *= -(x * x) / (4 * (m + 1) * (m + 2)); } return s; }

function post(h = H) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.8, 20), MAT.dark(), 0, 0.4, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, h - 2, 12), MAT.alu(), 0, (h - 2) / 2 + 0.8, 0));
  return g;
}
function dieTexture(n) {
  return canvasTexture(128, 128, (ctx, W) => {
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = '#1b1b1b';
    for (const [u, v] of PIPS[n]) { ctx.beginPath(); ctx.arc(W / 2 + u * W * 0.27, W / 2 + v * W * 0.27, W * 0.08, 0, Math.PI * 2); ctx.fill(); }
  });
}
const PIPS = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
// 骰子与小球（物体坐标 cm，相对 OBJ，y 相对光束高度）
const CUBE = { c: [-2.0, 0, 1.2], s: 4, rot: 25 * D2R };
const BALL = { c: [2.5, -0.5, -1.8], r: 1.5 };

export class HoloExperiment {
  static meta = {
    id: 'holo',
    title: '全息照相',
    subtitle: '离轴透射全息 · 等光程与相干长度 · 光强比与曝光量 · 冲洗、漂白与再现',
    tags: ['波动光学', '全息', '光学平台'],
    level: '综合',
    time: '90 min',
    color: '#b91c1c',
    formula: String.raw`K=\dfrac{I_r}{I_o},\quad t=\dfrac{E_0}{I_r+I_o}`,
    measure: '参考光与物光的光强比 K、曝光时间 t',
    goals: ['理解全息照相记录与再现的原理', '学会在防震平台上布置离轴全息光路：分束、扩束、等光程', '用光功率计测光强比，按干板的最佳曝光量计算曝光时间', '完成曝光、显影、定影、漂白，观察再现虚像的立体感和视差'],
    questions: ['为什么物光和参考光的光程差要小于激光的相干长度？光程差约等于谐振腔长时会怎样？', '光强比 K 太小或太大对全息图有什么影响？', '把全息图打碎成小块，还能看到完整的物体吗？像有什么变化？', '曝光过程中平台振动 λ/4 会造成什么后果？'],
  };

  static thumb(ctx, w, h) {
    ctx.fillStyle = '#0b0606'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const inC = Math.abs(x - w * 0.42) < w * 0.17 && Math.abs(y - h * 0.5) < h * 0.27;
      const inB = Math.hypot(x - w * 0.7, y - h * 0.56) < h * 0.17;
      const b = (inC || inB ? 0.9 : 0.12) * -Math.log(Math.random() + 1e-3) * 0.5;
      ctx.fillStyle = `rgba(255,${40 + 40 * b},${30 + 30 * b},${Math.min(1, b)})`; ctx.fillRect(x, y, 1.6, 1.6);
    }
  }

  constructor(app) {
    this.app = app;
    this.P = 20 * rand(0.9, 1.08); // mW
    this.rho = rand(0.62, 0.78); // 物体漫反射率
    this.E0 = E0_SPEC * rand(0.88, 1.12); // 干板实际最佳曝光量
    this.laserOn = false; this.shOpen = false; this.tSet = 5; this.expLeft = 0;
    this.phi = 150; // 分束镜刻度
    this.z1 = rand(18, 28); // 参考光反射镜 M1 的位置（z）
    // 镜架转角（相对底座，°）：放上去时按“大致对准 + 随机偏差”设置
    this.psi1 = 0; this.psi2 = 0;
    this.err1 = rand(3, 7) * (Math.random() < 0.5 ? -1 : 1); this.err2 = rand(3, 7) * (Math.random() < 0.5 ? -1 : 1);
    this.blockR = false; this.blockO = false;
    this.room = true; this.assist = true;
    this.vib = 0.4; this.simT = 0;
    this.alpha = 0; this.beta = 0;
    this.td = 1; this.tf = 0; this.bleach = false;
    this.newPlate();
    this._sig = ''; this._sig2 = '';
    this.speckle = this.makeSpeckle(128);
  }
  newPlate() { this.acc = { Er: 0, Eo: 0, Ebg: 0, Emod: 0, EmodC: 0, Eint: 0 }; this.holo = null; this.expCount = 0; }

  // ---------------- 光路模型 ----------------
  on(k) { const c = this.app.comp(k); return !!(c && c.placed); }
  slotHas(k) { return this.on(k) && this.app.comp(k).slot === 'hold'; }
  R() { return 0.02 * Math.pow(45, clamp(this.phi, 0, 300) / 300); }
  /** 元件中心在台面上的位置（未放置时取标准位置） */
  pos(k) {
    const c = this.app.comp(k);
    if (c && c.placed) return [c.root.position.x, c.root.position.z];
    return { laser: LASER, shutter: SH, bs: BS, e1: E1, m1: [M1X, this.z1], m2: M2, e2: E2, obj: OBJ }[k] || [0, 0];
  }
  M1() { return this.pos('m1'); }
  /** 卷尺沿光路量得的两路光程（从分束镜到干板中心，按各元件中心计） */
  Lo() { const bs = this.pos('bs'), m2 = this.pos('m2'), e2 = this.pos('e2'), ob = this.pos('obj'); return dist(bs, m2) + (this.on('e2') ? dist(m2, e2) + dist(e2, ob) : dist(m2, ob)) + dist(ob, PL); }
  Lr() { const bs = this.pos('bs'), e1 = this.pos('e1'), m1 = this.M1(); return (this.on('e1') ? dist(bs, e1) + dist(e1, m1) : dist(bs, m1)) + dist(m1, PL); }
  m1z() { return this.M1()[1]; }
  setM1z(z) {
    const c = this.app.comp('m1');
    if (this.app.isFree(c)) this.app.setPose(c, c.tx, z);
    else { this.z1 = clamp(z, 15, 60); if (c.placed) c.root.position.set(M1X, 0, this.z1); this.app.changed(); }
  }
  light() { return this.laserOn && this.on('laser') && (!this.on('shutter') || this.shOpen || this.expLeft > 0); }
  /** 镜面法线（世界坐标）：底座转角 + 镜架转角 */
  mirrorNormal(k) {
    const c = this.app.comp(k), th = c.root.rotation.y + (k === 'm1' ? this.psi1 : this.psi2) * D2R;
    return new THREE.Vector3(Math.cos(th), 0, -Math.sin(th));
  }
  /** 使反射光射向目标所需的镜架转角 */
  aim(k) {
    const c = this.app.comp(k);
    const P = this.pos(k), to = k === 'm1' ? PL : this.pos('obj');
    let uin = null;
    const hs = this._trace && this._trace.hits.get(k);
    if (hs && hs.length) uin = hs.reduce((a, b) => (b.P > a.P ? b : a)).u.clone().setY(0).normalize();
    if (!uin) { const f = this.pos('bs'); uin = new THREE.Vector3(P[0] - f[0], 0, P[1] - f[1]).normalize(); }
    const uout = new THREE.Vector3(to[0] - P[0], 0, to[1] - P[1]).normalize();
    const n = uout.sub(uin).normalize();
    return wrap180(Math.atan2(-n.z, n.x) / D2R - (c.root.rotation.y / D2R));
  }
  /** 由各元件的实际位置与方向追迹光路 */
  trace() {
    const app = this.app, key = [this.laserOn, this.shOpen, this.expLeft > 0, this.phi, this.psi1, this.psi2, this.blockR, this.blockO,
      ...['laser', 'shutter', 'bs', 'e1', 'm1', 'm2', 'e2', 'obj', 'meter', 'plate'].map((k) => { const c = app.comp(k); return c.placed ? `${c.root.position.x.toFixed(3)},${c.root.position.z.toFixed(3)},${c.root.rotation.y.toFixed(5)}` : '-'; })].join('|');
    if (key === this._tkey && this._trace) return this._trace;
    this._tkey = key;
    const B = this.bench || (this.bench = new OptBench());
    B.clear();
    const pose = (k, local, n) => OptBench.pose(app.comp(k).root, local, n);
    if (this.on('shutter')) { const q = pose('shutter', new THREE.Vector3(0, H, 0), new THREE.Vector3(1, 0, 0)); B.add({ id: 'shutter', kind: 'gate', ...q, R: 1.4, open: this.shOpen || this.expLeft > 0, noSpot: this.shOpen || this.expLeft > 0 }); }
    if (this.on('bs')) { const q = pose('bs', new THREE.Vector3(0, H, 0), new THREE.Vector3(-1, 0, 1).normalize()); B.add({ id: 'bs', kind: 'splitter', ...q, R: 1.3, R_bs: this.R() / 0.96, loss: 0.04, noSpot: true }); }
    for (const [k, block] of [['e1', this.blockR], ['e2', this.blockO]]) {
      if (!this.on(k)) continue;
      const q = pose(k, new THREE.Vector3(0, H, 0), new THREE.Vector3(0, 0, 1));
      B.add({ id: k, kind: 'expander', ...q, R: 0.7, div: DIV, fe: 0.4, T: 0.9, axisTol: 0.07, noSpot: true });
      if (block) { const qc = pose(k, new THREE.Vector3(0, H, 4), new THREE.Vector3(0, 0, 1)); B.add({ id: k + 'card', kind: 'stop', ...qc, R: 2.6 }); }
    }
    for (const k of ['m1', 'm2']) if (this.on(k)) B.add({ id: k, kind: 'mirror', c: V3(this.pos(k)), n: this.mirrorNormal(k), R: 2.5, refl: 0.95 });
    if (this.on('obj')) { const o = this.pos('obj'); B.add({ id: 'obj', kind: 'sphere', c: V3(o), R: OBJ_R }); }
    B.add({ id: 'plate', kind: 'target', c: V3(PL), n: new THREE.Vector3(0, 0, 1), rect: [PLATE_W / 2, PLATE_H / 2] });
    // 台面边缘以外的光不再画出（落在实验室墙上）
    for (const [c, n] of [[[-84, 0], [1, 0]], [[64, 0], [-1, 0]], [[0, -76], [0, 1]], [[0, 72], [0, -1]]]) B.add({ id: 'edge', kind: 'stop', c: V3(c), n: new THREE.Vector3(n[0], 0, n[1]), R: 400, noSpot: true });
    const src = [];
    if (this.light()) { const q = pose('laser', new THREE.Vector3(10.4, H, 0), new THREE.Vector3(1, 0, 0)); src.push({ p: q.c, u: q.n, P: this.P, w: 0.05, th: 0.0006, color: 0xff2a1a }); }
    this._trace = B.trace(src);
    return this._trace;
  }
  /** 到达干板中心的两束光强（μW/cm²）及几何量 */
  optics() {
    const o = { Ir: 0, IrPk: 0, Io: 0, offR: Infinity, offO: Infinity, wR: 0, wO: 0, dL: this.Lo() - this.Lr(), Vcoh: 0, spot: null, sideO: 1, uObj: null, ref: null };
    o.Vcoh = Math.cos((Math.PI * o.dL) / (2 * L_CAV)) ** 2;
    const tr = this.trace();
    // 直接照到干板上的光（参考光为分束镜反射的一路）
    for (const h of tr.hits.get('plate') || []) {
      const off = Math.hypot(h.a, h.b), pk = 1000 * h.P * (2 / (Math.PI * h.w * h.w)) * h.cos;
      o.Ir += pk * Math.exp((-2 * off * off) / (h.w * h.w));
      if (h.tag[0] === 'r' && (!o.ref || h.P > o.ref.P)) { o.ref = h; o.offR = off; o.wR = h.w; o.IrPk = pk; o.spot = [h.a, h.b]; }
    }
    // 物体被照明的功率 → 朗伯漫反射到干板
    let Pobj = 0, best = null;
    for (const h of tr.hits.get('obj') || []) { Pobj += h.P; if (!best || h.P > best.P) best = h; }
    if (best) {
      const c = V3(this.pos('obj'));
      o.offO = best.rho; o.wO = best.w; o.uObj = best.u;
      o.sideO = Math.sign(best.u.clone().cross(c.clone().sub(best.q)).y) || 1;
    }
    if (Pobj > 0) {
      const ob = this.pos('obj'), d = dist(ob, PL), cosv = Math.abs(PL[1] - ob[1]) / d;
      o.Io = (1000 * this.rho * Pobj * 0.8 * 0.93 * cosv) / (Math.PI * d * d);
    }
    return o;
  }
  Vvib(a = this.vib) { const s = (2 * Math.PI * 2 * a) / LAM / Math.SQRT2; return Math.exp((-s * s) / 2); }
  meter() {
    if (!this.slotHas('meter')) return null;
    const o = this.optics();
    return (o.Ir + o.Io + (this.room ? 2.5 : 0) + 0.02) * (1 + gauss(0.003));
  }

  // ---------------- 场景 ----------------
  cameras() {
    return [
      { name: '全景', pos: [-10, 120, 120], target: [-8, 8, -15] },
      { name: '干板架', pos: [-14, 34, 26], target: [2, 14, -14] },
      { name: '物光路', pos: [50, 40, 10], target: [15, 12, -25] },
      { name: '再现观察', pos: [6, 24, -78], target: [3, 14, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(150, 150); t.position.set(-10, 0, -2); scene.add(t);
    app.stage.setLightTarget(-10, 0, -10);
    this.amb0 = app.stage.ambient.intensity; this.key0 = app.stage.keyLight.intensity;

    app.addTable({ x0: -84, x1: 64, z0: -76, z1: 72 });
    const slot = (id, p, accepts, rotY = 0) => app.addSlot({ id, pos: new THREE.Vector3(p[0], 0, p[1]), accepts, rotY });
    slot('laser', [LASER[0] - 10, LASER[1]], ['laser']);
    slot('shutter', SH, ['shutter']);
    slot('bs', BS, ['bs']);
    slot('e1', E1, ['e1']);
    slot('m1', [M1X, 0], ['m1']);
    slot('m2', M2, ['m2']);
    slot('e2', E2, ['e2'], Math.atan2(U2[0], U2[1]));
    slot('obj', OBJ, ['obj']);
    slot('hold', PL, ['meter', 'plate']);
    slot('view', VIEW, ['eye']);

    // 激光器
    const lg = new THREE.Group();
    const lm = laserMesh(26).group; lm.position.set(10, H, 0); lg.add(lm);
    lg.add(mesh(new THREE.BoxGeometry(8, H - 3, 5), MAT.dark(), -3, (H - 3) / 2, 0));
    app.addComponent(new Component({
      key: 'laser', name: 'He-Ne 激光器（632.8 nm）', icon: ICONS.laser, zone: 'slot', defaultSlot: 'laser', required: true, object: lg, labelY: H + 8,
      desc: `输出功率约 20 mW，谐振腔长约 ${L_CAV} cm，有 2～3 个纵模同时振荡，相干长度有限。`,
      controls: () => [{ type: 'toggle', label: '激光电源', get: () => this.laserOn, set: (v) => (this.laserOn = v) }],
    }));
    // 电子快门
    const sg = post(); sg.add(mesh(new THREE.BoxGeometry(3, 5, 6), MAT.black(), 0, H, 0));
    this.shBlade = mesh(new THREE.BoxGeometry(0.3, 2, 2), MAT.chrome(), 1.6, H, 0); sg.add(this.shBlade);
    const ctrl = meterBox(12, 7, 8, '快门控制器'); ctrl.group.position.set(-6, 0, 16); sg.add(ctrl.group); this.shCtrl = ctrl;
    app.addComponent(new Component({
      key: 'shutter', name: '电子快门（带定时器）', icon: ICONS.filter, zone: 'slot', defaultSlot: 'shutter', required: true, object: sg, labelY: H + 8,
      desc: '“常开”用于调光路；“定时曝光”打开设定的时间后自动关闭。控制器放在台面外，操作它不会引起台面振动。',
      controls: () => [
        { type: 'segment', label: '快门', get: () => this.shOpen, set: (v) => (this.shOpen = v), options: [{ label: '关闭', value: false }, { label: '常开', value: true }] },
        { type: 'knob', label: '曝光时间', get: () => this.tSet, set: (v) => (this.tSet = clamp(v, 0.5, 120)), min: 0.5, max: 120, step: 0.1, bigStep: 1, perRev: 10, digits: 1, unit: 's' },
        { type: 'button', label: '定时曝光', onClick: () => this.expose() },
        { type: 'readout', label: '状态', get: () => (this.expLeft > 0 ? `曝光中，剩 ${this.expLeft.toFixed(1)} s` : this.shOpen ? '常开' : '关闭') },
      ],
    }));
    // 可变分束镜
    const bg = post();
    bg.add(mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6), MAT.glass(0xcfe8ff, 0.4), 0, H, 0));
    this.bsDisc = mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.3, 40), new THREE.MeshStandardMaterial({ map: canvasTexture(256, 256, (c, W) => { const g = c.createConicGradient(0, W / 2, W / 2); g.addColorStop(0, 'rgba(230,236,240,1)'); g.addColorStop(1, 'rgba(60,70,80,1)'); c.fillStyle = g; c.fillRect(0, 0, W, W); }), metalness: 0.6, roughness: 0.25 }), 0, H + 4.2, 0);
    this.bsDisc.rotation.x = Math.PI / 2; bg.add(this.bsDisc);
    app.addComponent(new Component({
      key: 'bs', name: '可变分束镜', icon: ICONS.splitter, zone: 'slot', defaultSlot: 'bs', required: true, object: bg, labelY: H + 10,
      desc: '镀膜厚度沿圆周渐变的分束镜。转动刻度盘改变反射（参考光）与透射（物光）的比例。',
      controls: () => [{ type: 'knob', label: '分束镜刻度盘', get: () => this.phi, set: (v) => (this.phi = clamp(v, 0, 300)), min: 0, max: 300, step: 0.5, bigStep: 5, perRev: 30, digits: 1, unit: '°', sub: '刻度越大，反射到参考光路的比例越大' }],
    }));
    // 反射镜
    const mirror = (key, name, slotId, get, set, desc, extra = []) => {
      const g = post(); const disc = mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.6, 32), [MAT.dark(), MAT.chrome(), MAT.dark()], 0, 0, 0);
      const holder = new THREE.Group(); holder.position.y = H; holder.add(disc); g.add(holder);
      app.addComponent(new Component({
        key, name, icon: ICONS.mirror, zone: 'slot', defaultSlot: slotId, required: true, object: g, labelY: H + 7, desc,
        controls: () => [...(this.app.isFree(this.app.comp(key)) ? [] : extra), { type: 'knob', label: '镜架转角', get, set, wrap: true, step: 0.02, bigStep: 0.5, perRev: 5, digits: 2, unit: '°', sub: '转动镜面 δ，反射光转 2δ' }],
      }));
      return holder;
    };
    this.m1Holder = mirror('m1', '反射镜 M1（在滑轨上，可前后移动）', 'm1', () => this.psi1, (v) => (this.psi1 = v), '参考光路的反射镜，装在沿 z 方向的滑轨上，前后移动可以改变参考光的光程。',
      [{ type: 'knob', label: '滑轨位置', get: () => this.z1, set: (v) => this.setM1z(v), min: 15, max: 60, step: 0.05, bigStep: 1, perRev: 10, digits: 2, unit: 'cm' }]);
    this.m2Holder = mirror('m2', '反射镜 M2', 'm2', () => this.psi2, (v) => (this.psi2 = v), '物光路的反射镜，把物光引向被摄物体。');
    for (const k of ['m1', 'm2']) this.app.comp(k).ringR = 5;
    // 扩束镜（显微物镜）
    const expander = (key, name, slotId, desc) => {
      const g = post(); const h = new THREE.Group(); h.position.y = H;
      h.add(mesh(new THREE.CylinderGeometry(0.9, 1.2, 3, 20), MAT.alu(), 0, 0, 0).rotateX(Math.PI / 2));
      h.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.4, 20), MAT.black(), 0, 0, 1.6).rotateX(Math.PI / 2));
      g.add(h);
      app.addComponent(new Component({
        key, name, icon: ICONS.expander, zone: 'slot', defaultSlot: slotId, required: true, object: g, labelY: H + 6, desc,
        controls: () => [{ type: 'toggle', label: `挡光板（挡住${key === 'e1' ? '参考光' : '物光'}）`, get: () => (key === 'e1' ? this.blockR : this.blockO), set: (v) => (key === 'e1' ? (this.blockR = v) : (this.blockO = v)) }],
      }));
      return h;
    };
    this.e1Head = expander('e1', '扩束镜 L1（参考光）', 'e1', '40× 显微物镜，把细光束扩成发散的球面波。后面可插入挡光板。');
    this.e2Head = expander('e2', '扩束镜 L2（物光）', 'e2', '40× 显微物镜，扩束后照明物体。后面可插入挡光板。');
    // 挡光板（随扩束镜一起摆放，在出光一侧 4 cm 处）
    this.cardR = mesh(new THREE.BoxGeometry(4, 5, 0.3), MAT.black(), 0, H, 4); this.app.comp('e1').root.add(this.cardR);
    this.cardO = mesh(new THREE.BoxGeometry(5, 5, 0.3), MAT.black(), 0, H, 4); this.app.comp('e2').root.add(this.cardO);
    // 被摄物体：骰子 + 小球
    const og = new THREE.Group();
    og.add(mesh(new THREE.CylinderGeometry(4, 4.5, 1, 32), MAT.dark(), 0, 0.5, 0));
    og.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, H - 3, 12), MAT.alu(), 0, (H - 3) / 2 + 1, 0));
    const cube = new THREE.Mesh(new THREE.BoxGeometry(CUBE.s, CUBE.s, CUBE.s), [3, 4, 1, 6, 2, 5].map((n) => new THREE.MeshStandardMaterial({ map: dieTexture(n), roughness: 0.7 })));
    cube.position.set(CUBE.c[0], H + CUBE.c[1], CUBE.c[2]); cube.rotation.y = CUBE.rot; og.add(cube);
    og.add(mesh(new THREE.SphereGeometry(BALL.r, 32, 20), new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.55 }), BALL.c[0], H + BALL.c[1], BALL.c[2]));
    og.add(mesh(new THREE.BoxGeometry(8, 0.6, 6), MAT.paint(0x3a3f45), 0, H - 2, 0));
    app.addComponent(new Component({ key: 'obj', name: '被摄物体（骰子和小球）', icon: ICONS.object, zone: 'slot', defaultSlot: 'obj', required: true, object: og, labelY: H + 8, desc: '白色漫反射物体，固定在载物台上。' }));
    // 干板架（固定）
    const hg = new THREE.Group();
    hg.add(mesh(new THREE.BoxGeometry(16, 1, 6), MAT.dark(), 0, 0.5, 0));
    for (const sx of [-1, 1]) hg.add(mesh(new THREE.BoxGeometry(1, H + PLATE_H / 2 + 1, 1.4), MAT.paint(0x2f3a36), sx * (PLATE_W / 2 + 0.6), (H + PLATE_H / 2 + 1) / 2, 0));
    hg.add(mesh(new THREE.BoxGeometry(PLATE_W + 2.2, 0.8, 1.4), MAT.paint(0x2f3a36), 0, H - PLATE_H / 2 - 0.4, 0));
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(PLATE_W, PLATE_H), new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.9 }));
    this.card.position.set(0, H, -0.35); hg.add(this.card);
    hg.position.set(PL[0], 0, PL[1]);
    app.addComponent(new Component({ key: 'holder', name: '干板架', zone: 'none', fixed: true, object: hg, showLabel: false, desc: `可放干板或光功率计探头。空架时后面贴一张白卡，可以看光斑。干板尺寸 ${PLATE_W}×${PLATE_H} cm。` }));
    // 光功率计
    const mg = new THREE.Group();
    mg.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 24), MAT.black(), 0, H, 0).rotateX(Math.PI / 2));
    const mbox = meterBox(14, 8, 10, '光功率计（探头 1 cm²）'); mbox.group.position.set(-24, 0, 6); mg.add(mbox.group); this.mbox = mbox;
    app.addComponent(new Component({
      key: 'meter', name: '光功率计', icon: ICONS.detector, zone: 'slot', defaultSlot: 'hold', noFree: true, object: mg, labelY: H + 6,
      desc: '探头面积 1 cm²，放在干板架上，示数（μW）即干板处的光强（μW/cm²）。室内灯光也会被测到。',
      controls: () => [{ type: 'readout', label: '示数', get: () => { const m = this.meter(); return m == null ? '—' : `${m.toFixed(2)} μW/cm²`; } }],
    }));
    // 全息干板
    this.plateMat = new THREE.MeshPhysicalMaterial({ color: 0x5b6b4f, roughness: 0.2, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
    const pg = new THREE.Group(); const pm = new THREE.Mesh(new THREE.BoxGeometry(PLATE_W, PLATE_H, 0.2), this.plateMat); pm.position.y = H; pg.add(pm);
    app.addComponent(new Component({
      key: 'plate', name: '全息干板（红敏）', icon: ICONS.holo, zone: 'slot', defaultSlot: 'hold', noFree: true, object: pg, labelY: H + 7,
      desc: `银盐全息干板，分辨率 > 3000 线/mm，对 633 nm 敏感，对绿色安全灯不敏感。盒上标注：最佳曝光量约 ${E0_SPEC} μJ/cm²；D-19 显影 3～5 min（20 ℃），定影 ≥ 3 min。`,
      controls: () => [
        { type: 'readout', label: '状态', get: () => this.plateState() },
        { type: 'knob', label: '显影时间', get: () => this.td, set: (v) => (this.td = clamp(v, 0.5, 10)), min: 0.5, max: 10, step: 0.5, bigStep: 1, perRev: 5, digits: 1, unit: 'min' },
        { type: 'knob', label: '定影时间', get: () => this.tf, set: (v) => (this.tf = clamp(v, 0, 10)), min: 0, max: 10, step: 0.5, bigStep: 1, perRev: 5, digits: 1, unit: 'min' },
        { type: 'toggle', label: '漂白（变成位相型全息图）', get: () => this.bleach, set: (v) => (this.bleach = v) },
        { type: 'button', label: '取下冲洗：显影→停显→定影→水洗→（漂白）→晾干，放回原位', onClick: () => this.process() },
        { type: 'button', label: '换一块新干板', onClick: () => { this.newPlate(); this.app.toast('已换上新干板', 'ok'); } },
      ],
    }));
    // 观察者的眼睛
    const eg = new THREE.Group();
    eg.add(mesh(new THREE.SphereGeometry(1.2, 24, 16), MAT.white(), 0, H, 0));
    eg.add(mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshStandardMaterial({ color: 0x3b2f22 }), 0, H, 1.21));
    this.eyeObj = eg;
    app.addComponent(new Component({
      key: 'eye', name: '观察者的眼睛', icon: ICONS.scope, zone: 'slot', defaultSlot: 'view', noFree: true, object: eg, labelY: H + 6,
      desc: '在干板后面透过干板观察。左右、上下移动头部可以看到视差。',
      controls: () => [
        { type: 'slider', label: '头部左右（视角）', get: () => this.alpha, set: (v) => (this.alpha = v), min: -25, max: 25, step: 0.5, digits: 1, unit: '°' },
        { type: 'slider', label: '头部上下', get: () => this.beta, set: (v) => (this.beta = v), min: -12, max: 12, step: 0.5, digits: 1, unit: '°' },
      ],
    }));

    // 光束
    this.beamDraw = new BeamDraw(scene, { max: 40 });
    this.objGlow = new THREE.PointLight(0xff2a1a, 0, 30, 1.5); scene.add(this.objGlow);

    this.vAlign = app.addView({ id: 'align', title: '干板架处的白屏（左） · 物体处（右）', w: 300, h: 150, res: 1 });
    this.vEye = app.addView({ id: 'eye', title: '透过干板看到的景象', w: 300, h: 220, res: 1 });
  }

  onRemove(c) { if (c.key === 'meter' || c.key === 'plate') this.app.changed(); }
  onPlace(c) {
    if (c.key === 'm1' && !this.app.isFree(c)) c.root.position.set(M1X, 0, this.z1);
    // 镜子刚放上去时镜架大致对着该去的方向，但有几度偏差，需要细调
    if (c.key === 'm1') this.psi1 = wrap180(this.aim('m1') + this.err1);
    if (c.key === 'm2') this.psi2 = wrap180(this.aim('m2') + this.err2);
  }
  plateState() {
    if (this.holo) return this.holo.bleached ? '已冲洗、漂白的全息图' : '已冲洗的全息图（未漂白）';
    const E = this.acc.Er + this.acc.Eo + this.acc.Ebg;
    return E < 0.5 ? '未曝光' : `已曝光 ${E.toFixed(0)} μJ/cm²${this.acc.Ebg > 5 ? '（含杂散光！）' : ''}`;
  }

  expose() {
    if (!this.on('shutter')) return this.app.toast('没有快门', 'warn');
    if (this.expLeft > 0) return;
    if (this.shOpen) { this.shOpen = false; this.app.toast('快门原来是常开的，已先关闭', 'warn'); }
    if (!this.slotHas('plate')) this.app.toast('干板架上没有干板', 'warn');
    this.expLeft = this.tSet; this.expCount++;
    this.app.changed();
  }

  /** 冲洗：由曝光记录算出全息图的衍射效率和噪声 */
  process() {
    if (!this.slotHas('plate')) return this.app.toast('干板不在干板架上', 'warn');
    if (this.holo) return this.app.toast('这块干板已经冲洗过了', 'warn');
    const a = this.acc;
    if (this.room) { a.Ebg += 1e4; this.app.toast('在白光下冲洗，干板全部感光变黑！', 'warn'); }
    const g = (1 - Math.exp(-this.td / 1.6)) / (1 - Math.exp(-4 / 1.6));
    const Ef = this.E0 * 0.04 * Math.max(0, this.td - 5); // 过度显影的化学灰雾
    const Etot = g * (a.Er + a.Eo + a.Ebg) + Ef;
    const x = Etot / this.E0;
    const Vm = Etot > 0 ? (g * a.Emod) / Etot : 0; // 曝光量的调制度
    const t0 = 1 / (1 + x ** 3), slope = (3 * x ** 3) / (1 + x ** 3) ** 2;
    const lin = slope * Vm, dt = Math.min(lin, t0, 1 - t0), excess = Math.max(0, lin - dt);
    const fixed = this.tf >= 2;
    let eta, tp, noise;
    const K = a.Eo > 0 ? a.Er / a.Eo : Infinity;
    if (this.bleach) { const dphi = 3.2 * dt; eta = besselJ1(dphi) ** 2 * 0.92; tp = 0.85; noise = 0.006 + eta * 0.06 * (1 - t0); }
    else { eta = (dt / 2) ** 2; tp = Math.max(0.03, t0); noise = 0.001; }
    noise += eta * (0.45 / Math.max(K, 0.3)) + 0.04 * excess * (this.bleach ? 1 : 0.3);
    if (!fixed) { eta *= 0.5; tp *= 0.6; noise += 0.04; }
    this.holo = { eta, tp, noise, x, Vm, K, g, fixed, bleached: this.bleach, Etot, Vcoh: a.Eint > 0 ? a.EmodC / a.Eint : 0, Vvib: a.EmodC > 0 ? a.Emod / a.EmodC : 0, Vk: a.Er + a.Eo > 0 ? (2 * Math.sqrt(a.Er * a.Eo)) / (a.Er + a.Eo) : 0, fog: (a.Er + a.Eo + a.Ebg) > 0 ? a.Ebg / (a.Er + a.Eo + a.Ebg) : 0 };
    this.plateMat.color.set(this.bleach ? 0xdfe6e0 : new THREE.Color().setScalar(0.1 + 0.8 * tp));
    this.plateMat.opacity = this.bleach ? 0.35 : 0.9;
    this.app.toast(fixed ? '冲洗完成，干板放回干板架原位' : '冲洗完成，但定影不充分，干板发白', fixed ? 'ok' : 'warn');
    this.app.changed();
  }

  tick(dt) {
    const ds = Math.min(0.25, dt) * (this.app.running ? this.app.speed : 1);
    this.simT += ds;
    const floor = 0.004;
    this.vib = floor + (this.vib - floor) * Math.exp(-ds / 10);
    let refresh = false;
    if (this.expLeft > 0) {
      this.expLeft -= ds;
      if (this.expLeft <= 0) { this.expLeft = 0; this.app.toast('曝光结束，快门关闭', 'ok'); }
      refresh = true;
    }
    if (this.slotHas('plate') && !this.holo) {
      const o = this.optics(), a = this.acc;
      a.Er += o.Ir * ds; a.Eo += o.Io * ds; a.Ebg += (this.room ? 40 : 0.01) * ds;
      const c0 = 2 * Math.sqrt(o.Ir * o.Io) * ds, c = c0 * o.Vcoh;
      a.Eint += c0; a.EmodC += c; a.Emod += c * this.Vvib();
      if (o.Ir + o.Io > 0 || this.room) refresh = true;
    }
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 0.25) { this._acc = 0; refresh = true; }
    if (refresh) this.app.changed();
  }

  /** 机械状态改变时台面振动 */
  shake() {
    const s1 = ['laser', 'shutter', 'bs', 'e1', 'm1', 'm2', 'e2', 'obj', 'meter', 'plate'].map((k) => (this.on(k) ? k : '')).join(',');
    const s2 = [this.psi1, this.psi2, this.z1, this.phi, this.blockR, this.blockO, ...['laser', 'shutter', 'bs', 'e1', 'm1', 'm2', 'e2', 'obj'].map((k) => { const c = this.app.comp(k); return c.placed ? c.root.position.x.toFixed(2) + c.root.position.z.toFixed(2) + c.root.rotation.y.toFixed(4) : ''; })].map(String).join(',');
    if (this._sig && s1 !== this._sig) this.vib = Math.max(this.vib, 0.35);
    else if (this._sig2 && s2 !== this._sig2) this.vib = Math.max(this.vib, 0.12);
    this._sig = s1; this._sig2 = s2;
  }

  update() {
    this.shake();
    const app = this.app, st = app.stage;
    st.ambient.intensity = this.room ? this.amb0 : this.amb0 * 0.25;
    st.keyLight.intensity = this.room ? this.key0 : this.key0 * 0.15;
    // 镜架朝向
    // 镜面（圆柱轴即法线）：局部法线 = 绕竖直轴转过镜架转角的 +x
    const setMirror = (h, psi) => h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(psi * D2R), 0, -Math.sin(psi * D2R)));
    setMirror(this.m1Holder, this.psi1); setMirror(this.m2Holder, this.psi2);
    this.cardR.visible = this.on('e1') && this.blockR; this.cardO.visible = this.on('e2') && this.blockO;
    this.card.visible = !this.slotHas('meter') && !this.slotHas('plate');
    this.shBlade.position.y = H + (this.light() ? 2.2 : 0);
    this.shCtrl.setText(this.expLeft > 0 ? this.expLeft.toFixed(1) : this.tSet.toFixed(1), 's', this.expLeft > 0 ? '曝光中' : this.shOpen ? '常开' : '关闭');
    if (this.on('meter')) { const m = this.meter(); this.mbox.setText(m == null ? '----' : m.toFixed(2), 'μW', ''); }
    this.drawBeams();
    this.drawAlign();
    this.drawEye();
  }

  drawBeams() {
    const tr = this.trace(), bd = this.beamDraw;
    bd.visibility = this.room ? 0.45 : 1;
    bd.draw(this.light() ? tr : null, this.P);
    // 物体被照亮时的红色漫反射
    const o = this.optics(), ob = this.pos('obj');
    this.objGlow.position.set(ob[0], H + 3, ob[1] - 3);
    this.objGlow.intensity = this.on('obj') && o.Io > 0 ? Math.min(60, o.Io * 40) : 0;
  }

  /** 调光路用的观察窗：干板架白屏 + 物体 */
  drawAlign() {
    const v = this.vAlign, g = v.ctx, W = v.W, Hh = v.H, half = W / 2;
    g.fillStyle = this.room ? '#3a3d3b' : '#070808'; g.fillRect(0, 0, W, Hh);
    const o = this.optics();
    // 左：干板架处，5 px/cm
    const s = 5, cx = half / 2, cy = Hh / 2;
    const img = g.createImageData(half - 2, Hh);
    const hasPlate = this.slotHas('plate'), hasMeter = this.slotHas('meter');
    const spotX = o.spot ? o.spot[0] : 1e3, spotY = o.spot ? o.spot[1] : 0;
    for (let py = 0; py < Hh; py++) for (let px = 0; px < half - 2; px++) {
      const X = (px - cx) / s, Y = (cy - py) / s;
      const inP = Math.abs(X) < PLATE_W / 2 && Math.abs(Y) < PLATE_H / 2;
      let I = 0;
      if (o.IrPk > 0) I += o.IrPk * Math.exp((-2 * ((X - spotX) ** 2 + (Y - spotY) ** 2)) / o.wR ** 2);
      I += o.Io;
      let alb = inP ? (hasPlate ? (this.holo ? (this.holo.bleached ? 0.05 : 0.08) : 0.12) : 0.85) : 0.08;
      if (hasMeter && Math.hypot(X, Y) < 1.6) alb = 0.03;
      const amb = this.room ? 0.28 : 0.01;
      const val = Math.min(1, alb * (1 - Math.exp(-I / 6)) * 1.3);
      const k = (py * (half - 2) + px) * 4;
      img.data[k] = 255 * Math.min(1, val + amb * alb); img.data[k + 1] = 255 * Math.min(1, val * 0.18 + amb * alb); img.data[k + 2] = 255 * Math.min(1, val * 0.15 + amb * alb * 0.95); img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(160,170,165,.6)'; g.setLineDash([3, 3]); g.strokeRect(cx - (PLATE_W / 2) * s, cy - (PLATE_H / 2) * s, PLATE_W * s, PLATE_H * s); g.setLineDash([]);
    // 右：物体处，12 px/cm
    const s2 = 12, cx2 = half + half / 2, cy2 = Hh / 2;
    const ox = isFinite(o.offO) ? o.sideO * o.offO : 1e3;
    const lit = this.light() && isFinite(o.offO);
    const Po = lit ? 1 : 0;
    g.save(); g.beginPath(); g.rect(half + 2, 0, half - 2, Hh); g.clip();
    g.fillStyle = this.room ? '#3a3d3b' : '#070808'; g.fillRect(half + 2, 0, half, Hh);
    if (this.on('obj')) {
      const base = this.room ? 0.55 : 0.02;
      const shade = (lvl) => `rgb(${Math.round(255 * Math.min(1, lvl))},${Math.round(255 * Math.min(1, this.room ? lvl : lvl * 0.2))},${Math.round(255 * Math.min(1, this.room ? lvl * 0.95 : lvl * 0.16))})`;
      const ill = (X) => Po * Math.exp((-2 * (X - ox) ** 2) / Math.max(0.01, o.wO ** 2));
      // 骰子
      for (let i = 0; i < 8; i++) {
        const X = CUBE.c[0] - CUBE.s / 2 + ((i + 0.5) * CUBE.s) / 8;
        g.fillStyle = shade(base + ill(X) * 0.9); g.fillRect(cx2 + (X) * s2, cy2 - (CUBE.s / 2) * s2, (CUBE.s * s2) / 8 + 0.5, CUBE.s * s2);
      }
      g.fillStyle = shade(base + ill(BALL.c[0]) * 0.9); g.beginPath(); g.arc(cx2 + BALL.c[0] * s2, cy2 - BALL.c[1] * s2, BALL.r * s2, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,.55)';
      for (const [u, w] of PIPS[5]) { g.beginPath(); g.arc(cx2 + (CUBE.c[0] + u * 0.9) * s2, cy2 - w * 0.9 * s2, 0.28 * s2, 0, Math.PI * 2); g.fill(); }
    }
    if (lit && o.wO > 0) {
      const gx = cx2 + ox * s2, gr = g.createRadialGradient(gx, cy2, 0, gx, cy2, o.wO * s2 * 1.3);
      gr.addColorStop(0, 'rgba(255,40,30,.35)'); gr.addColorStop(1, 'rgba(255,40,30,0)');
      g.fillStyle = gr; g.fillRect(half + 2, 0, half, Hh);
    }
    g.restore();
    g.fillStyle = '#1b1f1e'; g.fillRect(half - 2, 0, 4, Hh);
    let foot = '';
    if (!this.laserOn) foot = '激光器未打开';
    else if (!this.light()) foot = '快门关闭';
    else if (this.assist) foot = `参考光斑偏离干板中心 ${isFinite(o.offR) ? o.offR.toFixed(1) : '—'} cm · 物光偏离物体 ${isFinite(o.offO) ? o.offO.toFixed(1) : '—'} cm`;
    v.foot(foot);
  }

  makeSpeckle(N) {
    const re = new Float32Array(N * N), im = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) { re[i] = gauss(1); im[i] = gauss(1); }
    const out = new Float32Array(N * N);
    let sum = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let a = 0, b = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = ((y + dy + N) % N) * N + ((x + dx + N) % N); a += re[j]; b += im[j]; }
      out[y * N + x] = a * a + b * b; sum += a * a + b * b;
    }
    for (let i = 0; i < N * N; i++) out[i] /= sum / (N * N);
    return { N, d: out };
  }

  /** 眼睛位置与针孔投影 */
  camera(W, Hh) {
    const R = 30, a = this.alpha * D2R, b = this.beta * D2R;
    const E = new THREE.Vector3(PL[0] + R * Math.sin(a) * Math.cos(b), H + R * Math.sin(b), PL[1] - R * Math.cos(a) * Math.cos(b));
    const ob = this.pos('obj');
    const f = new THREE.Vector3(ob[0] * 0.6, H, (ob[1] + PL[1]) / 2).sub(E).normalize();
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const u = new THREE.Vector3().crossVectors(r, f);
    const F = W / 2 / Math.tan(11 * D2R);
    const proj = (p) => { const d = p.clone().sub(E); const z = d.dot(f); return [W / 2 + (F * d.dot(r)) / z, Hh / 2 - (F * d.dot(u)) / z, z]; };
    return { E, f, proj, F };
  }

  /** 画出物体的灰度图（激光照明的明暗） */
  drawScene(ctx, W, Hh, cam) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, Hh);
    const ob = this.pos('obj'), e2 = this.pos('e2');
    const L = (this._uObj ? this._uObj.clone().negate().setY(0.2) : new THREE.Vector3(e2[0] - ob[0], 4, e2[1] - ob[1])).normalize();
    const O = new THREE.Vector3(ob[0], H, ob[1]);
    const oc = this.app.comp('obj'), orot = oc.placed ? oc.root.rotation.y : 0;
    const R0 = (v) => new THREE.Vector3(v[0] * Math.cos(orot) + v[2] * Math.sin(orot), v[1], -v[0] * Math.sin(orot) + v[2] * Math.cos(orot));
    const items = [];
    // 骰子
    const c = O.clone().add(R0(CUBE.c)), hs = CUBE.s / 2, cr = CUBE.rot + orot;
    const rot = (v) => new THREE.Vector3(v.x * Math.cos(cr) + v.z * Math.sin(cr), v.y, -v.x * Math.sin(cr) + v.z * Math.cos(cr));
    const faces = [[new THREE.Vector3(1, 0, 0), 3], [new THREE.Vector3(-1, 0, 0), 4], [new THREE.Vector3(0, 1, 0), 1], [new THREE.Vector3(0, -1, 0), 6], [new THREE.Vector3(0, 0, 1), 2], [new THREE.Vector3(0, 0, -1), 5]];
    for (const [n0, pips] of faces) {
      const n = rot(n0), fc = c.clone().addScaledVector(n, hs);
      if (n.dot(cam.E.clone().sub(fc)) <= 0) continue;
      const t1 = rot(Math.abs(n0.y) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
      const t2 = new THREE.Vector3().crossVectors(n, t1);
      const pt = (a, b) => cam.proj(fc.clone().addScaledVector(t1, a).addScaledVector(t2, b));
      const sh = 0.1 + 0.9 * Math.max(0, n.dot(L));
      items.push({ z: cam.proj(fc)[2], draw: () => {
        ctx.fillStyle = `rgb(${255 * sh},${255 * sh},${255 * sh})`;
        ctx.beginPath(); [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]].forEach(([a, b], i) => { const p = pt(a, b); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.closePath(); ctx.fill();
        ctx.fillStyle = `rgb(${40 * sh},${40 * sh},${40 * sh})`;
        for (const [pu, pv] of PIPS[pips]) {
          ctx.beginPath();
          for (let k = 0; k <= 10; k++) { const th = (k / 10) * Math.PI * 2; const p = pt(pu * 0.95 + 0.34 * Math.cos(th), pv * 0.95 + 0.34 * Math.sin(th)); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
          ctx.fill();
        }
      } });
    }
    // 小球
    const bc = O.clone().add(R0(BALL.c)), pb = cam.proj(bc), rr = (cam.F * BALL.r) / pb[2];
    items.push({ z: pb[2], draw: () => {
      const lp = cam.proj(bc.clone().addScaledVector(L, BALL.r * 0.6));
      const gr = ctx.createRadialGradient(lp[0], lp[1], rr * 0.05, pb[0], pb[1], rr);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.7, '#7a7a7a'); gr.addColorStop(1, '#1a1a1a');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(pb[0], pb[1], rr, 0, Math.PI * 2); ctx.fill();
    } });
    // 托板
    const bz = O.clone().add(new THREE.Vector3(0, -2, 0));
    items.push({ z: cam.proj(bz)[2] + 3, draw: () => {
      ctx.fillStyle = 'rgb(40,40,40)'; ctx.beginPath();
      [[-4, -3], [4, -3], [4, 3], [-4, 3]].forEach(([a, b], i) => { const p = cam.proj(bz.clone().add(new THREE.Vector3(a, 0, b))); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.closePath(); ctx.fill();
    } });
    items.sort((p, q) => q.z - p.z).forEach((it) => it.draw());
  }

  drawEye() {
    const v = this.vEye, g = v.ctx, W = v.W, Hh = v.H;
    if (!this.on('eye')) { g.fillStyle = '#0b0d0c'; g.fillRect(0, 0, W, Hh); v.foot('把“观察者的眼睛”放到干板架后面'); return; }
    const cam = this.camera(W, Hh);
    const o0 = this.optics(); this._uObj = o0.uObj;
    const oc = this.app.comp('obj');
    const key = `${this.alpha},${this.beta},${this.on('obj')},${oc.placed ? oc.root.position.x.toFixed(2) + oc.root.position.z.toFixed(2) + oc.root.rotation.y.toFixed(3) : ''},${o0.uObj ? o0.uObj.x.toFixed(2) + o0.uObj.z.toFixed(2) : ''}`;
    const off = this._eyeOff || (this._eyeOff = document.createElement('canvas'));
    if (this._eyeKey !== key) {
      off.width = W; off.height = Hh;
      const c2 = off.getContext('2d');
      if (this.on('obj')) this.drawScene(c2, W, Hh, cam); else { c2.fillStyle = '#000'; c2.fillRect(0, 0, W, Hh); }
      this._shade = c2.getImageData(0, 0, W, Hh).data;
      // 物体的再现像总是在原来的位置
      if (!this.on('obj')) { this.drawScene(c2, W, Hh, cam); this._ghost = c2.getImageData(0, 0, W, Hh).data; } else this._ghost = this._shade;
      this._eyeKey = key;
    }
    const sh = this._shade, gh = this._ghost;
    // 干板窗口（凸四边形）
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => cam.proj(new THREE.Vector3(PL[0] + (a * PLATE_W) / 2, H + (b * PLATE_H) / 2, PL[1])));
    const inside = (x, y) => {
      let pos = 0, neg = 0;
      for (let i = 0; i < 4; i++) { const p = corners[i], q = corners[(i + 1) % 4]; const c = (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]); if (c > 0) pos++; else if (c < 0) neg++; }
      return !(pos && neg) && corners.every((p) => p[2] > 0);
    };
    const o = this.optics();
    const hasPlate = this.slotHas('plate'), hasMeter = this.slotHas('meter');
    const Tp = hasMeter ? 0 : hasPlate ? (this.holo ? this.holo.tp : 0.55) : 1;
    const Breal = o.Io / I_N;
    const Bimg = hasPlate && this.holo ? (this.holo.eta * o.Ir) / I_N : 0;
    const haze = hasPlate && this.holo ? (this.holo.noise * o.Ir) / I_N : 0;
    const room = this.room;
    const S = this.speckle, N = S.N;
    const sx0 = Math.round(this.alpha * 9), sy0 = Math.round(this.beta * 9);
    const img = g.createImageData(W, Hh), d = img.data;
    const tone = (b) => 1 - Math.exp(-1.7 * b);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const win = inside(x, y);
      const s = sh[k] / 255, sg = gh[k] / 255;
      const sp = S.d[(((y + sy0) % N) + N) % N * N + (((x + sx0) % N) + N) % N];
      const sp2 = S.d[(((y * 3 + 17) >> 1) % N) * N + (((x * 3 + sx0) >> 1) % N + N) % N];
      let red = s * Breal * (win ? Tp : 1) * sp;
      if (win) red += sg * Bimg * sp + haze * sp2 * 0.2;
      red = tone(red);
      let wr = 0, wg = 0, wb = 0;
      if (room) { const amb = (s > 0 ? s * 0.75 + 0.1 : 0.2) * (win ? Math.max(0.15, Tp) : 1); wr = wg = wb = amb; }
      d[k] = 255 * Math.min(1, red + wr); d[k + 1] = 255 * Math.min(1, red * 0.12 + wg); d[k + 2] = 255 * Math.min(1, red * 0.1 + wb * 0.95); d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // 干板边框
    g.strokeStyle = room ? '#555' : '#2a2a2a'; g.lineWidth = 2; g.beginPath(); corners.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke();
    // 直视参考光：眼睛进入参考光束
    let glare = 0;
    if (o.ref) {
      // 参考光穿过干板继续前进：眼睛若在光束里就会直视到扩束镜焦点（虚光源）
      const h = o.ref, u = h.u, D = h.w / DIV;
      const d = cam.E.clone().sub(h.q), along = d.dot(u), perp = d.clone().addScaledVector(u, -along).length();
      const w = h.w + DIV * Math.max(0, along);
      glare = along > 0 ? (o.IrPk / 5) * Math.exp((-2 * perp ** 2) / (w * w)) * (hasMeter ? 0 : hasPlate ? 0.85 : 1) : 0;
      if (glare > 0.01) {
        const src = h.q.clone().addScaledVector(u, -D);
        const p = cam.proj(src);
        if (p[2] > 0) {
          const R0 = 6 + 60 * Math.min(1, glare);
          const gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], R0);
          gr.addColorStop(0, `rgba(255,255,255,${Math.min(1, glare)})`); gr.addColorStop(0.3, `rgba(255,60,40,${Math.min(1, glare)})`); gr.addColorStop(1, 'rgba(255,0,0,0)');
          g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
        }
      }
    }
    let foot = '';
    if (glare > 0.05) foot = '眼睛进入了参考光束！实际实验中切勿直视激光';
    else if (hasMeter) foot = '干板架上是光功率计探头';
    else if (hasPlate && this.holo && Bimg > 0.02) foot = Breal > 0.05 ? '物体仍被照明：看到的是物体本身和再现像的叠加' : '再现的虚像：移动头部观察视差';
    else if (hasPlate && this.holo) foot = o.Ir > 0 ? '再现像很暗或看不到' : '参考光没有照到全息图';
    else if (room) foot = '室内照明';
    v.foot(foot);
  }

  globalControls() {
    return [
      { type: 'toggle', label: '室内照明（关闭后只有绿色安全灯）', get: () => this.room, set: (v) => (this.room = v) },
      { type: 'toggle', label: '挡住物光', get: () => this.blockO, set: (v) => (this.blockO = v) },
      { type: 'toggle', label: '挡住参考光', get: () => this.blockR, set: (v) => (this.blockR = v) },
      { type: 'readout', label: '台面振动（干涉监视器）', get: () => `条纹抖动约 ${((2 * this.vib) / LAM).toFixed(2)} 条` },
      { type: 'toggle', label: '显示调节辅助', get: () => this.assist, set: (v) => (this.assist = v) },
    ];
  }

  tables() {
    return [
      {
        id: 'path', title: '等光程', maxRows: 6,
        columns: [{ key: 'z1', label: 'M1 位置 z/cm', digits: 2, auto: true }, { key: 'Lo', label: '物光光程 L_o/cm', digits: 1 }, { key: 'Lr', label: '参考光光程 L_r/cm', digits: 1 }, { key: 'dL', label: 'ΔL/cm', digits: 1, calc: (r) => r.Lo - r.Lr }],
        buttons: [{ label: '用卷尺量两路光程（从分束镜量到干板）', onClick: (t) => this.recPath(t) }],
        note: `激光有 2～3 个纵模，相干长度约为腔长 ${L_CAV} cm 的量级。要求 |ΔL| < 3 cm。`,
      },
      {
        id: 'ratio', title: '光强比', maxRows: 8,
        columns: [{ key: 'phi', label: '分束镜刻度/°', digits: 1 }, { key: 'Ir', label: 'I_r/(μW/cm²)', digits: 2 }, { key: 'Io', label: 'I_o/(μW/cm²)', digits: 2 }, { key: 'K', label: 'K = I_r/I_o', digits: 2, calc: (r) => r.Ir / r.Io }],
        buttons: [{ label: '记录 I_r（挡住物光）', onClick: (t) => this.recI(t, 'Ir') }, { label: '记录 I_o（挡住参考光）', onClick: (t) => this.recI(t, 'Io') }],
        note: '光功率计探头放在干板架上。关闭室内灯后测量。离轴透射全息一般取 K = 3～6。',
      },
      {
        id: 'exp', title: '曝光时间', maxRows: 4,
        columns: [{ key: 'Is', label: 'I_r+I_o/(μW/cm²)', digits: 2 }, { key: 'E0', label: 'E₀/(μJ/cm²)', digits: 0 }, { key: 't', label: '快门设定 t/s', digits: 1 }, { key: 'E', label: '曝光量 E/(μJ/cm²)', digits: 0, calc: (r) => r.Is * r.t }],
        buttons: [{ label: '记录快门设定（I 取光强比表最后一组）', onClick: (t) => this.recExp(t) }],
        note: `按 t = E₀/(I_r+I_o) 算出曝光时间并设在快门上。E₀ 取干板盒上的标注 ${E0_SPEC} μJ/cm²。`,
      },
    ];
  }
  recPath(t) {
    const need = ['bs', 'e1', 'm1', 'm2', 'e2', 'obj'].filter((k) => !this.on(k));
    if (need.length) return this.app.toast('光路还没有布置完整', 'warn');
    t.addRow({ z1: Math.round(this.m1z() * 100) / 100, Lo: Math.round((this.Lo() + gauss(0.25)) * 10) / 10, Lr: Math.round((this.Lr() + gauss(0.25)) * 10) / 10 });
  }
  recI(t, key) {
    const m = this.meter();
    if (m == null) return this.app.toast('干板架上没有光功率计探头', 'warn');
    if (key === 'Ir' && (!this.blockO || this.blockR)) this.app.toast('测 I_r 时应挡住物光、放开参考光', 'warn');
    if (key === 'Io' && (!this.blockR || this.blockO)) this.app.toast('测 I_o 时应挡住参考光、放开物光', 'warn');
    if (this.room) this.app.toast('室内灯亮着，读数里包含了环境光', 'warn');
    if (!this.light()) this.app.toast('光没有照到干板处（激光器或快门）', 'warn');
    const val = Math.round(m * 100) / 100, phi = Math.round(this.phi * 10) / 10;
    const last = t.rows[t.rows.length - 1];
    if (last && last.phi === phi && last[key] == null) t.set(t.rows.length - 1, key, val);
    else t.addRow({ phi, [key]: val });
  }
  recExp(t) {
    const rows = this.app.table('ratio').completeRows();
    if (!rows.length) return this.app.toast('请先测光强比', 'warn');
    const r = rows[rows.length - 1];
    t.addRow({ Is: Math.round((r.Ir + r.Io) * 100) / 100, E0: E0_SPEC, t: Math.round(this.tSet * 10) / 10 });
  }

  steps() {
    const app = this.app;
    const lastK = () => { const r = app.table('ratio').completeRows(); return r.length ? r[r.length - 1].Ir / r[r.length - 1].Io : NaN; };
    const waitUntil = async (f, ms = 60000) => { const t0 = performance.now(); while (!f() && performance.now() - t0 < ms) await app.wait(150, true); };
    return [
      {
        title: '布置光路',
        html: '<p>在防震平台上按光路图放好：激光器 → 快门 → 可变分束镜。反射光为<b>参考光</b>：扩束镜 L1 → 反射镜 M1 → 干板架；透射光为<b>物光</b>：反射镜 M2 → 扩束镜 L2 → 物体，物体的漫反射光射向干板架。</p>',
        check: () => ['laser', 'shutter', 'bs', 'e1', 'm1', 'm2', 'e2', 'obj'].every((k) => this.on(k)),
        auto: async () => { await app.view('全景'); for (const k of ['laser', 'shutter', 'bs', 'e1', 'm1', 'm2', 'e2', 'obj']) await app.autoPlace(k); },
      },
      {
        title: '等光程：移动 M1',
        html: '<p>用卷尺沿光路量出物光和参考光从分束镜到干板的光程，前后移动 M1 所在的滑轨，使两者之差 <b>|ΔL| < 3 cm</b>，记录。</p>',
        hint: '多纵模激光的两束光相干程度随光程差周期变化，光程差为 0 处最好，约等于腔长时几乎不相干。',
        check: () => app.table('path').completeRows().some((r) => Math.abs(r.Lo - r.Lr) < 3) && Math.abs(this.Lo() - this.Lr()) < 3,
        status: () => `当前 M1 位置 z = ${this.m1z().toFixed(1)} cm${this.assist ? `，ΔL = ${(this.Lo() - this.Lr()).toFixed(1)} cm` : ''}`,
        auto: async () => {
          const c = app.comp('m1'); app.select(c);
          const z0 = this.m1z(), x = this.M1()[0], bs = this.pos('bs'), e1 = this.pos('e1');
          // ΔL 随 M1 的 z 单调变化：二分求等光程位置
          const dLat = (z) => { const m = [x, z]; return this.Lo() - ((this.on('e1') ? dist(bs, e1) + dist(e1, m) : dist(bs, m)) + dist(m, PL)); };
          let lo = 15, hi = 60;
          for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (dLat(m) > 0) lo = m; else hi = m; }
          await app.tween(() => z0, (v) => this.setM1z(v), (lo + hi) / 2 + gauss(0.4), 1000);
          app.showTable(0); await app.record('path');
        },
      },
      {
        title: '调反射镜：光斑对准干板和物体',
        html: '<p>打开激光器，快门置“常开”。转动 M1 的镜架，使参考光斑落在干板架白屏的中央；转动 M2，使物光照亮整个物体。</p>',
        check: () => { const o = this.optics(); return this.light() && o.offR < 1.5 && o.offO < 0.8; },
        status: () => { const o = this.optics(); return this.light() ? `参考光偏 ${isFinite(o.offR) ? o.offR.toFixed(1) : '—'} cm，物光偏 ${isFinite(o.offO) ? o.offO.toFixed(1) : '—'} cm` : '激光未照到'; },
        auto: async () => {
          this.laserOn = true; this.shOpen = true; app.changed(); await app.view('干板架');
          this.trace();
          app.select(app.comp('m1')); await app.tween(() => this.psi1, (v) => (this.psi1 = v), this.psi1 + wrap180(this.aim('m1') - this.psi1) + gauss(0.04), 900);
          this.trace();
          app.select(app.comp('m2')); await app.tween(() => this.psi2, (v) => (this.psi2 = v), this.psi2 + wrap180(this.aim('m2') - this.psi2) + gauss(0.03), 900);
        },
      },
      {
        title: '关灯，测光强比 K',
        html: '<p>关闭室内灯。光功率计探头放到干板架上：挡住物光测 $I_r$，挡住参考光测 $I_o$。转动分束镜刻度盘，使 <b>K = 3～6</b>。</p>',
        check: () => { const K = lastK(); return !this.room && K >= 3 && K <= 6; },
        status: () => { const K = lastK(); return isFinite(K) ? `最后一组 K = <b>${K.toFixed(2)}</b>` : ''; },
        auto: async () => {
          this.room = false; app.changed();
          if (this.slotHas('plate')) app.remove(app.comp('plate'));
          await app.autoPlace('meter', { slot: 'hold' });
          app.showTable(1);
          const meas = async () => {
            this.blockR = false; this.blockO = true; app.changed(); await app.wait(300); await app.record('ratio', 0);
            this.blockO = false; this.blockR = true; app.changed(); await app.wait(300); await app.record('ratio', 1);
          };
          await meas();
          for (let it = 0; it < 3; it++) {
            const K = lastK(); if (K >= 3.4 && K <= 5.6) break;
            const R = this.R(), r = app.table('ratio').completeRows().pop();
            const a = r.Ir / R, b = r.Io / (0.96 - R), Kt = 4.5;
            const Rn = (0.96 * Kt * b) / (a + Kt * b);
            app.select(app.comp('bs'));
            await app.tween(() => this.phi, (v) => (this.phi = v), clamp((300 * Math.log(Rn / 0.02)) / Math.log(45), 0, 300), 900);
            await meas();
          }
          this.blockR = false; app.changed();
        },
      },
      {
        title: '计算并设定曝光时间',
        html: `<p>由 $t=E_0/(I_r+I_o)$ 算出曝光时间（$E_0$ 取干板盒上标注的 ${E0_SPEC} μJ/cm²），设在快门控制器上，记录。然后把快门<b>关闭</b>。</p>`,
        check: () => { const r = app.table('exp').completeRows(); const q = r[r.length - 1]; return !!q && Math.abs(q.t * q.Is - E0_SPEC) / E0_SPEC < 0.1 && !this.shOpen; },
        auto: async () => {
          const r = app.table('ratio').completeRows().pop();
          app.select(app.comp('shutter'));
          await app.tween(() => this.tSet, (v) => (this.tSet = v), Math.round((E0_SPEC / (r.Ir + r.Io)) * 10) / 10, 800);
          this.tSet = Math.round(this.tSet * 10) / 10;
          this.shOpen = false; app.changed();
          app.showTable(2); await app.record('exp');
        },
      },
      {
        title: '装干板，静置',
        html: '<p>在安全灯下取下探头，把干板装到干板架上（乳胶面朝向物体）。装好后不要碰平台，<b>静置</b>到干涉监视器的条纹不再抖动（< 0.05 条）。</p>',
        hint: '曝光期间两束光的光程差只要变化 λ/4，干涉条纹就会被抹平。',
        check: () => this.slotHas('plate') && !this.room && (2 * this.vib) / LAM < 0.05 && !this.holo,
        status: () => `条纹抖动约 <b>${((2 * this.vib) / LAM).toFixed(2)}</b> 条`,
        auto: async () => {
          if (this.slotHas('meter')) app.remove(app.comp('meter'));
          await app.view('干板架');
          await app.autoPlace('plate', { slot: 'hold' });
          app.say('静置，等待平台稳定……');
          await waitUntil(() => (2 * this.vib) / LAM < 0.03);
        },
      },
      {
        title: '曝光',
        html: '<p>按快门控制器上的“定时曝光”。曝光期间保持安静，不要碰平台。</p>',
        check: () => this.expCount > 0 && this.expLeft <= 0 && this.acc.Er + this.acc.Eo > 1,
        status: () => (this.expLeft > 0 ? `曝光中，剩 ${this.expLeft.toFixed(1)} s` : ''),
        auto: async () => { app.select(app.comp('shutter')); this.expose(); await waitUntil(() => this.expLeft <= 0, 120000); },
      },
      {
        title: '冲洗：显影、定影、漂白',
        html: '<p>在安全灯下取下干板，按说明显影 3～5 min，停显，定影 ≥ 3 min，水洗。需要更亮的像时漂白成位相型全息图。晾干后放回干板架<b>原位</b>。</p>',
        check: () => !!this.holo,
        auto: async () => {
          app.select(app.comp('plate'));
          await app.tween(() => this.td, (v) => (this.td = v), 4, 500);
          await app.tween(() => this.tf, (v) => (this.tf = v), 5, 500);
          this.bleach = true; app.changed(); await app.wait(300);
          this.process(); await app.wait(500);
        },
      },
      {
        title: '再现：观察虚像和视差',
        html: '<p>挡住物光（或取走物体），只用参考光照明全息图。把“观察者的眼睛”放到干板后面，透过干板看物体原来的位置，左右上下移动头部，观察立体感和视差。</p>',
        check: () => !!this.holo && this.slotHas('plate') && this.on('eye') && this.light() && !this.blockR && (this.blockO || !this.on('obj')) && this.optics().Ir > 0.5,
        auto: async () => {
          this.blockO = true; this.shOpen = true; app.changed();
          await app.autoPlace('eye', { slot: 'view' }); await app.view('再现观察');
          await app.tween(() => this.alpha, (v) => (this.alpha = v), -10, 900);
          await app.tween(() => this.alpha, (v) => (this.alpha = v), 8, 1400);
        },
      },
      {
        title: '数据处理与评价',
        html: '<p>整理等光程、光强比和曝光时间的数据，并根据再现像的亮度和清晰程度评价这张全息图。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const app = this.app;
    const path = app.table('path').completeRows(), ratio = app.table('ratio').completeRows(), ex = app.table('exp').completeRows();
    if (!ratio.length || !ex.length) return { html: '<p>请先完成光强比和曝光时间的测量记录。</p>', ok: false };
    const r = ratio[ratio.length - 1], K = r.Ir / r.Io, q = ex[ex.length - 1], tTh = E0_SPEC / q.Is;
    let html = '<h3>1. 光路参数</h3>';
    if (path.length) { const p = path[path.length - 1]; html += `<p>物光光程 $L_o=${p.Lo.toFixed(1)}$ cm，参考光光程 $L_r=${p.Lr.toFixed(1)}$ cm，$\\Delta L=${(p.Lo - p.Lr).toFixed(1)}$ cm。</p>`; }
    html += `<p>$I_r=${r.Ir.toFixed(2)}$ μW/cm²，$I_o=${r.Io.toFixed(2)}$ μW/cm²，</p><div class="result-box">$K=I_r/I_o=${K.toFixed(2)}$</div>
      <p>条纹的理想可见度 $V=\\dfrac{2\\sqrt K}{1+K}=${((2 * Math.sqrt(K)) / (1 + K)).toFixed(3)}$。</p>
      <h3>2. 曝光时间</h3><div class="result-box">$t=\\dfrac{E_0}{I_r+I_o}=\\dfrac{${E0_SPEC}}{${q.Is.toFixed(2)}}=${tTh.toFixed(1)}$ s</div><p>快门设定 ${q.t.toFixed(1)} s，曝光量 ${(q.Is * q.t).toFixed(0)} μJ/cm²。</p>`;
    const h = this.holo;
    if (h) {
      const lines = [];
      lines.push(`显影程度（相对 4 min）${h.g.toFixed(2)}，有效曝光量为干板最佳值的 ${(h.x * 100).toFixed(0)}%`);
      lines.push(`记录时的光强比 ${isFinite(h.K) ? h.K.toFixed(2) : '∞'}，相干性因子 ${h.Vcoh.toFixed(2)}，振动因子 ${h.Vvib.toFixed(2)}，杂散光占曝光量的 ${(h.fog * 100).toFixed(1)}%`);
      lines.push(`曝光量的调制度 ${h.Vm.toFixed(2)}，衍射效率 η ≈ ${(h.eta * 100).toFixed(1)}%（${h.bleached ? '漂白后的位相型' : '振幅型'}）`);
      let grade = h.eta > 0.08 && h.noise < h.eta * 0.3 ? '再现像明亮清晰' : h.eta > 0.01 ? '能看到再现像，但较暗或有雾状噪声' : '基本看不到再现像';
      const why = [];
      if (h.Vvib < 0.5) why.push('曝光时平台振动');
      if (h.Vcoh < 0.6) why.push('光程差过大');
      if (h.fog > 0.2) why.push('杂散光（室内灯）');
      if (h.x < 0.4) why.push('曝光或显影不足');
      if (h.x > 2.5) why.push('曝光或显影过度');
      if (isFinite(h.K) && h.K < 1.5) why.push('参考光太弱');
      if (!h.fixed) why.push('定影不充分');
      html += `<h3>3. 全息图评价</h3><p>${lines.join('；')}。</p><div class="result-box${why.length ? ' warn' : ''}">${grade}${why.length ? '。主要原因：' + why.join('、') : ''}。</div>`;
    }
    html += `<p class="muted">干板实际的最佳曝光量与标注值有出入，实验中常用阶梯曝光（同一块干板分段曝光不同时间）来确定。</p>`;
    const answers = [
      { label: '光强比 $K$', value: K, digits: 2, tolRel: 0.02 },
      { label: '曝光时间 $t$', unit: 's', value: tTh, digits: 1, tolRel: 0.03 },
    ];
    return { html, ok: true, answers, plots: [] };
  }

  principle() {
    return `<h3>1. 记录</h3><p>激光分成两束：物光照明物体，物体的漫反射光 $O$ 射到干板上；参考光 $R$ 直接照到干板上。干板记录的是两者的干涉条纹：</p>$$I=|R|^2+|O|^2+R^*O+RO^*$$<p>条纹的明暗记录了物光的振幅，条纹的位置记录了物光的位相，所以叫“全”息。</p>
<h3>2. 再现</h3><p>冲洗后的干板振幅透过率与曝光量成线性关系时，用原参考光照明，透射光中含有 $|R|^2O$ 项，即原来的物光波：透过干板能在原处看到物体的三维虚像，移动头部可以看到不同侧面（视差）。</p>
<h3>3. 实验条件</h3><p>(1) 光程差小于相干长度：多纵模 He-Ne 激光相邻纵模频差 $c/2L$，相干性随光程差周期变化，在 $\\Delta L=0$ 附近最好；<br>(2) 光强比 $K=I_r/I_o$ 取 3～6：太小时物光自身的干涉产生噪声，太大时条纹可见度 $2\\sqrt K/(1+K)$ 下降；<br>(3) 曝光量合适：使干板工作在 $t_a$–$E$ 曲线的线性段；<br>(4) 曝光时稳定：条纹间距约 $\\lambda/(2\\sin(\\theta/2))\\approx 1\\ \\mu\\text{m}$，光程变化 $\\lambda/4$ 就会抹平条纹。</p>
<h3>4. 本仿真的计算模型</h3><p>按各元件的位置和镜架转角计算两路光程、光斑偏离和干板处的光强（高斯光束扩束、朗伯漫反射）。曝光期间逐时累加参考光、物光、杂散光的曝光量和干涉项，干涉项乘以纵模相干因子 $\\cos^2(\\pi\\Delta L/2L)$（三个纵模、强度 1:2:1 时的可见度；两个等强纵模为 $|\\cos(\\pi\\Delta L/2L)|$）和振动因子。冲洗按 $t_a=1/(1+x^3)$ 的特性曲线求调制，振幅型 $\\eta=(\\Delta t/2)^2$，漂白后 $\\eta=J_1^2(\\Delta\\varphi)$。再现画面由透视投影得到，叠加激光散斑。</p>`;
  }
}
