// 实验五：单缝衍射光强分布的测量（菲涅耳—夫琅禾费衍射）
import * as THREE from 'three';
import { GPU, GLSL } from '../core/gpu.js';
import { Component } from '../core/Component.js';
import { AXIS_Y, MAT, mesh, labTable, opticalRail, carriage, whiteScreen, laserMesh, Beam, ICONS, meterBox, knobMesh } from '../core/Models.js';
import { fresnel1D, slitApertures, sinc2 } from '../physics/diffraction.js';
import { linFit, mean, uA, fmtU, texU, sig, gauss, rand, relErr, pct, clamp } from '../core/Stats.js';
import { fnData } from '../core/Plot.js';

const LAMBDA = 632.8e-6; // mm
const P0 = 1.5; // 激光功率 mW
const BEAM_W = 0.75; // 光束半径 mm
const DET_W = 0.1, DET_H = 1.5; // 探头狭缝 mm
const RANGES = [2, 20, 200, 2000]; // μW
const SCREEN_MM = 60; // 白屏观察窗横向范围 mm

const SCREEN_FS = GLSL.lut + `
uniform sampler2D uProf; uniform float uX0, uStep, uPeak, uW, uH, uSM, uBW, uOy, uT;
vec3 shade(vec2 L) {
  float p = lut(uProf, (L.x - uX0) / uStep - 0.5);
  float yy = ((L.y - 0.5 * uH) / uH) * (uSM * uH / uW) + uOy;
  float E = p * uPeak * exp(-2.0 * (yy / uBW) * (yy / uBW)) * 8.0 * uT;
  float vv = min(1.0, pow(max(E, 0.0), 0.45));
  return vec3(59.0 + 196.0 * vv, 61.0 + 120.0 * vv * vv, 60.0 + 90.0 * vv * vv * vv) / 255.0;
}`;

export class SlitExperiment {
  static meta = {
    id: 'slit',
    title: '单缝衍射光强分布',
    subtitle: '菲涅耳—夫琅禾费衍射 · 光电探头逐点扫描 · 由暗纹间距求缝宽',
    tags: ['波动光学', '衍射', '光强测量'],
    level: '中等',
    time: '40 min',
    color: '#c41e3a',
    formula: String.raw`a\sin\theta=k\lambda`,
    measure: '单缝宽度 a',
    goals: ['观察单缝衍射现象及其随缝宽、距离的变化，理解菲涅耳衍射与夫琅禾费衍射的区别', '用光电探头逐点测量单缝衍射的相对光强分布', '由暗纹位置求单缝宽度，验证次极大的相对强度'],
    questions: ['满足什么条件时才能把单缝衍射视为夫琅禾费衍射？', '缝宽变小时，中央明纹宽度和亮度如何变化？', '光功率计量程选择不当会对测量造成什么影响？'],
  };

