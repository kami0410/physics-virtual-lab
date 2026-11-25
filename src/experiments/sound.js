// 实验：声速的测定（超声换能器 · 驻波共振法 · 相位比较法）
// 信号发生器与示波器沿用 core/oscillo.js 的仪器（示波器按真实时间扫描、触发、X-Y 方式）；
// 接收换能器的输出由 physics/sound.js 解析求出：两换能器的谐振响应 × 两端面间多次反射的叠加 × 扩散与吸收，
// 直接作为示波器两个通道的周期信号。空气声速由温度、湿度决定。
import * as THREE from 'three';
import { meta, thumb } from './sound.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh } from '../core/Models.js';
import { funcGen, oscilloscope } from '../core/oscillo.js';
import { VDIV } from '../core/scopeEngine.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss, fmtU, linFit } from '../core/Stats.js';
import { Caliper } from '../core/gauges.js';
import { soundSpeed, received } from '../physics/sound.js';
import { soundFig } from './mechFigs.js';

const NSW = 12, NPH = 10; // 驻波法、相位法记录的位置数
const X1 = -21; // S1 发射面在场景中的 x（cm）
const K_RX = 1.2; // 接收换能器的灵敏度（相对）
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;
const N = 512;

/** 由两个通道的幅度与相位构造示波器可用的周期信号（与 spice.js 的结果格式相同） */
function makeSignal(f, ch1, ch2) {
  const T = 1 / f, d1 = new Float32Array(N), d2 = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const th = (2 * Math.PI * i) / N, u = i / N;
    d1[i] = ch1.shape === 'square' ? (u < 0.5 ? ch1.a : -ch1.a) : ch1.shape === 'triangle' ? ch1.a * (u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4) : ch1.a * Math.sin(th);
    d2[i] = ch2.a * Math.sin(th + ch2.ph);
  }
  const groups = f > 0 ? [{ T, f, data: { ch1: d1, ch2: d2 } }] : [];
  const at = (name, t) => {
    let s = 0;
    for (const g of groups) { const d = g.data[name], u = ((((t / g.T) % 1) + 1) % 1) * N, i = Math.floor(u), fr = u - i; s += d[i % N] * (1 - fr) + d[(i + 1) % N] * fr; }
    return s;
  };
  return { groups, dc: { ch1: 0, ch2: 0 }, ms: 0, at };
}

