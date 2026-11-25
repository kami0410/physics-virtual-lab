// 实验：传感器与数据采集
// 称重：铝合金悬臂梁上贴 4 片应变片组成全桥（激励 5.000 V），满量程 500 g 时输出约 1.6 mV/V（个体随机）。
//   桥路输出含轻微的二次非线性（端点为零，个体随机）和卸载时的迟滞（中间最大）；桥路不平衡与放大器失调合计 ±3 mV（折合输入），
//   用调零电位器补偿。仪表放大器增益 100/200/500/1000，输入噪声 1.5 μV（有效值）。
// 采集卡：双极性 ±5 V，8/10/12/16 位可选，采样频率可选，每次采 4096 点；软件给出均值、标准差、频谱峰值和已知频率的正弦拟合残差。
// 信号源：正弦，频率 1–3000 Hz，幅度 0.1–4.8 V，本身噪声 0.05 mV。
import * as THREE from 'three';
import { meta, thumb } from './daq.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, gauss, clamp, relErr, pct, linFit } from '../core/Stats.js';
import { quantize, lsb, aliasFreq, spectrum, sineFit } from '../physics/daq.js';

const EX = 5, FS = 500, N = 4096, VMAX = 5, ENI = 1.5e-6, GEN_N = 5e-5;
const GAINS = [100, 200, 500, 1000], FSS = [200, 500, 1000, 2000, 5000], BITS = [8, 10, 12, 16];
const MS = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const SVG = (inner) => `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;

export class DaqExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.Sfs = rand(1.45, 1.75); this.beta = rand(0.001, 0.003) * (Math.random() < 0.5 ? -1 : 1); this.hy = rand(3e-4, 8e-4);
    this.off = rand(-3, 3); this.mu = Math.round(rand(150, 450) * 10) / 10;
    this.m = 0; this.dir = 'load'; this.zero = 0; this.G = 200;
    this.ch = 1; this.fs = 1000; this.bits = 16; this.f = 100; this.A = 2;
    this.acq = null; this.acqKey = ''; this.tAcq = 0; this.ph = 0;
  }
  get mass() { return this.m === 'U' ? this.mu : this.m; }
  /** 桥路输出（V），含非线性与迟滞 */
  bridge() {
    const x = this.mass / FS, k = EX * this.Sfs * 1e-3;
    return k * (x + this.beta * x * (x - 1) + (this.dir === 'unload' && this.m !== 'U' ? this.hy * 4 * x * (1 - x) : 0));
  }
  ampOut() { return this.G * (this.bridge() + (this.off - this.zero) * 1e-3); }
  setLoad(v) { const old = this.mass; this.m = v; const nw = this.mass; if (v === 'U' || nw > old) this.dir = 'load'; else if (nw < old) this.dir = 'unload'; this.acqKey = ''; }

  // ---------- 采集 ----------
  sample() {
    const key = [this.ch, this.fs, this.bits, this.ch === 1 ? this.ampOut().toFixed(9) : `${this.f},${this.A}`].join('|');
    if (key === this.acqKey && this.acq) return this.acq;
    this.acqKey = key;
    const x = new Float64Array(N); let clip = false;
    if (this.ch === 1) {
      const v0 = this.ampOut(), sn = ENI * this.G;
      for (let i = 0; i < N; i++) { const v = v0 + gauss(sn); if (Math.abs(v) > VMAX) clip = true; x[i] = quantize(v, this.bits, VMAX); }
      let m = 0; for (const v of x) m += v; m /= N; let s2 = 0; for (const v of x) s2 += (v - m) ** 2;
      this.acq = { x, clip, mean: m, std: Math.sqrt(s2 / (N - 1)) };
    } else {
      this.ph = rand(0, 2 * Math.PI);
      for (let i = 0; i < N; i++) { const v = this.A * Math.sin((2 * Math.PI * this.f * i) / this.fs + this.ph) + gauss(GEN_N); if (Math.abs(v) > VMAX) clip = true; x[i] = quantize(v, this.bits, VMAX); }
      const sp = spectrum(x, this.fs), fit = sineFit(x, this.f, this.fs);
      this.acq = { x, clip, sp, peak: sp.peak, rms: fit.rms, amp: fit.amp };
    }
    return this.acq;
  }
  meanRead() { return Math.round(this.sample().mean * 1e4) / 1e4; }
  peakRead() { return Math.round(this.sample().peak * 100) / 100; }
  rmsRead() { return +(this.sample().rms * 1e3).toPrecision(3); }

  tick(dt) { this.tAcq += dt; if (this.tAcq > 1) { this.tAcq = 0; this.acqKey = ''; this.app.changed(); } }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 54, 86], target: [0, 8, -4] }, { name: '称重传感器', pos: [-30, 26, 34], target: [-30, 12, 0] }, { name: '采集系统', pos: [22, 30, 42], target: [22, 8, -12] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 80));
    app.stage.setLightTarget(0, 8, 0);
    const cell = new THREE.Group(); cell.position.set(-32, 0, 0); scene.add(cell);
    cell.add(mesh(new THREE.BoxGeometry(10, 1.2, 12), MAT.paint(0x2b3440), -6, 0.6, 0));
    cell.add(mesh(new THREE.BoxGeometry(4, 18, 4), MAT.paint(0x3a3f44), -8, 9, 0));
    this.beam = new THREE.Group(); this.beam.position.set(-6, 16, 0); cell.add(this.beam);
    this.beam.add(mesh(new THREE.BoxGeometry(22, 1.2, 3), MAT.alu(), 11, 0, 0));
    for (const [x, y] of [[4, 0.62], [4, -0.62]]) this.beam.add(mesh(new THREE.BoxGeometry(2.4, 0.06, 1.6), MAT.paint(0xc9a23a), x, y, 0));
    this.pan = new THREE.Group(); this.pan.position.set(20, 0, 0); this.beam.add(this.pan);
    this.pan.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 8), MAT.chrome(), 0, -3, 0));
    this.pan.add(mesh(new THREE.CylinderGeometry(4, 4, 0.4, 32), MAT.chrome(), 0, -6.2, 0));
    this.wts = [];
    for (let k = 0; k < 10; k++) { const w = mesh(new THREE.CylinderGeometry(1.6 - (k % 2) * 0.2, 1.6 - (k % 2) * 0.2, 0.8, 24), MAT.paint(0x9aa3ad), 0, -5.6 + k * 0.85, 0); this.wts.push(w); this.pan.add(w); }
    this.obj = mesh(new THREE.BoxGeometry(4, 2.6, 3), MAT.paint(0x6b4f2a), 0, -4.7, 0); this.pan.add(this.obj);
    const amp = (this.aBox = meterBox(16, 9, 10, '仪表放大器输出')); amp.group.position.set(-10, 0, -20); scene.add(amp.group);
    app.addComponent(new Component({
      key: 'cell', name: '称重传感器与放大器', zone: 'none', fixed: true, required: true, object: cell, labelY: 22,
      icon: SVG('<path d="M6 30V10h6v6h36v4H12"/><path d="M48 20v8"/><path d="M42 28h12"/>'),
      desc: '铝合金悬臂梁上、下表面各贴两片应变片，接成全桥，激励电压 5.000 V，量程 500 g。仪表放大器的增益可选，调零电位器补偿桥路不平衡和放大器失调。托盘上可放 50 g 一个的标准砝码（最多 10 个）或一个未知质量的物体。',
      controls: () => [
        { type: 'segment', label: '托盘', options: [...MS.map((m) => ({ value: m, label: `${m} g` })), { value: 'U', label: '未知物体' }], get: () => this.m, set: (v) => { this.setLoad(v); app.changed(); } },
        { type: 'segment', label: '放大器增益', options: GAINS.map((g) => ({ value: g, label: `×${g}` })), get: () => this.G, set: (v) => { this.G = v; app.changed(); } },
        { type: 'knob', label: '调零（折合输入）', get: () => this.zero, set: (v) => { this.zero = Math.round(clamp(v, -5, 5) * 1000) / 1000; app.changed(); }, min: -5, max: 5, step: 0.001, bigStep: 0.1, perRev: 0.5, digits: 3, unit: 'mV' },
      ],
    }));
    const daqG = new THREE.Group(); daqG.position.set(12, 0, -18); scene.add(daqG);
    daqG.add(mesh(new THREE.BoxGeometry(14, 3, 9), MAT.paint(0x1f2937), 0, 1.5, 0));
    daqG.add(mesh(new THREE.BoxGeometry(24, 1, 16), MAT.paint(0x30343a), 18, 0.5, 4));
    const scr = mesh(new THREE.BoxGeometry(24, 15, 0.8), MAT.paint(0x30343a), 18, 8.5, -3.6); scr.rotation.x = -0.15; daqG.add(scr);
    app.addComponent(new Component({
      key: 'daq', name: '数据采集卡与软件', zone: 'none', fixed: true, required: true, object: daqG, labelY: 18,
      icon: SVG('<rect x="6" y="10" width="30" height="20"/><path d="M36 16h8M36 24h8"/><path d="M48 8h12v24H48z"/>'),
      desc: `双极性输入 ±5 V，分辨率 8/10/12/16 位可选，每次采集 ${N} 点。CH1 接仪表放大器输出，CH2 接信号源。软件显示波形和频谱（汉宁窗），给出均值、标准差、频谱峰值频率，以及按信号源频率做正弦拟合后的残差有效值。`,
      controls: () => [
        { type: 'segment', label: '通道', options: [{ value: 1, label: 'CH1 称重' }, { value: 2, label: 'CH2 信号源' }], get: () => this.ch, set: (v) => { this.ch = v; app.changed(); } },
        { type: 'segment', label: '采样频率', options: FSS.map((f) => ({ value: f, label: `${f} Hz` })), get: () => this.fs, set: (v) => { this.fs = v; app.changed(); } },
        { type: 'segment', label: 'ADC 位数', options: BITS.map((b) => ({ value: b, label: `${b} 位` })), get: () => this.bits, set: (v) => { this.bits = v; app.changed(); } },
        { type: 'readout', label: '软件读数', get: () => this.readText() },
      ],
    }));
    const gen = (this.gBox = meterBox(16, 9, 10, '信号源')); gen.group.position.set(38, 0, -20); scene.add(gen.group);
    app.addComponent(new Component({
      key: 'gen', name: '信号源', zone: 'none', fixed: true, object: gen.group, labelY: 11,
      desc: '正弦信号源，频率 1–3000 Hz（分辨率 0.1 Hz），幅度 0.1–4.8 V（峰值）。',
      controls: () => [
        { type: 'knob', label: '频率', get: () => this.f, set: (v) => { this.f = Math.round(clamp(v, 1, 3000) * 10) / 10; app.changed(); }, min: 1, max: 3000, step: 0.1, bigStep: 10, perRev: 100, digits: 1, unit: 'Hz' },
        { type: 'knob', label: '幅度（峰值）', get: () => this.A, set: (v) => { this.A = Math.round(clamp(v, 0.1, 4.8) * 100) / 100; app.changed(); }, min: 0.1, max: 4.8, step: 0.01, bigStep: 0.5, perRev: 2, digits: 2, unit: 'V' },
      ],
    }));
    this.view = app.addView({ id: 'daq', title: '采集软件', w: 320, h: 240, res: 1.6 });
  }
  readText() {
    const s = this.sample();
    if (s.clip) return '输入超量程（±5 V）';
    return this.ch === 1 ? `均值 ${s.mean.toFixed(4)} V，标准差 ${(s.std * 1e3).toFixed(2)} mV` : `峰值频率 ${s.peak.toFixed(2)} Hz，拟合残差 ${(s.rms * 1e3).toPrecision(3)} mV`;
  }
  update() {
    const n = this.m === 'U' ? 0 : this.m / 50;
    this.wts.forEach((w, k) => (w.visible = k < n)); this.obj.visible = this.m === 'U';
    this.beam.rotation.z = -0.02 * (this.mass / FS);
    const o = this.ampOut(), so = Math.abs(o) > 12 ? '过载' : o.toFixed(3);
    if (so !== this._a) { this._a = so; this.aBox.setText(so, so === '过载' ? '' : 'V', `增益 ×${this.G}`); }
    const g = `${this.f.toFixed(1)}|${this.A}`; if (g !== this._g) { this._g = g; this.gBox.setText(this.f.toFixed(1), 'Hz', `幅度 ${this.A.toFixed(2)} V`); }
    this.draw();
  }
  draw() {
    const v = this.view, g = v.ctx, W = v.W, H = v.H, s = this.sample(), x = s.x;
    g.fillStyle = '#f5f6f8'; g.fillRect(0, 0, W, H);
    const top = [W * 0.1, H * 0.06, W * 0.97, H * 0.46], bot = [W * 0.1, H * 0.56, W * 0.97, H * 0.93];
    const frame = (r) => { g.strokeStyle = 'rgba(60,79,107,.35)'; g.lineWidth = 1; g.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); };
    frame(top); frame(bot);
    g.font = `${H * 0.042}px Consolas, monospace`; g.fillStyle = '#3c4f6b';
    // 波形：前 200 点
    const n = 200; let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { lo = Math.min(lo, x[i]); hi = Math.max(hi, x[i]); }
    const pad = Math.max((hi - lo) * 0.1, lsb(this.bits) * 2, 1e-4); lo -= pad; hi += pad;
    const X = (i) => top[0] + (i / (n - 1)) * (top[2] - top[0]), Y = (u) => top[3] - ((u - lo) / (hi - lo)) * (top[3] - top[1]);
    g.strokeStyle = 'rgba(60,79,107,.45)'; g.beginPath(); for (let i = 0; i < n; i++) (i ? g.lineTo(X(i), Y(x[i])) : g.moveTo(X(i), Y(x[i]))); g.stroke();
    g.fillStyle = '#b3261e'; for (let i = 0; i < n; i++) g.fillRect(X(i) - 1, Y(x[i]) - 1, 2, 2);
    g.fillStyle = '#3c4f6b'; g.textAlign = 'right'; g.fillText(hi.toFixed(hi - lo < 0.05 ? 4 : 2), top[0] - 3, top[1] + 8); g.fillText(lo.toFixed(hi - lo < 0.05 ? 4 : 2), top[0] - 3, top[3]);
    g.textAlign = 'left'; g.fillText(`CH${this.ch} · ${this.fs} Hz · ${this.bits} 位 · 前 ${n} 点（${((n / this.fs) * 1000).toFixed(0)} ms）`, top[0] + 4, top[1] + H * 0.045);
    // 频谱
    const sp = this.ch === 2 ? s.sp : spectrum(x, this.fs), mg = sp.mag, K = mg.length;
    const dB = (a) => 20 * Math.log10(a + 1e-12), D0 = -140, D1 = 20;
    const Xf = (k) => bot[0] + (k / K) * (bot[2] - bot[0]), Yd = (d) => bot[3] - ((clamp(d, D0, D1) - D0) / (D1 - D0)) * (bot[3] - bot[1]);
    g.strokeStyle = '#2b5876'; g.lineWidth = 1; g.beginPath();
    const step = Math.max(1, Math.floor(K / (bot[2] - bot[0])));
    for (let k = 0; k < K; k += step) { let m = 0; for (let j = k; j < Math.min(K, k + step); j++) m = Math.max(m, mg[j]); const px = Xf(k), py = Yd(dB(m)); k ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
    g.fillStyle = '#3c4f6b'; g.textAlign = 'center';
    for (let q = 0; q <= 4; q++) g.fillText(String(Math.round((this.fs / 2) * q / 4)), bot[0] + (q / 4) * (bot[2] - bot[0]), bot[3] + H * 0.05);
    g.textAlign = 'right'; g.fillText('0 dB', bot[0] - 3, Yd(0) + 3); g.fillText('-120', bot[0] - 3, Yd(-120) + 3);
    if (this.ch === 2) { const kp = sp.peak / sp.df; g.fillStyle = '#b3261e'; g.beginPath(); g.moveTo(Xf(kp), Yd(dB(sp.amp)) - 3); g.lineTo(Xf(kp) - 4, Yd(dB(sp.amp)) - 10); g.lineTo(Xf(kp) + 4, Yd(dB(sp.amp)) - 10); g.fill(); }
    v.foot(this.readText());
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'cal', title: '称重传感器标定', maxRows: 24,
        columns: [{ key: 'm', label: '砝码 m/g', digits: 0, auto: true }, { key: 'dir', label: '过程', type: 'text', auto: true }, { key: 'U', label: '输出均值 U/V', digits: 4, readTol: 0.0003 }],
        buttons: [{ label: '记录 CH1 均值', onClick: (t) => this.recCal(t) }],
        note: '先在空载下调零，再逐个加砝码到 500 g（加载），然后逐个取下（卸载），每次记下 CH1 的均值。增益在整个标定中不要改。',
      },
      {
        id: 'unk', title: '测未知质量', fixedRows: true,
        initRows: () => [{ what: '未知物体' }],
        columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'U', label: '输出均值 U/V', digits: 4, readTol: 0.0003 }],
        buttons: [{ label: '记录 CH1 均值', onClick: (t) => this.recUnk(t) }],
        note: '取下全部砝码，放上未知物体，记下输出。增益与标定时相同。',
      },
      {
        id: 'alias', title: '采样定理与混叠（f_s 不变）', maxRows: 12,
        columns: [{ key: 'f', label: '信号频率 f/Hz', digits: 1, auto: true }, { key: 'fa', label: '频谱峰值 f_a/Hz', digits: 2, readTol: 0.1 }],
        buttons: [{ label: '记录峰值频率', onClick: (t) => this.recAlias(t) }],
        note: 'CH2，采样频率固定（如 1000 Hz）。信号频率取在 f_s/2 以下和以上的若干值，记下频谱上峰的位置。',
      },
      {
        id: 'q', title: 'ADC 量化噪声', maxRows: 6,
        columns: [{ key: 'bits', label: '位数', digits: 0, auto: true }, { key: 'LSB', label: 'LSB/mV', digits: 3, auto: true }, { key: 'rms', label: '拟合残差/mV', readTol: (r) => 0.02 * r + 0.001 }],
        buttons: [{ label: '记录拟合残差', onClick: (t) => this.recQ(t) }],
        note: 'CH2，信号幅度接近满量程（如 4.5 V），频率取一个与采样频率不成简单整数比的值（如 37.3 Hz），依次改变 ADC 位数，记下正弦拟合的残差。',
      },
    ];
  }
  ch1ok() {
    const a = this.app;
    if (this.ch !== 1) { a.toast('采集通道要选 CH1', 'warn'); return false; }
    if (this.sample().clip) { a.toast('放大器输出超过 ±5 V：减小增益或重新调零', 'warn'); return false; }
    return true;
  }
  recCal(t) {
    const a = this.app;
    if (!this.ch1ok()) return;
    if (this.m === 'U') return a.toast('托盘上放的是未知物体，标定要用砝码', 'warn');
    const U = this.meanRead();
    if (!t.rows.length && (this.m !== 0 || Math.abs(U) > 0.01)) return a.toast('第一行应在空载下记录，并先调零（输出在 ±10 mV 以内）', 'warn');
    if (t.rows.length && t.rows[0]._G !== this.G) return a.toast(`增益要和第一行相同（×${t.rows[0]._G}）`, 'warn');
    const dir = this.dir === 'load' ? '加载' : '卸载';
    if (t.rows.some((r) => r.m === this.m && r.dir === dir)) return a.toast('这一点已经测过了', 'warn');
    t.addRow({ m: this.m, dir, U, _G: this.G, _z: this.zero });
  }
  recUnk(t) {
    const a = this.app, cal = a.table('cal').rows;
    if (!this.ch1ok()) return;
    if (this.m !== 'U') return a.toast('托盘上要放未知物体', 'warn');
    if (cal.length && (cal[0]._G !== this.G || Math.abs(cal[0]._z - this.zero) > 1e-9)) return a.toast('增益和调零要和标定时相同', 'warn');
    t.set(0, 'U', this.meanRead());
  }
  recAlias(t) {
    const a = this.app;
    if (this.ch !== 2) return a.toast('采集通道要选 CH2', 'warn');
    if (this.sample().clip) return a.toast('信号超量程', 'warn');
    if (t.rows.length && t.rows[0]._fs !== this.fs) return a.toast(`采样频率要和第一行相同（${t.rows[0]._fs} Hz）`, 'warn');
    if (t.rows.some((r) => Math.abs(r.f - this.f) < 0.05)) return a.toast('这个频率已经测过了', 'warn');
    t.addRow({ f: this.f, fa: this.peakRead(), _fs: this.fs });
  }
  recQ(t) {
    const a = this.app;
    if (this.ch !== 2) return a.toast('采集通道要选 CH2', 'warn');
    if (this.sample().clip) return a.toast('信号超量程：幅度要小于 5 V', 'warn');
    if (this.A < 1) return a.toast('信号幅度太小：取接近满量程的幅度（几伏）', 'warn');
    if (t.rows.some((r) => r.bits === this.bits)) return a.toast('这个位数已经测过了', 'warn');
    t.addRow({ bits: this.bits, LSB: +(lsb(this.bits) * 1e3).toFixed(4), rms: this.rmsRead() });
  }

  // ======================= 自动操作 =======================
  async seg(comp, key, v) { const a = this.app; a.select(a.comp(comp)); if (this[key] !== v) { if (key === 'm') this.setLoad(v); else this[key] = v; a.renderInspector(); a.changed(); await a.wait(120); } }
  async adj(comp, key, to, ms = 250) { const a = this.app; a.select(a.comp(comp)); if (Math.abs(this[key] - to) > 1e-9) await a.tween(() => this[key], (v) => (this[key] = v), to, ms); this[key] = to; a.changed(); await a.wait(60); }
  steps() {
    const app = this.app, rows = (id) => app.table(id).completeRows(), cal = (d) => rows('cal').filter((r) => r.dir === d);
    const G0 = () => rows('cal')[0]?._G ?? 500;
    return [
      {
        title: '调零与加载标定',
        html: '<p>采集通道选 CH1，放大器增益 ×500。空载下调零，使输出均值在 ±10 mV 以内；然后从 0 到 500 g 每次加一个 50 g 砝码，记下输出均值。</p>',
        hint: '增益太大时满载输出会超过采集卡的 ±5 V 量程；太小则没有用足量程，分辨率变差。',
        status: () => `加载 ${cal('加载').length} 点`,
        check: () => cal('加载').length >= 6,
        auto: async () => {
          app.showTable(0); await app.view('称重传感器'); await this.seg('daq', 'ch', 1); await this.seg('daq', 'bits', 16);
          if (!rows('cal').length) {
            await this.seg('cell', 'G', 500); await this.seg('cell', 'm', 0);
            await this.adj('cell', 'zero', Math.round(this.off * 1000) / 1000, 400);
          } else { await this.seg('cell', 'G', G0()); if (Math.abs(this.zero - rows('cal')[0]._z) > 1e-9) await this.adj('cell', 'zero', rows('cal')[0]._z); }
          for (const m of MS) { if (rows('cal').some((r) => r.m === m && r.dir === '加载')) continue; if (this.m === 'U' || this.mass > m) await this.seg('cell', 'm', 0); await this.seg('cell', 'm', m); await app.record('cal', 0); }
        },
      },
      {
        title: '卸载',
        html: '<p>从 500 g 开始逐个取下砝码，记下卸载过程中各点的输出。</p>',
        hint: '同一质量下卸载与加载的读数之差反映传感器的迟滞（弹性元件和粘结胶层的滞后）。',
        status: () => `卸载 ${cal('卸载').length} 点`,
        check: () => cal('卸载').length >= 5,
        auto: async () => {
          app.showTable(0); await app.view('称重传感器'); await this.seg('daq', 'ch', 1); await this.seg('cell', 'G', G0());
          if (rows('cal').length && Math.abs(this.zero - rows('cal')[0]._z) > 1e-9) await this.adj('cell', 'zero', rows('cal')[0]._z);
          if (this.m === 'U' || this.dir !== 'unload') { await this.seg('cell', 'm', 500); }
          for (const m of MS.slice(0, -1).reverse()) { if (rows('cal').some((r) => r.m === m && r.dir === '卸载')) continue; if (this.m === 'U' || this.mass < m) { await this.seg('cell', 'm', 500); } await this.seg('cell', 'm', m); await app.record('cal', 0); }
        },
      },
      {
        title: '测未知质量',
        html: '<p>取下砝码，放上未知物体，记下输出均值，由标定直线求它的质量。</p>',
        check: () => typeof app.table('unk').rows[0]?.U === 'number',
        auto: async () => {
          app.showTable(1); await app.view('称重传感器'); await this.seg('daq', 'ch', 1); await this.seg('cell', 'G', G0());
          if (rows('cal').length && Math.abs(this.zero - rows('cal')[0]._z) > 1e-9) await this.adj('cell', 'zero', rows('cal')[0]._z);
          await this.seg('cell', 'm', 'U'); await app.record('unk', 0);
        },
      },
      {
        title: '采样定理与混叠',
        html: '<p>采集通道改为 CH2，采样频率 1000 Hz。信号源频率依次取 120、380、490、620、880、1130、1370、1880 Hz，记下频谱峰值的频率。</p>',
        hint: '信号频率超过 $f_s/2$ 后，频谱上的峰"折回"低频一侧：$f_a=|f-f_s\\,\\mathrm{round}(f/f_s)|$。',
        status: () => `已测 ${rows('alias').length} 个频率`,
        check: () => rows('alias').length >= 6,
        auto: async () => {
          app.showTable(2); await app.view('采集系统'); await this.seg('daq', 'ch', 2); await this.seg('daq', 'fs', rows('alias')[0]?._fs ?? 1000); await this.seg('daq', 'bits', 16); await this.adj('gen', 'A', 2);
          for (const f of [120, 380, 490, 620, 880, 1130, 1370, 1880]) { if (rows('alias').some((r) => Math.abs(r.f - f) < 0.05)) continue; await this.adj('gen', 'f', f, 200); await app.record('alias', 0); }
        },
      },
      {
        title: '量化噪声',
        html: '<p>CH2，采样频率 1000 Hz，信号 37.3 Hz、幅度 4.5 V。ADC 位数依次取 8、10、12、16 位，记下正弦拟合残差，与 LSB/√12 比较。</p>',
        hint: '信号频率与采样频率成简单整数比时，每个周期的采样点落在相同的相位上，量化误差不再"随机"，残差会偏离 LSB/√12。',
        status: () => `已测 ${rows('q').length} 种位数`,
        check: () => rows('q').length >= 3,
        auto: async () => {
          app.showTable(3); await app.view('采集系统'); await this.seg('daq', 'ch', 2); await this.seg('daq', 'fs', 1000); await this.adj('gen', 'f', 37.3, 200); await this.adj('gen', 'A', 4.5, 200);
          for (const b of BITS) { if (rows('q').some((r) => r.bits === b)) continue; await this.seg('daq', 'bits', b); await app.record('q', 0); }
        },
      },
      {
        title: '数据处理',
        html: '<p>拟合标定直线，求灵敏度、非线性误差和迟滞误差，算出未知质量；作混叠频率与信号频率的关系图；比较量化噪声与 LSB/√12。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, C = a.table('cal').completeRows(), Uu = a.table('unk').rows[0]?.U, AL = a.table('alias').completeRows(), Q = a.table('q').completeRows();
    if (C.length + AL.length + Q.length < 2) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = ''; const answers = [], plots = [];
    const Ld = C.filter((r) => r.dir === '加载').sort((x, y) => x.m - y.m), Un = C.filter((r) => r.dir === '卸载');
    if (Ld.length >= 3) {
      const f = linFit(Ld.map((r) => r.m), Ld.map((r) => r.U)), G = C[0]._G, S = f.k * 1000;
      const FSo = f.k * FS, nl = Math.max(...Ld.map((r) => Math.abs(r.U - (f.k * r.m + f.b)))) / FSo;
      const Strue = (G * EX * this.Sfs) / FS; // mV/g
      html += `<h3>1. 标定直线</h3><p>加载数据的最小二乘直线：$U=${f.k.toFixed(6)}m${f.b >= 0 ? '+' : '-'}${Math.abs(f.b).toFixed(4)}$（V，m 以 g 计，r = ${f.r.toFixed(7)}）。</p>
        <div class="result-box">系统灵敏度 $S=${S.toFixed(4)}$ mV/g；折合桥路灵敏度 ${((f.k * FS) / G / EX * 1000).toFixed(3)} mV/V（满量程）</div>
        <p>仿真设定的灵敏度 ${Strue.toFixed(4)} mV/g，相对误差 ${pct(relErr(S, Strue))}。非线性误差（加载点偏离拟合直线的最大值 / 满量程输出）${(nl * 100).toFixed(3)}% FS。</p>`;
      answers.push({ label: '灵敏度 $S$', unit: 'mV/g', value: S, digits: 4, tolRel: 0.002 });
      if (Un.length >= 2) {
        const pairs = Un.map((u) => { const l = Ld.find((r) => r.m === u.m); return l ? { m: u.m, d: u.U - l.U } : null; }).filter(Boolean);
        if (pairs.length) { const hmax = Math.max(...pairs.map((p) => Math.abs(p.d))); html += `<p>迟滞误差（同一质量下卸载与加载读数之差的最大值 / 满量程输出）${((hmax / FSo) * 100).toFixed(3)}% FS，出现在 ${pairs.reduce((b, p) => (Math.abs(p.d) > Math.abs(b.d) ? p : b)).m} g 附近——中间段最大，两端为零。</p>`; }
      }
      plots.push({ title: '标定曲线 U – m', xLabel: 'm / g', yLabel: 'U / V', series: [{ type: 'scatter', data: Ld.map((r) => [r.m, r.U]), label: '加载' }, ...(Un.length ? [{ type: 'scatter', data: Un.map((r) => [r.m, r.U]), label: '卸载' }] : []), { type: 'line', data: [0, FS].map((x) => [x, f.k * x + f.b]), label: '拟合' }] });
      plots.push({ title: '偏离拟合直线的残差', xLabel: 'm / g', yLabel: 'ΔU / mV', series: [{ type: 'scatter', data: Ld.map((r) => [r.m, (r.U - (f.k * r.m + f.b)) * 1000]), label: '加载' }, ...(Un.length ? [{ type: 'scatter', data: Un.map((r) => [r.m, (r.U - (f.k * r.m + f.b)) * 1000]), label: '卸载' }] : [])] });
      if (typeof Uu === 'number') {
        const mx = (Uu - f.b) / f.k;
        html += `<h3>2. 未知质量</h3><div class="result-box">$m=\\dfrac{U-b}{k}=${mx.toFixed(1)}$ g</div><p>物体的实际质量 ${this.mu.toFixed(1)} g，相对误差 ${pct(relErr(mx, this.mu))}，主要来自传感器的非线性。</p>`;
        answers.push({ label: '未知质量 $m$', unit: 'g', value: mx, digits: 1, tolRel: 0.003 });
      }
    }
    if (AL.length >= 2) {
      const fs = AL[0]._fs, rows = AL.slice().sort((x, y) => x.f - y.f);
      html += `<h3>3. 混叠</h3><table><tr><th>f/Hz</th>${rows.map((r) => `<td>${r.f}</td>`).join('')}</tr><tr><th>f_a（测）/Hz</th>${rows.map((r) => `<td>${r.fa.toFixed(2)}</td>`).join('')}</tr><tr><th>|f − f_s·round(f/f_s)|</th>${rows.map((r) => `<td>${aliasFreq(r.f, fs).toFixed(1)}</td>`).join('')}</tr></table>
        <p>采样频率 ${fs} Hz。信号频率低于 $f_s/2$ = ${fs / 2} Hz 时，频谱峰就在信号频率上；超过 $f_s/2$ 后，峰"折回"低频：${rows.filter((r) => r.f > fs / 2).map((r) => `${r.f} Hz → ${r.fa.toFixed(1)} Hz`).join('，')}。采样后的数据无法区分这些频率，所以采样前必须用低通（抗混叠）滤波器滤掉 $f_s/2$ 以上的成分。</p>`;
      const ff = Array.from({ length: 201 }, (_, i) => (i / 200) * Math.max(...rows.map((r) => r.f)) * 1.05);
      plots.push({ title: '频谱峰值频率 – 信号频率', xLabel: 'f / Hz', yLabel: 'f_a / Hz', series: [{ type: 'scatter', data: rows.map((r) => [r.f, r.fa]), label: '实验点' }, { type: 'line', data: ff.map((x) => [x, aliasFreq(x, fs)]), label: '理论' }] });
    }
    if (Q.length >= 2) {
      const rows = Q.slice().sort((x, y) => x.bits - y.bits);
      html += `<h3>4. 量化噪声</h3><table><tr><th>位数</th>${rows.map((r) => `<td>${r.bits}</td>`).join('')}</tr><tr><th>LSB/mV</th>${rows.map((r) => `<td>${r.LSB.toFixed(3)}</td>`).join('')}</tr><tr><th>LSB/√12 /mV</th>${rows.map((r) => `<td>${(r.LSB / Math.sqrt(12)).toFixed(4)}</td>`).join('')}</tr><tr><th>拟合残差/mV</th>${rows.map((r) => `<td>${r.rms}</td>`).join('')}</tr></table>`;
      const big = rows.filter((r) => r.bits <= 12);
      if (big.length) html += `<p>${big.map((r) => `${r.bits} 位：残差与 LSB/√12 的相对偏差 ${pct(relErr(r.rms, r.LSB / Math.sqrt(12)))}`).join('；')}。量化误差在 ±LSB/2 内近似均匀分布，其有效值就是 LSB/√12；位数每增加 1，量化噪声减半（约 6 dB）。</p>`;
      const r16 = rows.find((r) => r.bits === 16);
      if (r16) html += `<p>16 位时 LSB/√12 只有 ${(r16.LSB / Math.sqrt(12)).toFixed(4)} mV，残差 ${r16.rms} mV 主要是信号源本身的噪声——这时再增加位数已经没有意义，系统的分辨率由模拟噪声决定。</p>`;
      plots.push({ title: '拟合残差 – ADC 位数', xLabel: '位数', yLabel: 'lg(残差/mV)', series: [{ type: 'scatter', data: rows.map((r) => [r.bits, Math.log10(r.rms)]), label: '实验' }, { type: 'line', data: [8, 16].map((b) => [b, Math.log10((lsb(b) * 1e3) / Math.sqrt(12))]), label: 'LSB/√12' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 应变式称重传感器</h3><p>弹性元件受力变形，贴在上面的应变片电阻随之变化 $\\Delta R/R=K\\varepsilon$（$K$ 为灵敏系数，约 2）。四片应变片接成全桥，受拉、受压的两两相对，输出 $U_b=EK\\varepsilon$，是单臂接法的 4 倍，并能补偿温度的影响。桥路输出只有毫伏量级，经仪表放大器放大后送入采集卡。</p>
<h3>2. 静态特性指标</h3><p>灵敏度 $S=\\Delta U/\\Delta m$（标定直线的斜率）；非线性误差 $\\delta_L=\\Delta L_{\\max}/Y_{FS}$；迟滞误差 $\\delta_H=\\Delta H_{\\max}/Y_{FS}$，$Y_{FS}$ 为满量程输出。</p>
<h3>3. 采样定理</h3><p>采样频率为 $f_s$ 时，只有低于 $f_s/2$（奈奎斯特频率）的信号才能被正确还原。频率为 $f$ 的正弦采样后与频率为 $|f-nf_s|$ 的正弦完全相同，频谱上表现为折回到 $0\\sim f_s/2$ 的峰，这就是混叠。</p>
<h3>4. 量化噪声</h3><p>$n$ 位 ADC 把 $\\pm V_{\\max}$ 分成 $2^n$ 个台阶，$\\mathrm{LSB}=2V_{\\max}/2^n$。量化误差在 $\\pm\\mathrm{LSB}/2$ 内均匀分布时，其有效值 $\\sigma_q=\\mathrm{LSB}/\\sqrt{12}$。对满量程正弦，信噪比 $\\approx6.02n+1.76$ dB。</p>
<h3>5. 本仿真的计算模型</h3><p>桥路输出含二次非线性和卸载迟滞（个体随机），放大器有输入噪声；采集按 ±5 V、n 位四舍五入量化，超量程截断；频谱用汉宁窗 FFT，峰值频率用三点插值；正弦拟合为已知频率的三参数最小二乘。</p>`;
  }
}