  static thumb(ctx, w, h) {
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const X = (x - w / 2) * 0.35;
      const I = sinc2(X, 0.1, LAMBDA, 800);
      const v = Math.pow(I, 0.35);
      const gr = ctx.createLinearGradient(0, h * 0.3, 0, h * 0.7);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, `rgba(255,${30 + 40 * v},${30 * v},${v})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(x, h * 0.3, 1, h * 0.4);
    }
  }

  constructor(app) {
    this.app = app;
    this.laserOn = false;
    this.a0 = rand(0.006, 0.014); // 测微器零点误差 mm
    this.aRead = 0.45; // 缝宽测微器读数 mm
    this.type = 'single';
    this.slitOff = rand(0.5, 0.9) * (Math.random() < 0.5 ? -1 : 1); // 狭缝横向偏离光束 mm
    this.stage = 10; // 探头测微平移台读数 mm
    this.center = rand(23.5, 26.5); // 衍射图样中心在平移台上的位置
    this.range = 3; // 量程索引
    this.minW = 1; this.maxW = 0; // 记录观察时缝宽变化
    this.step = 0.5;
  }

  get a() { return Math.max(0, this.aRead - this.a0); }
  get L() { const s = this.app.comp('slit'), d = this.app.comp('det'), sc = this.app.comp('screen'); const t = d.placed ? d : sc.placed ? sc : null; return s.placed && t && t.pos > s.pos ? (t.pos - s.pos) * 10 : null; }
  aps() { return slitApertures(this.type, this.a, 0.25, 0); }
  beam() { return { w: BEAM_W, c: this.slitOff }; }
  /** 屏上相对光强（以入射光束中心光强为 1） */
  I(x) {
    const L = this.L;
    if (!L || !this.lit()) return 0;
    // 衍射积分结果按物理参数缓存：只移动探头或旋转视角时不重复计算
    const key = `${this.type}|${this.a.toFixed(5)}|${L.toFixed(3)}|${this.slitOff.toFixed(4)}`;
    if (key !== this._ikey) { this._ikey = key; this._icache = new Map(); }
    const xk = Math.round(x * 1e4);
    let v = this._icache.get(xk);
    if (v === undefined) { v = fresnel1D(xk / 1e4, this.aps(), LAMBDA, L, this.beam()); if (this._icache.size < 20000) this._icache.set(xk, v); }
    return v;
  }
  lit() { const l = this.app.comp('laser'), s = this.app.comp('slit'); return this.laserOn && l.placed && s.placed && l.pos < s.pos; }
  transmission() { const o = this.slitOff, w = BEAM_W; return Math.exp(-2 * (o / w) ** 2); }
  /** 探头读数 μW（含暗噪声），按探头狭缝宽度积分 */
  power() {
    const x0 = this.stage - this.center;
    let s = 0;
    for (let i = -2; i <= 2; i++) s += this.I(x0 + (i * DET_W) / 5);
    const Ibar = s / 5;
    const peak = (2 * P0) / (Math.PI * BEAM_W * BEAM_W); // 光束中心光强 mW/mm²
    return Ibar * peak * DET_W * DET_H * 0.6 * 1000 * this.app.coaxT('det') + (this.noise ?? 0.0008);
  }
  meterText() {
    const det = this.app.comp('det');
    if (!det.placed) return { main: '----', unit: '' };
    const r = RANGES[this.range];
    const p = this.power();
    if (p > r * 0.9995) return { main: '1   ', unit: 'μW', over: true };
    const dec = r === 2 ? 3 : r === 20 ? 2 : r === 200 ? 1 : 0;
    return { main: p.toFixed(dec), unit: 'μW', value: +p.toFixed(dec) };
  }

  cameras() {
    return [
      { name: '全景', pos: [50, 70, 130], target: [50, 18, 0] },
      { name: '狭缝', pos: [12, 30, 30], target: [25, 22, 0] },
      { name: '探头', pos: [70, 35, 45], target: [92, 18, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(210, 80); t.position.set(50, 0, 0); scene.add(t);
    scene.add(opticalRail(100));
    app.addRail({ origin: new THREE.Vector3(0, 0, 0), min: 0, max: 100 });
    app.stage.setLightTarget(50, 0, 0);

    const lc = carriage(0x9aa3b2, AXIS_Y);
    const lz = laserMesh(26); lz.group.position.set(2, 0, 0); lc.top.add(lz.group);
    this.laserAp = lz.aperture;
    app.addComponent(new Component({
      key: 'laser', name: 'He-Ne 激光器', icon: ICONS.laser, zone: 'rail', defaultPos: 26, required: true, object: lc.group, labelY: 30,
      desc: '波长 632.8 nm，功率约 1.5 mW，光束直径约 1.5 mm。',
      controls: () => [{ type: 'toggle', label: '激光电源', get: () => this.laserOn, set: (v) => (this.laserOn = v) }],
    }));

    const sc = carriage(0x9aa3b2, AXIS_Y);
    const sg = new THREE.Group();
    sg.add(mesh(new THREE.BoxGeometry(0.6, 7, 7), MAT.dark()));
    this.slitBlades = [mesh(new THREE.BoxGeometry(0.3, 4, 1.5), MAT.chrome(), -0.4, 0, -0.85), mesh(new THREE.BoxGeometry(0.3, 4, 1.5), MAT.chrome(), -0.4, 0, 0.85)];
    this.slitBlades.forEach((b) => sg.add(b));
    const mk = knobMesh(1.0, 2.2, 0x9ca3af); mk.position.set(0, 0, 4.6); mk.rotation.x = Math.PI / 2; sg.add(mk);
    const mk2 = mesh(new THREE.CylinderGeometry(0.6, 0.6, 2.5, 16), MAT.chrome(), 0, 0, 3.2); mk2.rotation.x = Math.PI / 2; sg.add(mk2);
    sg.add(mesh(new THREE.BoxGeometry(0.6, 3, 1), MAT.dark(), 0, -5, 0));
    this.slitGroup = sg;
    sc.top.add(sg);
    app.addComponent(new Component({
      key: 'slit', name: '可调单缝', icon: ICONS.slit, zone: 'rail', defaultPos: 32, required: true, object: sc.group, labelY: 30,
      desc: '缝宽由测微螺旋调节，分度 0.01 mm（存在零点误差，缝宽以衍射测量结果为准）。也可换成双缝片观察。',
      controls: () => [
        { type: 'segment', label: '衍射元件', get: () => this.type, set: (v) => (this.type = v), options: [{ label: '单缝', value: 'single' }, { label: '双缝 (d=0.25mm)', value: 'double' }] },
        { type: 'knob', label: '缝宽测微螺旋读数', get: () => this.aRead, set: (v) => { this.aRead = v; this.minW = Math.min(this.minW, v); this.maxW = Math.max(this.maxW, v); }, min: 0, max: 1, step: 0.002, bigStep: 0.02, perRev: 0.5, digits: 3, unit: 'mm' },
        { type: 'knob', label: '狭缝横向位置', get: () => this.slitOff, set: (v) => (this.slitOff = v), min: -2, max: 2, step: 0.01, bigStep: 0.1, perRev: 0.5, digits: 2, unit: 'mm', sub: '使激光束正好照在狭缝中央（透过光最强）' },
      ],
    }));

    const scrC = carriage(0x9aa3b2, AXIS_Y);
    const ws = whiteScreen(16, 10); scrC.top.add(ws.group);
    this.scrView = app.addView({ id: 'scr', title: '白屏上的衍射图样', w: 280, h: 120, res: 1.6 });
    this.scrTex = new THREE.CanvasTexture(this.scrView.canvas); this.scrTex.colorSpace = THREE.SRGBColorSpace;
    ws.face.material = new THREE.MeshBasicMaterial({ map: this.scrTex }); ws.face.userData.noHL = true;
    ws.face.geometry = new THREE.PlaneGeometry(16, (16 * 120) / 280);
    app.addComponent(new Component({ key: 'screen', name: '白屏', icon: ICONS.screen, zone: 'rail', defaultPos: 85, object: scrC.group, labelY: 32, desc: '用于观察衍射图样。' }));

    // 探头 + 测微平移台 + 光功率计
    const dc = carriage(0x9aa3b2, AXIS_Y);
    const dg = new THREE.Group();
    dg.add(mesh(new THREE.BoxGeometry(5, 2, 12), MAT.alu(), 0, -4.5, 0));
    this.detHead = new THREE.Group();
    this.detHead.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 4, 24), MAT.black(), 0.5, 0, 0).rotateZ(Math.PI / 2));
    this.detHead.add(mesh(new THREE.BoxGeometry(0.2, 1.6, 0.2), MAT.emissive(0x333333, 0.1), -1.6, 0, 0));
    this.detHead.add(mesh(new THREE.BoxGeometry(2, 4, 2), MAT.dark(), 0.5, -2.5, 0));
    dg.add(this.detHead);
    const dk = mesh(new THREE.CylinderGeometry(1.1, 1.1, 3, 24), MAT.chrome(), 0, -4.5, 7.4); dk.rotation.x = Math.PI / 2; dg.add(dk);
    dc.top.add(dg);
    const meter = meterBox(14, 8, 9, '光功率计');
    meter.group.position.set(4, -AXIS_Y, 16); meter.group.rotation.y = -0.25;
    dc.group.add(meter.group);
    this.meter = meter;
    app.addComponent(new Component({
      key: 'det', name: '光电探头与光功率计', icon: ICONS.detector, zone: 'rail', defaultPos: 95, object: dc.group, labelY: 30,
      desc: `探头前有 ${DET_W} mm 宽的狭缝光阑，装在横向测微平移台上（行程 0–50 mm，分度 0.01 mm）。光功率计有 2 μW / 20 μW / 200 μW / 2 mW 四挡量程。`,
      controls: () => [
        { type: 'knob', label: '平移台测微鼓轮', get: () => this.stage, set: (v) => (this.stage = v), min: 0, max: 50, step: 0.01, bigStep: 0.5, perRev: 1, digits: 2, unit: 'mm' },
        { type: 'slider', label: '平移台快速移动', get: () => this.stage, set: (v) => (this.stage = v), min: 0, max: 50, step: 0.01, digits: 2, unit: 'mm' },
        { type: 'segment', label: '量程', get: () => this.range, set: (v) => (this.range = v), options: RANGES.map((r, i) => ({ label: r >= 1000 ? '2 mW' : `${r} μW`, value: i })) },
        { type: 'readout', label: '光功率计示数', get: () => { const m = this.meterText(); return `${m.main} ${m.unit}`; }, sub: '最高位显示“1”表示超量程' },
      ],
    }));

    this.beamA = new Beam(0xff2a2a, 0.1, 0.4); scene.add(this.beamA.group);
    this.fan = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    scene.add(this.fan);
    this.profile = app.addView({ id: 'prof', title: '光强分布（探头处，理论曲线仅供参考）', w: 280, h: 150, res: 1.5 });
  }

  canPlace(comp) {
    if (comp.key === 'det' && this.app.comp('screen').placed) return '请先把白屏放回器材柜，再放置光电探头';
    if (comp.key === 'screen' && this.app.comp('det').placed) return '请先取下光电探头';
    return null;
  }

  update() {
    const app = this.app;
    this.noise = 0.0004 + Math.abs(gauss(0.0006));
    const lit = this.lit();
    this.laserAp.material.emissiveIntensity = this.laserOn && app.comp('laser').placed ? 3 : 0.1;
    const gap = this.a * 6; // 视觉放大
    this.slitBlades[0].position.z = -0.75 - gap; this.slitBlades[1].position.z = 0.75 + gap;
    this.detHead.position.z = (this.stage - 25) * 0.12;
    const P = (x) => this.app.coaxV(x, AXIS_Y); // 光束沿实际光路
    const l = app.comp('laser'), s = app.comp('slit');
    const tgt = app.comp('det').placed ? app.comp('det') : app.comp('screen').placed ? app.comp('screen') : null;
    if (this.laserOn && l.placed) {
      const end = s.placed && s.pos > l.pos ? s.pos : tgt && tgt.pos > l.pos ? tgt.pos : l.pos + 80;
      this.beamA.set(P(l.pos + 2.4), P(end), 1);
    } else this.beamA.hide();
    // 衍射扇形光
    if (lit && tgt && tgt.pos > s.pos) {
      const half = (LAMBDA * this.L) / Math.max(0.01, this.a) / 10 * 3; // 3 级暗纹处（cm）
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([s.pos, AXIS_Y, 0, tgt.pos, AXIS_Y, -half, tgt.pos, AXIS_Y, half], 3));
      this.fan.geometry.dispose(); this.fan.geometry = g; this.fan.visible = true;
      this.fan.material.opacity = 0.1 * this.transmission();
    } else this.fan.visible = false;
    const m = this.meterText();
    this.meter.setText(m.main, m.unit, `量程 ${RANGES[this.range] >= 1000 ? '2 mW' : RANGES[this.range] + ' μW'}   x = ${this.stage.toFixed(2)} mm`);
    this.drawScreen();
    this.drawProfile();
  }

  drawScreen() {
    const v = this.scrView, g = v.ctx, W = v.W, H = v.H;
    const scr = this.app.comp('screen');
    this.I(0); // 刷新参数键
    const cT = this.app.coaxT('screen'), cOy = this.app.coaxOff('screen').y * 10; // 屏上光斑亮度与上下偏移（mm）
    const skey = `${scr.placed}|${this.lit()}|${this._ikey}|${this.L}|${cT.toFixed(4)}|${cOy.toFixed(3)}|${GPU.ok ? v.scale.toFixed(3) + v.visRect().map((q) => q.toFixed(1)) : ''}`;
    if (skey === this._skey) return; // 图样没有变化
    this._skey = skey;
    g.fillStyle = '#3b3d3c'; g.fillRect(0, 0, W, H);
    let foot = '';
    if (scr.placed && this.lit() && this.L) {
      const peak = (2 * P0) / (Math.PI * BEAM_W ** 2);
      let gpuDone = false;
      if (GPU.ok) {
        const sm = GPU.samples(v), pr = new Float32Array(sm.n);
        for (let j = 0; j < sm.n; j++) pr[j] = this.I(((sm.x0 + (j + 0.5) * sm.step) / W - 0.5) * SCREEN_MM);
        gpuDone = GPU.paint(v, 'screen', SCREEN_FS, { uProf: { tex: pr }, uX0: sm.x0, uStep: sm.step, uPeak: peak, uW: W, uH: H, uSM: SCREEN_MM, uBW: BEAM_W, uOy: cOy, uT: cT });
      }
      if (!gpuDone) {
      const img = g.createImageData(W, H);
      const prof = new Float32Array(W);
      for (let i = 0; i < W; i++) { const x = (i / W - 0.5) * SCREEN_MM; prof[i] = this.I(x); }
      for (let y = 0; y < H; y++) {
        const yy = ((y - H / 2) / H) * (SCREEN_MM * H / W) + cOy; // mm，与横向同比例
        const vprof = Math.exp(-((yy / BEAM_W) ** 2) * 2);
        for (let i = 0; i < W; i++) {
          const E = prof[i] * peak * vprof * 8 * cT;
          const vv = Math.min(1, Math.pow(E, 0.45));
          const k = (y * W + i) * 4;
          img.data[k] = 59 + 196 * vv; img.data[k + 1] = 61 + 120 * vv * vv; img.data[k + 2] = 60 + 90 * vv * vv * vv; img.data[k + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      }
      const F = (this.a * this.a) / (LAMBDA * this.L);
      foot = `刻度 5 mm · L=${(this.L / 10).toFixed(1)} cm · 菲涅耳数 F=a²/λL=${F.toFixed(3)} ${F < 0.1 ? '(远场)' : F < 1 ? '(过渡区)' : '(近场菲涅耳衍射)'}`;
    } else foot = scr.placed ? '没有光照到白屏' : '未放置白屏';
    g.strokeStyle = 'rgba(0,0,0,.25)';
    for (let i = 0; i <= 12; i++) { g.beginPath(); g.moveTo((i / 12) * W, H - 8); g.lineTo((i / 12) * W, H); g.stroke(); }
    v.foot(foot);
    this.scrTex.needsUpdate = true;
  }

  drawProfile() {
    const v = this.profile, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#101513'; g.fillRect(0, 0, W, H);
    const det = this.app.comp('det');
    const t = this.app.table('scan');
    const pts = t ? t.completeRows() : [];
    // 已记录的数据点
    const xs = [0, 50];
    const maxP = Math.max(1e-3, ...pts.map((r) => r.I));
    g.strokeStyle = 'rgba(255,255,255,.08)';
    for (let i = 0; i <= 10; i++) { g.beginPath(); g.moveTo((i / 10) * W, 0); g.lineTo((i / 10) * W, H); g.stroke(); }
    if (this.lit() && det.placed && this.L) {
      g.strokeStyle = 'rgba(196,30,58,.55)'; g.lineWidth = 1.5; g.beginPath();
      const peak = (2 * P0) / (Math.PI * BEAM_W ** 2) * DET_W * DET_H * 0.6 * 1000;
      const top = Math.max(maxP, this.I(0) * peak) * 1.08;
      for (let i = 0; i <= W; i += 2) {
        const x = xs[0] + (i / W) * (xs[1] - xs[0]);
        const p = this.I(x - this.center) * peak;
        const y = H - 6 - (p / top) * (H - 14);
        i ? g.lineTo(i, y) : g.moveTo(i, y);
      }
      g.stroke();
      g.fillStyle = '#8fe3a5';
      for (const r of pts) { const X = ((r.x - xs[0]) / (xs[1] - xs[0])) * W, Y = H - 6 - (r.I / top) * (H - 14); g.fillRect(X - 1.5, Y - 1.5, 3, 3); }
      const X = ((this.stage - xs[0]) / (xs[1] - xs[0])) * W;
      g.strokeStyle = '#f1f1ea'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X, 0); g.lineTo(X, H); g.stroke(); g.setLineDash([]);
      v.foot(`探头 x=${this.stage.toFixed(2)} mm  已记录 ${pts.length} 点`);
    } else v.foot('放置光电探头后显示');
  }

  globalControls() {
    return [
      { type: 'readout', label: '光功率计', get: () => { const m = this.meterText(); return `${m.main} ${m.unit}`; } },
      { type: 'segment', label: '“记录并前进”步长', get: () => this.step, set: (v) => (this.step = v), options: [{ label: '0.25', value: 0.25 }, { label: '0.50', value: 0.5 }, { label: '1.00 mm', value: 1 }] },
    ];
  }

  tables() {
    return [{
      id: 'scan', title: '光强分布扫描',
      columns: [
        { key: 'x', label: '探头位置 x/mm', digits: 2 },
        { key: 'I', label: '光功率 P/μW', digits: 3 },
        { key: 'rng', label: '量程', type: 'text', readonly: true, optional: true },
      ],
      buttons: [
        { label: '记录并前进一步', onClick: (t) => { if (this.rec(t)) { this.stage = Math.min(50, this.stage + this.step); this.app.changed(); } } },
        { label: '只记录当前点', primary: false, onClick: (t) => this.rec(t) },
      ],
      note: '从中央主极大一侧的第 3 级暗纹以外开始，沿同一方向每隔 0.5 mm 记录一次，直到另一侧第 3 级暗纹以外。',
    }];
  }

  rec(t) {
    if (!this.app.comp('det').placed) { this.app.toast('请先放置光电探头', 'warn'); return false; }
    const m = this.meterText();
    if (m.over) { this.app.toast('光功率计超量程，请换大一挡量程', 'warn'); return false; }
    t.addRow({ x: Math.round(this.stage * 100) / 100, I: m.value, rng: RANGES[this.range] >= 1000 ? '2 mW' : RANGES[this.range] + ' μW' });
    return true;
  }

  bestRange() {
    const peak = (2 * P0) / (Math.PI * BEAM_W ** 2) * DET_W * DET_H * 0.6 * 1000;
    const pc = this.I(0) * peak;
    return RANGES.findIndex((r) => r > pc * 1.02);
  }

  /** 等高共轴调节：光路顺序、光束与各元件通光孔（cm） */
  coaxSpec() {
    return {
      keys: ['laser', 'slit', 'screen', 'det'],
      beam: { laser: { w: 0.075, div: 0.0006 } },
      // 狭缝横向位置另有微调（slitOff），这里只考虑高度；探头狭缝高 1.5 mm
      ap: { slit: { y: 0.5, z: Infinity }, screen: { y: 3, z: Infinity }, det: { y: DET_H / 20, z: Infinity } },
      axes: { laser: 'y', slit: 'y', screen: 'y', det: 'y' },
    };
  }

  steps() {
    const app = this.app;
    const on = (k) => app.comp(k).placed;
    return [
      {
        title: '在导轨上放置激光器、单缝和白屏',
        html: '<p>依次把 <b>He-Ne 激光器、可调单缝、白屏</b>放到导轨上，白屏离狭缝 50 cm 以上。</p>',
        check: () => on('laser') && on('slit') && on('screen') && app.comp('laser').pos < app.comp('slit').pos && app.comp('slit').pos < app.comp('screen').pos,
        auto: async () => { await app.view('全景'); await app.autoPlace('laser', { pos: 26 }); await app.autoPlace('slit', { pos: 32 }); await app.autoPlace('screen', { pos: 92 }); },
      },
      {
        title: '打开激光器，使光束照在狭缝中央',
        html: '<p>打开激光电源。调节<b>狭缝横向位置</b>，使激光束正好照在狭缝中央，此时白屏上的衍射图样最亮且左右对称。</p>',
        check: () => this.laserOn && Math.abs(this.slitOff) < 0.12,
        status: () => `狭缝偏离光束中心 <b>${this.slitOff.toFixed(2)} mm</b>`,
        auto: async () => {
          app.select(app.comp('laser')); this.laserOn = true; app.changed(); await app.wait(400);
          await app.view('狭缝'); app.select(app.comp('slit'));
          await app.tween(() => this.slitOff, (v) => (this.slitOff = v), gauss(0.02), 1100);
        },
      },
      {
        title: '观察：改变缝宽和距离',
        html: '<p>转动缝宽测微螺旋，从宽到窄改变缝宽，观察白屏上图样的变化：缝较宽或屏较近时是<b>菲涅耳衍射</b>（图样中央可能出现暗区），缝很窄时变为<b>夫琅禾费衍射</b>，中央明纹宽度与缝宽成反比。也可以切换成双缝观察。</p><p>观察完毕后把缝宽调到约 <b>0.10 mm</b>。</p>',
        hint: '观察窗底部显示菲涅耳数 $F=a^2/\\lambda L$，$F\\ll1$ 时为远场（夫琅禾费）衍射。',
        check: () => this.maxW - this.minW > 0.15 && this.aRead > 0.07 && this.aRead < 0.16 && this.type === 'single',
        status: () => `缝宽读数 <b>${this.aRead.toFixed(3)} mm</b>；已改变范围 ${(Math.max(0, this.maxW - this.minW)).toFixed(2)} mm（需 &gt; 0.15）`,
        auto: async () => {
          await app.view('全景');
          app.select(app.comp('slit'));
          this.minW = Math.min(this.minW, this.aRead); this.maxW = Math.max(this.maxW, this.aRead);
          const set = (v) => { this.aRead = v; this.minW = Math.min(this.minW, v); this.maxW = Math.max(this.maxW, v); };
          app.say('缝宽较大：近场菲涅耳衍射');
          await app.tween(() => this.aRead, set, 0.6, 1400);
          app.say('缝宽减小：逐渐过渡到夫琅禾费衍射，中央明纹变宽');
          await app.tween(() => this.aRead, set, 0.11, 2200);
        },
      },
      {
        title: '换上光电探头，满足远场条件',
        html: '<p>取下白屏，在导轨末端放置<b>光电探头</b>（带测微平移台），使探头狭缝到单缝的距离 $L$ 大于 60 cm。</p>',
        check: () => on('det') && !on('screen') && this.L >= 600,
        status: () => (this.L ? `L = <b>${(this.L / 10).toFixed(1)} cm</b>` : ''),
        auto: async () => { app.remove(app.comp('screen')); await app.autoPlace('det', { pos: 96 }); },
      },
      {
        title: '选择合适的光功率计量程',
        html: '<p>转动平移台使探头位于中央主极大处（读数最大），选择<b>不超量程的最小一挡</b>，以保证弱的次极大也有足够的有效数字。</p>',
        check: () => this.range === this.bestRange() && Math.abs(this.stage - this.center) < 1,
        status: () => `探头偏离中央极大 <b>${(this.stage - this.center).toFixed(2)} mm</b>，当前量程 <b>${RANGES[this.range] >= 1000 ? '2 mW' : RANGES[this.range] + ' μW'}</b>`,
        auto: async () => {
          await app.view('探头'); app.select(app.comp('det'));
          await app.tween(() => this.stage, (v) => (this.stage = v), this.center + gauss(0.1), 1400);
          this.range = this.bestRange(); app.changed(); await app.wait(500);
        },
      },
      {
        title: '逐点扫描光强分布',
        html: '<p>把探头移到中央极大一侧第 3 级暗纹以外，然后<b>沿同一方向</b>每隔 0.5 mm 记录一次光功率，直到另一侧第 3 级暗纹以外（约 60 个点）。</p>',
        hint: '底部数据区的“记录并前进一步”会在记录后自动把平移台移动一个步长。',
        check: () => { const r = app.table('scan').completeRows(); if (r.length < 30) return false; const xs = r.map((q) => q.x); const span = Math.max(...xs) - Math.min(...xs); return span > (5 * LAMBDA * (this.L || 800)) / Math.max(0.02, this.a); },
        status: () => `已记录 <b>${app.table('scan').completeRows().length}</b> 点`,
        auto: async () => {
          const half = (3.4 * LAMBDA * this.L) / this.a;
          app.select(app.comp('det'));
          await app.tween(() => this.stage, (v) => (this.stage = v), Math.max(0, this.center - half - 0.6), 1200);
          await app.tween(() => this.stage, (v) => (this.stage = v), Math.round((this.center - half) * 2) / 2, 500);
          const t = app.table('scan');
          const i = app.tables.indexOf(t); app.showTable(i);
          while (this.stage <= this.center + half && this.stage < 50) {
            app.checkAbort();
            if (this.rec(t)) this.stage = Math.round((this.stage + 0.5) * 100) / 100;
            app.changed();
            await app.wait(90);
          }
        },
      },
      {
        title: '数据处理：作光强分布曲线，求缝宽',
        html: '<p>作 $P$–$x$ 曲线，确定各级暗纹位置 $x_{\\pm k}$。远场条件下第 $k$ 级暗纹满足 $a\\sin\\theta_k=k\\lambda$，即</p>$$a=\\frac{k\\lambda L}{\\Delta x_k},\\qquad \\Delta x_k=\\tfrac12(x_{+k}-x_{-k})$$<p>并比较次极大与中央极大的光强比（理论值 4.72%、1.65%）。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const rows = this.app.table('scan').completeRows().slice().sort((a, b) => a.x - b.x);
    if (rows.length < 15) return { html: '<p>数据点太少（至少 15 个，建议 50 个以上）。</p>', ok: false };
    const L = this.L || 800;
    const x = rows.map((r) => r.x), P = rows.map((r) => r.I);
    let c = 0; for (let i = 1; i < P.length; i++) if (P[i] > P[c]) c = i;
    const Pmax = P[c];
    // 抛物线插值求极值位置
    const refine = (i) => { if (i <= 0 || i >= P.length - 1) return x[i]; const y0 = P[i - 1], y1 = P[i], y2 = P[i + 1]; const den = y0 - 2 * y1 + y2; return den === 0 ? x[i] : x[i] + (0.5 * (y0 - y2) / den) * (x[i + 1] - x[i]); };
    const findMin = (dir) => {
      const out = []; let i = c + dir; let last = c;
      while (i > 0 && i < P.length - 1 && out.length < 3) {
        if (P[i] <= P[i - 1] && P[i] <= P[i + 1] && P[i] < 0.3 * Pmax && Math.abs(i - last) >= 3) { out.push({ x: refine(i), i }); last = i; i += dir * 3; continue; }
        i += dir;
      }
      return out;
    };
    const right = findMin(1), left = findMin(-1);
    const n = Math.min(right.length, left.length);
    if (n < 1) return { html: '<p>没有找到中央极大两侧的暗纹，请扩大扫描范围。</p>', ok: false };
    const items = [];
    for (let k = 1; k <= n; k++) { const dx = (right[k - 1].x - left[k - 1].x) / 2; items.push({ k, xl: left[k - 1].x, xr: right[k - 1].x, dx, a: (k * LAMBDA * L) / dx }); }
    const fit = items.length >= 2 ? linFit(items.map((t) => t.k), items.map((t) => t.dx)) : null;
    const as = items.map((t) => t.a);
    const am = mean(as), ua = uA(as);
    const ub = am * Math.hypot(0.01 / Math.sqrt(3) / items[0].dx, 0.5 / Math.sqrt(3) / L);
    const u = Math.hypot(ua, ub);
    const x0 = (items[0].xl + items[0].xr) / 2;
    // 次极大
    const secs = [];
    for (let k = 0; k < n - 1; k++) {
      for (const [arr, s] of [[right, 1], [left, -1]]) {
        const i1 = arr[k].i, i2 = arr[k + 1].i;
        let m = i1; for (let i = Math.min(i1, i2); i <= Math.max(i1, i2); i++) if (P[i] > P[m]) m = i;
        secs.push({ k: k + 1, s, r: P[m] / Pmax });
      }
    }
    const theo = [0.0472, 0.0165];
    const aFit = fit ? (LAMBDA * L) / fit.k : NaN;
    let html = `<h3>暗纹位置</h3><p>单缝到探头距离 $L=${(L / 10).toFixed(1)}$ cm，中央极大 $P_0=${Pmax.toFixed(3)}$ μW，位于 $x≈${x0.toFixed(2)}$ mm。</p>
      <table><tr><th>k</th><th>x<sub>−k</sub>/mm</th><th>x<sub>+k</sub>/mm</th><th>Δx<sub>k</sub>/mm</th><th>a = kλL/Δx<sub>k</sub> /mm</th></tr>
      ${items.map((t) => `<tr><td>${t.k}</td><td>${t.xl.toFixed(2)}</td><td>${t.xr.toFixed(2)}</td><td>${t.dx.toFixed(3)}</td><td>${t.a.toFixed(4)}</td></tr>`).join('')}</table>
      <div class="result-box">$a = ${texU(am, u, 'mm')}$</div>
      ${fit ? `<p>图线法：$\\Delta x_k$ 对 $k$ 线性拟合，斜率 ${fit.k.toFixed(4)} mm，得 $a=\\lambda L/k_{fit}=${aFit.toFixed(4)}$ mm。</p>` : ''}
      <h3>次极大相对光强</h3><table><tr><th>级次</th><th>一侧</th><th>实测 P/P₀</th><th>理论值</th></tr>${secs.map((s) => `<tr><td>${s.k}</td><td>${s.s > 0 ? '右' : '左'}</td><td>${pct(s.r)}</td><td>${pct(theo[s.k - 1] || 0.0083)}</td></tr>`).join('')}</table>
      <div class="plot-wrap"><canvas data-plot="0" style="height:320px"></canvas></div>
      <div class="result-box warn">缝宽参考值 a₀ = ${this.a.toFixed(4)} mm（测微螺旋读数 ${this.aRead.toFixed(3)} mm，零点误差 ${this.a0.toFixed(3)} mm），本次测量相对误差 ${pct(relErr(am, this.a))}。</div>`;
    const theoC = (xx) => Pmax * sinc2(xx - x0, am, LAMBDA, L);
    return {
      html, ok: true,
      answers: [{ label: '缝宽 $a$（各级平均）', unit: 'mm', value: am, alts: fit ? [aFit] : [], digits: 4, tolRel: 0.01 }],
      plots: [{ title: '单缝衍射相对光强分布', xLabel: '探头位置 x / mm', yLabel: 'P / μW', yZero: true, series: [
        { type: 'scatter', data: x.map((xx, i) => [xx, P[i]]), label: '实验数据', radius: 3 },
        { type: 'line', data: fnData(theoC, x[0], x[x.length - 1], 400), label: `夫琅禾费理论曲线 (a=${am.toFixed(4)} mm)`, width: 1.5 },
      ] }],
    };
  }

  principle() {
    return `<h3>1. 菲涅耳衍射与夫琅禾费衍射</h3><p>光通过宽度为 $a$ 的狭缝后，屏上光场由菲涅耳–基尔霍夫衍射积分给出。菲涅耳数</p>$$F=\\frac{a^2}{\\lambda L}$$<p>$F\\gtrsim1$ 时为近场（菲涅耳）衍射，图样与缝的几何投影相近，边缘有振荡；$F\\ll1$ 时为远场（夫琅禾费）衍射。</p>
<h3>2. 夫琅禾费单缝衍射</h3>$$I(\\theta)=I_0\\left(\\frac{\\sin u}{u}\\right)^2,\\qquad u=\\frac{\\pi a\\sin\\theta}{\\lambda}$$
<p>暗纹条件 $a\\sin\\theta=k\\lambda\\ (k=\\pm1,\\pm2,\\dots)$；中央明纹宽度是其他明纹的两倍；次极大光强依次约为中央的 4.72%、1.65%、0.83%。小角度下 $\\sin\\theta\\approx x/L$，故</p>$$a=\\frac{k\\lambda L}{x_k}$$
<h3>3. 本仿真的计算模型</h3><p>程序不直接套用 sinc² 公式，而是对狭缝内的入射高斯光束作数值积分：</p>$$U(x)=\\frac{1}{\\sqrt{i\\lambda L}}\\int_{-a/2}^{a/2}A(\\xi)\\,e^{\\,i\\pi(x-\\xi)^2/\\lambda L}\\,d\\xi$$
<p>采用复合辛普森公式，步长按被积函数的相位变化自适应选取，因此同一模型可以连续地给出从菲涅耳衍射到夫琅禾费衍射的全部图样，也能计算双缝。探头读数对 ${DET_W} mm 宽的探头狭缝取平均，并加入暗电流噪声，光功率计按量程显示有效位数。</p>`;
  }
}
