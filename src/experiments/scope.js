// 实验：自组望远镜和显微镜（光学仪器的放大原理 · 出瞳与视场 · 比较法测视角放大率）
import * as THREE from 'three';
import { meta, thumb } from './scope.meta.js';
import { Component } from '../core/Component.js';
import { AXIS_Y, MAT, mesh, labTable, opticalRail, carriage, lensMesh, ICONS, glowSprite } from '../core/Models.js';
import { mean, gauss, rand, relErr, pct } from '../core/Stats.js';

const X_FAR = -8000; // 远处标尺的位置 mm（导轨零点左侧 8 m）
const NEAR = 250; // 明视距离 mm
const PUPIL = 3; // 眼瞳直径 mm
const HALF = 10 * Math.PI / 180; // 视场窗半角
const LENSES = {
  LA: { name: '透镜 A（f≈30 cm）', nom: 300, a: 20, d: 5 },
  LB: { name: '透镜 B（f≈5 cm）', nom: 50, a: 10, d: 2.6 },
  LC: { name: '透镜 C（f≈3 cm）', nom: 30, a: 6, d: 1.8 },
};
// 各标尺：每格的长度（mm）与视场中心对应的读数（格）
const SCALES = {
  far: { div: 50, c0: 10, name: '远处标尺（每格 5 cm）' },
  micro: { div: 0.1, c0: 30, name: '微尺（每格 0.1 mm）' },
  ruler: { div: 1, c0: 30, name: '明视距离处的直尺（每格 1 mm）' },
};

