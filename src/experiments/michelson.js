// 实验二：迈克尔逊干涉仪测 He-Ne 激光波长
import * as THREE from 'three';
import { meta, thumb, LAMBDA } from './michelson.meta.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, labTable, laserMesh, ICONS, canvasTexture, knobMesh } from '../core/Models.js';
import { OptBench, BeamDraw } from '../core/beams.js';
import { michelsonPattern, michelsonSpots, GLSL_MICHELSON, GLSL_SPOTS, michelsonUniforms, spotsUniforms, GLSL_MICHELSON_WHITE, michelsonWhiteUniforms, WHITE } from '../physics/interference.js';
import { GPU } from '../core/gpu.js';
import { linFit, mean, uA, fmtU, texU, sig, gauss, rand, relErr, pct, clamp, successiveDiff } from '../core/Stats.js';
import { lineData } from '../core/Plot.js';
import * as FIG from './figures.js';

const YB = 14; // 光束高度 cm
const HALF = 40; // 屏视场半宽 mm
const DMS = 400; // M2 到屏的距离（光点偏移杠杆）mm
const LSM = 100; // 扩束点光源到 M2 的光程 mm
const R0 = 500; // 虚光源到屏距离 mm
const BACKLASH = 0.0006; // 空程 mm
const EXP_DIV = 0.06; // 扩束后的发散半角 rad
const NOM = 0.43; // 扩束后每一臂到达反射镜的功率（激光功率为 1，正常对准时）
const NOMS = 0.219; // 未扩束时每一臂到达屏的功率（0.48 × 0.95 × 0.48）

