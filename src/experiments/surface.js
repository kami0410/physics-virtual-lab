// 实验：拉脱法测液体表面张力系数（硅压阻力敏传感器 + 吊环）
// 液膜拉力按 physics/surface.js 的二维弯月面解：吊环离开液面的高度 h 增大时拉力先增大、过最大值后膜被拉断。
// 吊环不水平时，环上各点离液面的高度不同，膜从最高处先断，测得的拉力偏小；吊环没洗干净（有油污）时，
// 液体对环的接触角不为零，拉力也偏小。水的 σ 按 IAPWS 公式随室温变化；每次拉膜时液面状态（微尘、蒸发降温）略有起伏，约 0.3%。
import * as THREE from 'three';
import { meta, thumb } from './surface.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss, fmtU, linFit, tFactor } from '../core/Stats.js';
import { waterSigma, waterRho, capLength, meniscusAngle } from '../physics/surface.js';
import { surfaceFig } from './mechFigs2.js';

const G = 9.794;
const D1 = 33.10e-3, D2 = 34.96e-3; // 吊环内、外直径（m）
const M_RING = 2.62e-3, M_PAN = 1.85e-3, M_W = 0.5e-3; // 吊环、砝码盘、每个砝码的质量（kg）
const SOAK = 4, RINSE = 2; // 在 NaOH 里浸泡、在纯水里涮的时间（s）
const HOOK_Y = 22; // 挂钩上物体的挂点高度（cm）
const NREP = 5;
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class SurfaceExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.Tc = Math.round(rand(18, 26) * 10) / 10;
    this.sigma = waterSigma(this.Tc); this.lc = capLength(this.sigma, waterRho(this.Tc), G);
    this.B = rand(2.85, 3.15); // 传感器灵敏度 mV/mN
    this.off = rand(-15, 15); this.zero = 0; // 零点偏移与调零（mV）
    this.wErr = Array.from({ length: 7 }, () => 1 + gauss(0.003));
    // 吊环清洗：在 NaOH 溶液里泡够 SOAK 秒去掉油污；之后要在纯水里涮净残留的碱液
    this.clean = false; this.soak = 0; this.residue = false; this.rinse = 0; this.tilt = rand(1.2, 2.5) * (Math.random() < 0.5 ? -1 : 1); // 吊环倾角（°）
    this.z = -12; // 液面相对吊环下沿的高度（mm）：>0 吊环浸入液中
    this.attached = false; this.jit = 1; this.psiB = rand(97, 108) * Math.PI / 180; // 膜被拉断时的弯月面角
    this._peak = 0;
  }
  /** 挂钩上挂的是什么：'ring' | 'pan' | 'none' */
  get hang() { const z = this.app.zones && this.app.zones.find((q) => q.id === 'hook'), o = z && z.occupant; return o ? o.key : 'none'; }
  /** 砝码盘上的砝码个数 */
  get nW() { return this.app.stackOf ? this.app.stackOf('pw').length : 0; }
  /** 有效表面张力：吊环没洗干净时接触角约 25°，竖直分量打折扣；碱液没涮净，带进水里的碱和皂化物使表面张力下降 */
  get sigEff() { return this.sigma * (this.clean ? 1 : Math.cos((25 * Math.PI) / 180)) * (this.residue && this.dipped ? 0.96 : 1); }
  tick(dt) {
    const a = this.app, sdt = dt * (a.running ? a.speed : 1), sl = a.slotOf('ring');
    if (sl === 'naoh') { this.soak += sdt; if (this.soak >= SOAK) { if (!this.clean) a.toast('吊环在 NaOH 溶液里泡够了，油污已去掉；拿到纯水里涮净碱液', 'ok'); this.clean = true; } this.residue = true; this.rinse = 0; }
    else if (sl === 'rinse' && this.residue) { this.rinse += sdt; if (this.rinse >= RINSE) { this.residue = false; a.toast('吊环上的碱液已涮净', 'ok'); } }
    if (this.hang === 'ring' && this.z > 0 && this.residue) this.dipped = true; // 带着碱液浸到水里：水被污染了
  }
  /** 液面在 z（mm）时，吊环沿圆周 36 个点处的弯月面角 */
  psis(z = this.z) {
    const t = Math.tan((this.tilt * Math.PI) / 180), R = (D1 + D2) / 4;
    return Array.from({ length: 36 }, (_, k) => meniscusAngle(-z / 1000 + R * t * Math.cos((k * Math.PI) / 18), this.lc));
  }
  /** 液面在 z 时（假定膜还连着）的液膜拉力（N）；膜在这里必然断开时返回 null */
  filmAt(z) { const ps = this.psis(z); return Math.max(...ps) > this.psiB ? null : Math.PI * (D1 + D2) * this.sigEff * this.jit * mean(ps.map(Math.sin)); }
  /** 从吊环刚离开液面一直降到膜断：最大拉力的位置、膜断开的位置 */
  scan() {
    let zPeak = 0, fPeak = 0;
    for (let z = 0; z > -8; z -= 0.01) { const f = this.filmAt(z); if (f === null) return { zPeak, fPeak, zBreak: z + 0.01 }; if (f > fPeak) { fPeak = f; zPeak = z; } }
    return { zPeak, fPeak, zBreak: -8 };
  }
  /** 液膜拉力（N），同时更新附着状态 */
  film() {
    if (this.hang !== 'ring') { this.attached = false; return 0; }
    if (this.z > 0) { if (!this.attached) { this.psiB = rand(97, 108) * Math.PI / 180; this.jit = 1 + gauss(0.003); } this.attached = true; return 0; }
    if (!this.attached) return 0;
    const f = this.filmAt(this.z);
    if (f === null) { this.attached = false; return 0; }
    return f;
  }
  /** 传感器受的总力（N） */
  force() {
    const w = this.hang === 'ring' ? M_RING : this.hang === 'pan' ? M_PAN + this.app.stackOf('pw').reduce((s, c) => s + this.wErr[+c.key.slice(1) - 1] * M_W, 0) : 0;
    const buoy = this.hang === 'ring' && this.z > 0 ? 1000 * G * (Math.PI / 4) * (D2 * D2 - D1 * D1) * Math.min(this.z, 8) / 1000 : 0;
    return w * G - buoy + this.film();
  }
  get U() { return this.off + this.zero + this.B * this.force() * 1000; } // mV
  get Ushow() { return Math.round(this.U * 10) / 10; }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [30, 50, 90], target: [0, 20, 0] }, { name: '吊环', pos: [10, 22, 34], target: [0, 18, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(130, 70));
    app.stage.setLightTarget(0, 18, 0);
    const g = new THREE.Group(), frame = MAT.paint(0x2b3440);
    g.add(mesh(new THREE.BoxGeometry(30, 2, 24), frame, 0, 1, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 46, 16), MAT.metal(), -12, 24, -8));
    g.add(mesh(new THREE.BoxGeometry(16, 2.5, 3), frame, -5, 44, -8));
    g.add(mesh(new THREE.BoxGeometry(5, 3, 4), MAT.alu(), 0, 42, -8)); // 力敏传感器
    this.hook = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), MAT.metal(), 0, 0, 0); g.add(this.hook);
    this.ringM = new THREE.Group(); this.ringM.position.y = 18 - HOOK_Y;
    this.ringM.add(mesh(new THREE.CylinderGeometry(D2 * 50, D2 * 50, 0.9, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.85, roughness: 0.25, side: THREE.DoubleSide })));
    for (let k = 0; k < 3; k++) { const a = (k * 2 * Math.PI) / 3, s = mesh(new THREE.CylinderGeometry(0.03, 0.03, 4.5, 4), MAT.metal(), D2 * 25 * Math.cos(a), 2.2, D2 * 25 * Math.sin(a)); s.rotation.z = Math.cos(a) * 0.35; s.rotation.x = -Math.sin(a) * 0.35; this.ringM.add(s); }
    this.panM = new THREE.Group(); this.panM.add(mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.2, 24), MAT.alu()));
    this.panM.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 4), MAT.metal(), 0, 0.4, 0));
    // 被拉起的液膜：吊环下沿与液面之间的一圈半透明薄筒
    this.filmM = mesh(new THREE.CylinderGeometry(D2 * 50, D2 * 50 * 1.12, 1, 48, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xbfe0ee, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, roughness: 0.05 }));
    g.add(this.filmM);
    // 清洗用的两个烧杯：NaOH 溶液、纯水
    const beaker = (x, col, label) => {
      const b = new THREE.Group(); b.position.set(x, 0, 16);
      b.add(mesh(new THREE.CylinderGeometry(3.6, 3.4, 7, 32, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xe9f2ef, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }), 0, 3.5, 0));
      b.add(mesh(new THREE.CylinderGeometry(3.4, 3.3, 5, 32), new THREE.MeshPhysicalMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false }), 0, 2.6, 0));
      const lb = app.stage.makeLabel(label); lb.position.set(0, 9, 0); b.add(lb);
      scene.add(b);
    };
    beaker(-34, 0xd9d2f0, 'NaOH 溶液'); beaker(-24, 0x9fc6d8, '纯水');
    app.addSlot({ id: 'hook', pos: new THREE.Vector3(0, HOOK_Y, 0), accepts: ['ring', 'pan'], label: '传感器挂钩', r: 2.4, snap: 7 });
    app.addSlot({ id: 'naoh', pos: new THREE.Vector3(-34, 6.5, 16), accepts: ['ring'], label: 'NaOH 溶液烧杯', r: 3.6, snap: 7 });
    app.addSlot({ id: 'rinse', pos: new THREE.Vector3(-24, 6.5, 16), accepts: ['ring'], label: '纯水烧杯', r: 3.6, snap: 7 });
    for (let i = 0; i < 7; i++) app.addSlot({ id: `pw${i}`, pos: new THREE.Vector3(0, HOOK_Y + 0.1 + i * 0.38, 0), accepts: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'], label: '砝码盘', r: 1.8, snap: 5, stack: 'pw', level: i });
    // 升降台与玻璃皿
    this.jack = new THREE.Group();
    this.jack.add(mesh(new THREE.BoxGeometry(12, 1, 12), MAT.alu(), 0, 0, 0));
    this.jack.add(mesh(new THREE.CylinderGeometry(5, 5, 4, 40, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xe9f2ef, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }), 0, 2.5, 0));
    this.water = mesh(new THREE.CylinderGeometry(4.9, 4.9, 3, 40), new THREE.MeshPhysicalMaterial({ color: 0x9fc6d8, transparent: true, opacity: 0.45, depthWrite: false }), 0, 2, 0); this.jack.add(this.water);
    this.jackLegs = mesh(new THREE.BoxGeometry(8, 1, 8), frame, 0, -1, 0); this.jack.add(this.jackLegs);
    g.add(this.jack);
    this.jackCol = mesh(new THREE.BoxGeometry(6, 1, 6), frame, 0, 2, 0); g.add(this.jackCol);
    app.addComponent(new Component({
      key: 'stand', name: '力敏传感器与吊环', zone: 'none', fixed: true, required: true, object: g, labelY: 48,
      icon: SVG('<ellipse cx="32" cy="26" rx="14" ry="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M32 4v12M22 25l10-9 10 9" stroke="currentColor" fill="none"/>'),
      desc: `硅压阻力敏传感器挂在支架横梁上，输出电压与拉力成正比（灵敏度约 3 mV/mN，需用砝码定标）。砝码盘、吊环从器材柜拖到传感器挂钩上。下方升降台上放盛有纯水的玻璃皿，室温 ${this.Tc.toFixed(1)} °C。`,
      controls: () => [
        { type: 'readout', label: '挂钩上', get: () => ({ ring: '吊环', pan: `砝码盘（${this.nW} 个砝码）`, none: '空' })[this.hang] },
        { type: 'knob', label: '吊环水平（调三根吊线）', get: () => this.tilt, set: (v) => { this.tilt = clamp(v, -4, 4); app.changed(); }, min: -4, max: 4, step: 0.02, bigStep: 0.5, perRev: 2, fmt: () => (Math.abs(this.tilt) < 0.15 ? '水平' : `倾斜约 ${Math.abs(this.tilt).toFixed(1)}°`) },
        { type: 'button', label: '玻璃皿里换上新的纯水', onClick: () => { if (this.z > 0) return app.toast('先降下升降台，让吊环离开水面', 'warn'); this.dipped = false; this.attached = false; app.toast('已换上新的纯水', 'ok'); app.changed(); } },
        { type: 'knob', label: '升降台（液面高度）', get: () => this.z, set: (v) => { this.moveZ(clamp(Math.round(v * 100) / 100, -15, 4)); app.changed(); }, min: -15, max: 4, step: 0.02, bigStep: 1, perRev: 2, fmt: () => (this.z > 0 ? `吊环浸入 ${this.z.toFixed(1)} mm` : '转动螺杆升降') },
      ],
    }));
    const rg = new THREE.Group(); rg.add(this.ringM);
    app.addComponent(new Component({
      key: 'ring', name: '吊环', zone: 'slot', defaultSlot: 'hook', object: rg, labelY: 3, showLabel: false,
      icon: SVG('<ellipse cx="32" cy="28" rx="14" ry="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M32 6L20 27M32 6l12 21M32 6v18" stroke="currentColor" fill="none"/>'),
      desc: `铝合金薄壁吊环：内径 D₁ = ${(D1 * 1000).toFixed(2)} mm，外径 D₂ = ${(D2 * 1000).toFixed(2)} mm，用三根细线吊着。使用前拖到 NaOH 溶液烧杯里浸泡去油污，再拖到纯水烧杯里涮净碱液，然后挂到传感器挂钩上。`,
      controls: () => [{ type: 'readout', label: '吊环表面', get: () => (!this.clean ? (this.app.slotOf('ring') === 'naoh' ? `在 NaOH 溶液里浸泡（${Math.min(this.soak, SOAK).toFixed(0)} / ${SOAK} s）` : '有油污') : this.residue ? (this.app.slotOf('ring') === 'rinse' ? '在纯水里涮' : '油污已除，还沾着碱液') : '干净') }],
    }));
    const pg = new THREE.Group(); pg.add(this.panM);
    app.addComponent(new Component({
      key: 'pan', name: '砝码盘', zone: 'slot', defaultSlot: 'hook', object: pg, labelY: 3, showLabel: false,
      icon: SVG('<ellipse cx="32" cy="28" rx="16" ry="4" fill="currentColor"/><path d="M32 6v20" stroke="currentColor"/>'),
      desc: '定标用的小砝码盘。挂到传感器挂钩上，再把 0.500 g 砝码一个个拖到盘上。',
    }));
    const wm = MAT.metal();
    for (let i = 0; i < 7; i++) {
      const wg = new THREE.Group(); wg.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.35, 16), wm.clone(), 0, 0.175, 0));
      app.addComponent(new Component({
        key: `g${i + 1}`, name: `0.500 g 砝码 ${i + 1}`, group: '0.500 g 砝码', zone: 'slot', defaultSlot: 'pw0', object: wg, labelY: 2, showLabel: false,
        icon: SVG('<rect x="20" y="16" width="24" height="9" rx="2" fill="currentColor"/><text x="32" y="38" font-size="9" text-anchor="middle" fill="currentColor">0.5 g</text>'),
        desc: '0.500 g 砝码（实际质量有约 ±0.3% 的偏差）。拖到挂钩上的砝码盘里。',
      }));
    }
    const mb = (this.meter = meterBox(16, 9, 10, '数字电压表')); mb.group.position.set(30, 0, 0);
    app.addComponent(new Component({
      key: 'meter', name: '数字电压表', zone: 'none', object: mb.group, labelY: 12,
      icon: SVG('<rect x="8" y="8" width="48" height="26" rx="3" fill="currentColor"/><rect x="14" y="13" width="30" height="10" fill="#fff"/>'),
      desc: '显示力敏传感器的输出电压，分辨率 0.1 mV。面板上有调零旋钮。',
      controls: () => [{ type: 'knob', label: '调零', get: () => this.zero, set: (v) => { this.zero = clamp(Math.round(v * 10) / 10, -30, 30); app.changed(); }, min: -30, max: 30, step: 0.1, bigStep: 2, perRev: 10, digits: 1, unit: 'mV' }],
    }));
    this.sv = app.addView({ id: 'side', title: '吊环与液面（侧视放大）', w: 280, h: 220, res: 1.6 });
  }
  canPlace(comp, o = {}) {
    const sl = o.slot ?? comp.defaultSlot;
    if (sl && sl.startsWith('pw') && this.hang !== 'pan') return '先把砝码盘挂到传感器挂钩上，再往盘里加砝码';
    if (comp.key === 'pan' && this.app.slotOf('pan') === 'hook' && this.nW) return '先把盘里的砝码取下来';
    return null;
  }
  onPlace(c) { if (c && (c.key === 'ring' || c.key === 'pan')) this.film(); }
  onSlotChange(c) { this.onPlace(c); }
  onRemove(c) {
    // 砝码盘拿下来时，盘里的砝码一起放回柜里
    if (c && c.key === 'pan') for (const w of this.app.stackOf('pw')) this.app.remove(w);
    this.film();
  }
  get meterOn() { return this.app.comp('meter').placed; }
  update() {
    const f = this.film(); // 更新附着状态
    const s = this.Ushow.toFixed(1);
    if (s !== this._s) { this._s = s; this.meter.setText(s, 'mV'); }
    const ringY = 18, panY = 22;
    this.ringM.rotation.z = this.hang === 'ring' ? (this.tilt * Math.PI) / 180 : 0;
    const top = this.hang === 'pan' ? panY + 0.7 : this.hang === 'ring' ? ringY + 4.5 : 30;
    this.hook.position.set(0, (40.5 + top) / 2, 0); this.hook.scale.y = 40.5 - top;
    const waterTop = ringY - 0.45 + this.z / 10; // 液面（cm）
    this.jack.position.y = waterTop - 3.5;
    this.jackCol.scale.y = Math.max(0.1, this.jack.position.y - 2); this.jackCol.position.y = 2 + this.jackCol.scale.y / 2;
    const hf = -this.z / 10; // 液膜高度（cm）
    this.filmM.visible = this.attached && this.hang === 'ring' && hf > 0.005;
    if (this.filmM.visible) { this.filmM.scale.y = hf; this.filmM.position.y = ringY - 0.45 - hf / 2; this.filmM.rotation.z = this.ringM.rotation.z; }
    this.drawSide(f);
  }
  drawSide(f) {
    const v = this.sv, g = v.ctx, W = v.W, H = v.H, s = H * 0.06; // px per mm
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    const yS = H * 0.62, cx = W / 2; // 远处液面
    g.fillStyle = 'rgba(120,170,200,.35)'; g.fillRect(0, yS, W, H - yS);
    g.strokeStyle = 'rgba(160,200,230,.9)'; g.lineWidth = 1.2;
    if (this.hang === 'ring') {
      const R = (D1 + D2) / 4 * 1000 * s * 0.5, t = Math.tan((this.tilt * Math.PI) / 180) * (D1 + D2) / 4 * 1000 * s * 0.5;
      const yR = yS - (-this.z) * s; // 吊环下沿（中心）
      const ends = [[cx - R, yR + t], [cx + R, yR - t]];
      g.beginPath(); g.moveTo(0, yS); g.lineTo(W, yS); g.stroke();
      if (this.attached && this.z <= 0) {
        // 弯月面的精确形状：以接触线处的倾角 ψ 为参数，x(φ) = ℓc[2cos(φ/2) + ln tan(φ/4)] + 常数，y(φ) = 2ℓc·sin(φ/2)
        const lcp = this.lc * 1000 * s;
        const X = (p) => lcp * (2 * Math.cos(p / 2) + Math.log(Math.tan(Math.max(p, 0.02) / 4)));
        g.fillStyle = 'rgba(160,200,230,.45)';
        for (const [x, y] of ends) {
          const psi = meniscusAngle((yS - y) / s / 1000, this.lc);
          if (psi <= 0) continue;
          for (const side of [-1, 1]) {
            g.beginPath(); g.moveTo(x, y);
            for (let k = 40; k >= 0; k--) { const p = Math.max(0.02, (psi * k) / 40); g.lineTo(x + side * Math.min(W, X(psi) - X(p)), yS - 2 * lcp * Math.sin(p / 2)); }
            g.lineTo(x, yS); g.closePath(); g.fill();
          }
        }
      }
      g.strokeStyle = '#d9dde2'; g.lineWidth = 3; g.beginPath(); g.moveTo(ends[0][0], ends[0][1]); g.lineTo(ends[1][0], ends[1][1]); g.stroke();
      g.lineWidth = 1; g.strokeStyle = '#9aa5ab'; g.beginPath(); g.moveTo(cx, 4); g.lineTo(ends[0][0], ends[0][1] - 26); g.moveTo(cx, 4); g.lineTo(ends[1][0], ends[1][1] - 26); g.stroke();
      g.beginPath(); g.moveTo(ends[0][0], ends[0][1] - 26); g.lineTo(ends[0][0], ends[0][1]); g.moveTo(ends[1][0], ends[1][1] - 26); g.lineTo(ends[1][0], ends[1][1]); g.stroke();
    } else { g.beginPath(); g.moveTo(0, yS); g.lineTo(W, yS); g.stroke(); }
    g.fillStyle = '#0b1410'; g.fillRect(W * 0.62, H * 0.05, W * 0.34, H * 0.15); g.fillStyle = '#7dff9e'; g.font = `bold ${H * 0.08}px "IBM Plex Mono"`; g.textAlign = 'right'; g.fillText(this.meterOn ? this.Ushow.toFixed(1) : '----', W * 0.92, H * 0.16);
    g.fillStyle = '#9aa5ab'; g.font = `${H * 0.04}px "IBM Plex Mono"`; g.fillText('mV', W * 0.96, H * 0.16);
    let foot;
    if (this.hang === 'pan') foot = `砝码盘上 ${this.nW} 个 0.500 g 砝码`;
    else if (this.hang !== 'ring') foot = '挂钩上没有挂东西';
    else if (this.z > 0) foot = `吊环浸在水中 ${this.z.toFixed(1)} mm。慢慢降低液面，把吊环拉出水面`;
    else if (this.attached) foot = `液膜被拉起 ${(-this.z).toFixed(2)} mm，拉力 ${(f * 1000).toFixed(2)} mN……继续慢慢降，读数到最大后膜就会断`;
    else foot = '吊环在液面上方，没有液膜';
    v.foot(foot);
  }

  // ======================= 数据表 =======================
  Bfit() {
    const rs = this.app.table('cal').rows.filter((r) => isFinite(r.m) && isFinite(r.U));
    if (rs.length < 2) return NaN;
    return linFit(rs.map((r) => r.m * 1e-3 * G * 1000), rs.map((r) => r.U)).k; // mV/mN
  }
  tables() {
    return [
      { id: 'cal', title: '传感器定标', maxRows: 8, columns: [{ key: 'm', label: '砝码质量 m/g', digits: 3, readonly: true }, { key: 'U', label: '电压 U/mV', digits: 1, readTol: 0.06 }], buttons: [{ label: '记录砝码质量与电压', onClick: (t) => this.recCal(t) }], note: '挂上砝码盘后先调零（读数为 0.0 mV），再依次加 0.500 g 砝码，每加一个记一次。' },
      {
        id: 'sig', title: '拉脱前后的读数', maxRows: 10,
        columns: [{ key: 'U1', label: '拉脱前 U₁/mV', digits: 1, readTol: 0.06 }, { key: 'U2', label: '拉脱后 U₂/mV', digits: 1, readTol: 0.06 }, { key: 'dU', label: 'ΔU/mV', digits: 1, calc: (r) => r.U1 - r.U2 }, { key: 'f', label: 'f/mN', digits: 3, calc: (r) => (r.U1 - r.U2) / this.Bfit() }],
        buttons: [{ label: '记录 U₁（拉脱前，新的一行）', onClick: (t) => this.rec1(t) }, { label: '记录 U₂（拉脱后）', onClick: (t) => this.rec2(t) }],
        note: '吊环浸入水中后缓慢降低液面，液膜被拉高、读数增大，记下液膜被拉断前一瞬间的读数 U₁；膜断后记 U₂。重复 5 次。',
      },
    ];
  }
  recCal(t) {
    const a = this.app;
    if (!this.meterOn) return a.toast('台上还没有电压表，读不到传感器的输出', 'warn');
    if (this.hang !== 'pan') return a.toast('定标要挂砝码盘', 'warn');
    if (!t.rows.length && Math.abs(this.U - this.B * M_PAN * G * 1000) > 0.3 && Math.abs(this.U) > 0.3) a.toast('还没有调零：挂上砝码盘、未加砝码时，先把读数调到 0.0 mV', 'warn');
    if (t.rows.some((r) => Math.abs(r.m - this.nW * 0.5) < 1e-6)) a.toast('这个砝码数已经记过了', 'warn');
    t.addRow({ m: this.nW * 0.5, U: this.Ushow });
  }
  rec1(t) {
    const a = this.app;
    if (!this.meterOn) return a.toast('台上还没有电压表，读不到传感器的输出', 'warn');
    if (this.hang !== 'ring') return a.toast('先挂上吊环', 'warn');
    if (!this.clean) a.toast('吊环没有用 NaOH 洗过：油污使接触角变大，拉力偏小', 'warn');
    if (this.dipped) a.toast('吊环带着碱液浸过水，水面被污染，表面张力偏小', 'warn');
    if (!this.attached || this.z > 0) a.toast(this.z > 0 ? '吊环还在水里：要在液膜被拉起、快要断开时记录' : '液膜已经断了：U₁ 要在膜断开之前读', 'warn');
    else if (this.film() < 0.97 * this.scan().fPeak) a.toast('液膜还没拉到最高：继续慢慢降低液面，读数还会增大', 'warn');
    const i = t.rows.length - 1;
    if (i >= 0 && !isFinite(t.rows[i].U2)) { t.set(i, 'U1', this.Ushow); a.toast('上一行还没有 U₂，这次的 U₁ 覆盖了它'); return; }
    t.addRow({ U1: this.Ushow });
  }
  rec2(t) {
    const a = this.app, i = t.rows.length - 1;
    if (!this.meterOn) return a.toast('台上还没有电压表', 'warn');
    if (i < 0) return a.toast('先记录 U₁', 'warn');
    if (isFinite(t.rows[i].U2)) a.toast('这一行已经有 U₂ 了：重新测一次，先记 U₁', 'warn');
    if (this.attached) a.toast('液膜还没断', 'warn');
    if (this.z > 0) a.toast('吊环在水里，受到浮力：要在吊环完全离开水面后读 U₂', 'warn');
    t.set(i, 'U2', this.Ushow);
  }

  // ======================= 自动操作 =======================
  /** 改变液面高度，并立即更新液膜状态（不依赖画面刷新：加速运行时两帧之间液面可能走过很远） */
  moveZ(v) { this.z = v; this.film(); }
  async setZ(z, ms = 600) { await this.app.tween(() => this.z, (v) => this.moveZ(v), z, ms); this.moveZ(z); this.app.changed(); }
  /** 自动操作：挂钩上挂 key（'pan' | 'ring'），先取下别的 */
  async hangOn(key) {
    const a = this.app;
    if (this.hang === key) return;
    if (this.hang === 'pan') { for (const w of a.stackOf('pw').reverse()) a.remove(w); a.remove(a.comp('pan')); }
    else if (this.hang === 'ring') a.remove(a.comp('ring'));
    await a.autoPut(key, 'hook'); this.film();
  }
  /** 自动操作：砝码盘里放 k 个砝码 */
  async setW(k) {
    const a = this.app;
    while (this.nW > k) { a.remove(a.stackOf('pw').pop()); await a.wait(120); }
    for (let i = 1; i <= 7 && this.nW < k; i++) if (!a.comp(`g${i}`).placed) await a.autoPut(`g${i}`, 'pw0');
    a.changed();
  }
  /** 自动操作：NaOH 浸泡、纯水涮净、挂到挂钩上 */
  async washRing() {
    const a = this.app;
    if (!this.clean) { if (this.hang === 'pan') { await this.setW(0); a.remove(a.comp('pan')); } await a.autoPut('ring', 'naoh'); await a.until(() => this.clean, 30000); }
    if (this.residue) { await a.autoPut('ring', 'rinse'); await a.until(() => !this.residue, 30000); }
    await this.hangOn('ring');
  }
  async pullOnce() {
    const a = this.app;
    a.select(a.comp('stand'));
    await this.setZ(2, 500); await a.wait(200);
    const { zPeak, zBreak } = this.scan(); // 学生盯着读数：读数涨到最大、开始回落时记下
    await this.setZ(zPeak + gauss(0.02), 1400); await a.wait(200);
    await a.record('sig', 0);
    await this.setZ(zBreak - 1.5, 500); await a.wait(200);
    await a.record('sig', 1);
    await this.setZ(-10, 400);
  }
  steps() {
    const app = this.app, cal = () => app.table('cal').rows.filter((r) => isFinite(r.U)), sig = () => app.table('sig').rows.filter((r) => isFinite(r.U1) && isFinite(r.U2));
    return [
      {
        title: '传感器定标',
        html: '<p>挂上砝码盘，转动电压表的调零旋钮使读数为 0.0 mV。依次加上 0.500 g 砝码直到 3.500 g，每加一个记录一次电压，作 $U$–$F$ 图求传感器灵敏度 $B$。</p>',
        status: () => `已记录 ${cal().length} 组`,
        check: () => cal().length >= 6,
        diagnose: () => {
          const out = [];
          if (this.hang !== 'pan') out.push({ msg: '定标时挂钩上要挂砝码盘。', fix: { label: '挂上砝码盘', run: () => this.hangOn('pan') } });
          else if (!cal().length && Math.abs(this.U) > 0.15 && this.nW === 0) out.push({ msg: `读数 ${this.Ushow.toFixed(1)} mV，先调零。`, fix: { label: '帮我调零', run: async () => { const z = this.zero - this.U; await app.tween(() => this.zero, (v) => (this.zero = v), z, 600); this.zero = Math.round(z * 10) / 10; } } });
          return out;
        },
        auto: async () => {
          app.showTable(0); await app.autoPlace('meter'); await this.hangOn('pan'); await this.setW(0); app.renderInspector();
          app.select(app.comp('meter'));
          const z = Math.round((this.zero - this.U) * 10) / 10; await app.tween(() => this.zero, (v) => (this.zero = v), z, 600); this.zero = z; app.changed();
          app.select(app.comp('stand'));
          for (let k = 0; k <= 7; k++) { if (!cal().some((r) => Math.abs(r.m - k * 0.5) < 1e-6)) { await this.setW(k); app.changed(); await app.wait(250); await app.record('cal', 0); } }
          await this.setW(0); app.changed();
        },
      },
      {
        title: '挂吊环：清洗并调水平',
        html: '<p>取下砝码盘。吊环先<b>拖到 NaOH 溶液烧杯里</b>浸泡几秒去油污（油污使液体对吊环的接触角变大，拉力减小），再<b>拖到纯水烧杯里</b>涮净碱液，然后挂到传感器挂钩上。调节三根吊线，使吊环下沿水平——否则液膜从高的一侧先断，测得的拉力偏小。</p>',
        check: () => this.hang === 'ring' && this.clean && !this.residue && Math.abs(this.tilt) < 0.15,
        diagnose: () => {
          const out = [];
          if (!this.clean) out.push({ msg: '吊环还没清洗，油污会使测得的表面张力偏小 10% 左右。', fix: { label: '帮我清洗并挂上', run: () => this.washRing() } });
          else if (this.residue) out.push({ msg: '吊环上还沾着碱液：带进水里会污染水面，表面张力偏小。先在纯水烧杯里涮净。', fix: { label: '帮我涮净并挂上', run: () => this.washRing() } });
          else if (this.hang !== 'ring') out.push({ msg: '挂钩上还不是吊环。', fix: { label: '挂上吊环', run: () => this.hangOn('ring') } });
          if (Math.abs(this.tilt) >= 0.15) out.push({ msg: `吊环倾斜约 ${Math.abs(this.tilt).toFixed(1)}°，调吊线使它水平（从侧面看，环的下沿与液面平行）。`, fix: { label: '帮我调平', run: async () => { await app.tween(() => this.tilt, (v) => (this.tilt = v), 0, 600); this.tilt = 0; } } });
          return out;
        },
        auto: async () => {
          await app.view('全景'); await this.washRing(); await app.view('吊环'); app.select(app.comp('stand')); app.renderInspector();
          await app.tween(() => this.tilt, (v) => (this.tilt = v), gauss(0.03), 700); app.changed();
        },
      },
      {
        title: `测拉脱前后的读数（${NREP} 次）`,
        html: '<p>升高升降台使吊环下沿浸入水中，再<b>缓慢</b>降低液面。吊环被拉出水面时带起一层液膜，读数逐渐增大；记下液膜被拉断前一瞬间的读数 $U_1$，膜断后读数回落为 $U_2$（吊环的重量）。重复 5 次。</p>',
        hint: '越接近断开，读数增加越慢、甚至略有下降。降得太快会错过最大值。',
        status: () => `已测 ${sig().length} / ${NREP} 次`,
        check: () => sig().length >= NREP,
        diagnose: () => {
          const out = [];
          if (this.hang !== 'ring') return [{ msg: '挂钩上要挂吊环。' }];
          if (!this.clean || Math.abs(this.tilt) >= 0.15) out.push({ msg: `${!this.clean ? '吊环没清洗' : ''}${!this.clean && Math.abs(this.tilt) >= 0.15 ? '，' : ''}${Math.abs(this.tilt) >= 0.15 ? '吊环不水平' : ''}：这样测出的拉力偏小。` });
          if (!this.attached && this.z <= 0) out.push({ msg: '吊环在液面上方、没有液膜：先升高升降台让吊环浸入水中。', fix: { label: '帮我浸入', run: () => this.setZ(2) } });
          return out;
        },
        auto: async () => {
          app.showTable(1);
          if (this.hang !== 'ring' || !this.clean || this.residue || Math.abs(this.tilt) >= 0.15) { await this.washRing(); app.select(app.comp('stand')); await app.tween(() => this.tilt, (v) => (this.tilt = v), 0, 500); app.changed(); }
          for (let k = 0; k < 8 && sig().length < NREP; k++) await this.pullOnce();
        },
      },
      {
        title: '数据处理',
        html: '<p>由定标求灵敏度 $B$，$f=(U_1-U_2)/B$，$\\sigma=\\dfrac f{\\pi(D_1+D_2)}$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const cr = this.app.table('cal').rows.filter((r) => isFinite(r.m) && isFinite(r.U));
    if (cr.length < 3) return { html: '<p>请先完成传感器定标（至少 3 组）。</p>', ok: false };
    const Fs = cr.map((r) => r.m * 1e-3 * G * 1000), fit = linFit(Fs, cr.map((r) => r.U)), B = fit.k;
    const sr = this.app.table('sig').rows.filter((r) => isFinite(r.U1) && isFinite(r.U2));
    if (!sr.length) return { html: '<p>请先测量拉脱前后的读数。</p>', ok: false };
    const fs = sr.map((r) => (r.U1 - r.U2) / B), sg = fs.map((f) => f / 1000 / (Math.PI * (D1 + D2)));
    const sm = mean(sg), n = sg.length, uA = n > 1 ? (tFactor(n) * stdev(sg)) / Math.sqrt(n) : 0, ref = this.sigma;
    let html = `<h3>1. 传感器定标</h3><table><tr><th>m/g</th>${cr.map((r) => `<td>${r.m.toFixed(3)}</td>`).join('')}</tr><tr><th>U/mV</th>${cr.map((r) => `<td>${r.U.toFixed(1)}</td>`).join('')}</tr></table>
      <p>$F=mg$（$g$ = ${G} m/s²），拟合 $U=BF+U_0$：$B$ = ${B.toFixed(4)} mV/mN，$r$ = ${fit.r.toFixed(6)}。</p>
      <h3>2. 表面张力系数</h3><table><tr><th>U₁/mV</th><th>U₂/mV</th><th>f/mN</th><th>σ/(mN/m)</th></tr>${sr.map((r, i) => `<tr><td>${r.U1.toFixed(1)}</td><td>${r.U2.toFixed(1)}</td><td>${fs[i].toFixed(3)}</td><td>${(sg[i] * 1000).toFixed(2)}</td></tr>`).join('')}</table>
      <p>$\\pi(D_1+D_2)$ = ${(Math.PI * (D1 + D2) * 1000).toFixed(2)} mm。</p>
      <div class="result-box">$\\sigma=${fmtU(sm * 1000, uA * 1000)}$ mN/m（${n} 次，室温 ${this.Tc.toFixed(1)} °C）</div>
      <p>误差来源：读 U₁ 时膜已越过最大值（拉脱前一瞬间的读数略小于最大拉力）；吊环不水平、不干净都会使结果偏小；水不纯（溶有表面活性物质）会使 σ 显著减小。</p>
      <div class="result-box warn">${this.Tc.toFixed(1)} °C 纯水的表面张力系数（IAPWS）为 ${(ref * 1000).toFixed(2)} mN/m，测量值相对误差 ${pct(relErr(sm, ref))}。</div>`;
    return { html, ok: true, answers: [{ label: '$B$', unit: 'mV/mN', value: B, digits: 3, tolRel: 0.004 }, { label: '$\\bar\\sigma$', unit: 'mN/m', value: sm * 1000, digits: 2, tolRel: 0.006 }], plots: [{ title: '定标曲线', xLabel: 'F / mN', yLabel: 'U / mV', series: [{ type: 'scatter', data: Fs.map((x, i) => [x, cr[i].U]), label: '实验点' }, { type: 'line', data: [0, Math.max(...Fs)].map((x) => [x, B * x + fit.b]), label: '拟合直线' }] }] };
  }

  principle() {
    return `<h3>1. 表面张力</h3><p>液体表面层内分子受到指向液体内部的合力，表面有收缩的趋势。设想在液面上画一条长 $L$ 的线，线两侧液面互相拉的力 $f=\\sigma L$，$\\sigma$ 称为表面张力系数（N/m）。</p>
<h3>2. 拉脱法</h3>${surfaceFig()}<p>把干净的金属吊环浸入水中再缓慢提起，吊环下沿带起一层液膜。液膜内外两个表面沿吊环内、外圆周拉住吊环，拉力的竖直分量随膜的升高而增大，膜即将被拉断时接近竖直，拉力最大：</p>$$f=\\sigma\\,\\pi(D_1+D_2)\\qquad\\Rightarrow\\qquad\\sigma=\\frac{U_1-U_2}{B\\,\\pi(D_1+D_2)}$$
<h3>3. 本仿真的计算模型</h3><p>液膜按二维弯月面计算：毛细长度 $\\ell_c=\\sqrt{\\sigma/\\rho g}$（水约 2.7 mm），吊环下沿高出液面 $h$ 时，液面在环上的倾角 $\\psi$ 满足 $h=2\\ell_c\\sin(\\psi/2)$，每单位长度的竖直拉力为 $\\sigma\\sin\\psi$；$\\psi$ 超过约 100° 时膜断开。吊环倾斜时沿圆周逐点计算。水的 $\\sigma$ 按 IAPWS 公式随温度变化；吊环有油污时按约 25° 的接触角处理。</p>`;
  }
}
