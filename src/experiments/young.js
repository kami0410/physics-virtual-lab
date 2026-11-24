// 实验：杨氏双缝干涉（分波前干涉 · 光源宽度与空间相干性 · 条纹间距与 D 的线性关系 · 测未知双缝间距）
import * as THREE from 'three';
import { meta, thumb } from './young.meta.js';
import { GPU, GLSL } from '../core/gpu.js';
import { Component } from '../core/Component.js';
import { drawMicroReticle, drawMicroDrum } from '../core/Reticle.js';
import { AXIS_Y, MAT, mesh, labTable, opticalRail, carriage, lampHousing, glowSprite, ICONS, Beam, knobMesh } from '../core/Models.js';
import { linFit, mean, uA, texU, gauss, rand, relErr, pct, sig } from '../core/Stats.js';
import { lineData } from '../core/Plot.js';

const LINES = [[589.0e-6, 1], [589.6e-6, 0.5]];
const LAMBDA = 589.3e-6; // mm
const EYE_FOV = 10; // 测微目镜圆形视场直径 mm（0–8 mm 固定刻度完整可见）
const BACK = 0.015; // 鼓轮空程 mm
const H_EFF = 3; // 狭缝与双缝不平行时的等效展宽 mm
const N_SP = 5; // 每次测 6 条暗纹 = 5 个间距

const BAND_FS = GLSL.lut + GLSL.band;

