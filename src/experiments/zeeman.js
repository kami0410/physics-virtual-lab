// 实验：塞曼效应（电磁铁 + 笔形汞灯；光具座上自己搭：聚光透镜、滤光片、F-P 标准具、偏振片、成像透镜、测微目镜）
// 光路的亮度、成像、调焦都由元件在导轨上的实际位置算出；标准具两板的平行度用三颗螺钉调，用眼睛直接看标准具检查。
// 横向观察（垂直于磁场）。9 条分量的位置与强度见 physics/zeeman.js；偏振片透振方向与 B 的夹角为 φ 时，
// π 成分透过 cos²φ，σ 成分透过 sin²φ。干涉圆环按 2dσcosθ = k 逐分量计算，成像在测微目镜的分划板上（焦距 f）。
// 测微目镜的鼓轮读数 x 与叉丝实际位置 c 之间有空回：c ∈ [x − b, x]，换向时叉丝先不动。
import * as THREE from 'three';
import { meta, thumb } from './zeeman.meta.js';
import { Component } from '../core/Component.js';
import { AXIS_Y, MAT, mesh, labTable, opticalRail, carriage, meterBox, glowSprite, rotatorMesh, lensMesh, knobMesh, ICONS, Beam } from '../core/Models.js';
import { rand, relErr, pct, clamp, fmtU, mean, stdev } from '../core/Stats.js';
import { HG546, ringTheta, lorentz, airyAvg, EM_TRUE, C_LIGHT, LAM0 } from '../physics/zeeman.js';
import { zeemanFig } from './modernFigs.js';
import { GPU, GLSL } from '../core/gpu.js';

const D_NOM = 2e-3, F_LENS = 0.12, NAIR = 1.000277; // m
const SIG0 = 1 / (LAM0 * NAIR); // 546.1 nm 的真空波数（m⁻¹）
const YB = AXIS_Y, FIELD = 8; // 光轴高度 cm；目镜视场宽度 mm
// 目镜视场的同心圆环：按到圆环中心的距离查径向光强表（R、G、B 各一张），与 CPU 逐像素循环结果一致
const RINGS_FS = GLSL.lut + `
uniform sampler2D uPR, uPG, uPB; uniform float uCx, uCy, uSc, uW, uH, uN;
vec3 shade(vec2 L) {
  vec2 d = L - vec2(uW, uH) * 0.5;
  if (dot(d, d) > uW * uW * 0.25) return vec3(0.0);
  float f = length(L - vec2(uCx, uCy)) / uSc / 7.0 * (uN - 1.0);
  return vec3(lut(uPR, f), lut(uPG, f), lut(uPB, f));
}`;
const OTHER = [ // 不加滤光片时同时进入的其他汞谱线（只画不分裂的圆环）：空气波长 nm、强度、颜色
  { lam: 576.96, w: 0.7, rgb: [255, 220, 40] }, { lam: 579.07, w: 0.75, rgb: [255, 200, 30] }, { lam: 435.83, w: 0.9, rgb: [80, 90, 255] }, { lam: 404.66, w: 0.4, rgb: [150, 60, 255] },
];
// 要测的 π 分量：k 级（最内）与 k−1 级，各 a（内）c（中）b（外）
const ROWS = [[0, -0.5, 'a（内）'], [0, 0, 'c（中）'], [0, 0.5, 'b（外）'], [1, -0.5, 'a（内）'], [1, 0, 'c（中）'], [1, 0.5, 'b（外）']];

// ---------- 光具座 ----------
// 汞灯在两磁极之间，位于导轨坐标 0；其余元件由学生从器材柜取出放到导轨上（导轨 10–110 cm）。
const LP = 0; // 汞灯位置 cm
const F1 = 15, F2 = F_LENS * 100; // 聚光透镜、成像透镜焦距 cm
const DEF = { lens1: 15, filter: 22, fp: 32, pol: 40, lens2: 52, eye: 64 }; // 自动放置的位置
const ORDER = ['lens1', 'fp', 'lens2', 'eye']; // 必须按这个顺序；滤光片、偏振片放在汞灯与目镜之间任意处
const SCREW_A = [90, 210, 330].map((d) => (d * Math.PI) / 180), SCREW_R = 1.5; // 标准具平行度螺钉的方位与半径（cm）
const PAR_TOL = 0.02; // 两板平行的判据：间隔沿口径的变化率 μm/cm（全口径不到 0.1 级）
const DZ_TOL = 0.05; // 调焦判据：分划板离成像透镜焦面 cm
const LAM_UM = 0.546;

