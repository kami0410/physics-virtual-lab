// 实验：蛇摆的设计与制作
// 15 个双线摆排成一排，摆长按“在 Γ = 60 s 内，第 k 个摆比第 0 个多摆 k 次”设计。同时放开后，
// 相邻摆的相位差随时间均匀增大：先成蛇形，t = Γ/m 时分成 m 列，t = Γ 时重新排成一列。
// 各摆按 θ'' = −(g/L)sinθ − 2γθ' 积分（RK4，步长 ≤ 5 ms），计入大摆角使周期变长与很小的空气阻尼。
// 实际摆长 = 调节时米尺读出的长度 + 每个摆的小偏差（读数、球心位置的误差，约 0.3 mm）。
import * as THREE from 'three';
import { meta, thumb } from './snake.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { Stopwatch } from '../core/gauges.js';
import { mean, gauss, rand, clamp, relErr, pct } from '../core/Stats.js';

const NP = 15, GAMMA = 60, N0 = 51, GLOC = 9.794;
const Y0 = 52, DX = 4; // 悬点高度、摆间距（cm）
const DEG = Math.PI / 180;
const PATS = [{ m: 3, name: '分成三列' }, { m: 2, name: '分成两列' }, { m: 1, name: '重新排成一列' }];
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;
const Ldesign = (k) => GLOC * (GAMMA / (2 * Math.PI * (N0 + k))) ** 2 * 1000; // mm