export class YoungExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.lampOn = false; this.warm = 0;
    this.w = 0.4; // 单缝宽度 mm
    this.beta = rand(2, 5) * (Math.random() < 0.5 ? -1 : 1); // 单缝取向 (°)
    this.gamma = rand(-0.6, 0.6); // 双缝取向 (°)
    this.lat = rand(0.6, 1.2) * (Math.random() < 0.5 ? -1 : 1); // 双缝横向偏离光轴 mm
    this.plate = 'A';
    this.dA = rand(0.395, 0.405); this.aA = 0.08; // 标定双缝
    this.dB = rand(0.27, 0.34); this.aB = 0.07; // 未知双缝
    this.eyeOff = rand(-0.3, 0.3);
    this.drive = 4 + rand(-1, 1); this.pos = this.drive; this.lastDir = 0; this.travel = 0;
    this.dioptZero = rand(-1.2, 1.2); this.diopt = 0;
    this.assist = !this.app.readSelf; // 自己读数时默认不显示读数辅助
    this.Ds = new Set(); // 已测过的 D
  }

  // ---------------- 几何量 ----------------
  P(k) { const c = this.app.comp(k); return c.placed ? c.pos * 10 : null; }
  get R() { const s = this.P('slit'), b = this.P('ds'); return s != null && b != null && b > s ? b - s : null; }
  get D() { const b = this.P('ds'), e = this.P('eye'); return b != null && e != null && e > b ? e - b : null; }
  get d() { return this.plate === 'A' ? this.dA : this.dB; }
  get a() { return this.plate === 'A' ? this.aA : this.aB; }
  get src() { const l = this.app.comp('lamp'), s = this.app.comp('slit'); return this.lampOn && l.placed && s.placed && l.pos < s.pos ? this.warm * Math.min(1, this.w / 0.1) * this.app.coaxT('eye') : 0; }
  /** 空间相干性：单缝等效宽度对双缝处两点的相干度 |sin u/u| */
  get V() { return Math.abs(this.Vs); }
  /** 带符号的相干度：sin u/u < 0 时条纹亮暗反转 */
  get Vs() {
    if (this.R == null) return 0;
    const wEff = this.w + H_EFF * Math.abs(Math.sin(((this.beta - this.gamma) * Math.PI) / 180));
    const u = (Math.PI * wEff * this.d) / (LAMBDA * this.R);
    return Math.abs(u) < 1e-9 ? 1 : Math.sin(u) / u;
  }
  get dx() { return (LAMBDA * this.D) / this.d; }
  /** 零级条纹在目镜处的横向位置（单缝—双缝中心连线的延长线） */
  get xc() { return this.R && this.D ? (this.lat * (this.R + this.D)) / this.R : 0; }
  intensity(X) {
    const S = this.src;
    if (!S || this.R == null || this.D == null || !this.app.comp('eye').placed) return 0;
    if (!this.app.comp('ds').placed) return 0.3 * S;
    const Xp = X - this.xc;
    const u = (Math.PI * this.a * Xp) / (LAMBDA * this.D);
    const env = Math.abs(u) < 1e-9 ? 1 : (Math.sin(u) / u) ** 2;
    let fr = 0;
    for (const [lam, wt] of LINES) fr += wt * Math.cos((2 * Math.PI * this.d * Xp) / (lam * this.D));
    fr /= 1.5;
    // 视场亮度随 D 增大而减弱（衍射光展开），人眼适应后只保留一部分差别
    const bright = S * Math.min(1.3, Math.pow(600 / this.D, 0.5));
    return bright * 0.5 * env * (1 + this.Vs * fr);
  }
  eyeX(drive = this.pos) { return drive - 4 + this.eyeOff; }

  cameras() {
    return [
      { name: '全景', pos: [60, 70, 125], target: [60, 18, 0] },
      { name: '单缝与双缝', pos: [16, 34, 38], target: [20, 22, 0] },
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
      key: 'slit', name: '可调单缝', icon: ICONS.slit, zone: 'rail', defaultPos: 12, required: true, object: sc.group, labelY: 30,
      desc: '作为线光源。缝宽由螺旋调节，狭缝架可绕光轴转动。',
      controls: () => [
        { type: 'knob', label: '单缝宽度', get: () => this.w, set: (v) => (this.w = v), min: 0.005, max: 1, step: 0.002, bigStep: 0.02, perRev: 0.2, digits: 3, unit: 'mm', sub: '窄则条纹清晰但视场变暗' },
        { type: 'knob', label: '狭缝架转角（绕光轴）', get: () => this.beta, set: (v) => (this.beta = v), min: -10, max: 10, step: 0.02, bigStep: 0.5, perRev: 5, digits: 2, unit: '°', sub: '使单缝与双缝平行' },
      ],
    }));

    const bc = carriage(0x9aa3b2, AXIS_Y);
    const bg = new THREE.Group();
    bg.add(mesh(new THREE.BoxGeometry(0.4, 6, 6), MAT.dark()));
    this.plateG = new THREE.Group();
    this.plateG.add(mesh(new THREE.BoxGeometry(0.15, 3.4, 3.4), MAT.glass(0xd9e6ee, 0.6), -0.3, 0, 0));
    this.slitMarks = [mesh(new THREE.BoxGeometry(0.05, 2.6, 0.08), MAT.emissive(0xfafaf0, 0.4), -0.4, 0, -0.25), mesh(new THREE.BoxGeometry(0.05, 2.6, 0.08), MAT.emissive(0xfafaf0, 0.4), -0.4, 0, 0.25)];
    this.slitMarks.forEach((m) => this.plateG.add(m));
    bg.add(this.plateG);
    const bk = knobMesh(0.8, 1.6); bk.position.set(0, -3.6, 3); bk.rotation.x = Math.PI / 2; bg.add(bk);
    bc.top.add(bg);
    app.addComponent(new Component({
      key: 'ds', name: '双缝（带横向微调）', icon: ICONS.dslit, zone: 'rail', defaultPos: 24, required: true, object: bc.group, labelY: 30,
      desc: `玻璃基片上刻有两组双缝：A 组为标定双缝，间距 d = ${this.dA.toFixed(3)} mm（出厂标定），缝宽约 0.08 mm；B 组间距未知。双缝架可横向微调、绕光轴转动。`,
      controls: () => [
        { type: 'segment', label: '使用的双缝', get: () => this.plate, set: (v) => (this.plate = v), options: [{ label: `A（d=${this.dA.toFixed(3)} mm）`, value: 'A' }, { label: 'B（未知）', value: 'B' }] },
        { type: 'knob', label: '横向微调', get: () => this.lat, set: (v) => (this.lat = v), min: -3, max: 3, step: 0.01, bigStep: 0.1, perRev: 1, digits: 2, unit: 'mm', sub: '使干涉条纹位于视场中央' },
        { type: 'knob', label: '双缝转角（绕光轴）', get: () => this.gamma, set: (v) => (this.gamma = v), min: -10, max: 10, step: 0.02, bigStep: 0.5, perRev: 5, digits: 2, unit: '°' },
      ],
    }));

    const ec = carriage(0x9aa3b2, AXIS_Y);
    const eg = new THREE.Group();
    eg.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 7, 28), MAT.black(), 2.2, 0, 0).rotateZ(Math.PI / 2));
    eg.add(mesh(new THREE.BoxGeometry(3, 4.4, 4.4), MAT.paint(0x4b5a53), -1.2, 0, 0));
    this.eyeDrum = mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.6, 36), MAT.chrome(), -1.2, 0, 3.2); this.eyeDrum.rotation.x = Math.PI / 2; eg.add(this.eyeDrum);
    ec.top.add(eg);
    app.addComponent(new Component({
      key: 'eye', name: '测微目镜', icon: ICONS.detector, zone: 'rail', defaultPos: 80, required: true, object: ec.group, labelY: 30,
      desc: '分划板上有 0–8 mm 固定刻度；转动鼓轮（1 圈 1 mm，100 分格）使叉丝横向移动。滑座刻线与分划板在同一平面。',
      controls: () => [
        { type: 'knob', label: '目镜视度（看清叉丝）', get: () => this.diopt, set: (v) => (this.diopt = v), min: -3, max: 3, step: 0.05, bigStep: 0.5, perRev: 2, digits: 2, unit: 'D' },
        { type: 'knob', label: '测微鼓轮', get: () => this.drive, set: (v) => this.moveDrive(v), min: 0, max: 8, step: 0.002, bigStep: 0.05, perRev: 1, digits: 3, unit: 'mm', sub: '测量时始终沿同一方向转动' },
      ],
    }));

    this.beamA = new Beam(0xffc23a, 0.06, 0.5); this.beamB = new Beam(0xffc23a, 0.06, 0.5); this.beamC = new Beam(0xffc23a, 0.05, 0.9);
    [this.beamA, this.beamB, this.beamC].forEach((b) => scene.add(b.group));
    this.eyeView = app.addView({ id: 'eye', title: '测微目镜视场', w: 250, h: 250, res: 1.4 });
    this.readView = app.addView({ id: 'read', title: '固定刻度与鼓轮', w: 290, h: 100, res: 1.5 });
  }

  canPlace(comp) {
    if (comp.key === 'ds' && this.app.comp('slit').placed && this.app.comp('slit').pos > 100) return '双缝应放在单缝之后';
    return null;
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
    this.slitBlades.rotation.x = ((this.beta * Math.PI) / 180) * 4;
    this.plateG.rotation.x = ((this.gamma * Math.PI) / 180) * 4;
    this.plateG.position.z = this.lat * 0.3 + (this.plate === 'A' ? 0 : 1.2);
    this.slitMarks[0].position.z = -this.d * 0.6; this.slitMarks[1].position.z = this.d * 0.6;
    this.eyeDrum.rotation.y = this.drive * Math.PI * 2;
    const V3 = (x) => app.coaxV(x, AXIS_Y); // 光束沿实际光路（未共轴时会偏离元件中心）
    const L = app.comp('lamp'), S = app.comp('slit'), B = app.comp('ds'), E = app.comp('eye');
    if (on && S.placed && S.pos > L.pos) {
      this.beamA.set(V3(L.pos + 5), V3(S.pos), this.warm * 0.5);
      const end = B.placed && B.pos > S.pos ? B.pos : E.placed ? E.pos : 120;
      this.beamB.set(V3(S.pos), V3(end), this.src * 0.4);
      if (B.placed && E.placed && E.pos > B.pos) this.beamC.set(V3(B.pos), V3(E.pos), this.src * 0.12); else this.beamC.hide();
    } else { this.beamA.hide(); this.beamB.hide(); this.beamC.hide(); }
    this.drawEye();
    this.drawRead();
  }

  drawEye() {
    const v = this.eyeView, g = v.ctx, W = v.W, H = v.H;
    const pxmm = W / EYE_FOV;
    const blurEye = Math.abs(this.diopt - this.dioptZero);
    const gain = 1.6 / Math.max(0.35, Math.sqrt(this.src)); // 人眼对暗视场有一定适应
    // GPU：按观察窗实际像素密度计算横向光强分布，再由显卡铺成二维图样
    const yc = H / 2 - this.app.coaxOff('eye').y * 10 * pxmm; // 目镜光心与光束不等高时，亮带上下偏移
    let gpuDone = false;
    if (GPU.ok) {
      const sm = GPU.samples(v), pr = new Float32Array(sm.n);
      for (let j = 0; j < sm.n; j++) pr[j] = this.intensity((sm.x0 + (j + 0.5) * sm.step - W / 2) / pxmm + this.eyeOff);
      gpuDone = GPU.paint(v, 'band', BAND_FS, { uProf: { tex: pr }, uX0: sm.x0, uStep: sm.step, uGain: gain, uH: H, uYc: yc });
    }
    if (!gpuDone) {
    const img = g.createImageData(W, H);
    const prof = new Float32Array(W);
    for (let i = 0; i < W; i++) prof[i] = this.intensity((i - W / 2) / pxmm + this.eyeOff);
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
    if (!this.src) foot = this.lampOn ? '视场很暗：检查光源和单缝' : '视场黑暗：钠光灯未打开';
    else if (!this.app.comp('ds').placed) foot = '未放双缝：均匀照明';
    else if (this.assist) foot = `双缝 ${this.plate} · 衬比度 ${(this.V * 100).toFixed(0)}% · 零级偏离视场中心 ${(this.xc - this.eyeOff).toFixed(2)} mm`;
    else foot = `双缝 ${this.plate}`;
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
    const cols = [
      { key: 'xd', label: '双缝位置/cm', digits: 2 },
      { key: 'xe', label: '目镜位置/cm', digits: 2 },
      { key: 'x1', label: '第 1 条暗纹/mm', digits: 3 },
      { key: 'x2', label: `第 ${N_SP + 1} 条暗纹/mm`, digits: 3 },
      { key: 'D', label: 'D/mm', digits: 1, calc: (r) => (r.xe - r.xd) * 10 },
      { key: 'dx', label: 'Δx/mm', digits: 4, calc: (r) => Math.abs(r.x2 - r.x1) / N_SP },
    ];
    const btns = (id) => [
      { label: '读取导轨位置（新起一行）', onClick: (t) => this.recRail(t, id) },
      { label: '记录叉丝读数', onClick: (t) => this.recFringe(t, id) },
    ];
    return [
      { id: 'A', title: '标定双缝 A：Δx – D', columns: cols, buttons: btns('A'), maxRows: 8, note: `每个 D 先读导轨位置，再沿同一方向测第 1 条和第 ${N_SP + 1} 条暗纹，Δx = |x₂ − x₁|/${N_SP}。至少测 3 个不同的 D。` },
      { id: 'B', title: '未知双缝 B', columns: cols, buttons: btns('B'), maxRows: 6, note: '换成 B 组双缝（双缝架上切换），在一个或几个 D 下测条纹间距。' },
    ];
  }

  readNow() { return Math.round((this.drive + gauss(0.0015)) * 1000) / 1000; }
  recRail(t, id) {
    if (!this.app.comp('ds').placed || !this.app.comp('eye').placed) return this.app.toast('双缝或测微目镜不在导轨上', 'warn');
    if (this.plate !== id) return this.app.toast(`当前使用的是 ${this.plate} 组双缝，本表记录 ${id} 组`, 'warn');
    t.addRow({ xd: Math.round(this.app.comp('ds').pos * 100) / 100, xe: Math.round(this.app.comp('eye').pos * 100) / 100 });
  }
  recFringe(t, id) {
    const r = t.rows[t.rows.length - 1];
    if (!r) return this.app.toast('请先读取导轨位置（新起一行）', 'warn');
    const key = r.x1 == null ? 'x1' : r.x2 == null ? 'x2' : null;
    if (!key) return this.app.toast('这一行已记录完整；改变 D 后读取导轨位置新起一行', 'warn');
    if (this.plate !== id) return this.app.toast(`当前使用的是 ${this.plate} 组双缝`, 'warn');
    if (Math.abs(r.xd - this.app.comp('ds').pos) > 0.02 || Math.abs(r.xe - this.app.comp('eye').pos) > 0.02) this.app.toast('注意：导轨位置与本行记录的不一致', 'warn');
    if (!this.src || this.V < 0.3) return this.app.toast('看不到清晰的干涉条纹', 'warn');
    const Xp = this.eyeX() - this.xc, ph = (this.d * Xp) / (LAMBDA * this.D) - 0.5;
    if (Math.abs(ph - Math.round(ph)) > 0.15) this.app.toast('叉丝没有对准暗纹中央', 'warn');
    if (key === 'x2' && (this.lastDir === 0 || Math.sign(this.drive - r.x1) !== this.lastDir)) this.app.toast('注意：两次读数之间鼓轮换过方向', 'warn');
    if (this.travel < BACK) this.app.toast('注意：鼓轮刚换向，读数含空程误差', 'warn');
    t.set(t.rows.length - 1, key, this.readNow());
    if (key === 'x2') this.Ds.add(Math.round(this.D / 10));
  }

  /** 自动测量当前 D 下的一行 */
  async autoRow(id) {
    const app = this.app;
    const t = app.table(id); app.showTable(app.tables.indexOf(t));
    await app.record(id, 0);
    const per = this.dx;
    const toX = (X) => X + 4 - this.eyeOff;
    // 在视场内选 6 条暗纹：以零级为中心
    const k0 = Math.round((this.eyeOff - this.xc) / per - 0.5 - N_SP / 2);
    const darkX = (k) => this.xc + (k + 0.5) * per;
    app.select(app.comp('eye'));
    await app.tween(() => this.drive, (v) => this.moveDrive(v), toX(darkX(k0)) - 0.1, 700);
    for (const k of [k0, k0 + N_SP]) {
      await app.tween(() => this.drive, (v) => this.moveDrive(v), toX(darkX(k)) + BACK / 2 + gauss(0.002), 500);
      await app.record(id, 1);
    }
  }

  /** 等高共轴调节：光路顺序、光束与各元件通光孔（cm） */
  coaxSpec() {
    return {
      keys: ['lamp', 'slit', 'ds', 'eye'],
      beam: { lamp: { w: 2, div: 0 }, slit: { w: 0.05, div: 0.02 } }, // 狭缝作为次级线光源向前发散
      ap: { slit: { y: 0.5, z: Infinity }, ds: { y: 0.4, z: 0.25 }, eye: { y: 0.3, z: 0.4 } },
      axes: { lamp: 'y', slit: 'yz', ds: 'yza', eye: 'yz' },
    };
  }

  steps() {
    const app = this.app;
    const on = (k) => app.comp(k).placed;
    return [
      {
        title: '放置钠光灯、单缝、双缝和测微目镜',
        html: '<p>按 <b>钠光灯 → 单缝 → 双缝 → 测微目镜</b> 放置。单缝紧靠钠灯；双缝距单缝 10 cm 左右；测微目镜距双缝 40 cm 以上。</p>',
        check: () => ['lamp', 'slit', 'ds', 'eye'].every(on) && this.R > 50 && this.R < 300 && this.D > 400,
        status: () => (this.R ? `单缝–双缝 R = <b>${(this.R / 10).toFixed(1)} cm</b>${this.D ? `，双缝–目镜 D = <b>${(this.D / 10).toFixed(1)} cm</b>` : ''}` : ''),
        auto: async () => { await app.view('全景'); for (const [k, x] of [['lamp', 4], ['slit', 12], ['ds', 24], ['eye', 70]]) await app.autoPlace(k, { pos: x }); },
      },
      {
        title: '打开钠光灯，调节目镜看清叉丝',
        html: '<p>打开钠光灯并预热；调节测微目镜的视度，看清分划板刻度和叉丝。</p>',
        check: () => this.lampOn && this.warm > 0.95 && Math.abs(this.diopt - this.dioptZero) < 0.12,
        auto: async () => {
          app.select(app.comp('lamp')); this.lampOn = true; app.changed();
          app.select(app.comp('eye')); await app.tween(() => this.diopt, (v) => (this.diopt = v), this.dioptZero + gauss(0.03), 1000);
          while (this.warm < 0.97) await app.wait(200, true);
        },
      },
      {
        title: '共轴：使条纹区位于视场中央',
        html: '<p>把单缝开大一些，横向微调双缝，使视场中最亮的区域（零级附近）位于视场中央。</p>',
        hint: '零级条纹在单缝与双缝中心连线的延长线上，双缝横移 δ 时零级移动 δ(R+D)/R。',
        check: () => this.R && this.D && Math.abs(this.xc - this.eyeOff) < 0.4,
        status: () => (this.R && this.D ? `零级偏离视场中心 <b>${(this.xc - this.eyeOff).toFixed(2)} mm</b>` : ''),
        auto: async () => {
          await app.view('单缝与双缝'); app.select(app.comp('ds'));
          await app.tween(() => this.lat, (v) => (this.lat = v), (this.eyeOff * this.R) / (this.R + this.D) + gauss(0.01), 1200);
        },
      },
      {
        title: '调出清晰的干涉条纹',
        html: '<p>边看目镜边<b>减小单缝宽度</b>，并<b>转动狭缝架</b>使单缝与双缝平行，直到条纹清晰。体会：单缝越宽、离双缝越近，条纹越模糊——这就是光源的空间相干性。</p>',
        hint: '衬比度 V = |sin u / u|，u = π b d /(λR)，b 为单缝的等效宽度。V = 0 时 b = λR/d，称为光源的临界宽度。',
        check: () => this.V > 0.7 && this.src > 0.15,
        status: () => `条纹衬比度 <b>${(this.V * 100).toFixed(0)}%</b>，视场亮度 <b>${(this.src * 100).toFixed(0)}%</b>；临界缝宽约 ${((LAMBDA * (this.R || 100)) / this.d).toFixed(3)} mm`,
        auto: async () => {
          await app.view('单缝与双缝'); app.select(app.comp('slit'));
          await app.tween(() => this.w, (v) => (this.w = v), 0.08, 900);
          await app.tween(() => this.beta, (v) => (this.beta = v), this.gamma + gauss(0.04), 1400);
          const wc = (LAMBDA * this.R) / this.d;
          await app.tween(() => this.w, (v) => (this.w = v), Math.max(0.03, wc * 0.3), 800);
        },
      },
      {
        title: '在三个不同的 D 下测条纹间距（双缝 A）',
        html: `<p>保持单缝和双缝不动，把测微目镜放在三个不同位置（D 相差 15 cm 以上）。每个位置：读取导轨位置，再沿同一方向转动鼓轮，测第 1 条和第 ${N_SP + 1} 条暗纹的位置。</p>`,
        hint: '移动目镜后条纹可能偏离视场中央，可略微横移双缝重新对中（不影响 D）。',
        check: () => { const r = app.table('A').completeRows(); if (r.length < 3) return false; const D = r.map((q) => (q.xe - q.xd) * 10); return Math.max(...D) - Math.min(...D) >= 150; },
        status: () => { const r = app.table('A').completeRows(); return `已测 <b>${r.length}</b> 个 D：${r.map((q) => ((q.xe - q.xd)).toFixed(1) + ' cm').join('、') || '—'}`; },
        auto: async () => {
          await app.view('测微目镜');
          for (const xe of [this.P('ds') / 10 + 45, this.P('ds') / 10 + 65, this.P('ds') / 10 + 85]) {
            await app.moveTo('eye', Math.min(118, xe), 900);
            if (Math.abs(this.xc - this.eyeOff) > 0.5) { app.select(app.comp('ds')); await app.tween(() => this.lat, (v) => (this.lat = v), (this.eyeOff * this.R) / (this.R + this.D), 600); }
            await this.autoRow('A');
          }
        },
      },
      {
        title: '换成未知双缝 B，测条纹间距',
        html: '<p>在双缝架上切换到 <b>B 组</b>双缝，重新对中、调清条纹，在一个 D 下测条纹间距。</p>',
        check: () => app.table('B').completeRows().length >= 1,
        status: () => `已测 <b>${app.table('B').completeRows().length}</b> 组`,
        auto: async () => {
          app.select(app.comp('ds')); this.plate = 'B'; app.changed(); await app.wait(500);
          // d_B 较小、条纹较宽：取较小的 D，使 6 条暗纹都在 8 mm 视场内
          await app.moveTo('eye', this.P('ds') / 10 + 45, 900);
          await app.tween(() => this.lat, (v) => (this.lat = v), (this.eyeOff * this.R) / (this.R + this.D), 600);
          if (this.V < 0.7) { app.select(app.comp('slit')); await app.tween(() => this.w, (v) => (this.w = v), Math.max(0.03, ((LAMBDA * this.R) / this.d) * 0.3), 600); }
          await this.autoRow('B');
        },
      },
      {
        title: '数据处理：作 Δx–D 图求 λ，再求 d_B',
        html: '<p>$$\\Delta x=\\frac{\\lambda}{d}D$$ 以 $D$ 为横坐标、$\\Delta x$ 为纵坐标作图，斜率 $k=\\lambda/d_A$，得 $\\lambda=k\\,d_A$。再由 $d_B=\\lambda D/\\Delta x_B$ 求未知双缝间距。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const rA = this.app.table('A').completeRows();
    if (rA.length < 2) return { html: '<p>双缝 A 至少需要两个不同 D 的完整数据（建议 3 个以上）。</p>', ok: false };
    const D = rA.map((r) => (r.xe - r.xd) * 10), dx = rA.map((r) => Math.abs(r.x2 - r.x1) / N_SP);
    if (Math.max(...D) - Math.min(...D) < 50) return { html: '<p>各组 D 太接近，无法作图。</p>', ok: false };
    const lams = rA.map((r, i) => (this.dA * dx[i]) / D[i]);
    const fit = linFit(D, dx);
    const lamFit = fit.k * this.dA, uFit = fit.uk * this.dA;
    const lm = mean(lams), ua = lams.length > 1 ? uA(lams) : 0;
    let html = `<h3>1. 标定双缝 A（$d_A=${this.dA.toFixed(3)}$ mm）</h3><table><tr><th>D/mm</th>${D.map((v) => `<td>${v.toFixed(1)}</td>`).join('')}</tr><tr><th>Δx/mm</th>${dx.map((v) => `<td>${v.toFixed(4)}</td>`).join('')}</tr><tr><th>λ=d_AΔx/D /nm</th>${lams.map((v) => `<td>${(v * 1e6).toFixed(1)}</td>`).join('')}</tr></table>
      <p>逐组计算平均 $\\bar\\lambda=${(lm * 1e6).toFixed(1)}$ nm${ua ? `，$u_A=${sig(ua * 1e6, 2)}$ nm` : ''}。</p>
      <p>图线法：$\\Delta x=kD+b$，$k=${(fit.k * 1e3).toFixed(5)}\\times10^{-3}$，$b=${fit.b.toFixed(4)}$ mm，$r=${fit.r.toFixed(5)}$。截距接近 0 说明 D 的读数没有明显的系统偏差。</p>
      <div class="result-box">$\\lambda=k\\,d_A=${texU(lamFit * 1e6, Math.max(uFit, 1e-9) * 1e6, 'nm')}$</div>
      <div class="plot-wrap"><canvas data-plot="0" style="height:260px"></canvas></div>`;
    const answers = [{ label: '钠光波长 $\\lambda$', unit: 'nm', value: lamFit * 1e6, alts: [lm * 1e6], digits: 1, tolRel: 0.006 }];
    const rB = this.app.table('B').completeRows();
    let dB = NaN;
    if (rB.length) {
      const ds = rB.map((r) => (lamFit * (r.xe - r.xd) * 10) / (Math.abs(r.x2 - r.x1) / N_SP));
      dB = mean(ds);
      html += `<h3>2. 未知双缝 B</h3><table><tr><th>D/mm</th>${rB.map((r) => `<td>${((r.xe - r.xd) * 10).toFixed(1)}</td>`).join('')}</tr><tr><th>Δx/mm</th>${rB.map((r) => `<td>${(Math.abs(r.x2 - r.x1) / N_SP).toFixed(4)}</td>`).join('')}</tr></table>
        <div class="result-box">$d_B=\\lambda D/\\Delta x=${dB.toFixed(4)}$ mm</div>`;
      answers.push({ label: '未知双缝间距 $d_B$', unit: 'mm', value: dB, digits: 4, tolRel: 0.008 });
    }
    html += `<div class="result-box warn">钠光平均波长 589.3 nm，本次 λ 相对误差 ${pct(relErr(lamFit, LAMBDA))}${rB.length ? `；B 组双缝间距参考值 ${this.dB.toFixed(4)} mm，相对误差 ${pct(relErr(dB, this.dB))}` : ''}。</div>`;
    return {
      html, ok: true, answers,
      plots: [{ title: 'Δx – D', xLabel: 'D / mm', yLabel: 'Δx / mm', series: [
        { type: 'scatter', data: D.map((x, i) => [x, dx[i]]), label: '实验数据', radius: 4 },
        { type: 'line', data: lineData(fit.k, fit.b, 0, Math.max(...D) * 1.05), label: `拟合 k = ${(fit.k * 1e3).toFixed(4)}×10⁻³` },
      ] }],
    };
  }

  principle() {
    return `<h3>1. 双缝干涉</h3><p>单缝 S 发出的光照到相距 $d$ 的双缝 S₁、S₂ 上，两缝成为相干的次波源（分波前）。在距双缝 $D$ 处，光程差 $\\delta\\approx dx/D$，</p>$$I(x)=I_0\\left(\\frac{\\sin u}{u}\\right)^2\\left[1+V\\cos\\frac{2\\pi d x}{\\lambda D}\\right],\\qquad u=\\frac{\\pi a x}{\\lambda D}$$
<p>暗纹间距 $\\Delta x=\\lambda D/d$。$\\left(\\sin u/u\\right)^2$ 是单缝（缝宽 $a$）的衍射包络，当 $d/a$ 为整数时对应级次的明纹缺失。</p>
<h3>2. 空间相干性</h3><p>单缝有一定宽度 $b$ 时，缝上各点各自产生一套错开的条纹，叠加后衬比度</p>$$V=\\left|\\frac{\\sin u'}{u'}\\right|,\\qquad u'=\\frac{\\pi b d}{\\lambda R}$$<p>$R$ 为单缝到双缝的距离。$b<\\lambda R/d$ 时才能看到条纹。单缝与双缝不平行时，相当于单缝变宽。</p>
<h3>3. 测量方法</h3><p>用测微目镜测 ${N_SP} 个条纹间距的总宽度，Δx = |x₂−x₁|/${N_SP}。改变 $D$ 测几组，$\\Delta x$–$D$ 直线的斜率为 $\\lambda/d$。用已知 $d_A$ 的双缝求出 $\\lambda$ 后，就可以测未知双缝的间距。</p>
<h3>4. 本仿真的计算模型</h3><p>目镜视场中的光强按上式逐点计算，钠双线（589.0/589.6 nm，强度 2:1）非相干叠加；衬比度由单缝宽度、单缝与双缝的夹角和距离 $R$ 决定；零级位置由单缝–双缝中心连线决定。读数含 0.0015 mm 的随机误差和 ${BACK} mm 的鼓轮空程。</p>`;
  }
}