export class ZeemanExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    const K = Math.floor(2 * D_NOM * SIG0);
    this.d = (K + rand(0.32, 0.68)) / (2 * SIG0); // 实际间隔与标称 2.000 mm 相差不到半个波长，只决定中心的级次小数
    this.K = Math.floor(2 * this.d * SIG0); // 最内亮环的级次
    this.Rf = rand(0.86, 0.9); this.F = (4 * this.Rf) / (1 - this.Rf) ** 2;
    this.Bs = rand(1.32, 1.4); this.Ic = rand(2.8, 3.2); this.cur = 0;
    this.Bk = rand(0.985, 1.015); // 磁极间磁场不完全均匀：汞灯处的 B 与霍尔探头处略有不同
    this.tmOff = rand(4, 12) * (Math.random() < 0.5 ? -1 : 1); this.tmZeroed = false; // 特斯拉计零点（mT）
    this.lampOn = false; this.warm = 0; this.phi = rand(20, 70);
    const sg = () => (Math.random() < 0.5 ? -1 : 1);
    this.tube = rand(0.4, 1.1) * sg(); // 测微目镜镜筒伸缩（调焦）cm：分划板相对滑座刻线的位置
    this.ax = rand(0.3, 0.9) * sg(); this.ay = rand(0.2, 0.7) * sg(); // 测微目镜横向、竖直微调 mm
    // 标准具两板不平行：间隔沿口径的变化率（μm/cm），出厂后运输、温度变化都会使它走样
    const g = rand(0.12, 0.3), ga = rand(0, 2 * Math.PI);
    this.G0 = [g * Math.cos(ga), g * Math.sin(ga)];
    this.scr = [0, 0, 0]; // 三颗平行度螺钉的压入量 μm
    this.direct = false; this.eyeE = [0, 0]; // 取下望远镜、用眼睛直接看标准具；眼睛相对标准具中心的位置 cm
    this.x = rand(3, 5); this.back = rand(0.008, 0.018); this.c = this.x - this.back / 2; this.dir = 1;
    this.sawSigma = false; this.sawPi = false; this.sawWalk = 0;
  }

  // ---------- 光路几何 ----------
  P(k) { const c = this.app.comp(k); return c && c.placed ? c.pos : null; }
  /** 元件在汞灯与目镜之间（目镜没放时只要在汞灯之后）：光确实穿过它 */
  inPath(k) { const p = this.P(k), e = this.P('eye'); return p != null && p > LP && (e == null || p < e); }
  get filterIn() { return this.inPath('filter'); }
  get polIn() { return this.inPath('pol'); }
  /** 光路问题（缺件、顺序不对），没有问题返回空 */
  pathIssue() {
    const nm = (k) => this.app.comp(k).name;
    for (const k of ['fp', 'lens2', 'eye']) if (this.P(k) == null) return `导轨上还没有「${nm(k)}」`;
    // 聚光透镜放在标准具后面也能看到圆环（只是进入标准具的光少、视场暗，见 coll()）；放到成像透镜后面才会破坏成像
    if (this.P('lens1') != null && this.P('lens1') > this.P('lens2')) return `「${nm('lens1')}」放到了「${nm('lens2')}」后面，干扰了成像`;
    const ps = ORDER.filter((k) => k !== 'lens1' && this.P(k) != null);
    for (let i = 1; i < ps.length; i++) if (this.P(ps[i]) <= this.P(ps[i - 1])) return `「${nm(ps[i - 1])}」应放在「${nm(ps[i])}」之前（靠汞灯一侧）`;
    return '';
  }
  /** 分划板离成像透镜焦面的距离（cm，正为偏远） */
  get dz() { const l = this.P('lens2'), e = this.P('eye'); return l == null || e == null ? Infinity : e + this.tube - (l + F2); }
  /** 聚光：汞灯在聚光透镜焦点附近时出射光近似平行，照满标准具口径；偏离越多，进入标准具的光越少 */
  coll() {
    const u = this.P('lens1'), f = this.P('fp');
    if (u == null || (f != null && u > f)) return 0.25;
    return 0.3 + 0.7 / (1 + ((u - LP - F1) / 3) ** 2);
  }
  /** 标准具两板间隔的变化率（μm/cm）：出厂偏差 + 三颗螺钉的调节 */
  get G() {
    const k = 2 / (3 * SCREW_R);
    return [this.G0[0] + k * this.scr.reduce((s, v, i) => s + v * Math.cos(SCREW_A[i]), 0), this.G0[1] + k * this.scr.reduce((s, v, i) => s + v * Math.sin(SCREW_A[i]), 0)];
  }
  get par() { return Math.hypot(...this.G); }
  /** 观察处的间隔：用眼睛直接看时只用到眼睛对着的那一小块，两板不平行时随眼睛移动而变 */
  get dObs() { return this.direct ? this.d + (this.G[0] * this.eyeE[0] + this.G[1] * this.eyeE[1]) * 1e-6 : this.d; }
  mis(k) { const c = this.app.comp(k); return this.app.coax && c && c.placed ? this.app.coax.mis(c) : { y: 0, z: 0, yaw: 0 }; }

  // ---------- 物理量 ----------
  get Bp() { return this.Bs * Math.tanh(this.cur / this.Ic); } // 探头处 T
  get B() { return this.Bp * this.Bk; } // 汞灯处 T
  get Bshow() { return Math.round(this.Bp * 1000 + (this.tmZeroed ? this.tmOff2 : this.tmOff)); } // mT
  /** 圆环中心在分划板上的位置（mm）：成像透镜与目镜不共轴、标准具法线偏离光轴都会使它偏开，目镜微调可以补偿 */
  get cx() {
    if (this.direct) return FIELD / 2;
    const l2 = this.mis('lens2'), e = this.mis('eye'), fp = this.mis('fp');
    return FIELD / 2 + this.ax + 10 * (l2.z - e.z) + 10 * F2 * Math.tan((fp.yaw * Math.PI) / 180);
  }
  get cy() {
    if (this.direct) return 0;
    const l2 = this.mis('lens2'), e = this.mis('eye');
    return this.ay + 10 * (l2.y - e.y);
  }
  /** 进入眼睛的相对亮度 */
  lit() {
    if (!this.lampOn) return 0;
    if (this.direct) return this.P('fp') != null ? this.warm * this.coll() * this.app.coaxT('fp') : 0;
    return this.P('eye') == null ? 0 : this.warm * this.coll() * this.app.coaxT('eye');
  }
  /** 圆环是否能成像在分划板上 */
  ringsOK() { return this.direct ? this.P('fp') != null : !this.pathIssue(); }
  /** 圆环的模糊（艾里函数相位上的平均宽度，rad）：离焦 + 两板不平行 */
  blur() {
    const wedge = (2 * Math.PI * 2 * this.par * (this.direct ? 0.15 : 0.5)) / LAM_UM; // 观察口径内间隔变化引起的相位展宽
    return wedge + (this.direct ? 0.08 : (2.2 * Math.min(3, Math.abs(this.dz))) / 0.4);
  }
  polW() { const p = (this.phi * Math.PI) / 180; return this.polIn ? { pi: 0.92 * Math.cos(p) ** 2, sigma: 0.92 * Math.sin(p) ** 2 } : { pi: 1, sigma: 1 }; }
  /** 第 j 级（j = 0 为最内）、Δ(Mg) = s 的分量在分划板上的半径（mm） */
  radius(j, s) { return F_LENS * Math.tan(ringTheta(this.K - j, SIG0 + s * lorentz(this.B), this.dObs)) * 1000; }
  /** 水平叉丝（过视场中心）与该圆环的交点 */
  cross(j, s, side) { const r = this.radius(j, s), h = r * r - this.cy * this.cy; return h > 0 ? this.cx + side * Math.sqrt(h) : NaN; }
  setX(v) {
    const x = clamp(Math.round(v * 2000) / 2000, 0, FIELD);
    if (x > this.x + 1e-9) this.dir = 1; else if (x < this.x - 1e-9) this.dir = -1;
    this.x = x; this.c = clamp(this.c, x - this.back, x); // 空回：叉丝只在被推动时才跟着走
  }
  setCur(v) { this.cur = clamp(Math.round(v * 100) / 100, 0, 5); }
  zeroTm() { this.tmZeroed = true; this.tmOff2 = -this.Bp * 1000 + rand(-0.4, 0.4); } // 有磁场时调零，零点就错了

  tick(dt) {
    if (this.lampOn && this.warm < 1) { this.warm = Math.min(1, this.warm + dt * (this.app.running ? this.app.speed : 1) / 5); this.app.changed(); }
    if (!this.lampOn && this.warm > 0) { this.warm = 0; this.app.changed(); }
  }

  cameras() { return [{ name: '全景', pos: [40, 75, 120], target: [40, 16, 0] }, { name: '电磁铁', pos: [-22, 40, 38], target: [2, 18, 0] }, { name: '标准具', pos: [22, 38, 30], target: [32, 20, 0] }, { name: '测微目镜', pos: [50, 36, 34], target: [62, 20, 0] }]; }

  /** 等高共轴：汞灯固定在磁极之间；聚光透镜把它变成近似平行光，成像透镜把圆环会聚到目镜分划板上 */
  coaxSpec() {
    return {
      keys: ['lamp', 'lens1', 'filter', 'fp', 'pol', 'lens2', 'eye'],
      beam: { lamp: { w: 0.6, div: 0.12 }, lens1: { w: 1.6, div: 0 } },
      ap: { lens1: { y: 2, z: 2 }, filter: { y: 1.2, z: 1.2 }, fp: { y: 1.5, z: 1.5 }, pol: { y: 1.5, z: 1.5 }, lens2: { y: 2, z: 2 }, eye: { y: 0.6, z: 0.6 } },
      f: { lens1: F1, lens2: F2 },
      axes: { lamp: '', lens1: 'yz', filter: 'yz', fp: 'yza', pol: 'yz', lens2: 'yz', eye: 'yz' },
    };
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(210, 90); t.position.set(45, 0, 0); scene.add(t);
    const rail = opticalRail(100); rail.position.x = 10; scene.add(rail);
    app.addRail({ id: 'src', origin: new THREE.Vector3(0, 0, 0), min: LP, max: LP, accepts: ['lamp'] });
    app.addRail({ origin: new THREE.Vector3(0, 0, 0), min: 10, max: 110, accepts: ['lens1', 'filter', 'fp', 'pol', 'lens2', 'eye'] });
    app.stage.setLightTarget(40, 0, 0);

    // 电磁铁：C 形轭铁 + 两个线圈，磁场沿 z（垂直于光轴），汞灯竖直放在两极之间，光沿 +x 射出
    const mag = new THREE.Group(); mag.position.set(LP, 0, 0);
    const yoke = MAT.paint(0x3a4741);
    mag.add(mesh(new THREE.BoxGeometry(10, 4, 36), yoke, 0, 2, 0));
    for (const s of [-1, 1]) {
      mag.add(mesh(new THREE.BoxGeometry(10, YB + 6, 4), yoke, 0, (YB + 6) / 2 + 2, s * 16));
      const coil = mesh(new THREE.CylinderGeometry(5.2, 5.2, 7, 36), MAT.paint(0xa8572a), 0, YB, s * 9.5); coil.rotation.x = Math.PI / 2; mag.add(coil);
      const pole = mesh(new THREE.CylinderGeometry(2.2, 2.6, 4, 28), MAT.metal(), 0, YB, s * 4); pole.rotation.x = Math.PI / 2; mag.add(pole);
    }
    const psu = (this.psuBox = meterBox(20, 10, 14, '励磁电源')); psu.group.position.set(-8, 0, -32);
    app.addComponent(new Component({
      key: 'magnet', name: '电磁铁与励磁电源', zone: 'none', fixed: true, required: true, object: new THREE.Group().add(mag, psu.group), labelY: YB + 12,
      desc: '两磁极间的磁场垂直于光轴（横向观察）。励磁电流 0–5 A，电流大时铁芯趋于饱和，B 不再与电流成正比，所以要用特斯拉计直接测 B。',
      controls: () => [
        { type: 'knob', label: '励磁电流', get: () => this.cur, set: (v) => { this.setCur(v); app.changed(); }, min: 0, max: 5, step: 0.01, bigStep: 0.2, perRev: 1, digits: 2, unit: 'A' },
      ],
    }));
    // 汞灯：固定在磁极之间（导轨坐标 0），是光路的起点
    const lampG = new THREE.Group();
    this.lampMat = MAT.emissive(0x9dffb0, 0.05);
    lampG.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 9, 16), this.lampMat, 0, YB, 0));
    lampG.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 3, 16), MAT.black(), 0, YB + 6, 0));
    lampG.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 8, 8), MAT.black(), 0, YB + 11.5, 0)); // 灯座引线，伸出磁极之上便于点选
    this.glow = glowSprite(0x7dff9a, 10); this.glow.position.set(0, YB, 0); this.glow.visible = false; lampG.add(this.glow);
    app.addComponent(new Component({
      key: 'lamp', name: '笔形汞灯', icon: ICONS.mercury, zone: 'rail', rail: 'src', defaultPos: LP, fixed: true, movable: false, object: lampG, labelY: YB + 16,
      desc: '低压汞灯，竖直放在两磁极中间，光从磁极之间沿导轨方向射出。点亮后约十几秒亮度才稳定。主要谱线：404.7、435.8、546.1、577.0、579.1 nm。',
      controls: () => [{ type: 'toggle', label: '电源', get: () => this.lampOn, set: (v) => { this.lampOn = v; app.changed(); } }, { type: 'readout', label: '亮度', get: () => (this.lampOn ? `${Math.round(this.warm * 100)}%` : '未点亮') }],
    }));
    const tm = (this.tmBox = meterBox(14, 8, 10, '特斯拉计')); tm.group.position.set(-10, 0, 28);
    app.addComponent(new Component({
      key: 'tm', name: '特斯拉计', zone: 'none', fixed: true, object: tm.group, labelY: 11,
      desc: '霍尔探头插在磁极间、汞灯旁边，示数 1 mT。使用前要在没有磁场时（励磁电流为零）调零。',
      controls: () => [
        { type: 'button', label: '调零', onClick: () => { this.zeroTm(); app.toast(this.cur > 0.02 ? '在有磁场时调零了：零点不对，读数会偏小' : '特斯拉计已调零', this.cur > 0.02 ? 'warn' : 'ok'); } },
        { type: 'readout', label: '磁感应强度', get: () => `${this.Bshow} mT` },
      ],
    }));

    // ---- 导轨上的元件（都从器材柜取，自己放） ----
    const onRail = (key, name, icon, obj, desc, controls, labelY = 32) => {
      const cg = carriage(0x9aa3b2, AXIS_Y); cg.top.add(obj);
      app.addComponent(new Component({ key, name, icon, zone: 'rail', defaultPos: DEF[key], required: true, object: cg.group, labelY, desc, controls }));
    };
    const lensObj = () => { const l = lensMesh(4, 0.6); l.rotation.y = Math.PI / 2; return l; };
    onRail('lens1', '聚光透镜（f = 15 cm）', ICONS.lens, lensObj(),
      '把汞灯发出的光会聚成近似平行光，照满标准具的口径。汞灯在它的焦点附近时视场最亮、最均匀。');
    const fg = new THREE.Group();
    fg.add(mesh(new THREE.BoxGeometry(0.4, 4, 4), MAT.glass(0x40ff80, 0.6)));
    fg.add(mesh(new THREE.BoxGeometry(0.8, 4.6, 0.5), MAT.dark(), 0, 0, 2.2), mesh(new THREE.BoxGeometry(0.8, 4.6, 0.5), MAT.dark(), 0, 0, -2.2));
    onRail('filter', '干涉滤光片（546.1 nm）', ICONS.filter, fg,
      '只让 546.1 nm 的绿线通过。不放滤光片时，汞灯的黄线、蓝紫线也各自形成一套圆环，混在一起无法测量。放在汞灯与目镜之间任意处都可以。');
    const fpG = new THREE.Group();
    fpG.add(mesh(new THREE.CylinderGeometry(3, 3, 3, 36), MAT.black()).rotateZ(Math.PI / 2));
    fpG.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.05, 36), MAT.glass(0xfff3c4, 0.45)).rotateZ(Math.PI / 2));
    this.screwM = SCREW_A.map((a) => { const k = knobMesh(0.45, 1.2, 0x9ca3af); k.position.set(-1.9, 2.4 * Math.sin(a), 2.4 * Math.cos(a)); k.rotation.z = Math.PI / 2; fpG.add(k); return k; });
    const scrDesc = ['上', '左下', '右下'];
    onRail('fp', 'F-P 标准具', ICONS.dmirror, fpG,
      `两块镀高反射膜（反射率约 ${Math.round(this.Rf * 100)}%）的平面玻璃，用热膨胀很小的间隔圈隔开，间隔 d = 2.000 mm（厂家标定）。两板必须严格平行：用后面的三颗螺钉调节。检查方法：取下望远镜、用眼睛直接对着标准具看圆环，上下左右移动眼睛——圆环有“冒出”或“缩进”，说明眼睛移向的那一侧间隔大或小，拧那一侧的螺钉，直到移动眼睛时圆环大小不变。`,
      () => [
        ...this.scr.map((_, i) => ({ type: 'knob', label: `平行度螺钉 ${i + 1}（${scrDesc[i]}）`, get: () => this.scr[i], set: (v) => { this.scr[i] = clamp(v, -1.2, 1.2); app.changed(); }, min: -1.2, max: 1.2, step: 0.002, bigStep: 0.02, perRev: 0.1, fmt: () => '拧紧 ▶ / ◀ 放松', sub: i === 0 ? '拧紧使该处两板间隔变小' : undefined })),
        { type: 'segment', label: '观察方式', get: () => (this.direct ? 'eye' : 'tel'), set: (v) => { this.direct = v === 'eye'; app.changed(); }, options: [{ label: '经测微目镜', value: 'tel' }, { label: '眼睛直接看标准具', value: 'eye' }] },
        ...(this.direct ? [
          { type: 'knob', label: '眼睛左右移动', get: () => this.eyeE[0], set: (v) => { this.eyeE[0] = clamp(v, -1.2, 1.2); this.sawWalk++; app.changed(); }, min: -1.2, max: 1.2, step: 0.02, bigStep: 0.2, perRev: 1, digits: 1, unit: 'cm' },
          { type: 'knob', label: '眼睛上下移动', get: () => this.eyeE[1], set: (v) => { this.eyeE[1] = clamp(v, -1.2, 1.2); this.sawWalk++; app.changed(); }, min: -1.2, max: 1.2, step: 0.02, bigStep: 0.2, perRev: 1, digits: 1, unit: 'cm' },
        ] : []),
      ], 30);
    const pol = rotatorMesh(0x334155, 'P'); this.polRot = pol.rot;
    onRail('pol', '偏振片', ICONS.polarizer, pol.group,
      '刻度盘读数为透振方向与磁场方向的夹角 φ。φ = 0° 时只看到 π 成分（电矢量平行于 B），φ = 90° 时只看到 σ 成分。放在汞灯与目镜之间任意处都可以。',
      () => [{ type: 'knob', label: '透振方向 φ', get: () => this.phi, set: (v) => { this.phi = ((Math.round(v) % 360) + 360) % 360; app.changed(); }, min: 0, max: 360, step: 1, bigStep: 15, perRev: 90, digits: 0, unit: '°', wrap: true }]);
    onRail('lens2', `成像透镜（f = ${F2} cm）`, ICONS.lens, lensObj(),
      `把标准具出射的平行光会聚到它的焦面上，形成等倾干涉圆环。测微目镜的分划板要放在它后面一个焦距（${F2} cm）处。`);
    const tel = new THREE.Group();
    tel.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 7, 28), MAT.black(), 2.2, 0, 0).rotateZ(Math.PI / 2));
    tel.add(mesh(new THREE.BoxGeometry(3, 4.4, 4.4), MAT.dark(), -1.2, 0, 0));
    tel.add(mesh(new THREE.CylinderGeometry(1, 1, 3, 20), MAT.black(), 7, 0, 0).rotateZ(Math.PI / 2));
    this.drumM = mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.6, 32), MAT.brass(), -1.2, 0, 3.2); this.drumM.rotation.x = Math.PI / 2; tel.add(this.drumM);
    onRail('eye', '测微目镜', ICONS.detector, tel,
      '分划板上有固定的水平叉丝和可移动的竖直叉丝；鼓轮转一圈叉丝移动 1 mm，鼓轮 100 分度，每格 0.01 mm，估读到 0.001 mm。鼓轮与叉丝之间有空回，测量时要朝一个方向转。镜筒可前后伸缩约 ±1.5 cm 调焦；目镜架可横向、竖直微调。',
      () => [
        { type: 'knob', label: '调焦（镜筒伸缩）', get: () => this.tube, set: (v) => { this.tube = clamp(v, -1.5, 1.5); app.changed(); }, min: -1.5, max: 1.5, step: 0.002, bigStep: 0.05, perRev: 0.3, digits: 3, unit: 'cm', fmt: () => '使圆环最细锐', sub: '先移动目镜滑座使分划板大致在成像透镜焦面上，再伸缩镜筒细调' },
        { type: 'knob', label: '目镜架横向微调', get: () => this.ax, set: (v) => { this.ax = clamp(v, -2.5, 2.5); app.changed(); }, min: -2.5, max: 2.5, step: 0.005, bigStep: 0.1, perRev: 0.5, digits: 3, unit: 'mm', fmt: () => '圆环左右移动' },
        { type: 'knob', label: '目镜架竖直微调', get: () => this.ay, set: (v) => { this.ay = clamp(v, -2.5, 2.5); app.changed(); }, min: -2.5, max: 2.5, step: 0.005, bigStep: 0.1, perRev: 0.5, digits: 3, unit: 'mm', fmt: () => '圆环上下移动' },
        { type: 'knob', label: '测微鼓轮', get: () => this.x, set: (v) => { this.setX(v); app.changed(); }, min: 0, max: FIELD, step: 0.001, bigStep: 0.05, perRev: 1, digits: 3, unit: 'mm' },
      ]);

    this.beamA = new Beam(0xc8ffd2, 0.12, 0.35); this.beamB = new Beam(0x9dffb0, 0.08, 0.5);
    scene.add(this.beamA.group, this.beamB.group);
    this.eye = app.addView({ id: 'eye', title: '测微目镜视场', w: 250, h: 250, res: 1.3 });
    this.drumView = app.addView({ id: 'drum', title: '测微目镜读数', w: 250, h: 84, res: 1.4 });
    this.prof = new Float32Array(1400); this.profRGB = null;
  }

  /** 沿半径的光强分布（查表，供逐像素着色）；只在相关参数变化时重算 */
  profile() {
    const ok = this.ringsOK(), S = this.lit(), blur = this.blur();
    const key = [this.B.toFixed(5), this.polIn, this.phi, this.filterIn, blur.toFixed(3), S.toFixed(3), this.dObs.toExponential(9), ok, this.direct].join('|');
    if (key === this._pk) return;
    this._pk = key;
    const N = this.prof.length, rMax = 7, pw = this.polW(), L = lorentz(this.B), dd = this.dObs;
    const out = (this.profRGB = new Float32Array(N * 3));
    const pxmm = 1 / 30; // 约一个像素对应的分划板宽度（mm）
    for (let i = 0; i < N; i++) {
      let R, G, Bc;
      if (!ok) {
        // 圆环没有成像在分划板上：只看到一片模糊的亮光
        const rr = ((i / (N - 1)) * rMax) / 5, v = 0.22 * S * Math.exp(-rr * rr);
        R = v * (this.filterIn ? 0.35 : 0.9); G = v; Bc = v * (this.filterIn ? 0.45 : 0.85);
      } else {
        const r = (i / (N - 1)) * rMax / 1000, th = Math.atan(r / F_LENS), dth = (pxmm / 1000) / F_LENS;
        let g = 0;
        for (const c of HG546) {
          const sg = SIG0 + c.s * L, ph = 2 * Math.PI * 2 * dd * sg;
          const dlt = ph * Math.cos(th), h = ph * Math.sin(th) * dth + 0.06 + blur;
          g += c.w * pw[c.pol] * airyAvg(dlt, h, this.F);
        }
        g = (g / 4) * S;
        R = 0.35 * g; G = g; Bc = 0.45 * g;
        if (!this.filterIn) for (const o of OTHER) {
          const ph = 2 * Math.PI * 2 * dd / (o.lam * 1e-9 * NAIR), v = o.w * airyAvg(ph * Math.cos(th), ph * Math.sin(th) * dth + 0.06 + blur, this.F) * S * 0.9;
          R += (v * o.rgb[0]) / 255; G += (v * o.rgb[1]) / 255; Bc += (v * o.rgb[2]) / 255;
        }
      }
      out[i * 3] = R; out[i * 3 + 1] = G; out[i * 3 + 2] = Bc;
    }
    this._img = null;
    // GPU 查找表：三个颜色通道分开存
    this.profC = [0, 1, 2].map((c) => Float32Array.from({ length: N }, (_, i) => out[i * 3 + c]));
  }

  update() {
    const a = this.app, pw = this.polW();
    this.lampMat.emissiveIntensity = (this.lampOn ? this.warm : 0) * 2.2 + 0.05; this.glow.visible = this.lampOn && this.warm > 0.05; this.glow.material.opacity = 0.6 * (this.lampOn ? this.warm : 0);
    this.polRot.rotation.x = (this.phi * Math.PI) / 180;
    this.drumM.rotation.y = this.x * 2 * Math.PI;
    this.screwM.forEach((k, i) => (k.rotation.x = this.scr[i] * 40));
    const ps = `${this.cur.toFixed(2)}`; if (ps !== this._ps) { this._ps = ps; this.psuBox.setText(ps, 'A', '恒流输出'); }
    const ts = `${this.Bshow}`; if (ts !== this._tsm) { this._tsm = ts; this.tmBox.setText(ts, 'mT', this.tmZeroed ? '' : '未调零'); }
    if (this.lit() > 0.3 && this.B > 0.5 && !this.direct) { if (pw.sigma > 0.8 && pw.pi < 0.1) this.sawSigma = true; if (pw.pi > 0.8 && pw.sigma < 0.1) this.sawPi = true; }
    // 三维光束：汞灯 → 第一个元件（发散）→ 目镜（或最远的元件）
    const on = this.lampOn && this.warm > 0.05, V3 = (x) => a.coaxV(x, YB);
    const placed = ['lens1', 'filter', 'fp', 'pol', 'lens2', 'eye'].map((k) => this.P(k)).filter((p) => p != null).sort((p, q) => p - q);
    if (on && placed.length) {
      this.beamA.set(V3(LP + 1), V3(placed[0]), 0.35 * this.warm);
      const end = this.P('eye') ?? placed[placed.length - 1];
      if (end > placed[0]) this.beamB.set(V3(placed[0]), V3(end), 0.5 * this.warm * this.coll()); else this.beamB.hide();
    } else { this.beamA.hide(); this.beamB.hide(); }

    // ---- 目镜视场 ----
    this.profile();
    const v = this.eye, g = v.ctx, W = v.W, H = v.H, sc = W / FIELD; // px/mm
    const N = this.prof.length, cx = this.cx * sc, cy = H / 2 - this.cy * sc, pc = this.profC;
    const ck = `${W}|${this._pk}|${this.cx.toFixed(4)}|${this.cy.toFixed(4)}`;
    // 显卡逐像素查表（按观察窗实际分辨率出图，放大后也清晰）；不可用时用下面的 CPU 循环并缓存结果
    if (GPU.paint(v, 'zeeman', RINGS_FS, { uPR: { tex: pc[0] }, uPG: { tex: pc[1] }, uPB: { tex: pc[2] }, uCx: cx, uCy: cy, uSc: sc, uW: W, uH: H, uN: N })) this._ck = null;
    else if (ck !== this._ck || !this._img) {
      this._ck = ck;
      const img = (this._img = g.createImageData(W, H)), P = this.profRGB;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4, dx = x - W / 2, dy = y - H / 2;
        if (dx * dx + dy * dy > (W / 2) * (W / 2)) { img.data[k + 3] = 255; continue; }
        const r = Math.hypot(x - cx, y - cy) / sc, f = Math.min(1, r / 7) * (N - 1), i = Math.min(N - 2, Math.floor(f)), t = f - i;
        img.data[k] = 255 * Math.min(1, P[i * 3] * (1 - t) + P[i * 3 + 3] * t);
        img.data[k + 1] = 255 * Math.min(1, P[i * 3 + 1] * (1 - t) + P[i * 3 + 4] * t);
        img.data[k + 2] = 255 * Math.min(1, P[i * 3 + 2] * (1 - t) + P[i * 3 + 5] * t);
        img.data[k + 3] = 255;
      }
    }
    if (this._ck) g.putImageData(this._img, 0, 0);
    if (!this.direct) {
      // 分划板：固定水平叉丝 + 毫米刻度，可动竖直叉丝
      g.strokeStyle = 'rgba(230,235,230,.75)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      for (let m = 0; m <= FIELD; m++) { const px = m * sc; g.beginPath(); g.moveTo(px, H * 0.86); g.lineTo(px, H * 0.86 - (m % 5 === 0 ? 10 : 6)); g.stroke(); }
      g.fillStyle = 'rgba(230,235,230,.75)'; g.font = `${Math.round(H * 0.04)}px "IBM Plex Mono"`; g.textAlign = 'center';
      for (let m = 0; m <= FIELD; m += 2) g.fillText(String(m), m * sc, H * 0.86 + 12);
      const xc = this.c * sc;
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.moveTo(xc, H * 0.08); g.lineTo(xc, H * 0.8); g.stroke();
      g.beginPath(); g.moveTo(xc - 7, H / 2 - 7); g.lineTo(xc + 7, H / 2 + 7); g.moveTo(xc + 7, H / 2 - 7); g.lineTo(xc - 7, H / 2 + 7); g.stroke();
    }
    g.strokeStyle = '#2b3330'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 1, 0, 7); g.stroke();
    v.foot(this.footText(pw));

    // ---- 读数：主尺 + 鼓轮 ----
    const d = this.drumView, q = d.ctx, DW = d.W, DH = d.H, s = DW / 250;
    q.fillStyle = '#0b1220'; q.fillRect(0, 0, DW, DH); q.save(); q.scale(s, s);
    const mm = Math.floor(this.x + 1e-9);
    q.fillStyle = '#e8e2cf'; q.fillRect(8, 10, 96, 46); q.fillStyle = '#111'; q.font = '10px Arial'; q.textAlign = 'center';
    for (let k = -4; k <= 4; k++) { const px = 56 + (k - (this.x - mm)) * 11; if (px < 10 || px > 102) continue; q.fillRect(px, 10, 1, 14); q.fillText(String(mm + k), px, 38); }
    q.fillStyle = '#dc2626'; q.fillRect(55.5, 10, 1.5, 30);
    const fine = (this.x - mm) * 100;
    q.fillStyle = '#d4d4d8'; q.fillRect(120, 10, 96, 46); q.fillStyle = '#111';
    for (let k = -6; k <= 6; k++) {
      const val = Math.floor(fine) + k, py = 33 + (k - (fine - Math.floor(fine))) * 4.2;
      if (py < 12 || py > 54) continue;
      const vv = ((val % 100) + 100) % 100;
      q.fillRect(120, py, vv % 5 === 0 ? 18 : 11, 1);
      if (vv % 10 === 0) { q.textAlign = 'left'; q.fillText(String(vv), 142, py + 3.5); }
    }
    q.fillStyle = '#dc2626'; q.fillRect(120, 32.5, 96, 1.2);
    q.fillStyle = '#94a3b8'; q.font = '10px "Microsoft YaHei"'; q.textAlign = 'center'; q.fillText('分划板 /mm', 56, 68); q.fillText('鼓轮 0.01 mm', 168, 68);
    q.restore();
    d.foot(a.readSelf ? '主尺读整毫米，鼓轮读 0.01 mm，估读到 0.001 mm' : `读数 ${this.x.toFixed(3)} mm`);
  }
  footText(pw) {
    if (!this.lampOn) return '汞灯未点亮';
    if (this.direct) {
      if (this.P('fp') == null) return '导轨上没有标准具';
      return this.par > PAR_TOL ? '上下左右移动眼睛：圆环在“冒出”或“缩进”，两板不平行' : '移动眼睛时圆环大小不变：两板已平行';
    }
    const pi = this.pathIssue();
    if (pi) return `看不到干涉圆环：${pi}`;
    if (this.lit() < 0.08) return '视场很暗：检查聚光透镜的位置和各元件是否共轴';
    if (!this.filterIn) return '几种颜色的圆环混在一起：放入 546.1 nm 滤光片';
    if (Math.abs(this.dz) > 0.3) return `圆环很模糊：分划板不在成像透镜焦面上（${this.dz > 0 ? '偏远' : '偏近'}），移动目镜或伸缩镜筒`;
    if (this.par > PAR_TOL * 2) return '圆环发虚、对比度低：标准具两板不平行';
    if (Math.abs(this.dz) > DZ_TOL) return '圆环还不够细锐：细调镜筒';
    if (Math.abs(this.cy) > 0.05) return '水平叉丝没有通过圆环中心：调目镜架竖直位置';
    if (this.B < 0.05) return '无磁场：每一级只有一个圆环';
    return this.polIn && pw.pi > 0.8 ? `π 成分：每级 3 条 · B = ${this.Bshow} mT` : this.polIn && pw.sigma > 0.8 ? `σ 成分：每级 6 条 · B = ${this.Bshow} mT` : `π、σ 成分都在：每级 9 条 · B = ${this.Bshow} mT`;
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'B', title: '磁感应强度', fixedRows: true, initRows: () => [{ what: '测量圆环时' }],
        columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'I', label: '励磁电流 I/A', digits: 2, readTol: 0.006 }, { key: 'B', label: 'B/mT', digits: 0, readTol: 1.1 }],
        buttons: [{ label: '读电流表与特斯拉计', onClick: (t) => { if (this.B < 0.05) this.app.toast('还没有加磁场', 'warn'); t.set(0, 'I', this.cur); t.set(0, 'B', this.Bshow); } }],
        note: '特斯拉计要先在没有磁场时调零。测完圆环直径后最好再读一次，确认磁场没有变。',
      },
      {
        id: 'D', title: 'π 成分圆环直径', fixedRows: true,
        initRows: () => ROWS.map(([j, , c]) => ({ ring: j ? 'k−1 级' : 'k 级（最内）', comp: c })),
        columns: [
          { key: 'ring', label: '级次', type: 'text', readonly: true }, { key: 'comp', label: '分量', type: 'text', readonly: true },
          { key: 'xL', label: 'x_左/mm', digits: 3, readTol: 0.0012 }, { key: 'xR', label: 'x_右/mm', digits: 3, readTol: 0.0012 },
          { key: 'D', label: 'D/mm', digits: 3, calc: (r) => Math.abs(r.xR - r.xL) }, { key: 'D2', label: 'D²/mm²', digits: 3, calc: (r) => (r.xR - r.xL) ** 2 },
        ],
        buttons: [{ label: '记录叉丝位置', onClick: (t) => this.recX(t) }],
        note: '偏振片转到只剩 π 成分。竖直叉丝对准某条谱线与水平叉丝的交点后点记录，程序自动识别是哪一级、哪一条、左边还是右边。叉丝从最左边开始一直朝右移动，中途不要回转。',
      },
    ];
  }
  /** 叉丝现在对准的是哪条 π 谱线（行号、左右），找不到返回最近的一条与距离 */
  aimed() {
    let best = null;
    ROWS.forEach(([j, s], i) => { for (const side of [-1, 1]) { const x = this.cross(j, s, side), e = Math.abs(x - this.c); if (isFinite(x) && (!best || e < best.e)) best = { i, side, x, e }; } });
    return best;
  }
  recX(t) {
    const a = this.app, pw = this.polW();
    if (!this.lit()) return a.toast('汞灯没有点亮', 'warn');
    if (!this.filterIn) a.toast('几套颜色的圆环混在一起，先放入滤光片', 'warn');
    if (this.B < 0.3) a.toast('磁场太弱，π 成分还没有分开', 'warn');
    if (!this.polIn || pw.pi < 0.8 || pw.sigma > 0.1) a.toast('视场里还有 σ 成分：放入偏振片并转到 φ ≈ 0°，只留 π 成分', 'warn');
    const m = this.aimed();
    if (!m || m.e > 0.02) a.toast(`叉丝没有对准要测的 π 谱线${m ? `（离最近的一条还差 ${m.e.toFixed(3)} mm）` : ''}`, 'warn');
    const rb = a.table('B').rows[0];
    if (isFinite(rb.B) && Math.abs(rb.B - this.Bshow) > 2) a.toast('磁场和记录的 B 不一样了：电流变过？重新读 B', 'warn');
    if (Math.abs(this.cy) > 0.05) a.toast('水平叉丝没有通过圆环中心，测出的是弦长而不是直径', 'warn');
    if (this._recDir && this._recDir !== this.dir) a.toast('叉丝换了方向：空回会带来误差，应该从一侧朝同一方向测完', 'warn');
    this._recDir = this.dir;
    const key = m.side < 0 ? 'xL' : 'xR';
    t.set(m.i, key, Math.round(this.x * 1000) / 1000);
    a.toast(`${t.rows[m.i].ring} ${t.rows[m.i].comp}：${m.side < 0 ? '左' : '右'}侧`, 'ok');
  }


  // ======================= 步骤 =======================
  steps() {
    const app = this.app;
    const sel = (k) => app.select(app.comp(k));
    const centered = () => Math.abs(this.cy) <= 0.05 && Math.abs(this.cx - FIELD / 2) < 0.6;
    const clear = () => !this.direct && this.lit() > 0.3 && this.warm > 0.98 && this.filterIn && !this.pathIssue() && Math.abs(this.dz) < DZ_TOL;
    const piOnly = () => { const p = this.polW(); return this.polIn && p.pi > 0.8 && p.sigma < 0.1; };
    const Brow = () => app.table('B').rows[0];
    const need = ['lens1', 'filter', 'fp', 'lens2', 'eye'];
    const nm = (k) => app.comp(k).name;
    return [
      {
        title: '在导轨上搭光路',
        html: `<p>汞灯已固定在电磁铁两极之间。从器材柜把<b>聚光透镜、干涉滤光片、F-P 标准具、成像透镜、测微目镜</b>放到导轨上，顺序为：汞灯 → 聚光透镜 → 标准具 → 成像透镜 → 测微目镜（滤光片放在汞灯与目镜之间任意处）。</p>
          <p>聚光透镜离汞灯约一个焦距（${F1} cm），使射向标准具的光近似平行；测微目镜的分划板（滑座刻线处）放在成像透镜后约一个焦距（${F2} cm）处。偏振片后面观察偏振时再放。</p>`,
        hint: '拖动滑座可以改变位置，选中后也可以在面板里精确调“导轨位置”。顺序放错时目镜里看不到圆环，视场底部会说明原因。',
        status: () => { const pi = this.pathIssue(); const ps = need.filter((k) => this.P(k) != null).map((k) => `${nm(k).replace(/（.*）/, '')} ${this.P(k).toFixed(1)}`); return (ps.length ? ps.join(' · ') + ' cm' : '导轨上还没有元件') + (pi ? `<br>${pi}` : ''); },
        check: () => need.every((k) => this.P(k) != null) && !this.pathIssue() && Math.abs(this.P('lens1') - LP - F1) < 2 && Math.abs(this.dz) < 1.4,
        diagnose: () => {
          const out = [];
          for (const k of need) if (this.P(k) == null) out.push({ msg: `「${nm(k)}」还在器材柜里。`, fix: { label: '帮我放好', run: () => this.putOn(k) } });
          const pi = this.pathIssue(); if (pi && !out.length) out.push({ msg: pi + '。' });
          if (this.P('lens1') != null && Math.abs(this.P('lens1') - LP - F1) >= 2) out.push({ msg: `聚光透镜离汞灯 ${(this.P('lens1') - LP).toFixed(1)} cm，与焦距 ${F1} cm 相差较多：射向标准具的光不平行，视场暗、不均匀。`, fix: { label: '移到一个焦距处', run: () => this.putOn('lens1') } });
          if (this.P('lens2') != null && this.P('eye') != null && Math.abs(this.dz) >= 1.4) out.push({ msg: `测微目镜分划板离成像透镜 ${(this.P('eye') - this.P('lens2')).toFixed(1)} cm，焦距是 ${F2} cm：镜筒伸缩调不过来，先移动目镜滑座。`, fix: { label: '把目镜移到焦面附近', run: () => this.putOn('eye') } });
          return out;
        },
        auto: async () => { await app.view('全景'); for (const k of need) await this.putOn(k); },
      },
      {
        title: '点亮汞灯，调标准具两板平行',
        html: '<p>点亮汞灯。选中标准具，把观察方式切到<b>“眼睛直接看标准具”</b>，上下、左右移动眼睛：如果圆环一边“冒出”或“缩进”，说明两板不平行——眼睛移向的那一侧间隔较大时圆环从中心冒出。拧那一侧的平行度螺钉（拧紧使间隔变小），直到眼睛怎么移动圆环大小都不变。</p>',
        hint: '螺钉一次只拧一点点。先左右、再上下，反复几次。两板不平行时，经测微目镜看到的圆环发虚、对比度低，无法分辨塞曼分裂。',
        status: () => (this.lampOn ? (this.par <= PAR_TOL ? '两板已平行' : this.direct ? '移动眼睛观察圆环的变化' : '切到“眼睛直接看标准具”检查') : '汞灯未点亮'),
        check: () => this.lampOn && this.warm > 0.98 && this.par <= PAR_TOL && this.sawWalk > 0,
        diagnose: () => {
          const out = [];
          if (!this.lampOn) out.push({ msg: '汞灯没有点亮。', fix: { label: '点亮汞灯', run: async () => { sel('lamp'); this.lampOn = true; app.renderInspector(); await app.until(() => this.warm >= 1, 30000); } } });
          if (!this.direct && this.par > PAR_TOL) out.push({ msg: '平行度要用眼睛直接看标准具来检查：选中标准具，观察方式切到“眼睛直接看标准具”。', fix: { label: '切过去', run: () => { sel('fp'); this.direct = true; app.renderInspector(); } } });
          if (this.par > PAR_TOL) out.push({ msg: `两板还不平行（全口径上间隔相差约 ${(this.par * 3 / LAM_UM * 2).toFixed(1)} 级）。移动眼睛看圆环往哪边变，拧那一侧的螺钉。`, fix: { label: '帮我调平行', run: () => this.makeParallel() } });
          return out;
        },
        auto: async () => {
          if (!this.lampOn) { sel('lamp'); this.lampOn = true; app.renderInspector(); }
          await app.until(() => this.warm >= 1, 30000);
          await this.makeParallel();
        },
      },
      {
        title: '经测微目镜调焦，使圆环中心在视场中央',
        html: '<p>标准具的观察方式切回“经测微目镜”。伸缩测微目镜的镜筒，使圆环最细锐；再用目镜架的横向、竖直微调使圆环中心落在视场中央，<b>水平叉丝通过圆环中心</b>。</p>',
        hint: '圆环中心偏得很远时，先检查标准具是否转歪了（共轴调节里的转角）。',
        check: () => clear() && centered(),
        diagnose: () => {
          const out = [];
          if (this.direct) out.push({ msg: '现在是用眼睛直接看标准具：切回“经测微目镜”。', fix: { label: '切回测微目镜', run: () => { sel('fp'); this.direct = false; app.renderInspector(); } } });
          if (!this.filterIn) out.push({ msg: '光路里没有滤光片，几种谱线的圆环叠在一起。', fix: { label: '放入滤光片', run: () => this.putOn('filter') } });
          if (Math.abs(this.dz) >= DZ_TOL) out.push({ msg: `圆环模糊：分划板${this.dz > 0 ? '在焦面之后' : '在焦面之前'}约 ${(Math.abs(this.dz) * 10).toFixed(1)} mm。`, fix: { label: '帮我调焦', run: () => this.focusEye() } });
          if (!centered()) out.push({ msg: `圆环中心偏离分划板中心（水平 ${(this.cx - FIELD / 2).toFixed(2)} mm、竖直 ${this.cy.toFixed(2)} mm）。水平叉丝不过中心时量到的是弦长，直径偏小。`, fix: { label: '帮我对中', run: () => this.center() } });
          return out;
        },
        auto: async () => {
          if (this.direct) { sel('fp'); this.direct = false; app.renderInspector(); }
          if (!this.filterIn) await this.putOn('filter');
          if (Math.abs(this.dz) >= DZ_TOL * 0.6) await this.focusEye();
          if (!centered() || Math.abs(this.cy) > 0.02) await this.center();
        },
      },
      {
        title: '特斯拉计调零，加磁场，用偏振片观察分裂',
        html: '<p>励磁电流为零时给特斯拉计调零。然后逐渐增大励磁电流到 B ≈ 1 T，看每一级圆环分裂成多条。把<b>偏振片</b>放到光路里：转到 $\\varphi=90^\\circ$ 只看到 6 条 σ 成分，转到 $\\varphi=0^\\circ$ 只剩 3 条 π 成分——测量用 π 成分。</p>',
        hint: '磁场太强时相邻两级的 σ 成分会交叠；π 成分的间距比 σ 成分小，B 取 0.9–1.2 T 比较合适。',
        status: () => `B = ${this.Bshow} mT${this.sawSigma ? ' · 已看到 σ 成分' : ''}`,
        check: () => this.tmZeroed && Math.abs(this.tmOff2) < 1 && this.B > 0.75 && this.sawSigma && piOnly() && clear(),
        diagnose: () => {
          const out = [];
          if (!this.tmZeroed) out.push({ msg: '特斯拉计还没有调零。', fix: { label: '电流归零后调零', run: () => this.zeroAt0() } });
          else if (Math.abs(this.tmOff2) >= 1) out.push({ msg: `特斯拉计是在有磁场时调的零，零点偏了约 ${Math.round(-this.tmOff2)} mT。电流归零后重新调零。`, fix: { label: '电流归零后重新调零', run: () => this.zeroAt0() } });
          if (this.B <= 0.75) out.push({ msg: `磁场只有约 ${Math.round(this.B * 1000)} mT，分裂还太小。把励磁电流加到 3 A 左右。`, fix: { label: '把电流调到 3 A', run: () => { sel('magnet'); return app.tween(() => this.cur, (v) => this.setCur(v), 3, 900); } } });
          if (!this.polIn) out.push({ msg: '偏振片不在光路里（应放在汞灯与目镜之间）。', fix: { label: '放上偏振片', run: () => this.putOn('pol') } });
          else if (!this.sawSigma) out.push({ msg: '还没有观察 σ 成分：偏振片转到 φ = 90°。', fix: { label: '转到 σ 成分看看', run: () => this.rotPol(90) } });
          if (this.polIn && !piOnly()) out.push({ msg: '测量用 π 成分：偏振片转到 φ ≈ 0°。', fix: { label: '转到 π 成分', run: () => this.rotPol(0) } });
          return out;
        },
        auto: async () => {
          if (!this.tmZeroed || Math.abs(this.tmOff2) >= 1) await this.zeroAt0();
          sel('magnet'); await app.tween(() => this.cur, (v) => this.setCur(v), rand(2.8, 3.4), 1200);
          if (!this.polIn) await this.putOn('pol');
          if (!this.sawSigma) await this.rotPol(90);
          await app.wait(500);
          await this.rotPol(0);
        },
      },
      {
        title: '读励磁电流和磁感应强度 B',
        html: '<p>保持励磁电流不变，读出电流和特斯拉计示数，记入表中。</p>',
        check: () => isFinite(Brow().B) && Math.abs(Brow().B - this.Bshow) <= 3 && Brow().B > 700,
        diagnose: () => (isFinite(Brow().B) && Math.abs(Brow().B - this.Bshow) > 3 ? [{ msg: `表中 B = ${Brow().B} mT，现在特斯拉计显示 ${this.Bshow} mT：电流变了，重新读。` }] : []),
        auto: async () => { await this.ready(); app.showTable(0); sel('tm'); await app.record('B', 0); },
      },
      {
        title: '测 k 级与 k−1 级 π 成分的直径',
        html: '<p>转动测微鼓轮，让竖直叉丝从视场最左边开始<b>一直向右</b>移动，依次对准最内两级圆环各 3 条 π 谱线与水平叉丝的交点，左右两侧共 12 个位置，逐个记录。</p>',
        hint: '先把叉丝退到最左边再开始，中途不要回转，否则会引入空回误差。',
        status: () => `已记录 ${app.table('D').rows.reduce((n, r) => n + (isFinite(r.xL) ? 1 : 0) + (isFinite(r.xR) ? 1 : 0), 0)} / 12 个位置`,
        check: () => app.table('D').rows.every((r) => isFinite(r.xL) && isFinite(r.xR)),
        diagnose: () => {
          const out = [];
          if (!piOnly()) out.push({ msg: '视场中不只有 π 成分：偏振片转到 φ ≈ 0°。', fix: { label: '转到 π 成分', run: () => this.rotPol(0) } });
          if (isFinite(Brow().B) && Math.abs(Brow().B - this.Bshow) > 2) out.push({ msg: '磁场和记录的 B 不一致：测量过程中不要动励磁电流。' });
          if (Math.abs(this.cy) > 0.05) out.push({ msg: '水平叉丝没有过圆环中心，测得的是弦长。', fix: { label: '帮我对中', run: () => this.center() } });
          const m = this.aimed();
          if (m && m.e > 0.02 && m.e < 0.3) out.push({ msg: `叉丝离最近的一条 π 谱线还差 ${m.e.toFixed(3)} mm，继续转鼓轮对准它。` });
          return out;
        },
        auto: async () => {
          await this.ready();
          if (!(Math.abs(Brow().B - this.Bshow) <= 2)) { app.showTable(0); await app.record('B', 0); }
          app.showTable(1); sel('eye');
          const tgt = [];
          ROWS.forEach(([j, s], i) => { for (const side of [-1, 1]) { const r = app.table('D').rows[i]; if (!isFinite(r[side < 0 ? 'xL' : 'xR'])) tgt.push(this.cross(j, s, side)); } });
          tgt.sort((p, q) => p - q);
          if (!tgt.length) return;
          if (this.dir !== 1 || this.c > tgt[0] - 0.05) { await app.tween(() => this.x, (v) => this.setX(v), Math.max(0, tgt[0] - 0.3), 500); }
          this._recDir = 1;
          for (const x of tgt) {
            const xr = Math.round((x + this.back) * 2000) / 2000;
            if (xr > this.x) await app.tween(() => this.x, (v) => this.setX(v), xr, 450);
            await app.record('D', 0);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>由同一级中两条外侧 π 成分的直径平方差 $D_b^2-D_a^2$ 与相邻两级的直径平方差 $D_{k-1}^2-D_k^2$ 求 $e/m$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 自动操作（自动完成与助教共用） =======================
  /** 把元件放到（或移到）它的标准位置 */
  async putOn(k) {
    const a = this.app, c = a.comp(k);
    if (!c.placed) { await a.autoPlace(k, { pos: DEF[k] }); return; }
    if (Math.abs(c.pos - DEF[k]) > 0.05) { a.select(c); await a.tween(() => c.pos, (v) => a.setRailPos(c, v), DEF[k], 700); }
  }
  /** 眼睛直接看标准具，左右上下移动眼睛，按圆环的变化拧螺钉，直到两板平行 */
  async makeParallel() {
    const a = this.app; a.select(a.comp('fp'));
    if (!this.direct) { this.direct = true; a.renderInspector(); }
    const look = async (ex, ey) => { await a.tween(() => this.eyeE[0], (v) => (this.eyeE[0] = v), ex, 350); await a.tween(() => this.eyeE[1], (v) => (this.eyeE[1] = v), ey, 350); this.sawWalk++; };
    await look(1, 0); await look(-1, 0); await look(0, 1); await look(0, -1); await look(0, 0);
    // 三颗螺钉的压入量 δᵢ = −R (G₀ₓcos aᵢ + G₀ᵧ sin aᵢ) 恰好抵消出厂偏差
    const tgt = SCREW_A.map((an) => -SCREW_R * (this.G0[0] * Math.cos(an) + this.G0[1] * Math.sin(an)));
    for (let i = 0; i < 3; i++) await a.tween(() => this.scr[i], (v) => (this.scr[i] = v), tgt[i] + rand(-0.003, 0.003), 600);
    await look(1, 0); await look(0, 1); await look(0, 0);
    a.renderInspector();
  }
  async focusEye() {
    const a = this.app; a.select(a.comp('eye'));
    if (Math.abs(this.dz) > 1.4) await this.putOn('eye');
    const to = clamp(this.tube - this.dz + rand(-0.01, 0.01), -1.5, 1.5);
    await a.tween(() => this.tube, (v) => (this.tube = v), to, 800);
  }
  /** 测量前的状态：光路搭好、灯亮、调好焦、圆环居中、只有 π 成分、B ≈ 1 T（被改动过就恢复） */
  async ready() {
    const a = this.app, sel = (k) => a.select(a.comp(k));
    for (const k of ['lens1', 'filter', 'fp', 'lens2', 'eye']) if (this.P(k) == null) await this.putOn(k);
    if (this.pathIssue()) for (const k of ['lens1', 'fp', 'lens2', 'eye']) await this.putOn(k);
    if (!this.lampOn) { sel('lamp'); this.lampOn = true; a.renderInspector(); }
    await a.until(() => this.warm >= 1, 30000);
    if (this.par > PAR_TOL) await this.makeParallel();
    if (this.direct) { sel('fp'); this.direct = false; a.renderInspector(); }
    if (Math.abs(this.dz) >= DZ_TOL * 0.8) await this.focusEye();
    if (Math.abs(this.cy) > 0.04 || Math.abs(this.cx - FIELD / 2) > 0.5) await this.center();
    if (this.B <= 0.75 || this.B > 1.25) { sel('magnet'); await a.tween(() => this.cur, (v) => this.setCur(v), rand(2.8, 3.4), 900); }
    const p = this.polW(); if (!this.polIn || p.pi < 0.8 || p.sigma > 0.1) await this.rotPol(0);
  }
  /** 用目镜架微调把圆环中心移到视场中央（共轴偏差与标准具转角引起的偏移一并补偿） */
  async center() {
    const a = this.app; a.select(a.comp('eye'));
    const tx = clamp(this.ax - (this.cx - FIELD / 2) + rand(-0.15, 0.15), -2.5, 2.5), ty = clamp(this.ay - this.cy + rand(-0.01, 0.01), -2.5, 2.5);
    await a.tween(() => this.ax, (v) => (this.ax = v), tx, 600);
    await a.tween(() => this.ay, (v) => (this.ay = v), ty, 600);
  }
  async zeroAt0() {
    const a = this.app; a.select(a.comp('magnet'));
    if (this.cur > 0) await a.tween(() => this.cur, (v) => this.setCur(v), 0, 700);
    this.setCur(0); a.select(a.comp('tm')); await a.wait(300); this.zeroTm(); a.changed();
  }
  async rotPol(deg) {
    const a = this.app;
    if (!this.polIn) await this.putOn('pol');
    a.select(a.comp('pol'));
    let to = deg; if (Math.abs(to - this.phi) > 180) to += to < this.phi ? 360 : -360;
    await a.tween(() => this.phi, (v) => (this.phi = ((v % 360) + 360) % 360), to, 700);
    this.phi = deg;
  }

  // ======================= 数据处理 =======================
  analyze() {
    const app = this.app, B = app.table('B').rows[0].B / 1000;
    const rows = app.table('D').rows.map((r, i) => ({ ...r, D2: isFinite(r.xL) && isFinite(r.xR) ? (r.xR - r.xL) ** 2 : NaN, i }));
    if (!isFinite(B) || B <= 0) return { html: '<p>请先记录磁感应强度 B。</p>', ok: false };
    const D2 = (j, n) => rows[j * 3 + n].D2;
    if ([0, 1, 2, 3, 4, 5].some((i) => !isFinite(rows[i].D2))) return { html: '<p>两级共 6 条 π 谱线的左右位置都要测完。</p>', ok: false };
    const dl = [D2(1, 0) - D2(0, 0), D2(1, 1) - D2(0, 1), D2(1, 2) - D2(0, 2)], Dl = mean(dl);
    const db = [D2(0, 2) - D2(0, 0), D2(1, 2) - D2(1, 0)], dB = mean(db);
    const em = (2 * Math.PI * C_LIGHT * dB) / (D_NOM * B * Dl) * 1e0;
    const u = em * Math.sqrt((stdev(dl) / Dl) ** 2 / 3 + (Math.abs(db[0] - db[1]) / 2 / dB) ** 2 + (0.5e-3 / B) ** 2);
    const dsig = dB / (2 * D_NOM * 1000 * Dl); // mm⁻¹ → 下面换算
    const html = `<h3>1. 原始数据</h3><table><tr><th>级次</th><th>分量</th><th>x_左/mm</th><th>x_右/mm</th><th>D/mm</th><th>D²/mm²</th></tr>${rows.map((r) => `<tr><td>${r.ring}</td><td>${r.comp}</td><td>${r.xL.toFixed(3)}</td><td>${r.xR.toFixed(3)}</td><td>${Math.sqrt(r.D2).toFixed(3)}</td><td>${r.D2.toFixed(3)}</td></tr>`).join('')}</table>
      <p>$B$ = ${(B * 1000).toFixed(0)} mT，$d$ = 2.000 mm。</p>
      <h3>2. 计算</h3><p>相邻两级同一分量的直径平方差：${dl.map((x) => x.toFixed(3)).join('、')} mm²，平均 $D_{k-1}^2-D_k^2$ = ${Dl.toFixed(3)} mm²。</p>
      <p>同一级两条外侧 π 成分 b、a 的直径平方差：k 级 ${db[0].toFixed(3)}、k−1 级 ${db[1].toFixed(3)} mm²，平均 ${dB.toFixed(3)} mm²。它们的 Δ(Mg) 相差 1，波数差</p>
      $$\\Delta\\tilde\\nu=\\frac{1}{2d}\\cdot\\frac{D_b^2-D_a^2}{D_{k-1}^2-D_k^2}=${(dsig * 10).toFixed(4)}\\ \\mathrm{cm^{-1}}$$
      <div class="result-box">$\\dfrac em=\\dfrac{2\\pi c}{dB}\\cdot\\dfrac{D_b^2-D_a^2}{D_{k-1}^2-D_k^2}=${fmtU(em / 1e11, u / 1e11).replace('±', '\\pm')}\\times10^{11}\\ \\mathrm{C/kg}$</div>
      <div class="result-box warn">公认值 1.7588×10¹¹ C/kg，相对误差 ${pct(relErr(em, EM_TRUE))}。洛伦兹单位 $L=eB/4\\pi mc$ = ${(lorentz(B) / 100).toFixed(4)} cm⁻¹（按公认的 e/m 计算）。</div>
      <p>误差来源：特斯拉计的零点与探头位置（磁极间磁场不完全均匀）；叉丝对准谱线的估读；水平叉丝不过圆环中心（测得弦长）；标准具间隔 d 的标定误差。</p>`;
    return { html, ok: true, answers: [{ label: '$e/m$', unit: '×10¹¹ C/kg', value: em / 1e11, digits: 3, tolRel: 0.01 }] };
  }

  principle() {
    return `<h3>1. 塞曼效应</h3>${zeemanFig()}<p>原子处在磁场 $B$ 中时，总角动量为 $J$ 的能级按磁量子数 $M=J,J-1,\\dots,-J$ 分裂为 $2J+1$ 个子能级，附加能量 $\\Delta E=Mg\\mu_BB$，$g$ 为朗德因子。谱线的波数改变</p>$$\\Delta\\tilde\\nu=(M_2g_2-M_1g_1)\\,\\frac{eB}{4\\pi mc}=(M_2g_2-M_1g_1)\\,L$$<p>汞 546.1 nm 谱线由 $7^3S_1$（$g_2=2$）跃迁到 $6^3P_2$（$g_1=3/2$），两能级的 $g$ 不同，选择定则 $\\Delta M=0,\\pm1$ 下共有 9 条谱线：$\\Delta M=0$ 的 3 条 π 成分位于 $0,\\pm\\tfrac12L$，$\\Delta M=\\pm1$ 的 6 条 σ 成分位于 $\\pm L,\\pm\\tfrac32L,\\pm2L$。这是反常塞曼效应。</p>
<h3>2. 偏振</h3><p>垂直于磁场观察时，π 成分是电矢量平行于 $B$ 的线偏振光，σ 成分是电矢量垂直于 $B$ 的线偏振光。用偏振片可以把两者分开。</p>
<h3>3. 用 F-P 标准具测分裂量</h3><p>分裂量只有约 0.5 cm⁻¹ 量级，要用分辨本领很高的法布里–珀罗标准具。透射光形成等倾圆环，$2d\\cos\\theta=k\\lambda$。经焦距 $f$ 的透镜成像，第 $k$ 级圆环直径 $D_k$ 满足 $D_k^2\\approx 8f^2\\left(1-\\dfrac{k}{2d\\tilde\\nu}\\right)$。由此，同一级中两条谱线的波数差</p>$$\\Delta\\tilde\\nu_{ab}=\\frac{1}{2d}\\cdot\\frac{D_b^2-D_a^2}{D_{k-1}^2-D_k^2}$$<p>与焦距无关。取两条外侧的 π 成分（Δ(Mg) 相差 1），$\\Delta\\tilde\\nu_{ab}=eB/4\\pi mc$，得</p>$$\\frac em=\\frac{2\\pi c}{dB}\\cdot\\frac{D_b^2-D_a^2}{D_{k-1}^2-D_k^2}$$
<h3>4. 本仿真的计算模型</h3><p>9 条分量按上式算出位置，强度按 $J\\to J+1$ 跃迁的跃迁几率；每条分量在标准具后的强度为艾里函数（反射率约 88%），并计入谱线的多普勒宽度与像素宽度的平均。圆环半径按 $f\\tan\\theta$ 精确计算。电磁铁的 B–I 关系有铁芯饱和，测微目镜有空回。</p><p>光路由元件在导轨上的实际位置决定：聚光透镜离汞灯越接近一个焦距，进入标准具的光越多；分划板离成像透镜焦面的距离决定圆环的模糊程度；成像透镜与目镜不共轴、标准具法线偏离光轴会使圆环中心偏开。标准具两板不平行时，间隔沿口径线性变化，经目镜看到的圆环发虚；用眼睛直接看时只用到眼睛对着的一小块，眼睛移动，中心处的级次随之改变，圆环“冒出”或“缩进”。</p>`;
  }
}
