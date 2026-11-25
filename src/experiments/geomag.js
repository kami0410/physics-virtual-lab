// 实验：地磁场的测量（磁阻传感器法）
// 本地地磁场由世界地磁模型 WMM2025 算出（physics/geomag/，收录自 geomagnetism，Apache-2.0），再叠加约 0.2 μT 的室内干扰（钢筋、仪器）。
// 磁阻传感器输出 U = K·(B·n) + U0：n 为传感器敏感轴方向，K 为灵敏度（个体随机 8–10 mV/μT），U0 为零点偏移。
// 传感器装在亥姆霍兹线圈中心，线圈轴与敏感轴重合，二者一起装在可水平转动（θ）和竖直转动（ψ）的转台上。
// 转台的 0° 刻度线对着任意方位（个体随机），学生要通过测量自己找出磁子午面。
import * as THREE from 'three';
import { meta, thumb } from './geomag.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, gauss, clamp, relErr, pct, propFit } from '../core/Stats.js';
import { geomagField } from '../physics/geomag/index.js';

const MU0 = 1.25663706212e-6, NC = 200, RC = 0.1; // 线圈匝数、半径（m）
const KC = (0.8 ** 1.5 * MU0 * NC) / RC * 1e6 / 1000; // μT/mA
const IS = [5, 10, 15, 20, 25, 30];
const SITES = [[45.75, 126.63], [39.9, 116.4], [31.23, 121.47], [30.59, 114.3], [34.26, 108.94], [23.13, 113.26], [36.06, 103.83], [43.82, 125.32]];
const D2R = Math.PI / 180;