export class ScopeExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.f = {};
    for (const [k, o] of Object.entries(LENSES)) this.f[k] = o.nom * rand(0.975, 1.025);
    this.m1 = 8; this.m2 = 12; this.N = 1;
    this.lampOn = false;
    this.assist = true;
    this._charts = {};
  }

  // ---------------- 光学系统 ----------------
  P(k) { const c = this.app.comp(k); return c.placed ? c.pos * 10 : null; }
  /** 当前物体和眼睛之间的透镜（按位置排序） */
  system() {
    const xe = this.P('eye');
    if (xe == null) return null;
    const xm = this.P('micro');
    const kind = xm != null && xm < xe ? 'micro' : 'far';
    const xo = kind === 'micro' ? xm : X_FAR;
    const lenses = Object.keys(LENSES).filter((k) => this.P(k) != null && this.P(k) > xo && this.P(k) < xe).map((k) => ({ k, x: this.P(k), f: this.f[k], a: LENSES[k].a })).sort((p, q) => p.x - q.x);
    return { kind, xo, xe, lenses };
  }
  /** 从眼睛反向追迹一条“经过眼瞳中心、视角为 1 rad”的光线；返回物面高度 K 与视场半角 φmax */
  trace(sys) {
    let y = 0, th = -1, x = sys.xe, phiMax = Infinity;
    for (let i = sys.lenses.length - 1; i >= 0; i--) {
      const L = sys.lenses[i];
      y -= th * (x - L.x);
      if (Math.abs(y) > 1e-9) phiMax = Math.min(phiMax, L.a / Math.abs(y));
      th += y / L.f;
      x = L.x;
    }
    y -= th * (x - sys.xo);
    return { K: y, phiMax };
  }
  /** 物点发出的光到达眼睛时的会聚度 V（1/mm，正为发散），以及眼睛无法调节的部分 */
  vergence(sys) {
    let A = 1, B = 0, C = 0, D = 1, x = sys.xo;
    const prop = (d) => { A += d * C; B += d * D; };
    for (const L of sys.lenses) { prop(L.x - x); C = C - A / L.f; D = D - B / L.f; x = L.x; }
    prop(sys.xe - x);
    const V = Math.abs(B) < 1e-9 ? 1e3 : D / B;
    const dV = V < 0 ? -V : V > 1 / NEAR ? V - 1 / NEAR : 0;
    return { V, dV };
  }
  /** 理论视角放大率（与直接观察比较） */
  gammaTrue(sys = this.system()) {
    if (!sys || !sys.lenses.length) return NaN;
    const { K } = this.trace(sys);
    const Kn = sys.kind === 'micro' ? NEAR : sys.xe - X_FAR;
    return Kn / Math.abs(K);
  }
  /** 除最后一块透镜外，前面各透镜对物所成的像的位置 */
  midImage(sys) {
    let xo = sys.xo;
    for (const L of sys.lenses.slice(0, -1)) { const u = L.x - xo; xo = L.x + 1 / (1 / L.f - 1 / u); }
    return xo;
  }
  /** 出瞳位置：最后一块透镜对第一块透镜（孔径光阑）所成的像 */
  exitPupil(sys) {
    if (!sys || sys.lenses.length < 2) return null;
    const a = sys.lenses[0], b = sys.lenses[sys.lenses.length - 1];
    const u = b.x - a.x, v = 1 / (1 / b.f - 1 / u);
    return b.x + v;
  }

  cameras() {
    return [
      { name: '全景', pos: [55, 70, 120], target: [55, 18, 0] },
      { name: '望远镜', pos: [30, 38, 50], target: [30, 22, 0] },
      { name: '显微镜', pos: [80, 36, 44], target: [80, 22, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(220, 90); t.position.set(55, 0, 0); scene.add(t);
    scene.add(opticalRail(110));
    app.addRail({ origin: new THREE.Vector3(0, 0, 0), min: 0, max: 110 });
    app.stage.setLightTarget(55, 0, 0);

    // 远处标尺（墙上）
    const fg = new THREE.Group();
    const farTex = new THREE.CanvasTexture(this.chart('far')); farTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(40, 100), new THREE.MeshStandardMaterial({ map: farTex, roughness: 0.8 }));
    board.rotation.y = Math.PI / 2; board.position.set(X_FAR / 10, AXIS_Y, 0);
    fg.add(board);
    app.addComponent(new Component({ key: 'far', name: '远处标尺', zone: 'none', fixed: true, object: fg, showLabel: false, desc: '挂在约 8 m 外墙上的标尺，每格 5 cm，用于望远镜。' }));

    // 微尺（带照明）
    const mc = carriage(0x9aa3b2, AXIS_Y);
    const mg = new THREE.Group();
    mg.add(mesh(new THREE.BoxGeometry(0.4, 5, 5), MAT.glass(0xf8fafc, 0.7)));
    mg.add(mesh(new THREE.BoxGeometry(0.2, 1.2, 0.3), MAT.emissive(0x111111, 0.1), 0.22, 0, 0));
    mg.add(mesh(new THREE.BoxGeometry(3, 4, 4), MAT.paint(0x2d3748), -2.2, 0, 0));
    this.microGlow = glowSprite(0xfff4d6, 5); this.microGlow.position.set(-0.6, 0, 0); mg.add(this.microGlow);
    mc.top.add(mg);
    app.addComponent(new Component({
      key: 'micro', name: '微尺（带照明）', icon: ICONS.object, zone: 'rail', defaultPos: 60, object: mc.group, labelY: 30,
      desc: '玻璃微尺，1 mm 分为 10 格（每格 0.1 mm），背后有照明灯。用作显微镜的观察物。',
    }));

    for (const [k, o] of Object.entries(LENSES)) {
      const c = carriage(0x9aa3b2, AXIS_Y);
      c.top.add(lensMesh(o.a / 5, o.d / 10 + 0.3));
      app.addComponent(new Component({ key: k, name: o.name, icon: ICONS.lens, zone: 'rail', defaultPos: k === 'LA' ? 10 : k === 'LB' ? 45 : 64, object: c.group, labelY: 30, desc: `会聚透镜，标称焦距 ${o.nom / 10} cm（实际值有 ±2% 的偏差），通光口径 φ${o.a * 2} mm。` }));
    }

    const ec = carriage(0x9aa3b2, AXIS_Y);
    const eg = new THREE.Group();
    eg.add(mesh(new THREE.SphereGeometry(1.2, 24, 16), MAT.white(), 0.6, 0, 0));
    eg.add(mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshStandardMaterial({ color: 0x3b2f22 }), -0.62, 0, 0).rotateY(-Math.PI / 2));
    eg.add(mesh(new THREE.BoxGeometry(2.6, 3.4, 3.4), MAT.paint(0x4b5a53), 2.6, 0, 0));
    ec.top.add(eg);
    app.addComponent(new Component({
      key: 'eye', name: '观察者的眼睛', icon: ICONS.scope, zone: 'rail', defaultPos: 52, required: true, object: ec.group, labelY: 30,
      desc: '眼瞳直径约 3 mm，能看清 25 cm 到无穷远处的物（像）。另一只眼直接看比较用的标尺。',
      controls: () => [
        { type: 'knob', label: '比较标线 1（直接看到的标尺读数）', get: () => this.m1, set: (v) => (this.m1 = v), min: 0, max: 60, step: 0.02, bigStep: 0.5, perRev: 5, digits: 2, unit: '格' },
        { type: 'knob', label: '比较标线 2', get: () => this.m2, set: (v) => (this.m2 = v), min: 0, max: 60, step: 0.02, bigStep: 0.5, perRev: 5, digits: 2, unit: '格' },
        { type: 'segment', label: '两标线之间的放大像格数 N', get: () => this.N, set: (v) => (this.N = v), options: [1, 2, 3, 5].map((n) => ({ label: String(n), value: n })) },
      ],
    }));

    for (const k of Object.keys(SCALES)) this.chart(k);
    this.view = app.addView({ id: 'eye', title: '眼睛看到的像（左） · 另一只眼直接看（右）', w: 300, h: 240, res: 1 });
  }

  /** 标尺图案（离屏画布，按毫米坐标采样） */
  chart(kind) {
    if (this._charts[kind]) return this._charts[kind].canvas;
    const S = SCALES[kind];
    const nDiv = kind === 'far' ? 20 : 60; // 总格数
    const pxPerDiv = kind === 'far' ? 50 : 20;
    const W = kind === 'far' ? 400 : 240, H = nDiv * pxPerDiv;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = kind === 'micro' ? '#f3f1e6' : '#ece8dc'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111'; g.textBaseline = 'middle';
    for (let i = 0; i <= nDiv; i++) {
      const y = H - i * pxPerDiv;
      if (kind === 'far') {
        if (i < nDiv && i % 2 === 0) g.fillRect(W * 0.3, y - pxPerDiv, W * 0.16, pxPerDiv);
        g.fillRect(W * 0.3, y - 1.5, W * 0.3, 3);
        if (i % 2 === 0) { g.font = 'bold 34px Arial'; g.fillText(String(i), W * 0.64, y); }
      } else {
        const L = i % 10 === 0 ? 0.55 : i % 5 === 0 ? 0.42 : 0.3;
        g.fillRect(W * 0.22, y - 1, W * L * 0.7, 2);
        if (i % 10 === 0) { g.font = 'bold 22px Arial'; g.fillText(String(kind === 'micro' ? i / 10 : i), W * 0.64, y); }
      }
    }
    const data = g.getImageData(0, 0, W, H).data;
    this._charts[kind] = { canvas: cv, data, W, H, mmPerPx: S.div / pxPerDiv, x0: W * 0.46 };
    return cv;
  }
  /** 在标尺上 (横 z, 竖 y)（mm，相对光轴）处取颜色 */
  sample(kind, zmm, ymm) {
    const c = this._charts[kind] || (this.chart(kind), this._charts[kind]);
    const S = SCALES[kind];
    const py = Math.round(c.H - (ymm / S.div + S.c0) * (S.div / c.mmPerPx));
    const px = Math.round(c.x0 + zmm / c.mmPerPx);
    if (py < 0 || py >= c.H || px < 0 || px >= c.W) return 40;
    return c.data[(py * c.W + px) * 4];
  }

  update() {
    const mOn = this.app.comp('micro').placed;
    this.microGlow.visible = mOn;
    this.drawView();
  }

  /** 标线读数 m（格）在直接观察中对应的视角 */
  nakedK(sys) { return sys.kind === 'micro' ? NEAR : sys.xe - X_FAR; }
  nakedScale(sys) { return sys.kind === 'micro' ? 'ruler' : 'far'; }
  phiOfReading(m, sys) { const S = SCALES[this.nakedScale(sys)]; return ((m - S.c0) * S.div) / this.nakedK(sys); }

  drawView() {
    const v = this.view, g = v.ctx, W = v.W, H = v.H;
    const half = Math.floor(W / 2) - 2;
    const pix = HALF / (H / 2);
    g.fillStyle = '#0b0e0d'; g.fillRect(0, 0, W, H);
    const sys = this.system();
    if (!sys) { v.foot('请把“观察者的眼睛”放到导轨上'); return; }
    const tr = this.trace(sys), vg = this.vergence(sys);
    const img = g.createImageData(half, H);
    const kind = sys.kind;
    const bright = kind === 'micro' ? 1 : 0.92;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < half; px++) {
        const ax = (px - half / 2 + 0.5) * pix, ay = (H / 2 - py - 0.5) * pix;
        const k = (py * half + px) * 4;
        const r = Math.hypot(ax, ay);
        let val = 16;
        if (r < tr.phiMax) {
          // 视角 (ax, ay) ↔ 物面坐标 (K·ax, K·ay)
          val = this.sample(kind, tr.K * ax, tr.K * ay) * bright;
          const edge = tr.phiMax - r;
          if (edge < pix * 3) val = 16 + (val - 16) * (edge / (pix * 3));
        }
        img.data[k] = val; img.data[k + 1] = val * 0.98; img.data[k + 2] = val * 0.9; img.data[k + 3] = 255;
      }
    }
    // 模糊：眼睛无法调节的会聚度 × 瞳孔直径 = 角模糊
    const blurPx = Math.min(14, (PUPIL * vg.dV) / pix / 2);
    const off = this._off || (this._off = document.createElement('canvas'));
    off.width = half; off.height = H;
    off.getContext('2d').putImageData(img, 0, 0);
    g.save(); g.filter = blurPx > 0.4 ? `blur(${blurPx.toFixed(1)}px)` : 'none'; g.drawImage(off, 0, 0); g.restore();
    // 右半：另一只眼直接看比较标尺
    const nk = this.nakedScale(sys), Kn = this.nakedK(sys);
    const img2 = g.createImageData(half, H);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < half; px++) {
        const ax = (px - half / 2 + 0.5) * pix, ay = (H / 2 - py - 0.5) * pix;
        const val = this.sample(nk, Kn * ax, Kn * ay) * 0.8;
        const k = (py * half + px) * 4;
        img2.data[k] = val; img2.data[k + 1] = val * 0.98; img2.data[k + 2] = val * 0.9; img2.data[k + 3] = 255;
      }
    }
    g.putImageData(img2, W - half, 0);
    g.fillStyle = '#20262a'; g.fillRect(half, 0, W - 2 * half, H);
    // 比较标线
    for (const [m, c] of [[this.m1, '#ef4444'], [this.m2, '#22c55e']]) {
      const y = H / 2 - this.phiOfReading(m, sys) / pix;
      g.strokeStyle = c; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    let foot;
    const nL = sys.lenses.length;
    if (!nL) foot = '没有透镜：两边看到的一样';
    else if (vg.V < 0) foot = '像在眼睛后面（会聚光）：看不清，调节透镜间距';
    else if (vg.dV > 0) foot = '像离眼睛太近：看不清';
    else foot = this.assist ? `像在眼前 ${vg.V < 1e-5 ? '无穷远' : (1 / vg.V / 10).toFixed(0) + ' cm'} · Γ≈${this.gammaTrue(sys).toFixed(2)} · 视场半角 ${Math.min(99, (tr.phiMax * 180) / Math.PI).toFixed(1)}°` : '';
    v.foot(foot);
  }

  globalControls() {
    return [{ type: 'toggle', label: '显示成像状态辅助', get: () => this.assist, set: (v) => (this.assist = v) }];
  }

  tables() {
    const g = (k) => (r) => (k * Math.abs(r.m2 - r.m1)) / r.N;
    return [
      {
        id: 'tel', title: '望远镜', maxRows: 6,
        columns: [
          { key: 'xo', label: '物镜位置/cm', digits: 2 }, { key: 'xe', label: '目镜位置/cm', digits: 2 },
          { key: 'L', label: '镜筒长 L/cm', digits: 2, calc: (r) => r.xe - r.xo },
          { key: 'm1', label: '标线 1/格', digits: 2 }, { key: 'm2', label: '标线 2/格', digits: 2 }, { key: 'N', label: 'N', digits: 0 },
          { key: 'G', label: 'Γ = |m₂−m₁|/N', digits: 2, calc: g(1) },
        ],
        buttons: [{ label: '记录导轨位置和比较读数', onClick: (t) => this.rec(t, 'far') }],
        note: '左眼通过望远镜看标尺，右眼直接看同一标尺。转动两条标线，使它们分别对准放大像中 N 格的两端，读出直接看到的格数。Γ = 直接看的格数 / N。',
      },
      {
        id: 'mic', title: '显微镜', maxRows: 6,
        columns: [
          { key: 'xs', label: '微尺位置/cm', digits: 2 }, { key: 'xo', label: '物镜位置/cm', digits: 2 }, { key: 'xe', label: '目镜位置/cm', digits: 2 },
          { key: 'm1', label: '标线 1/mm', digits: 2 }, { key: 'm2', label: '标线 2/mm', digits: 2 }, { key: 'N', label: 'N/格', digits: 0 },
          { key: 'G', label: 'Γ = 10|m₂−m₁|/N', digits: 1, calc: g(10) },
        ],
        buttons: [{ label: '记录导轨位置和比较读数', onClick: (t) => this.rec(t, 'micro') }],
        note: '右眼看 25 cm 处的直尺（每格 1 mm），微尺每格 0.1 mm，故 Γ = (|m₂−m₁| × 1 mm)/(N × 0.1 mm)。',
      },
    ];
  }

  /** 两条标线应当对准的读数（放大像中第 r0、r0+N 格刻线对应的直接观察读数） */
  idealMarks(sys = this.system()) {
    const tr = this.trace(sys), S = SCALES[sys.kind];
    const Sn = SCALES[this.nakedScale(sys)], Kn = this.nakedK(sys);
    const r0 = Math.round(S.c0 - this.N / 2);
    const toM = (r) => { const phi = ((r - S.c0) * S.div) / tr.K; return Sn.c0 + (phi * Kn) / Sn.div; };
    return [toM(r0), toM(r0 + this.N)].sort((a, b) => a - b);
  }
  rec(t, kind) {
    const sys = this.system();
    if (!sys || sys.kind !== kind) return this.app.toast(kind === 'far' ? '现在观察的不是远处标尺（取下微尺）' : '请先放上微尺', 'warn');
    if (sys.lenses.length < 2) return this.app.toast('需要物镜和目镜两块透镜', 'warn');
    const vg = this.vergence(sys);
    if (vg.dV > 0 || vg.V < 0) this.app.toast('像不清楚，先调焦', 'warn');
    const [a, b] = this.idealMarks(sys), [p, q] = [this.m1, this.m2].sort((x, y) => x - y);
    if (Math.abs(p - a) > 0.25 || Math.abs(q - b) > 0.25) this.app.toast(`两条标线没有对准放大像中 ${this.N} 格的两端`, 'warn');
    const L = sys.lenses;
    const r = { xo: L[0].x / 10, xe: L[L.length - 1].x / 10, m1: Math.round(this.m1 * 100) / 100, m2: Math.round(this.m2 * 100) / 100, N: this.N };
    if (kind === 'micro') r.xs = sys.xo / 10;
    t.addRow(r);
  }

  steps() {
    const app = this.app;
    const on = (k) => app.comp(k).placed;
    const focusEye = async (key, targetV) => {
      // 前一级所成的中间像在 xi；目镜放在 xi 与 xi+f 之间时成正立虚像，会聚度随目镜位置单调变化
      const sys = this.system(), Lb = sys.lenses[sys.lenses.length - 1];
      const xi = this.midImage(sys);
      let lo = xi + 0.05, hi = xi + Lb.f - 0.05;
      const Vat = (x) => { const s2 = { ...sys, lenses: sys.lenses.map((L) => (L.k === key ? { ...L, x } : L)) }; return this.vergence(s2).V; };
      for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (Vat(m) > targetV) lo = m; else hi = m; }
      await app.moveTo(key, (lo + hi) / 2 / 10 + gauss(0.01), 1000);
    };
    const toPupil = async () => { const xp = this.exitPupil(this.system()); await app.moveTo('eye', xp / 10 + gauss(0.2), 900); };
    const mark = async () => {
      app.select(app.comp('eye'));
      const sys = this.system();
      const want = sys.kind === 'far' ? 2 : 3;
      this.N = want; app.changed();
      const [a, b] = this.idealMarks(sys);
      await app.tween(() => this.m1, (v) => (this.m1 = v), a + gauss(0.04), 700);
      await app.tween(() => this.m2, (v) => (this.m2 = v), b + gauss(0.04), 700);
    };
    return [
      {
        title: '组装望远镜：物镜、目镜和眼睛',
        html: '<p>选焦距<b>长</b>的透镜 A 作物镜、焦距<b>短</b>的透镜 B 作目镜，依次放在导轨上，两镜相距约 $f_1+f_2$；把“观察者的眼睛”放在目镜后面。观察对象是 8 m 外的远处标尺。</p>',
        check: () => on('LA') && on('LB') && on('eye') && !on('micro') && this.P('LA') < this.P('LB') && this.P('LB') < this.P('eye'),
        auto: async () => { await app.view('全景'); await app.autoPlace('LA', { pos: 10 }); await app.autoPlace('LB', { pos: 47 }); await app.autoPlace('eye', { pos: 56 }); },
      },
      {
        title: '调焦：看清远处标尺',
        html: '<p>前后移动目镜，使远处标尺的像清晰，而且眼睛处于放松状态（像在远处）。注意像是<b>倒立</b>的。</p>',
        hint: '物镜把远处的标尺成像在其焦面附近，目镜像放大镜一样观察这个实像。像位于目镜焦面上时，出射光为平行光，眼睛最放松。',
        check: () => { const s = this.system(); if (!s || s.kind !== 'far' || s.lenses.length < 2) return false; const vg = this.vergence(s); return vg.dV === 0 && vg.V < 0.0012; },
        status: () => { const s = this.system(); if (!s) return ''; const vg = this.vergence(s); return vg.V < 0 ? '像在眼后：目镜离物镜太远' : vg.dV > 0 ? '像离眼睛太近：目镜离物镜太近' : `像在眼前 <b>${vg.V < 1e-5 ? '∞' : (1 / vg.V / 10).toFixed(0) + ' cm'}</b>`; },
        auto: async () => { await app.view('望远镜'); await focusEye('LB', 0.0003); },
      },
      {
        title: '把眼睛放到出瞳处，视场最大',
        html: '<p>前后移动眼睛，观察视场大小的变化。眼睛位于<b>出瞳</b>（物镜经目镜所成的像）处时视场最大。</p>',
        check: () => { const s = this.system(); const xp = this.exitPupil(s); return xp != null && s.kind === 'far' && Math.abs(this.P('eye') - xp) < 15; },
        status: () => { const s = this.system(); const xp = this.exitPupil(s); return xp != null ? `视场半角 <b>${((this.trace(s).phiMax * 180) / Math.PI).toFixed(1)}°</b>${this.assist ? `，眼睛离出瞳 ${((this.P('eye') - xp) / 10).toFixed(1)} cm` : ''}` : ''; },
        auto: async () => { await toPupil(); },
      },
      {
        title: '比较法测望远镜的放大率',
        html: '<p>在观察者的眼睛上选 N（如 2 格），转动两条比较标线，使它们分别对准<b>放大像</b>中相隔 N 格的两条刻线，读出两标线在<b>直接看到的</b>标尺上的读数 $m_1$、$m_2$，记录。可改变 N 再测一次。</p>',
        check: () => app.table('tel').completeRows().length >= 1,
        auto: async () => { const t = app.table('tel'); app.showTable(app.tables.indexOf(t)); await mark(); await app.record('tel'); },
      },
      {
        title: '组装显微镜',
        html: '<p>取下透镜 A。把<b>微尺</b>放到导轨右段，焦距最短的透镜 C 作物镜放在微尺后、距离略大于其焦距；透镜 B 作目镜放在物镜后约 25 cm 处；眼睛在目镜后。</p>',
        check: () => !on('LA') && on('micro') && on('LC') && on('LB') && this.P('micro') < this.P('LC') && this.P('LC') < this.P('LB') && this.P('LB') < this.P('eye') && this.P('LC') - this.P('micro') > this.f.LC,
        auto: async () => {
          await app.view('显微镜');
          app.remove(app.comp('LA'));
          await app.moveTo('eye', 104, 700);
          await app.moveTo('LB', 92, 700);
          await app.autoPlace('micro', { pos: 60 }); await app.autoPlace('LC', { pos: 63.6 });
        },
      },
      {
        title: '显微镜调焦',
        html: '<p>微调<b>物镜</b>与微尺的距离（或整体移动目镜），使微尺刻线清晰。显微镜的像可以在明视距离到无穷远之间。</p>',
        check: () => { const s = this.system(); if (!s || s.kind !== 'micro' || s.lenses.length < 2) return false; const vg = this.vergence(s); return vg.dV === 0 && vg.V >= 0; },
        status: () => { const s = this.system(); if (!s || s.kind !== 'micro') return ''; const vg = this.vergence(s); return vg.V < 0 ? '像在眼后' : vg.dV > 0 ? '像离眼睛太近' : `像在眼前 <b>${vg.V < 1e-5 ? '∞' : (1 / vg.V / 10).toFixed(0) + ' cm'}</b>，Γ≈${this.gammaTrue(s).toFixed(1)}`; },
        auto: async () => { await focusEye('LB', 0.0008); await toPupil(); },
      },
      {
        title: '比较法测显微镜的放大率',
        html: '<p>另一只眼看 25 cm 处的直尺（每格 1 mm）。转动两条标线对准放大像中相隔 N 格（每格 0.1 mm）的两条刻线，记录直尺读数。</p>',
        check: () => app.table('mic').completeRows().length >= 1,
        auto: async () => { const t = app.table('mic'); app.showTable(app.tables.indexOf(t)); await mark(); await app.record('mic'); },
      },
      {
        title: '数据处理：与理论放大率比较',
        html: '<p>望远镜 $\\Gamma=f_1/f_2$；显微镜 $\\Gamma\\approx\\dfrac{\\Delta}{f_o}\\cdot\\dfrac{250\\ \\text{mm}}{f_e}$，$\\Delta$ 为物镜像方焦点到目镜物方焦点的距离（光学筒长）。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const tel = this.app.table('tel').completeRows(), mic = this.app.table('mic').completeRows();
    if (!tel.length && !mic.length) return { html: '<p>请先用比较法测望远镜或显微镜的放大率。</p>', ok: false };
    let html = '';
    const answers = [];
    const fA = LENSES.LA.nom, fB = LENSES.LB.nom, fC = LENSES.LC.nom;
    // 用记录的位置和真实焦距重建光学系统，计算这一组位置下的理论放大率
    const exact = (lens, xo, xe, kind) => {
      const ls = lens.map(([k, x]) => ({ k, x: x * 10, f: this.f[k], a: 1e9 }));
      const sys = { kind, xo, xe: 0, lenses: ls };
      // 眼睛放在最后一块透镜后的出瞳处（视角放大率与眼睛位置无关，只需在透镜后）
      sys.xe = ls[ls.length - 1].x + 60;
      return this.gammaTrue(sys);
    };
    if (tel.length) {
      const G = tel.map((r) => Math.abs(r.m2 - r.m1) / r.N), Gm = mean(G);
      const Gex = mean(tel.map((r) => exact([['LA', r.xo], ['LB', r.xe]], X_FAR, 0, 'far')));
      html += `<h3>1. 望远镜</h3><table><tr><th>镜筒长 L/cm</th>${tel.map((r) => `<td>${(r.xe - r.xo).toFixed(2)}</td>`).join('')}</tr><tr><th>Γ</th>${G.map((v) => `<td>${v.toFixed(2)}</td>`).join('')}</tr></table>
        <div class="result-box">$\\Gamma_{望}=${Gm.toFixed(2)}$</div>
        <p>按标称焦距 $f_1/f_2=${fA / 10}/${fB / 10}=${(fA / fB).toFixed(2)}$，实测镜筒长 ${(tel[0].xe - tel[0].xo).toFixed(1)} cm 与 $f_1+f_2=${((fA + fB) / 10).toFixed(1)}$ cm 接近。标尺距离有限（约 8 m），物镜所成的像在焦面之后，而且直接观察时眼睛离标尺比物镜更远，所以 Γ 比 $f_1/f_2$ 略大。</p>`;
      answers.push({ label: '望远镜视角放大率 $\\Gamma$', value: Gm, digits: 2, tolRel: 0.01 });
      this._gt = [Gm, Gex];
    }
    if (mic.length) {
      const G = mic.map((r) => (10 * Math.abs(r.m2 - r.m1)) / r.N), Gm = mean(G);
      const r = mic[0];
      const Delta = (r.xe - r.xo) * 10 - fC - fB;
      const Gnom = (Delta / fC) * (250 / fB);
      const Gex = mean(mic.map((q) => exact([['LC', q.xo], ['LB', q.xe]], q.xs * 10, 0, 'micro')));
      html += `<h3>2. 显微镜</h3><table><tr><th>物镜–微尺/cm</th>${mic.map((q) => `<td>${(q.xo - q.xs).toFixed(2)}</td>`).join('')}</tr><tr><th>物镜–目镜/cm</th>${mic.map((q) => `<td>${(q.xe - q.xo).toFixed(2)}</td>`).join('')}</tr><tr><th>Γ</th>${G.map((v) => `<td>${v.toFixed(1)}</td>`).join('')}</tr></table>
        <div class="result-box">$\\Gamma_{显}=${Gm.toFixed(1)}$</div>
        <p>按标称焦距估算：光学筒长 $\\Delta=${(Delta / 10).toFixed(1)}$ cm，$\\Gamma≈\\dfrac{\\Delta}{f_o}\\cdot\\dfrac{250}{f_e}=${Gnom.toFixed(1)}$。近似公式假设像在无穷远，像在有限远处时实际放大率略大。</p>`;
      answers.push({ label: '显微镜视角放大率 $\\Gamma$', value: Gm, digits: 1, tolRel: 0.01 });
      this._gm = [Gm, Gex];
    }
    const warn = [];
    if (tel.length) warn.push(`按本组位置和透镜实际焦距算出的望远镜放大率为 ${this._gt[1].toFixed(2)}，比较法相对误差 ${pct(relErr(this._gt[0], this._gt[1]))}`);
    if (mic.length) warn.push(`显微镜为 ${this._gm[1].toFixed(1)}，比较法相对误差 ${pct(relErr(this._gm[0], this._gm[1]))}`);
    html += `<div class="result-box warn">透镜实际焦距：A ${(this.f.LA / 10).toFixed(2)} cm，B ${(this.f.LB / 10).toFixed(2)} cm，C ${(this.f.LC / 10).toFixed(2)} cm。${warn.join('；')}。</div>`;
    return { html, ok: true, answers, plots: [] };
  }

  principle() {
    return `<h3>1. 视角放大率</h3><p>人眼对物体细节的分辨取决于物体对眼睛的张角。光学仪器的视角放大率 $\\Gamma=\\omega'/\\omega$：$\\omega'$ 是通过仪器看到的像的张角，$\\omega$ 是不用仪器时物体的张角（望远镜：物体在原处；显微镜：物体放在明视距离 25 cm 处）。</p>
<h3>2. 开普勒望远镜</h3><p>物镜（长焦 $f_1$）把远处物体成实像于其后焦面，目镜（短焦 $f_2$）把这个实像当作物来放大。物镜后焦点与目镜前焦点重合时，镜筒长 $L=f_1+f_2$，出射平行光，$\\Gamma=f_1/f_2$，像是倒立的。物镜经目镜所成的像叫<b>出瞳</b>，眼睛放在出瞳处视场最大。</p>
<h3>3. 显微镜</h3><p>物镜（短焦 $f_o$）把物体成放大实像，目镜再放大：</p>$$\\Gamma\\approx\\frac{\\Delta}{f_o}\\cdot\\frac{250\\ \\text{mm}}{f_e}$$<p>$\\Delta$ 为光学筒长。</p>
<h3>4. 比较法</h3><p>一只眼通过仪器看标尺的像，另一只眼直接看标尺（或明视距离处的直尺），两个像在大脑中重叠。放大像中 $N$ 格对应直接看到的 $n$ 格，则 $\\Gamma=n/N$（显微镜还要乘以两种标尺分度之比）。</p>
<h3>5. 本仿真的计算模型</h3><p>眼睛看到的画面由<b>反向光线追迹</b>得到：对视场中每个方向，从眼瞳中心出发反向经过各透镜到达物面，取该处标尺的颜色。因此像的倒正、大小、视场（透镜通光口径造成的渐晕）都自动得到。由物点到眼睛的 ABCD 矩阵求出射光的会聚度，超出人眼调节范围（25 cm 到无穷远）的部分按 3 mm 瞳孔换算为模糊。透镜实际焦距与标称值有 ±2% 的随机偏差。</p>`;
  }
}