export class SnakePendulumExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.Lset = Array.from({ length: NP }, () => +rand(280, 300).toFixed(1)); // 出厂时各摆长度大致相同（mm）
    this.bias = Array.from({ length: NP }, () => gauss(0.25));
    this.gam = rand(0.0015, 0.0025); // 阻尼（1/s）
    this.th = new Float64Array(NP); this.om = new Float64Array(NP);
    this.sel = 0; this.amp = 8; this.t = 0; this.moving = false; this.stopAt = null;
    this.sw = new Stopwatch();
  }
  L(k) { return (this.Lset[k] + this.bias[k]) / 1000; } // m
  /** 米尺读数（mm，估读到 0.5 mm） */
  ruler(k) { return Math.round(this.Lset[k] * 2) / 2; }
  /** 第 k 个摆在当前摆角下的周期（AGM 精确式） */
  period(k, a = this.amp * DEG) { let x = 1, y = Math.cos(a / 2); for (let i = 0; i < 8; i++) [x, y] = [(x + y) / 2, Math.sqrt(x * y)]; return (2 * Math.PI * Math.sqrt(this.L(k) / GLOC)) / x; }
  release(only = null) {
    for (let k = 0; k < NP; k++) { this.th[k] = only == null || only === k ? this.amp * DEG : 0; this.om[k] = 0; }
    this.t = 0; this.moving = true; this.app.changed();
  }
  halt() { this.th.fill(0); this.om.fill(0); this.moving = false; this.app.changed(); }
  step(h) {
    const th = this.th, om = this.om, g = this.gam;
    for (let k = 0; k < NP; k++) {
      const w2 = GLOC / this.L(k), a = (x, v) => -w2 * Math.sin(x) - 2 * g * v;
      const x = th[k], v = om[k];
      const k1x = v, k1v = a(x, v), k2x = v + (h / 2) * k1v, k2v = a(x + (h / 2) * k1x, k2x), k3x = v + (h / 2) * k2v, k3v = a(x + (h / 2) * k2x, k3x), k4x = v + h * k3v, k4v = a(x + h * k3x, k4x);
      th[k] = x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x); om[k] = v + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    }
    this.t += h;
  }
  advance(T) {
    while (T > 1e-12) {
      let h = Math.min(T, 0.005);
      if (this.stopAt != null && this.sw.run) { const left = this.stopAt - this.sw.t; if (left <= 1e-9) { this.sw.stop(); this.stopAt = null; } else h = Math.min(h, left); }
      if (this.moving) this.step(h);
      this.sw.tick(h); T -= h;
    }
    if (this.stopAt != null && this.sw.run && this.sw.t >= this.stopAt - 1e-9) { this.sw.stop(); this.stopAt = null; }
  }
  tick(dt) {
    const a = this.app, T = Math.min(1, dt * (a.running ? a.speed * 4 : 1));
    if (!this.moving && !this.sw.run) return;
    this.advance(T); a.changed();
  }

  // ======================= 场景 =======================
  xk(k) { return -((NP - 1) * DX) / 2 + k * DX; }
  cameras() { return [{ name: '全景', pos: [0, 62, 92], target: [0, 32, 0] }, { name: '俯视', pos: [0, 108, 14], target: [0, 20, 0] }, { name: '正面', pos: [0, 34, 70], target: [0, 34, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(120, 80));
    app.stage.setLightTarget(0, 20, 0);
    const g = new THREE.Group(), alu = MAT.alu(), dark = MAT.paint(0x2b3440);
    g.add(mesh(new THREE.BoxGeometry(72, 1.6, 22), dark, 0, 0.8, 0));
    for (const x of [-35, 35]) g.add(mesh(new THREE.BoxGeometry(2, Y0, 2), alu, x, Y0 / 2, 0));
    g.add(mesh(new THREE.BoxGeometry(72, 1.6, 3), alu, 0, Y0 + 0.8, 0));
    this.balls = []; this.strings = [];
    const smat = new THREE.LineBasicMaterial({ color: 0x9aa5ab });
    for (let k = 0; k < NP; k++) {
      const b = mesh(new THREE.SphereGeometry(1.2, 18, 14), k === this.sel ? MAT.paint(0xc41e3a) : MAT.chrome()); g.add(b); this.balls.push(b);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      const l = new THREE.LineSegments(geo, smat); l.userData.noHL = true; g.add(l); this.strings.push(l);
    }
    app.addComponent(new Component({
      key: 'frame', name: '蛇摆架', zone: 'none', fixed: true, required: true, object: g, labelY: Y0 + 7,
      icon: SVG('<path d="M6 6 H58" stroke="currentColor" stroke-width="2"/>' + Array.from({ length: 7 }, (_, i) => `<path d="M${10 + i * 7.3} 6 V${32 - i * 2.5}" stroke="currentColor"/><circle cx="${10 + i * 7.3}" cy="${32 - i * 2.5}" r="2" fill="currentColor"/>`).join('')),
      desc: `15 个钢球（直径 24 mm）用双线挂在横梁上，相邻两摆相距 ${DX} cm，只能在垂直于横梁的平面内摆动。每个摆的线长可以用横梁上的绕线轴调节，摆长（悬点到球心）用钢尺量，估读到 0.5 mm。本地 g = ${GLOC} m/s²。`,
      controls: () => [
        { type: 'knob', label: '选择第几个摆（0 为最长的）', get: () => this.sel, set: (v) => { this.sel = clamp(Math.round(v), 0, NP - 1); this.paintSel(); app.changed(); }, min: 0, max: NP - 1, step: 1, bigStep: 1, perRev: 5, digits: 0 },
        { type: 'knob', label: '调这个摆的摆长', get: () => this.Lset[this.sel], set: (v) => { this.Lset[this.sel] = Math.round(clamp(v, 150, 400) * 10) / 10; app.changed(); }, min: 150, max: 400, step: 0.1, bigStep: 1, perRev: 10, fmt: () => '看钢尺读数' },
        { type: 'readout', label: '钢尺读数（悬点到球心）', get: () => `第 ${this.sel} 个摆：${this.ruler(this.sel).toFixed(1)} mm` },
        { type: 'knob', label: '释放时的摆角', get: () => this.amp, set: (v) => { this.amp = clamp(v, 3, 20); app.changed(); }, min: 3, max: 20, step: 0.5, bigStep: 1, perRev: 5, digits: 1, unit: '°' },
        { type: 'button', label: '用挡板拉开全部摆，同时放开', onClick: () => this.release() },
        { type: 'button', label: '只拉开选中的摆并放开', onClick: () => this.release(this.sel) },
        { type: 'button', label: '让所有摆停下', onClick: () => this.halt() },
      ],
    }));
    const sb = (this.swBox = meterBox(12, 5, 8, '秒表')); sb.group.position.set(44, 0, 20);
    app.addComponent(new Component({
      key: 'sw', name: '秒表', zone: 'none', fixed: true, object: sb.group, labelY: 9,
      desc: '电子秒表，分辨 0.01 s。人按秒表的反应时间约 0.1–0.2 s，判断“排成一列”的时刻也有误差。',
      controls: () => [
        { type: 'button', label: '开始', onClick: () => { this.sw.start(Math.abs(gauss(0.08))); app.changed(); } },
        { type: 'button', label: '停止', onClick: () => { this.sw.stop(Math.abs(gauss(0.08))); app.changed(); } },
        { type: 'button', label: '清零', onClick: () => { this.sw.reset(); app.changed(); } },
        { type: 'readout', label: '读数', get: () => this.sw.shown },
      ],
    }));
    this.tv = app.addView({ id: 'top', title: '俯视：摆球的位置（侧向位移放大 2 倍）', w: 360, h: 220, res: 1.4 });
  }
  paintSel() { this._mr = this._mr || MAT.paint(0xc41e3a); this._mc = this._mc || this.balls[NP - 1 === this.sel ? 0 : NP - 1].material; this.balls.forEach((b, k) => { b.material = k === this.sel ? this._mr : this._mc; }); }
  update() {
    for (let k = 0; k < NP; k++) {
      const L = this.L(k) * 100, x = this.xk(k), y = Y0 - L * Math.cos(this.th[k]), z = L * Math.sin(this.th[k]);
      this.balls[k].position.set(x, y, z);
      const p = this.strings[k].geometry.attributes.position.array;
      p.set([x - 1.6, Y0, 0, x, y, z, x + 1.6, Y0, 0, x, y, z]); this.strings[k].geometry.attributes.position.needsUpdate = true;
    }
    const s = this.sw.shown;
    if (s !== this._s) { this._s = s; this.swBox.setText(s, '', this.sw.run ? '计时中' : ''); }
    this.drawTop();
  }
  drawTop() {
    const v = this.tv, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#e9ece8'; g.fillRect(0, 0, W, H);
    const x0 = W * 0.08, x1 = W * 0.92, ym = H * 0.5, sc = (H * 0.38) / 10; // 10 cm 满幅（放大 2 倍）
    g.strokeStyle = '#b9c2bd'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(x0 - 10, ym); g.lineTo(x1 + 10, ym); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#5b6770'; g.fillRect(x0 - 14, ym - 3, x1 - x0 + 28, 6);
    for (let k = 0; k < NP; k++) {
      const x = x0 + ((x1 - x0) * k) / (NP - 1), z = this.L(k) * 100 * Math.sin(this.th[k]) * 2;
      g.fillStyle = k === this.sel ? '#c41e3a' : '#2f3b44'; g.beginPath(); g.arc(x, ym - z * sc, W * 0.017, 0, 7); g.fill();
    }
    g.fillStyle = '#4b5963'; g.font = `${Math.round(H * 0.06)}px "IBM Plex Mono", monospace`; g.textAlign = 'left';
    g.fillText(`秒表 ${this.sw.shown}`, x0, H * 0.94);
    v.foot(this.moving ? `摆动中，已过 ${this.t.toFixed(1)} s` : '摆都静止。设计、调好摆长后，用挡板把全部摆拉开同时放开');
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'design', title: `摆长设计（Γ = ${GAMMA} s，N₀ = ${N0}，g = ${GLOC} m/s²）`, fixedRows: true,
        initRows: () => Array.from({ length: NP }, (_, k) => ({ k, N: N0 + k })),
        columns: [
          { key: 'k', label: 'k', digits: 0, readonly: true },
          { key: 'N', label: 'Γ 内摆动次数 N', digits: 0, readonly: true },
          { key: 'T', label: '设计周期 T/s', digits: 4, calc: (r) => GAMMA / r.N },
          { key: 'Ld', label: '设计摆长/mm', digits: 1, calc: (r) => Ldesign(r.k) },
          { key: 'L', label: '调好后实测/mm', digits: 1, readTol: 0.3 },
        ],
        buttons: [{ label: '记录选中的摆的实测摆长', onClick: (t) => this.recLen(t) }],
        note: '先算出每个摆的设计摆长；选中一个摆，转动绕线轴把它调到设计值（钢尺读数与设计值相差不超过 0.5 mm），记下钢尺读数。',
      },
      {
        id: 'per', title: '周期校核（单独摆动 10 个周期）', maxRows: 8,
        columns: [
          { key: 'k', label: 'k', digits: 0, auto: true },
          { key: 't10', label: '10T/s', digits: 2, readTol: 0.03 },
          { key: 'T', label: '实测 T/s', digits: 4, calc: (r) => r.t10 / 10 },
          { key: 'Td', label: '设计 T/s', digits: 4, calc: (r) => GAMMA / (N0 + r.k) },
        ],
        buttons: [{ label: '记录秒表读数', onClick: (t) => this.recPer(t) }],
        note: '选中一个摆，只拉开它（摆角 5° 左右）放开，从它经过最低点时开始计时，数 10 个周期停表。至少校核最长、中间、最短 3 个摆。',
      },
      {
        id: 'pat', title: '图样出现的时刻（从同时放开算起）', fixedRows: true,
        initRows: () => PATS.map((p) => ({ name: p.name, m: p.m })),
        columns: [
          { key: 'name', label: '图样', type: 'text', readonly: true },
          { key: 'th', label: '设计 Γ/m /s', digits: 1, calc: (r) => GAMMA / r.m },
          { key: 't', label: '实测/s', digits: 2, readTol: 0.6 },
        ],
        buttons: [{ label: '记录秒表读数（填到最接近的一行）', onClick: (t) => this.recPat(t) }],
        note: '全部摆同时放开的瞬间开始计时，看到摆球恰好分成三列、两列、重新排成一列时停表（每次可以重新放开再测）。',
      },
    ];
  }
  recLen(t) {
    const k = this.sel, a = this.app, r = this.ruler(k), d = r - Ldesign(k);
    if (Math.abs(d) > 0.5) a.toast(`第 ${k} 个摆的钢尺读数 ${r.toFixed(1)} mm，与设计值相差 ${d.toFixed(1)} mm，最好再调`, 'warn');
    t.set(k, 'L', r);
  }
  recPer(t) {
    const a = this.app, k = this.sel, tt = this.sw.value;
    if (this.sw.run) return a.toast('秒表还在走，先停表', 'warn');
    if (!(tt > 0)) return a.toast('秒表读数为 0', 'warn');
    const n = tt / this.period(k);
    if (Math.abs(n - 10) > 0.25) return a.toast(`秒表读数 ${tt.toFixed(2)} s 约为选中摆的 ${n.toFixed(1)} 个周期，不是 10 个——是不是选错了摆，或者数错了？`, 'warn');
    if (t.rows.some((r) => r.k === k)) return a.toast('这个摆已经校核过了', 'warn');
    t.addRow({ k, t10: tt });
  }
  /** 实际摆长下 m 列图样最清楚的时刻（各摆相位差最接近 2π/m 的整数倍） */
  patTime(m) {
    const w = Array.from({ length: NP }, (_, k) => (2 * Math.PI) / this.period(k));
    const bad = (t) => { let s = 0; for (let k = 1; k < NP; k++) { const p = ((w[k] - w[0]) * t * m) / (2 * Math.PI); s += (p - Math.round(p)) ** 2; } return s; };
    let best = GAMMA / m, bv = Infinity;
    for (let t = (0.85 * GAMMA) / m; t <= (1.15 * GAMMA) / m; t += 0.005) { const b = bad(t); if (b < bv) { bv = b; best = t; } }
    return best;
  }
  recPat(t) {
    const a = this.app, tt = this.sw.value;
    if (this.sw.run) return a.toast('秒表还在走，先停表', 'warn');
    if (!(tt > 5)) return a.toast('秒表读数太小', 'warn');
    const i = PATS.reduce((b, p, j) => (Math.abs(tt - GAMMA / p.m) < Math.abs(tt - GAMMA / PATS[b].m) ? j : b), 0);
    const tr = this.patTime(PATS[i].m);
    if (Math.abs(tt - tr) > 2.5) return a.toast(`${tt.toFixed(2)} s 时摆球并没有${PATS[i].name}（差得较远），再观察一次`, 'warn');
    t.set(i, 't', tt);
  }

  // ======================= 自动操作 =======================
  async setLen(k, L) { const a = this.app; a.select(a.comp('frame')); this.sel = k; this.paintSel(); a.renderInspector(); await a.tween(() => this.Lset[k], (v) => (this.Lset[k] = v), L, 250); this.Lset[k] = L; a.changed(); await a.wait(60); }
  async runFor(T) { const a = this.app; this.stopAt = T; await a.until(() => !this.sw.run, 120000); }
  steps() {
    const app = this.app, tab = (id) => app.table(id).rows;
    const lenOK = () => this.Lset.every((L, k) => Math.abs(this.ruler(k) - Ldesign(k)) <= 0.5);
    return [
      {
        title: '计算设计摆长并调好',
        html: `<p>要求 Γ = ${GAMMA} s 内第 0 个摆摆 ${N0} 次，第 $k$ 个摆摆 ${N0} + $k$ 次。由 $T_k=\\Gamma/N_k$ 和 $T=2\\pi\\sqrt{L/g}$ 算出 15 个摆的设计摆长，逐个调好（钢尺读数与设计值相差不超过 0.5 mm），记下实测摆长。</p>`,
        hint: '最长的摆约 343 mm，最短的约 211 mm。相邻两摆的摆长差随 k 增大而变小。',
        status: () => `已调好 ${this.Lset.filter((L, k) => Math.abs(this.ruler(k) - Ldesign(k)) <= 0.5).length} / 15 个，已记录 ${tab('design').filter((r) => r.L > 0).length} 个`,
        check: () => lenOK() && tab('design').every((r) => r.L > 0),
        auto: async () => {
          app.showTable(0); await app.view('正面');
          for (let k = 0; k < NP; k++) {
            if (Math.abs(this.ruler(k) - Ldesign(k)) > 0.5) await this.setLen(k, Math.round(Ldesign(k) * 2) / 2);
            if (!(tab('design')[k].L > 0) || Math.abs(tab('design')[k].L - this.ruler(k)) > 0.01) { this.sel = k; await app.record('design', 0); }
          }
        },
      },
      {
        title: '校核周期',
        html: '<p>选中一个摆，只让它摆动（摆角 5° 左右），用秒表测 10 个周期的时间，与设计周期比较。至少校核最长、中间、最短 3 个摆。</p>',
        status: () => `已校核 ${tab('per').length} 个摆`,
        check: () => tab('per').length >= 3,
        auto: async () => {
          app.showTable(1); await app.view('全景');
          const amp0 = this.amp; this.amp = 5;
          for (const k of [0, 7, 14]) {
            if (tab('per').some((r) => r.k === k)) continue;
            app.select(app.comp('frame')); this.sel = k; this.paintSel(); app.renderInspector();
            this.release(k); this.sw.reset(); this.sw.start();
            await this.runFor(+(10 * this.period(k)).toFixed(2) + gauss(0.02));
            await app.record('per', 0); this.halt();
          }
          this.amp = amp0;
        },
      },
      {
        title: '同时放开，观察并计时',
        html: '<p>摆角 8° 左右，用挡板把全部摆拉开后同时放开，同时开始计时。观察蛇形图样的变化，记下摆球分成三列、分成两列、重新排成一列的时刻。</p>',
        hint: '“分成两列”时，相邻两摆的相位恰好相反；“重新排成一列”时，第 k 个摆比第 0 个恰好多摆了 k 次。',
        status: () => `已记录 ${tab('pat').filter((r) => r.t > 0).length} / 3 个图样`,
        check: () => tab('pat').every((r) => r.t > 0),
        diagnose: () => (lenOK() ? [] : [{ msg: '还有摆的长度没有调到设计值，图样会对不齐。' }]),
        auto: async () => {
          app.showTable(2); await app.view('俯视');
          app.select(app.comp('frame')); this.amp = 8; app.renderInspector();
          for (const p of [3, 2, 1]) {
            const i = PATS.findIndex((x) => x.m === p);
            if (tab('pat')[i].t > 0) continue;
            this.release(); this.sw.reset(); this.sw.start(); // 每个图样重新放开一次
            await this.runFor(this.patTime(p) + gauss(0.15));
            await app.record('pat', 0);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>比较实测周期与设计周期、图样出现的时刻与 Γ/m，分析误差来源。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, D = a.table('design').rows.filter((r) => r.L > 0), P = a.table('per').rows.filter((r) => r.t10 > 0), S = a.table('pat').rows.filter((r) => r.t > 0);
    if (!D.length && !P.length && !S.length) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = ''; const answers = [], plots = [];
    if (D.length) {
      const dev = D.map((r) => r.L - Ldesign(r.k));
      html += `<h3>1. 摆长</h3><p>设计摆长 $L_k=g\\left(\\dfrac{\\Gamma}{2\\pi(N_0+k)}\\right)^2$：从 ${Ldesign(0).toFixed(1)} mm 到 ${Ldesign(14).toFixed(1)} mm。${D.length} 个摆的实测值与设计值之差在 ${Math.min(...dev).toFixed(1)}–${Math.max(...dev).toFixed(1)} mm 之间。</p>
        <p>摆长的相对误差 $\\delta L/L$ 使周期有 $\\delta L/2L$ 的相对误差，经过 Γ 后相位误差为 $2\\pi N_k\\cdot\\dfrac{\\delta L}{2L}$。最长的摆差 0.5 mm 时，60 s 后相位差约 ${((2 * Math.PI * N0 * 0.5) / (2 * Ldesign(0)) / DEG).toFixed(0)}°——这就是要求调到 0.5 mm 以内的原因。</p>`;
      plots.push({ title: '设计摆长与 N', xLabel: 'N = N₀ + k', yLabel: 'L / mm', series: [{ type: 'line', data: Array.from({ length: NP }, (_, k) => [N0 + k, Ldesign(k)]), label: '设计' }, { type: 'scatter', data: D.map((r) => [N0 + r.k, r.L]), label: '实测' }] });
    }
    if (P.length) {
      html += `<h3>2. 周期校核</h3><table><tr><th>k</th><th>10T/s</th><th>T/s</th><th>设计 T/s</th><th>相对偏差</th></tr>${P.map((r) => { const T = r.t10 / 10, Td = GAMMA / (N0 + r.k); return `<tr><td>${r.k}</td><td>${r.t10.toFixed(2)}</td><td>${T.toFixed(4)}</td><td>${Td.toFixed(4)}</td><td>${pct(relErr(T, Td), 2)}</td></tr>`; }).join('')}</table>
        <p>秒表测 10 个周期，按表的误差约 ±0.1 s，周期的不确定度约 ±0.01 s（相对 1%），比摆长误差造成的周期误差（约 0.1%）大得多：周期校核只能发现明显的错误。真正灵敏的检验是 Γ 时刻各摆是否对齐。</p>`;
    }
    if (S.length) {
      const one = S.find((r) => r.m === 1);
      html += `<h3>3. 图样出现的时刻</h3><table><tr><th>图样</th><th>Γ/m /s</th><th>实测/s</th><th>相对偏差</th></tr>${S.map((r) => `<tr><td>${r.name}</td><td>${(GAMMA / r.m).toFixed(1)}</td><td>${r.t.toFixed(2)}</td><td>${pct(relErr(r.t, GAMMA / r.m), 2)}</td></tr>`).join('')}</table>
        <p>同时放开后第 $k$ 个摆的相位为 $\\omega_kt$。相邻两摆的角频率差 $\\Delta\\omega=2\\pi/\\Gamma$，所以 $t=\\Gamma/m$ 时相邻两摆的相位差为 $2\\pi/m$：摆球按相位分成 $m$ 组，从上往下看就是 $m$ 列。$t=\\Gamma$ 时所有摆的相位差都是 $2\\pi$ 的整数倍，重新排成一列。</p>
        <p>实测的时刻比设计值略晚，主要因为摆角不是无穷小：摆角 $\\theta_0$ 时周期变为 $T_0\\left(1+\\dfrac{\\theta_0^2}{16}+\\cdots\\right)$，8° 时长约 0.12%，所有摆同样变长，于是整个图样序列按同一比例放慢。</p>`;
      if (one) answers.push({ label: '重新排成一列的时刻', unit: 's', value: one.t, digits: 2, tolAbs: 0.6 });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 单摆</h3><p>摆长 $L$（悬点到球心）的单摆，小摆角时周期 $T=2\\pi\\sqrt{L/g}$。摆角为 $\\theta_0$ 时周期稍长：$T=\\dfrac{2\\pi\\sqrt{L/g}}{\\mathrm{AGM}(1,\\cos\\frac{\\theta_0}2)}\\approx T_0\\left(1+\\dfrac{\\theta_0^2}{16}\\right)$。</p>
<h3>2. 蛇摆的设计</h3><p>取一段时间 Γ，让第 $k$ 个摆在 Γ 内恰好摆 $N_k=N_0+k$ 次（$k=0,1,\\cdots,14$）：</p>$$T_k=\\frac{\\Gamma}{N_0+k},\\qquad L_k=g\\left(\\frac{\\Gamma}{2\\pi(N_0+k)}\\right)^2$$<p>同时从同一摆角放开，$t$ 时刻第 $k$ 个摆的相位 $\\varphi_k=\\dfrac{2\\pi(N_0+k)}{\\Gamma}t$，相邻两摆的相位差 $\\Delta\\varphi=2\\pi t/\\Gamma$ 随时间均匀增大。从上面看，摆球的位置 $x_k\\propto\\cos\\varphi_k$ 是一条“波长”为 $2\\pi/\\Delta\\varphi$ 个摆的余弦曲线——蛇形。</p>
<h3>3. 图样</h3><p>$t=\\Gamma/m$ 时 $\\Delta\\varphi=2\\pi/m$，所有摆只有 $m$ 种相位，分成 $m$ 列；$t=\\Gamma$ 时 $\\Delta\\varphi=2\\pi$，重新排成一列；之后整个过程重复。</p>
<h3>4. 设计约束</h3><p>Γ 越短，所需的 $N_0$ 越小或摆越长；$N_0$ 太小时相邻两摆的长度差太大，排起来不像一条“蛇”。本实验 Γ = ${GAMMA} s，$N_0$ = ${N0}，摆长在 211–343 mm 之间。</p>
<h3>5. 本仿真的计算模型</h3><p>每个摆按非线性方程 $\\ddot\\theta=-\\dfrac gL\\sin\\theta-2\\gamma\\dot\\theta$ 用四阶龙格–库塔法积分（步长 5 ms），空气阻尼使振幅在 60 s 内减小约 ${(100 * (1 - Math.exp(-0.002 * 60))).toFixed(0)}%。每个摆的实际摆长与钢尺读数有约 0.25 mm 的随机偏差。</p>`;
  }
}
