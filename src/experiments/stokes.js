// 实验：落球法测液体的黏滞系数（蓖麻油 · 筒壁筒底修正 · 雷诺数）
// 小球下落速度按 physics/stokes.js 的收尾速度逐点计算（含筒壁 Faxén 修正、离筒底高度的 Lorentz 修正、Oseen 惯性修正），
// 刚入液的几厘米内受投放扰动略快；未浸润的小球会带着小气泡，偏离轴线时筒壁阻力更大。
import * as THREE from 'three';
import { meta, thumb } from './stokes.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss, fmtU } from '../core/Stats.js';
import { Micrometer, Caliper, Tape, Stopwatch } from '../core/gauges.js';
import { castorEta, castorRho, terminalV } from '../physics/stokes.js';
import { stokesFig } from './mechFigs.js';

const G = 9.794;
const HT = 46; // 量筒高 cm
const RHO_LABEL = 7.80, RHO0_LABEL = 0.96; // 标签上给出的密度 g/cm³
const BALLS = [['A1', 1.5], ['A2', 1.5], ['A3', 1.5], ['B1', 2.5], ['B2', 2.5], ['B3', 2.5]];
const MISC = [['L', '两标线间距 L / cm'], ['D', '量筒内径 D / mm'], ['H', '油柱高度 H / cm'], ['T', '油温 T / °C']];
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class StokesExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.T = Math.round(rand(18, 26) * 10) / 10 + rand(-0.04, 0.04);
    this.k = rand(0.93, 1.05);
    this.eta = castorEta(this.T, this.k); this.rho0 = castorRho(this.T);
    this.rho = RHO_LABEL * 1000 * (1 + rand(-0.003, 0.003));
    this.Din = rand(38, 42) / 1000; this.Hl = rand(38, 41) / 100;
    this.balls = BALLS.map(([id, dn]) => ({ id, d: (dn + rand(-0.012, 0.012)) / 1000, used: false }));
    this.y1 = this.Hl * 100 - rand(1.5, 3.5); this.y2 = rand(1.5, 3); // 上、下标线离筒底高度 cm（学生可移动）
    this.mic = new Micrometer({ zero: Math.round(rand(-10, 12)) / 1000 || -0.003 });
    this.cal = new Caliper(); this.tape = new Tape({ label: '' });
    this.tool = 'd'; this.cur = 0; this.wet = false; this.onAxis = true;
    this.mic.setObject(null); this.mic.gap = 2;
    this.sw = new Stopwatch(); this.ball = null; this.auto = null;
    this.timeScale = 1; this.assist = false;
  }

  // ======================= 下落 =======================
  drop() {
    const a = this.app, b = this.balls[this.cur];
    if (b.used) return a.toast(`小球 ${b.id} 已经投放过了，换一颗`, 'warn');
    if (this.ball && this.ball.y > 0.3) return a.toast('上一颗小球还在下落', 'warn');
    b.used = true;
    const ecc = this.onAxis ? rand(0, 0.12) : rand(0.5, 0.7);
    const bubble = this.wet ? 0 : rand(0.012, 0.03);
    this.ball = { b, y: this.Hl * 100, ecc, bubble, ang: rand(0, 6.28), t1: null, t2: null };
    a.renderInspector(); a.changed();
  }
  vAt(y) {
    const bl = this.ball, b = bl.b;
    const v = terminalV({ d: b.d, rho: this.rho * (1 - bl.bubble), rho0: this.rho0, eta: this.eta, D: this.Din, h: y / 100, ecc: bl.ecc, g: G });
    const s = this.Hl * 100 - y; // 入液深度 cm
    return v * (1 + 0.25 * Math.exp(-s / 1.5));
  }
  tick(dt) {
    const a = this.app, sdt = Math.min(5, dt * (a.running ? a.speed * (this.auto ? 4 : 1) : this.timeScale));
    if (!(sdt > 0)) return;
    this.sw.tick(sdt);
    const bl = this.ball;
    if (!bl || bl.y <= 0) { if (this.sw.run) a.changed(); return; }
    const bottom = (bl.b.d * 100) / 2;
    const n = Math.ceil(sdt / 0.02), h = sdt / n;
    let tLeft = sdt;
    for (let i = 0; i < n && bl.y > bottom; i++) {
      const y0 = bl.y, v = this.vAt(y0) * 100; // cm/s
      bl.y = Math.max(bottom, y0 - v * h); tLeft -= h;
      for (const [mk, key] of [[this.y1, 't1'], [this.y2, 't2']]) {
        if (y0 > mk && bl.y <= mk) {
          const tc = tLeft + ((mk - bl.y) / (y0 - bl.y)) * h; // 过线后又走了多久
          this.onMark(key, tc);
        }
      }
    }
    if (bl.y <= bottom) bl.y = 0.0001 + bottom;
    a.changed();
  }
  /** 小球经过标线：自动计时时在此启停秒表（tAgo：过线时刻距本帧末的时间） */
  onMark(key, tAgo) {
    const au = this.auto;
    if (!au) return;
    if (key === 't1') { this.sw.reset(); this.sw.run = true; this.sw.t = tAgo + gauss(0.03); }
    else { this.sw.run = false; this.sw.t = Math.max(0, this.sw.t - tAgo + gauss(0.03)); this.auto = null; }
  }

  // ======================= 场景 =======================
  cameras() {
    return [
      { name: '全景', pos: [55, 48, 95], target: [8, 22, 0] },
      { name: '量筒', pos: [34, 36, 70], target: [2, 22, 0] },
      { name: '标线', pos: [12, this.y1 + 6, 26], target: [0, this.y1 - 3, 0] },
    ];
  }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 80));
    app.stage.setLightTarget(0, 20, 0);
    const R = (this.Din * 100) / 2;
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(R + 3, R + 3.5, 1.6, 40), MAT.paint(0x2b3440), 0, 0.8, 0));
    g.add(mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, HT, 48, 1, true), MAT.glass(0xdbeafe, 0.22), 0, HT / 2 + 1.6, 0));
    g.add(mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.6, 48), MAT.glass(0xdbeafe, 0.3), 0, 1.9, 0));
    const oil = mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.02, this.Hl * 100, 48), new THREE.MeshStandardMaterial({ color: 0xd49a2a, transparent: true, opacity: 0.42, roughness: 0.1, depthWrite: false }), 0, (this.Hl * 100) / 2 + 2.2, 0);
    g.add(oil);
    this.marks = [0, 1].map(() => { const m = mesh(new THREE.TorusGeometry(R + 0.42, 0.16, 8, 48), MAT.black(), 0, 0, 0); m.rotation.x = Math.PI / 2; g.add(m); return m; });
    // 温度计
    g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 30, 10), MAT.glass(0xffffff, 0.6), R * 0.62, this.Hl * 100 + 2.2 - 9, -R * 0.3));
    g.add(mesh(new THREE.BoxGeometry(3.2, 5, 1.6), MAT.paint(0x1f2937), R * 0.62, this.Hl * 100 + 2.2 + 8, -R * 0.3));
    this.ballM = mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.9, roughness: 0.2 }), 0, 0, 0); this.ballM.visible = false; g.add(this.ballM);
    // 小球盒
    g.add(mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.8, 32), MAT.paint(0xe5e7eb), 18, 0.4, 8));
    this.trayBalls = this.balls.map((b, i) => { const m = mesh(new THREE.SphereGeometry(b.d * 100 * 0.9, 10, 8), MAT.metal(), 16.2 + (i % 3) * 1.8, 1.0, 7 + Math.floor(i / 3) * 2); g.add(m); return m; });
    app.addComponent(new Component({
      key: 'tube', name: '落球法黏度计', zone: 'none', fixed: true, required: true, object: g, labelY: HT + 6,
      icon: SVG('<rect x="24" y="2" width="16" height="36" fill="none" stroke="currentColor" stroke-width="2"/>'),
      desc: `玻璃量筒中盛蓖麻油（密度 ρ₀ ≈ ${RHO0_LABEL.toFixed(2)} g/cm³），筒外套两根橡皮筋作为计时标线，可以上下移动。小球为钢球（密度 ρ = ${RHO_LABEL.toFixed(2)} g/cm³）。筒中插有数显温度计。`,
      controls: () => [
        { type: 'knob', label: '上标线（橡皮筋）', get: () => this.y1, set: (v) => (this.y1 = clamp(v, this.y2 + 5, HT - 2)), step: 0.1, bigStep: 1, perRev: 5, fmt: () => '上下移动' },
        { type: 'knob', label: '下标线（橡皮筋）', get: () => this.y2, set: (v) => (this.y2 = clamp(v, 0.5, this.y1 - 5)), step: 0.1, bigStep: 1, perRev: 5, fmt: () => '上下移动' },
        { type: 'readout', label: '数显温度计', get: () => `${this.T.toFixed(1)} °C` },
      ],
    }));
    this.fv = app.addView({ id: 'fall', title: '量筒（侧视）与秒表', w: 210, h: 300, res: 1.6 });
    this.gv = app.addView({ id: 'tool', title: '量具读数', w: 330, h: 150, res: 1.8 });
  }

  update() {
    const R = (this.Din * 100) / 2;
    this.marks[0].position.y = this.y1 + 2.2; this.marks[1].position.y = this.y2 + 2.2;
    const bl = this.ball;
    this.ballM.visible = !!bl;
    if (bl) { const s = Math.max(0.12, bl.b.d * 100 * 0.5); this.ballM.scale.setScalar(s); this.ballM.position.set(R * bl.ecc * Math.cos(bl.ang), bl.y + 2.2, R * bl.ecc * Math.sin(bl.ang)); }
    this.balls.forEach((b, i) => (this.trayBalls[i].visible = !b.used));
    this.drawFall(); this.drawTool();
  }

  drawFall() {
    const v = this.fv, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    const top = H * 0.04, bot = H * 0.78, sc = (bot - top) / HT; // 每 cm 像素
    const x0 = W * 0.28, x1 = W * 0.62;
    const Y = (y) => bot - y * sc;
    g.fillStyle = 'rgba(212,154,42,.55)'; g.fillRect(x0, Y(this.Hl * 100), x1 - x0, bot - Y(this.Hl * 100));
    g.strokeStyle = '#9fb3c8'; g.lineWidth = 2; g.strokeRect(x0, top, x1 - x0, bot - top);
    g.fillStyle = '#111'; for (const y of [this.y1, this.y2]) g.fillRect(x0 - 4, Y(y) - 2, x1 - x0 + 8, 4);
    const bl = this.ball;
    if (bl) { g.fillStyle = '#cfd6dd'; g.beginPath(); g.arc((x0 + x1) / 2 + ((x1 - x0) / 2) * bl.ecc * Math.cos(bl.ang), Y(bl.y), Math.max(2.5, bl.b.d * 100 * sc * 0.5 * 1.6), 0, 7); g.fill(); }
    g.fillStyle = '#c9ced3'; g.font = `${H * 0.034}px "Microsoft YaHei"`; g.textAlign = 'left';
    g.fillText('上标线', x1 + 8, Y(this.y1) + 4); g.fillText('下标线', x1 + 8, Y(this.y2) + 4);
    this.sw.draw(g, W * 0.08, H * 0.83, W * 0.84, H * 0.13);
    const b = this.balls[this.cur];
    let foot;
    if (bl && bl.y > (bl.b.d * 100) / 2 + 0.01) foot = `小球 ${bl.b.id} 正在下落：经过上标线时开表，经过下标线时停表`;
    else if (this.Hl * 100 - this.y1 < 5) foot = '上标线离液面太近：小球刚入液时还在受扰动';
    else if (this.y2 < 4) foot = '下标线离筒底太近：筒底使小球减速';
    else foot = `下一颗：小球 ${b.id}${b.used ? '（已投放）' : ''}`;
    v.foot(foot);
  }

  gauge() { return this.tool === 'd' ? this.mic : this.tool === 'D' ? this.cal : this.tape; }
  setTool(t) {
    this.tool = t;
    if (t === 'L') this.tape.measure(this.y1 - this.y2, { sigma: 0.03 });
    if (t === 'H') this.tape.measure(this.Hl * 100, { sigma: 0.04 });
    if (t === 'D') this.cal.setObject(this.Din * 1000);
  }
  drawTool() {
    const v = this.gv, g = v.ctx, W = v.W, H = v.H, o = { assist: this.assist };
    if (this.tool === 'L' && Math.abs(this.tape.value - (this.y1 - this.y2)) > 1e-6) this.tape.measure(this.y1 - this.y2, { sigma: 0.03 });
    if (this.tool === 'd') this.mic.draw(g, W, H, o);
    else if (this.tool === 'D') this.cal.draw(g, W, H, o);
    else this.tape.draw(g, W, H, { ...o, mark: this.tool === 'L' ? '下标线' : '液面' });
    const nm = { d: `螺旋测微器：${this.mic.obj == null ? '零点' : `小球 ${this.balls[this.cur].id} 的直径`}`, L: '钢尺：两标线间距（零点对准上标线）', D: '游标卡尺（内量爪）：量筒内径', H: '钢尺：筒底到液面的高度' }[this.tool];
    const p = this.tool === 'd' ? this.mic.problem() : this.tool === 'D' ? this.cal.problem() : null;
    v.foot(p ? `${nm} —— ${p}` : nm);
  }

  globalControls() {
    const a = this.app, rer = () => { a.renderInspector(); a.changed(); };
    const out = [
      { type: 'select', label: '取哪颗小球', get: () => this.cur, set: (v) => { this.cur = +v; if (this.tool === 'd' && this.mic.obj != null) this.mic.setObject(this.balls[this.cur].d * 1000); rer(); }, options: this.balls.map((b, i) => ({ value: i, label: `小球 ${b.id}（标称 ${BALLS[i][1]} mm）${b.used ? ' 已投放' : ''}` })) },
      { type: 'toggle', label: '投放前先在油中浸润小球', get: () => this.wet, set: (v) => (this.wet = v) },
      { type: 'segment', label: '投放位置', get: () => this.onAxis, set: (v) => (this.onAxis = v), options: [{ label: '沿中心轴', value: true }, { label: '靠近筒壁', value: false }] },
      { type: 'button', label: '用镊子把小球放进液面', onClick: () => this.drop() },
      { type: 'button', label: this.sw.run ? '秒表：停止' : '秒表：开始', onClick: () => { if (this.sw.run) this.sw.stop(gauss(0.04) * this.timeScale); else { this.sw.reset(); this.sw.start(0); } rer(); } },
      { type: 'button', label: '秒表：清零', onClick: () => { this.sw.reset(); a.changed(); } },
      { type: 'segment', label: '量具', get: () => this.tool, set: (v) => { this.setTool(v); rer(); }, options: [{ label: '千分尺', value: 'd' }, { label: '钢尺 L', value: 'L' }, { label: '卡尺 D', value: 'D' }, { label: '钢尺 H', value: 'H' }] },
    ];
    if (this.tool === 'd') {
      out.push({ type: 'segment', label: '测砧间', get: () => this.mic.obj != null, set: (v) => { this.mic.setObject(v ? this.balls[this.cur].d * 1000 : null); a.changed(); }, options: [{ label: '空（读零点）', value: false }, { label: '夹小球', value: true }] });
      out.push(...this.mic.controls(() => a.changed()));
    } else if (this.tool === 'D') out.push(...this.cal.controls(() => a.changed()));
    else out.push({ type: 'button', label: '重新量一次', onClick: () => { this.setTool(this.tool); a.changed(); } });
    out.push(
      { type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×2', value: 2 }, { label: '×4', value: 4 }] },
      { type: 'toggle', label: '读数辅助（显示数值）', get: () => this.assist, set: (v) => (this.assist = v) },
    );
    return out;
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'ball', title: '小球直径与下落时间', fixedRows: true,
        initRows: () => [{ k: 'z', what: '千分尺零点' }, ...BALLS.map(([id, dn]) => ({ k: id, what: `小球 ${id}（${dn} mm）` }))],
        columns: [
          { key: 'what', label: '', type: 'text', readonly: true },
          { key: 'r', label: '千分尺读数/mm', digits: 3, readTol: 0.0025 },
          { key: 'd', label: '直径 d/mm', digits: 3, calc: (r, i, rows) => (r.k === 'z' ? NaN : r.r - rows[0].r) },
          { key: 't', label: '下落时间 t/s', digits: 2, readTol: 0.011, optional: true },
        ],
        buttons: [{ label: '记录千分尺读数', onClick: (t) => this.recD(t) }, { label: '记录秒表读数', onClick: (t) => this.recT(t) }],
        note: '先读千分尺零点，再逐个测小球直径。小球经过上标线时开表、经过下标线时停表，时间记在该小球的行里。',
      },
      {
        id: 'misc', title: '其他量', fixedRows: true,
        initRows: () => MISC.map(([k, what]) => ({ k, what })),
        columns: [{ key: 'what', label: '待测量', type: 'text', readonly: true }, { key: 'v', label: '测量值', digits: 2, readTol: 0.05 }],
        buttons: [{ label: '记录当前量具读数', onClick: (t) => this.recM(t) }, { label: '记录油温', onClick: (t) => t.set(t.rows.findIndex((r) => r.k === 'T'), 'v', Math.round(this.T * 10) / 10) }],
        note: '量完所有小球后再测 L（两标线间距）、D、H，实验前后各读一次油温取平均（本实验中油温不变）。',
      },
    ];
  }
  recD(t) {
    const a = this.app;
    if (this.tool !== 'd') return a.toast('先在“量具”中选千分尺', 'warn');
    const p = this.mic.problem();
    if (p) { a.toast(p, 'warn'); if (this.mic.squeeze <= 0.0015) return; }
    const k = this.mic.obj == null ? 'z' : this.balls[this.cur].id;
    const i = t.rows.findIndex((r) => r.k === k);
    if (k !== 'z' && this.balls[this.cur].used) a.toast('这颗小球已经投放到油里了，量的是它投放前的直径吗？', 'warn');
    t.set(i, 'r', Math.round((this.mic.reading + (k === 'z' ? 0 : gauss(0.0008))) * 1000) / 1000);
  }
  recT(t) {
    const a = this.app, bl = this.ball;
    if (this.sw.run) return a.toast('秒表还在走', 'warn');
    if (!bl) return a.toast('还没有投放小球', 'warn');
    if (!(this.sw.value > 0)) return a.toast('秒表读数为零', 'warn');
    const i = t.rows.findIndex((r) => r.k === bl.b.id);
    if (bl.bubble > 0) a.toast('这颗小球没有先在油中浸润，表面带着小气泡，下落偏慢', 'warn');
    if (bl.ecc > 0.4) a.toast('这颗小球是靠近筒壁落下的，筒壁阻力比修正公式估计的大', 'warn');
    t.set(i, 't', this.sw.value);
  }
  recM(t) {
    const a = this.app, k = this.tool;
    if (k === 'd') return a.toast('千分尺的读数记在小球表里', 'warn');
    if (k === 'D') { const p = this.cal.problem(); if (p) return a.toast(p, 'warn'); }
    const i = t.rows.findIndex((r) => r.k === k);
    t.set(i, 'v', Math.round((k === 'D' ? this.cal.reading : this.tape.reading) * 100) / 100);
  }

  // ======================= 自动操作 =======================
  async knob(get, set, to, ms = 400) { await this.app.tween(get, set, to, ms); set(to); this.app.changed(); }
  async measureBall(i) {
    const a = this.app;
    this.cur = i; this.mic.setObject(this.balls[i].d * 1000); a.renderInspector();
    const s = this.balls[i].d * 1000;
    await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), s + 0.1, 250);
    await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), s - 0.02, 250);
    await a.record('ball', 0);
  }
  async fallOnce(i) {
    const a = this.app;
    this.cur = i; this.wet = true; this.onAxis = true; a.renderInspector();
    this.sw.reset(); this.auto = { phase: 'arm' };
    this.drop();
    while (this.auto) await a.wait(120);
    await a.record('ball', 1);
    while (this.ball && this.ball.y > (this.ball.b.d * 100) / 2 + 0.02) await a.wait(120);
  }
  steps() {
    const app = this.app, rows = () => app.table('ball').rows;
    const has = (r, k) => r[k] != null && r[k] !== '' && isFinite(r[k]);
    return [
      {
        title: '调整标线位置',
        html: '<p>上标线应在液面下 5 cm 以上（小球刚入液时受投放的扰动，还没有达到匀速），下标线离筒底也要有几厘米（筒底使小球减速）。两标线间距尽量大一些，计时的相对误差小。</p>',
        check: () => this.Hl * 100 - this.y1 >= 5 && this.y2 >= 4 && this.y1 - this.y2 >= 20,
        auto: async () => {
          await app.view('量筒'); app.select(app.comp('tube'));
          await this.knob(() => this.y1, (v) => (this.y1 = v), Math.round((this.Hl * 100 - 6) * 10) / 10);
          await this.knob(() => this.y2, (v) => (this.y2 = v), 5);
        },
      },
      {
        title: '用千分尺测小球直径',
        html: '<p>先合拢千分尺读零点。然后用镊子夹起小球放在测砧间，旋转测力装置夹住，读数。每颗小球都要测（编号对应，投放后就找不回来了）。</p>',
        check: () => rows().every((r) => has(r, 'r')),
        auto: async () => {
          app.showTable(0); this.setTool('d'); this.mic.setObject(null); app.renderInspector();
          await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), 0.3, 250);
          await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), -0.02, 250);
          await app.record('ball', 0);
          for (let i = 0; i < this.balls.length; i++) await this.measureBall(i);
        },
      },
      {
        title: '投放小球，测下落时间',
        html: '<p>小球先在油中浸润（去掉表面的气泡），用镊子在液面中心处放手，使它沿筒的中心轴下落。眼睛平视标线，小球经过上标线时开表，经过下标线时停表。6 颗小球各测一次。</p>',
        hint: '大球下落快，时间短，计时的相对误差大；小球下落慢，但直径测量的相对误差大。',
        check: () => rows().filter((r) => r.k !== 'z' && has(r, 't')).length >= 6,
        auto: async () => {
          await app.view('全景'); app.showTable(0);
          for (let i = 0; i < this.balls.length; i++) if (!this.balls[i].used) await this.fallOnce(i);
        },
      },
      {
        title: '测 L、D、H 和油温',
        html: '<p>用钢尺测两标线间距 L 和油柱高度 H，用游标卡尺的内量爪测量筒内径 D，读油温。</p>',
        check: () => app.table('misc').rows.every((r) => has(r, 'v')),
        auto: async () => {
          app.showTable(1);
          for (const k of ['L', 'D', 'H']) {
            this.setTool(k); app.renderInspector(); app.changed();
            if (k === 'D') { const s = this.Din * 1000; this.cal.open = s + 6; await this.knob(() => this.cal.open, (v) => this.cal.push(v), s - 1); }
            await app.wait(300); await app.record('misc', 0);
          }
          await app.record('misc', 1);
        },
      },
      {
        title: '数据处理',
        html: '<p>计算每颗小球给出的黏度，作筒壁、筒底修正；计算雷诺数，判断是否需要再作惯性修正。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, rows = a.table('ball').rows, z = +rows[0].r;
    const mv = Object.fromEntries(a.table('misc').rows.map((r) => [r.k, r.v === '' || r.v == null ? NaN : +r.v]));
    const okRow = (r) => r.k !== 'z' && isFinite(r.r) && r.r !== '' && r.r != null && isFinite(r.t) && r.t !== '' && r.t != null && r.t > 0;
    const data = rows.filter(okRow);
    if (!isFinite(z) || rows[0].r === '' || rows[0].r == null) return { html: '<p>请先读千分尺零点。</p>', ok: false };
    if (!data.length) return { html: '<p>请先测量小球直径和下落时间。</p>', ok: false };
    if (!['L', 'D', 'H'].every((k) => mv[k] > 0)) return { html: '<p>请先测 L、D、H。</p>', ok: false };
    const T = isFinite(mv.T) ? mv.T : this.T;
    const rho = RHO_LABEL * 1000, rho0 = RHO0_LABEL * 1000, L = mv.L / 100, D = mv.D / 1000, H = mv.H / 100;
    const res = data.map((r) => {
      const d = (r.r - z) / 1000, t = +r.t, v = L / t;
      const kw = 1 + (2.4 * d) / D, kb = 1 + (1.6 * d) / H;
      const eta = ((rho - rho0) * G * d * d * t) / (18 * L * kw * kb);
      const Re = (rho0 * v * d) / eta;
      const eta2 = eta / (1 + (3 * Re) / 16);
      return { id: r.k, d, t, v, kw, kb, eta, Re, eta2 };
    });
    const f = (x, n = 4) => x.toFixed(n);
    let html = `<h3>1. 各小球的结果</h3><p>ρ = ${RHO_LABEL.toFixed(2)} g/cm³，ρ₀ = ${RHO0_LABEL.toFixed(2)} g/cm³；L = ${f(mv.L, 2)} cm，D = ${f(mv.D, 2)} mm，H = ${f(mv.H, 2)} cm；千分尺零点 ${f(z, 3)} mm。</p>
      <table><tr><th>小球</th><th>d/mm</th><th>t/s</th><th>v/(mm/s)</th><th>1+2.4d/D</th><th>1+1.6d/H</th><th>η/(Pa·s)</th><th>Re</th><th>η′=η/(1+3Re/16)</th></tr>
      ${res.map((x) => `<tr><td>${x.id}</td><td>${f(x.d * 1000, 3)}</td><td>${f(x.t, 2)}</td><td>${f(x.v * 1000, 3)}</td><td>${f(x.kw, 4)}</td><td>${f(x.kb, 4)}</td><td>${f(x.eta, 4)}</td><td>${x.Re.toFixed(4)}</td><td>${f(x.eta2, 4)}</td></tr>`).join('')}</table>`;
    const grp = (p) => res.filter((x) => x.id[0] === p);
    const A = grp('A'), B = grp('B');
    const answers = [];
    if (A.length && B.length) {
      const eA = mean(A.map((x) => x.eta)), eB = mean(B.map((x) => x.eta));
      html += `<p>未作惯性修正时，小球 A 组平均 ${f(eA)} Pa·s，B 组 ${f(eB)} Pa·s，大球测得的值偏大 ${pct((eB - eA) / eA, 2)}——大球的雷诺数大，斯托克斯公式的误差也大。作 Oseen 修正后两组一致性更好。</p>`;
      answers.push({ label: '$\\eta_A$', unit: 'Pa·s', value: eA, digits: 4, tolRel: 0.006 });
    }
    const all = res.map((x) => x.eta2), em = mean(all);
    const uA = all.length > 1 ? stdev(all) / Math.sqrt(all.length) : 0;
    const rB = Math.hypot(0.04 / mean(res.map((x) => x.t)), 0.05 / mv.L, (2 * 0.001) / mean(res.map((x) => x.d * 1000)));
    const u = Math.hypot(uA, em * rB);
    html += `<h3>2. 结果</h3><div class="result-box">油温 ${f(T, 1)} °C 时，蓖麻油的黏滞系数 $\\eta=${fmtU(em, u)}$ Pa·s</div>
      <p>不确定度包括各次结果的分散（A 类 ${f(uA)} Pa·s）和计时、L、d 的测量误差（B 类约 ${pct(rB, 2)}）。蓖麻油的黏度随温度变化很快，约每升高 1 °C 减小 8%，所以必须同时报告油温。</p>`;
    const ref = this.eta;
    html += `<div class="result-box warn">本瓶蓖麻油在 ${this.T.toFixed(2)} °C 时的黏度参考值 ${ref.toFixed(4)} Pa·s，测量值相对误差 ${pct(relErr(em, ref), 2)}。</div>`;
    answers.push({ label: '$\\eta$', unit: 'Pa·s', value: em, digits: 4, tolRel: 0.006 });
    const plots = [{ title: 'η 与雷诺数', xLabel: 'Re', yLabel: 'η / (Pa·s)', series: [{ type: 'scatter', data: res.map((x) => [x.Re, x.eta]), label: '斯托克斯公式' }, { type: 'scatter', data: res.map((x) => [x.Re, x.eta2]), label: '惯性修正后' }] }];
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 斯托克斯公式</h3>${stokesFig()}<p>半径 $a$ 的小球在无限广延的黏滞液体中以很小的速度 $v$ 运动时，受到的阻力 $F=6\\pi\\eta av$。小球在液体中下落，受重力、浮力和阻力，很快达到匀速（收尾速度）：</p>$$\\frac43\\pi a^3(\\rho-\\rho_0)g=6\\pi\\eta av\\quad\\Rightarrow\\quad\\eta=\\frac{(\\rho-\\rho_0)gd^2}{18v}$$
<h3>2. 筒壁与筒底修正</h3><p>液体装在内径 $D$、深 $H$ 的圆筒中时，筒壁和筒底使阻力增大。常用的经验修正：</p>$$\\eta=\\frac{(\\rho-\\rho_0)gd^2t}{18L\\left(1+2.4\\dfrac dD\\right)\\left(1+1.6\\dfrac dH\\right)}$$<p>其中 $t$ 是小球匀速通过两标线（间距 $L$）的时间。</p>
<h3>3. 雷诺数</h3><p>斯托克斯公式只在雷诺数 $Re=\\rho_0vd/\\eta\\ll1$ 时成立。$Re$ 稍大时，阻力还要乘以 $(1+\\tfrac{3}{16}Re)$（Oseen 修正），由斯托克斯公式算出的 $\\eta$ 要除以这个因子。</p>
<h3>4. 本仿真的计算模型</h3><p>小球在每个位置的速度按收尾速度计算：筒壁修正用 Faxén 公式（与经验公式 $1+2.4d/D$ 相差约 0.3%），筒底修正用随离底高度变化的 Lorentz 公式，再乘以 Oseen 因子。刚入液的约 3 cm 内，小球受投放扰动略快；没有浸润的小球带着小气泡，有效密度小 1%–3%；偏离中心轴下落时筒壁阻力更大。蓖麻油的黏度按 Arrhenius 型公式随温度变化（20 °C 时约 1 Pa·s，每升高 1 °C 约减小 8%），每瓶油还有 ±5% 的批次差别。</p>`;
  }
}
