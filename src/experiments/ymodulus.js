// 实验：拉伸法测钢丝的杨氏模量（光杠杆 · 望远镜尺组 · 逐差法）
// 钢丝伸长模型：ΔL = FL/(ES) + 弯折拉直量（只随历史最大载荷增大，预载后基本消失）+ 弹性后效（滞后于载荷，τ≈12 s）
//               + 底座不水平时下夹头与平台孔壁摩擦造成的“死区”。
// 光杠杆：后足随下夹头下降，镜面转过 δ = ΔL/b；望远镜视线经镜面反射落到标尺上，按精确几何 y = y_hit + D·tan(α + 2φ) 计算读数。
import * as THREE from 'three';
import { meta, thumb } from './ymodulus.meta.js';
import { benchTable, panelMesh } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, canvasTexture } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, linFit, gauss, fmtU } from '../core/Stats.js';
import { Micrometer, Caliper, Tape } from '../core/gauges.js';
import { ymodulusFig } from './mechFigs.js';

const G = 9.794; // 本地重力加速度 m/s²
const NM = 10; // 砝码块数（每块标称 1 kg）
const HANGER = 0.5; // 砝码托质量 kg
const X0 = -110; // 钢丝所在 x（cm）
const YTOP = 121; // 上夹头下沿高度
const RM = 1.6; // 平面镜半径 cm
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;
const TOOLS = [
  { label: 'L', value: 'L', name: '钢卷尺：钢丝长度 L' },
  { label: 'D', value: 'D', name: '钢卷尺：镜面到标尺的距离 D' },
  { label: 'b', value: 'b', name: '游标卡尺：光杠杆臂长 b' },
  { label: 'd', value: 'd', name: '螺旋测微器：钢丝直径 d' },
];
const DIA_ROWS = [['z', '零点（测砧合拢）'], ['t0', '上部 0°'], ['t9', '上部 90°'], ['m0', '中部 0°'], ['m9', '中部 90°'], ['b0', '下部 0°'], ['b9', '下部 90°']];

