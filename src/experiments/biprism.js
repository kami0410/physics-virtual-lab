// 实验：菲涅耳双棱镜干涉测钠光波长（分波前干涉 · 空间相干性 · 二次成像法测虚光源间距）
import * as THREE from 'three';
import { meta, thumb } from './biprism.meta.js';
import { GPU, GLSL } from '../core/gpu.js';
import { Component } from '../core/Component.js';
import { drawMicroReticle, drawMicroDrum } from '../core/Reticle.js';
import { AXIS_Y, MAT, mesh, labTable, opticalRail, carriage, lensMesh, lampHousing, glowSprite, ICONS, Beam, knobMesh } from '../core/Models.js';
import { mean, uA, texU, gauss, rand, relErr, pct, sig } from '../core/Stats.js';
import * as FIG from './figures.js';

const LINES = [[589.0e-6, 1], [589.6e-6, 0.5]];
const LAMBDA = 589.3e-6; // mm
const N_GLASS = 1.516;
const EYE_FOV = 10; // 测微目镜圆形视场直径 mm（0–8 mm 固定刻度完整可见）
const BACK = 0.015; // 测微目镜鼓轮空程 mm
const H_EFF = 3; // 对条纹有贡献的狭缝有效长度 mm（狭缝与棱脊不平行时的等效展宽）
const FR = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const BAND_FS = GLSL.lut + GLSL.band;

