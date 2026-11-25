// 实验：示波器观测铁氧体的动态磁滞回线
// 退磁 · 基本磁化曲线与 μ–H 曲线 · 磁滞回线的 Bₘ、Bᵣ、H_c · 两种样品比较
// 样品的磁化用 Jiles–Atherton 模型，与初级回路（电压驱动、采样电阻 R₁）和次级 RC 积分电路联立求解
// （src/physics/hysteresis.js）。磁化状态在调节之间保留，所以退磁、剩磁、局部回线都会如实出现。
import * as THREE from 'three';
import { meta, thumb } from './hysteresis.meta.js';
import { Circuit, benchTable, panelMesh } from '../core/circuit.js';
import { oscilloscope } from '../core/oscillo.js';
import { VDIV, fmtV } from '../core/scopeEngine.js';
import { Component } from '../core/Component.js';
import { MAT, mesh } from '../core/Models.js';
import { JAMaterial, SAMPLES, simulateLoop, loopParams } from '../physics/hysteresis.js';
import { mean, rand, relErr, pct, clamp } from '../core/Stats.js';
import { hysteresisFig } from './circuitFigs.js';

const MU0 = 4e-7 * Math.PI;
const N1 = 50, N2 = 150, LEN = 0.060, S = 80e-6, R1 = 2.5, R2 = 10e3, C2 = 20e-6, F = 50;
const PTS = 2000; // 每周期的计算点数

const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