export class YModulusExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    // ---- 本次实验的“真值” ----
    this.E = rand(1.95, 2.12) * 1e11; // Pa
    this.L = rand(72, 84) / 100; // 钢丝有效长度 m
    this.b = rand(7.1, 7.9) / 100; // 光杠杆臂长 m
    const d0 = rand(0.56, 0.66); // 钢丝平均直径 mm
    this.dia = {}; // 各位置、两个方向的直径（mm）
    for (const p of ['t', 'm', 'b']) { const dp = d0 + rand(-0.004, 0.004), ell = rand(-0.003, 0.003); this.dia[p + '0'] = dp + ell / 2; this.dia[p + '9'] = dp - ell / 2; }
    this.Seff = 1 / mean(['t', 'm', 'b'].map((p) => 1 / ((Math.PI / 4) * this.dia[p + '0'] * this.dia[p + '9'] * 1e-6)));
    this.masses = Array.from({ length: NM }, () => 1 + rand(-0.003, 0.003));
    this.kinkA = rand(0.8, 1.6) * 1e-4; // 弯折拉直的总量 m
    this.F0 = 6; // 弯折拉直的特征力 N
    this.kappa = 0.012; this.tau = 12; // 弹性后效：占弹性伸长的 1.2%，弛豫时间 12 s
    this.tilt = [rand(0.4, 1.1) * (Math.random() < 0.5 ? -1 : 1), rand(0.3, 0.9) * (Math.random() < 0.5 ? -1 : 1)]; // 底座倾斜（°）
    this.mic = new Micrometer({ zero: Math.round(rand(-12, 15)) / 1000 || 0.004 });
    this.cal = new Caliper({ zero: 0 });
    this.tapeL = new Tape({ label: '钢丝长度 L（上夹头下沿 → 下夹头上沿）' });
    this.tapeD = new Tape({ label: '镜尺距离 D（平面镜 → 标尺）' });
    // ---- 仪器状态 ----
    this.nMass = 0; this.Fmax = HANGER * G; this.creep = 0; this.pos = this.target(); this.creep = 0;
    this.swing = 0; this.swPh = 0; this.lastDir = 0;
    this.phi0 = rand(-1.2, 1.2); // 镜面俯仰（°），学生调
    this.D = rand(125, 150); // 镜尺距离 cm（移动望远镜尺组改变）
    this.yt = rand(10, 20); // 望远镜光轴比镜面中心高多少（cm）
    this.alpha = rand(-2, 2); // 望远镜俯仰（°）
    this.focus = rand(80, 160); // 物镜调焦（cm）
    this.dio = 0; this.dioNeed = rand(-2.5, 2.5); // 目镜视度
    this.scale0 = rand(-22, -18); // 标尺 0 刻线相对镜面中心的高度（cm）
    this.tool = 'L'; this.micAt = 'z'; this.assist = false; this.timeScale = 1;
    this.k0 = null; this.snap = null; this._warned = {};
    this.mic.setObject(null); this.mic.gap = 3;
    this.cal.setObject(this.b * 1000);
    this.tapeL.measure(this.L * 100); this.tapeD.measure(this.D);
  }

  // ======================= 物理模型 =======================
  /** 砝码托上的总拉力 N */
  force(n = this.nMass) { let m = HANGER; for (let i = 0; i < n; i++) m += this.masses[i]; return m * G; }
  elastic(F = this.force()) { return (F * this.L) / (this.E * this.Seff); }
  kink() { return this.kinkA * (1 - Math.exp(-this.Fmax / this.F0)); }
  target() { return this.elastic() + this.kink() + this.creep; }
  get tiltMag() { return Math.hypot(this.tilt[0], this.tilt[1]); }
  get yM() { return YTOP - this.L * 100 + 5; } // 镜面中心高度 cm（平台上方 5 cm）

  setMass(n) {
    n = clamp(Math.round(n), 0, NM);
    if (n === this.nMass) return;
    this.lastDir = Math.sign(n - this.nMass);
    this.nMass = n;
    this.Fmax = Math.max(this.Fmax, this.force());
    this.swing = Math.min(0.35, this.swing + 0.16); this.swPh = 0;
    this.app.changed();
  }

  /** 自动操作：等砝码托静止（按仿真时间，而不是墙钟时间） */
  async settle() { await this.app.wait(2500); while (this.swing > 0.004) await this.app.wait(150); }

  tick(dt) {
    const sdt = dt * (this.app.running ? this.app.speed : this.timeScale);
    // 弹性后效：附加伸长以 τ 趋向 κ·ΔL弹
    const cT = this.kappa * this.elastic();
    this.creep = cT + (this.creep - cT) * Math.exp(-sdt / this.tau);
    // 下夹头：摩擦死区（底座不水平时）
    const tg = this.target(), dz = 0.03e-3 * this.tiltMag;
    let p = this.pos;
    if (tg - p > dz) p = tg - dz; else if (p - tg > dz) p = tg + dz;
    const moved = Math.abs(p - this.pos) > 2e-9;
    this.pos = p;
    // 加减砝码后砝码托晃动，标尺像随之抖动
    if (this.swing > 0.002) { this.swing *= Math.exp(-sdt / 0.9); this.swPh += 2 * Math.PI * 1.7 * sdt; this.app.changed(); } else if (this.swing) { this.swing = 0; this.app.changed(); }
    if (moved) this.app.changed();
  }

  /** 望远镜中看到的情况：是否看到镜面、十字叉丝处的标尺读数（cm）、成像模糊量 */
  sight() {
    const a = this.app, lever = a.comp('lever').placed, scope = a.comp('scope').placed;
    const D = this.D, al = (this.alpha * Math.PI) / 180;
    const yHit = this.yt + D * Math.tan(al); // 视线在镜面所在竖直面上的高度（相对镜面中心）
    const onMirror = lever && scope && Math.abs(yHit) < RM;
    const phi = (this.phi0 * Math.PI) / 180 + this.pos / this.b;
    const ys = yHit + D * Math.tan(al + 2 * phi);
    const n = ys - this.scale0 + (this.swing * Math.sin(this.swPh));
    const blurObj = 3 * Math.abs(1 - (2 * D) / this.focus); // 物镜未调焦：标尺像的弥散（cm，按标尺上的尺寸）
    const blurEye = Math.abs(this.dio - this.dioNeed) * 1.6; // 叉丝模糊（像素）
    return { onMirror, n, onScale: n > -0.5 && n < 40.5, yHit, blurObj, blurEye, nTrue: ys - this.scale0 };
  }

  // ======================= 三维场景 =======================
  cameras() {
    return [
      { name: '全景', pos: [10, 165, 300], target: [-5, 58, 0] },
      { name: '光杠杆', pos: [X0 + 30, this.yM + 22, 40], target: [X0 + 4, this.yM - 4, 0] },
      { name: '望远镜尺组', pos: [X0 + this.D - 45, this.yM + 18, 50], target: [X0 + this.D + 8, this.yM - 2, 0] },
      { name: '砝码', pos: [X0 + 30, 40, 70], target: [X0, 22, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(300, 80));
    app.stage.setLightTarget(-40, 40, 0);
    const yP = YTOP - this.L * 100 - 1; // 平台上表面
    this.yP = yP;
    app.addSlot({ id: 'frame', pos: new THREE.Vector3(X0, 0, 0), accepts: ['frame'] });
    app.addSlot({ id: 'lever', pos: new THREE.Vector3(X0, yP, 0), accepts: ['lever'] });
    app.addSlot({ id: 'scope', pos: new THREE.Vector3(X0 + 130, 0, 0), accepts: ['scope'] });

    // ---------- 杨氏模量仪 ----------
    const fr = new THREE.Group(), tiltG = new THREE.Group(); fr.add(tiltG); this.tiltG = tiltG;
    const dark = MAT.paint(0x2b3440), steel = MAT.metal();
    tiltG.add(mesh(new THREE.CylinderGeometry(20, 22, 3, 3), dark, 0, 3.5, 0));
    this.feet = [];
    for (let i = 0; i < 3; i++) { const a = (i * 2 * Math.PI) / 3 + Math.PI / 6; const s = mesh(new THREE.CylinderGeometry(1.2, 1.6, 4, 14), MAT.brass(), 17 * Math.cos(a), 1.5, 17 * Math.sin(a)); fr.add(s); this.feet.push(s); }
    for (const z of [-11, 11]) tiltG.add(mesh(new THREE.CylinderGeometry(1.3, 1.3, YTOP + 3, 18), steel, 0, (YTOP + 3) / 2 + 4, z));
    tiltG.add(mesh(new THREE.BoxGeometry(6, 4, 28), dark, 0, YTOP + 6, 0));
    tiltG.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 4, 16), MAT.brass(), 0, YTOP + 2, 0)); // 上夹头
    // 平台（带圆孔，后部开槽放光杠杆前足）
    const plat = mesh(new THREE.BoxGeometry(14, 1.6, 28), MAT.paint(0x4b5563), 6, yP - 0.8, 0); tiltG.add(plat);
    tiltG.add(mesh(new THREE.BoxGeometry(0.6, 0.3, 10), MAT.black(), this.b * 100, yP + 0.05, 0)); // 前足槽
    // 钢丝、下夹头、砝码托
    const wireLen = this.L * 100;
    this.wire = mesh(new THREE.CylinderGeometry(0.06, 0.06, wireLen, 6), MAT.chrome(), 0, YTOP - wireLen / 2, 0); tiltG.add(this.wire);
    this.lower = new THREE.Group(); tiltG.add(this.lower);
    this.lower.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 5, 18), MAT.brass(), 0, yP - 2.4, 0));
    this.lower.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, yP - 22, 8), steel, 0, (yP - 4.9 + 17) / 2, 0));
    this.lower.add(mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.6, 24), steel, 0, 17, 0)); // 砝码托底盘
    this.disks = [];
    const diskM = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.75, roughness: 0.35 });
    for (let i = 0; i < NM; i++) {
      const d = mesh(new THREE.CylinderGeometry(3.6, 3.6, 1.05, 28), diskM, 0, 17.85 + i * 1.12, 0); d.visible = false; this.lower.add(d); this.disks.push(d);
    }
    // 旁边的砝码架（未挂上的砝码）
    this.rack = [];
    for (let i = 0; i < NM; i++) { const d = mesh(new THREE.CylinderGeometry(3.6, 3.6, 1.05, 28), diskM, 30, 0.55 + i * 1.12, 22); fr.add(d); this.rack.push(d); }
    fr.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 14, 8), steel, 30, 7, 22));
    // 水准泡
    const bub = canvasTexture(128, 128, (c, W) => { c.fillStyle = '#d9e7c5'; c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 2, 0, 7); c.fill(); c.strokeStyle = '#333'; c.lineWidth = 3; c.beginPath(); c.arc(W / 2, W / 2, W * 0.16, 0, 7); c.stroke(); });
    const lv = new THREE.Mesh(new THREE.CircleGeometry(2.2, 28), new THREE.MeshStandardMaterial({ map: bub, roughness: 0.3 })); lv.rotation.x = -Math.PI / 2; lv.position.set(-9, 5.05, 9); lv.userData.noHL = true; tiltG.add(lv);
    this.bubble = mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.85 }), -9, 5.3, 9); tiltG.add(this.bubble);
    app.addComponent(new Component({
      key: 'frame', name: '杨氏模量仪', zone: 'slot', defaultSlot: 'frame', fixed: true, required: true, object: fr, labelY: YTOP + 14,
      icon: SVG('<path d="M14 4v32M40 4v32M10 4h34M27 4v18" stroke="currentColor" stroke-width="2.4" fill="none"/><rect x="22" y="24" width="10" height="9" fill="currentColor"/>'),
      desc: '两根立柱上端的横梁夹住钢丝上端，钢丝下端夹在下夹头里，下夹头穿过平台中间的圆孔，下面挂砝码托。三个底脚螺丝用来把底座调水平，水平时钢丝竖直，下夹头在孔中不与孔壁摩擦。砝码每块标称 1.000 kg，共 10 块。',
      controls: () => [
        { type: 'knob', label: '底脚螺丝 A（前后）', get: () => this.tilt[0], set: (v) => (this.tilt[0] = clamp(v, -3, 3)), step: 0.01, bigStep: 0.1, perRev: 0.5, fmt: () => '旋转螺丝' },
        { type: 'knob', label: '底脚螺丝 B（左右）', get: () => this.tilt[1], set: (v) => (this.tilt[1] = clamp(v, -3, 3)), step: 0.01, bigStep: 0.1, perRev: 0.5, fmt: () => '旋转螺丝' },
        { type: 'readout', label: '水准泡', get: () => this.levelText() },
        { type: 'button', label: '加一块砝码（1 kg）', onClick: () => (this.nMass < NM ? this.setMass(this.nMass + 1) : app.toast('砝码已经全部挂上', 'warn')) },
        { type: 'button', label: '取下一块砝码', onClick: () => (this.nMass > 0 ? this.setMass(this.nMass - 1) : app.toast('砝码托上已经没有砝码', 'warn')) },
        { type: 'readout', label: '砝码托上', get: () => `${this.nMass} 块（标称 ${this.nMass}.000 kg）` },
      ],
    }));

    // ---------- 光杠杆 ----------（材质单独创建：选中某件仪器时只高亮它自己）
    { const steel = MAT.metal(), dark = MAT.paint(0x2b3440);
    const lg = new THREE.Group();
    const b = this.b * 100;
    lg.add(mesh(new THREE.BoxGeometry(b + 1, 0.5, 1.6), MAT.paint(0x374151), b / 2, 1.6, 0)); // 纵臂
    lg.add(mesh(new THREE.BoxGeometry(1.6, 0.5, 6), MAT.paint(0x374151), b, 1.6, 0)); // 前横梁
    for (const [x, z] of [[0, 0], [b, -2.6], [b, 2.6]]) { const f = mesh(new THREE.ConeGeometry(0.35, 1.4, 10), steel, x, 0.7, z); f.rotation.x = Math.PI; lg.add(f); }
    this.mirrorG = new THREE.Group(); this.mirrorG.position.set(b, 5, 0); lg.add(this.mirrorG);
    this.mirrorG.add(mesh(new THREE.CylinderGeometry(RM + 0.3, RM + 0.3, 0.5, 32), MAT.black(), -0.3, 0, 0).rotateZ(Math.PI / 2));
    const mir = mesh(new THREE.CircleGeometry(RM, 32), new THREE.MeshStandardMaterial({ color: 0xdfe8f2, metalness: 1, roughness: 0.05 }), 0, 0, 0); mir.rotation.y = Math.PI / 2; this.mirrorG.add(mir);
    lg.add(mesh(new THREE.BoxGeometry(0.4, 3.6, 0.4), steel, b - 0.4, 3.2, 0));
    app.addComponent(new Component({
      key: 'lever', name: '光杠杆', zone: 'slot', defaultSlot: 'lever', required: true, object: lg, labelY: 10,
      icon: SVG('<path d="M8 30l32-0M8 30v4M40 30v4" stroke="currentColor" stroke-width="2.4" fill="none"/><rect x="38" y="8" width="4" height="20" fill="currentColor"/>'),
      desc: '三足支架上装一块小平面镜。两个前足放在平台的槽里，后足尖放在下夹头上端。钢丝伸长时后足随下夹头下降，镜面绕前足连线转过 δ ≈ ΔL/b。镜面的俯仰可以调节。',
      controls: () => [
        { type: 'knob', label: '镜面俯仰', get: () => this.phi0, set: (v) => (this.phi0 = clamp(v, -4, 4)), step: 0.005, bigStep: 0.1, perRev: 1, fmt: () => '转动镜面', sub: '使标尺的像落在望远镜视场中央，且镜面大致竖直' },
      ],
    }));

    // ---------- 望远镜尺组 ----------
    const sg = new THREE.Group(), inner = new THREE.Group(); sg.add(inner); this.scopeInner = inner;
    inner.add(mesh(new THREE.CylinderGeometry(9, 10, 2, 28), dark, 0, 1, 0));
    inner.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, this.yM + 30, 16), steel, 3, (this.yM + 30) / 2 + 2, -4));
    // 竖直标尺（面向 −x）
    const scTex = canvasTexture(128, 2048, (c, W, H) => {
      c.fillStyle = '#f7f6f0'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#111';
      for (let k = 0; k <= 400; k++) { const y = H - (k / 400) * H; const L = k % 10 === 0 ? W * 0.5 : k % 5 === 0 ? W * 0.34 : W * 0.2; c.fillRect(0, y - 1, L, 2); if (k % 10 === 0 && k > 0 && k < 400) { c.font = 'bold 30px Arial'; c.fillText(String(k / 10), W * 0.56, y + 10); } }
    });
    const ruler = new THREE.Mesh(new THREE.PlaneGeometry(4, 40), new THREE.MeshStandardMaterial({ map: scTex, roughness: 0.7 }));
    ruler.rotation.y = -Math.PI / 2; ruler.position.set(0, this.yM + this.scale0 + 20, 0); ruler.userData.noHL = true; inner.add(ruler);
    inner.add(mesh(new THREE.BoxGeometry(0.6, 41, 4.6), MAT.paint(0x8b8f96), 0.4, this.yM + this.scale0 + 20, 0));
    // 望远镜（可升降、俯仰）
    this.tel = new THREE.Group(); inner.add(this.tel);
    const tube = mesh(new THREE.CylinderGeometry(1.3, 1.5, 24, 20), MAT.paint(0x1f2937), 0, 0, 0); tube.rotation.z = Math.PI / 2; this.tel.add(tube);
    const obj = mesh(new THREE.CylinderGeometry(1.9, 1.9, 3, 20), MAT.black(), -11, 0, 0); obj.rotation.z = Math.PI / 2; this.tel.add(obj);
    const eye = mesh(new THREE.CylinderGeometry(1, 1, 4, 16), MAT.black(), 13, 0, 0); eye.rotation.z = Math.PI / 2; this.tel.add(eye);
    this.tel.add(mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), MAT.black(), -8, 1.7, 0), mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), MAT.black(), 6, 1.7, 0)); // 准星、缺口
    this.telArm = mesh(new THREE.BoxGeometry(3, 1.4, 6), steel, 3, 0, -2); inner.add(this.telArm);
    app.addComponent(new Component({
      key: 'scope', name: '望远镜尺组', zone: 'slot', defaultSlot: 'scope', required: true, object: sg, labelY: this.yM + 36,
      icon: SVG('<rect x="12" y="14" width="30" height="7" fill="currentColor"/><path d="M50 4v32" stroke="currentColor" stroke-width="3"/><path d="M27 21v15M18 36h18" stroke="currentColor" stroke-width="2.4"/>'),
      desc: '竖直标尺（mm 分度）旁边装一架望远镜，望远镜可以升降和俯仰，物镜可调焦，目镜可调视度，镜筒上有准星和缺口用于粗瞄。整套放在距光杠杆约 1.2–2 m 处，标尺经平面镜反射后在望远镜中成像，十字叉丝横线所对的刻度就是读数。',
      controls: () => [
        { type: 'knob', label: '整体前后移动（改变 D）', get: () => this.D, set: (v) => (this.D = clamp(v, 100, 205)), step: 0.5, bigStep: 5, perRev: 20, fmt: () => '推动底座', sub: 'D 越大放大倍数越大，但标尺像越难找；移动后要重新调焦，D 要重新测' },
        { type: 'knob', label: '望远镜升降', get: () => this.yt, set: (v) => (this.yt = clamp(v, -20, 30)), step: 0.1, bigStep: 1, perRev: 5, fmt: () => '升降望远镜' },
        { type: 'knob', label: '望远镜俯仰', get: () => this.alpha, set: (v) => (this.alpha = clamp(v, -8, 8)), step: 0.01, bigStep: 0.2, perRev: 1, fmt: () => '俯仰螺钉' },
        { type: 'knob', label: '物镜调焦', get: () => this.focus, set: (v) => (this.focus = clamp(v, 60, 600)), step: 1, bigStep: 20, perRev: 80, fmt: () => '调焦手轮', sub: '使标尺的像清晰（像在叉丝平面上，眼睛上下移动时叉丝与刻度无相对移动）' },
        { type: 'knob', label: '目镜视度', get: () => this.dio, set: (v) => (this.dio = clamp(v, -5, 5)), step: 0.1, bigStep: 1, perRev: 4, digits: 1, unit: 'D', sub: '先把叉丝调清楚' },
        { type: 'readout', label: '沿准星与缺口看去', get: () => this.coarseText() },
      ],
    }));

    }
    this.tv = app.addView({ id: 'tel', title: '望远镜视场', w: 250, h: 250, res: 1.6 });
    this.gv = app.addView({ id: 'tool', title: '量具读数', w: 330, h: 150, res: 1.8 });
  }

  levelText() {
    const [a, b] = this.tilt, f = (v) => (Math.abs(v) < 0.05 ? '居中' : `偏${v > 0 ? '前' : '后'} ${(Math.abs(v) / 0.1).toFixed(1)} 格`);
    const g = (v) => (Math.abs(v) < 0.05 ? '居中' : `偏${v > 0 ? '右' : '左'} ${(Math.abs(v) / 0.1).toFixed(1)} 格`);
    return `前后 ${f(a)}，左右 ${g(b)}（1 格 = 0.1°）`;
  }
  coarseText() {
    const s = this.sight();
    if (!this.app.comp('lever').placed) return '平台上还没有放光杠杆';
    if (Math.abs(s.yHit) >= RM) return `视线从镜面${s.yHit > 0 ? '上方' : '下方'}掠过，要调望远镜高低或俯仰`;
    if (!s.onScale) return `镜中看到的是标尺${s.n > 40 ? '上方' : '下方'}的墙面，调镜面俯仰`;
    return '镜中能看到标尺的像';
  }

  canPlace(comp) {
    if (comp.key === 'lever' && !this.app.comp('frame').placed) return '先放好杨氏模量仪';
    return null;
  }
  onPlace(c) { if (c.key === 'scope' || c.key === 'lever') this.tapeD.measure(this.D); }

  update() {
    const a = this.app;
    // 三维姿态
    const k = Math.PI / 180 * 2.5; // 倾斜放大显示
    this.tiltG.rotation.set(this.tilt[0] * k, 0, -this.tilt[1] * k);
    this.lower.position.y = -this.pos * 100 - this.swing * 0.15 * Math.sin(this.swPh);
    for (let i = 0; i < NM; i++) { this.disks[i].visible = i < this.nMass; this.rack[i].visible = i < NM - this.nMass; }
    this.bubble.position.set(-9 - this.tilt[1] * 1.4, 5.3, 9 - this.tilt[0] * 1.4);
    this.mirrorG.rotation.z = -((this.phi0 * Math.PI) / 180 + this.pos / this.b) * 3;
    this.scopeInner.position.x = this.D - 130 + (this.b * 100);
    this.tel.position.set(-1, this.yM + this.yt, -4);
    this.tel.rotation.z = -(this.alpha * Math.PI) / 180;
    this.telArm.position.y = this.yM + this.yt;
    this.drawScope();
    this.drawTool();
  }

  // ======================= 观察窗 =======================
  drawScope() {
    const v = this.tv, g = v.ctx, W = v.W, H = v.H, cx = W / 2, cy = H / 2, R = W * 0.45;
    g.fillStyle = '#060708'; g.fillRect(0, 0, W, H);
    const s = this.sight(), scopeOn = this.app.comp('scope').placed;
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    const ppc = R / 2.6; // 视场中每 cm 标尺的像素数
    const bl = Math.min(18, s.blurObj * ppc * 0.5);
    g.filter = bl > 0.4 ? `blur(${bl.toFixed(1)}px)` : 'none';
    if (!scopeOn) { g.fillStyle = '#0b0c0d'; g.fillRect(0, 0, W, H); }
    else if (!s.onMirror) { g.fillStyle = '#4b4f52'; g.fillRect(0, 0, W, H); g.fillStyle = '#5a5e61'; g.fillRect(0, cy + R * 0.2 + s.yHit * 4, W, R); }
    else if (!s.onScale) { g.fillStyle = '#7d8186'; g.fillRect(0, 0, W, H); }
    else {
      // 标尺的像：白底，左缘刻线，向上读数增大
      g.fillStyle = '#5a5e61'; g.fillRect(0, 0, W, H);
      const x1 = cx - R * 0.55, x2 = cx + R * 0.75;
      const yOf = (val) => cy - (val - s.n) * ppc;
      g.fillStyle = '#f2f1ea'; g.fillRect(x1, Math.max(0, yOf(40)), x2 - x1, Math.min(H, yOf(0)) - Math.max(0, yOf(40)));
      g.fillStyle = '#121212'; g.textAlign = 'left'; g.font = `bold ${Math.round(ppc * 0.42)}px Arial`;
      for (let m = Math.max(0, Math.floor((s.n - 3) * 10)); m <= Math.min(400, Math.ceil((s.n + 3) * 10)); m++) {
        const y = yOf(m / 10), L = m % 10 === 0 ? R * 0.55 : m % 5 === 0 ? R * 0.38 : R * 0.24;
        g.fillRect(x1, y - 0.9, L, 1.8);
        if (m % 10 === 0) g.fillText(String(m / 10), x1 + R * 0.62, y + ppc * 0.15);
      }
    }
    g.restore(); g.filter = 'none';
    // 十字叉丝（目镜视度不对时模糊）
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    g.filter = s.blurEye > 0.4 ? `blur(${s.blurEye.toFixed(1)}px)` : 'none';
    g.strokeStyle = '#111'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    g.beginPath(); g.moveTo(cx - R * 0.18, cy - R * 0.4); g.lineTo(cx + R * 0.18, cy - R * 0.4); g.moveTo(cx - R * 0.18, cy + R * 0.4); g.lineTo(cx + R * 0.18, cy + R * 0.4); g.stroke();
    g.restore(); g.filter = 'none';
    g.strokeStyle = '#1b1d1f'; g.lineWidth = W * 0.02; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    if (this.assist && s.onMirror && s.onScale) { g.fillStyle = 'rgba(18,20,22,.82)'; g.fillRect(W - 96, 6, 90, 22); g.fillStyle = '#8fe3a5'; g.font = '14px Consolas'; g.textAlign = 'right'; g.fillText(`${s.n.toFixed(2)} cm`, W - 10, 22); }
    let foot;
    if (!scopeOn) foot = '望远镜尺组还没有放上实验台';
    else if (!this.app.comp('lever').placed) foot = '看不到平面镜：光杠杆还没有放到平台上';
    else if (!s.onMirror) foot = '视场中没有平面镜：先沿镜筒上的缺口和准星瞄准平面镜';
    else if (!s.onScale) foot = '看到了平面镜，但镜中不是标尺：调镜面俯仰';
    else if (s.blurEye > 1.5) foot = '叉丝模糊：调目镜视度';
    else if (s.blurObj > 0.08) foot = '标尺像模糊：调物镜焦距';
    else if (this.swing > 0.01) foot = '标尺像在晃动：等砝码托静止后再读数';
    else foot = '读十字叉丝横线所对的刻度（mm 分度，估读到 0.1 mm）';
    v.foot(foot);
  }

  gauge() { return this.tool === 'd' ? this.mic : this.tool === 'b' ? this.cal : this.tool === 'L' ? this.tapeL : this.tapeD; }
  drawTool() {
    const v = this.gv, g = v.ctx, W = v.W, H = v.H;
    const o = { assist: this.assist };
    if (Math.abs(this.tapeD.value - this.D) > 1e-6) this.tapeD.measure(this.D);
    if (this.tool === 'L') this.tapeL.draw(g, W, H, { ...o, mark: '下夹头上沿' });
    else if (this.tool === 'D') this.tapeD.draw(g, W, H, { ...o, mark: '标尺面' });
    else if (this.tool === 'b') this.cal.draw(g, W, H, o);
    else this.mic.draw(g, W, H, o);
    const t = TOOLS.find((t) => t.value === this.tool).name + (this.tool === 'd' ? ` · ${DIA_ROWS.find((r) => r[0] === this.micAt)[1]}` : '');
    const p = this.tool === 'd' ? this.mic.problem() : this.tool === 'b' ? this.cal.problem() : null;
    v.foot(p ? `${t} —— ${p}` : t);
  }

  globalControls() {
    const a = this.app, rer = () => { a.renderInspector(); a.changed(); };
    const out = [
      { type: 'segment', label: '量具', get: () => this.tool, set: (v) => { this.tool = v; if (v === 'L') this.tapeL.measure(this.L * 100); if (v === 'D') this.tapeD.measure(this.D); rer(); }, options: TOOLS.map((t) => ({ label: t.label, value: t.value })) },
    ];
    if (this.tool === 'd') {
      out.push({ type: 'select', label: '螺旋测微器测哪里', get: () => this.micAt, set: (v) => { this.micAt = v; this.mic.setObject(v === 'z' ? null : this.dia[v]); a.changed(); }, options: DIA_ROWS.map(([value, label]) => ({ label, value })) });
      out.push(...this.mic.controls(() => a.changed()));
    } else if (this.tool === 'b') {
      out.push(...this.cal.controls(() => a.changed()));
    } else {
      out.push({ type: 'button', label: '重新拉尺测一次', onClick: () => { if (this.tool === 'L') this.tapeL.measure(this.L * 100); else this.tapeD.measure(this.D); a.changed(); } });
    }
    out.push(
      { type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×4', value: 4 }] },
      { type: 'toggle', label: '读数辅助（显示数值）', get: () => this.assist, set: (v) => (this.assist = v) },
    );
    return out;
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'load', title: '加载与减载时的标尺读数', fixedRows: true,
        initRows: () => Array.from({ length: 8 }, (_, i) => ({ i, m: i })),
        columns: [
          { key: 'm', label: '增加的砝码 m/kg', digits: 0, readonly: true },
          { key: 'n1', label: '加载 n/cm', digits: 2, readTol: 0.03 },
          { key: 'n2', label: '减载 n′/cm', digits: 2, readTol: 0.03 },
          { key: 'nb', label: '平均 n̄/cm', digits: 3, calc: (r) => (r.n1 + r.n2) / 2 },
        ],
        buttons: [{ label: '记录（加载）', onClick: (t) => this.recLoad(t, 'n1') }, { label: '记录（减载）', onClick: (t) => this.recLoad(t, 'n2') }],
        note: '加好预载砝码、调好望远镜后记下 n₀（第 0 行），以后每加 1 kg 记一次，到 7 kg 后再每次减 1 kg 记 n′。记录 n₀ 以后不要再动望远镜、标尺和光杠杆。',
      },
      {
        id: 'len', title: '长度测量', fixedRows: true,
        initRows: () => [{ q: 'L', what: '钢丝长度 L / cm' }, { q: 'D', what: '镜尺距离 D / cm' }, { q: 'b', what: '光杠杆臂长 b / mm' }],
        columns: [{ key: 'what', label: '待测量', type: 'text', readonly: true }, { key: 'v', label: '测量值', digits: 2, readTol: 0.05 }],
        buttons: [{ label: '记录当前量具读数', onClick: (t) => this.recLen(t) }],
        note: 'L、D 用钢卷尺测（估读到 0.1 mm），b 用游标卡尺测光杠杆三足在纸上压出的印痕：后足尖到两前足尖连线的垂直距离。',
      },
      {
        id: 'dia', title: '钢丝直径（螺旋测微器）', fixedRows: true,
        initRows: () => DIA_ROWS.map(([k, what]) => ({ k, what })),
        columns: [{ key: 'what', label: '位置', type: 'text', readonly: true }, { key: 'r', label: '读数/mm', digits: 3, readTol: 0.0025 }, { key: 'd', label: '直径 d/mm', digits: 3, calc: (r, i, rows) => (r.k === 'z' ? NaN : r.r - rows[0].r) }],
        buttons: [{ label: '记录当前读数', onClick: (t) => this.recDia(t) }],
        note: '先合拢测砧读零点（读数可正可负），再在钢丝上、中、下三处，每处相互垂直的两个方向各测一次。直径 = 读数 − 零点读数。',
      },
    ];
  }

  setupOk(quiet = false) {
    const a = this.app, s = this.sight(), warn = (m) => { if (!quiet) a.toast(m, 'warn'); return false; };
    if (!a.comp('lever').placed || !a.comp('scope').placed) return warn('光杠杆和望远镜尺组都要放好');
    if (!s.onMirror) return warn('望远镜里看不到平面镜');
    if (!s.onScale) return warn('望远镜里看不到标尺的像');
    if (s.blurEye > 1.5) return warn('叉丝不清楚：先调目镜视度');
    if (s.blurObj > 0.08) return warn('标尺像不清楚（有视差）：调物镜焦距');
    return true;
  }
  recLoad(t, col) {
    const a = this.app;
    if (!this.setupOk()) return;
    if (this.swing > 0.01) a.toast('标尺像还在晃动，读数不准；应等砝码托静止后再读', 'warn');
    if (this.k0 == null) {
      if (col !== 'n1') return a.toast('先在加载过程中记录 n₀', 'warn');
      this.k0 = this.nMass; this.snap = this.sig();
      if (this.nMass < 2) a.toast('砝码托上不到 2 kg：钢丝可能还没有拉直，前几组数据会偏大（应先加预载砝码）', 'warn');
      if (this.tiltMag > 0.15) a.toast('提示：底座没有调水平，下夹头会和平台孔壁摩擦', 'warn');
    } else if (this.sig() !== this.snap && !this._warned.snap) {
      this._warned.snap = true;
      a.toast('记录 n₀ 以后动过望远镜、标尺或光杠杆，前后读数不再可比，应重新测量（清空表格重来）', 'warn');
    }
    const i = this.nMass - this.k0;
    if (i < 0 || i > 7) return a.toast(`现在砝码托上比 n₀ 时多 ${i} kg，不在表格范围（0–7 kg）内`, 'warn');
    if (col === 'n1' && this.lastDir < 0 && i > 0) a.toast('这是减载后的状态，应记在“减载”一列', 'warn');
    if (col === 'n2' && this.lastDir > 0 && i < 7) a.toast('这是加载后的状态，应记在“加载”一列', 'warn');
    t.set(i, col, Math.round(this.sight().n * 100) / 100);
  }
  sig() { return [this.phi0, this.alpha, this.yt, this.D].map((v) => v.toFixed(4)).join(','); }
  recLen(t) {
    const a = this.app, q = this.tool;
    if (q === 'd') return a.toast('直径记在下一张表里', 'warn');
    if (q === 'b') { const p = this.cal.problem(); if (p) a.toast(p, 'warn'); }
    if (q === 'D' && !a.comp('scope').placed) return a.toast('望远镜尺组还没有放好', 'warn');
    const i = t.rows.findIndex((r) => r.q === q);
    const v = q === 'L' ? this.tapeL.reading : q === 'D' ? this.tapeD.reading : this.cal.reading;
    t.set(i, 'v', Math.round(v * 100) / 100);
  }
  recDia(t) {
    const a = this.app;
    if (this.tool !== 'd') return a.toast('先在“量具”中选螺旋测微器', 'warn');
    const p = this.mic.problem();
    if (p) { if (this.mic.squeeze > 0.0015) a.toast(p, 'warn'); else a.toast(p, 'warn'); }
    const i = t.rows.findIndex((r) => r.k === this.micAt);
    t.set(i, 'r', Math.round(this.mic.reading * 1000) / 1000);
  }

  // ======================= 自动操作 =======================
  async knob(get, set, to, ms = 500) { await this.app.tween(get, set, to, ms); set(to); this.app.changed(); }
  steps() {
    const app = this.app, done = (id, k) => app.table(id).rows.filter((r) => r[k] != null && r[k] !== '' && isFinite(r[k])).length;
    return [
      {
        title: '调底座水平，加预载砝码',
        html: '<p>调节两个底脚螺丝，使水准泡居中——这时钢丝竖直，下夹头能在平台圆孔中自由上下。然后在砝码托上先挂 <b>2 kg</b> 预载砝码，把钢丝拉直。</p>',
        hint: '底座不水平时，下夹头会与孔壁摩擦，钢丝伸长时下夹头“一顿一顿”地移动，加载、减载的读数差变大。',
        check: () => this.tiltMag < 0.1 && this.nMass >= 2,
        auto: async () => {
          await app.view('砝码'); app.select(app.comp('frame'));
          await this.knob(() => this.tilt[0], (v) => (this.tilt[0] = v), rand(-0.03, 0.03));
          await this.knob(() => this.tilt[1], (v) => (this.tilt[1] = v), rand(-0.03, 0.03));
          for (let k = this.nMass; k < 2; k++) { this.setMass(k + 1); await app.wait(400); }
        },
      },
      {
        title: '放置光杠杆和望远镜尺组',
        html: '<p>把光杠杆的两个前足放进平台的槽里，后足尖放在下夹头上端面。望远镜尺组放在距平面镜约 1.2–2 m 处，标尺竖直。</p>',
        check: () => app.comp('lever').placed && app.comp('scope').placed,
        auto: async () => { await app.view('全景'); await app.autoPlace('lever'); await app.autoPlace('scope'); },
      },
      {
        title: '调节望远镜，看清标尺的像',
        html: '<p>① 目测：调望远镜高低，使镜筒与平面镜大致等高；沿镜筒上方的缺口和准星看去，调望远镜俯仰对准平面镜，再调镜面俯仰，直到在镜中看到标尺的像。② 调目镜视度，使十字叉丝清晰。③ 调物镜焦距，使标尺的像清晰，眼睛上下移动时叉丝与刻度无相对移动（无视差）。</p>',
        hint: '读数 n₀ 最好在望远镜所在高度附近（镜面接近竖直），这时放大公式的近似最好。',
        check: () => this.setupOk(true),
        auto: async () => {
          const tel = app.comp('scope'); app.select(tel);
          await app.view('望远镜尺组');
          await this.knob(() => this.yt, (v) => (this.yt = v), rand(1, 3));
          const aim = (Math.atan(-this.yt / this.D) * 180) / Math.PI;
          await this.knob(() => this.alpha, (v) => (this.alpha = v), aim);
          app.select(app.comp('lever')); await app.view('光杠杆');
          // 使标尺上望远镜高度附近的刻度出现在叉丝处
          const al = (this.alpha * Math.PI) / 180, yHit = this.yt + this.D * Math.tan(al);
          const want = this.yt + rand(-1.5, 1.5);
          const phi = (Math.atan((want - yHit) / this.D) - al) / 2 - this.pos / this.b;
          await this.knob(() => this.phi0, (v) => (this.phi0 = v), (phi * 180) / Math.PI);
          app.select(tel); await app.view('望远镜尺组');
          await this.knob(() => this.dio, (v) => (this.dio = v), Math.round(this.dioNeed * 10) / 10);
          await this.knob(() => this.focus, (v) => (this.focus = v), Math.round(2 * this.D));
        },
      },
      {
        title: '逐次加载，记录读数 n',
        html: '<p>记下此时的读数 n₀，然后每加 1 kg 砝码记一次读数，直到增加 7 kg。加砝码要轻放，等标尺像稳定后再读。</p>',
        check: () => done('load', 'n1') >= 8,
        auto: async () => {
          app.showTable(0); app.select(app.comp('frame'));
          for (let i = 0; i < 8; i++) {
            if (i > 0) this.setMass(this.nMass + 1);
            await this.settle(); await app.record('load', 0);
          }
        },
      },
      {
        title: '逐次减载，记录读数 n′',
        html: '<p>再每次取下 1 kg，记录读数 n′，直到回到 n₀ 时的载荷。加载和减载读数取平均，可以消除弹性滞后的影响。</p>',
        check: () => done('load', 'n2') >= 8,
        auto: async () => {
          app.showTable(0);
          // 学生中途可能加减过砝码：按 n₀ 时的载荷逐级回到 +7 kg … +0 kg，每级都记
          const k0 = this.k0 ?? Math.max(0, this.nMass - 7);
          if (this.nMass !== k0 + 7) { this.setMass(k0 + 7); this.lastDir = -1; await this.settle(); }
          await app.wait(1500); await app.record('load', 1);
          for (let i = 6; i >= 0; i--) { this.setMass(k0 + i); await this.settle(); await app.record('load', 1); }
        },
      },
      {
        title: '测量 L、D、b',
        html: '<p>用钢卷尺量钢丝长度 L（上夹头下沿到下夹头上沿）和镜面到标尺的距离 D；取下光杠杆，在纸上压出三足的印痕，用游标卡尺量后足到两前足连线的垂直距离 b。</p>',
        check: () => done('len', 'v') >= 3,
        auto: async () => {
          app.showTable(1);
          for (const q of ['L', 'D', 'b']) {
            this.tool = q; if (q === 'L') this.tapeL.measure(this.L * 100); if (q === 'D') this.tapeD.measure(this.D);
            app.renderInspector(); app.changed();
            if (q === 'b') { this.cal.open = this.b * 1000 + 6; await this.knob(() => this.cal.open, (v) => this.cal.push(v), this.b * 1000); }
            await app.wait(500); await app.record('len');
          }
        },
      },
      {
        title: '测量钢丝直径 d',
        html: '<p>用螺旋测微器先读零点，再在钢丝上、中、下三处各测相互垂直的两个直径。测砧接近钢丝时改用测力装置（棘轮），听到“咔咔”声即停。</p>',
        check: () => done('dia', 'r') >= 7,
        auto: async () => {
          app.showTable(2); this.tool = 'd'; app.renderInspector();
          for (const [k] of DIA_ROWS) {
            this.micAt = k; this.mic.setObject(k === 'z' ? null : this.dia[k]); app.changed();
            const stop = k === 'z' ? 0 : this.dia[k];
            await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), stop + 0.08, 300);
            await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), stop - 0.01, 300);
            await app.wait(300); await app.record('dia');
            this.mic.turnRatchet(stop + 0.5);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>用逐差法求每增加 4 kg 时读数的平均变化 Δn，计算 E 及其不确定度。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app;
    const rows = a.table('load').rows;
    const nOf = (r) => { const v = [r.n1, r.n2].filter((x) => x != null && x !== '' && isFinite(x)); return v.length ? mean(v.map(Number)) : NaN; };
    const nb = rows.map(nOf);
    if (nb.some((x) => !isFinite(x))) return { html: '<p>请先完成 0–7 kg 的读数（至少要有加载读数）。</p>', ok: false };
    const lv = Object.fromEntries(a.table('len').rows.map((r) => [r.q, +r.v]));
    if (!['L', 'D', 'b'].every((k) => isFinite(lv[k]) && lv[k] > 0)) return { html: '<p>请先测量 L、D、b。</p>', ok: false };
    const dr = a.table('dia').rows, z = +dr[0].r;
    const ds = dr.slice(1).map((r) => +r.r - z).filter((x) => isFinite(x) && x > 0);
    if (!isFinite(z) || ds.length < 3) return { html: '<p>请先用螺旋测微器测零点和钢丝直径（至少 3 次）。</p>', ok: false };
    const both = rows.every((r) => isFinite(r.n1) && isFinite(r.n2) && r.n1 !== '' && r.n2 !== '');
    // 逐差法
    const d4 = [0, 1, 2, 3].map((i) => nb[i + 4] - nb[i]);
    const dn = mean(d4), uA = stdev(d4) / 2, uB = 0.05 / Math.sqrt(3) / 10 * Math.SQRT2; // 读数估读 0.05 mm，差值含两次读数
    const udn = Math.hypot(uA, uB);
    const dm = mean(ds), udA = ds.length > 1 ? stdev(ds) / Math.sqrt(ds.length) : 0, ud = Math.hypot(udA, 0.004 / Math.sqrt(3));
    const L = lv.L / 100, D = lv.D / 100, b = lv.b / 1000, d = dm / 1000, F4 = 4 * 1.000 * G;
    const E = (8 * F4 * L * D) / (Math.PI * d * d * b * (dn / 100));
    const rel = { L: 0.05 / lv.L, D: 0.05 / lv.D, b: 0.02 / Math.sqrt(3) / lv.b, d: ud / dm, dn: udn / dn };
    const rE = Math.sqrt(rel.L ** 2 + rel.D ** 2 + rel.b ** 2 + (2 * rel.d) ** 2 + rel.dn ** 2), uE = E * rE;
    const fit = linFit(rows.map((r) => r.m), nb);
    const Efit = (8 * 1.000 * G * L * D) / (Math.PI * d * d * b * (fit.k / 100));
    const f = (x, n = 2) => x.toFixed(n);
    let html = `<h3>1. 标尺读数与逐差</h3><table><tr><th>m/kg</th>${rows.map((r) => `<td>${r.m}</td>`).join('')}</tr><tr><th>n̄/cm</th>${nb.map((x) => `<td>${f(x, 3)}</td>`).join('')}</tr></table>
      <table><tr><th></th><th>n̄₄−n̄₀</th><th>n̄₅−n̄₁</th><th>n̄₆−n̄₂</th><th>n̄₇−n̄₃</th></tr><tr><th>Δn/cm</th>${d4.map((x) => `<td>${f(x, 3)}</td>`).join('')}</tr></table>
      <p>$\\overline{\\Delta n}=${f(dn, 3)}$ cm（对应 4 kg），$u_A=${f(uA, 4)}$ cm，$u_B=${f(uB, 4)}$ cm，$u(\\Delta n)=${f(udn, 4)}$ cm。${both ? '' : '（只有加载读数，未能用减载读数抵消弹性滞后。）'}</p>`;
    html += `<h3>2. 钢丝直径</h3><p>零点读数 ${f(z, 3)} mm；修正后 ${ds.map((x) => x.toFixed(3)).join('、')} mm，$\\bar d=${f(dm, 4)}$ mm，$u(d)=${f(ud, 4)}$ mm。</p>
      <p>L = ${f(lv.L)} cm，D = ${f(lv.D)} cm，b = ${f(lv.b)} mm；光杠杆放大倍数 $2D/b=${f((2 * lv.D * 10) / lv.b, 1)}$。</p>`;
    html += `<h3>3. 杨氏模量</h3>$$E=\\frac{8FLD}{\\pi d^2b\\,\\Delta n}=\\frac{8\\times${f(F4, 3)}\\times${f(L, 4)}\\times${f(D, 4)}}{\\pi\\times(${f(dm, 4)}\\times10^{-3})^2\\times${f(b, 5)}\\times${f(dn / 100, 5)}}=${f(E / 1e11, 3)}\\times10^{11}\\ \\text{Pa}$$
      <p>相对不确定度 $\\dfrac{u(E)}{E}=\\sqrt{\\left(\\dfrac{u_L}{L}\\right)^2+\\left(\\dfrac{u_D}{D}\\right)^2+\\left(\\dfrac{u_b}{b}\\right)^2+\\left(\\dfrac{2u_d}{d}\\right)^2+\\left(\\dfrac{u_{\\Delta n}}{\\Delta n}\\right)^2}=${pct(rE, 2)}$，其中直径一项 ${pct(2 * rel.d, 2)}、Δn 一项 ${pct(rel.dn, 2)}。</p>
      <div class="result-box">$E=${fmtU(E / 1e11, uE / 1e11)}\\times10^{11}$ Pa</div>
      <p>用最小二乘法拟合 n̄–m（斜率 ${f(fit.k, 4)} cm/kg，r = ${f(fit.r, 5)}）得 $E=${f(Efit / 1e11, 3)}\\times10^{11}$ Pa，与逐差法一致。</p>`;
    const notes = [];
    const firstStep = nb[1] - nb[0], restStep = (nb[7] - nb[1]) / 6;
    if (this.k0 != null && this.k0 < 2 && firstStep > restStep * 1.08) notes.push('前一两组读数间隔明显偏大：钢丝没有预先拉直');
    if (both && mean(rows.map((r) => Math.abs(r.n1 - r.n2))) > 0.06) notes.push('加载、减载读数相差较大：底座可能不水平，下夹头与孔壁摩擦');
    html += `<div class="result-box warn">本次钢丝的杨氏模量参考值 ${(this.E / 1e11).toFixed(3)}×10¹¹ Pa，测量值相对误差 ${pct(relErr(E, this.E), 2)}${notes.length ? '。' + notes.join('；') : ''}。</div>`;
    const plots = [{ title: 'n̄–m', xLabel: 'm / kg', yLabel: 'n̄ / cm', series: [{ type: 'scatter', data: rows.map((r, i) => [r.m, nb[i]]) }, { type: 'line', data: [[0, fit.b], [7, fit.b + 7 * fit.k]], dash: [5, 4] }] }];
    const answers = [
      { label: '$\\overline{\\Delta n}$', unit: 'cm', value: dn, digits: 3, tolRel: 0.005 },
      { label: '$\\bar d$', unit: 'mm', value: dm, digits: 4, tolRel: 0.002 },
      { label: '$E$', unit: '10¹¹ Pa', value: E / 1e11, digits: 3, tolRel: 0.01 },
    ];
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 杨氏模量</h3><p>长 $L$、截面积 $S$ 的金属丝受拉力 $F$ 伸长 $\\Delta L$，在弹性限度内应力与应变成正比：</p>$$\\frac{F}{S}=E\\,\\frac{\\Delta L}{L}$$<p>比例系数 $E$ 就是杨氏模量，只与材料有关。钢的 $E$ 约为 $2\\times10^{11}$ Pa，1 kg 砝码只能使 0.8 m 长、0.6 mm 粗的钢丝伸长约 0.14 mm，要用光杠杆放大后测量。</p>
<h3>2. 光杠杆</h3>${ymodulusFig()}<p>钢丝伸长 $\\Delta L$ 时，光杠杆后足下降 $\\Delta L$，镜面转过 $\\delta\\approx\\Delta L/b$。入射光线不动，反射光线转过 $2\\delta$，望远镜中叉丝所对的标尺刻度变化</p>$$\\Delta n\\approx D\\tan2\\delta\\approx\\frac{2D}{b}\\Delta L$$<p>放大倍数 $2D/b$ 约为 40。代入 $S=\\pi d^2/4$，得</p>$$E=\\frac{8FLD}{\\pi d^2b\\,\\Delta n}$$
<h3>3. 逐差法</h3><p>砝码等间隔增加时，若简单地取相邻读数差的平均，中间各项相互抵消，只剩首尾两次读数起作用。把 8 个读数分成前后两组，对应相减 $n_{i+4}-n_i$ 再平均，每个数据都被用上，得到每增加 4 kg 的读数变化。</p>
<h3>4. 注意事项</h3><p>先加预载砝码把弯曲的钢丝拉直；加砝码要轻，等稳定后读数；加载和减载各读一次取平均，可以抵消弹性滞后（加载时读数偏小、减载时偏大）。记录 n₀ 以后，不能再碰望远镜、标尺和光杠杆。</p>
<h3>5. 本仿真的计算模型</h3><p>钢丝伸长 = 弹性伸长 + 弯折拉直量（只随曾经达到的最大载荷增加，加 2 kg 预载后基本消失）+ 弹性后效（约为弹性伸长的 1.2%，按 12 s 的时间常数滞后于载荷）。底座不水平时，下夹头与孔壁摩擦，有约 0.03 mm/° 的“死区”。镜面转角、视线反射和标尺读数按几何关系精确计算，不作小角近似；加减砝码后砝码托晃动，标尺像随之抖动。钢丝各处直径略有差别，且截面略呈椭圆；螺旋测微器有零点误差，每块砝码的实际质量与标称值有 ±0.3% 以内的偏差。</p>`;
  }
}