export class MichelsonExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.m0 = rand(30.5, 33.5); // 等光程位置
    this.drive = this.m0 + rand(0.55, 0.85) * (Math.random() < 0.5 ? 1 : -1) + 0.0;
    this.mirror = this.drive;
    this.lastDir = 0; this.travel = 0;
    this.eps = { x: rand(5, 8) * (Math.random() < 0.5 ? -1 : 1), y: rand(4, 7) * (Math.random() < 0.5 ? -1 : 1) }; // mrad
    this.laserOn = false;
    this.white = false; // 光源：false = He-Ne 激光，true = 白光（钨丝灯 + 小孔）
    this.zeroD = this.d;
    this.showAssist = true;
    this.counter = 0;
  }

  get d() { return this.mirror - this.m0; }
  get N() { return (2 * (this.d - this.zeroD)) / LAMBDA; }

  cameras() {
    return [
      { name: '全景', pos: [10, 85, 120], target: [0, 10, 5] },
      { name: '俯视', pos: [2, 150, 30], target: [2, 0, 4] },
      { name: '观察屏', pos: [-35, 30, 70], target: [0, 14, 30] },
      { name: '手轮', pos: [60, 40, 55], target: [30, 10, 5] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const table = labTable(180, 130); table.position.set(0, 0, 0); scene.add(table);
    app.addTable({ x0: -88, x1: 88, z0: -63, z1: 63 }); // 激光器、扩束镜、观察屏可放在台面任意位置和方向
    app.stage.setLightTarget(0, 0, 0);

    // ---------- 干涉仪主体（固定） ----------
    const body = new THREE.Group();
    body.add(mesh(new THREE.BoxGeometry(56, 3, 34), MAT.paint(0x3b4a5c), 10, 3.5, -2));
    for (const [x, z] of [[-14, -16], [-14, 12], [36, -2]]) body.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 2, 16), MAT.black(), x, 1, z));
    // 导轨与丝杠
    body.add(mesh(new THREE.BoxGeometry(32, 2.4, 6), MAT.alu(), 22, 6.2, 0));
    const screw = mesh(new THREE.CylinderGeometry(0.5, 0.5, 34, 12), MAT.chrome(), 22, 8, -4);
    screw.rotation.z = Math.PI / 2; body.add(screw);
    // 分光板 G1 与补偿板 G2（45°）
    const g1 = mesh(new THREE.BoxGeometry(0.6, 6, 6), MAT.glass(0x9bd5ff, 0.45), 0, YB, 0);
    g1.rotation.y = Math.PI / 4; body.add(g1);
    const g2 = mesh(new THREE.BoxGeometry(0.6, 6, 6), MAT.glass(0xcfefff, 0.25), 5, YB, 0);
    g2.rotation.y = Math.PI / 4; body.add(g2);
    for (const x of [0, 5]) body.add(mesh(new THREE.BoxGeometry(3, YB - 8, 3), MAT.dark(), x, 5 + (YB - 8) / 2 + 0.5, 0));
    // 标牌
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshBasicMaterial({ map: canvasTexture(512, 96, (g, W, H) => { g.fillStyle = '#e5e7eb'; g.fillRect(0, 0, W, H); g.fillStyle = '#111'; g.font = 'bold 46px "Microsoft YaHei"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('迈克尔逊干涉仪', W / 2, H / 2 + 2); }) }));
    plate.position.set(14, 3.6, 15.02); body.add(plate);
    app.addComponent(new Component({ key: 'body', name: '迈克尔逊干涉仪', zone: 'none', fixed: true, object: body, labelY: 26, showLabel: false, desc: 'G₁ 为分光板（背面镀半反射膜），G₂ 为补偿板，使两臂玻璃光程相同。' }));

    // ---------- 动镜 M1 + 手轮（固定组件，可调） ----------
    const m1g = new THREE.Group();
    this.m1Carriage = new THREE.Group();
    this.m1Carriage.add(mesh(new THREE.BoxGeometry(4, 3, 8), MAT.paint(0x1f3b63), 0, 8.5, 0));
    this.m1Carriage.add(mesh(new THREE.BoxGeometry(1, YB - 8, 6), MAT.dark(), 0, 10 + (YB - 10) / 2, 0));
    const m1 = mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.6, 32), MAT.chrome(), -0.7, YB, 0);
    m1.rotation.z = Math.PI / 2; this.m1Carriage.add(m1);
    m1g.add(this.m1Carriage);
    // 粗动手轮（前侧，轴沿 z），带读数窗
    this.coarseWheel = new THREE.Group();
    const cw = mesh(new THREE.CylinderGeometry(4.5, 4.5, 1.2, 40), MAT.paint(0x111827)); cw.rotation.x = Math.PI / 2; this.coarseWheel.add(cw);
    for (let i = 0; i < 6; i++) { const sp = mesh(new THREE.BoxGeometry(0.5, 8, 0.4), MAT.alu(), 0, 0, 0.7); sp.rotation.z = (i * Math.PI) / 6; this.coarseWheel.add(sp); }
    this.coarseWheel.position.set(30, 9, 16.5);
    m1g.add(this.coarseWheel);
    m1g.add(mesh(new THREE.BoxGeometry(6, 3, 4), MAT.paint(0x3b4a5c), 30, 6.5, 14));
    // 读数窗
    m1g.add(mesh(new THREE.BoxGeometry(5, 0.6, 2.4), MAT.black(), 24, 5.3, 12));
    // 微动手轮（导轨末端，轴沿 x）
    this.fineWheel = new THREE.Group();
    const fw = mesh(new THREE.CylinderGeometry(2.6, 2.6, 2.4, 40), new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.8, roughness: 0.3, map: canvasTexture(512, 64, (g, W, H) => { g.fillStyle = '#d1d5db'; g.fillRect(0, 0, W, H); g.fillStyle = '#111'; for (let i = 0; i < 100; i++) { const x = (i / 100) * W; g.fillRect(x, 0, 1.5, i % 10 === 0 ? 40 : i % 5 === 0 ? 28 : 18); } }) }));
    fw.rotation.z = Math.PI / 2; this.fineWheel.add(fw);
    const fk = mesh(new THREE.CylinderGeometry(1.4, 1.4, 2, 24), MAT.black(), 1.8, 0, 0); fk.rotation.z = Math.PI / 2; this.fineWheel.add(fk);
    this.fineWheel.position.set(40.5, 8, -4);
    m1g.add(this.fineWheel);
    app.addComponent(new Component({
      key: 'm1', name: '动镜 M₁ 与测微手轮', zone: 'none', fixed: true, object: m1g, labelY: 24,
      labelText: () => '动镜 M₁ / 手轮',
      desc: '粗动手轮转一圈 M₁ 移动 1 mm（读数窗分度 0.01 mm）；微动手轮转一圈 M₁ 移动 0.01 mm（100 分度，每格 0.0001 mm，可估读到 10⁻⁵ mm）。',
      controls: () => [
        { type: 'knob', label: '粗动手轮', get: () => this.drive, set: (v) => this.moveDrive(v), min: 25, max: 40, step: 0.01, bigStep: 0.1, perRev: 1, digits: 2, unit: 'mm', sub: '快速移动 M₁（测量时不要使用）' },
        { type: 'knob', label: '微动手轮', get: () => this.drive, set: (v) => this.moveDrive(v), min: 25, max: 40, step: 0.0001, bigStep: 0.001, perRev: 0.01, digits: 5, unit: 'mm', fmt: (v) => ((v * 10000) % 100).toFixed(1) + ' 格', sub: '测量时只转动微动手轮，并始终沿同一方向' },
      ],
    }));

    // ---------- 定镜 M2（固定组件，可调） ----------
    const m2g = new THREE.Group();
    m2g.add(mesh(new THREE.BoxGeometry(8, YB - 3, 2), MAT.dark(), 0, 5 + (YB - 5) / 2, -16.5));
    this.m2Mirror = new THREE.Group();
    const m2 = mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.6, 32), MAT.chrome()); m2.rotation.x = Math.PI / 2; this.m2Mirror.add(m2);
    this.m2Mirror.position.set(0, YB, -15.2);
    m2g.add(this.m2Mirror);
    for (const [x, y] of [[-2.6, 2.6], [2.6, 2.6], [0, -2.8]]) {
      const k = knobMesh(0.8, 1.6); k.rotation.x = Math.PI / 2; k.position.set(x, YB + y, -18.2); m2g.add(k);
    }
    // 拉簧微调螺钉（底座处）
    const s1 = knobMesh(0.9, 1.4, 0x7f1d1d); s1.position.set(5.2, 7, -16.5); s1.rotation.z = Math.PI / 2; m2g.add(s1);
    const s2 = knobMesh(0.9, 1.4, 0x7f1d1d); s2.position.set(0, 7, -14.6); s2.rotation.x = Math.PI / 2; m2g.add(s2);
    app.addComponent(new Component({
      key: 'm2', name: '定镜 M₂ 及调节螺钉', zone: 'none', fixed: true, object: m2g, labelY: 26,
      desc: 'M₂ 背后有三个粗调螺钉，用于粗调镜面倾角；底座上两个拉簧螺钉可精细微调 M₂ 的水平与竖直倾角。',
      controls: () => [
        { type: 'group', label: '背后粗调螺钉（1 圈 = 0.5 mrad）' },
        { type: 'knob', label: '粗调：水平倾角', get: () => this.eps.x, set: (v) => (this.eps.x = v), min: -12, max: 12, step: 0.02, bigStep: 0.2, perRev: 0.5, digits: 3, unit: 'mrad' },
        { type: 'knob', label: '粗调：竖直倾角', get: () => this.eps.y, set: (v) => (this.eps.y = v), min: -12, max: 12, step: 0.02, bigStep: 0.2, perRev: 0.5, digits: 3, unit: 'mrad' },
        { type: 'group', label: '拉簧微调螺钉（1 圈 = 0.02 mrad）' },
        { type: 'knob', label: '微调：水平拉簧', get: () => this.eps.x, set: (v) => (this.eps.x = v), min: -12, max: 12, step: 0.0005, bigStep: 0.005, perRev: 0.02, digits: 4, unit: 'mrad' },
        { type: 'knob', label: '微调：竖直拉簧', get: () => this.eps.y, set: (v) => (this.eps.y = v), min: -12, max: 12, step: 0.0005, bigStep: 0.005, perRev: 0.02, digits: 4, unit: 'mrad' },
      ],
    }));

    // ---------- 可放置器材 ----------
    app.addSlot({ id: 'laser', pos: new THREE.Vector3(-26, 0, 0), accepts: ['laser'] });
    app.addSlot({ id: 'expander', pos: new THREE.Vector3(-11, 0, 0), accepts: ['expander'] });
    app.addSlot({ id: 'screen', pos: new THREE.Vector3(0, 0, 36), accepts: ['screen'] });

    const lg = new THREE.Group();
    const lz = laserMesh(28);
    lz.group.position.y = YB; lg.add(lz.group);
    lg.add(mesh(new THREE.BoxGeometry(24, YB - 4.6, 4), MAT.paint(0x334155), -14, (YB - 4.6) / 2, 0));
    this.laserAp = lz.aperture;
    app.addComponent(new Component({
      key: 'laser', name: 'He-Ne 激光器 / 白光灯', icon: ICONS.laser, zone: 'slot', defaultSlot: 'laser', required: true, object: lg, labelY: 24,
      desc: '输出波长 632.8 nm（实验中视为待测）的红色激光，功率约 1 mW。注意：切勿直视激光！灯座上另有一盏钨丝白光灯（前加小孔），可切换使用，用于寻找零光程位置。',
      controls: () => [
        { type: 'toggle', label: '光源电源', get: () => this.laserOn, set: (v) => (this.laserOn = v) },
        { type: 'segment', label: '光源', get: () => (this.white ? 'w' : 'l'), set: (v) => (this.white = v === 'w'), options: [{ value: 'l', label: 'He-Ne 激光' }, { value: 'w', label: '白光' }] },
      ],
    }));

    const eg = new THREE.Group();
    eg.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, YB - 2, 12), MAT.alu(), 0, (YB - 2) / 2, 0));
    const et = mesh(new THREE.CylinderGeometry(1.4, 1.0, 3.5, 24), MAT.black(), 0, YB, 0); et.rotation.z = Math.PI / 2; eg.add(et);
    eg.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.8, 24), MAT.dark(), 0, 0.4, 0));
    app.addComponent(new Component({
      key: 'expander', name: '扩束镜（短焦透镜）', icon: ICONS.expander, zone: 'slot', defaultSlot: 'expander', object: eg, labelY: 22,
      desc: '焦距很短的会聚透镜，使激光会聚后发散，相当于一个点光源，从而在屏上得到等倾干涉圆环。',
    }));

    const sg = new THREE.Group();
    sg.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, YB - 3, 12), MAT.alu(), 0, (YB - 3) / 2, 0));
    sg.add(mesh(new THREE.CylinderGeometry(3, 3, 0.8, 24), MAT.dark(), 0, 0.4, 0));
    sg.add(mesh(new THREE.BoxGeometry(18, 18, 0.6), MAT.dark(), 0, YB + 1, 0.4));
    this.fringeView = app.addView({ id: 'screen', title: '观察屏（毛玻璃屏）', w: 270, h: 270, res: 1 });
    this.fringeImg = this.fringeView.ctx.createImageData(this.fringeView.W, this.fringeView.H);
    this.screenTex = new THREE.CanvasTexture(this.fringeView.canvas); this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: this.screenTex }));
    face.position.set(0, YB + 1, 0.05); face.rotation.y = Math.PI; face.userData.noHL = true;
    sg.add(face);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: this.screenTex }));
    back.position.set(0, YB + 1, 0.75); back.userData.noHL = true; back.scale.x = -1;
    sg.add(back);
    app.addComponent(new Component({
      key: 'screen', name: '观察屏（毛玻璃）', icon: ICONS.screen, zone: 'slot', defaultSlot: 'screen', required: true, object: sg, labelY: 30,
      desc: '毛玻璃观察屏，放在干涉仪出射方向，两面均可观察干涉图样。',
    }));

    this.readView = app.addView({ id: 'reading', title: 'M₁ 位置读数（主尺 + 读数窗 + 微动鼓轮）', w: 270, h: 120, res: 1.5 });

    // 光束
    this.beamDraw = new BeamDraw(scene, { max: 40 });
  }

  // ---------- 机构：带空程的丝杠 ----------
  moveDrive(v) {
    const dv = v - this.drive;
    if (Math.abs(dv) < 1e-12) return;
    const dir = Math.sign(dv);
    if (dir !== this.lastDir) { this.travel = 0; this.lastDir = dir; }
    this.travel += Math.abs(dv);
    this.drive = v;
    const half = BACKLASH / 2;
    if (this.drive - this.mirror > half) this.mirror = this.drive - half;
    if (this.mirror - this.drive > half) this.mirror = this.drive + half;
  }

  /** 光点 / 干涉条纹状态 */
  geom() {
    const ex = this.eps.x * 1e-3, ey = this.eps.y * 1e-3;
    return {
      spotSep: Math.hypot(2 * ex * DMS, 2 * ey * DMS),
      dx: 2 * ex * LSM, dy: 2 * ey * LSM,
      sx: 2 * ex * DMS, sy: 2 * ey * DMS,
    };
  }
  ringCenter() {
    const g = this.geom(), o = this.optics();
    const d = this.d;
    // 两虚光源连线与屏交点：中心偏移 = δ·R0/(2d)；再加上光束中心在屏上的偏移（屏或激光没摆正时）
    const s = R0 / (2 * Math.abs(d) + 1e-9);
    const x = g.dx * s + o.ox, y = g.dy * s + o.oy;
    return { x, y, r: Math.hypot(x, y) };
  }

  /** 由激光器、扩束镜、观察屏的实际位置与方向，以及 M₁、M₂ 的姿态追迹光路 */
  trace() {
    const app = this.app;
    const pk = (k) => { const c = app.comp(k); return c.placed ? `${c.root.position.x.toFixed(3)},${c.root.position.z.toFixed(3)},${c.root.rotation.y.toFixed(5)}` : '-'; };
    const key = [this.laserOn, this.white, this.eps.x.toFixed(4), this.eps.y.toFixed(4), this.m1Carriage.position.x.toFixed(3), pk('laser'), pk('expander'), pk('screen')].join('|');
    if (key === this._tkey && this._trace) return this._trace;
    this._tkey = key;
    const B = this.bench || (this.bench = new OptBench());
    B.clear();
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const pose = (k, local, n) => OptBench.pose(app.comp(k).root, local, n);
    if (app.comp('expander').placed) B.add({ id: 'expander', kind: 'expander', ...pose('expander', V3(0, YB, 0), V3(1, 0, 0)), R: 0.7, div: EXP_DIV, fe: 0.4, T: 0.9, axisTol: 0.06, noSpot: true });
    // 分光板 G₁（45°，6 cm × 6 cm）：反射一路射向 M₂，透射一路射向 M₁
    B.add({ id: 'bs', kind: 'splitter', c: V3(0, YB, 0), n: V3(1, 0, 1).normalize(), rect: [3, 3], R_bs: 0.5, loss: 0.04, noSpot: true });
    B.add({ id: 'm1', kind: 'mirror', c: V3(this.m1Carriage.position.x - 0.7, YB, 0), n: V3(-1, 0, 0), R: 2.8, refl: 0.95 });
    // M₂ 法线：水平倾角 εx、竖直倾角 εy（反射光偏转 2ε）
    const ex = this.eps.x * 1e-3, ey = this.eps.y * 1e-3;
    B.add({ id: 'm2', kind: 'mirror', c: V3(0, YB, -15.2), n: V3(-Math.sin(ex), Math.sin(ey), 1).normalize(), R: 2.8, refl: 0.95 });
    if (app.comp('screen').placed) B.add({ id: 'screen', kind: 'target', ...pose('screen', V3(0, YB, 0), V3(0, 0, 1)), rect: [8, 7], noSpot: true }); // 观察窗以光轴高度处的屏面为中心
    // 激光器出光口端面：返回的光点打在这里（调光路时常用“光点返回出光孔”来判断入射是否正）
    if (app.comp('laser').placed) B.add({ id: 'laserFace', kind: 'stop', ...pose('laser', V3(0.3, YB, 0), V3(1, 0, 0)), rect: [2.1, 2.1] });
    for (const [c, n] of [[[-88, 0], [1, 0]], [[88, 0], [-1, 0]], [[0, -63], [0, 1]], [[0, 63], [0, -1]]]) B.add({ id: 'edge', kind: 'stop', c: V3(c[0], YB, c[1]), n: V3(n[0], 0, n[1]), R: 400, noSpot: true });
    const src = [];
    if (this.laserOn && app.comp('laser').placed) { const q = pose('laser', V3(0.5, YB, 0), V3(1, 0, 0)); src.push({ p: q.c, u: q.n, P: 1, w: 0.05, th: 0.0006, color: this.white ? 0xfff0d2 : 0xff2a1a }); }
    this._trace = B.trace(src);
    return this._trace;
  }

  /**
   * 屏上的两路光：tr = 经 M₁（透射→反射），rt = 经 M₂（反射→透射）。
   * 返回光点位置（mm，面向屏正面看）、两臂功率、扩束后条纹的增益/可见度/整体偏移等。
   */
  optics() {
    const tr = this.trace();
    const o = { bs: null, exp: null, arms: { tr: null, rt: null }, wide: { tr: null, rt: null }, I1: 0, I2: 0, sep: Infinity, fringe: false, gain: 0, va: 0, ox: 0, oy: 0, bsOff: Infinity };
    const big = (hs) => (hs || []).reduce((a, h) => (!a || h.P > a.P ? h : a), null);
    o.bs = big((tr.hits.get('bs') || []).filter((h) => h.tag === ''));
    o.bsOff = o.bs ? Math.hypot(o.bs.a, o.bs.b) : Infinity; // 入射点到分光板中心的距离 cm
    o.exp = big(tr.hits.get('expander'));
    const wideP = (id) => (tr.hits.get(id) || []).filter((h) => h.w > 0.5).reduce((s, h) => s + h.P, 0);
    o.I1 = wideP('m1'); o.I2 = wideP('m2');
    const scr = this.app.comp('screen');
    if (scr.placed) {
      const ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3();
      scr.root.updateWorldMatrix(true, false); scr.root.matrixWorld.extractBasis(ax, ay, az);
      const c = OptBench.pose(scr.root, new THREE.Vector3(0, YB, 0)).c;
      for (const h of tr.hits.get('screen') || []) {
        const k = h.tag === 'tr' ? 'tr' : h.tag === 'rt' ? 'rt' : null;
        if (!k) continue;
        const d = h.q.clone().sub(c), X = -d.dot(ax) * 10, Y = d.dot(ay) * 10;
        const slot = h.w > 0.5 ? o.wide : o.arms;
        if (!slot[k] || h.P > slot[k].P) slot[k] = { X, Y, P: h.P, w: h.w };
      }
    }
    if (o.arms.tr && o.arms.rt) o.sep = Math.hypot(o.arms.tr.X - o.arms.rt.X, o.arms.tr.Y - o.arms.rt.Y);
    const w1 = o.wide.tr ? o.I1 : 0, w2 = o.wide.rt ? o.I2 : 0;
    o.fringe = w1 + w2 > 0.05;
    o.gain = Math.min(1.3, (w1 + w2) / (2 * NOM));
    o.va = w1 + w2 > 0 ? (2 * Math.sqrt(w1 * w2)) / (w1 + w2) : 0;
    const a = o.wide.tr, b = o.wide.rt, pa = a ? a.P : 0, pb = b ? b.P : 0;
    if (pa + pb > 0) { o.ox = ((a ? a.X * pa : 0) + (b ? b.X * pb : 0)) / (pa + pb); o.oy = ((a ? a.Y * pa : 0) + (b ? b.Y * pb : 0)) / (pa + pb); }
    return o;
  }

  update() {
    const app = this.app;
    const on = this.laserOn && app.comp('laser').placed;
    const expander = app.comp('expander').placed;
    const scr = app.comp('screen').placed;
    // 3D 机构
    this.m1Carriage.position.x = 22 + (this.mirror - 32) * 2.0; // 视觉上放大位移
    this.fineWheel.rotation.x = (this.drive / 0.01) * Math.PI * 2;
    this.coarseWheel.rotation.z = -(this.drive / 1) * Math.PI * 2;
    this.m2Mirror.rotation.set(this.eps.y * 0.01, this.eps.x * 0.01, 0);
    this.laserAp.material.emissiveIntensity = on ? 3 : 0.1;
    this.laserAp.material.emissive.set(this.white ? 0xfff0d2 : 0xff2222);

    // 光束：按实际光路追迹
    this.beamDraw.draw(on ? this.trace() : null, 1);

    // 屏上图样
    const v = this.fringeView, img = this.fringeImg;
    let foot = '', op = null;
    if (!scr) { v.ctx.fillStyle = '#111'; v.ctx.fillRect(0, 0, v.W, v.H); foot = '未放置观察屏'; }
    else if (!on) { v.ctx.fillStyle = '#1b1d22'; v.ctx.fillRect(0, 0, v.W, v.H); foot = '激光器未打开'; }
    else if (!(op = this.optics()).fringe) {
      // 未扩束（或扩束镜没对准）：两组激光光点，每组带两个较弱的次级反射点（分光板背面）
      const spots = [];
      for (const k of ['tr', 'rt']) {
        const q = op.arms[k]; if (!q) continue;
        const a = Math.min(1.2, q.P / NOMS);
        spots.push({ x: q.X, y: q.Y, r: 1.3, a }, { x: q.X + 2.6, y: q.Y + 0.4, r: 1.0, a: a * 0.12 }, { x: q.X + 5.2, y: q.Y + 0.8, r: 0.9, a: a * 0.04 });
      }
      if (!GPU.paint(v, 'mspots', GLSL_SPOTS, spotsUniforms(spots, HALF, v.W, this.white))) {
        michelsonSpots(img, { spots, halfW: HALF, white: this.white });
        v.ctx.putImageData(img, 0, 0);
      }
      foot = !spots.length ? (expander ? '屏上没有光点：扩束镜没有对准激光，或光没有到达屏' : '屏上没有光点：光束没有经干涉仪到达观察屏')
        : op.sep < Infinity ? `两组光点中最亮点间距 ≈ ${op.sep.toFixed(1)} mm` : '只看到一组光点：另一路光没有到达观察屏';
    } else {
      const g = this.geom();
      const mp = { d: this.d, lambda: LAMBDA, R0, dx: g.dx, dy: g.dy, halfW: HALF, ox: op.ox, oy: op.oy, va: op.va, gain: op.gain };
      const ok = this.white ? GPU.paint(v, 'michelsonW', GLSL_MICHELSON_WHITE, michelsonWhiteUniforms(mp, v.W)) : GPU.paint(v, 'michelson', GLSL_MICHELSON, michelsonUniforms(mp, v.W));
      if (!ok) {
        michelsonPattern(img, this.white ? { ...mp, white: WHITE } : mp);
        v.ctx.putImageData(img, 0, 0);
      }
      const c = this.ringCenter();
      foot = this.white ? (Math.abs(this.d) < 0.002 ? `白光 · d≈${Math.abs(this.d).toFixed(4)} mm` : '白光 · 视场均匀（光程差太大，条纹不可见）') : c.r > HALF * 1.2 ? '圆心在视场外（条纹弯曲），需微调 M₂' : `d≈${Math.abs(this.d).toFixed(3)} mm  圆心偏离 ${c.r.toFixed(1)} mm`;
    }
    // 刻度十字
    v.ctx.strokeStyle = 'rgba(255,255,255,.12)'; v.ctx.beginPath(); v.ctx.moveTo(v.W / 2, 0); v.ctx.lineTo(v.W / 2, v.H); v.ctx.moveTo(0, v.H / 2); v.ctx.lineTo(v.W, v.H / 2); v.ctx.stroke();
    v.foot(foot);
    this.screenTex.needsUpdate = true;
    this.drawReading();
  }

  drawReading() {
    const v = this.readView, g = v.ctx, W = v.W, H = v.H;
    const x = this.drive;
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, H);
    const sc = W / 270;
    g.save(); g.scale(sc, sc);
    // 主尺（mm）
    g.fillStyle = '#e8e2cf'; g.fillRect(8, 14, 80, 60);
    g.fillStyle = '#111'; g.font = '10px Arial'; g.textAlign = 'center';
    const mm = Math.floor(x);
    for (let k = -3; k <= 3; k++) {
      const px = 48 + (k - (x - mm)) * 11;
      if (px < 10 || px > 86) continue;
      g.fillRect(px, 14, 1, (mm + k) % 5 === 0 ? 18 : 11);
      if ((mm + k) % 5 === 0) g.fillText(String(mm + k), px, 44);
    }
    g.fillStyle = '#dc2626'; g.fillRect(47.5, 14, 1.5, 40);
    g.fillStyle = '#94a3b8'; g.font = '11px "Microsoft YaHei"'; g.fillText('主尺 /mm', 48, 88);
    // 读数窗（粗动手轮 0.01 mm）
    const coarse = (x - mm) * 100;
    g.fillStyle = '#e8e2cf'; g.fillRect(100, 14, 70, 60);
    g.fillStyle = '#111'; g.font = '10px Arial';
    for (let k = -4; k <= 4; k++) {
      const val = Math.floor(coarse) + k;
      const py = 44 + (k - (coarse - Math.floor(coarse))) * 6;
      if (py < 16 || py > 72) continue;
      const vv = ((val % 100) + 100) % 100;
      g.fillRect(100, py, vv % 5 === 0 ? 18 : 11, 1);
      if (vv % 5 === 0) { g.textAlign = 'left'; g.fillText(String(vv), 122, py + 3.5); }
    }
    g.fillStyle = '#dc2626'; g.fillRect(100, 43.5, 70, 1.2);
    g.fillStyle = '#94a3b8'; g.textAlign = 'center'; g.font = '11px "Microsoft YaHei"'; g.fillText('读数窗 0.01', 135, 88);
    // 微动鼓轮（0.0001 mm）
    const fine = (x * 10000) % 100;
    g.fillStyle = '#d4d4d8'; g.fillRect(182, 14, 80, 60);
    g.fillStyle = '#111'; g.font = '10px Arial';
    for (let k = -6; k <= 6; k++) {
      const val = Math.floor(fine) + k;
      const py = 44 + (k - (fine - Math.floor(fine))) * 4.6;
      if (py < 16 || py > 72) continue;
      const vv = ((val % 100) + 100) % 100;
      g.fillRect(182, py, vv % 5 === 0 ? 20 : 12, 1);
      if (vv % 10 === 0) { g.textAlign = 'left'; g.fillText(String(vv), 206, py + 3.5); }
    }
    g.fillStyle = '#dc2626'; g.fillRect(182, 43.5, 80, 1.2);
    g.fillStyle = '#94a3b8'; g.textAlign = 'center'; g.font = '11px "Microsoft YaHei"'; g.fillText('鼓轮 0.0001', 222, 88);
    if (this.showAssist) {
      g.fillStyle = '#a7f3d0'; g.font = '12px Consolas'; g.textAlign = 'left';
      g.fillText(`读数 = ${mm} + ${(Math.floor(coarse) / 100).toFixed(2)} + ${(fine / 10000).toFixed(5)} = ${x.toFixed(5)} mm`, 8, 108);
    }
    g.restore();
    v.foot(this.showAssist ? '' : '估读到微动鼓轮最小分度的 1/10');
  }

  globalControls() {
    return [
      { type: 'readout', label: '条纹计数器（相对清零点）', get: () => { const n = Math.round(this.N); return `${n >= 0 ? '+' : ''}${n} 条 ${n > 0 ? '(冒出)' : n < 0 ? '(缩进)' : ''}`; }, sub: '实际实验中需目视计数，这里作为辅助显示；d 增大时圆环从中心“冒出”。' },
      { type: 'button', label: '计数清零', onClick: () => { this.zeroD = this.d; this.app.toast('计数器已清零', 'ok'); } },
      { type: 'toggle', label: '显示读数辅助', get: () => this.showAssist, set: (v) => (this.showAssist = v) },
    ];
  }

  tables() {
    return [{
      id: 'm', title: '条纹计数与 M₁ 位置',
      columns: [
        { key: 'N', label: '条纹变化数 N', digits: 0 },
        { key: 'x', label: 'M₁ 位置读数 d/mm', digits: 5 },
        { key: 'dd', label: '相邻差 Δd/mm', digits: 5, calc: (r, i, rows) => (i > 0 && rows[i - 1].x != null ? Math.abs(r.x - rows[i - 1].x) : NaN) },
      ],
      buttons: [{
        label: '记录当前 N 与 M₁ 读数', onClick: (t) => {
          if (!this.app.comp('expander').placed || !this.laserOn) { this.app.toast('请先调出干涉圆环', 'warn'); return; }
          if (this.white) { this.app.toast('白光的相干长度只有几微米，离开零光程就看不到条纹：测波长请换回激光', 'warn'); return; }
          const N = Math.round(this.N);
          if (Math.abs(Math.abs(this.drive - this.mirror) - BACKLASH / 2) > 1e-7 || this.travel < BACKLASH) this.app.toast('注意：手轮刚换向，空程尚未消除，读数与条纹变化不对应！', 'warn');
          const read = Math.round((this.drive + gauss(0.000006)) * 1e5) / 1e5;
          t.addRow({ N, x: read });
        },
      }],
      note: '先沿一个方向转动微动手轮消除空程，再将计数清零。之后每冒出（或缩进）50 个条纹记录一次，连续记录 10 次。',
    }];
  }

  steps() {
    const app = this.app;
    return [
      {
        title: '摆放激光器与观察屏',
        html: '<p>把 <b>He-Ne 激光器</b>放在干涉仪分光板 G₁ 的入射一侧（左侧），把<b>观察屏</b>放在出射一侧（前方）。</p>',
        check: () => app.comp('laser').placed && app.comp('screen').placed,
        auto: async () => { await app.view('全景'); await app.autoPlace('laser'); await app.autoPlace('screen'); },
      },
      {
        title: '打开激光器，使光束入射分光板中心',
        html: '<p>打开激光电源。激光束经 G₁ 分成两束，分别射向 M₁、M₂，反射后在观察屏上形成<b>两组光点</b>。</p><p style="color:#fca5a5">⚠ 实验中切勿用眼睛直视激光束。</p>',
        check: () => this.laserOn && this.optics().bsOff < 1.0,
        status: () => { const o = this.optics(); return !this.laserOn ? '激光器未打开' : o.bsOff === Infinity ? '光束没有打到分光板上：转动或移动激光器' : `光束在分光板上偏离中心 <b>${(o.bsOff * 10).toFixed(1)} mm</b>（需 &lt; 10 mm）`; },
        auto: async () => {
          app.select(app.comp('laser')); this.laserOn = true; app.changed(); await app.wait(600);
          if (this.optics().bsOff >= 1.0) await app.alignTo('laser');
        },
      },
      {
        title: '粗调：使两组光点重合',
        html: '<p>屏上两组光点分别来自 M₁ 和 M₂（每组有几个较弱的次级反射点）。调节 <b>M₂ 背后的粗调螺钉</b>，使两组中<b>最亮的两个光点完全重合</b>，此时 M₁ 与 M₂ 大致垂直。</p>',
        hint: '选中“定镜 M₂”，分别调节水平、竖直粗调螺钉，观察屏上 M₂ 光点的移动方向。',
        check: () => this.optics().sep < 0.5,
        status: () => { const s = this.optics().sep; return s === Infinity ? '屏上没有同时看到两组光点' : `光点间距：<b>${s.toFixed(2)} mm</b>（需 &lt; 0.5 mm）`; },
        auto: async () => {
          await app.view('观察屏');
          app.select(app.comp('m2'));
          await app.tween(() => this.eps.x, (v) => (this.eps.x = v), rand(0.15, 0.3) * Math.sign(this.eps.x || 1), 1400);
          await app.tween(() => this.eps.y, (v) => (this.eps.y = v), rand(0.12, 0.25) * Math.sign(this.eps.y || 1), 1400);
        },
      },
      {
        title: '放入扩束镜，观察干涉条纹',
        html: '<p>在激光器与干涉仪之间放入<b>扩束镜</b>，激光变为发散的球面波，屏上出现干涉条纹。由于 M₂ 尚未精确垂直于 M₁，条纹可能是弯曲的或圆心偏在一边。</p>',
        check: () => app.comp('expander').placed && this.optics().fringe,
        status: () => {
          if (!app.comp('expander').placed) return '';
          const e = this.optics().exp;
          if (!e || !e.aim) return '激光没有射入扩束镜：把扩束镜放到激光束上';
          return `扩束镜光轴与激光夹角 <b>${((e.aim.ang * 180) / Math.PI).toFixed(1)}°</b>，偏离光束 <b>${(e.rho * 10).toFixed(1)} mm</b>`;
        },
        auto: async () => { await app.autoPlace('expander'); await app.wait(600); },
      },
      {
        title: '细调：得到圆心居中的等倾干涉圆环',
        html: '<p>缓慢调节 M₂ 底座上的<b>水平、竖直拉簧微调螺钉</b>，使干涉条纹成为圆环，并使圆心移到视场中央。</p>',
        hint: '圆心偏向哪一侧，就朝使圆环向视场中心移动的方向微调；越接近中心，越要慢。',
        check: () => this.ringCenter().r < 4,
        status: () => { const c = this.ringCenter(); return `圆心偏离视场中心：<b>${c.r > 999 ? '很远' : c.r.toFixed(1) + ' mm'}</b>（需 &lt; 4 mm）`; },
        auto: async () => {
          app.select(app.comp('m2'));
          await app.tween(() => this.eps.x, (v) => (this.eps.x = v), gauss(0.004), 1600);
          await app.tween(() => this.eps.y, (v) => (this.eps.y = v), gauss(0.004), 1600);
        },
      },
      {
        title: '消除空程，计数清零',
        html: '<p>选中“动镜 M₁ 与测微手轮”，<b>沿一个方向</b>转动微动手轮，观察到条纹开始连续地从中心“冒出”或向中心“缩进”后（空程已消除），点击右侧「计数清零」。</p><p>此后测量中<b>只能沿该方向</b>转动微动手轮。</p>',
        hint: '空程（回程差）来自丝杠与螺母之间的间隙：换向时手轮转动了，但 M₁ 还没有移动。',
        check: () => this.travel > BACKLASH * 1.5 && Math.abs(this.N) < 1.5 && this.zeroSet,
        status: () => `同方向连续转动量：<b>${(this.travel * 1e4).toFixed(1)} 格</b>${this.travel > BACKLASH * 1.5 ? '（空程已消除，请计数清零）' : '（继续同向转动）'}`,
        auto: async () => {
          await app.view('手轮');
          app.select(app.comp('m1'));
          const dir = -Math.sign(this.d) || -1; // 使 |d| 减小：圆环缩进
          this.measDir = dir;
          await app.tween(() => this.drive, (v) => this.moveDrive(v), this.drive + dir * 0.0012, 1500);
          this.zeroD = this.d; this.zeroSet = true; app.changed();
          app.toast('计数器已清零', 'ok');
        },
      },
      {
        title: '测量：每变化 50 条记录一次',
        html: '<p>沿同一方向缓慢转动微动手轮，数圆环的变化个数。每<b>冒出（或缩进）50 个</b>条纹，记录一次 M₁ 的位置读数，连续记录 <b>10 次</b>（N = 0, 50, 100, …, 450）。</p>',
        hint: '读数 = 主尺读数 + 读数窗读数 + 微动鼓轮读数，微动鼓轮估读一位（单位 mm，保留到 10⁻⁵ mm）。',
        check: () => { const t = app.table('m'); const r = t.completeRows(); return r.length >= 10 && Math.abs(r[r.length - 1].N - r[0].N) >= 400; },
        status: () => `已记录 <b>${app.table('m').completeRows().length}</b> 组（需 10 组）`,
        auto: async () => {
          await app.view('观察屏');
          this.white = false;
          app.select(app.comp('m1'));
          const dir = this.measDir || Math.sign(this.lastDir) || -1;
          const t = app.table('m');
          const start = t.rows.length;
          for (let k = 0; k < 10; k++) {
            if (k > 0 || start > 0) {
              // 沿同一方向转动微动手轮，使条纹再变化 50 条（N 随 M1 位移单调变化）
              const goal = Math.round(this.N) + 50 * dir;
              const dMirror = ((goal - this.N) * LAMBDA) / 2 + (gauss(0.05) * LAMBDA) / 2;
              await app.tween(() => this.drive, (v) => this.moveDrive(v), this.drive + dMirror, 1800);
            }
            await app.record('m');
          }
        },
      },
      {
        title: '数据处理：逐差法求波长',
        html: '<p>动镜移动 $\\Delta d$ 时，中心处光程差改变 $2\\Delta d$，条纹变化 $\\Delta N$ 个：</p>$$\\lambda=\\frac{2\\Delta d}{\\Delta N}$$<p>用逐差法（前 5 个与后 5 个对应相减，$\\Delta N=250$）或作 $d$–$N$ 直线拟合求 $\\lambda$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
      {
        title: '白光干涉：寻找零光程位置',
        html: '<p>用<b>粗动手轮</b>使 M₁ 向等光程位置移动：激光圆环不断缩进、变粗、变少。当视场内只剩一两个很粗的环时，略微调偏 M₂ 的微调螺钉，使条纹变成<b>直条纹</b>。</p><p>把光源切换为<b>白光</b>，缓慢转动<b>微动手轮</b>，直到屏上出现<b>彩色直条纹</b>：中央的白色条纹就是零光程（$d=0$）位置。</p>',
        hint: '白光条纹只在 |2d| 小于约 2 µm 的范围内可见，对应微动手轮约 10 格：离开太远时视场是均匀的白色，要耐心地慢慢转。',
        check: () => this.white && this.laserOn && this.optics().fringe && Math.abs(this.d) < 0.0005,
        status: () => !this.white ? '光源还是激光：请切换为白光' : this.optics().fringe && Math.abs(this.d) < 0.0005 ? '屏上已出现彩色条纹' : '屏上还没有彩色条纹',
        auto: async () => {
          await app.view('观察屏');
          app.select(app.comp('m1'));
          this.white = false; app.changed();
          const dir = -Math.sign(this.d) || -1, half = BACKLASH / 2;
          // 先用粗动手轮快速靠近（M₁ 停在离等光程约 5 µm 处），再用微动手轮慢慢找
          await app.tween(() => this.drive, (v) => this.moveDrive(v), this.m0 - dir * 0.005 + dir * half, 2200);
          app.select(app.comp('m2'));
          await app.tween(() => this.eps.x, (v) => (this.eps.x = v), 0.22 * (Math.sign(this.eps.x) || 1), 1000);
          app.select(app.comp('laser')); this.white = true; app.changed(); await app.wait(500);
          app.select(app.comp('m1'));
          await app.tween(() => this.drive, (v) => this.moveDrive(v), this.m0 + dir * 0.0001 + dir * half, 2600);
        },
      },
    ];
  }

  analyze() {
    const t = this.app.table('m');
    const rows = t.completeRows();
    if (rows.length < 4) return { html: '<p>至少需要 4 组数据（建议 10 组）。</p>', ok: false };
    const Ns = rows.map((r) => r.N), xs = rows.map((r) => r.x);
    const fit = linFit(Ns, xs);
    const lamFit = 2 * Math.abs(fit.k) * 1e6, uFit = 2 * fit.uk * 1e6;
    let html = '';
    let lamSD = null;
    if (rows.length >= 6 && rows.length % 2 === 0) {
      const m = rows.length / 2;
      const items = [];
      for (let i = 0; i < m; i++) {
        const dd = Math.abs(xs[i + m] - xs[i]), dN = Math.abs(Ns[i + m] - Ns[i]);
        items.push({ dd, dN, lam: (2 * dd) / dN * 1e6 });
      }
      const lams = items.map((x) => x.lam);
      const lm = mean(lams), ua = uA(lams);
      const ub = (Math.sqrt(2) * 0.00001 / Math.sqrt(3)) * 2 / items[0].dN * 1e6; // 读数估读误差
      const ubN = lm / items[0].dN / Math.sqrt(3); // 计数 ±1 条
      const u = Math.sqrt(ua ** 2 + ub ** 2 + ubN ** 2);
      lamSD = lm;
      html += `<h3>逐差法</h3><table><tr><th>i</th><th>|d<sub>i+${m}</sub>−d<sub>i</sub>| /mm</th><th>ΔN</th><th>λ<sub>i</sub> /nm</th></tr>${items.map((it, i) => `<tr><td>${i + 1}</td><td>${it.dd.toFixed(5)}</td><td>${it.dN}</td><td>${it.lam.toFixed(1)}</td></tr>`).join('')}</table>
      <p>$\\bar\\lambda=${lm.toFixed(1)}$ nm，$u_A=${sig(ua, 2)}$ nm，读数 B 类 $u_{B1}=${sig(ub, 2)}$ nm，计数误差 $u_{B2}=${sig(ubN, 2)}$ nm</p>
      <div class="result-box">$\\lambda = ${texU(lm, u, 'nm')}$</div>`;
    }
    html += `<h3>图线法（最小二乘拟合）</h3><p>以条纹变化数 $N$ 为横轴、M₁ 位置 $d$ 为纵轴作图，斜率 $k=\\lambda/2$：</p>
      <p>$k=${(Math.abs(fit.k) * 1e4).toFixed(5)}\\times10^{-4}$ mm/条，相关系数 $r=${fit.r.toFixed(6)}$，$\\lambda=2|k|=${texU(lamFit, uFit, 'nm')}$</p>
      <div class="plot-wrap"><canvas data-plot="0" style="height:300px"></canvas></div>`;
    const ref = LAMBDA * 1e6;
    const best = lamSD ?? lamFit;
    html += `<div class="result-box warn">He-Ne 激光波长标准值 λ₀ = ${ref.toFixed(1)} nm，本次测量相对误差 ${pct(relErr(best, ref))}。</div>`;
    const plots = [{
      title: 'M₁ 位置 d 与条纹变化数 N 的关系', xLabel: '条纹变化数 N', yLabel: 'd /mm',
      series: [
        { type: 'scatter', data: Ns.map((n, i) => [n, xs[i]]), color: '#f87171', label: '实验数据' },
        { type: 'line', data: lineData(fit.k, fit.b, Math.min(...Ns), Math.max(...Ns)), color: '#38bdf8', label: `拟合直线 斜率 ${(fit.k * 1e4).toFixed(4)}×10⁻⁴ mm/条` },
      ],
    }];
    return { html, plots, ok: true, answers: [{ label: '激光波长 $\lambda$', unit: 'nm', value: best, alts: [lamFit], digits: 1 }] };
  }

  principle() {
    return `<h3>1. 仪器结构</h3><p>光源发出的光被分光板 G₁ 分为强度相近的两束：一束经补偿板 G₂ 射向动镜 M₁，另一束射向定镜 M₂，两束光反射后在 G₁ 处重新会合发生干涉。M₂ 经 G₁ 所成的虚像 M₂′ 与 M₁ 构成一个厚度为 $d$ 的“空气薄膜”。</p>
${FIG.michelsonLayout()}
<h3>2. 等倾干涉</h3><p>当 M₁ 与 M₂′ 严格平行时，倾角为 $\\theta$ 的光线两束光的光程差为</p>$$\\Delta=2d\\cos\\theta$$
<p>相同倾角对应同一级条纹，因此在屏上形成同心圆环。圆心处 $\\theta=0$，光程差最大，满足 $2d=k\\lambda$ 时为亮点。</p>
${FIG.michelsonFilm()}
<h3>3. 测量波长</h3><p>M₁ 移动 $\\Delta d$，中心处每“冒出”或“缩进”一个条纹，光程差改变 $\\lambda$：</p>$$\\lambda=\\frac{2\\Delta d}{\\Delta N}$$
<p>$d$ 增大时条纹从中心冒出且变密；$d$ 减小时条纹向中心缩进且变疏。</p>
<h3>4. 本仿真的计算模型</h3><p>扩束镜把激光会聚成点光源 S，经 M₁、M₂ 反射后等效为屏后两个相干虚点光源 S₁、S₂，它们沿轴相距 $2d$，M₂ 的倾角 $\\varepsilon$ 使 S₂ 横向偏移 $\\delta=2\\varepsilon L$。程序对屏上每一点精确计算</p>$$\\Delta=r_1-r_2=\\frac{r_1^2-r_2^2}{r_1+r_2},\\qquad I=I_0\\left[1+V\\cos\\frac{2\\pi\\Delta}{\\lambda}\\right]$$
<p>因此 M₂ 未调垂直时会自然出现弯曲条纹、直条纹或偏心圆环（圆心偏移 $\\delta R_0/2d$），与真实现象一致。丝杠传动包含 ${(BACKLASH * 1e4).toFixed(0)}$ 格空程，换向时 M₁ 不动而读数在变，用于体会“空程误差”。</p>
<h3>5. 白光干涉与零光程位置</h3><p>白光包含 400–700 nm 的连续光谱，各波长的条纹间距不同，只在光程差 $\\Delta\\approx 0$ 附近几个条纹内彼此对得上，形成彩色条纹；$|\\Delta|$ 超过几微米后各色条纹相互错开叠加，视场变为均匀的白色。屏上的颜色按</p>$$\\begin{pmatrix}R\\\\G\\\\B\\end{pmatrix}_{\\text{线性}}=\\sum_{\\lambda}\\boldsymbol w(\\lambda)\\left[1+V\\cos\\frac{2\\pi\\Delta}{\\lambda}\\right]$$<p>计算：$\\boldsymbol w(\\lambda)$ 由钨丝灯光谱（2850 K 黑体）乘 CIE 1931 色匹配函数换算到 sRGB 得到，并按光源白点归一。由于补偿板 G₂ 使两臂玻璃光程相同，各波长的零级条纹重合在 $d=0$ 处，零级条纹为白色（本仿真不计分光膜引入的附加相位差；若分光膜使两束光有 $\\pi$ 的附加相位差，零级条纹为黑色），两侧依次出现淡黄、褐、紫、蓝等颜色，与牛顿环的色序相同。实验中利用这一点确定等光程位置：先用激光使条纹变粗、变少（$d$ 很小），再换白光，用微动手轮缓慢寻找彩色条纹。</p>`;
  }
}
