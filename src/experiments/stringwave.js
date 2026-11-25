// 实验：弦线上的驻波（固定频率改变弦长找共振 · 改变张力验证 v = √(T/μ)）
// 弦的受迫振动按 physics/string.js 的模式叠加计算（计入钢丝的抗弯刚度与阻尼）：
// 只有弦长接近半波长的整数倍时振幅才明显变大，共振峰宽约 ±0.4%；判断“振幅最大”的位置由学生自己看。
import * as THREE from 'three';
import { meta, thumb } from './stringwave.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox, canvasTexture } from '../core/Models.js';
import { mean, rand, relErr, pct, clamp, gauss, fmtU, linFit } from '../core/Stats.js';
import { StringModel } from '../physics/string.js';
import { stringFig } from './mechFigs2.js';

const G = 9.794; // 本地重力加速度（m/s²）
const XA = -45, Y0 = 14; // 劈尖 A 的位置、弦的高度（cm）
const LMIN = 10, LMAX = 95; // 劈尖 B 的移动范围（弦长，cm）
const X_DRV = 2; // 驱动磁钢离劈尖 A 的距离（cm）
const MASSES = [0.5, 1.0, 1.5, 2.0, 2.5];
const NX = 160;
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class StringWaveExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.d = rand(0.296, 0.304) * 1e-3; // 钢丝直径（m）
    this.model = new StringModel({ d: this.d, T: G, L: 0.4, x0: X_DRV / 100, zeta: rand(0.0035, 0.0045) });
    this.muLabel = Math.round(this.model.mu * (1 + gauss(0.0015)) * 1e7) / 1e7; // 标签上的线密度（称 1 m 弦线得到）
    this.mErr = Object.fromEntries(MASSES.map((m) => [m, 1 + rand(-0.001, 0.001)])); // 砝码的实际质量
    this.m = 1.0; this.L = 40; this.on = false; this.f = 100; this.drive = 5;
    this._key = ''; this.env = new Float64Array(NX + 1);
  }
  get T() { return this.m * this.mErr[this.m] * G; }
  sync() { this.model.T = this.T; this.model.L = this.L / 100; }
  /** 当前共振的程度：0–1（1 为恰好在第 n 个模式的共振峰上） */
  resonance() {
    this.sync();
    const w = 2 * Math.PI * this.f, n = this.model.nearestMode(this.f), wn = this.model.omega(n), z = this.model.zeta;
    return { n, r: 1 / Math.sqrt(1 + ((wn * wn - w * w) / (2 * z * wn * w)) ** 2) };
  }
  /** 驱动频率 f 下第 n 个模式共振的弦长（cm） */
  Lres(n, f = this.f) { this.sync(); return this.model.resonantL(n, f) * 100; }
  /** 离当前位置最近、且在导轨范围内的共振弦长 */
  nearestRes() {
    let best = null;
    for (let n = 1; n < 40; n++) { const L = this.Lres(n); if (L > LMAX) break; if (L >= LMIN && (!best || Math.abs(L - this.L) < Math.abs(best.L - this.L))) best = { n, L }; }
    return best;
  }
  /** 振幅分布（mm）：显示用，超过约 8 mm 时软限幅（大振幅下弦的非线性） */
  envelope() {
    const key = [this.on, this.f, this.L, this.m, this.drive].join();
    if (key === this._key) return this.env;
    this._key = key; this.sync();
    if (!this.on || this.drive <= 0) { this.env.fill(0); return this.env; }
    const xs = Array.from({ length: NX + 1 }, (_, i) => (this.model.L * i) / NX), a = this.model.amps(this.f, xs);
    for (let i = 0; i <= NX; i++) { const raw = a[i] * 500 * (this.drive / 5) * 1e3; this.env[i] = 8 * Math.tanh(raw / 8); }
    return this.env;
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [10, 70, 120], target: [5, 10, 0] }, { name: '劈尖 B', pos: [XA + this.L, 30, 34], target: [XA + this.L, Y0, 0] }, { name: '驱动端', pos: [XA - 4, 28, 30], target: [XA + 2, Y0, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(130, 70));
    app.stage.setLightTarget(0, 10, 0);
    const g = new THREE.Group(), wood = MAT.paint(0x6b5a45), alu = MAT.alu(), dark = MAT.paint(0x2b3440);
    g.add(mesh(new THREE.BoxGeometry(122, 2.4, 12), wood, 2, 1.2, 0));
    // 米尺（零点对准劈尖 A）
    const tex = canvasTexture(2048, 64, (c, w, h) => {
      c.fillStyle = '#efe9d8'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d2832'; c.strokeStyle = '#1d2832'; c.font = 'bold 22px Consolas'; c.textAlign = 'center';
      for (let mm = 0; mm <= 1000; mm++) { const x = (mm / 1000) * w, len = mm % 10 === 0 ? 30 : mm % 5 === 0 ? 20 : 12; c.lineWidth = mm % 10 === 0 ? 2 : 1; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, len); c.stroke(); if (mm % 100 === 0 && mm > 0 && mm < 1000) c.fillText(String(mm / 10), x, 56); }
    });
    const rule = new THREE.Mesh(new THREE.PlaneGeometry(100, 3.2), new THREE.MeshBasicMaterial({ map: tex }));
    rule.rotation.x = -Math.PI / 2; rule.position.set(XA + 50, 2.42, 4.2); rule.userData.noHL = true; g.add(rule);
    // 固定端、劈尖 A、驱动磁钢、滑轮
    g.add(mesh(new THREE.BoxGeometry(2, Y0, 4), dark, XA - 12, Y0 / 2 + 1.2, 0));
    const knife = () => { const k = new THREE.Group(); k.add(mesh(new THREE.BoxGeometry(3, Y0 - 3, 3), alu, 0, (Y0 - 3) / 2 + 2.4, 0)); const t = mesh(new THREE.CylinderGeometry(0.01, 1.4, 2, 3), alu, 0, Y0 - 0.6, 0); t.rotation.y = Math.PI / 6; k.add(t); return k; };
    const kA = knife(); kA.position.x = XA; g.add(kA);
    this.kB = knife(); g.add(this.kB);
    this.kB.add(mesh(new THREE.BoxGeometry(0.3, 0.1, 3.4), MAT.paint(0xc41e3a), 0, 2.5, 3.6)); // 指针
    const mag = new THREE.Group();
    mag.add(mesh(new THREE.BoxGeometry(2.4, 3, 2.4), MAT.paint(0xb91c1c), 0, 0, -1.8)); mag.add(mesh(new THREE.BoxGeometry(2.4, 3, 2.4), MAT.paint(0x1e3a8a), 0, 0, 1.8));
    mag.position.set(XA + X_DRV, Y0, 0); g.add(mag);
    const pul = mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.8, 28), alu, 64, Y0 - 2.5, 0); pul.rotation.x = Math.PI / 2; g.add(pul);
    g.add(mesh(new THREE.BoxGeometry(2, Y0 - 2, 2), dark, 64, (Y0 - 2) / 2, -1.6));
    // 静止的弦（固定端 → 劈尖 A，劈尖 B → 滑轮）与砝码
    const wire = MAT.metal();
    this.w1 = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), wire); this.w1.rotation.z = Math.PI / 2; g.add(this.w1);
    this.w2 = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), wire); this.w2.rotation.z = Math.PI / 2; g.add(this.w2);
    this.w3 = mesh(new THREE.CylinderGeometry(0.06, 0.06, 24, 6), wire, 66.5, Y0 - 2.5 - 12, 0); g.add(this.w3);
    this.wts = new THREE.Group(); this.wts.position.set(66.5, Y0 - 2.5 - 24, 0); g.add(this.wts);
    // 振动的弦：半透明“包络带”（400 Hz 的振动看上去是一片模糊的纺锤形）
    const pos = new Float32Array((NX + 1) * 2 * 3), idx = [];
    for (let i = 0; i < NX; i++) { const a = 2 * i, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
    this.band = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xcfd6dd, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    this.band.userData.noHL = true; g.add(this.band);
    app.addComponent(new Component({
      key: 'rig', name: '弦线驻波仪', zone: 'none', fixed: true, required: true, object: g, labelY: Y0 + 8,
      icon: SVG('<path d="M6 20 Q 19 6 32 20 T 58 20" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 20 Q 19 34 32 20 T 58 20" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/>'),
      desc: `钢丝一端固定，跨过劈尖 A、B 和滑轮，下挂砝码提供张力 T = mg。驱动磁钢放在离劈尖 A ${X_DRV} cm 处，信号源的交变电流流过钢丝，在磁场中受安培力而振动。劈尖 B 可沿导轨移动，弦长 L 在米尺上读（零点对准劈尖 A）。弦线标签：μ = ${(this.muLabel * 1e4).toFixed(3)}×10⁻⁴ kg/m（称 1.000 m 弦线的质量得到）。`,
      controls: () => [
        { type: 'knob', label: '劈尖 B 的位置（弦长）', get: () => this.L, set: (v) => { this.L = clamp(v, LMIN, LMAX); app.changed(); }, min: LMIN, max: LMAX, step: 0.02, bigStep: 1, perRev: 2, fmt: () => '看米尺读数' },
        { type: 'select', label: '砝码（含挂钩）', get: () => this.m, set: (v) => { this.m = +v; app.changed(); }, options: MASSES.map((m) => ({ value: m, label: `${m.toFixed(2)} kg` })) },
      ],
    }));
    const gb = (this.genBox = meterBox(20, 10, 12, '低频信号源')); gb.group.position.set(-40, 0, -20);
    app.addComponent(new Component({
      key: 'gen', name: '低频信号源', zone: 'none', fixed: true, object: gb.group, labelY: 14,
      desc: '输出正弦电流给钢丝，频率 20–1000 Hz，数字显示 0.1 Hz；输出幅度可调。幅度太大时弦的振动不再是小振幅，共振峰会变形。',
      controls: () => [
        { type: 'toggle', label: '电源', get: () => this.on, set: (v) => { this.on = v; app.changed(); } },
        { type: 'knob', label: '频率', get: () => this.f, set: (v) => { this.f = Math.round(clamp(v, 20, 1000) * 10) / 10; app.changed(); }, min: 20, max: 1000, step: 0.1, bigStep: 10, perRev: 20, digits: 1, unit: 'Hz' },
        { type: 'knob', label: '输出幅度', get: () => this.drive, set: (v) => { this.drive = clamp(v, 0, 10); app.changed(); }, min: 0, max: 10, step: 0.1, bigStep: 1, perRev: 5, digits: 1 },
      ],
    }));
    this.sv = app.addView({ id: 'side', title: '弦的振动（侧视，振幅放大）与劈尖 B 处的米尺', w: 340, h: 230, res: 1.6 });
  }
  update() {
    const xB = XA + this.L;
    this.kB.position.x = xB;
    this.w1.scale.y = XA - (XA - 12); this.w1.position.set(XA - 6, Y0, 0);
    this.w2.scale.y = 64 - xB; this.w2.position.set((64 + xB) / 2, Y0, 0);
    if (this._m !== this.m) { this._m = this.m; this.wts.clear(); const n = Math.round(this.m / 0.5); for (let k = 0; k < n; k++) this.wts.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.6, 24), MAT.metal(), 0, -1 - k * 1.7, 0)); }
    const env = this.envelope(), p = this.band.geometry.attributes.position.array, S = 0.4; // 3D 中振幅放大 4 倍（mm → cm × 4）
    for (let i = 0; i <= NX; i++) { const x = XA + (this.L * i) / NX, e = env[i] * S; p.set([x, Y0 + e + 0.05, 0, x, Y0 - e - 0.05, 0], i * 6); }
    this.band.geometry.attributes.position.needsUpdate = true; this.band.geometry.computeBoundingSphere();
    const s = this.on ? `${this.f.toFixed(1)}` : '----';
    if (s !== this._gs) { this._gs = s; this.genBox.setText(s, this.on ? 'Hz' : '', this.on ? `输出幅度 ${this.drive.toFixed(1)}` : '电源关'); }
    this.drawSide(env);
  }
  drawSide(env) {
    const v = this.sv, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    const x0 = W * 0.05, x1 = W * 0.95, yc = H * 0.3, amp = H * 0.022; // 每 mm 振幅对应的像素
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x0, yc); g.lineTo(x1, yc); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(207,214,221,.75)'; g.beginPath();
    for (let i = 0; i <= NX; i++) g.lineTo(x0 + ((x1 - x0) * i) / NX, yc - env[i] * amp - 0.6);
    for (let i = NX; i >= 0; i--) g.lineTo(x0 + ((x1 - x0) * i) / NX, yc + env[i] * amp + 0.6);
    g.fill();
    g.fillStyle = '#9aa5ab';
    for (const x of [x0, x1]) { g.beginPath(); g.moveTo(x, yc); g.lineTo(x - 6, yc + 12); g.lineTo(x + 6, yc + 12); g.fill(); }
    const xm = x0 + ((x1 - x0) * X_DRV) / this.L; g.fillStyle = '#b91c1c'; g.fillRect(xm - 3, yc + 14, 6, 8);
    g.font = `${H * 0.05}px "IBM Plex Mono"`; g.textAlign = 'center'; g.fillStyle = '#c9ced3';
    g.fillText('A', x0, yc + 28); g.fillText('B', x1, yc + 28);
    // 劈尖 B 处的米尺（放大）：±12 mm
    const ry = H * 0.62, rh = H * 0.2, rx0 = W * 0.08, rx1 = W * 0.92, ppm = (rx1 - rx0) / 24, c0 = this.L * 10;
    g.fillStyle = '#efe9d8'; g.fillRect(rx0, ry, rx1 - rx0, rh);
    g.save(); g.beginPath(); g.rect(rx0, ry, rx1 - rx0, rh); g.clip();
    g.strokeStyle = '#1d2832'; g.fillStyle = '#1d2832'; g.font = `bold ${H * 0.055}px "IBM Plex Mono"`;
    for (let mm = Math.floor(c0 - 13); mm <= c0 + 13; mm++) {
      const x = W / 2 + (mm - c0) * ppm, len = mm % 10 === 0 ? rh * 0.55 : mm % 5 === 0 ? rh * 0.38 : rh * 0.24;
      g.lineWidth = mm % 10 === 0 ? 1.6 : 1; g.beginPath(); g.moveTo(x, ry); g.lineTo(x, ry + len); g.stroke();
      if (mm % 10 === 0) g.fillText(String(mm / 10), x, ry + rh * 0.9);
    }
    g.restore();
    g.strokeStyle = '#c41e3a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(W / 2, ry - 8); g.lineTo(W / 2, ry + rh * 0.7); g.stroke();
    g.fillStyle = '#c9ced3'; g.font = `${H * 0.045}px "IBM Plex Mono"`; g.textAlign = 'left';
    g.fillText(`砝码 ${this.m.toFixed(2)} kg   ${this.on ? `f = ${this.f.toFixed(1)} Hz` : '信号源关'}`, rx0, H * 0.95);
    const { n, r } = this.resonance(), loops = this.on ? n : 0;
    v.foot(!this.on ? '信号源没有打开，弦不振动' : r > 0.85 ? `共振：弦上有 ${loops} 个波腹，振幅很大` : r > 0.35 ? `接近共振（${loops} 个波腹）：微调劈尖 B，使振幅最大` : '不在共振位置，弦几乎不动：移动劈尖 B 或改变频率');
  }

  // ======================= 数据表 =======================
  tables() {
    const fCol = { key: 'f', label: 'f/Hz', digits: 1, readTol: 0.06 };
    return [
      {
        id: 'wl', title: '张力、频率不变，改变弦长', maxRows: 8,
        columns: [
          { key: 'n', label: '波腹数 n', digits: 0, readonly: true },
          fCol,
          { key: 'L', label: '弦长 L/cm', digits: 2, readTol: 0.06 },
          { key: 'lam', label: 'λ = 2L/n /cm', digits: 2, calc: (r) => (2 * r.L) / r.n },
        ],
        buttons: [{ label: '记录当前共振的弦长', onClick: (t) => this.rec(t) }],
        note: '砝码、频率都不变，移动劈尖 B，依次找出 1、2、3、4 … 个波腹的共振位置（振幅最大处），记下弦长。',
      },
      {
        id: 'ten', title: '频率不变，改变张力', maxRows: 8,
        columns: [
          { key: 'm', label: '砝码 m/kg', digits: 2, readonly: true },
          { key: 'n', label: '波腹数 n', digits: 0, readonly: true },
          fCol,
          { key: 'L', label: '弦长 L/cm', digits: 2, readTol: 0.06 },
          { key: 'lam', label: 'λ/cm', digits: 2, calc: (r) => (2 * r.L) / r.n },
          { key: 'v', label: 'v = fλ /(m/s)', digits: 2, calc: (r) => (r.f * 2 * r.L) / r.n / 100 },
        ],
        buttons: [{ label: '记录当前共振的弦长', onClick: (t) => this.rec(t) }],
        note: `频率不变，换 5 种砝码，每种找一个共振位置（波腹数自选，弦长尽量长）。T = mg，g = ${G} m/s²。`,
      },
    ];
  }
  rec(t) {
    const a = this.app;
    if (!this.on || this.drive <= 0) return a.toast('信号源没有打开，弦不振动', 'warn');
    const { n, r } = this.resonance();
    if (r < 0.6) a.toast(`现在不在共振位置（振幅只有共振时的 ${(r * 100).toFixed(0)}%），记下的弦长误差大`, 'warn');
    if (t.id === 'wl') {
      const r0 = t.rows[0];
      if (r0 && (Math.abs(r0.f - this.f) > 0.05 || r0.m !== this.m)) a.toast('这张表要求频率和砝码都不变，和第一行不一样', 'warn');
      if (t.rows.some((x) => x.n === n)) a.toast(`${n} 个波腹的位置已经记过了`, 'warn');
      t.addRow({ n, f: this.f, L: Math.round(this.L * 100) / 100, m: this.m });
    } else {
      const r0 = t.rows[0];
      if (r0 && Math.abs(r0.f - this.f) > 0.05) a.toast('这张表要求频率不变，和第一行不一样', 'warn');
      if (t.rows.some((x) => x.m === this.m)) a.toast('这个砝码已经测过了，换一个', 'warn');
      t.addRow({ m: this.m, n, f: this.f, L: Math.round(this.L * 100) / 100 });
    }
  }

  // ======================= 自动操作 =======================
  async moveTo(L) { const a = this.app; a.select(a.comp('rig')); await a.tween(() => this.L, (v) => (this.L = v), L, 700); this.L = L; a.changed(); await a.wait(300); }
  steps() {
    const app = this.app, rows = (id) => app.table(id).rows.filter((r) => isFinite(r.L) && r.L > 0);
    const fix = (label) => ({ label, run: async () => { const b = this.nearestRes(); if (b) await this.moveTo(b.L); } });
    const resDiag = () => {
      if (!this.on) return [{ msg: '信号源没有打开。', fix: { label: '打开信号源', run: async () => { this.on = true; if (this.drive <= 0) this.drive = 5; } } }];
      if (this.drive <= 0.3) return [{ msg: '输出幅度太小，看不出振动。', fix: { label: '幅度调到 5', run: async () => { this.drive = 5; } } }];
      const { n, r } = this.resonance(), b = this.nearestRes();
      if (r < 0.6 && b) return [{ msg: `现在弦长 ${this.L.toFixed(1)} cm，离最近的共振（${b.n} 个波腹）还差约 ${Math.abs(b.L - this.L).toFixed(1)} cm，把劈尖 B 往${b.L > this.L ? '右（弦变长）' : '左（弦变短）'}移，边移边看振幅。`, fix: fix('帮我移到最近的共振') }];
      if (r < 0.95) return [{ msg: `接近 ${n} 个波腹的共振了（振幅约为峰值的 ${(r * 100).toFixed(0)}%），来回微调劈尖 B，停在振幅最大处。`, fix: fix('帮我停在峰值') }];
      return [{ msg: `现在正处在 ${n} 个波腹的共振上：读出米尺上的弦长，点“记录当前共振的弦长”。` }];
    };
    return [
      {
        title: '挂砝码，打开信号源',
        html: '<p>挂上 1.00 kg 砝码，打开信号源，频率调到 400 Hz 左右，输出幅度适中。</p>',
        status: () => `${this.on ? `f = ${this.f.toFixed(1)} Hz` : '信号源关'}，砝码 ${this.m.toFixed(2)} kg`,
        check: () => this.on && this.f >= 200 && this.f <= 800 && this.drive > 0.5,
        diagnose: () => { const out = []; if (!this.on) out.push({ msg: '信号源还没打开。' }); if (this.f < 200 || this.f > 800) out.push({ msg: `频率 ${this.f.toFixed(1)} Hz 不合适：太低时半波长超过导轨长度，太高时波腹太密。调到 300–500 Hz。` }); if (this.drive <= 0.5) out.push({ msg: '输出幅度太小。' }); return out.length ? [{ ...out[0], fix: { label: '帮我设好', run: async () => { this.on = true; this.drive = 5; await app.tween(() => this.f, (v) => (this.f = Math.round(v * 10) / 10), 400, 600); this.f = 400; } } }, ...out.slice(1)] : []; },
        auto: async () => {
          app.select(app.comp('rig')); this.m = 1.0; app.renderInspector();
          app.select(app.comp('gen')); this.on = true; this.drive = 5; app.renderInspector();
          await app.tween(() => this.f, (v) => (this.f = Math.round(v * 10) / 10), 400, 700); this.f = 400; app.changed();
        },
      },
      {
        title: '改变弦长，找出 4 个共振位置',
        html: '<p>砝码、频率不变。从短到长移动劈尖 B：弦长每增加半个波长出现一次共振（多一个波腹）。在每个共振处来回微调，停在振幅最大的地方，读出弦长。</p>',
        hint: '共振峰很窄（弦长变化约 2 mm 振幅就减半），移动要慢。也可以看驻波的波节是否恰好落在劈尖上。',
        status: () => `已记录 ${new Set(rows('wl').map((r) => r.n)).size} 个不同的波腹数`,
        check: () => new Set(rows('wl').map((r) => r.n)).size >= 4,
        diagnose: resDiag,
        auto: async () => {
          app.showTable(0); await app.view('全景');
          const have = new Set(rows('wl').map((r) => r.n));
          for (let n = 1; n < 12 && new Set(rows('wl').map((r) => r.n)).size < 4; n++) {
            const L = this.Lres(n); if (L > LMAX) break; if (L < LMIN || have.has(n)) continue;
            await this.moveTo(L + gauss(0.03)); await app.record('wl', 0);
          }
        },
      },
      {
        title: '改变张力，测 5 组',
        html: '<p>频率不变，依次换 0.5、1.0、1.5、2.0、2.5 kg 的砝码，每种张力下找一个共振位置（选弦长较长的，相对误差小）。</p>',
        status: () => `已测 ${new Set(rows('ten').map((r) => r.m)).size} / 5 种砝码`,
        check: () => new Set(rows('ten').map((r) => r.m)).size >= 5,
        diagnose: resDiag,
        auto: async () => {
          app.showTable(1);
          for (const m of MASSES) {
            if (rows('ten').some((r) => r.m === m)) continue;
            this.m = m; app.select(app.comp('rig')); app.renderInspector(); app.changed();
            let n = 1; while (this.Lres(n + 1) <= 90) n++;
            await this.moveTo(this.Lres(n) + gauss(0.03)); await app.record('ten', 0);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>由 $L$–$n$ 直线的斜率求波长 $\\lambda$ 与波速 $v=f\\lambda$，和 $\\sqrt{T/\\mu}$ 比较；作 $\\lg\\lambda$–$\\lg T$ 图验证 $\\lambda\\propto T^{1/2}$，由 $v^2$–$T$ 直线的斜率求线密度。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, ok = (r) => isFinite(r.L) && r.L > 0 && r.n > 0 && r.f > 0;
    const w = a.table('wl').rows.filter(ok), t = a.table('ten').rows.filter(ok);
    if (w.length < 3) return { html: '<p>至少需要 3 个不同波腹数的共振位置（建议 4 个）。</p>', ok: false };
    const mu = this.muLabel, f1 = mean(w.map((r) => r.f)), m1 = w[0].m ?? 1, T1 = m1 * G;
    const fit = linFit(w.map((r) => r.n), w.map((r) => r.L / 100)), lam = 2 * fit.k, ulam = 2 * fit.uk, v = f1 * lam, uv = f1 * ulam, vth = Math.sqrt(T1 / mu);
    let html = `<h3>1. 张力、频率不变（m = ${m1.toFixed(2)} kg，f = ${f1.toFixed(1)} Hz）</h3>
      <table><tr><th>n</th><th>L/cm</th><th>2L/n /cm</th></tr>${w.map((r) => `<tr><td>${r.n}</td><td>${r.L.toFixed(2)}</td><td>${((2 * r.L) / r.n).toFixed(2)}</td></tr>`).join('')}</table>
      <p>相邻共振的弦长相差半个波长。拟合 $L=\\frac\\lambda2 n+b$：斜率 ${(fit.k * 100).toFixed(3)} cm，截距 $b$ = ${(fit.b * 100).toFixed(2)} cm（反映劈尖处的有效端点与刻度零点的偏差，用斜率求 λ 可以消除它）。</p>
      <div class="result-box">$\\lambda=${fmtU(lam * 100, ulam * 100)}$ cm，$v=f\\lambda=${fmtU(v, uv)}$ m/s</div>
      <p>理论值 $\\sqrt{T/\\mu}=\\sqrt{${T1.toFixed(3)}/${(mu * 1e4).toFixed(3)}\\times10^{-4}}$ = ${vth.toFixed(2)} m/s。</p>`;
    html += `<div class="result-box warn">波速与 √(T/μ) 的相对误差 ${pct(relErr(v, vth), 2)}。</div>`;
    const answers = [{ label: '$\\lambda$', unit: 'cm', value: lam * 100, digits: 2, tolRel: 0.003 }, { label: '$v$', unit: 'm/s', value: v, digits: 2, tolRel: 0.003 }];
    const plots = [{ title: 'L–n 图线', xLabel: 'n', yLabel: 'L / m', series: [{ type: 'scatter', data: w.map((r) => [r.n, r.L / 100]), label: '实验点' }, { type: 'line', data: [[0, fit.b], [Math.max(...w.map((r) => r.n)) + 0.5, fit.k * (Math.max(...w.map((r) => r.n)) + 0.5) + fit.b]], label: '最小二乘直线' }] }];
    if (t.length >= 3) {
      const T = t.map((r) => r.m * G), lamT = t.map((r) => (2 * r.L) / r.n / 100), vT = t.map((r, i) => r.f * lamT[i]);
      const lg = linFit(T.map(Math.log10), lamT.map(Math.log10)), sq = linFit(T, vT.map((x) => x * x)), muM = 1 / sq.k, umu = (muM * sq.uk) / sq.k;
      html += `<h3>2. 频率不变，改变张力</h3><table><tr><th>m/kg</th><th>T/N</th><th>n</th><th>L/cm</th><th>λ/cm</th><th>v=fλ /(m/s)</th><th>√(T/μ) /(m/s)</th></tr>
        ${t.map((r, i) => `<tr><td>${r.m.toFixed(2)}</td><td>${T[i].toFixed(3)}</td><td>${r.n}</td><td>${r.L.toFixed(2)}</td><td>${(lamT[i] * 100).toFixed(2)}</td><td>${vT[i].toFixed(2)}</td><td>${Math.sqrt(T[i] / mu).toFixed(2)}</td></tr>`).join('')}</table>
        <p>$\\lg\\lambda$–$\\lg T$ 直线的斜率 = ${lg.k.toFixed(4)}（理论 0.5），说明 $\\lambda\\propto T^{1/2}$，即波速 $v\\propto\\sqrt T$。</p>
        <p>$v^2$–$T$ 直线：斜率 ${sq.k.toFixed(1)} m/(kg)（= 1/μ），截距 ${sq.b.toFixed(1)} m²/s²。</p>
        <div class="result-box">$\\mu=${fmtU(muM * 1e4, umu * 1e4)}\\times10^{-4}$ kg/m（标签值 ${(mu * 1e4).toFixed(3)}×10⁻⁴）</div>
        <p>钢丝不是理想的柔软弦：它的抗弯刚度使波速略大于 $\\sqrt{T/\\mu}$，满足 $v^2=\\frac T\\mu+\\frac{EI}{\\mu}k^2$。张力越小、频率越高，这一项越明显（本实验中约为 0.1%–0.6%），它在 $v^2$–$T$ 图上表现为正的截距。</p>`;
      answers.push({ label: '$\\lg\\lambda$–$\\lg T$ 斜率', unit: '', value: lg.k, digits: 3, tolAbs: 0.006 }, { label: '$\\mu$', unit: '×10⁻⁴ kg/m', value: muM * 1e4, digits: 3, tolRel: 0.005 });
      plots.push({ title: 'lg λ – lg T', xLabel: 'lg(T/N)', yLabel: 'lg(λ/m)', series: [{ type: 'scatter', data: T.map((x, i) => [Math.log10(x), Math.log10(lamT[i])]), label: '实验点' }, { type: 'line', data: [Math.min(...T), Math.max(...T)].map((x) => [Math.log10(x), lg.k * Math.log10(x) + lg.b]), label: '拟合直线' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 弦上的驻波</h3>${stringFig()}<p>张紧的弦上横波的传播速度</p>$$v=\\sqrt{\\frac T\\mu}$$<p>$T$ 为张力，$\\mu$ 为单位长度的质量。两列沿相反方向传播的同频率波叠加形成驻波：波节处始终不动，相邻波节相距 $\\lambda/2$。</p>
<h3>2. 共振条件</h3><p>弦的两端（劈尖 A、B）是波节。只有弦长恰好是半波长的整数倍时，驱动产生的波在两端来回反射后同相叠加，振幅才变得很大：</p>$$L=n\\frac\\lambda2,\\qquad n=1,2,3,\\cdots$$<p>$n$ 就是弦上波腹的个数。频率 $f$ 一定时，$\\lambda=2L/n$，波速 $v=f\\lambda$。</p>
<h3>3. 验证 $v=\\sqrt{T/\\mu}$</h3><p>频率不变时 $\\lambda=\\frac1f\\sqrt{\\frac T\\mu}$，两边取对数：$\\lg\\lambda=\\frac12\\lg T+\\lg\\frac1{f\\sqrt\\mu}$。$\\lg\\lambda$–$\\lg T$ 图的斜率应为 1/2。</p>
<h3>4. 本仿真的计算模型</h3><p>钢丝（直径约 0.30 mm，密度 7850 kg/m³，杨氏模量 2.0×10¹¹ Pa）的横振动按受迫振动的模式叠加计算：第 $n$ 个模式的固有频率由色散关系 $\\omega^2=\\frac T\\mu k^2+\\frac{EI}\\mu k^4$（$k=n\\pi/L$，$I=\\pi d^4/64$）给出，阻尼比约 0.004，取前 40 个模式。驱动力作用在离劈尖 A ${X_DRV} cm 的地方。因此共振峰有一定宽度，弦长偏离共振 0.4% 振幅就降到约 70%；抗弯刚度使测得的波速比 $\\sqrt{T/\\mu}$ 略大，这是真实钢丝弦实验中存在的系统误差。</p>`;
  }
}
