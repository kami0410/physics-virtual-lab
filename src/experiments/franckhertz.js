// 实验：弗兰克-赫兹实验（充氩四极管）
// 板极电流由 physics/franckhertz.js 的电子能量分布模型算出：加速区逐层推进，能量超过阈值的电子与氩原子非弹性碰撞；
// 灯丝发射随灯丝电压（有预热过程）、第一栅压变化；拒斥电压决定能到达板极的电子；U_G2K 过高时氩气电离，电流急剧增大。
import * as THREE from 'three';
import { meta, thumb } from './franckhertz.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh } from '../core/Models.js';
import { mean, rand, relErr, pct, clamp, gauss, fmtU, linFit } from '../core/Stats.js';
import { FHTube, AR } from '../physics/franckhertz.js';
import { franckHertzFig } from './modernFigs.js';

const RANGES = [1e-6, 1e-7, 1e-8, 1e-9];
const RNAME = ['×10⁻⁶ A', '×10⁻⁷ A', '×10⁻⁸ A', '×10⁻⁹ A'];
const VMAX = 95, SCAN_TO = 85, SCAN_RATE = 3; // 自动扫描：V/s
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class FranckHertzExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.tube = new FHTube({ kappa: rand(13, 16), Vc: rand(1.2, 3.2) });
    this.lab = { VF: Math.round(rand(2.2, 2.8) * 10) / 10, VG1: Math.round(rand(1.2, 1.8) * 10) / 10, VG2A: Math.round(rand(6, 9) * 10) / 10 };
    this.I0 = rand(2.5, 4) * 1e-8;
    this.power = false; this.tf = 0; this.VF = 1.8; this.VG1 = 0.5; this.VG2A = 4; this.VG2 = 0;
    this.mode = 'manual'; this.range = 0; this.scan = []; this.scanning = false; this.scanDone = false; this.ionWarned = false; this.noise = 0;
  }

  // ======================= 电流 =======================
  emission() {
    if (!this.power) return 0;
    const g = (v) => 1 - Math.exp(-v / 0.7);
    return this.I0 * Math.exp(4 * (this.tf - this.lab.VF)) * (g(this.VG1) / g(this.lab.VG1)) * clamp(this.tf / this.lab.VF, 0, 1.5) ** 3;
  }
  passAt(V) {
    const k = Math.floor(V * 10) / 10, fr = (V - k) * 10, t = this.tube;
    const a = t.pass(k, this.VG2A), b = fr > 1e-6 ? t.pass(k + 0.1, this.VG2A) : a;
    return a + (b - a) * fr;
  }
  /** 板极电流（A，不含噪声） */
  current(V = this.VG2) {
    const Ie = this.emission();
    if (!(Ie > 0)) return 0;
    const U = Math.max(0, V - this.tube.Vc);
    return Ie * (this.passAt(V) * (1 + 0.004 * V) + 0.0015 * U + this.tube.ionization(V));
  }
  get disp() {
    const r = RANGES[this.range], I = this.current() * (1 + this.noise * 0.002) + r * this.noise * 0.0006;
    return Math.max(0, Math.round((I / r) * 1000) / 1000);
  }

  tick(dt) {
    const a = this.app, sdt = dt * (a.running ? a.speed : 1);
    // 灯丝预热（约 6 s 时间常数）
    const tgt = this.power ? this.VF : 0;
    this.tf += (tgt - this.tf) * (1 - Math.exp(-sdt / 6));
    this.noise = gauss(1);
    if (this.mode === 'auto' && this.scanning) {
      this.VG2 = Math.min(SCAN_TO, this.VG2 + SCAN_RATE * sdt);
      this.scan.push([this.VG2, this.current()]);
      if (this.VG2 >= SCAN_TO) { this.scanning = false; this.scanDone = true; a.renderInspector(); }
    }
    if (this.power && this.tube.ionization(this.VG2) > 0.3 && !this.ionWarned) { this.ionWarned = true; a.toast('管内氩气开始电离，板极电流急剧增大——立即降低 U_G2K，否则会损坏管子', 'warn'); }
    if (this.tube.ionization(this.VG2) <= 0.05) this.ionWarned = false;
    a.changed();
  }

  // ======================= 场景 =======================
  cameras() {
    return [
      { name: '全景', pos: [0, 46, 72], target: [0, 8, 0] },
      { name: '仪器面板', pos: [0, 16, 38], target: [0, 8, 6] },
      { name: '充氩管', pos: [10, 26, 22], target: [0, 19, 0] },
    ];
  }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(140, 80));
    app.stage.setLightTarget(0, 6, 0);
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(44, 14, 26), MAT.paint(0xd4d0c6), 0, 7, 0));
    g.add(mesh(new THREE.BoxGeometry(44.4, 1, 26.4), MAT.paint(0x2b3036), 0, 14.3, 0));
    const cv = document.createElement('canvas'); cv.width = 768; cv.height = 256; const c = cv.getContext('2d');
    c.fillStyle = '#d4d0c6'; c.fillRect(0, 0, 768, 256);
    c.fillStyle = '#1f2937'; c.font = 'bold 24px "Microsoft YaHei"'; c.fillText('弗兰克-赫兹实验仪', 20, 34);
    c.fillStyle = '#0b1410'; c.fillRect(20, 52, 210, 70); c.fillRect(250, 52, 210, 70);
    c.fillStyle = '#4b5563'; c.font = '18px "Microsoft YaHei"';
    [['灯丝 U_F', 40], ['U_G1K', 180], ['U_G2A', 320], ['U_G2K', 460], ['电流量程', 610]].forEach(([s, x]) => c.fillText(s, x, 236));
    c.fillText('电压', 24, 146); c.fillText('板极电流 I_A', 254, 146);
    this.dispCanvas = cv; this.dispTex = new THREE.CanvasTexture(cv); this.dispTex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(43, 13), new THREE.MeshBasicMaterial({ map: this.dispTex }));
    face.position.set(0, 7, 13.02); face.userData.noHL = true; g.add(face);
    for (const [x, col] of [[-17, 0x111317], [-10.5, 0x111317], [-4, 0x111317], [2.5, 0x7f1d1d], [9.5, 0x111317]]) { const k = mesh(new THREE.CylinderGeometry(1.2, 1.3, 1.2, 20), MAT.paint(col), x, 3.4, 13.6); k.rotation.x = Math.PI / 2; g.add(k); }
    // 充氩管（装在仪器顶部的透明罩内）
    const tube = new THREE.Group();
    tube.add(mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.8, 24), MAT.black(), 0, 0.4, 0));
    tube.add(mesh(new THREE.CylinderGeometry(1.7, 1.7, 9, 24, 1, true), MAT.glass(0xe0f2fe, 0.25), 0, 5.3, 0));
    tube.add(mesh(new THREE.SphereGeometry(1.7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.glass(0xe0f2fe, 0.25), 0, 9.8, 0));
    this.fil = mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), new THREE.MeshStandardMaterial({ color: 0x555555, emissive: 0x000000 }), 0, 5, 0); tube.add(this.fil);
    for (const r of [0.5, 0.75]) tube.add(mesh(new THREE.CylinderGeometry(r, r, 6.4, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x9ca3af, wireframe: true }), 0, 5, 0));
    tube.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 6.8, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }), 0, 5, 0));
    this.glow = new THREE.PointLight(0xff9a3c, 0, 12); this.glow.position.set(0, 5, 0); tube.add(this.glow);
    tube.position.set(14, 14.8, -4); g.add(tube);
    // 标签：管子推荐的工作参数
    const lc = document.createElement('canvas'); lc.width = 256; lc.height = 128; const l2 = lc.getContext('2d');
    l2.fillStyle = '#fefce8'; l2.fillRect(0, 0, 256, 128); l2.fillStyle = '#1f2937'; l2.font = 'bold 20px "Microsoft YaHei"'; l2.fillText('Ar 管 推荐参数', 12, 28);
    l2.font = '20px Consolas'; l2.fillText(`UF   ${this.lab.VF.toFixed(1)} V`, 14, 60); l2.fillText(`UG1K ${this.lab.VG1.toFixed(1)} V`, 14, 86); l2.fillText(`UG2A ${this.lab.VG2A.toFixed(1)} V`, 14, 112);
    const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), new THREE.MeshBasicMaterial({ map: lt })); lab.rotation.x = -Math.PI / 2; lab.position.set(4, 14.85, 5); lab.userData.noHL = true; g.add(lab);
    app.addComponent(new Component({
      key: 'fh', name: '弗兰克-赫兹实验仪', zone: 'none', fixed: true, required: true, object: g, labelY: 28,
      icon: SVG('<rect x="22" y="4" width="20" height="32" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M32 10v20M26 12v16M38 12v16" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2"/>'),
      desc: '充氩四极管：灯丝加热阴极 K 发射电子，第一栅极 G1 控制发射，第二栅极 G2 与阴极之间加加速电压 U_G2K，G2 与板极 A 之间加拒斥电压 U_G2A。实验仪提供四组电压并测板极电流 I_A（四档量程，显示 4 位）。管子顶部的标签给出推荐的工作参数。',
      controls: () => [
        { type: 'toggle', label: '电源', get: () => this.power, set: (v) => { this.power = v; if (!v) { this.scanning = false; } } },
        { type: 'knob', label: '灯丝电压 U_F', get: () => this.VF, set: (v) => (this.VF = clamp(v, 0, 4.5)), min: 0, max: 4.5, step: 0.01, bigStep: 0.1, perRev: 1, digits: 2, unit: 'V' },
        { type: 'knob', label: '第一栅压 U_G1K', get: () => this.VG1, set: (v) => (this.VG1 = clamp(v, 0, 5)), min: 0, max: 5, step: 0.01, bigStep: 0.1, perRev: 1, digits: 2, unit: 'V' },
        { type: 'knob', label: '拒斥电压 U_G2A', get: () => this.VG2A, set: (v) => (this.VG2A = clamp(v, 0, 15)), min: 0, max: 15, step: 0.01, bigStep: 0.5, perRev: 2, digits: 2, unit: 'V' },
        { type: 'segment', label: '工作方式', get: () => this.mode, set: (v) => { this.mode = v; this.scanning = false; }, options: [{ label: '手动', value: 'manual' }, { label: '自动扫描', value: 'auto' }] },
        ...(this.mode === 'manual'
          ? [{ type: 'knob', label: '加速电压 U_G2K', get: () => this.VG2, set: (v) => (this.VG2 = clamp(v, 0, VMAX)), min: 0, max: VMAX, step: 0.1, bigStep: 1, perRev: 10, digits: 1, unit: 'V' }]
          : [{ type: 'button', label: this.scanning ? '扫描中…' : '开始扫描（0 → 85 V）', onClick: () => this.startScan() }]),
        { type: 'segment', label: '电流量程', get: () => this.range, set: (v) => (this.range = v), options: RANGES.map((_, i) => ({ label: RNAME[i].replace(' A', ''), value: i })) },
      ],
    }));
    this.pv = app.addView({ id: 'panel', title: '实验仪显示', w: 330, h: 120, res: 1.6 });
    this.cv = app.addView({ id: 'plot', title: 'I_A–U_G2K 曲线', w: 330, h: 230, res: 1.6 });
  }
  startScan() {
    const a = this.app;
    if (!this.power) return a.toast('先打开电源', 'warn');
    this.mode = 'auto'; this.VG2 = 0; this.scan = []; this.scanning = true; this.scanDone = false;
    a.renderInspector(); a.changed();
  }

  update() {
    const on = this.power, w = this.tf / Math.max(1, this.lab.VF);
    this.fil.material.emissive.setRGB(on ? Math.min(1, w) : 0, on ? 0.35 * Math.min(1, w) : 0, 0);
    this.glow.intensity = on ? 2.5 * Math.min(1, w) ** 2 : 0;
    this.drawPanel(); this.drawPlot();
    const now = performance.now();
    if (!(now - (this._lf || 0) < 250)) { this._lf = now; this.drawFace(); }
  }
  dispText() {
    if (!this.power) return { v: '', i: '' };
    const d = this.disp;
    return { v: this.VG2.toFixed(1), i: d >= 10 ? '-OL-' : d.toFixed(3) };
  }
  drawFace() {
    const c = this.dispCanvas.getContext('2d'), t = this.dispText();
    c.fillStyle = '#0b1410'; c.fillRect(20, 52, 210, 70); c.fillRect(250, 52, 210, 70);
    c.fillStyle = '#ff6b5b'; c.font = 'bold 48px Consolas, monospace'; c.textAlign = 'right';
    c.fillText(t.v, 220, 106); c.fillText(t.i, 450, 106); c.textAlign = 'left';
    c.fillStyle = '#d4d0c6'; c.fillRect(470, 52, 290, 100);
    c.fillStyle = '#374151'; c.font = '18px "Microsoft YaHei"'; c.fillText(this.power ? RNAME[this.range] : '', 476, 80);
    c.fillText(this.mode === 'auto' ? '自动' : '手动', 476, 110);
    c.fillStyle = this.power ? '#22c55e' : '#52525b'; c.beginPath(); c.arc(740, 70, 9, 0, 7); c.fill();
    this.dispTex.needsUpdate = true;
  }
  drawPanel() {
    const v = this.pv, g = v.ctx, W = v.W, H = v.H, t = this.dispText();
    g.fillStyle = '#2a2d31'; g.fillRect(0, 0, W, H);
    const box = (x, w, label, val, unit) => {
      g.fillStyle = '#0b1410'; g.fillRect(x, 20, w, 44);
      g.fillStyle = '#ff6b5b'; g.font = 'bold 30px Consolas, monospace'; g.textAlign = 'right'; g.fillText(val, x + w - 8, 54);
      g.fillStyle = '#aab2ba'; g.font = '11px "Microsoft YaHei"'; g.textAlign = 'left'; g.fillText(label, x, 14); g.fillText(unit, x, 78);
    };
    box(10, 130, 'U_G2K', t.v, 'V');
    box(160, 160, '板极电流 I_A', t.i, this.power ? RNAME[this.range] : '');
    g.fillStyle = '#c9ced3'; g.font = '11px Consolas'; g.textAlign = 'left';
    g.fillText(`U_F ${this.VF.toFixed(2)} V   U_G1K ${this.VG1.toFixed(2)} V   U_G2A ${this.VG2A.toFixed(2)} V`, 10, 100);
    let foot = this.power ? (this.mode === 'auto' ? (this.scanning ? `自动扫描中：U_G2K = ${this.VG2.toFixed(1)} V` : this.scanDone ? '扫描完成' : '自动方式：按“开始扫描”') : '手动方式') : '电源关';
    if (this.power && this.tf < this.VF * 0.95) foot += ' · 灯丝预热中';
    if (this.power && this.disp >= 10) foot += ' · 电流超量程，换大一档';
    v.foot(foot);
  }
  drawPlot() {
    const v = this.cv, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#050c08'; g.fillRect(0, 0, W, H);
    const x0 = 40, y0 = 12, w = W - 52, h = H - 40, r = RANGES[this.range], Imax = 10 * r;
    const X = (V) => x0 + (V / 90) * w, Y = (I) => y0 + h - clamp(I / Imax, 0, 1.02) * h;
    g.strokeStyle = 'rgba(125,255,158,.18)'; g.lineWidth = 1;
    for (let k = 0; k <= 9; k++) { g.beginPath(); g.moveTo(X(k * 10), y0); g.lineTo(X(k * 10), y0 + h); g.stroke(); }
    for (let k = 0; k <= 5; k++) { g.beginPath(); g.moveTo(x0, y0 + (h * k) / 5); g.lineTo(x0 + w, y0 + (h * k) / 5); g.stroke(); }
    g.fillStyle = '#7b848d'; g.font = '10px Consolas'; g.textAlign = 'center';
    for (let k = 0; k <= 9; k += 1) g.fillText(String(k * 10), X(k * 10), y0 + h + 12);
    g.textAlign = 'right'; for (let k = 0; k <= 5; k++) g.fillText(String(k * 2), x0 - 4, y0 + h - (h * k) / 5 + 3);
    g.save(); g.translate(10, y0 + h / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(`I_A / ${RNAME[this.range]}`, 0, 0); g.restore();
    g.textAlign = 'right'; g.fillText('U_G2K / V', x0 + w, y0 + h + 24);
    if (this.scan.length > 1) {
      g.strokeStyle = '#7dff9e'; g.lineWidth = 1.4; g.beginPath();
      this.scan.forEach(([V, I], i) => (i ? g.lineTo(X(V), Y(I)) : g.moveTo(X(V), Y(I)))); g.stroke();
    }
    const rows = this.app.table && this.app.table('iv');
    if (rows) {
      g.fillStyle = '#fbbf24';
      for (const rr of rows.rows) { const V = +rr.V, I = +rr.I * 1e-9; if (isFinite(V) && isFinite(I)) { g.beginPath(); g.arc(X(V), Y(I), 2, 0, 7); g.fill(); } }
    }
    if (this.power && this.mode === 'manual') { g.strokeStyle = 'rgba(255,107,91,.7)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(this.VG2), y0); g.lineTo(X(this.VG2), y0 + h); g.stroke(); g.setLineDash([]); }
    v.foot('绿线：自动扫描（相当于接示波器 X-Y 观察）；黄点：表中记录的数据');
  }

  globalControls() { return []; }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'cfg', title: '工作参数', fixedRows: true, initRows: () => [{}],
        columns: [{ key: 'VF', label: 'U_F/V', digits: 2, readTol: 0.006 }, { key: 'VG1', label: 'U_G1K/V', digits: 2, readTol: 0.006 }, { key: 'VG2A', label: 'U_G2A/V', digits: 2, readTol: 0.006 }],
        buttons: [{ label: '记录工作参数', onClick: (t) => { t.set(0, 'VF', +this.VF.toFixed(2)); t.set(0, 'VG1', +this.VG1.toFixed(2)); t.set(0, 'VG2A', +this.VG2A.toFixed(2)); } }],
        note: '按管子标签上的推荐值设置，必要时微调，使曲线峰谷清楚而电流不超量程。',
      },
      {
        id: 'iv', title: 'I_A–U_G2K 数据', maxRows: 200,
        columns: [{ key: 'V', label: 'U_G2K/V', digits: 1, readTol: 0.06 }, { key: 'I', label: 'I_A/nA', digits: 2, readTol: (ref) => 0.004 * Math.abs(ref) + 0.011 }],
        buttons: [{ label: '记录 U_G2K、I_A', onClick: (t) => this.recIV(t) }],
        note: '手动方式下从 0 开始逐渐增大 U_G2K，每隔 1 V 记一组（峰、谷附近可以加密到 0.5 V），到 80 V 以上。电流以 nA（10⁻⁹ A）为单位记录。',
      },
    ];
  }
  recIV(t) {
    const a = this.app;
    if (!this.power) return a.toast('电源没有打开', 'warn');
    if (this.mode !== 'manual') return a.toast('逐点测量要用手动方式', 'warn');
    if (this.tf < this.VF * 0.95) a.toast('灯丝还在预热，电流不稳定', 'warn');
    const d = this.disp;
    if (d >= 10) return a.toast('电流超量程：换大一档量程', 'warn');
    if (d < 0.3 && this.VG2 > 20) a.toast('电流示数太小，读数误差大：可换小一档量程', 'warn');
    const V = Math.round(this.VG2 * 10) / 10;
    if (t.rows.some((r) => Math.abs(r.V - V) < 0.05)) a.toast(`U_G2K = ${V.toFixed(1)} V 已经记过了`, 'warn');
    t.addRow({ V, I: Math.round(d * (RANGES[this.range] / 1e-9) * 1000) / 1000 });
  }

  // ======================= 自动操作 =======================
  async knob(get, set, to, ms = 400) { await this.app.tween(get, set, to, ms); set(to); this.app.changed(); }
  bestRange() {
    let mx = 0; const P = this.power; this.power = true;
    for (let V = 0; V <= SCAN_TO; V += 0.5) mx = Math.max(mx, this.current(V));
    this.power = P;
    for (let i = RANGES.length - 1; i >= 0; i--) if (mx / RANGES[i] < 9.5) return i;
    return 0;
  }
  steps() {
    const app = this.app;
    return [
      {
        title: '开机预热，设置工作参数',
        html: '<p>打开电源，按管子标签上的推荐值调节灯丝电压 U_F、第一栅压 U_G1K 和拒斥电压 U_G2A，U_G2K 先置零。灯丝要预热一段时间，发射才稳定。记下工作参数。</p>',
        hint: '灯丝电压不要超过推荐值太多，否则发射电流过大，管子寿命缩短，曲线也会畸变。',
        check: () => this.power && Math.abs(this.VF - this.lab.VF) <= 0.15 && Math.abs(this.VG1 - this.lab.VG1) <= 0.3 && Math.abs(this.VG2A - this.lab.VG2A) <= 1 && this.tf > 0.95 * this.VF && isFinite(app.table('cfg').rows[0].VF),
        auto: async () => {
          await app.view('充氩管'); app.select(app.comp('fh'));
          this.power = true; app.renderInspector();
          await this.knob(() => this.VF, (v) => (this.VF = v), this.lab.VF);
          await this.knob(() => this.VG1, (v) => (this.VG1 = v), this.lab.VG1);
          await this.knob(() => this.VG2A, (v) => (this.VG2A = v), this.lab.VG2A);
          await this.knob(() => this.VG2, (v) => (this.VG2 = v), 0, 200);
          while (this.tf < 0.97 * this.VF) await app.wait(100);
          app.showTable(0); await app.record('cfg', 0);
        },
      },
      {
        title: '自动扫描，观察曲线',
        html: `<p>置“自动扫描”方式，U_G2K 从 0 自动增大到 ${SCAN_TO} V，观察 I_A–U_G2K 曲线（相当于把实验仪的输出接到示波器上观察）。选择合适的电流量程，使曲线的最高点接近满量程而不超出。</p>`,
        hint: '曲线有一串峰和谷，相邻峰（或谷）之间的电压差就是氩原子的第一激发电位。',
        check: () => this.scanDone && this.scan.length > 10 && Math.max(...this.scan.map((p) => p[1])) / RANGES[this.range] < 10 && Math.max(...this.scan.map((p) => p[1])) / RANGES[this.range] > 1,
        auto: async () => {
          await app.view('仪器面板'); app.select(app.comp('fh'));
          this.range = this.bestRange(); this.startScan();
          while (this.scanning) await app.wait(100);
        },
      },
      {
        title: '手动逐点测量 I_A–U_G2K',
        html: '<p>置“手动”方式，U_G2K 从 0 开始逐渐增大，每隔 1 V 记录一组 U_G2K 与 I_A，峰、谷附近可加密，一直测到 80 V 以上（能看到 6 个左右的峰）。注意电流不要超量程。</p>',
        hint: 'U_G2K 不要超过约 90 V：氩气电离后电流急剧增大，会损坏管子。',
        check: () => { const r = app.table('iv').rows.filter((x) => isFinite(x.V) && isFinite(x.I)); return r.length >= 50 && Math.max(...r.map((x) => +x.V)) >= 75; },
        auto: async () => {
          await app.view('仪器面板'); app.showTable(1); app.select(app.comp('fh'));
          this.mode = 'manual'; this.scanning = false; app.renderInspector();
          for (let V = 0; V <= 84; V += 1) {
            await this.knob(() => this.VG2, (v) => (this.VG2 = v), V, 40);
            await app.record('iv', 0);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>作 I_A–U_G2K 曲线，找出各峰的位置，用逐差法或作图法求相邻峰的平均间距，即氩原子的第一激发电位。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app;
    const d = a.table('iv').rows.map((r) => [+r.V, +r.I]).filter(([V, I]) => isFinite(V) && isFinite(I)).sort((p, q) => p[0] - q[0]);
    if (d.length < 30) return { html: '<p>数据太少：请逐点测量 I_A–U_G2K，至少 30 组，测到 80 V 以上。</p>', ok: false };
    const ext = (sign) => {
      const out = [];
      for (let i = 0; i < d.length; i++) {
        const [V, I] = d[i];
        const win = d.filter(([u]) => Math.abs(u - V) <= 3.01);
        if (win.some(([, J]) => sign * (J - I) > 0)) continue;
        const far = d.filter(([u]) => Math.abs(u - V) >= 3 && Math.abs(u - V) <= 5.5);
        if (!far.length || far.some(([, J]) => sign * (I - J) < 0.03 * Math.abs(I) + 0.02)) continue;
        if (V < 5) continue;
        // 抛物线拟合（±1.6 V 内的点）求顶点
        const pts = d.filter(([u]) => Math.abs(u - V) <= 1.6);
        let Vp = V;
        if (pts.length >= 3) {
          const xs = pts.map((p) => p[0] - V), ys = pts.map((p) => p[1]);
          const S = (f) => xs.reduce((s, x, k) => s + f(x, ys[k]), 0), n = xs.length;
          const A = [[n, S((x) => x), S((x) => x * x)], [S((x) => x), S((x) => x * x), S((x) => x ** 3)], [S((x) => x * x), S((x) => x ** 3), S((x) => x ** 4)]];
          const c = solve3(A, [S((x, y) => y), S((x, y) => x * y), S((x, y) => x * x * y)]);
          if (sign * c[2] < 0) Vp = V + clamp(-c[1] / (2 * c[2]), -1, 1);
        }
        if (!out.length || Vp - out[out.length - 1][0] > 5) out.push([Vp, I]);
      }
      return out;
    };
    const pk = ext(1), vl = ext(-1).filter(([V]) => V > (pk[0] ? pk[0][0] : 0));
    if (pk.length < 4) return { html: `<p>只找到 ${pk.length} 个峰，数据不够（要测到 80 V 以上，电流不要超量程）。</p>`, ok: false };
    const n = pk.map((_, i) => i + 1), Vs = pk.map((p) => p[0]);
    const fit = linFit(n, Vs);
    const dif = Vs.slice(1).map((v, i) => v - Vs[i]);
    const h = Math.floor(pk.length / 2), sd = Array.from({ length: h }, (_, i) => (Vs[i + pk.length - h] - Vs[i]) / (pk.length - h));
    const U1 = fit.k, u = fit.uk;
    const f2 = (x) => x.toFixed(2);
    let html = `<h3>1. 峰与谷的位置</h3><p>由数据找出局部极大（用峰附近的点作抛物线拟合求顶点）：</p>
      <table><tr><th>n</th>${pk.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr><tr><td>峰 U_n /V</td>${Vs.map((v) => `<td>${f2(v)}</td>`).join('')}</tr>
      <tr><td>I_A /nA</td>${pk.map((p) => `<td>${p[1].toFixed(2)}</td>`).join('')}</tr><tr><td>U_{n+1}−U_n /V</td>${dif.map((v) => `<td>${f2(v)}</td>`).join('')}<td></td></tr>
      ${vl.length ? `<tr><td>谷 /V</td>${vl.map((p) => `<td>${f2(p[0])}</td>`).join('')}</tr>` : ''}</table>
      <h3>2. 第一激发电位</h3><p>作 U_n–n 直线拟合：斜率 ${f2(U1)} V，截距 ${f2(fit.b)} V，相关系数 ${fit.r.toFixed(5)}。逐差法（隔 ${pk.length - h} 个峰相减）：${sd.map(f2).join('，')}，平均 ${f2(mean(sd))} V。</p>
      <div class="result-box">氩原子的第一激发电位 $U_1=${fmtU(U1, u)}$ V，即第一激发能 $E_1-E_0=eU_1\\approx${f2(U1)}$ eV</div>
      <div class="result-box warn">氩原子 4s 组最低激发能级 ${AR.E1} eV，相对误差 ${pct(relErr(U1, AR.E1), 2)}。</div>
      <p>第一个峰的位置 ${f2(Vs[0])} V 并不等于 U₁：阴极与栅极材料不同，存在接触电位差，而且电子要越过拒斥电压才能到达板极。相邻峰的间距随级次略有增大，${dif.length >= 3 ? `本次由 ${f2(dif[0])} V 增大到 ${f2(dif[dif.length - 1])} V` : ''}——电子达到激发阈值后还要再走一段（平均自由程）才发生碰撞，能量越高、能激发的能级也越多（如 13.1 eV 的 4p 组能级），所以测得的平均间距比 11.55 V 稍大。</p>`;
    const plots = [
      { title: 'I_A–U_G2K', xLabel: 'U_G2K / V', yLabel: 'I_A / nA', series: [{ type: 'line', data: d }, { type: 'scatter', data: pk.map((p) => [p[0], p[1]]) }] },
      { title: '峰位 U_n–n', xLabel: 'n', yLabel: 'U_n / V', series: [{ type: 'scatter', data: n.map((k, i) => [k, Vs[i]]) }, { type: 'line', data: [[0.5, fit.b + 0.5 * U1], [pk.length + 0.5, fit.b + (pk.length + 0.5) * U1]], dash: [5, 4] }] },
    ];
    return { html, ok: true, answers: [{ label: '$U_1$', unit: 'V', value: U1, digits: 2, tolRel: 0.01 }], plots };
  }

  principle() {
    return `<h3>1. 实验原理</h3>${franckHertzFig()}<p>1914 年弗兰克和赫兹用慢电子与稀薄气体原子碰撞的方法，证明了原子内部的能量是量子化的。充氩四极管中，灯丝加热的阴极 K 发射电子，第一栅极 G1 控制电子流，电子在 G2 与 K 之间被电压 U_G2K 加速，与氩原子碰撞。G2 与板极 A 之间加约几伏的拒斥电压 U_G2A，只有到达 G2 时能量足够的电子才能到达板极形成电流 I_A。</p>
<p>电子能量小于氩原子的第一激发能 $E_1-E_0$ 时，与原子只作弹性碰撞，几乎不损失能量；能量达到 $E_1-E_0$ 时，就可能把能量交给原子使它激发，自身几乎失去全部能量，不能越过拒斥电压。所以 U_G2K 增大时 I_A 先增大，到电子刚好能在 G2 附近激发原子时 I_A 下降；U_G2K 再增大，电子激发原子后又被加速……每当 U_G2K 增大约 $U_1=(E_1-E_0)/e$，就出现一个峰。</p>
<h3>2. 第一激发电位</h3><p>相邻两峰（或两谷）对应的电压差即第一激发电位 $U_1$。由于接触电位差，第一个峰的位置不是 $U_1$，但它不影响峰间距。</p>
<h3>3. 本仿真的计算模型</h3><p>把 G2-K 间的加速区分成 300 层，逐层推进电子的能量分布：每层电子获得能量 $eU/300$；能量超过阈值的电子按随能量上升的激发截面以一定概率碰撞，损失 11.55 eV（4s 组能级），能量超过 13.1 eV 时也可能激发 4p 组能级。电子在两次碰撞间还要多走一段，因此峰间距比 11.55 V 稍大并随级次增大，后面的谷也逐渐抬高——与实际的氩管曲线相同。灯丝发射随灯丝电压近似按指数变化，并有约 6 s 的预热过程；U_G2K 过高时氩气电离，电流急剧增大。</p>`;
  }
}

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < 3; r++) { if (r === i) continue; const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((r, i) => r[3] / r[i]);
}