/** 磁滞回线实验仪：50 Hz 可调电压、两个环形样品、采样电阻 R₁、积分电路 R₂C */
function hysInstrument({ key = 'hys', defaultSlot }) {
  const W = 34, Hh = 10, D = 20;
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(W, Hh, D), MAT.paint(0xd9d4c7), 0, Hh / 2, 0));
  const cv = document.createElement('canvas'); cv.width = 816; cv.height = 240;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, Hh - 0.6), new THREE.MeshBasicMaterial({ map: tex })); face.position.set(0, Hh / 2, D / 2 + 0.02); face.userData.noHL = true; g.add(face);
  const knob = mesh(new THREE.CylinderGeometry(1.4, 1.5, 1.4, 24), MAT.black(), 9, 2.6, D / 2 + 0.7); knob.rotation.x = Math.PI / 2; g.add(knob);
  // 两个环形样品（顶面）
  const toroids = [-7, 5].map((x, i) => {
    const t = new THREE.Group(); t.position.set(x, Hh, -3);
    t.add(mesh(new THREE.TorusGeometry(2.6, 0.9, 14, 40), MAT.paint(i ? 0x3b3b3b : 0x2b2b2b), 0, 1.0, 0));
    t.children[0].rotation.x = Math.PI / 2;
    const wind = new THREE.MeshStandardMaterial({ color: 0xb86b2b, metalness: 0.7, roughness: 0.4 });
    for (let k = 0; k < 28; k++) { const a = (k / 28) * Math.PI * 2; const r = mesh(new THREE.TorusGeometry(0.98, 0.07, 4, 10), wind, Math.cos(a) * 2.6, 1.0, Math.sin(a) * 2.6); r.rotation.y = -a; t.add(r); }
    g.add(t); return t;
  });
  const top = panelMesh(W, 4, (c, w, h) => {
    c.fillStyle = '#d9d4c7'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f2937'; c.font = `${h * 0.22}px "Microsoft YaHei"`; c.textAlign = 'center';
    c.fillText(`N₁ = ${N1}  N₂ = ${N2}  l = ${LEN * 1000} mm  S = ${S * 1e6} mm²`, w / 2, h * 0.36);
    c.fillText(`R₁ = ${R1} Ω  R₂ = ${R2 / 1000} kΩ  C = ${C2 * 1e6} μF  f = ${F} Hz`, w / 2, h * 0.76);
  });
  top.rotation.x = -Math.PI / 2; top.position.set(0, Hh + 0.02, 6.6); g.add(top);
  const dev = {
    key, short: '实验仪', on: false, U: 0, sample: 1,
    terms: {
      X: { pos: new THREE.Vector3(-14, 0.4, D / 2 + 0.3), label: 'X（U_R1）', color: 0xd4a017 },
      Y: { pos: new THREE.Vector3(-10.5, 0.4, D / 2 + 0.3), label: 'Y（U_C）', color: 0x1f4fbf },
      gnd: { pos: new THREE.Vector3(-7, 0.4, D / 2 + 0.3), label: '⊥', color: 0x1b1b1b },
    },
    elements() { return []; },
    after() {
      knob.rotation.y = -dev.U * 1.6;
      toroids.forEach((t, i) => (t.position.y = Hh + (dev.sample === i + 1 ? 0.25 : 0)));
      draw();
    },
  };
  let last = '';
  const draw = () => {
    const sig = `${dev.on}|${dev.U.toFixed(2)}|${dev.sample}`;
    if (sig === last) return; last = sig;
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    c.fillStyle = '#d9d4c7'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f2937'; c.font = 'bold 26px "Microsoft YaHei"'; c.textAlign = 'left'; c.fillText('磁滞回线实验仪', 18, 36);
    c.fillStyle = '#0a1a10'; c.fillRect(300, 56, 250, 90);
    c.fillStyle = '#5eea8c'; c.font = 'bold 64px Consolas, monospace'; c.textAlign = 'right'; c.fillText(dev.on ? dev.U.toFixed(2) : '', 500, 126);
    c.font = 'bold 26px Consolas'; c.textAlign = 'left'; c.fillText('V', 506, 126);
    c.fillStyle = '#1f2937'; c.font = '20px "Microsoft YaHei"'; c.textAlign = 'center';
    c.fillText('励磁电压（有效值）', 425, 176); c.fillText('电压调节', 684, 226);
    c.fillText(`样品 ${dev.sample}`, 160, 120);
    c.fillText('X     Y     ⊥', 140, 226);
    c.fillStyle = dev.on ? '#22c55e' : '#444'; c.beginPath(); c.arc(612, 70, 9, 0, 7); c.fill();
    c.fillStyle = '#1f2937'; c.fillText('电源', 660, 77);
    tex.needsUpdate = true;
  };
  draw();
  dev.comp = new Component({
    key, name: '磁滞回线实验仪', icon: SVG('<rect x="6" y="10" width="52" height="24" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="22" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="40" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/>'),
    zone: 'slot', defaultSlot, object: g, labelY: 14,
    desc: `内有 50 Hz 可调交流电源（0–3 V）。环形铁氧体样品上绕有初级 N₁ = ${N1} 匝、次级 N₂ = ${N2} 匝，平均磁路长 l = ${LEN * 1000} mm，截面积 S = ${S * 1e6} mm²。初级串联采样电阻 R₁ = ${R1} Ω，其电压从 X 端输出（∝ H）；次级经 R₂ = ${R2 / 1000} kΩ 给 C = ${C2 * 1e6} μF 充电，电容电压从 Y 端输出（∝ B）。`,
    controls: () => [
      { type: 'toggle', label: '电源', get: () => dev.on, set: (v) => (dev.on = v) },
      { type: 'segment', label: '样品', get: () => dev.sample, set: (v) => (dev.sample = v), options: [{ label: '样品 1', value: 1 }, { label: '样品 2', value: 2 }] },
      { type: 'knob', label: '励磁电压 U', get: () => dev.U, set: (v) => (dev.U = clamp(Math.round(v * 100) / 100, 0, 3)), min: 0, max: 3, step: 0.01, bigStep: 0.1, perRev: 1, digits: 2, unit: 'V' },
    ],
  });
  return dev;
}