export class SoundExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.T = Math.round(rand(16, 28) * 10) / 10; this.RH = Math.round(rand(35, 75)) / 100;
    this.v = soundSpeed(this.T + rand(-0.5, 0.5), this.RH); // 两换能器之间的气温与温度计示数略有差别
    const f0 = rand(35, 39.5) * 1000;
    this.tr1 = { f0, Q: rand(10, 14) }; this.tr2 = { f0: f0 * (1 + rand(-0.006, 0.006)), Q: rand(10, 14) };
    this.R = rand(0.52, 0.64); this.d0 = rand(5, 9); // 游标读数为 0 时两端面的间距 mm
    this.cal = new Caliper({ range: 240 }); this.cal.open = rand(8, 15);
    this.sigKey = ''; this.fRec = null; this.wheel = 0;
  }

  // ======================= 声场 =======================
  /** 接收信号（复数，相对驱动电压）；x：游标读数 mm */
  rx(x = this.cal.reading, f = this.gen.wave().f) { return received({ f, L: (x + this.d0) / 1000, v: this.v, R: this.R }, this.tr1, this.tr2); }
  amp(x, f) { return Math.hypot(...this.rx(x, f)); }
  phase(x, f) { const [re, im] = this.rx(x, f); return Math.atan2(im, re); }
  lam(f = this.gen.wave().f) { return (this.v / f) * 1000; } // mm
  /** 当前位置处使接收最强的频率 */
  bestF(x = this.cal.reading) {
    let bf = 0, best = -1;
    for (let ff = this.tr1.f0 * 0.9; ff < this.tr1.f0 * 1.1; ff += 10) { const a = this.amp(x, ff); if (a > best) { best = a; bf = ff; } }
    for (let ff = bf - 10; ff <= bf + 10; ff += 0.5) { const a = this.amp(x, ff); if (a > best) { best = a; bf = ff; } }
    return { f: bf, a: best };
  }
  /** x 附近（±λ/4）的振幅极大位置 */
  localPeak(x, f) {
    const h = this.lam(f) / 4;
    let a = x - h, b = x + h;
    const gr = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 50; i++) { const c = b - gr * (b - a), d = a + gr * (b - a); if (this.amp(c, f) > this.amp(d, f)) b = d; else a = c; }
    return (a + b) / 2;
  }
  /** 从 x 起向远处依次的 n 个振幅极大 */
  peaksFrom(x, n, f) {
    const out = [], st = this.lam(f) / 60;
    let p = x, prev = this.amp(x - st, f), cur = this.amp(x, f);
    while (out.length < n && p < this.cal.range) {
      const nx = this.amp(p + st, f);
      if (cur > prev && cur >= nx) out.push(this.localPeak(p, f));
      prev = cur; cur = nx; p += st;
    }
    return out;
  }
  /** 从 x 起依次的 n 个“同相”位置（李萨如图形为 / 方向的直线） */
  inPhaseFrom(x, n, f) {
    const out = [], st = this.lam(f) / 80;
    let p = x, s0 = Math.sin(this.phase(p, f));
    while (out.length < n && p < this.cal.range) {
      const s1 = Math.sin(this.phase(p + st, f));
      if (s0 * s1 <= 0 && Math.cos(this.phase(p, f)) > 0) {
        let a = p, b = p + st;
        for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (Math.sin(this.phase(a, f)) * Math.sin(this.phase(m, f)) <= 0) b = m; else a = m; }
        out.push((a + b) / 2);
      }
      s0 = s1; p += st;
    }
    return out;
  }

  // ======================= 场景 =======================
  cameras() {
    return [
      { name: '全景', pos: [0, 78, 100], target: [0, 4, -2] },
      { name: '测试架', pos: [-2, 26, 50], target: [-4, 6, 8] },
      { name: '示波器', pos: [20, 24, 30], target: [20, 8, -12] },
      { name: '信号源', pos: [-44, 22, 16], target: [-44, 4, -17] },
    ];
  }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    app.addSlot({ id: 'gen', pos: new THREE.Vector3(-44, 0, -18), accepts: ['gen'] });
    app.addSlot({ id: 'osc', pos: new THREE.Vector3(20, 0, -22), accepts: ['osc'] });
    this.view = app.addView({ id: 'scr', title: '示波器荧光屏', w: 360, h: 284, res: 1 });
    this.tv = app.addView({ id: 'tool', title: '游标尺（S₂ 位置）', w: 330, h: 150, res: 1.8 });
    this.gen = funcGen({ defaultSlot: 'gen', f: Math.round(rand(31, 34)) * 1000 + Math.round(rand(0, 9)) * 100, vpp: 10 });
    this.osc = oscilloscope({ app, defaultSlot: 'osc', view: this.view });
    this.s = this.osc.s; this.eng = this.osc.eng;
    for (const d of [this.gen, this.osc]) { d.comp.fixed = true; d.comp.required = true; }
    this.buildRig();
    app.addComponent(this.gen.comp); app.addComponent(this.osc.comp);
  }
  buildRig() {
    const app = this.app, g = new THREE.Group();
    const Z = 8;
    g.add(mesh(new THREE.BoxGeometry(66, 2, 11), MAT.paint(0x3b4652), 1, 1, Z));
    for (const x of [-31, 33]) g.add(mesh(new THREE.BoxGeometry(2.4, 5, 11), MAT.paint(0x2b333c), x, 2.5, Z));
    const screw = mesh(new THREE.CylinderGeometry(0.55, 0.55, 64, 12), MAT.chrome(), 1, 3.6, Z); screw.rotation.z = Math.PI / 2; g.add(screw);
    for (const z of [Z - 3.5, Z + 3.5]) { const r = mesh(new THREE.CylinderGeometry(0.45, 0.45, 64, 10), MAT.alu(), 1, 3.2, z); r.rotation.z = Math.PI / 2; g.add(r); }
    // 游标尺（主尺固定在底座前沿）
    g.add(mesh(new THREE.BoxGeometry(58, 0.3, 1.8), MAT.alu(), 2, 2.15, Z + 6.1));
    const tdx = (x, r, l) => { const m = mesh(new THREE.CylinderGeometry(r, r, l, 36), MAT.paint(0xdfe3e8), 0, 0, 0); m.rotation.z = Math.PI / 2; m.position.x = x; return m; };
    // S1：发射换能器（固定）
    const s1 = new THREE.Group();
    s1.add(mesh(new THREE.BoxGeometry(3, 6, 4), MAT.paint(0x2b333c), X1 - 3, 5, Z));
    const b1 = tdx(X1 - 2.6, 2.1, 5.2); b1.position.y = 9; b1.position.z = Z; s1.add(b1);
    const f1 = tdx(X1 - 0.1, 1.7, 0.2); f1.material = MAT.chrome(); f1.position.set(X1 - 0.1, 9, Z); s1.add(f1);
    g.add(s1);
    // S2：接收换能器（随滑块移动）
    const car = (this.car = new THREE.Group());
    car.add(mesh(new THREE.BoxGeometry(6, 2.6, 10), MAT.paint(0x4b5563), 3.4, 3.4, Z));
    car.add(mesh(new THREE.BoxGeometry(3, 4, 4), MAT.paint(0x2b333c), 3.4, 6.2, Z));
    const b2 = tdx(2.6, 2.1, 5.2); b2.position.y = 9; b2.position.z = Z; car.add(b2);
    const f2 = tdx(0.1, 1.7, 0.2); f2.material = MAT.chrome(); f2.position.set(0.1, 9, Z); car.add(f2);
    car.add(mesh(new THREE.BoxGeometry(5, 1, 0.6), MAT.paint(0xb8c0cc), 3.4, 2.6, Z + 6.6)); // 游标
    g.add(car);
    // 手轮
    const wh = (this.wh = new THREE.Group());
    const disk = mesh(new THREE.CylinderGeometry(3.2, 3.2, 1.2, 32), MAT.paint(0x1f2937), 0, 0, 0); disk.rotation.z = Math.PI / 2; wh.add(disk);
    const hdl = mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.2, 10), MAT.chrome(), 1.4, 2.2, 0); hdl.rotation.z = Math.PI / 2; wh.add(hdl);
    wh.position.set(35, 3.6, Z); g.add(wh);
    // 数显温湿度计
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160;
    const c = cv.getContext('2d');
    c.fillStyle = '#e5e7eb'; c.fillRect(0, 0, 256, 160); c.fillStyle = '#c9d4c1'; c.fillRect(14, 14, 228, 132);
    c.fillStyle = '#1f2a1c'; c.font = 'bold 54px Consolas, monospace'; c.textAlign = 'right';
    c.fillText(this.T.toFixed(1), 190, 72); c.fillText(String(Math.round(this.RH * 100)), 190, 134);
    c.font = 'bold 24px Arial'; c.textAlign = 'left'; c.fillText('°C', 196, 72); c.fillText('%RH', 194, 134);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const meter = new THREE.Group();
    meter.add(mesh(new THREE.BoxGeometry(8, 5.4, 2.4), MAT.paint(0xe5e7eb), 0, 2.7, 0));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 4.6), new THREE.MeshBasicMaterial({ map: tex })); face.position.set(0, 2.7, 1.22); face.userData.noHL = true; meter.add(face);
    meter.position.set(46, 0, 14); meter.rotation.y = -0.4; g.add(meter);
    // 屏蔽线：信号源 → S1、信号源 → CH1，S2 → CH2
    const cable = (pts, col = 0x1f2937) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 40, 0.28, 6), MAT.paint(col));
    g.add(cable([[-37, 1, -10.4], [-36, 0.3, -4], [-30, 0.3, 4], [X1 - 4, 2, Z - 1], [X1 - 3, 7, Z - 2]]));
    g.add(cable([[-35, 1, -10.4], [-30, 0.3, -6], [5, 0.3, -6], [21.5, 0.4, -8.7]], 0x7a5c14));
    this.cableMat = MAT.paint(0x1e3a8a);
    this.cable2 = null;
    app.addComponent(new Component({
      key: 'rig', name: '声速测定仪', zone: 'none', fixed: true, required: true, object: g, labelY: 16,
      icon: SVG('<rect x="6" y="28" width="52" height="4" fill="currentColor"/><rect x="10" y="12" width="8" height="12" fill="none" stroke="currentColor" stroke-width="2"/><rect x="42" y="12" width="8" height="12" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19 18q3-4 6 0t6 0t6 0" fill="none" stroke="currentColor"/>'),
      desc: '两个压电陶瓷超声换能器：S₁ 固定，接信号发生器发射超声波；S₂ 装在丝杠带动的滑块上，接收声波并转成电压送到示波器 CH2。信号发生器的输出同时接 CH1。S₂ 的位置由游标尺读出（分度值 0.02 mm）。手轮每转一圈滑块移动 1 mm。',
      controls: () => [
        { type: 'knob', label: '手轮（移动 S₂）', get: () => this.cal.open, set: (v) => this.moveTo(v), step: 0.02, bigStep: 1, perRev: 1, fmt: () => '转动手轮' },
        { type: 'knob', label: '手轮（慢转）', get: () => this.cal.open, set: (v) => this.moveTo(v), step: 0.002, bigStep: 0.05, perRev: 0.1, fmt: () => '慢慢转' },
        { type: 'readout', label: '数显温湿度计', get: () => `${this.T.toFixed(1)} °C   ${Math.round(this.RH * 100)}%RH` },
      ],
    }));
  }
  moveTo(v) { this.cal.open = clamp(v, 0, this.cal.range); this.app.changed(); }

  tick(dt) {
    this.osc.frame(dt);
    if (this.s.power || (this._dark = (this._dark || 0) + dt) < 0.5) this.app.changed();
    if (this.s.power) this._dark = 0;
  }

  update() {
    const x = this.cal.reading, Z = 8;
    const fx = X1 + (x + this.d0) / 10;
    this.car.position.x = fx;
    this.wh.rotation.x = -this.cal.open * 2 * Math.PI;
    if (!this.cable2 || Math.abs(this._cx - fx) > 0.4) {
      this._cx = fx;
      if (this.cable2) { this.cable2.geometry.dispose(); this.car.parent.remove(this.cable2); }
      const pts = [[fx + 3.5, 7, Z - 2], [fx + 4, 2.4, Z - 4], [fx + 4, 0.3, Z - 9], [24, 0.3, -6], [26.8, 0.4, -8.7]].map((p) => new THREE.Vector3(...p));
      this.cable2 = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.28, 6), this.cableMat);
      this.car.parent.add(this.cable2);
    }
    const g = this.gen, gk = `${g.on}|${g.f}|${g.vpp}|${g.shape}|${g.offOn}|${g.off}`;
    if (gk !== this._gk) { this._gk = gk; g.after(); }
    this.updateSignal();
    this.osc.drawView();
    this.drawTool();
  }
  updateSignal() {
    const w = this.gen.wave(), on = this.gen.on;
    const key = `${on}|${w.f}|${w.amp}|${w.shape}|${this.cal.reading.toFixed(4)}`;
    if (key === this.sigKey) return;
    this.sigKey = key;
    if (!on || !(w.amp > 0)) { const z = makeSignal(w.f, { a: 0, shape: 'sine' }, { a: 0, ph: 0 }); this.osc.sig = z; this.eng.setSignal(z); return; }
    const fund = w.shape === 'square' ? 4 / Math.PI : w.shape === 'triangle' ? 8 / Math.PI ** 2 : 1;
    const a1 = w.amp * 0.96; // 换能器负载使输出略降
    const [re, im] = this.rx(this.cal.reading, w.f);
    const sig = makeSignal(w.f, { a: a1, shape: w.shape }, { a: a1 * fund * K_RX * Math.hypot(re, im), ph: Math.atan2(im, re) });
    this.osc.sig = sig; this.eng.setSignal(sig);
  }
  drawTool() {
    const v = this.tv, g = v.ctx;
    this.cal.draw(g, v.W, v.H, { assist: this.assist });
    v.foot('S₂ 滑块上的游标：读出 S₂ 的位置（只用相对位置，零点不必校准）');
  }

  globalControls() {
    return [{ type: 'toggle', label: '读数辅助（游标尺显示读数）', get: () => !!this.assist, set: (v) => (this.assist = v) }];
  }

  // ======================= 数据表 =======================
  tables() {
    const idxRows = (n) => () => Array.from({ length: n }, (_, i) => ({ k: i + 1, what: `x${i + 1}` }));
    return [
      {
        id: 'env', title: '谐振频率与室温', fixedRows: true,
        initRows: () => [{ k: 0 }],
        columns: [{ key: 'f', label: '谐振频率 f/kHz', digits: 3, readTol: 0.0011 }, { key: 't', label: '室温 t/°C', digits: 1, readTol: 0.06 }, { key: 'rh', label: '相对湿度/%', digits: 0, readTol: 0.6 }],
        buttons: [{ label: '记录信号频率', onClick: (t) => this.recF(t) }, { label: '记录温湿度', onClick: (t) => { t.set(0, 't', this.T); t.set(0, 'rh', Math.round(this.RH * 100)); } }],
        note: '频率从信号发生器的显示窗读出；温度、湿度从数显温湿度计读出。',
      },
      {
        id: 'sw', title: `驻波共振法：CH2 振幅极大时 S₂ 的位置（连续 ${NSW} 个）`, fixedRows: true, initRows: idxRows(NSW),
        columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'x', label: '位置 x/mm', digits: 2, readTol: 0.021 }],
        buttons: [{ label: '记录 S₂ 位置', onClick: (t) => this.recSW(t) }],
        note: '朝一个方向转动手轮，依次记下 CH2 振幅为极大时的位置，相邻两个极大相距 λ/2。',
      },
      {
        id: 'ph', title: `相位比较法：李萨如图形为同方向直线时的位置（连续 ${NPH} 个）`, fixedRows: true, initRows: idxRows(NPH),
        columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'x', label: '位置 x/mm', digits: 2, readTol: 0.021 }],
        buttons: [{ label: '记录 S₂ 位置', onClick: (t) => this.recPH(t) }],
        note: '示波器置 X-Y 方式。图形每变回同一方向的直线一次，S₂ 移动一个波长 λ。',
      },
    ];
  }
  nextEmpty(t) { return t.rows.findIndex((r) => r.x == null || r.x === ''); }
  xRead() { return Math.round(this.cal.reading / 0.02) * 0.02; }
  recF(t) {
    const a = this.app;
    if (!this.gen.on) return a.toast('信号发生器的输出还没有打开', 'warn');
    if (this.gen.shape !== 'sine') a.toast('换能器应该用正弦信号驱动', 'warn');
    const { a: best } = this.bestF();
    if (this.amp(this.cal.reading, this.gen.wave().f) < 0.9 * best) a.toast('CH2 的振幅还没有调到最大：再仔细调节频率', 'warn');
    this.fRec = this.gen.f;
    t.set(0, 'f', Math.round(this.gen.f) / 1000);
  }
  checkF() {
    const a = this.app;
    if (this.fRec == null) { a.toast('先调好谐振频率并记录', 'warn'); return false; }
    if (Math.abs(this.gen.f - this.fRec) > 0.5) a.toast('信号频率与记录的谐振频率不同：测量过程中不能再改频率', 'warn');
    if (!this.s.power) { a.toast('示波器没有打开', 'warn'); return false; }
    return true;
  }
  recSW(t) {
    const a = this.app;
    if (!this.checkF()) return;
    const i = this.nextEmpty(t);
    if (i < 0) return a.toast(`已经记满 ${NSW} 个位置`, 'warn');
    const f = this.gen.wave().f, x = this.cal.reading, pk = this.localPeak(x, f);
    if (this.amp(x, f) < 0.985 * this.amp(pk, f)) a.toast('CH2 的振幅还不是极大：慢转手轮，找到振幅最大的位置', 'warn');
    if (this.s.mode === 'XY') a.toast('驻波法看的是 CH2 的振幅，示波器用 CH2 或双踪方式更方便', 'warn');
    if (i > 0) {
      const d = x - t.rows[i - 1].x, h = this.lam(f) / 2;
      if (d < 0) a.toast('位置比上一次小：手轮应朝一个方向转', 'warn');
      else if (Math.abs(d - h) > 0.3 * h) a.toast(`与上一次相距 ${d.toFixed(2)} mm，约为 λ/2 的 ${(d / h).toFixed(1)} 倍：可能漏掉或重复了一个极大`, 'warn');
    }
    t.set(i, 'x', this.xRead());
  }
  recPH(t) {
    const a = this.app;
    if (!this.checkF()) return;
    const i = this.nextEmpty(t);
    if (i < 0) return a.toast(`已经记满 ${NPH} 个位置`, 'warn');
    if (this.s.mode !== 'XY') a.toast('相位比较法要把示波器置于 X-Y 方式，观察李萨如图形', 'warn');
    const f = this.gen.wave().f, x = this.cal.reading, ph = this.phase(x, f);
    if (Math.abs(Math.sin(ph)) > 0.08) a.toast('李萨如图形还不是直线（是椭圆）：慢转手轮，使它恰好变成直线', 'warn');
    if (i > 0) {
      const p0 = this.phase(t.rows[i - 1].x, f);
      if (Math.cos(ph) * Math.cos(p0) < 0) a.toast('这次的直线与上一次方向相反（只移动了 λ/2）：应记同方向直线的位置', 'warn');
      const d = x - t.rows[i - 1].x, L = this.lam(f);
      if (d > 0 && Math.abs(d - L) > 0.3 * L && Math.cos(ph) * Math.cos(p0) > 0) a.toast(`与上一次相距 ${d.toFixed(2)} mm，约为 λ 的 ${(d / L).toFixed(1)} 倍`, 'warn');
    }
    t.set(i, 'x', this.xRead());
  }

  // ======================= 自动操作 =======================
  async knob(get, set, to, ms = 400) { await this.app.tween(get, set, to, ms); set(to); this.app.changed(); }
  steps() {
    const app = this.app, s = this.s, gen = this.gen;
    const filled = (id) => app.table(id).rows.filter((r) => r.x != null && r.x !== '' && isFinite(r.x)).length;
    const vIdx = (v) => VDIV.indexOf(v);
    return [
      {
        title: '打开仪器，观察两路信号',
        html: '<p>打开信号发生器的输出（正弦波，幅度约 10 Vpp），打开示波器，置双踪方式，调好辉度、聚焦，使 CH1（发射信号）和 CH2（接收信号）都稳定显示。扫描时间用 10 μs/div 左右（超声频率约 40 kHz）。</p>',
        check: () => gen.on && s.power && s.mode !== 'CH1' && Math.abs(s.focus - 0.5) < 0.2,
        auto: async () => {
          await app.view('信号源'); app.select(gen.comp);
          gen.on = true; gen.shape = 'sine'; gen.vpp = 10; app.renderInspector(); app.changed(); await app.wait(400);
          await app.view('示波器'); app.select(this.osc.comp);
          s.power = true; s.inten = 0.5; s.focus = 0.5; s.mode = 'DUAL';
          s.ch[0].vdiv = vIdx(5); s.ch[1].vdiv = vIdx(1); s.ch[0].pos = 2; s.ch[1].pos = -2; s.tdiv = 6; s.trig.src = 0;
          app.renderInspector(); app.changed(); await app.wait(600);
        },
      },
      {
        title: '调节谐振频率',
        html: '<p>把 S₂ 移到离 S₁ 约 3–5 cm 处。在 35–40 kHz 附近慢慢调节信号频率，使 CH2 的振幅最大——此时换能器处于谐振状态，发射和接收都最强。记下频率。之后测量过程中不要再改变频率。</p>',
        hint: '频率改变时 CH2 振幅变化很灵敏，用细调旋钮。若 CH2 波形超出屏幕，调大 CH2 的偏转因数。',
        check: () => this.fRec != null && Math.abs(gen.f - this.fRec) < 1 && this.amp(this.cal.reading, gen.wave().f) >= 0.9 * this.bestF().a,
        auto: async () => {
          await app.view('测试架'); app.select(app.comp('rig'));
          await this.knob(() => this.cal.open, (v) => this.moveTo(v), 30 + rand(0, 6), 600);
          const { f } = this.bestF();
          app.select(gen.comp); await app.view('信号源');
          gen.range = 4; await this.knob(() => gen.f, (v) => gen.setF(v), Math.round(f / 10) * 10, 800);
          app.renderInspector(); await app.wait(300);
          app.showTable(0); await app.record('env', 0); await app.record('env', 1);
        },
      },
      {
        title: '驻波共振法测波长',
        html: `<p>S₁、S₂ 两端面之间形成驻波。朝一个方向慢慢转动手轮，CH2 的振幅周期性地变大、变小：每当两端面间距为半波长的整数倍时振幅最大。依次记下 ${NSW} 个振幅极大时 S₂ 的位置。</p>`,
        hint: '离 S₁ 越远，振幅越小，必要时调小 CH2 的偏转因数（更灵敏）。',
        check: () => filled('sw') >= NSW,
        auto: async () => {
          await app.view('测试架'); app.showTable(1); app.select(app.comp('rig'));
          const f = gen.wave().f, pk = this.peaksFrom(this.cal.reading + 1, NSW, f);
          for (const p of pk) {
            if (this.amp(p, f) < 0.25) s.ch[1].vdiv = Math.min(s.ch[1].vdiv, vIdx(0.5));
            await this.knob(() => this.cal.open, (v) => this.moveTo(v), p + gauss(0.006), 300);
            await app.wait(150); await app.record('sw', 0);
          }
        },
      },
      {
        title: '相位比较法测波长',
        html: `<p>把示波器置于 X-Y 方式：CH1 的发射信号作 X，CH2 的接收信号作 Y，屏上是同频率的李萨如图形。S₂ 移动时两信号的相位差改变，图形在直线—椭圆—反向直线之间变化。从图形为“/”方向直线的位置开始，依次记下 ${NPH} 个同方向直线的位置，相邻两个相距一个波长。</p>`,
        hint: '图形恰好是直线的位置比振幅极大的位置更容易判准。',
        check: () => filled('ph') >= NPH,
        auto: async () => {
          await app.view('示波器'); app.select(this.osc.comp);
          s.mode = 'XY'; s.ch[0].pos = 0; s.ch[1].pos = 0; s.ch[0].vdiv = vIdx(2); s.ch[1].vdiv = vIdx(0.5); app.renderInspector(); app.changed();
          await this.knob(() => this.cal.open, (v) => this.moveTo(v), 20, 600);
          app.showTable(2);
          const f = gen.wave().f, xs = this.inPhaseFrom(this.cal.reading, NPH, f);
          for (const p of xs) {
            await this.knob(() => this.cal.open, (v) => this.moveTo(v), p + gauss(0.004), 300);
            await app.wait(150); await app.record('ph', 0);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>用逐差法求波长，由 v = fλ 算出声速，并与由室温、湿度算出的理论值比较。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, e = a.table('env').rows[0];
    const xs = (id) => a.table(id).rows.map((r) => r.x).filter((x) => x != null && x !== '' && isFinite(x)).map(Number);
    const sw = xs('sw'), ph = xs('ph');
    if (!(e.f > 0)) return { html: '<p>请先记录谐振频率。</p>', ok: false };
    if (sw.length < NSW && ph.length < NPH) return { html: `<p>请至少完成一种方法的测量（驻波法 ${NSW} 个位置或相位法 ${NPH} 个位置）。</p>`, ok: false };
    const f = e.f * 1000, f3 = (x) => x.toFixed(3);
    const t = isFinite(e.t) && e.t !== '' && e.t != null ? +e.t : NaN, rh = isFinite(e.rh) && e.rh !== '' && e.rh != null ? e.rh / 100 : NaN;
    const vT = isFinite(t) ? soundSpeed(t, isFinite(rh) ? rh : 0) : NaN, vDry = isFinite(t) ? soundSpeed(t, 0) : NaN;
    let html = `<p>谐振频率 f = ${e.f.toFixed(3)} kHz。</p>`;
    const answers = [], plots = [];
    const res = [];
    const method = (name, x, n, per) => {
      const h = n / 2, D = Array.from({ length: h }, (_, i) => x[i + h] - x[i]);
      const lam = mean(D) / (h * per); // per：相邻两点对应的波长数
      const uA = stdev(D) / Math.sqrt(h) / (h * per), uB = ((0.02 / Math.sqrt(3)) * Math.SQRT2) / (h * per);
      const u = Math.hypot(uA, uB), v = f * lam / 1000, uv = (f * u) / 1000;
      html += `<h3>${name}</h3><table><tr><th>i</th>${D.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr><tr><td>x<sub>i+${h}</sub> − x<sub>i</sub> /mm</td>${D.map((d) => `<td>${d.toFixed(2)}</td>`).join('')}</tr></table>
        <p>每个差值对应 ${h * per} 个波长，λ = ${f3(lam)} mm（A 类 ${uA.toFixed(4)} mm，B 类 ${uB.toFixed(4)} mm）。</p>
        <div class="result-box">$\\lambda=${fmtU(lam, u)}$ mm，$v=f\\lambda=${fmtU(v, uv)}$ m/s</div>`;
      res.push({ name, v, uv });
      plots.push({ title: `${name}：x–序号`, xLabel: '序号 i', yLabel: 'x / mm', series: [{ type: 'scatter', data: x.map((y, i) => [i + 1, y]) }, { type: 'line', data: (() => { const ft = linFit(x.map((_, i) => i + 1), x); return [[1, ft.b + ft.k], [n, ft.b + ft.k * n]]; })(), dash: [5, 4] }] });
      return v;
    };
    if (sw.length >= NSW) { const v = method('1. 驻波共振法', sw.slice(0, NSW), NSW, 0.5); answers.push({ label: '$v_1$', unit: 'm/s', value: v, digits: 1, tolRel: 0.003 }); }
    if (ph.length >= NPH) { const v = method('2. 相位比较法', ph.slice(0, NPH), NPH, 1); answers.push({ label: '$v_2$', unit: 'm/s', value: v, digits: 1, tolRel: 0.003 }); }
    html += '<h3>3. 与理论值比较</h3>';
    if (isFinite(vT)) {
      html += `<p>室温 ${t.toFixed(1)} °C、相对湿度 ${isFinite(rh) ? Math.round(rh * 100) + '%' : '（未记录）'}：干燥空气 $v=331.45\\sqrt{1+t/273.15}=${vDry.toFixed(2)}$ m/s，考虑水蒸气后 $v_T=${vT.toFixed(2)}$ m/s（湿空气声速略大）。</p>`;
      html += res.map((r) => `<div class="result-box warn">${r.name.slice(3)}：${r.v.toFixed(2)} m/s，与理论值的相对误差 ${pct(relErr(r.v, vT), 2)}</div>`).join('');
    } else html += '<p>没有记录室温，无法计算理论值。</p>';
    html += '<p>驻波法判断振幅极大时，极大附近振幅随位置变化很平缓，判准的不确定度较大；相位法判断图形“恰好成直线”比较灵敏。</p>';
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 声速与波长、频率</h3>${soundFig()}<p>声波的传播速度 $v$、频率 $f$ 和波长 $\\lambda$ 满足 $v=f\\lambda$。频率由信号发生器读出，只要测出波长就能求出声速。本实验用压电陶瓷换能器发射和接收约 40 kHz 的超声波：波长不到 1 cm，便于在一段丝杠上测量多个波长。换能器在谐振频率附近灵敏度最高，所以先要调谐振。</p>
<h3>2. 驻波共振法</h3><p>S₁ 发出的平面波在 S₂ 端面上反射，又在 S₁ 端面上反射……两端面之间形成驻波。当两端面的间距 $L=n\\lambda/2$ 时，各次反射波在 S₂ 处同相叠加，S₂ 接收到的声压最大。移动 S₂，相邻两个振幅极大的位置相距 $\\lambda/2$。</p>
<h3>3. 相位比较法</h3><p>S₂ 接收到的信号比 S₁ 的激励信号落后相位 $\\Delta\\varphi=2\\pi L/\\lambda$（加上一个常数）。把两个信号分别送入示波器的 X、Y 输入，屏上是李萨如图形：$\\Delta\\varphi=0$ 时为“/”方向直线，$\\pi/2$ 时为正椭圆，$\\pi$ 时为“\\\\”方向直线。S₂ 每移动一个波长，图形回到同一方向的直线。</p>
<h3>4. 声速的理论值</h3><p>理想气体中 $v=\\sqrt{\\gamma RT/M}$，所以 $v=v_0\\sqrt{1+t/273.15}$，$v_0=331.45$ m/s 是 0 °C 干燥空气中的声速。空气中的水蒸气使声速略增大：$v=331.45\\sqrt{1+\\dfrac{t}{273.15}}\\sqrt{1+0.3192\\dfrac{p_w}{p}}$，$p_w$ 是水蒸气分压。</p>
<h3>5. 本仿真的计算模型</h3><p>两换能器各按谐振电路的频率响应计算（谐振频率略有不同，品质因数约 12）；S₂ 处的声压为各次反射波之和，每次反射振幅乘以端面反射系数，传播中按扩散和空气吸收衰减。所以振幅极大随距离减小，极大位置的间距很接近 λ/2 但不严格相等；相位也略受反射波的影响。</p>`;
  }
}