export class BiprismExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.alpha = rand(0.42, 0.6) * (Math.PI / 180); // 双棱镜折射角
    this.delta = (N_GLASS - 1) * this.alpha; // 每半棱镜的偏向角
    this.f = rand(16.5, 18) * 10; // 透镜焦距 mm（狭缝—棱镜约 22 cm、狭缝—目镜约 74 cm 时，放大像位置才落在棱镜之后，且 D > 4f）
    this.lampOn = false; this.warm = 0;
    this.w = 0.3; // 狭缝宽度 mm
    this.beta = rand(2, 4) * (Math.random() < 0.5 ? -1 : 1); // 狭缝取向 (°)
    this.gamma = rand(-0.5, 0.5); // 棱脊取向 (°)
    this.edge = rand(0.4, 0.8) * (Math.random() < 0.5 ? -1 : 1); // 棱脊横向偏离光轴 mm
    this.eyeOff = rand(-0.4, 0.4); // 测微目镜视场中心相对光轴 mm
    this.drive = 4 + rand(-1, 1); this.pos = this.drive; this.lastDir = 0; this.travel = 0; // 测微目镜鼓轮
    this.dioptZero = rand(-1.2, 1.2); this.diopt = 0;
    this.assist = !this.app.readSelf; // 自己读数时默认不显示读数辅助
  }

  // ---------------- 几何量 ----------------
  P(k) { const c = this.app.comp(k); return c.placed ? c.pos * 10 : null; } // mm

  /** 当前光路 → 光路设计台：狭缝当作点光源，双棱镜的两个半棱镜把它折成两个虚光源（像点自动标出），间距即 d */
  toBench({ done }) {
    const xs = this.P('slit'), xb = this.P('biprism');
    if (xs == null || xb == null || xb <= xs) return null;
    const a = xb - xs, H = 30, els = [];
    els.push({ type: 'point', x: 0, y: 0, rot: 0, cone: +((2.2 * Math.atan(H / 2 / a) * 180) / Math.PI).toFixed(2), n: 61, lam: 589.3 });
    els.push({ type: 'biprism', x: a, y: +this.edge.toFixed(3), alpha: +((this.alpha * 180) / Math.PI).toFixed(4), h: H, t: 2, mat: 'K9', secret: !done });
    const xe = this.P('eye');
    if (xe != null && xe > xb) els.push({ type: 'detector', x: xe - xs, y: 0, L: 30 });
    return {
      els, opts: { partial: false, images: true, ext: true },
      note: `来自“菲涅耳双棱镜测波长”：狭缝距双棱镜 ${(a / 10).toFixed(1)} cm。两个半棱镜把狭缝折成两个相距 d 的虚光源（标出的两个虚像，虚线是反向延长线），两束光在屏上重叠的区域就是干涉区。d ≈ 2a(n−1)α，条纹间距 Δx = Dλ/d。`,
    };
  }
  get a() { const s = this.P('slit'), b = this.P('biprism'); return s != null && b != null && b > s ? b - s : null; }
  get D() { const s = this.P('slit'), e = this.P('eye'); return s != null && e != null && e > s ? e - s : null; }
  get b() { return this.D != null && this.a != null ? this.D - this.a : null; }
  get d() { return this.a != null ? 2 * this.a * this.delta : null; }
  /** 光源亮度（预热、狭缝宽度） */
  get src() { const l = this.app.comp('lamp'), s = this.app.comp('slit'); return this.lampOn && l.placed && s.placed && l.pos < s.pos ? this.warm * Math.min(1, this.w / 0.08) * this.app.coaxT('eye') : 0; }
  get lensIn() { const L = this.app.comp('lens'); return L.placed && this.P('biprism') != null && this.P('eye') != null && L.pos * 10 > this.P('biprism') && L.pos * 10 < this.P('eye'); }
  /** 条纹衬比度：空间相干性（有效缝宽）× 钠双线（光程差很小，近似为 1） */
  get V() { return Math.abs(this.Vs); }
  /** 带符号的相干度：sin u/u < 0 时条纹亮暗反转 */
  get Vs() {
    if (this.a == null) return 0;
    const wEff = this.w + H_EFF * Math.abs(Math.sin(((this.beta - this.gamma) * Math.PI) / 180));
    // 到达观察点的两束光在棱镜平面上相距 d' = d(D−a)/D，对狭缝张角 d'/a
    const dp = this.D != null ? (this.d * (this.D - this.a)) / this.D : this.d;
    const u = (Math.PI * wEff * dp) / (LAMBDA * this.a);
    return Math.abs(u) < 1e-9 ? 1 : Math.sin(u) / u;
  }
  /** 临界缝宽 b_c = λaD / [d(D−a)] */
  get wc() { return this.D != null ? (LAMBDA * this.a * this.D) / (this.d * (this.D - this.a)) : (LAMBDA * this.a) / this.d; }
  get dx() { return (LAMBDA * this.D) / this.d; }
  /** 测微目镜视场中（相对光轴的横向坐标 X，mm）的光强 */
  intensity(X) {
    const S = this.src;
    if (!S || this.a == null || this.D == null || !this.app.comp('eye').placed) return 0;
    if (!this.app.comp('biprism').placed) return 0.35 * S;
    const xc = (this.edge * this.D) / this.a, half = this.delta * this.b;
    const soft = (t) => 0.5 + 0.5 * Math.tanh(t / 0.06);
    const I1 = soft(X - (xc - half)), I2 = soft(xc + half - X); // 两束光各自照亮的区域
    // 两半棱镜的厚度差使零级条纹落在狭缝与棱脊的连线上（X = xc），而不是光轴上
    const ph = (2 * Math.PI * this.d * (X - xc)) / (LAMBDA * this.D);
    let fr = 0;
    for (const [lam, wt] of LINES) fr += wt * Math.cos((ph * LAMBDA) / lam);
    fr /= 1.5;
    return S * 0.5 * (I1 + I2 + 2 * Math.sqrt(I1 * I2) * this.Vs * fr);
  }
  /** 透镜成像：两个虚光源的像（中心位置与模糊宽度），相对光轴 */
  images() {
    if (!this.lensIn || this.d == null) return null;
    const u = this.app.comp('lens').pos * 10 - this.P('slit'), s = this.P('eye') - this.app.comp('lens').pos * 10;
    const v = 1 / (1 / this.f - 1 / u);
    const m = s / u; // 主光线放大率（像倒立，符号不影响间距）
    const blur = v > 0 ? (4 * Math.abs(s - v)) / v : 4; // 有效孔径约 4 mm
    const wImg = this.w * m;
    return { m, blur, wImg, xs: [(-this.d / 2) * -m, (this.d / 2) * -m].map((x) => x + this.edge * 0), sharp: Math.abs(s - v) < 3, v, s, u };
  }
  eyeX(drive = this.pos) { return drive - 4 + this.eyeOff; } // 叉丝所在处的 X

  cameras() {
    return [
      { name: '全景', pos: [60, 70, 125], target: [60, 18, 0] },
      { name: '狭缝与棱镜', pos: [22, 34, 40], target: [25, 22, 0] },
      { name: '测微目镜', pos: [80, 36, 40], target: [100, 20, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(230, 80); t.position.set(60, 0, 0); scene.add(t);
    scene.add(opticalRail(120));
    app.addRail({ origin: new THREE.Vector3(0, 0, 0), min: 0, max: 120 });
    app.stage.setLightTarget(60, 0, 0);

    const lc = carriage(0x9aa3b2, AXIS_Y - 4);
    const lh = lampHousing(0xffc21a, 9, 12); lh.group.position.y = 4; lc.top.add(lh.group);
    this.lampGlow = lh.glowMat;
    this.lampSprite = glowSprite(0xffb800, 12); this.lampSprite.position.set(7.5, 4, 0); this.lampSprite.visible = false; lc.top.add(this.lampSprite);
    app.addComponent(new Component({
      key: 'lamp', name: '钠光灯', icon: ICONS.sodium, zone: 'rail', defaultPos: 4, required: true, object: lc.group, labelY: 34,
      desc: '低压钠灯（589.0/589.6 nm），预热后亮度稳定。',
      controls: () => [{ type: 'toggle', label: '电源开关', get: () => this.lampOn, set: (v) => (this.lampOn = v) }, { type: 'readout', label: '预热', get: () => (this.lampOn ? `${Math.round(this.warm * 100)}%` : '未开灯') }],
    }));

    const sc = carriage(0x9aa3b2, AXIS_Y);
    const sg = new THREE.Group();
    sg.add(mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.8, 32), MAT.dark()).rotateZ(Math.PI / 2));
    this.slitBlades = new THREE.Group();
    this.slitBlades.add(mesh(new THREE.BoxGeometry(0.3, 3.6, 1.2), MAT.chrome(), -0.5, 0, -0.75), mesh(new THREE.BoxGeometry(0.3, 3.6, 1.2), MAT.chrome(), -0.5, 0, 0.75));
    sg.add(this.slitBlades);
    const sk = knobMesh(0.8, 1.8); sk.position.set(0, 3.8, 0); sg.add(sk);
    sc.top.add(sg);
    app.addComponent(new Component({
      key: 'slit', name: '可调狭缝', icon: ICONS.slit, zone: 'rail', defaultPos: 14, required: true, object: sc.group, labelY: 30,
      desc: '狭缝宽度可由螺旋调节，狭缝架可绕光轴转动。',
      controls: () => [
        { type: 'knob', label: '狭缝宽度', get: () => this.w, set: (v) => (this.w = v), min: 0.005, max: 1, step: 0.002, bigStep: 0.02, perRev: 0.2, digits: 3, unit: 'mm', sub: '窄则条纹清晰但视场变暗' },
        { type: 'knob', label: '狭缝架转角（绕光轴）', get: () => this.beta, set: (v) => (this.beta = v), min: -10, max: 10, step: 0.02, bigStep: 0.5, perRev: 5, digits: 2, unit: '°', sub: '使狭缝与双棱镜棱脊平行' },
      ],
    }));

    const bc = carriage(0x9aa3b2, AXIS_Y);
    const bg = new THREE.Group();
    const shape = new THREE.Shape(); const th = 0.7, wd = 2.4;
    shape.moveTo(-th / 2, -wd); shape.lineTo(th / 2, 0); shape.lineTo(-th / 2, wd); shape.closePath();
    // 截面：平面朝向狭缝（−x），棱脊在 +x；沿 z 拉伸后转成竖直
    const pg = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false }); pg.translate(0, 0, -2); pg.rotateX(-Math.PI / 2);
    const prismMesh = new THREE.Mesh(pg, new THREE.MeshPhysicalMaterial({ color: 0xe5f0ff, transmission: 0.85, roughness: 0.03, transparent: true, opacity: 0.55, thickness: 0.6 }));
    this.prismHolder = new THREE.Group(); this.prismHolder.add(prismMesh);
    this.prismHolder.add(mesh(new THREE.BoxGeometry(1.2, 0.6, 5.4), MAT.dark(), 0, -2.3, 0));
    bg.add(this.prismHolder);
    const bk = knobMesh(0.8, 1.6); bk.position.set(0, -3.2, 3); bk.rotation.x = Math.PI / 2; bg.add(bk);
    bc.top.add(bg);
    app.addComponent(new Component({
      key: 'biprism', name: '菲涅耳双棱镜', icon: ICONS.biprism, zone: 'rail', defaultPos: 36, required: true, object: bc.group, labelY: 30,
      desc: '两个折射角很小（约 0.5°）的薄棱镜底边相接而成，棱脊竖直。可横向微调和绕光轴转动。',
      controls: () => [
        { type: 'knob', label: '横向微调（棱脊位置）', get: () => this.edge, set: (v) => (this.edge = v), min: -3, max: 3, step: 0.01, bigStep: 0.1, perRev: 1, digits: 2, unit: 'mm', sub: '使棱脊对准狭缝，条纹区位于视场中央' },
        { type: 'knob', label: '棱镜转角（绕光轴）', get: () => this.gamma, set: (v) => (this.gamma = v), min: -10, max: 10, step: 0.02, bigStep: 0.5, perRev: 5, digits: 2, unit: '°' },
      ],
    }));

    const fc = carriage(0x9aa3b2, AXIS_Y);
    const lm = lensMesh(4, 0.5); fc.top.add(lm);
    app.addComponent(new Component({
      key: 'lens', name: '凸透镜（二次成像用）', icon: ICONS.lens, zone: 'rail', defaultPos: 70, object: fc.group, labelY: 30,
      desc: '焦距约 17 cm。放在双棱镜与测微目镜之间，用于测量两虚光源的间距。',
    }));

    const ec = carriage(0x9aa3b2, AXIS_Y);
    const eg = new THREE.Group();
    eg.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 7, 28), MAT.black(), 2.2, 0, 0).rotateZ(Math.PI / 2));
    eg.add(mesh(new THREE.BoxGeometry(3, 4.4, 4.4), MAT.paint(0x4b5a53), -1.2, 0, 0));
    this.eyeDrum = mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.6, 36), MAT.chrome(), -1.2, 0, 3.2); this.eyeDrum.rotation.x = Math.PI / 2; eg.add(this.eyeDrum);
    ec.top.add(eg);
    app.addComponent(new Component({
      key: 'eye', name: '测微目镜', icon: ICONS.detector, zone: 'rail', defaultPos: 88, required: true, object: ec.group, labelY: 30,
      desc: '分划板上有 0–8 mm 固定刻度；转动鼓轮（1 圈 1 mm，100 分格）使叉丝横向移动，读数 = 固定刻度 + 鼓轮读数。',
      controls: () => [
        { type: 'knob', label: '目镜视度（看清叉丝）', get: () => this.diopt, set: (v) => (this.diopt = v), min: -3, max: 3, step: 0.05, bigStep: 0.5, perRev: 2, digits: 2, unit: 'D' },
        { type: 'knob', label: '测微鼓轮', get: () => this.drive, set: (v) => this.moveDrive(v), min: 0, max: 8, step: 0.002, bigStep: 0.05, perRev: 1, digits: 3, unit: 'mm', sub: '测量时始终沿同一方向转动' },
      ],
    }));

    this.beamA = new Beam(0xffc23a, 0.06, 0.5); this.beamB = new Beam(0xffc23a, 0.06, 0.5); this.beamC = new Beam(0xffc23a, 0.06, 0.5);
    [this.beamA, this.beamB, this.beamC].forEach((b) => scene.add(b.group));
    this.eyeView = app.addView({ id: 'eye', title: '测微目镜视场', w: 250, h: 250, res: 1.4 });
    this.readView = app.addView({ id: 'read', title: '固定刻度与鼓轮', w: 290, h: 100, res: 1.5 });
  }

  moveDrive(v) {
    const dv = v - this.drive;
    if (Math.abs(dv) < 1e-12) return;
    const dir = Math.sign(dv);
    if (dir !== this.lastDir) { this.travel = 0; this.lastDir = dir; }
    this.travel += Math.abs(dv);
    this.drive = v;
    const half = BACK / 2;
    if (this.drive - this.pos > half) this.pos = this.drive - half;
    if (this.pos - this.drive > half) this.pos = this.drive + half;
  }

  tick(dt) {
    if (this.lampOn && this.warm < 1) { this.warm = Math.min(1, this.warm + dt / 4); this.app.changed(); }
    if (!this.lampOn && this.warm > 0) { this.warm = 0; this.app.changed(); }
  }

  update() {
    const app = this.app;
    const on = this.lampOn && app.comp('lamp').placed;
    this.lampGlow.emissiveIntensity = on ? 3 * this.warm : 0;
    this.lampSprite.visible = on; this.lampSprite.material.opacity = this.warm;
    const gap = Math.min(0.6, this.w * 2);
    this.slitBlades.children[0].position.z = -0.6 - gap; this.slitBlades.children[1].position.z = 0.6 + gap;
    this.slitBlades.rotation.x = (this.beta * Math.PI) / 180 * 4;
    this.prismHolder.rotation.x = (this.gamma * Math.PI) / 180 * 4;
    this.prismHolder.position.z = this.edge * 0.3;
    this.eyeDrum.rotation.y = this.drive * Math.PI * 2;
    const V3 = (x) => app.coaxV(x, AXIS_Y); // 光束沿实际光路（未共轴时会偏离元件中心）
    const L = app.comp('lamp'), S = app.comp('slit'), B = app.comp('biprism'), E = app.comp('eye');
    if (on && S.placed && S.pos > L.pos) {
      this.beamA.set(V3(L.pos + 5), V3(S.pos), this.warm * 0.5);
      const end = B.placed && B.pos > S.pos ? B.pos : E.placed ? E.pos : 120;
      this.beamB.set(V3(S.pos), V3(end), this.src * 0.4);
      if (B.placed && E.placed && E.pos > B.pos) this.beamC.set(V3(B.pos), V3(E.pos), this.src * 0.4); else this.beamC.hide();
    } else { this.beamA.hide(); this.beamB.hide(); this.beamC.hide(); }
    this.drawEye();
    this.drawRead();
  }

  drawEye() {
    const v = this.eyeView, g = v.ctx, W = v.W, H = v.H;
    const pxmm = W / EYE_FOV;
    const imgs = this.images();
    const sig2 = imgs ? Math.max(0.01, imgs.wImg / 2 + imgs.blur / 2) : 0;
    const at = (X) => {
      if (!imgs) return this.intensity(X);
      let I = 0;
      for (const xc of imgs.xs) I += Math.exp(-(((X - xc) / sig2) ** 2)) * Math.min(1.4, 0.06 / sig2);
      return I * this.src;
    };
    const blurEye = Math.abs(this.diopt - this.dioptZero);
    const gain = 1.25 / Math.max(0.3, Math.sqrt(this.src)); // 人眼对暗视场有一定适应
    const yc = H / 2 - this.app.coaxOff('eye').y * 10 * pxmm; // 目镜光心与光束不等高时，亮带上下偏移
    let gpuDone = false;
    if (GPU.ok) {
      const sm = GPU.samples(v), pr = new Float32Array(sm.n);
      for (let j = 0; j < sm.n; j++) pr[j] = at((sm.x0 + (j + 0.5) * sm.step - W / 2) / pxmm + this.eyeOff);
      gpuDone = GPU.paint(v, 'band', BAND_FS, { uProf: { tex: pr }, uX0: sm.x0, uStep: sm.step, uGain: gain, uH: H, uYc: yc });
    }
    if (!gpuDone) {
    const img = g.createImageData(W, H);
    const prof = new Float32Array(W);
    for (let i = 0; i < W; i++) prof[i] = at((i - W / 2) / pxmm + this.eyeOff);
    for (let y = 0; y < H; y++) {
      const vy = 1 - ((y - yc) / (H * 0.62)) ** 2;
      for (let i = 0; i < W; i++) {
        const val = Math.max(0, prof[i] * vy) * gain;
        const k = (y * W + i) * 4;
        img.data[k] = 255 * Math.min(1, val * 1.1); img.data[k + 1] = 190 * Math.min(1, val); img.data[k + 2] = 40 * Math.min(1, val); img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    }
    // 分划板：0–8 mm 固定刻度，十字叉丝与竖直双线随鼓轮移动；视度不对时分划板模糊
    drawMicroReticle(g, W, H, { pxmm, pos: this.pos, blur: blurEye });
    let foot = '';
    if (!this.src) foot = this.lampOn ? '视场很暗：检查光源和狭缝' : '视场黑暗：钠光灯未打开';
    else if (!this.app.comp('biprism').placed) foot = '未放双棱镜：均匀照明';
    else if (imgs) foot = `${imgs.sharp ? '两条狭缝像清晰' : '狭缝像模糊：移动透镜寻找成像位置'}${this.assist ? `（像距差 ${(imgs.s - imgs.v).toFixed(0)} mm）` : ''}`;
    else if (this.assist) foot = `条纹衬比度 ${(this.V * 100).toFixed(0)}% · 条纹区宽 ${(2 * this.delta * this.b).toFixed(1)} mm · 间距约 ${this.dx.toFixed(3)} mm`;
    v.foot(foot);
  }

  drawRead() {
    const v = this.readView, g = v.ctx, W = v.W;
    const sc = W / 290; g.save(); g.scale(sc, sc);
    drawMicroDrum(g, this.drive, this.assist);
    g.restore();
  }

  globalControls() {
    return [{ type: 'toggle', label: '显示读数与衬比度辅助', get: () => this.assist, set: (v) => (this.assist = v) }];
  }

  tables() {
    return [
      {
        id: 'fr', title: '暗纹位置', fixedRows: true,
        initRows: () => FR.map((n) => ({ n })),
        columns: [{ key: 'n', label: '暗纹序号', digits: 0, readonly: true }, { key: 'x', label: '位置 x/mm', digits: 3 }],
        buttons: [{ label: '记录读数到下一格', onClick: (t) => this.recFringe(t) }],
        note: '叉丝沿同一方向移动，依次对准相邻 10 条暗纹中央记录。',
      },
      {
        id: 'pos', title: '光具座读数', fixedRows: true,
        initRows: () => [{ what: '狭缝' }, { what: '测微目镜分划板' }],
        columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'x', label: '导轨读数 /cm', digits: 2 }],
        buttons: [{ label: '读取两者的导轨位置', onClick: (t) => { if (!this.app.comp('slit').placed || !this.app.comp('eye').placed) return this.app.toast('狭缝或测微目镜不在导轨上', 'warn'); t.set(0, 'x', Math.round(this.app.comp('slit').pos * 100) / 100); t.set(1, 'x', Math.round(this.app.comp('eye').pos * 100) / 100); } }],
        note: 'D = 测微目镜分划板到狭缝的距离。',
      },
      {
        id: 'img', title: '虚光源的像', fixedRows: true,
        initRows: () => [{ what: '放大像' }, { what: '缩小像' }],
        columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'x1', label: '像 1 位置/mm', digits: 3 }, { key: 'x2', label: '像 2 位置/mm', digits: 3 }, { key: 'dd', label: '间距/mm', digits: 3, calc: (r) => Math.abs(r.x2 - r.x1) }],
        buttons: [{ label: '记录读数到下一格', onClick: (t) => this.recImage(t) }],
        note: '透镜移到成放大像的位置，叉丝依次对准两条狭缝像记录；再移到成缩小像的位置重复。d = √(d₁d₂)。',
      },
    ];
  }

  readNow() { return Math.round((this.drive + gauss(0.0015)) * 1000) / 1000; }
  recFringe(t) {
    const i = t.rows.findIndex((r) => r.x == null);
    if (i < 0) return this.app.toast('表格已记录完整', 'ok');
    if (this.lensIn) return this.app.toast('光路中有透镜，看不到干涉条纹', 'warn');
    if (!this.src || this.V < 0.25) return this.app.toast('看不到清晰的干涉条纹', 'warn');
    const xc = (this.edge * this.D) / this.a, half = this.delta * this.b;
    const X = this.eyeX(), ph = (this.d * (X - xc)) / (LAMBDA * this.D) - 0.5; // 暗纹处 ph 为整数
    if (Math.abs(ph - Math.round(ph)) > 0.15) this.app.toast('叉丝没有对准暗纹中央', 'warn');
    if (Math.abs(X - xc) > half * 0.95) this.app.toast('叉丝已移出条纹区', 'warn');
    if (this.lastDir < 0 || this.travel < BACK) this.app.toast('注意：鼓轮刚换向，读数含空程误差', 'warn');
    t.set(i, 'x', this.readNow());
  }
  recImage(t) {
    const im = this.images();
    if (!im) return this.app.toast('请先在双棱镜和测微目镜之间放入凸透镜', 'warn');
    const r = im.m > 1 ? 0 : 1;
    const row = t.rows[r];
    const key = row.x1 == null ? 'x1' : row.x2 == null ? 'x2' : null;
    if (!key) return this.app.toast(`${row.what}已经记录过`, 'warn');
    if (!im.sharp) this.app.toast('狭缝像不清晰：透镜不在成像位置', 'warn');
    const X = this.eyeX();
    const near = im.xs.reduce((a, c) => (Math.abs(c - X) < Math.abs(a - X) ? c : a));
    if (Math.abs(near - X) > Math.max(0.02, im.wImg)) this.app.toast('叉丝没有对准狭缝像中央', 'warn');
    if (Math.abs(near) > EYE_FOV / 2 - 0.2) this.app.toast('像在视场边缘之外', 'warn');
    t.set(r, key, this.readNow());
  }

  /** 等高共轴调节：光路顺序、光束与各元件通光孔（cm） */
  coaxSpec() {
    return {
      keys: ['lamp', 'slit', 'biprism', 'lens', 'eye'],
      beam: { lamp: { w: 2, div: 0 }, slit: { w: 0.05, div: 0.02 } },
      ap: { slit: { y: 0.5, z: Infinity }, biprism: { y: 1.0, z: 1.0 }, lens: { y: 1.5, z: 1.5 }, eye: { y: 0.3, z: 0.4 } },
      axes: { lamp: 'y', slit: 'yz', biprism: 'yza', lens: 'yza', eye: 'yz' },
    };
  }

  steps() {
    const app = this.app;
    const on = (k) => app.comp(k).placed;
    const xc = () => (this.edge * this.D) / this.a;
    const toX = (X) => X + 4 - this.eyeOff; // 叉丝对准 X 时的鼓轮读数（不含空程）
    return [
      {
        title: '在光具座上放置光源、狭缝、双棱镜和测微目镜',
        html: '<p>按 <b>钠光灯 → 狭缝 → 双棱镜 → 测微目镜</b> 放置。狭缝紧靠钠灯，双棱镜距狭缝约 20 cm，测微目镜距狭缝 60 cm 以上。透镜暂不放入。</p>',
        check: () => ['lamp', 'slit', 'biprism', 'eye'].every(on) && !on('lens') && this.a > 120 && this.a < 350 && this.D > 550,
        status: () => (this.a ? `狭缝–双棱镜 a = <b>${(this.a / 10).toFixed(1)} cm</b>${this.D ? `，狭缝–目镜 D = <b>${(this.D / 10).toFixed(1)} cm</b>` : ''}` : ''),
        auto: async () => { await app.view('全景'); for (const [k, x] of [['lamp', 4], ['slit', 14], ['biprism', 36], ['eye', 88]]) await app.autoPlace(k, { pos: x }); },
      },
      {
        title: '打开钠光灯，调节目镜看清叉丝',
        html: '<p>打开钠光灯并预热；调节测微目镜的视度，看清分划板上的刻度和叉丝。</p>',
        check: () => this.lampOn && this.warm > 0.95 && Math.abs(this.diopt - this.dioptZero) < 0.12,
        auto: async () => {
          app.select(app.comp('lamp')); this.lampOn = true; app.changed();
          app.select(app.comp('eye')); await app.tween(() => this.diopt, (v) => (this.diopt = v), this.dioptZero + gauss(0.03), 1000);
          while (this.warm < 0.97) await app.wait(200, true);
        },
      },
      {
        title: '共轴：使条纹区位于视场中央',
        html: '<p>把狭缝开大些，在目镜中看到双棱镜两半造成的两块亮区。<b>横向微调双棱镜</b>，使两块亮区的重叠部分（条纹区）位于视场中央。</p>',
        check: () => this.a && Math.abs(xc() - this.eyeOff) < 0.4,
        status: () => (this.a ? `条纹区中心偏离视场中心 <b>${(xc() - this.eyeOff).toFixed(2)} mm</b>` : ''),
        auto: async () => {
          await app.view('狭缝与棱镜'); app.select(app.comp('biprism'));
          await app.tween(() => this.edge, (v) => (this.edge = v), (this.eyeOff * this.a) / this.D + gauss(0.01), 1200);
        },
      },
      {
        title: '调出清晰的干涉条纹',
        html: '<p>边看目镜边<b>缓慢减小狭缝宽度</b>，并<b>转动狭缝架</b>使狭缝与棱脊平行，直到出现清晰的明暗直条纹。狭缝太宽或不平行时，各部分光源产生的条纹互相错开，衬比度下降。</p>',
        hint: '条纹衬比度近似为 |sin u / u|，u = π·b_eff·d(D−a)/(λaD)。b_eff 包含缝宽和不平行造成的展宽。',
        check: () => this.V > 0.6 && this.src > 0.15,
        status: () => `条纹衬比度 <b>${(this.V * 100).toFixed(0)}%</b>，视场亮度 <b>${(this.src * 100).toFixed(0)}%</b>`,
        auto: async () => {
          app.select(app.comp('slit'));
          await app.tween(() => this.w, (v) => (this.w = v), 0.06, 1000);
          await app.tween(() => this.beta, (v) => (this.beta = v), this.gamma + gauss(0.04), 1500);
          const wc = this.wc;
          await app.tween(() => this.w, (v) => (this.w = v), Math.max(0.012, wc * 0.3), 900);
        },
      },
      {
        title: '测条纹间距 Δx',
        html: '<p>转动测微目镜鼓轮，叉丝从条纹区一侧<b>沿同一方向</b>移动，依次对准 10 条相邻暗纹的中央，记录读数。</p>',
        check: () => app.table('fr').completeRows().length >= 10,
        status: () => `已记录 <b>${app.table('fr').completeRows().length}</b> / 10`,
        auto: async () => {
          await app.view('测微目镜'); app.select(app.comp('eye'));
          const t = app.table('fr'); app.showTable(app.tables.indexOf(t));
          const per = (LAMBDA * this.D) / this.d;
          const k0 = -5;
          const darkX = (k) => xc() + (k + 0.5) * per;
          await app.tween(() => this.drive, (v) => this.moveDrive(v), toX(darkX(k0)) - 0.1, 900);
          for (let i = 0; i < 10; i++) {
            await app.tween(() => this.drive, (v) => this.moveDrive(v), toX(darkX(k0 + i)) + BACK / 2 + gauss(0.002), 400);
            await app.record('fr');
          }
        },
      },
      {
        title: '记录狭缝与分划板的位置',
        html: '<p>读出狭缝和测微目镜在光具座上的位置，求出 $D$。</p>',
        check: () => app.table('pos').completeRows().length >= 2,
        auto: async () => { const t = app.table('pos'); app.showTable(app.tables.indexOf(t)); await app.record('pos'); },
      },
      {
        title: '二次成像法测虚光源间距 d',
        html: '<p>保持狭缝、双棱镜、测微目镜不动，在双棱镜与目镜之间放入<b>凸透镜</b>。移动透镜，找到在目镜中看到两条<b>清晰放大</b>狭缝像的位置，测两像的间距 $d_1$；再移动透镜找到<b>清晰缩小</b>像的位置，测间距 $d_2$。则 $d=\\sqrt{d_1d_2}$。</p>',
        hint: '要能两次成像，必须 D > 4f；而且成放大像时透镜离狭缝较近，必须仍在双棱镜之后——所以双棱镜要尽量靠近狭缝。像不在视场内时，可略微横向调整双棱镜。',
        check: () => app.table('img').completeRows().length >= 2,
        status: () => { const r = app.table('img').rows; return `放大像 ${r[0].x2 != null ? '已测' : '未测'}，缩小像 ${r[1].x2 != null ? '已测' : '未测'}`; },
        auto: async () => {
          const t = app.table('img'); app.showTable(app.tables.indexOf(t));
          await app.view('全景');
          const S = this.P('slit'), E = this.P('eye'), Dd = E - S;
          const root = Math.sqrt(Dd * Dd / 4 - Dd * this.f);
          for (const u of [Dd / 2 - root, Dd / 2 + root]) {
            const xL = (S + u) / 10;
            if (!on('lens')) await app.autoPlace('lens', { pos: xL + 2 });
            await app.moveTo('lens', xL + gauss(0.05), 1200);
            const im = this.images();
            if (!im) { app.toast('透镜不在双棱镜与测微目镜之间，无法二次成像：请让双棱镜更靠近狭缝或减小目镜距离', 'warn'); return; }
            app.select(app.comp('eye'));
            const xs = im.xs.slice().sort((p, q) => p - q);
            await app.tween(() => this.drive, (v) => this.moveDrive(v), toX(xs[0]) - 0.1, 700);
            for (const X of xs) { await app.tween(() => this.drive, (v) => this.moveDrive(v), toX(X) + BACK / 2 + gauss(0.003), 600); await app.record('img'); }
          }
        },
      },
      {
        title: '数据处理：求钠光波长',
        html: '<p>$$\\lambda=\\frac{d}{D}\\,\\Delta x=\\frac{\\sqrt{d_1d_2}}{D}\\,\\Delta x$$</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const fr = this.app.table('fr').rows.map((r) => r.x);
    const pos = this.app.table('pos').rows, im = this.app.table('img').rows;
    if (fr.some((x) => x == null)) return { html: '<p>暗纹位置还没有记录完整。</p>', ok: false };
    if (pos.some((r) => r.x == null) || im.some((r) => r.x1 == null || r.x2 == null)) return { html: '<p>还缺少导轨读数或虚光源像的数据。</p>', ok: false };
    const ds = [0, 1, 2, 3, 4].map((i) => Math.abs(fr[i + 5] - fr[i]) / 5);
    const dx = mean(ds), udx = Math.hypot(uA(ds), (0.004 * Math.SQRT2) / Math.sqrt(3) / 5);
    const D = Math.abs(pos[1].x - pos[0].x) * 10, uD = 2;
    const d1 = Math.abs(im[0].x2 - im[0].x1), d2 = Math.abs(im[1].x2 - im[1].x1);
    const d = Math.sqrt(d1 * d2), ud = d * 0.5 * Math.hypot(0.006 / d1, 0.006 / d2);
    const lam = (d * dx) / D, ul = lam * Math.hypot(ud / d, udx / dx, uD / D);
    const html = `<h3>条纹间距（逐差法）</h3><table><tr><th>i</th>${ds.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr><tr><td>(x<sub>i+5</sub>−x<sub>i</sub>)/5 /mm</td>${ds.map((v) => `<td>${v.toFixed(4)}</td>`).join('')}</tr></table>
      <p>$\\Delta x=${dx.toFixed(4)}$ mm，$u(\\Delta x)=${sig(udx, 2)}$ mm</p>
      <h3>虚光源间距</h3><p>$d_1=${d1.toFixed(3)}$ mm（放大像），$d_2=${d2.toFixed(3)}$ mm（缩小像），$d=\\sqrt{d_1d_2}=${d.toFixed(4)}$ mm；$D=${(D / 10).toFixed(2)}$ cm。</p>
      <div class="result-box">$\\lambda=\\dfrac{d}{D}\\Delta x=${texU(lam * 1e6, ul * 1e6, 'nm')}$</div>
      <div class="result-box warn">钠光平均波长 589.3 nm，相对误差 ${pct(relErr(lam, LAMBDA))}。本双棱镜折射角 ${(this.alpha * 180 / Math.PI).toFixed(2)}°，n = ${N_GLASS}，透镜焦距 ${(this.f / 10).toFixed(1)} cm；按几何关系 d 的理论值为 ${this.d.toFixed(4)} mm。</div>`;
    return { html, ok: true, plots: [], answers: [{ label: '钠光波长 $\lambda$', unit: 'nm', value: lam * 1e6, digits: 1, tolRel: 0.008 }] };
  }

  principle() {
    return `<h3>1. 分波前干涉</h3><p>双棱镜由两个折射角 $\\alpha$ 很小的薄棱镜组成。从狭缝 S 发出的光经上下两半棱镜折射后，好像从两个虚光源 $S_1$、$S_2$ 发出，二者相干，在重叠区产生干涉。每半棱镜的偏向角 $\\delta=(n-1)\\alpha$，虚光源间距 $d=2a(n-1)\\alpha$（$a$ 为狭缝到棱镜的距离）。</p>
${FIG.biprismFig()}
<h3>2. 条纹间距</h3>$$\\Delta x=\\frac{D}{d}\\lambda\\quad\\Rightarrow\\quad\\lambda=\\frac{d}{D}\\Delta x$$<p>$D$ 为虚光源（狭缝平面）到观察平面的距离。</p>
<h3>3. 空间相干性</h3><p>宽度为 $b$ 的缝光源可看成许多不相干的线光源，各自的条纹互相错开。条纹衬比度</p>$$V=\\left|\\frac{\\sin u}{u}\\right|,\\qquad u=\\frac{\\pi b d'}{\\lambda a},\\quad d'=d\\,\\frac{D-a}{D}$$<p>$d'$ 是到达同一观察点的两束光在棱镜平面上的间距（不是虚光源间距 $d$）。当 $b\\ge\\lambda a/d'$ 时条纹几乎消失。两半棱镜的厚度不同，零级条纹位于狭缝与棱脊的连线上，棱脊偏离光轴 $e$ 时零级移到 $eD/a$ 处。狭缝与棱脊不平行时，狭缝不同高度处的点相对棱脊横向错开，相当于缝宽增大，同样会使条纹模糊。</p>
<h3>4. 二次成像法</h3><p>物（两个虚光源）与像屏（分划板）间距 $D>4f$ 时，透镜有两个成像位置，放大率互为倒数，故 $d=\\sqrt{d_1d_2}$。</p>
<h3>5. 本仿真的计算模型</h3><p>程序由导轨上各元件的实际位置计算 $a$、$D$、虚光源间距和两光束重叠区，按双光束干涉叠加钠双线，用上式计算衬比度；透镜成像按高斯公式计算像距，离焦时像按几何光学展宽。</p>`;
  }
}