export class HysteresisExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    // 两个样品：材料参数有 ±3% 的批次差异，开始时带有一定剩磁（上次实验后没有退磁）
    this.mats = {};
    this.st = {};
    for (const k of [1, 2]) {
      const p = { ...SAMPLES[k] };
      for (const q of ['Ms', 'a', 'k']) p[q] *= 1 + rand(-0.03, 0.03);
      const m = new JAMaterial(p);
      m.Mirr = m.M = (Math.random() < 0.5 ? -1 : 1) * rand(0.3, 0.5) * p.Ms;
      this.mats[k] = m; this.st[k] = {};
    }
    this.loop = null; // 最近一次计算的周期波形
    this._key = '';
  }

  cameras() {
    return [
      { name: '全景', pos: [0, 90, 92], target: [0, 4, 0] },
      { name: '示波器', pos: [16, 40, 40], target: [16, 10, -22] },
      { name: '实验仪', pos: [-40, 38, 52], target: [-40, 6, 14] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    app.addSlot({ id: 'osc', pos: new THREE.Vector3(16, 0, -22), accepts: ['osc'] });
    app.addSlot({ id: 'hys', pos: new THREE.Vector3(-40, 0, 12), accepts: ['hys'] });
    this.view = app.addView({ id: 'scr', title: '示波器荧光屏', w: 360, h: 284, res: 1 });
    const cir = (this.cir = new Circuit(app));
    this.hys = cir.add(hysInstrument({ defaultSlot: 'hys' }));
    this.osc = cir.add(oscilloscope({ app, defaultSlot: 'osc', view: this.view }));
    this.s = this.osc.s; this.eng = this.osc.eng;
  }

  pointerDown(e) { return this.cir.pointerDown(e); }
  pointerMove(e) { return this.cir.pointerMove(e); }
  onRemove(c) { this.cir.removeDevice(c.key); }
  tick(dt) {
    if (!this.cir.placed('osc')) return;
    this.osc.frame(dt);
    if (this.s.power || (this._dark = (this._dark || 0) + dt) < 0.5) this.app.changed();
    if (this.s.power) this._dark = 0;
  }

  /** 示波器各通道接的是哪一路：'X'、'Y' 或 null；以及地线是否接好 */
  route() {
    const c = this.cir;
    if (!c.placed('osc') || !c.placed('hys')) return { ch: [null, null], gnd: false };
    const n = c.nets();
    const src = (k) => (n(`osc:${k}`) === n('hys:X') ? 'X' : n(`osc:${k}`) === n('hys:Y') ? 'Y' : null);
    return { ch: [src('ch1'), src('ch2')], gnd: n('osc:gnd') === n('hys:gnd') };
  }
  /** 有变化时重新计算样品的磁化过程并更新示波器信号 */
  refreshSignal() {
    const h = this.hys, r = this.route(), s = this.s;
    const key = [h.on, h.U, h.sample, r.ch.join(','), r.gnd, s.ch[0].cpl, s.ch[1].cpl].join('|');
    if (key === this._key) return;
    this._key = key;
    const m = this.mats[h.sample];
    const prevU = m.lastU ?? 0;
    m.lastU = h.on ? h.U : 0;
    if (h.on && h.U > 0) {
      if (h.U < prevU - 1e-9) m.demag = false; // 电压调小（但没回到零）：已经不在基本磁化曲线上
      // 电压连续变化时每次接着上一个状态算 2 个周期；变化大时多算几个周期让回线稳定
      const periods = Math.abs(h.U - prevU) > 0.15 ? 4 : 2;
      this.loop = simulateLoop(m, { U: h.U, f: F, R1, N1, N2, l: LEN, S, R2, C: C2 }, this.st[h.sample], { periods, steps: PTS });
      this.loop.sample = h.sample; this.loop.U = h.U;
    } else {
      // 断电：电流按初级时间常数很快衰减到零，样品停在 H = 0 时的剩磁状态
      if (m.H !== 0) m.stepTo(0, true);
      m.demag = Math.abs(m.M) < 0.05 * m.Ms; // 回到零时剩余磁化很小，算作已退磁
      this.loop = null;
    }
    const data = { ch1: new Float64Array(PTS), ch2: new Float64Array(PTS) };
    const T = 1 / F;
    for (let c = 0; c < 2; c++) {
      const name = c ? 'ch2' : 'ch1', d = data[name], which = r.ch[c], cpl = s.ch[c].cpl;
      if (cpl === 'GND') continue;
      for (let i = 0; i < PTS; i++) {
        let v = this.loop && which ? (which === 'X' ? this.loop.x[i] : this.loop.y[i]) : 0;
        if (which && !r.gnd) v += 0.25 * Math.sin((2 * Math.PI * i) / PTS + 0.7 * c); // 地线没接：50 Hz 工频干扰
        d[i] = v;
      }
    }
    const sig = { groups: [{ T, f: F, data }], dc: {}, at: (name, t) => { const d = data[name]; const u = ((((t / T) % 1) + 1) % 1) * PTS, i = Math.floor(u), fr = u - i; return d[i % PTS] * (1 - fr) + d[(i + 1) % PTS] * fr; } };
    this.osc.sig = sig; this.eng.setSignal(sig);
  }

  update() {
    const cir = this.cir;
    for (const d of cir.devices.values()) if (d.comp.placed && d.after) d.after();
    this.refreshSignal();
    if (cir.placed('osc')) this.osc.drawView();
    else { const v = this.view, c = v.ctx; c.fillStyle = '#2b2e31'; c.fillRect(0, 0, v.W, v.H); v.foot('示波器尚未放到桌上'); }
  }

  // ---------------- 读数 ----------------
  /** 当前屏幕上回线的几何量（格）：顶点 Xm、Ym，矫顽力对应 Xc，剩磁对应 Yr（均取正负两侧的平均） */
  geo() {
    const L = this.loop, e = this.eng;
    if (!L) return null;
    const kx = e.gain[0] / e.vEff(0), ky = e.gain[1] / e.vEff(1);
    const p = loopParams(Array.from(L.x, (v) => v * kx), Array.from(L.y, (v) => v * ky));
    return { Xm: p.Hm, Ym: p.Bm, Xc: p.Hc, Yr: p.Br };
  }
  /** 真实值（不含示波器误差），用于核对 */
  truth() { const L = this.loop; return L ? loopParams(L.H, L.B) : null; }
  canRead() {
    const app = this.app, r = this.route(), s = this.s;
    if (!this.hys.on || !this.loop) { app.toast('实验仪电源没开或电压为零', 'warn'); return false; }
    if (r.ch[0] !== 'X' || r.ch[1] !== 'Y' || !r.gnd) { app.toast('接线：X 接 CH1，Y 接 CH2，⊥ 接示波器的地', 'warn'); return false; }
    if (!s.power || s.mode !== 'XY') { app.toast('示波器要打开，并置于 X-Y 方式', 'warn'); return false; }
    if (s.ch[0].cpl === 'GND' || s.ch[1].cpl === 'GND') { app.toast('输入耦合不能放在 GND', 'warn'); return false; }
    if (this.eng.uncal().y.some(Boolean)) { app.toast('VOLTS/DIV 微调不在校准位置，格数无法换算成电压', 'warn'); return false; }
    const g = this.geo();
    if (g.Xm > 5 || g.Ym > 4) { app.toast('回线超出屏幕，调大 VOLTS/DIV', 'warn'); return false; }
    return true;
  }
  q(v) { return Math.round(v * 50) / 50; } // 估读到 0.02 格

  tables() {
    const H = (r, X) => (N1 * X * r.vx) / (LEN * R1);
    const B = (r, Y) => (R2 * C2 * Y * r.vy * 1e-3) / (N2 * S);
    const dcol = (k, l) => ({ key: k, label: l, digits: 2, readTol: 0.06 });
    return [
      {
        id: 'curve', title: '基本磁化曲线', maxRows: 14,
        columns: [
          { key: 'smp', label: '样品', digits: 0, auto: true }, { key: 'U', label: 'U/V', digits: 2, auto: true },
          { key: 'vx', label: 'X 档 V/div', digits: 3, auto: true }, { key: 'vy', label: 'Y 档 mV/div', digits: 0, auto: true },
          dcol('X', '顶点 X/格'), dcol('Y', '顶点 Y/格'),
          { key: 'H', label: 'H/(A/m)', digits: 1, calc: (r) => H(r, r.X) }, { key: 'B', label: 'B/T', digits: 4, calc: (r) => B(r, r.Y) },
          { key: 'mu', label: 'μᵣ = B/μ₀H', digits: 0, calc: (r) => B(r, r.Y) / (MU0 * H(r, r.X)) },
        ],
        buttons: [{ label: '记录回线顶点', onClick: (t) => this.recCurve(t) }],
        note: '退磁后电压从小到大逐点增加（不能回调），每次记录回线顶点的坐标（取左右两个顶点间距的一半）。$H=\\dfrac{N_1}{lR_1}U_X$，$B=\\dfrac{R_2C}{N_2S}U_Y$。',
      },
      {
        id: 'loop', title: '磁滞回线参数', maxRows: 6,
        columns: [
          { key: 'smp', label: '样品', digits: 0, auto: true }, { key: 'U', label: 'U/V', digits: 2, auto: true },
          { key: 'vx', label: 'X 档 V/div', digits: 3, auto: true }, { key: 'vy', label: 'Y 档 mV/div', digits: 0, auto: true },
          dcol('Xm', 'Xₘ/格'), dcol('Ym', 'Yₘ/格'), dcol('Xc', 'X_c/格'), dcol('Yr', 'Yᵣ/格'),
          { key: 'Hc', label: 'H_c/(A/m)', digits: 1, calc: (r) => H(r, r.Xc) }, { key: 'Br', label: 'Bᵣ/T', digits: 4, calc: (r) => B(r, r.Yr) },
          { key: 'Bm', label: 'Bₘ/T', digits: 4, calc: (r) => B(r, r.Ym) },
        ],
        buttons: [{ label: '记录回线（顶点、与两轴的交点）', onClick: (t) => this.recLoop(t) }],
        note: 'Xₘ、Yₘ：顶点坐标；X_c：回线与 X 轴两个交点间距的一半（对应矫顽力）；Yᵣ：与 Y 轴两个交点间距的一半（对应剩磁）。',
      },
    ];
  }
  scales() { return { vx: VDIV[this.s.ch[0].vdiv], vy: +(VDIV[this.s.ch[1].vdiv] * 1000).toFixed(3) }; }
  recCurve(t) {
    if (!this.canRead()) return;
    const h = this.hys, m = this.mats[h.sample];
    if (!m.demag) this.app.toast('这个样品还没有退磁，测得的不是基本磁化曲线', 'warn');
    const prev = t.rows.filter((r) => r.smp === h.sample).pop();
    if (prev && h.U < prev.U - 1e-9) this.app.toast('测基本磁化曲线时电压只能单调增加；回调后要重新退磁', 'warn');
    const g = this.geo();
    t.addRow({ smp: h.sample, U: h.U, ...this.scales(), X: this.q(g.Xm), Y: this.q(g.Ym) });
  }
  recLoop(t) {
    if (!this.canRead()) return;
    const h = this.hys, g = this.geo(), tr = this.truth();
    t.addRow({ smp: h.sample, U: h.U, ...this.scales(), Xm: this.q(g.Xm), Ym: this.q(g.Ym), Xc: this.q(g.Xc), Yr: this.q(g.Yr), _t: tr, _xy: this.shape() });
  }
  /** 记下屏幕上的回线形状（格），供数据处理作图 */
  shape() {
    const L = this.loop, e = this.eng, kx = e.gain[0] / e.vEff(0), ky = e.gain[1] / e.vEff(1), o = [];
    for (let i = 0; i <= PTS; i += 10) o.push([L.x[i % PTS] * kx, L.y[i % PTS] * ky]);
    return o;
  }

  // ---------------- 自动操作 ----------------
  async scope(fn, ms = 200) { this.app.select(this.osc.comp); fn(this.s); this.app.changed(); await this.app.wait(ms); }
  /** 选 VOLTS/DIV：回线尽量大但不出屏 */
  async fit() {
    this.refreshSignal();
    const L = this.loop; if (!L) return;
    const e = this.eng;
    const xm = Math.max(...L.x.map(Math.abs)), ym = Math.max(...L.y.map(Math.abs));
    const pick = (v, lim, c) => { for (let i = 0; i < VDIV.length; i++) if ((v * e.gain[c]) / VDIV[i] <= lim) return i; return VDIV.length - 1; };
    await this.scope((x) => { x.ch[0].vdiv = pick(xm, 4.9, 0); x.ch[1].vdiv = pick(ym, 3.92, 1); });
  }
  async setU(U, ms = 500) {
    const h = this.hys, app = this.app;
    app.select(h.comp);
    await app.tween(() => h.U, (v) => (h.U = Math.round(v * 100) / 100), U, ms);
    h.U = U; app.changed(); await app.wait(120);
  }
  /** 退磁：升到 3 V，再缓慢降到零 */
  async demag() {
    const h = this.hys, app = this.app;
    await this.setU(3, 600);
    const t0 = h.U;
    for (let U = t0; U > 0; U = Math.round((U - 0.05) * 100) / 100) { h.U = Math.max(0, U); app.changed(); this.update(); await app.wait(25); }
    h.U = 0; app.changed(); this.update(); await app.wait(150);
  }

  steps() {
    const app = this.app, cir = this.cir, s = this.s;
    const rows = (id, smp) => app.table(id).completeRows().filter((r) => r.smp === smp);
    return [
      {
        title: '摆放仪器并接线',
        html: '<p>把磁滞回线实验仪和示波器放到桌上。实验仪的 X 端（采样电阻 R₁ 上的电压，∝ H）接示波器 CH1，Y 端（积分电容上的电压，∝ B）接 CH2，⊥ 接示波器的地。</p>',
        check: () => { const r = this.route(); return r.ch[0] === 'X' && r.ch[1] === 'Y' && r.gnd; },
        auto: async () => { await app.view('全景'); await app.autoPlace('hys'); await app.autoPlace('osc'); await cir.rewire([['hys:X', 'osc:ch1'], ['hys:Y', 'osc:ch2'], ['hys:gnd', 'osc:gnd']]); },
      },
      {
        title: '示波器置于 X-Y 方式并调好光点',
        html: '<p>打开示波器，垂直方式选 <b>X-Y</b>，两通道耦合选 DC，微调旋到校准位置。实验仪电压为零（或电源关）时屏上是一个光点，用水平位移和 CH2 位移把它调到屏幕中心。</p>',
        check: () => s.power && s.mode === 'XY' && Math.abs(s.xpos) < 0.3 && Math.abs(s.ch[1].pos) < 0.3 && s.ch.every((c) => c.cpl !== 'GND' && c.var >= 0.999),
        auto: async () => { await app.view('示波器'); await this.scope((x) => { x.power = true; x.inten = 0.6; x.focus = 0.5; x.mode = 'XY'; x.xpos = 0; x.ch[0].pos = 0; x.ch[1].pos = 0; x.ch.forEach((c) => { c.cpl = 'DC'; c.var = 1; c.inv = false; }); x.ch[0].vdiv = 7; x.ch[1].vdiv = 2; }, 300); },
      },
      {
        title: '观察回线并退磁（样品 1）',
        html: '<p>打开实验仪电源，选样品 1，把电压调到 2.0 V 左右观察回线，调 VOLTS/DIV 使回线大小合适。然后<b>退磁</b>：电压先调到最大 3.0 V（磁化到饱和），再<b>缓慢、连续地</b>减小到零。回线会一圈圈缩小，最后缩成原点处的光点。</p>',
        hint: '样品开始时带着上次实验留下的剩磁。直接从小电压测，回线会偏向一边，测到的不是基本磁化曲线。',
        check: () => !!this.mats[1].demag,
        status: () => `样品 1 ${this.mats[1].demag ? '已退磁' : '未退磁'}，剩余磁化 ${(Math.abs(this.mats[1].M) / this.mats[1].Ms * 100).toFixed(1)}%`,
        auto: async () => {
          const h = this.hys; app.select(h.comp); h.on = true; h.sample = 1; app.changed();
          await this.setU(2.0); await this.fit(); await app.wait(400);
          await this.demag();
        },
      },
      {
        title: '测基本磁化曲线（样品 1）',
        html: '<p>电压从 0.3 V 起逐点增大（0.3、0.5、0.7、0.9、1.1、1.4、1.7、2.0 V…），每点记录回线顶点的坐标。中途不能把电压调小，否则要重新退磁。电压大了回线可能出屏，就把 VOLTS/DIV 调大（档位会自动记入表格）。</p>',
        check: () => rows('curve', 1).length >= 6,
        auto: async () => {
          app.showTable(0);
          for (const U of [0.3, 0.5, 0.7, 0.9, 1.1, 1.4, 1.7, 2.0]) { await this.setU(U, 300); await this.fit(); await app.record('curve'); }
        },
      },
      {
        title: '测磁滞回线（样品 1）',
        html: '<p>电压 1.8 V（样品已接近饱和）。读出回线顶点坐标 Xₘ、Yₘ，回线与 X 轴的两个交点（间距的一半为 X_c，对应矫顽力 H_c），与 Y 轴的两个交点（间距的一半为 Yᵣ，对应剩磁 Bᵣ）。</p>',
        check: () => rows('loop', 1).length >= 1,
        auto: async () => { await this.setU(1.8); await this.fit(); app.showTable(1); await app.record('loop'); },
      },
      {
        title: '换样品 2，退磁后测回线',
        html: '<p>电压调到零，换样品 2。先退磁，再在 1.8 V 下测回线参数，与样品 1 比较。（有时间可以再测样品 2 的基本磁化曲线。）</p>',
        check: () => rows('loop', 2).length >= 1,
        auto: async () => {
          await this.setU(0, 300);
          const h = this.hys; app.select(h.comp); h.sample = 2; app.changed(); await app.wait(200);
          await this.demag();
          await this.setU(1.8); await this.fit(); app.showTable(1); await app.record('loop');
          await this.setU(0, 300); h.on = false; app.changed();
        },
      },
      {
        title: '数据处理',
        html: '<p>把格数换算成 H、B，作基本磁化曲线和 μ–H 曲线，求最大磁导率；由回线求两种样品的 Bₘ、Bᵣ、H_c 并比较。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const app = this.app;
    const H = (r, X) => (N1 * X * r.vx) / (LEN * R1), B = (r, Y) => (R2 * C2 * Y * r.vy * 1e-3) / (N2 * S);
    const cur = app.table('curve').completeRows(), lp = app.table('loop').completeRows();
    if (!cur.length && !lp.length) return { html: '<p>请先测基本磁化曲线或磁滞回线。</p>', ok: false };
    let html = `<p>换算系数：$\\dfrac{N_1}{lR_1}=${(N1 / (LEN * R1)).toFixed(1)}$ A·m⁻¹/V，$\\dfrac{R_2C}{N_2S}=${((R2 * C2) / (N2 * S)).toFixed(2)}$ T/V。</p>`;
    const plots = [], answers = [];
    const c1 = cur.filter((r) => r.smp === 1);
    if (c1.length >= 3) {
      const pts = c1.map((r) => ({ H: H(r, r.X), B: B(r, r.Y) })).sort((a, b) => a.H - b.H);
      const mus = pts.map((p) => p.B / (MU0 * p.H)), im = mus.indexOf(Math.max(...mus));
      html += `<h3>1. 基本磁化曲线（样品 1）</h3><table><tr><th>H/(A/m)</th>${pts.map((p) => `<td>${p.H.toFixed(1)}</td>`).join('')}</tr><tr><th>B/T</th>${pts.map((p) => `<td>${p.B.toFixed(4)}</td>`).join('')}</tr><tr><th>μᵣ</th>${mus.map((m) => `<td>${m.toFixed(0)}</td>`).join('')}</tr></table>
        <p>测量范围内最大相对磁导率 $\\mu_{r,\\max}\\approx${mus[im].toFixed(0)}$（H ≈ ${pts[im].H.toFixed(0)} A/m）。H 继续增大时 B 趋于饱和，μ 下降。</p>`;
      answers.push({ label: '$\\mu_{r,\\max}$（样品 1）', unit: '', value: mus[im], digits: 0, tolRel: 0.02 });
      plots.push({ title: '基本磁化曲线 B–H（样品 1）', xLabel: 'H / (A/m)', yLabel: 'B / T', series: [{ type: 'line', data: [[0, 0], ...pts.map((p) => [p.H, p.B])] }, { type: 'scatter', data: pts.map((p) => [p.H, p.B]) }] });
      plots.push({ title: 'μᵣ–H（样品 1）', xLabel: 'H / (A/m)', yLabel: 'μᵣ', series: [{ type: 'line', data: pts.map((p, i) => [p.H, mus[i]]) }, { type: 'scatter', data: pts.map((p, i) => [p.H, mus[i]]) }] });
    }
    const tail = [];
    const res = {};
    for (const smp of [1, 2]) {
      const r = lp.filter((x) => x.smp === smp).pop();
      if (!r) continue;
      const Hc = H(r, r.Xc), Br = B(r, r.Yr), Bm = B(r, r.Ym), Hm = H(r, r.Xm);
      res[smp] = { Hc, Br, Bm };
      html += `<h3>${smp === 1 ? 2 : 3}. 磁滞回线（样品 ${smp}，U = ${r.U.toFixed(2)} V）</h3>
        <p>X 档 ${fmtV(r.vx)}/div，Y 档 ${fmtV(r.vy / 1000)}/div。顶点 $X_m=${r.Xm.toFixed(2)}$、$Y_m=${r.Ym.toFixed(2)}$ 格，$X_c=${r.Xc.toFixed(2)}$ 格，$Y_r=${r.Yr.toFixed(2)}$ 格。</p>
        <div class="result-box">$H_m=${Hm.toFixed(0)}$ A/m，$B_m=${Bm.toFixed(3)}$ T，$B_r=${Br.toFixed(3)}$ T，$H_c=${Hc.toFixed(1)}$ A/m</div>`;
      answers.push({ label: `$H_c$（样品 ${smp}）`, unit: 'A/m', value: Hc, digits: 1, tolRel: 0.01 }, { label: `$B_r$（样品 ${smp}）`, unit: 'T', value: Br, digits: 3, tolRel: 0.01 });
      if (r._xy) plots.push({ title: `磁滞回线（样品 ${smp}）`, xLabel: 'H / (A/m)', yLabel: 'B / T', series: [{ type: 'line', data: r._xy.map(([x, y]) => [H(r, x), B(r, y)]) }] });
      if (r._t) tail.push(`样品 ${smp} 实际 H_c = ${r._t.Hc.toFixed(1)} A/m（相对误差 ${pct(relErr(Hc, r._t.Hc), 1)}），B_r = ${r._t.Br.toFixed(3)} T（相对误差 ${pct(relErr(Br, r._t.Br), 1)}）`);
    }
    if (res[1] && res[2]) html += `<h3>4. 比较</h3><p>样品 2 的矫顽力约为样品 1 的 ${(res[2].Hc / res[1].Hc).toFixed(1)} 倍，回线更“胖”，每个周期的磁滞损耗（回线面积）更大；样品 1 矫顽力小、磁导率高，更适合做交流铁芯。</p>`;
    if (tail.length) html += `<div class="result-box warn">${tail.join('；')}。偏差来自示波器垂直、水平增益误差（±2%）和读数。</div>`;
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 测量电路</h3>${hysteresisFig()}<p>环形样品上绕初级 $N_1$ 匝、次级 $N_2$ 匝。初级电流 $i_1$ 在样品中产生磁场 $H=N_1i_1/l$，与串联的采样电阻 $R_1$ 上的电压成正比：</p>$$H=\\frac{N_1}{lR_1}U_X$$<p>次级感应电动势 $e_2=N_2S\\,\\mathrm{d}B/\\mathrm{d}t$ 经 $R_2$ 给电容 $C$ 充电。当 $R_2C$ 远大于周期时，$i_2\\approx e_2/R_2$，电容电压</p>$$U_Y=\\frac1C\\int i_2\\,\\mathrm{d}t=\\frac{N_2S}{R_2C}B\\quad\\Rightarrow\\quad B=\\frac{R_2C}{N_2S}U_Y$$<p>把 $U_X$、$U_Y$ 分别加到示波器的 X、Y 输入，屏上就画出 B–H 磁滞回线。</p>
<h3>2. 退磁与基本磁化曲线</h3><p>铁磁材料的状态与历史有关。把交变磁场从饱和值缓慢减小到零，磁化状态沿一圈圈缩小的回线回到原点，这就是退磁。退磁后从小到大逐渐增加磁场，各个回线顶点的连线就是基本磁化曲线，$\\mu=B/(\\mu_0H)$ 先增大后减小。</p>
<h3>3. 回线参数</h3><p>饱和磁感应强度 $B_m$；H 回到零时剩下的剩磁 $B_r$；使 B 降到零所需的反向磁场 —— 矫顽力 $H_c$。$H_c$ 小的软磁材料适合做变压器、电机铁芯，$H_c$ 大的硬磁材料适合做永磁体。回线面积等于每个周期单位体积的磁滞损耗。</p>
<h3>4. 本仿真的计算模型</h3><p>样品的磁化用 Jiles–Atherton 磁滞模型（无磁滞曲线 + 畴壁钉扎的不可逆分量 + 可逆分量）。初级回路由电压驱动：每个时间步隐式求解 $u=(R_1+r)i+N_1S\\,\\mathrm{d}B/\\mathrm{d}t$，所以饱和时电感骤降、电流出现尖峰，X 信号与真实电路一样不是正弦；次级 RC 积分也按电路方程计算。磁化状态在两次调节之间保留，因此会出现剩磁、退磁过程和偏心的局部回线。</p>`;
  }
}
