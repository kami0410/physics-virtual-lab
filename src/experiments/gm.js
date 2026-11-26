// 实验：G-M 计数器与放射性统计
// 端窗型 G-M 计数管装在铅室里，下方是五层源托架（第 1 层离窗最近）；放射源为两枚 ⁹⁰Sr–⁹⁰Y β 源 A、B，
// 可单独或一起放入（双源法），源与窗之间可插铝吸收片（面密度 mg/cm²）。定标器提供 0–900 V 高压和定时计数，并能自动重复 1 s 计数。
// 起始电压、坪长、坪斜、死时间、本底、源强、铝的质量吸收系数个体随机。计数按泊松分布抽样（physics/gm.js）。
import * as THREE from 'three';
import { meta, thumb } from './gm.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, clamp, relErr, pct, linFit, mean } from '../core/Stats.js';
import { plateau, observed, corrected, twoSourceTau, twoSourceApprox, poisson, poissonP } from '../physics/gm.js';

const SHELF = [1, 0.45, 0.22, 0.11, 0.045];
const XS = [0, 25, 50, 75, 100, 150, 200, 250, 300]; // mg/cm²
const TS = [1, 10, 30, 60, 100, 200, 300];
const NREP = 200, KT = 40;
const SVG = (inner) => `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;

export class GmExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.pl = { Vs: Math.round(rand(330, 370)), len: rand(250, 300), slope: rand(0.03, 0.06) };
    this.tau = rand(180, 280) * 1e-6; this.nb = rand(0.35, 0.6);
    this.RA = rand(1000, 1150); this.RB = rand(950, 1100); this.mu = rand(6.0, 7.4); // cm²/g
    this.V = 0; this.src = 'none'; this.shelf = 2; this.x = 0; this.T = 10;
    this.run = null; this.rep = null; this.last = null; this.timeScale = 10;
  }
  cond() { return `${this.V}|${this.src}|${this.shelf}|${this.x}`; }
  /** 真实计数率（含本底） */
  trueRate() {
    const s = (this.src === 'A' || this.src === 'AB' ? this.RA : 0) + (this.src === 'B' || this.src === 'AB' ? this.RB : 0);
    return plateau(this.V, this.pl) * (s * SHELF[this.shelf - 1] * Math.exp((-this.mu * this.x) / 1000) + this.nb);
  }
  obsRate() { return observed(this.trueRate(), this.tau); }
  discharge() { return this.V > this.pl.Vs + this.pl.len + 20; }
  busy() { return !!(this.run || this.rep); }
  start() {
    const a = this.app;
    if (this.busy()) return a.toast('正在计数', 'warn');
    if (this.discharge()) return a.toast('计数管已进入连续放电区：立即降低高压，长时间连续放电会损坏计数管', 'warn');
    this.run = { T: this.T, t: 0, N: poisson(this.obsRate() * this.T), cond: this.cond() }; this.last = null; a.changed();
  }
  startRep() {
    const a = this.app;
    if (this.busy()) return a.toast('正在计数', 'warn');
    this.rep = { t: 0, list: [], cond: this.cond(), m: this.obsRate() }; this.last = null; a.changed();
  }
  stop() { this.run = null; this.rep = null; this.app.changed(); }
  shown() { if (this.run) return Math.floor((this.run.N * this.run.t) / this.run.T); if (this.rep) return this.rep.list.at(-1) ?? 0; return this.last ? this.last.N : 0; }

  globalControls() { return [{ type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×10', value: 10 }, { label: '×60', value: 60 }] }]; }
  tick(dt) {
    const a = this.app, sdt = Math.min(600, dt * (a.running ? a.speed * KT : this.timeScale));
    if (!(sdt > 0)) return;
    if (this.run) {
      if (this.cond() !== this.run.cond) { this.run = null; a.toast('计数过程中改变了条件，本次计数作废', 'warn'); a.changed(); return; }
      this.run.t += sdt;
      if (this.run.t >= this.run.T) { this.last = { T: this.run.T, N: this.run.N, cond: this.run.cond, V: this.V, src: this.src, shelf: this.shelf, x: this.x }; this.run = null; }
      a.changed();
    } else if (this.rep) {
      if (this.cond() !== this.rep.cond) { this.rep = null; a.toast('计数过程中改变了条件，本次计数作废', 'warn'); a.changed(); return; }
      const r = this.rep; r.t += sdt;
      while (r.list.length < Math.min(NREP, Math.floor(r.t))) r.list.push(poisson(r.m));
      if (r.list.length >= NREP) { this.last = { rep: r.list.slice(), T: 1, cond: r.cond, V: this.V, src: this.src, shelf: this.shelf, x: this.x }; this.rep = null; }
      a.changed();
    }
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 52, 84], target: [0, 10, -4] }, { name: '铅室', pos: [-24, 30, 34], target: [-24, 12, 0] }, { name: '定标器', pos: [18, 26, 38], target: [18, 8, -12] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(140, 80));
    app.stage.setLightTarget(0, 8, 0);
    const lead = new THREE.Group(); lead.position.set(-24, 0, 0); scene.add(lead);
    const pb = MAT.paint(0x5a5f66);
    lead.add(mesh(new THREE.BoxGeometry(16, 2, 14), pb, 0, 1, 0));
    lead.add(mesh(new THREE.BoxGeometry(16, 22, 2), pb, 0, 12, -6));
    for (const x of [-7, 7]) lead.add(mesh(new THREE.BoxGeometry(2, 22, 14), pb, x, 12, 0));
    lead.add(mesh(new THREE.BoxGeometry(16, 2, 14), pb, 0, 24, 0));
    for (let k = 0; k < 5; k++) lead.add(mesh(new THREE.BoxGeometry(11.6, 0.3, 9), MAT.paint(0x8a8f96), 0, 16 - k * 3, 0));
    lead.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 9, 24), MAT.chrome(), 0, 22, 0));
    lead.add(mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.2, 24), MAT.paint(0x2a1d10), 0, 17.4, 0));
    this.srcM = new THREE.Group(); lead.add(this.srcM);
    this.srcA = mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.5, 24), MAT.paint(0xc9a23a), -1.4, 0, 0); this.srcM.add(this.srcA);
    this.srcB = mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.5, 24), MAT.paint(0xb06a2c), 1.4, 0, 0); this.srcM.add(this.srcB);
    this.foil = mesh(new THREE.BoxGeometry(6, 0.12, 5), MAT.alu(), 0, 1.2, 0); this.srcM.add(this.foil);
    this.flash = MAT.emissive(0xff6a3a, 0);
    lead.add(mesh(new THREE.SphereGeometry(0.5, 12, 8), this.flash, 0, 27.2, 0));
    app.addComponent(new Component({
      key: 'lead', name: '铅室与放射源', zone: 'none', fixed: true, required: true, object: lead, labelY: 30,
      icon: SVG('<rect x="16" y="4" width="32" height="32"/><path d="M28 4V-2M36 4V-2"/><rect x="26" y="26" width="12" height="3"/>'),
      desc: '端窗型 G-M 计数管装在铅室顶部，窗口朝下。下面五层托架，第 1 层离窗口最近。两枚 ⁹⁰Sr–⁹⁰Y β 源 A、B 可以单独放，也可以并排一起放（位置不变）。源上方可以盖铝吸收片，规格以面密度表示（mg/cm²）。',
      controls: () => [
        { type: 'segment', label: '放射源', options: [{ value: 'none', label: '不放（测本底）' }, { value: 'A', label: '源 A' }, { value: 'B', label: '源 B' }, { value: 'AB', label: 'A + B' }], get: () => this.src, set: (v) => { this.src = v; app.changed(); } },
        { type: 'segment', label: '托架层', options: SHELF.map((_, i) => ({ value: i + 1, label: `第 ${i + 1} 层` })), get: () => this.shelf, set: (v) => { this.shelf = v; app.changed(); } },
        { type: 'segment', label: '铝吸收片', options: XS.map((x) => ({ value: x, label: x ? `${x}` : '无' })), get: () => this.x, set: (v) => { this.x = v; app.changed(); } },
      ],
    }));
    const sc = (this.sBox = meterBox(22, 10, 12, 'G-M 定标器')); sc.group.position.set(14, 0, -14); scene.add(sc.group);
    const hv = (this.hBox = meterBox(12, 8, 10, '高压')); hv.group.position.set(34, 0, -14); scene.add(hv.group);
    const inst = new THREE.Group().add(sc.group, hv.group); scene.add(inst);
    app.addComponent(new Component({
      key: 'scaler', name: '定标器', zone: 'none', fixed: true, required: true, object: inst, labelY: 12,
      icon: SVG('<rect x="4" y="10" width="56" height="20"/><path d="M10 20h20"/><circle cx="46" cy="20" r="4"/>'),
      desc: '定标器给计数管提供 0–900 V 可调高压，并对计数管输出的脉冲计数。定时计数：到设定时间自动停止。重复计数：连续做 200 次 1 s 计数，供统计分析。界面右上角可以加快时间流速。',
      controls: () => [
        { type: 'knob', label: '高压', get: () => this.V, set: (v) => { this.V = Math.round(clamp(v, 0, 900) / 5) * 5; app.changed(); }, min: 0, max: 900, step: 5, bigStep: 25, perRev: 100, digits: 0, unit: 'V' },
        { type: 'segment', label: '定时', options: TS.map((t) => ({ value: t, label: `${t} s` })), get: () => this.T, set: (v) => { this.T = v; app.changed(); } },
        { type: 'button', label: '开始计数', onClick: () => this.start() },
        { type: 'button', label: `重复计数 ${NREP} × 1 s`, onClick: () => this.startRep() },
        { type: 'button', label: '停止', onClick: () => this.stop() },
        { type: 'readout', label: '状态', get: () => this.status() },
      ],
    }));
    this.view = app.addView({ id: 'gm', title: '计数记录', w: 300, h: 220, res: 1.6 });
  }
  status() {
    if (this.discharge()) return '连续放电！';
    if (this.run) return `计数中 ${this.run.t.toFixed(0)}/${this.run.T} s`;
    if (this.rep) return `重复计数 ${this.rep.list.length}/${NREP}`;
    if (this.last) return this.last.rep ? `重复计数完成（${NREP} 次）` : `完成：${this.last.N} 个 / ${this.last.T} s`;
    return '待机';
  }
  update() {
    this.srcA.visible = this.src === 'A' || this.src === 'AB'; this.srcB.visible = this.src === 'B' || this.src === 'AB';
    this.srcM.position.y = 16 - (this.shelf - 1) * 3 + 0.4; this.foil.visible = this.x > 0; this.foil.scale.y = 1 + this.x / 60;
    this.flash.emissiveIntensity = this.busy() ? 2 + Math.random() * 2 : 0.2;
    const n = String(this.shown()), sub = this.status();
    if (n + sub !== this._s) { this._s = n + sub; this.sBox.setText(n, '', sub); }
    const hv = String(this.V); if (hv !== this._h) { this._h = hv; this.hBox.setText(hv, 'V', this.discharge() ? '连续放电' : ''); }
    this.draw();
  }
  draw() {
    const v = this.view, g = v.ctx, W = v.W, H = v.H, P = [W * 0.12, H * 0.08, W * 0.96, H * 0.84];
    g.fillStyle = '#f4f3ee'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(74,74,44,.4)'; g.strokeRect(P[0], P[1], P[2] - P[0], P[3] - P[1]);
    g.font = `${H * 0.05}px Consolas, monospace`; g.fillStyle = '#4a4a2c';
    const list = this.rep ? this.rep.list : this.last?.rep;
    if (list && list.length > 3) {
      const mu = mean(list), lo = Math.max(0, Math.floor(mu - 4 * Math.sqrt(mu))), hi = Math.ceil(mu + 4 * Math.sqrt(mu)), nb = hi - lo + 1;
      const cnt = new Array(nb).fill(0); for (const k of list) if (k >= lo && k <= hi) cnt[k - lo]++;
      const ym = Math.max(...cnt, list.length * poissonP(Math.round(mu), mu)) * 1.15, bw = (P[2] - P[0]) / nb;
      const Y = (c) => P[3] - (c / ym) * (P[3] - P[1]);
      g.fillStyle = 'rgba(74,74,44,.55)'; cnt.forEach((c, i) => g.fillRect(P[0] + i * bw + 1, Y(c), bw - 2, P[3] - Y(c)));
      g.strokeStyle = '#b3261e'; g.lineWidth = 1.6; g.beginPath();
      for (let i = 0; i < nb; i++) { const x = P[0] + (i + 0.5) * bw, y = Y(list.length * poissonP(lo + i, mu)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      g.fillStyle = '#4a4a2c'; g.textAlign = 'center';
      for (let i = 0; i < nb; i += Math.ceil(nb / 8)) g.fillText(String(lo + i), P[0] + (i + 0.5) * bw, P[3] + H * 0.07);
      v.foot(`1 s 计数的分布（${list.length} 次）· 红线：泊松分布`);
      return;
    }
    const rows = this.app.table('plat').completeRows();
    if (!rows.length) { g.textAlign = 'center'; g.fillText('坪曲线（记录后显示）', W / 2, H / 2); v.foot(this.status()); return; }
    const pts = rows.map((r) => [r.V, r.N / r.T]), vmin = Math.min(...pts.map((p) => p[0])) - 20, vmax = Math.max(...pts.map((p) => p[0])) + 20, nmax = Math.max(...pts.map((p) => p[1])) * 1.15;
    const X = (x) => P[0] + ((x - vmin) / (vmax - vmin)) * (P[2] - P[0]), Y = (y) => P[3] - (y / nmax) * (P[3] - P[1]);
    g.strokeStyle = '#4a4a2c'; g.beginPath(); pts.sort((a, b) => a[0] - b[0]).forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.stroke();
    g.fillStyle = '#b3261e'; for (const p of pts) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 2.5, 0, 7); g.fill(); }
    g.fillStyle = '#4a4a2c'; g.textAlign = 'center'; g.fillText(`${Math.round(vmin)} V`, P[0] + 14, P[3] + H * 0.07); g.fillText(`${Math.round(vmax)} V`, P[2] - 14, P[3] + H * 0.07);
    v.foot(`坪曲线（${rows.length} 点）· ${this.status()}`);
  }

  // ======================= 数据表 =======================
  tables() {
    const n = { key: 'n', label: '计数率 n/s⁻¹', digits: 2, calc: (r) => r.N / r.T };
    return [
      {
        id: 'plat', title: '坪曲线（源 A）', maxRows: 30,
        columns: [{ key: 'V', label: '高压 V/V', digits: 0, auto: true }, { key: 'T', label: '时间/s', digits: 0, auto: true }, { key: 'N', label: '计数 N', digits: 0, readTol: 0.5 }, n],
        buttons: [{ label: '记录本次计数', onClick: (t) => this.recPlat(t) }],
        note: '源 A 放在某一层不动。从低压开始升高电压，找到开始有计数的起始电压；之后每隔 20–25 V 计数一次，直到计数率明显陡增（进入连续放电区）就立即停止升压。',
      },
      {
        id: 'stat', title: '计数统计（重复 1 s 计数）', fixedRows: true,
        initRows: () => [{ what: `${NREP} 次 1 s 计数` }],
        columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'mean', label: '平均值', digits: 2, auto: true }, { key: 'var', label: '方差', digits: 2, auto: true }, { key: 'in1', label: '落在 ±σ 内', type: 'text', auto: true }],
        buttons: [{ label: '记录重复计数结果', onClick: (t) => this.recStat(t) }],
        note: '源放在较远的层上，使 1 s 计数只有十几到几十个，再做重复计数。',
      },
      {
        id: 'dead', title: '双源法测死时间', fixedRows: true,
        initRows: () => [{ what: '源 A' }, { what: '源 A + B' }, { what: '源 B' }, { what: '本底' }],
        columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'T', label: '时间/s', digits: 0, auto: true }, { key: 'N', label: '计数 N', digits: 0, readTol: 0.5 }, { ...n, digits: 3 }],
        buttons: [{ label: '记录本次计数', onClick: (t) => this.recDead(t) }],
        note: '高压、托架层不变（第 1 层，计数率高，死时间的影响才明显）。依次测 A、A+B、B（源 A 不动，B 放到旁边固定位置）和本底，每次至少 200 s。',
      },
      {
        id: 'abs', title: 'β 射线在铝中的吸收（源 A）', maxRows: 12,
        columns: [{ key: 'x', label: '面密度 x/(mg·cm⁻²)', digits: 0, auto: true }, { key: 'T', label: '时间/s', digits: 0, auto: true }, { key: 'N', label: '计数 N', digits: 0, readTol: 0.5 }, n],
        buttons: [{ label: '记录本次计数', onClick: (t) => this.recAbs(t) }],
        note: '源 A、高压和托架层不变，依次加不同面密度的铝片计数，每次至少 30 s。',
      },
    ];
  }
  lastOk(min) {
    const a = this.app, L = this.last;
    if (!L || L.rep) { a.toast('先做一次定时计数', 'warn'); return null; }
    if (L.cond !== this.cond()) { a.toast('条件已经改变：在当前条件下重新计数', 'warn'); return null; }
    L.fl = L.T < min ? [`计数时间只有 ${L.T} s（建议至少 ${min} s），统计误差大`] : [];
    return L;
  }
  recPlat(t) {
    const L = this.lastOk(10); if (!L) return; const a = this.app;
    if (t.rows.some((r) => r.V === L.V)) a.toast('这个电压已经测过了', 'warn');
    const fl = [...L.fl];
    if (L.src !== 'A' || L.x) fl.push('坪曲线约定用源 A、不加吸收片');
    if (t.rows.length && t.rows[0]._shelf !== L.shelf) fl.push(`托架层和第一行（第 ${t.rows[0]._shelf} 层）不同，计数率变了`);
    t.flagAll(t.addRow({ V: L.V, T: L.T, N: L.N, _shelf: L.shelf }), fl);
  }
  recStat(t) {
    const a = this.app, L = this.last;
    if (!L || !L.rep) return a.toast('先做一次重复计数', 'warn');
    const m = mean(L.rep), vr = L.rep.reduce((s, k) => s + (k - m) ** 2, 0) / (L.rep.length - 1), s = Math.sqrt(m);
    if (m < 3) a.toast('平均计数太少：用源并放到合适的层', 'warn');
    const inn = L.rep.filter((k) => Math.abs(k - m) <= s).length;
    t.set(0, 'mean', +m.toFixed(3)); t.set(0, 'var', +vr.toFixed(3)); t.set(0, 'in1', `${inn}/${L.rep.length}`);
    t.rows[0]._list = L.rep.slice(); a.changed();
  }
  recDead(t) {
    const L = this.lastOk(this.src === 'none' ? 100 : 200); if (!L) return; const a = this.app;
    const i = { A: 0, AB: 1, B: 2, none: 3 }[L.src];
    const ref = t.rows.find((r, k) => k !== 3 && r._V != null);
    const fl = [...L.fl];
    if (L.x) fl.push('加着吸收片');
    if (ref && (ref._V !== L.V || (i !== 3 && ref._shelf !== L.shelf))) fl.push('高压或托架层和已测的行不同');
    if (i !== 3 && this.pl.Vs + 25 > L.V) fl.push('高压不在坪区，计数率随电压变化');
    t.set(i, 'T', L.T); t.set(i, 'N', L.N); t.rows[i]._V = L.V; t.rows[i]._shelf = L.shelf; t.flagAll(i, fl); a.changed();
  }
  recAbs(t) {
    const L = this.lastOk(30); if (!L) return; const a = this.app;
    if (t.rows.some((r) => r.x === L.x)) a.toast('这个厚度已经测过了', 'warn');
    const fl = [...L.fl];
    if (L.src !== 'A') fl.push('吸收实验约定用源 A');
    if (t.rows.length && (t.rows[0]._V !== L.V || t.rows[0]._shelf !== L.shelf)) fl.push('高压或托架层和第一行不同');
    t.flagAll(t.addRow({ x: L.x, T: L.T, N: L.N, _V: L.V, _shelf: L.shelf }), fl);
  }

  // ======================= 自动操作 =======================
  async seg(comp, key, v) { const a = this.app; a.select(a.comp(comp)); if (this[key] !== v) { this[key] = v; a.renderInspector(); a.changed(); await a.wait(100); } }
  async adj(comp, key, to, ms = 250) { const a = this.app; a.select(a.comp(comp)); if (Math.abs(this[key] - to) > 1e-9) await a.tween(() => this[key], (v) => (this[key] = Math.round(v / 5) * 5), to, ms); this[key] = to; a.changed(); await a.wait(60); }
  async count(T) { const a = this.app; await this.seg('scaler', 'T', T); a.select(a.comp('scaler')); this.start(); await a.until(() => !this.run, 60000); }
  workV() { return Math.round((this.pl.Vs + 25 + this.pl.len * 0.35) / 25) * 25; }
  steps() {
    const app = this.app, rows = (id) => app.table(id).completeRows(), dead = () => app.table('dead').rows;
    const Vw = () => dead().find((r) => r._V != null)?._V ?? rows('abs')[0]?._V ?? this.workV();
    return [
      {
        title: '坪曲线',
        html: '<p>源 A 放在第 2 层，不加吸收片。从 300 V 开始每隔 25 V 计数 10 s，找到起始电压后继续升压，直到计数率开始陡增为止。</p>',
        hint: '坪区计数率几乎不随电压变化。电压过高进入连续放电区，计数率陡增——这时要立即降压。',
        status: () => `已测 ${rows('plat').length} 点`,
        check: () => rows('plat').length >= 8,
        auto: async () => {
          app.showTable(0); await app.view('全景');
          await this.seg('lead', 'src', 'A'); await this.seg('lead', 'x', 0); await this.seg('lead', 'shelf', rows('plat')[0]?._shelf ?? 2);
          const top = this.pl.Vs + this.pl.len + 20;
          for (let V = 300; V <= top; V += 25) { if (rows('plat').some((r) => r.V === V)) continue; await this.adj('scaler', 'V', V, 150); await this.count(10); await app.record('plat', 0); }
          await this.adj('scaler', 'V', this.workV(), 300);
        },
      },
      {
        title: '计数的统计分布',
        html: '<p>高压调到工作电压（坪区前三分之一左右），源 A 放到第 5 层，做 200 次 1 s 重复计数，观察计数的分布。</p>',
        hint: '计数的方差应约等于平均值；约 68% 的计数落在平均值 ±√平均值 以内。',
        check: () => typeof app.table('stat').rows[0]?.mean === 'number',
        auto: async () => {
          app.showTable(1); await app.view('全景');
          await this.adj('scaler', 'V', this.workV(), 200); await this.seg('lead', 'src', 'A'); await this.seg('lead', 'x', 0); await this.seg('lead', 'shelf', 5);
          app.select(app.comp('scaler')); this.startRep(); await app.until(() => !this.rep, 60000); await app.record('stat', 0);
        },
      },
      {
        title: '双源法测死时间',
        html: '<p>工作电压不变，源放在第 1 层。依次测源 A、A + B、源 B 各 200 s，再拿走源测本底 300 s。</p>',
        hint: '真实计数率满足 $n_A+n_B=n_{AB}+n_b$；观测计数率因死时间而偏小，计数率越高偏得越多，由此可以解出死时间。',
        status: () => `已测 ${dead().filter((r) => typeof r.N === 'number').length}/4`,
        check: () => dead().every((r) => typeof r.N === 'number'),
        auto: async () => {
          app.showTable(2); await app.view('铅室');
          await this.adj('scaler', 'V', Vw(), 200); await this.seg('lead', 'x', 0); await this.seg('lead', 'shelf', 1);
          for (const [i, s] of [[0, 'A'], [1, 'AB'], [2, 'B'], [3, 'none']]) { if (typeof dead()[i].N === 'number') continue; await this.seg('lead', 'src', s); await this.count(s === 'none' ? 300 : 200); await app.record('dead', 0); }
        },
      },
      {
        title: 'β 吸收',
        html: '<p>源 A 放在第 2 层，工作电压不变。依次加 0、25、50 … 300 mg/cm² 的铝片，各计数 60 s。</p>',
        status: () => `已测 ${rows('abs').length} 个厚度`,
        check: () => rows('abs').length >= 6,
        auto: async () => {
          app.showTable(3); await app.view('铅室');
          await this.adj('scaler', 'V', rows('abs')[0]?._V ?? Vw(), 200); await this.seg('lead', 'src', 'A'); await this.seg('lead', 'shelf', rows('abs')[0]?._shelf ?? 2);
          for (const x of XS) { if (rows('abs').some((r) => r.x === x)) continue; await this.seg('lead', 'x', x); await this.count(60); await app.record('abs', 0); }
          await this.seg('lead', 'x', 0);
        },
      },
      {
        title: '数据处理',
        html: '<p>由坪曲线求起始电压、坪长和坪斜；比较计数的方差与平均值；由双源法求死时间；作死时间修正后的 $\\ln n$–$x$ 图，求质量吸收系数。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, P = a.table('plat').completeRows().slice().sort((x, y) => x.V - y.V), S = a.table('stat').rows[0], D = a.table('dead').rows, AB = a.table('abs').completeRows().slice().sort((x, y) => x.x - y.x);
    if (P.length + AB.length < 2 && typeof S?.mean !== 'number') return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = ''; const answers = [], plots = [];
    if (P.length >= 4) {
      const pts = P.map((r) => ({ V: r.V, n: r.N / r.T }));
      const nmax = Math.max(...pts.map((p) => p.n)), start = pts.find((p) => p.n > 0.5);
      // 坪区：计数率与前一点之比在 ±8% 以内的连续段
      let best = [], cur = [];
      for (let i = 1; i < pts.length; i++) { if (pts[i - 1].n > 0 && Math.abs(pts[i].n / pts[i - 1].n - 1) < 0.08) { if (!cur.length) cur.push(pts[i - 1]); cur.push(pts[i]); } else { if (cur.length > best.length) best = cur; cur = []; } }
      if (cur.length > best.length) best = cur;
      html += '<h3>1. 坪曲线</h3>';
      if (best.length >= 3) {
        const V1 = best[0].V, V2 = best.at(-1).V, n1 = best[0].n, n2 = best.at(-1).n, sl = ((n2 - n1) / ((n1 + n2) / 2) / (V2 - V1)) * 100;
        html += `<p>起始电压约 ${start ? start.V : '—'} V；坪区 ${V1}–${V2} V，坪长 ${V2 - V1} V；坪斜 $\\dfrac{n_2-n_1}{\\bar n(V_2-V_1)}\\times100$ V = ${(sl * 100).toFixed(1)}%/100 V。工作电压取坪区前 1/3 处，约 ${Math.round((V1 + (V2 - V1) / 3) / 5) * 5} V。</p>`;
      } else html += `<p>起始电压约 ${start ? start.V : '—'} V。测量点不够，没有找到坪区。</p>`;
      plots.push({ title: '坪曲线', xLabel: 'V / V', yLabel: 'n / s⁻¹', series: [{ type: 'scatter', data: pts.map((p) => [p.V, p.n]), label: '实验点' }, { type: 'line', data: pts.map((p) => [p.V, p.n]), label: '' }] });
      void nmax;
    }
    if (typeof S?.mean === 'number') {
      const r = S.var / S.mean;
      html += `<h3>2. 计数统计</h3><p>${NREP} 次 1 s 计数：平均值 $\\bar N$ = ${S.mean.toFixed(2)}，方差 $\\sigma^2$ = ${S.var.toFixed(2)}，$\\sigma^2/\\bar N$ = ${r.toFixed(3)}，接近 1——泊松分布的方差等于均值。落在 $\\bar N\\pm\\sqrt{\\bar N}$ 以内的有 ${S.in1}（正态近似下应约 68%）。所以一次计数 $N$ 的标准差可以直接取 $\\sqrt N$，相对误差 $1/\\sqrt N$：要小于 1%，至少要计 10⁴ 个数。</p>`;
      const L = S._list;
      if (L && L.length) {
        const mu = S.mean, lo = Math.max(0, Math.floor(mu - 4 * Math.sqrt(mu))), hi = Math.ceil(mu + 4 * Math.sqrt(mu)), cnt = [];
        for (let k = lo; k <= hi; k++) cnt.push([k, L.filter((x) => x === k).length]);
        plots.push({ title: '1 s 计数的分布', xLabel: 'N', yLabel: '次数', series: [{ type: 'scatter', data: cnt, label: '实验' }, { type: 'line', data: cnt.map(([k]) => [k, L.length * poissonP(k, mu)]), label: '泊松分布' }] });
      }
    }
    let tauM = null;
    if (D.every((r) => typeof r.N === 'number')) {
      const [m1, m12, m2, mb] = D.map((r) => r.N / r.T);
      tauM = twoSourceTau(m1, m2, m12, mb); const ap = twoSourceApprox(m1, m2, m12, mb);
      html += `<h3>3. 死时间</h3><p>观测计数率：$m_A$ = ${m1.toFixed(2)}，$m_{AB}$ = ${m12.toFixed(2)}，$m_B$ = ${m2.toFixed(2)}，$m_b$ = ${mb.toFixed(3)} s⁻¹。$m_A+m_B-m_{AB}-m_b$ = ${(m1 + m2 - m12 - mb).toFixed(2)} s⁻¹，比零大得多——两源一起放时漏计得更多。由 $n=m/(1-m\\tau)$ 与 $n_A+n_B=n_{AB}+n_b$ 解得</p>
        <div class="result-box">$\\tau=${(tauM * 1e6).toFixed(1)}$ μs</div><p>（近似式 $\\tau\\approx\\dfrac{m_A+m_B-m_{AB}-m_b}{m_{AB}^2-m_A^2-m_B^2}$ 给出 ${(ap * 1e6).toFixed(1)} μs。）仿真设定值 ${(this.tau * 1e6).toFixed(1)} μs，相对误差 ${pct(relErr(tauM, this.tau))}，主要来自计数的统计涨落。计数率 ${m12.toFixed(0)} s⁻¹ 时漏计约 ${((m12 * tauM) * 100).toFixed(1)}%。</p>`;
      answers.push({ label: '死时间 $\\tau$', unit: 'μs', value: tauM * 1e6, digits: 1, tolRel: 0.005 });
    }
    if (AB.length >= 3) {
      const bg = D[3] && typeof D[3].N === 'number' ? D[3].N / D[3].T : 0, tc = tauM ?? 0;
      const pts = AB.map((r) => { const m = r.N / r.T, n = corrected(m, tc) - corrected(bg, tc); return { x: r.x, m, n }; }).filter((p) => p.n > 0);
      const f = linFit(pts.map((p) => p.x / 1000), pts.map((p) => Math.log(p.n))), mu = -f.k;
      const fr = linFit(pts.map((p) => p.x / 1000), pts.map((p) => Math.log(p.m))), mur = -fr.k;
      html += `<h3>4. β 吸收</h3><p>${tauM ? `每点先作死时间修正 $n=m/(1-m\\tau)$（τ = ${(tauM * 1e6).toFixed(1)} μs）再扣除本底，` : '没有测死时间，不作修正，只扣除本底；'}$\\ln n$ 与面密度成直线（r = ${f.r.toFixed(5)}）：</p>
        <div class="result-box">质量吸收系数 $\\mu_m=${mu.toFixed(2)}$ cm²/g</div><p>仿真设定值 ${this.mu.toFixed(2)} cm²/g，相对误差 ${pct(relErr(mu, this.mu))}。${tauM ? `若不作死时间修正，直接用观测计数率拟合得 ${mur.toFixed(2)} cm²/g——计数率高的薄吸收片一端被压低，斜率偏小。` : ''}由经验公式 $\\mu_m=17E_{\\max}^{-1.14}$ 可估算 β 射线的最大能量 $E_{\\max}\\approx${(17 / mu) ** (1 / 1.14) > 0 ? ((17 / mu) ** (1 / 1.14)).toFixed(2) : '—'}$ MeV（⁹⁰Y 为 2.28 MeV）。</p>`;
      answers.push({ label: '质量吸收系数 $\\mu_m$', unit: 'cm²/g', value: mu, digits: 2, tolRel: 0.01 });
      plots.push({ title: 'ln n – 面密度', xLabel: 'x / (g·cm⁻²)', yLabel: 'ln(n / s⁻¹)', series: [{ type: 'scatter', data: pts.map((p) => [p.x / 1000, Math.log(p.n)]), label: tauM ? '修正后' : '扣本底' }, { type: 'line', data: [0, 0.3].map((x) => [x, f.k * x + f.b]), label: '拟合' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. G-M 计数管</h3><p>管内充惰性气体和少量猝熄气体，阳极丝与阴极间加几百伏电压。射线电离出的电子在阳极附近引起雪崩放电并扩展到整根阳极丝，形成幅度与入射粒子无关的大脉冲。电压太低时脉冲幅度达不到甄别阈，没有计数；电压在坪区时每个进入管内的粒子都产生一个脉冲，计数率几乎不随电压变；电压太高时猝熄失效，出现连续放电。</p>
<h3>2. 计数统计</h3><p>放射性衰变是随机的，一定时间内的计数 $N$ 服从泊松分布 $P(N)=\\bar N^Ne^{-\\bar N}/N!$，方差等于均值。$\\bar N$ 较大时接近正态分布，$N$ 的标准差可取 $\\sqrt N$。</p>
<h3>3. 死时间</h3><p>每次放电后，计数管要经过一段时间 $\\tau$（约 100–300 μs）才能再次计数，其间进入的粒子被漏计。观测计数率 $m$ 与真实计数率 $n$ 的关系 $n=m/(1-m\\tau)$。双源法：真实计数率满足 $n_A+n_B=n_{AB}+n_b$，由测得的四个观测计数率可解出 $\\tau$。</p>
<h3>4. β 射线的吸收</h3><p>β 射线能谱连续，在物质中的吸收近似服从指数规律 $n=n_0e^{-\\mu_mx_m}$，$x_m$ 为面密度（g/cm²），$\\mu_m$ 为质量吸收系数，与最大能量有关：$\\mu_m\\approx17E_{\\max}^{-1.14}$（cm²/g，$E$ 以 MeV 计）。</p>
<h3>5. 本仿真的计算模型</h3><p>坪曲线由起始段（S 形上升）、坪斜和连续放电段组成；计数按观测计数率 $m=n/(1+n\\tau)$ 的泊松分布抽样；β 吸收取单纯指数。起始电压、坪长、坪斜、死时间、本底、源强、质量吸收系数个体随机。</p>`;
  }
}