/** 正弦拟合 U = c + a cos x + b sin x（x 为角度，度） */
function sinFit(xs, ys) {
  const n = xs.length, A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
  for (let i = 0; i < n; i++) { const f = [1, Math.cos(xs[i] * D2R), Math.sin(xs[i] * D2R)]; for (let p = 0; p < 3; p++) { r[p] += f[p] * ys[i]; for (let q = 0; q < 3; q++) A[p][q] += f[p] * f[q]; } }
  // 3×3 高斯消元
  for (let k = 0; k < 3; k++) { for (let i = k + 1; i < 3; i++) { const m = A[i][k] / A[k][k]; for (let j = k; j < 3; j++) A[i][j] -= m * A[k][j]; r[i] -= m * r[k]; } }
  const x = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = r[i]; for (let j = i + 1; j < 3; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  const [c, a, b] = x; return { c, a, b, amp: Math.hypot(a, b), ph: ((Math.atan2(b, a) / D2R) + 360) % 360 };
}

export class GeomagExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    const [lat, lon] = SITES[Math.floor(Math.random() * SITES.length)];
    this.site = { lat, lon }; this.model = geomagField(lat, lon, 0.1);
    const m = this.model; this.B = [m.x / 1000 + gauss(0.2), m.y / 1000 + gauss(0.2), m.z / 1000 + gauss(0.2)]; // 北、东、下（μT）
    this.K = rand(8, 10); this.U0 = rand(-6, 6); this.kc = KC * (1 + gauss(0.003));
    this.a0 = rand(0, 360);
    this.power = false; this.th = 0; this.ps = 0; this.I = 0; this.dir = 1;
  }
  /** 磁子午面（磁北）对应的转台读数 */
  thMag() { const decl = Math.atan2(this.B[1], this.B[0]) / D2R; return (((decl - this.a0) % 360) + 360) % 360; }
  U() {
    if (!this.power) return 0;
    const A = (this.a0 + this.th) * D2R, p = this.ps * D2R, n = [Math.cos(p) * Math.cos(A), Math.cos(p) * Math.sin(A), Math.sin(p)];
    const b = this.B[0] * n[0] + this.B[1] * n[1] + this.B[2] * n[2] + this.dir * this.kc * this.I;
    return clamp(this.K * b + this.U0, -1999.9, 1999.9);
  }
  readU() { return Math.round(this.U() * 10) / 10; }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 56, 80], target: [0, 10, -6] }, { name: '转台', pos: [-10, 34, 34], target: [-10, 10, 0] }, { name: '仪表', pos: [22, 28, 28], target: [22, 6, -18] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(140, 86));
    app.stage.setLightTarget(0, 6, 0);
    const base = new THREE.Group(); base.position.set(-10, 0, 0); scene.add(base);
    base.add(mesh(new THREE.CylinderGeometry(11, 12, 2, 48), MAT.paint(0x8b7d6b), 0, 1, 0));
    // 水平刻度盘
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; const c = cv.getContext('2d');
    c.fillStyle = '#efe9d6'; c.beginPath(); c.arc(256, 256, 256, 0, 7); c.fill(); c.strokeStyle = '#222'; c.fillStyle = '#222'; c.font = 'bold 26px Consolas'; c.textAlign = 'center';
    for (let d = 0; d < 360; d++) { const t = (d - 90) * D2R, l = d % 10 === 0 ? 34 : d % 5 === 0 ? 22 : 12; c.lineWidth = d % 10 === 0 ? 2 : 1; c.beginPath(); c.moveTo(256 + 250 * Math.cos(t), 256 + 250 * Math.sin(t)); c.lineTo(256 + (250 - l) * Math.cos(t), 256 + (250 - l) * Math.sin(t)); c.stroke(); if (d % 30 === 0) c.fillText(String(d), 256 + 196 * Math.cos(t), 256 + 196 * Math.sin(t) + 9); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const dial = new THREE.Mesh(new THREE.CircleGeometry(11, 64), new THREE.MeshBasicMaterial({ map: tex })); dial.rotation.x = -Math.PI / 2; dial.position.y = 2.02; base.add(dial);
    this.yaw = new THREE.Group(); this.yaw.position.y = 2; base.add(this.yaw);
    this.yaw.add(mesh(new THREE.BoxGeometry(18, 0.8, 3), MAT.paint(0x3a3f44), 0, 0.4, 0));
    this.yaw.add(mesh(new THREE.BoxGeometry(0.4, 0.2, 10.5), MAT.paint(0xb91c1c), 0, 0.9, -5.5));
    for (const x of [-8, 8]) this.yaw.add(mesh(new THREE.BoxGeometry(1.2, 12, 2), MAT.paint(0x56606c), x, 6.8, 0));
    this.tilt = new THREE.Group(); this.tilt.position.y = 12; this.yaw.add(this.tilt);
    const ring = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.7, roughness: 0.35 });
    for (const z of [-2.5, 2.5]) { const r = mesh(new THREE.TorusGeometry(5, 0.55, 12, 48), ring, 0, 0, z); this.tilt.add(r); }
    const sensor = mesh(new THREE.BoxGeometry(1.2, 1.2, 3), MAT.paint(0x1d3557), 0, 0, 0); this.tilt.add(sensor);
    this.tilt.add(mesh(new THREE.ConeGeometry(0.5, 1.2, 12), MAT.paint(0xb91c1c), 0, 0, -2.1).rotateX(-Math.PI / 2));
    for (const x of [-7.4, 7.4]) { const ax = mesh(new THREE.CylinderGeometry(0.35, 0.35, 2, 10), MAT.chrome(), x * 0.92, 0, 0); ax.rotation.z = Math.PI / 2; this.tilt.add(ax); }
    app.addComponent(new Component({
      key: 'stage', name: '传感器与转台', zone: 'none', fixed: true, required: true, object: base, labelY: 22,
      icon: '<svg viewBox="0 0 64 40"><circle cx="32" cy="20" r="14" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M32 20L42 9" stroke="currentColor" stroke-width="2.2"/><path d="M24 20h16" stroke="currentColor"/></svg>',
      desc: `磁阻传感器（坡莫合金薄膜电桥）装在亥姆霍兹线圈中心，敏感轴（红色箭头）与线圈轴重合。线圈 N = ${NC} 匝，半径 R = ${RC * 100} cm，中心磁场 B = (4/5)<sup>3/2</sup>μ<sub>0</sub>NI/R。转台可绕竖直轴转动（水平角 θ，刻度盘分度 1°），线圈架可绕水平轴转动（俯仰角 ψ，ψ = 90° 时敏感轴竖直向下）。测量时附近不要放铁磁物体。`,
      controls: () => [
        { type: 'knob', label: '水平角 θ', get: () => this.th, set: (v) => { this.th = ((Math.round(v) % 360) + 360) % 360; app.changed(); }, min: 0, max: 359, step: 1, bigStep: 10, perRev: 30, digits: 0, unit: '°', wrap: true },
        { type: 'knob', label: '俯仰角 ψ', get: () => this.ps, set: (v) => { this.ps = ((Math.round(v) % 360) + 360) % 360; app.changed(); }, min: 0, max: 359, step: 1, bigStep: 10, perRev: 30, digits: 0, unit: '°', wrap: true },
      ],
    }));
    const box = new THREE.Group(); box.position.set(22, 0, -18);
    box.add(mesh(new THREE.BoxGeometry(46, 12, 16), MAT.paint(0xd6d3cb), 0, 6, 0));
    const mu = (this.uBox = meterBox(18, 9, 1, '传感器输出')); mu.group.position.set(-11, 1.6, 7.6); box.add(mu.group);
    const mi = (this.iBox = meterBox(18, 9, 1, '线圈电流')); mi.group.position.set(11, 1.6, 7.6); box.add(mi.group);
    app.addComponent(new Component({
      key: 'meter', name: '地磁场测量仪', zone: 'none', fixed: true, object: box, labelY: 16,
      desc: '给传感器电桥供电并放大其输出（数字电压表分辨 0.1 mV）；线圈恒流源 0–30 mA，可换向。',
      controls: () => [
        { type: 'toggle', label: '电源', get: () => this.power, set: (v) => { this.power = v; app.changed(); } },
        { type: 'knob', label: '线圈电流', get: () => this.I, set: (v) => { this.I = Math.round(clamp(v, 0, 30) * 100) / 100; app.changed(); }, min: 0, max: 30, step: 0.01, bigStep: 1, perRev: 5, digits: 2, unit: 'mA' },
        { type: 'segment', label: '电流方向', options: [{ value: 1, label: '正向' }, { value: -1, label: '反向' }], get: () => this.dir, set: (v) => { this.dir = v; app.changed(); } },
        { type: 'readout', label: '传感器输出', get: () => (this.power ? `${this.readU().toFixed(1)} mV` : '电源未开') },
      ],
    }));
  }
  update() {
    this.yaw.rotation.y = -this.th * D2R; this.tilt.rotation.x = -this.ps * D2R;
    const on = this.power, sU = on ? this.readU().toFixed(1) : '', sI = on ? this.I.toFixed(2) + this.dir : '';
    if (sU !== this._sU) { this._sU = sU; this.uBox.setText(sU, on ? 'mV' : '', on ? `θ ${this.th}°  ψ ${this.ps}°` : ''); }
    if (sI !== this._sI) { this._sI = sI; this.iBox.setText(on ? this.I.toFixed(2) : '', on ? 'mA' : '', on ? (this.dir > 0 ? '正向' : '反向') : ''); }
  }

  // ======================= 数据表 =======================
  tables() {
    const tol = 0.2;
    return [
      {
        id: 'cal', title: '定标：线圈电流与传感器输出', fixedRows: true,
        initRows: () => IS.map((I) => ({ I })),
        columns: [{ key: 'I', label: 'I/mA', digits: 2, readonly: true }, { key: 'Up', label: '正向 U₊/mV', digits: 1, readTol: tol }, { key: 'Un', label: '反向 U₋/mV', digits: 1, readTol: tol }, { key: 'dU', label: '(U₊−U₋)/2 /mV', digits: 2, calc: (r) => (r.Up - r.Un) / 2 }],
        buttons: [{ label: '记录传感器输出', onClick: (t) => this.recCal(t) }],
        note: '转台位置不变，线圈电流依次取表中各值，正、反向各读一次。两次读数之差的一半只含线圈的磁场，地磁场和零点偏移都消去了。',
      },
      {
        id: 'h', title: '水平面内转动（ψ = 0°，线圈电流为 0）', maxRows: 24,
        columns: [{ key: 'th', label: 'θ/°', digits: 0, auto: true }, { key: 'U', label: 'U/mV', digits: 1, readTol: tol }],
        buttons: [{ label: '记录', onClick: (t) => this.recH(t) }],
        note: '俯仰角为 0，敏感轴水平。转台每转 30° 记一次输出，转满一周。输出最大的方向就是磁北（磁子午面）。',
      },
      {
        id: 'v', title: '磁子午面内转动（线圈电流为 0）', maxRows: 24,
        columns: [{ key: 'th', label: 'θ/°', digits: 0, auto: true }, { key: 'ps', label: 'ψ/°', digits: 0, auto: true }, { key: 'U', label: 'U/mV', digits: 1, readTol: tol }],
        buttons: [{ label: '记录', onClick: (t) => this.recV(t) }],
        note: '把转台转到上一步找到的磁北方向，然后改变俯仰角，每 30° 记一次，转满一周。',
      },
    ];
  }
  recCal(t) {
    const a = this.app;
    if (!this.power) return a.toast('电源没开', 'warn');
    const i = t.rows.findIndex((r) => Math.abs(r.I - this.I) < 0.005);
    if (i < 0) return a.toast(`线圈电流 ${this.I.toFixed(2)} mA 不在表中，调到 ${IS.join('、')} mA 之一`, 'warn');
    const r = t.rows[i];
    if (r._pose && (r._pose !== `${this.th},${this.ps}`)) return a.toast('转台位置和这一行另一个方向的读数不同：正、反向要在同一位置读', 'warn');
    t.rows[i]._pose = `${this.th},${this.ps}`;
    t.set(i, this.dir > 0 ? 'Up' : 'Un', this.readU());
  }
  recH(t) {
    const a = this.app;
    if (!this.power) return a.toast('电源没开', 'warn');
    if (this.I > 0) return a.toast('测地磁场时线圈电流要为 0', 'warn');
    if (this.ps !== 0) return a.toast('俯仰角不为 0：敏感轴不水平', 'warn');
    if (t.rows.some((r) => r.th === this.th)) return a.toast('这个角度已经记过了', 'warn');
    t.addRow({ th: this.th, U: this.readU() });
  }
  recV(t) {
    const a = this.app;
    if (!this.power) return a.toast('电源没开', 'warn');
    if (this.I > 0) return a.toast('测地磁场时线圈电流要为 0', 'warn');
    if (t.rows.length && t.rows[0].th !== this.th) return a.toast('水平角和第一行不同：这张表要在同一个竖直面内转动', 'warn');
    if (t.rows.some((r) => r.ps === this.ps)) return a.toast('这个俯仰角已经记过了', 'warn');
    t.addRow({ th: this.th, ps: this.ps, U: this.readU() });
  }

  // ======================= 自动操作 =======================
  async adj(comp, key, to, ms = 300) { const a = this.app; a.select(a.comp(comp)); await a.tween(() => this[key], (v) => (this[key] = v), to, ms); this[key] = to; a.changed(); await a.wait(80); }
  async flag(comp, key, v) { const a = this.app; a.select(a.comp(comp)); this[key] = v; a.renderInspector(); a.changed(); await a.wait(120); }
  /** 角度旋钮走最近的方向 */
  async turn(key, to) { let d = to - this[key]; d = ((d + 540) % 360) - 180; const from = this[key]; await this.app.tween(() => 0, (v) => (this[key] = (((Math.round(from + v)) % 360) + 360) % 360), d, 300); this[key] = to; this.app.changed(); await this.app.wait(80); }
  steps() {
    const app = this.app, rows = (id) => app.table(id).completeRows();
    return [
      {
        title: '定标传感器的灵敏度',
        html: '<p>打开测量仪电源，转台、俯仰角不动。线圈电流依次取 5、10 … 30 mA，每个电流正、反向各读一次传感器输出。</p>',
        hint: '线圈中心磁场 B = 0.7155 μ₀NI/R，约 1.8 μT/mA。传感器输出对它的斜率就是灵敏度 K。',
        status: () => `已完成 ${rows('cal').length} 个电流`,
        check: () => rows('cal').length >= 4,
        diagnose: () => (!this.power ? [{ msg: '测量仪电源没开。', fix: { label: '打开', run: async () => { this.power = true; } } }] : []),
        auto: async () => {
          app.showTable(0); await app.view('全景');
          if (!this.power) await this.flag('meter', 'power', true);
          for (const I of IS) {
            const r = app.table('cal').rows.find((x) => x.I === I);
            for (const d of [1, -1]) {
              if (typeof r[d > 0 ? 'Up' : 'Un'] === 'number') continue;
              if (r._pose) { const [th, ps] = r._pose.split(',').map(Number); if (th !== this.th) { app.select(app.comp('stage')); await this.turn('th', th); } if (ps !== this.ps) { app.select(app.comp('stage')); await this.turn('ps', ps); } }
              if (this.dir !== d) await this.flag('meter', 'dir', d);
              await this.adj('meter', 'I', I, 250); await app.record('cal', 0);
            }
          }
          await this.adj('meter', 'I', 0, 250);
        },
      },
      {
        title: '水平面内测量',
        html: '<p>线圈电流调到 0，俯仰角 ψ = 0°（敏感轴水平）。转台从 0° 起每转 30° 记一次传感器输出，共 12 个点。</p>',
        hint: '输出最大的方向是磁北，最小的方向是磁南，二者之差的一半除以 K 就是水平分量。',
        status: () => `已记录 ${rows('h').length} 个方向`,
        check: () => rows('h').length >= 8,
        diagnose: () => (this.I > 0 ? [{ msg: '线圈电流不为 0。', fix: { label: '调到 0', run: async () => { this.I = 0; } } }] : this.ps !== 0 ? [{ msg: '俯仰角不为 0。', fix: { label: '调到 0°', run: async () => { this.ps = 0; } } }] : []),
        auto: async () => {
          app.showTable(1); await app.view('转台');
          if (!this.power) await this.flag('meter', 'power', true);
          if (this.I) await this.adj('meter', 'I', 0, 250);
          app.select(app.comp('stage')); if (this.ps) await this.turn('ps', 0);
          for (let th = 0; th < 360; th += 30) { if (rows('h').some((r) => r.th === th)) continue; app.select(app.comp('stage')); await this.turn('th', th); await app.record('h', 0); }
        },
      },
      {
        title: '磁子午面内测量',
        html: '<p>把转台转到输出最大的方向（磁北），使敏感轴的转动平面就是磁子午面。俯仰角从 0° 起每转 30° 记一次输出（ψ = 90° 时敏感轴竖直向下），共 12 个点。</p>',
        hint: '磁北方向可以用上一步数据的正弦拟合求出，精确到 1°。转动平面偏离磁子午面，测得的总强度偏小、磁倾角偏大。',
        status: () => (rows('v').length ? `θ = ${rows('v')[0].th}°，已记录 ${rows('v').length} 个俯仰角` : '还没有记录'),
        check: () => rows('v').length >= 8,
        diagnose: () => { const r = rows('v'); const d = r.length ? Math.abs(((r[0].th - this.thMag() + 540) % 360) - 180) : 0; return d > 3 ? [{ msg: `转动平面偏离磁子午面约 ${d.toFixed(0)}°。清空表格，把转台转到输出最大的方向再测。` }] : []; },
        auto: async () => {
          app.showTable(2); await app.view('转台');
          if (!this.power) await this.flag('meter', 'power', true);
          if (this.I) await this.adj('meter', 'I', 0, 250);
          const t0 = rows('v')[0]?.th ?? Math.round(this.thMag()) % 360;
          app.select(app.comp('stage')); await this.turn('th', t0);
          for (let ps = 0; ps < 360; ps += 30) { if (rows('v').some((r) => r.ps === ps)) continue; app.select(app.comp('stage')); await this.turn('ps', ps); await app.record('v', 0); }
          await this.turn('ps', 0);
        },
      },
      {
        title: '数据处理',
        html: '<p>由定标数据求灵敏度 $K$；对两组转动数据作正弦拟合 $U=U_0+A\\cos(x-x_0)$，由振幅求地磁场的水平分量和总强度，由相位求磁倾角。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, C = a.table('cal').completeRows(), H = a.table('h').completeRows(), V = a.table('v').completeRows();
    if (C.length < 2) return { html: '<p>请先完成至少两个电流的定标（正、反向都要测）。</p>', ok: false };
    const m = this.model, Hm = m.h / 1000, Fm = m.f / 1000, Im = m.incl;
    const pf = propFit(C.map((r) => KC * r.I), C.map((r) => (r.Up - r.Un) / 2)), K = pf.k;
    let html = `<h3>1. 定标</h3><p>线圈中心磁场 $B=\\left(\\frac45\\right)^{3/2}\\dfrac{\\mu_0NI}{R}=${KC.toFixed(4)}$ μT/mA × $I$。$(U_+-U_-)/2$ 对 $B$ 作过原点直线：</p><div class="result-box">灵敏度 $K=${K.toFixed(4)}$ mV/μT</div>`;
    const answers = [{ label: '传感器灵敏度 $K$', unit: 'mV/μT', value: K, digits: 4, tolRel: 0.01 }], plots = [{ title: '定标直线', xLabel: 'B / μT', yLabel: '(U₊−U₋)/2 / mV', series: [{ type: 'scatter', data: C.map((r) => [KC * r.I, (r.Up - r.Un) / 2]), label: '实验点' }, { type: 'line', data: [0, KC * 32].map((b) => [b, K * b]), label: '拟合' }] }];
    let Bh = null;
    if (H.length >= 4) {
      const f = sinFit(H.map((r) => r.th), H.map((r) => r.U)); Bh = f.amp / K;
      html += `<h3>2. 水平分量</h3><p>水平面内 $U=U_0+KB_\\parallel\\cos(\\theta-\\theta_0)$。拟合得振幅 ${f.amp.toFixed(2)} mV，零点偏移 $U_0$ = ${f.c.toFixed(2)} mV，输出最大的方向 $\\theta_0$ = ${f.ph.toFixed(1)}°（磁北）。</p>
        <div class="result-box">$B_\\parallel=${Bh.toFixed(2)}$ μT</div><p>世界地磁模型 WMM2025 给出本地（北纬 ${this.site.lat.toFixed(1)}°，东经 ${this.site.lon.toFixed(1)}°）的水平分量 ${Hm.toFixed(2)} μT，相对误差 ${pct(relErr(Bh, Hm))}。</p>`;
      answers.push({ label: '地磁场水平分量 $B_\\parallel$', unit: 'μT', value: Bh, digits: 2, tolRel: 0.01 });
      plots.push({ title: '水平面内 U – θ', xLabel: 'θ / °', yLabel: 'U / mV', series: [{ type: 'scatter', data: H.map((r) => [r.th, r.U]), label: '实验点' }, { type: 'line', data: Array.from({ length: 73 }, (_, i) => [i * 5, f.c + f.a * Math.cos(i * 5 * D2R) + f.b * Math.sin(i * 5 * D2R)]), label: '正弦拟合' }] });
    }
    if (V.length >= 4) {
      const f = sinFit(V.map((r) => r.ps), V.map((r) => r.U)), F = f.amp / K, inc = f.ph > 180 ? f.ph - 360 : f.ph;
      html += `<h3>3. 总强度与磁倾角</h3><p>在磁子午面内（θ = ${V[0].th}°）$U=U_0+KB\\cos(\\psi-\\beta)$，$\\psi=\\beta$ 时敏感轴沿地磁场方向。拟合得振幅 ${f.amp.toFixed(2)} mV，最大输出方向 ${inc.toFixed(1)}°。</p>
        <div class="result-box">地磁场总强度 $B=${F.toFixed(2)}$ μT，磁倾角 $\\beta=${inc.toFixed(1)}°$，垂直分量 $B_\\perp=B\\sin\\beta=${(F * Math.sin(inc * D2R)).toFixed(2)}$ μT</div>
        <p>WMM2025 模型值：总强度 ${Fm.toFixed(2)} μT（相对误差 ${pct(relErr(F, Fm))}），磁倾角 ${Im.toFixed(1)}°（相差 ${(inc - Im).toFixed(1)}°）。${Bh ? `由水平分量和磁倾角也可算总强度：$B_\\parallel/\\cos\\beta$ = ${(Bh / Math.cos(inc * D2R)).toFixed(2)} μT。` : ''}剩下的差别来自室内的钢筋、铁器和电器（约零点几微特）。</p>`;
      answers.push({ label: '地磁场总强度 $B$', unit: 'μT', value: F, digits: 2, tolRel: 0.01 }, { label: '磁倾角 $\\beta$', unit: '°', value: inc, digits: 1, tolAbs: 0.5 });
      plots.push({ title: '磁子午面内 U – ψ', xLabel: 'ψ / °', yLabel: 'U / mV', series: [{ type: 'scatter', data: V.map((r) => [r.ps, r.U]), label: '实验点' }, { type: 'line', data: Array.from({ length: 73 }, (_, i) => [i * 5, f.c + f.a * Math.cos(i * 5 * D2R) + f.b * Math.sin(i * 5 * D2R)]), label: '正弦拟合' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 地磁场</h3><p>地球的磁场近似于一个偶极子的磁场，在地面某点可以用三个要素描述：水平分量 $B_\\parallel$、磁倾角 $\\beta$（磁场与水平面的夹角，北半球向下为正）和磁偏角（磁子午面与地理子午面的夹角）。总强度 $B=B_\\parallel/\\cos\\beta$，垂直分量 $B_\\perp=B_\\parallel\\tan\\beta$。我国境内地磁场总强度约 45–60 μT，磁倾角约 30°–65°。</p>
<h3>2. 磁阻传感器</h3><p>坡莫合金薄膜的电阻随磁化方向与电流方向的夹角变化（各向异性磁阻效应）。四个磁阻组成惠斯通电桥，外磁场沿敏感轴的分量使电桥失去平衡，输出电压 $U=KB\\cos\\theta+U_0$，$\\theta$ 为磁场与敏感轴的夹角，$K$ 为灵敏度，$U_0$ 为零点偏移。</p>
<h3>3. 定标</h3><p>传感器放在亥姆霍兹线圈中心，线圈轴沿敏感轴，中心磁场 $B=\\left(\\frac45\\right)^{3/2}\\dfrac{\\mu_0NI}{R}$。电流正、反向各测一次，$\\dfrac{U_+-U_-}{2}=KB$，地磁场和零点偏移都消去。</p>
<h3>4. 测量</h3><p>敏感轴在水平面内转一周，输出按余弦变化，振幅 $KB_\\parallel$；在磁子午面内转一周，振幅 $KB$，最大输出的方向与水平面的夹角就是磁倾角。用全周的数据作正弦拟合，比只读最大、最小值更准，也自动消去零点偏移。</p>
<h3>5. 本仿真的计算模型</h3><p>本地地磁场由世界地磁模型 WMM2025 计算（球谐系数由美国 NOAA/NCEI 与英国地质调查局发布，计算程序收录自开源项目 geomagnetism），再叠加约 0.2 μT 的室内干扰。传感器灵敏度、零点偏移、转台 0° 刻度的方位、线圈常数的微小偏差都个体随机。</p>`;
  }
}
