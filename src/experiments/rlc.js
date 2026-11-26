// 实验：RC、RLC 串联电路的暂态过程（方波激励，示波器观察）
// 电路由 spice-ts 按实际接线求周期稳态：信号发生器内阻 50 Ω、电感线圈的直流电阻与分布电容、示波器 1 MΩ∥20 pF 输入都在电路里。
import * as THREE from 'three';
import { meta, thumb } from './rlc.meta.js';
import { Circuit, benchTable, resistanceBox } from '../core/circuit.js';
import { funcGen, oscilloscope, capacitorBox, inductor } from '../core/oscillo.js';
import { VDIV, TDIV } from '../core/scopeEngine.js';
import { mean, rand, relErr, pct } from '../core/Stats.js';
import { rlcFig } from './circuitFigs.js';

const R_GEN = 50;

export class RlcExperiment {
  static meta = meta;
  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.RL = +rand(18, 32).toFixed(1);
  }

  cameras() {
    return [
      { name: '全景', pos: [0, 85, 95], target: [0, 2, -2] },
      { name: '示波器', pos: [10, 28, 36], target: [10, 9, -16] },
      { name: '元件', pos: [-10, 40, 56], target: [-10, 0, 16] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    const slot = (id, x, z, accepts) => app.addSlot({ id, pos: new THREE.Vector3(x, 0, z), accepts });
    slot('osc', 12, -22, ['osc']); slot('gen', -50, -18, ['gen']);
    slot('rbox', -42, 20, ['rbox']); slot('ind', -12, 22, ['ind']); slot('cbox', 18, 20, ['cbox']);
    this.view = app.addView({ id: 'scr', title: '示波器荧光屏', w: 360, h: 284, res: 1 });
    const cir = (this.cir = new Circuit(app));
    this.gen = cir.add(funcGen({ defaultSlot: 'gen', f: 500, vpp: 4, shape: 'square' }));
    this.rbox = cir.add(resistanceBox({ defaultSlot: 'rbox', cls: 0.1 }));
    this.ind = cir.add(inductor({ defaultSlot: 'ind', L: 10e-3, R: this.RL }));
    this.cbox = cir.add(capacitorBox({ defaultSlot: 'cbox', C: 0.1e-6 }));
    this.osc = cir.add(oscilloscope({ app, defaultSlot: 'osc', view: this.view }));
    this.rbox.set(1000);
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
  update() {
    const cir = this.cir;
    for (const d of cir.devices.values()) if (d.comp.placed && d.after) d.after();
    if (cir.placed('osc')) { this.osc.refresh(cir); this.osc.drawView(); }
    else { const v = this.view, c = v.ctx; c.fillStyle = '#2b2e31'; c.fillRect(0, 0, v.W, v.H); v.foot('示波器尚未放到桌上'); }
  }

  // ---------------- 接线判断 ----------------
  /** 从 gen:out 出发依次串联 chain 中的两端元件，最后回到信号发生器的地 */
  series(chain) {
    const cir = this.cir;
    if (!['gen', ...chain].every((k) => cir.placed(k))) return null;
    const n = cir.nets(), E = n('gen:gnd');
    const T = { rbox: ['a', 'b'], ind: ['a', 'b'], cbox: ['a', 'b'] };
    const walk = (i, node) => {
      if (i === chain.length) return node === E ? [] : null;
      const k = chain[i];
      for (const [p, q] of [T[k], [...T[k]].reverse()]) {
        if (n(`${k}:${p}`) !== node) continue;
        const rest = walk(i + 1, n(`${k}:${q}`));
        if (rest) return [{ k, p, q }, ...rest];
      }
      return null;
    };
    const path = walk(0, n('gen:out'));
    if (!path) return null;
    // 示波器 CH1 应接在电容的非接地端
    const c = path[path.length - 1];
    if (n('osc:ch1') !== n(`cbox:${c.p}`)) return null;
    return path;
  }
  rcOK() { return !!this.series(['rbox', 'cbox']); }
  rlcOK() { return !!this.series(['rbox', 'ind', 'cbox']); }

  /** CH1 一个周期的稳态波形（方波上升沿在 t=0） */
  wave() {
    const sig = this.osc.sig;
    if (!sig || sig.groups.length !== 1) return null;
    const g = sig.groups[0], d = g.data.ch1, n = d.length, dc = sig.dc.ch1 || 0;
    const u = new Float64Array(n);
    for (let i = 0; i < n; i++) u[i] = d[i] + dc;
    return { u, n, T: g.T };
  }
  /** 半衰期：上升沿后 u_C 升到始末值一半所需时间 */
  halfTime(w) {
    const { u, n, T } = w, u0 = u[0], uf = u[(n >> 1) - 2], half = (u0 + uf) / 2;
    for (let i = 1; i < n / 2; i++) if (u[i] >= half) return ((i - 1 + (half - u[i - 1]) / (u[i] - u[i - 1])) / n) * T;
    return NaN;
  }
  /** 欠阻尼：前两个峰（相对终值的过冲）及其时间间隔 */
  peaks(w) {
    const { u, n, T } = w, uf = u[(n >> 1) - 2], out = [];
    for (let i = 2; i < n / 2 - 2 && out.length < 2; i++) {
      if (u[i] > u[i - 1] && u[i] >= u[i + 1] && u[i] > uf) {
        const a = u[i - 1], b = u[i], c = u[i + 1], den = a - 2 * b + c, dx = den ? (0.5 * (a - c)) / den : 0;
        out.push({ t: ((i + dx) / n) * T, h: b - 0.25 * (a - c) * dx - uf });
      }
    }
    return { uf, u0: u[0], p: out };
  }
  tDiv() { const s = this.s; return TDIV[s.tdiv] / (s.mag ? 10 : 1); }
  tEff() { return this.tDiv() * this.eng.tcal; }
  hDiv(v) { return (v * this.eng.gain[0]) / this.eng.vEff(0); }

  commonChecks(needRLC) {
    const s = this.s, app = this.app;
    if (!this.cir.placed('osc') || !s.power) return app.toast('示波器没有打开', 'warn'), false;
    if (needRLC ? !this.rlcOK() : !this.rcOK()) return app.toast(needRLC ? '没有形成 R、L、C 串联电路，或 CH1 没有接在电容两端' : '没有形成 R、C 串联电路，或 CH1 没有接在电容两端', 'warn'), false;
    if (!this.gen.on || this.gen.shape !== 'square') return app.toast('信号发生器应输出方波', 'warn'), false;
    if (s.mode !== 'CH1' && s.mode !== 'DUAL') return app.toast('垂直方式请选 CH1 或双踪', 'warn'), false;
    if (s.ch[0].cpl !== 'DC') return app.toast('观察暂态过程应使用 DC 耦合', 'warn'), false;
    if (!this.eng.triggered) return app.toast('波形不稳定，请调触发', 'warn'), false;
    if (s.tvar < 0.999) app.toast('扫描“微调”不在校准位置，时间读数不准', 'warn');
    this.osc.refresh(this.cir);
    if (this.osc.busy || !this.osc.sig) return app.toast('示波器还在计算电路，稍等再记录', 'warn'), false;
    return true;
  }

  tables() {
    return [
      {
        id: 'rc', title: 'RC 电路的时间常数（半衰期法）',
        columns: [
          { key: 'R', label: 'R/Ω', digits: 1, auto: true },
          { key: 'C', label: 'C/μF', digits: 3, auto: true },
          { key: 'td', label: 'ms/div', digits: 4, auto: true },
          { key: 'x', label: '上升到 50% 用的格数', digits: 2, readTol: 0.1 },
          { key: 'th', label: 't½/ms', digits: 4, calc: (r) => r.x * r.td },
          { key: 'tau', label: 'τ=t½/ln2 /ms', digits: 4, calc: (r) => (r.x * r.td) / Math.LN2 },
        ],
        maxRows: 10,
        buttons: [{ label: '记录一组', onClick: (t) => this.recRC(t) }],
        note: '可以调 CH1 “微调”使充电曲线的起点和终点正好落在 0% 和 100% 虚线上，50% 点就在中心水平线上。',
      },
      {
        id: 'rlc', title: 'RLC 欠阻尼振荡',
        columns: [
          { key: 'R', label: '电阻箱 R/Ω', digits: 1, auto: true },
          { key: 'td', label: 'ms/div', digits: 4, auto: true },
          { key: 'D', label: '2 个周期/div', digits: 2, readTol: 0.12 },
          { key: 'h1', label: '第1峰过冲/div', digits: 2, readTol: 0.12 },
          { key: 'h2', label: '第2峰过冲/div', digits: 2, readTol: 0.12 },
          { key: 'Td', label: 'T_d/ms', digits: 4, calc: (r) => (r.D * r.td) / 2 },
          { key: 'dl', label: 'δ=ln(h₁/h₂)', digits: 3, calc: (r) => Math.log(r.h1 / r.h2) },
          { key: 'Rt', label: '总电阻 2Lδ/T_d /Ω', digits: 1, calc: (r) => (2 * 0.01 * Math.log(r.h1 / r.h2)) / ((r.D * r.td) / 2000) },
        ],
        maxRows: 10,
        buttons: [{ label: '记录一组', onClick: (t) => this.recRLC(t) }],
        note: '过冲从波形最终稳定的电平量起。L 取标称值 10 mH。',
      },
      {
        id: 'crit', title: '临界阻尼',
        columns: [
          { key: 'R', label: '电阻箱 R/Ω', digits: 1, auto: true },
          { key: 'Rc', label: '回路总电阻 R+50+R_L /Ω', digits: 1, calc: (r) => r.R + R_GEN + this.RL },
        ],
        maxRows: 6,
        buttons: [{ label: '记录：刚好不再出现过冲', onClick: (t) => this.recCrit(t) }],
        note: `从欠阻尼开始逐渐增大电阻，记下波形刚好不再越过终值时的电阻。信号发生器内阻 50 Ω，电感线圈直流电阻 ${this.RL} Ω。`,
      },
    ];
  }

  recRC(t) {
    if (!this.commonChecks(false)) return;
    const w = this.wave(), app = this.app;
    if (!w) return app.toast('只能接一个信号源', 'warn');
    const th = this.halfTime(w), C = this.cbox.nominal();
    const tau = (this.rbox.nominal() + R_GEN) * C;
    if (w.T / 2 < 5 * tau) app.toast('方波半周期小于 5τ，电容来不及充满，应降低方波频率', 'warn');
    const x = th / this.tEff();
    if (!(x > 0) || x > 10) return app.toast('50% 点不在屏幕上，调整 TIME/DIV', 'warn');
    if (x < 1.5) app.toast('t½ 不到 1.5 格，读数误差大。减小 TIME/DIV 或用 ×10 扩展', 'warn');
    t.addRow({ R: this.rbox.nominal(), C: +(C * 1e6).toFixed(4), td: this.tDiv() * 1000, x: +x.toFixed(3) });
  }
  recRLC(t) {
    if (!this.commonChecks(true)) return;
    const w = this.wave(), app = this.app;
    if (!w) return app.toast('只能接一个信号源', 'warn');
    const { p } = this.peaks(w);
    if (p.length < 2) return app.toast('看不到两个过冲峰：电路不是欠阻尼状态，减小电阻', 'warn');
    const h1 = this.hDiv(p[0].h), h2 = this.hDiv(p[1].h), D = (2 * (p[1].t - p[0].t)) / this.tEff();
    if (h2 < 0.3) app.toast('第二个峰太低（不到 0.3 格），减小 V/div 或减小电阻', 'warn');
    if (h1 > 8) return app.toast('过冲超出屏幕，增大 V/div', 'warn');
    if (D > 10.2) return app.toast('两个周期超出屏幕，增大 TIME/DIV', 'warn');
    if (D < 3) app.toast('两个周期不到 3 格，可减小 TIME/DIV', 'warn');
    t.addRow({ R: this.rbox.nominal(), td: this.tDiv() * 1000, D: +D.toFixed(3), h1: +h1.toFixed(3), h2: +h2.toFixed(3) });
  }
  recCrit(t) {
    if (!this.commonChecks(true)) return;
    const w = this.wave(), app = this.app;
    if (!w) return;
    const { uf, u0, p } = this.peaks(w);
    const over = p.length ? p[0].h / Math.abs(uf - u0) : 0;
    const Rt = this.rbox.nominal() + R_GEN + this.RL, Rc = 2 * Math.sqrt(this.ind.L / (this.cbox.value() + 20e-12));
    if (this.hDiv(p.length ? p[0].h : 0) > 0.1) app.toast(`还能看到过冲（约 ${pct(over, 1)}），继续增大电阻`, 'warn');
    else if (Rt > 1.4 * Rc) app.toast('已经明显过阻尼（上升很慢）。减小电阻，找刚好不过冲的位置', 'warn');
    t.addRow({ R: this.rbox.nominal() });
  }

  // ---------------- 自动操作 ----------------
  async idle() { if (this.cir.placed('osc')) this.osc.refresh(this.cir); const t0 = performance.now(); while ((this.osc.busy || !this.osc.sig) && performance.now() - t0 < 6000) await this.app.wait(30, true); await this.app.wait(150, true); }
  async scope(fn, ms = 200) { this.app.select(this.osc.comp); fn(this.s); this.app.changed(); await this.app.wait(ms); }
  async setGen(f) {
    const app = this.app, g = this.gen;
    app.select(g.comp);
    g.on = true; g.shape = 'square'; g.vpp = 4; g.offOn = true; g.off = 2;
    g.range = [10, 100, 1e3, 1e4, 1e5, 1e6].findIndex((r) => f <= 2 * r);
    await app.tween(() => g.f, (v) => g.setF(v), f, 400);
  }
  async setRC(R, C) {
    const app = this.app;
    app.select(this.rbox.comp); this.rbox.set(R); app.changed(); await app.wait(200);
    app.select(this.cbox.comp); this.cbox.set(C); app.changed(); await app.wait(200);
  }
  baseScope(x) {
    x.power = true; x.inten = 0.6; x.focus = 0.5; x.mode = 'DUAL'; x.mag = false; x.tvar = 1; x.xpos = 0;
    x.ch[0].cpl = 'DC'; x.ch[1].cpl = 'DC'; x.ch[0].vdiv = 7; x.ch[1].vdiv = 8; x.ch[0].var = 1; x.ch[1].var = 1;
    x.ch[0].pos = -3.6; x.ch[1].pos = 1.6; x.trig.src = 1; x.trig.slope = 1; x.trig.level = 1; x.trig.mode = 'AUTO'; // CH2 2 V/div：方波占 1.6～3.6 格
  }
  wiring(rlc) {
    const base = rlc ? [['gen:out', 'rbox:b'], ['rbox:a', 'ind:a'], ['ind:b', 'cbox:a']] : [['gen:out', 'rbox:b'], ['rbox:a', 'cbox:a']];
    return [...base, ['cbox:b', 'gen:gnd'], ['osc:ch1', 'cbox:a'], ['osc:gnd', 'cbox:b'], ['osc:ch2', 'gen:out']];
  }

  steps() {
    const app = this.app, cir = this.cir, s = this.s;
    const rows = (id) => app.table(id).completeRows();
    return [
      {
        title: '摆放仪器',
        html: '<p>把示波器、函数信号发生器、电阻箱、电感线圈和电容箱放到实验桌上。</p>',
        check: () => ['osc', 'gen', 'rbox', 'ind', 'cbox'].every((k) => cir.placed(k)),
        auto: async () => { await app.view('全景'); for (const k of ['osc', 'gen', 'rbox', 'ind', 'cbox']) await app.autoPlace(k); },
      },
      {
        title: '连接 RC 串联电路',
        html: '<p>信号发生器“输出” → 电阻箱 → 电容箱 → 信号发生器“⊥”。示波器 CH1 接电容的非接地端（看 $u_C$），CH2 接信号发生器输出（看方波），示波器“⊥”接电容的接地端。</p><p>信号发生器输出方波，幅度 4 Vpp，打开直流偏置并调到 2 V，使方波在 0 与 4 V 之间跳变——这相当于反复接通、断开一个 4 V 的直流电源。</p>',
        hint: '示波器的地与信号发生器的地经电源插头相通，所以示波器的“⊥”只能接电路的接地点，否则会把一部分电路短路。',
        check: () => this.rcOK() && this.gen.on && this.gen.shape === 'square' && s.power,
        status: () => (this.rcOK() ? '已形成 RC 串联电路' : '尚未形成 RC 串联电路') + (this.gen.on && this.gen.shape === 'square' ? ' · 方波输出' : ' · 发生器未输出方波'),
        auto: async () => {
          await cir.rewire(this.wiring(false));
          await this.setRC(1000, 0.1e-6);
          await this.setGen(500);
          await this.scope((x) => { this.baseScope(x); x.tdiv = 11; });
        },
      },
      {
        title: '半衰期法测时间常数',
        html: '<p>方波的半个周期应大于 5τ，电容才能充满。触发源选 CH2、上升沿，使扫描从方波的上升沿开始。调 TIME/DIV，使充电曲线展开，读出 $u_C$ 从起点升到终值一半所用的格数，得半衰期 $t_{1/2}$，</p>$$\\tau=\\frac{t_{1/2}}{\\ln 2}$$<p>改变 R 或 C，测 3 组以上。</p>',
        hint: '把 CH1 的“微调”调到使充电曲线的始末正好落在 0% 和 100% 两条虚线上（相距 5 格），50% 点就落在中心横线上，读数最方便。这时纵向读数不必校准。',
        check: () => new Set(rows('rc').map((r) => +(r.R * r.C).toPrecision(3))).size >= 3,
        status: () => `已测 ${new Set(rows('rc').map((r) => +(r.R * r.C).toPrecision(3))).size} 种 RC 组合`,
        auto: async () => {
          for (const [R, C] of [[1000, 0.1e-6], [2000, 0.1e-6], [1000, 0.47e-6]]) {
            await this.setRC(R, C);
            const tau = (R + R_GEN) * C;
            await this.setGen(+(1 / (20 * tau)).toPrecision(3));
            await this.scope((x) => { let k = TDIV.findIndex((td) => td > 0.33 * tau); x.tdiv = Math.max(0, k - 1); });
            await app.view('示波器'); await this.idle();
            await app.record('rc');
          }
        },
      },
      {
        title: '改接 RLC 串联电路',
        html: '<p>在电阻箱与电容箱之间串入电感线圈，电容取 0.1 μF，电阻箱先调到 0。方波频率降到 250 Hz 左右，使每半个周期里振荡能充分衰减。</p>',
        check: () => this.rlcOK(),
        status: () => (this.rlcOK() ? '已形成 RLC 串联电路' : '尚未形成 RLC 串联电路'),
        auto: async () => {
          await app.view('全景');
          await cir.rewire(this.wiring(true));
          await this.setRC(0, 0.1e-6);
          await this.setGen(250);
          await this.scope((x) => { this.baseScope(x); x.tdiv = 9; });
        },
      },
      {
        title: '欠阻尼：测振荡周期和衰减',
        html: '<p>电阻较小时 $u_C$ 在终值附近衰减振荡。读出 2 个周期的长度，求振荡周期 $T_d$；读出相邻两个峰相对终值的过冲 $h_1$、$h_2$，求对数衰减率 $\\delta=\\ln(h_1/h_2)=\\beta T_d$，得回路总电阻</p>$$R_{总}=2L\\beta=\\frac{2L\\delta}{T_d}$$<p>电阻箱取 0 Ω 和 50 Ω 左右各测一组。</p>',
        hint: '用垂直位移把终值电平移到一条横刻度线上，过冲高度就容易读了。',
        check: () => new Set(rows('rlc').map((r) => r.R)).size >= 2,
        status: () => `已测 ${new Set(rows('rlc').map((r) => r.R)).size} 种电阻`,
        auto: async () => {
          for (const R of [0, 50]) {
            await this.setRC(R, 0.1e-6);
            await this.scope((x) => { x.tdiv = 9; });
            await app.view('示波器'); await this.idle();
            await app.record('rlc');
          }
        },
      },
      {
        title: '找临界阻尼',
        html: '<p>逐渐增大电阻箱的阻值，振荡越来越弱。当 $u_C$ 刚好不再越过终值时，电路处于临界阻尼，记下电阻。继续增大电阻，观察过阻尼时 $u_C$ 缓慢地趋于终值。</p><p>理论上临界电阻 $R_c=2\\sqrt{L/C}$，它是回路的<b>总电阻</b>，包括信号发生器内阻和线圈的直流电阻。</p>',
        hint: '过冲小于 1% 时肉眼已很难分辨，所以实测的临界电阻一般比理论值小一些。可以把 V/div 调小、用垂直位移把终值移到屏幕中央再细看。',
        check: () => rows('crit').length >= 1,
        status: () => `已记录 ${rows('crit').length} 次`,
        auto: async () => {
          const Rc = 2 * Math.sqrt(this.ind.L / (this.cbox.value() + 20e-12));
          await this.setRC(Math.round(Rc - R_GEN - this.RL) - 20, 0.1e-6);
          await this.scope((x) => { x.tdiv = 10; });
          await app.view('示波器'); await this.idle();
          await app.record('crit');
          await this.setRC(Math.round(3 * Rc), 0.1e-6); await this.idle();
        },
      },
      {
        title: '数据处理',
        html: '<p>比较 τ 的测量值与 $(R+R_0)C$；比较 $T_d$、$R_{总}$ 和临界电阻的测量值与理论值。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const app = this.app, L = 0.01;
    const RC = app.table('rc').completeRows(), RL = app.table('rlc').completeRows(), CR = app.table('crit').completeRows();
    if (!RC.length && !RL.length && !CR.length) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = '';
    const answers = [], plots = [];
    if (RC.length) {
      html += '<h3>RC 电路</h3><table><tr><th>R/Ω</th><th>C/μF</th><th>τ 测量/ms</th><th>$RC$/ms</th><th>$(R+R_0)C$/ms</th><th>相对偏差</th></tr>';
      RC.forEach((r, i) => {
        const tau = (r.x * r.td) / Math.LN2, t0 = (r.R * r.C) / 1000, t1 = ((r.R + R_GEN) * r.C) / 1000;
        html += `<tr><td>${r.R}</td><td>${r.C}</td><td>${tau.toFixed(4)}</td><td>${t0.toFixed(4)}</td><td>${t1.toFixed(4)}</td><td>${pct((tau - t1) / t1, 1)}</td></tr>`;
        answers.push({ label: `第 ${i + 1} 组的时间常数 τ`, unit: 'ms', value: tau, digits: 4, tolRel: 0.01 });
      });
      html += `</table><p>$R_0=50\\ \\Omega$ 是信号发生器的输出电阻，它与 R 串联，充放电的时间常数是 $(R+R_0)C$。偏差主要来自示波器扫描时间的误差（±3% 以内）和读数。</p>`;
      plots.push({ title: 'τ 测量值与 (R+R₀)C', xLabel: '(R+R₀)C / ms', yLabel: 'τ / ms', series: [{ type: 'scatter', data: RC.map((r) => [((r.R + R_GEN) * r.C) / 1000, (r.x * r.td) / Math.LN2]) }, { type: 'line', data: [[0, 0], [Math.max(...RC.map((r) => ((r.R + R_GEN) * r.C) / 1000)) * 1.1, Math.max(...RC.map((r) => ((r.R + R_GEN) * r.C) / 1000)) * 1.1]], dash: [5, 4] }] });
    }
    if (RL.length) {
      html += `<h3>RLC 欠阻尼振荡</h3><p>$L=10$ mH（标称），$C=0.1\\ \\mu$F，$R_0=50\\ \\Omega$，$R_L=${this.RL}\\ \\Omega$。</p><table><tr><th>R/Ω</th><th>$T_d$ 测量/ms</th><th>$T_d$ 理论/ms</th><th>δ</th><th>$R_总$ 测量/Ω</th><th>$R+R_0+R_L$/Ω</th></tr>`;
      RL.forEach((r, i) => {
        const Td = (r.D * r.td) / 2, dl = Math.log(r.h1 / r.h2), Rt = (2 * L * dl) / (Td / 1000);
        const Rs = r.R + R_GEN + this.RL, C = 0.1e-6, w2 = 1 / (L * C) - (Rs / (2 * L)) ** 2;
        const Tth = w2 > 0 ? (2 * Math.PI) / Math.sqrt(w2) * 1000 : NaN;
        html += `<tr><td>${r.R}</td><td>${Td.toFixed(4)}</td><td>${Tth.toFixed(4)}</td><td>${dl.toFixed(3)}</td><td>${Rt.toFixed(1)}</td><td>${Rs.toFixed(1)}</td></tr>`;
        if (!i) answers.push({ label: '第 1 组求得的回路总电阻', unit: 'Ω', value: Rt, digits: 1, tolRel: 0.02 });
      });
      html += '</table><p>$T_d$ 比无阻尼的固有周期 $2\\pi\\sqrt{LC}$ 略长。由衰减求出的总电阻对过冲读数很敏感（$h_2$ 读错 0.1 格，δ 就变化几个百分点）；计算时 L 取标称值，而电感本身有 ±2% 的误差，这也会使 $T_d$ 与 $R_总$ 偏离理论值。真实线圈在交流下还有涡流、趋肤效应等附加损耗（本仿真未计入），实测 $R_总$ 常比直流电阻之和略大。</p>';
    }
    if (CR.length) {
      const Rm = mean(CR.map((r) => r.R + R_GEN + this.RL)), Rc = 2 * Math.sqrt(L / 0.1e-6);
      html += `<h3>临界阻尼</h3><div class="result-box">临界电阻实测（回路总电阻）$R_c=${Rm.toFixed(0)}\\ \\Omega$，理论值 $2\\sqrt{L/C}=${Rc.toFixed(0)}\\ \\Omega$，相对偏差 ${pct((Rm - Rc) / Rc, 1)}</div><p>阻尼比 ζ=0.8 时过冲只有 1.5%，ζ=0.9 时只有 0.15%，凭眼睛很难分辨，因此实测值通常偏小 10%～20%。</p>`;
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `${rlcFig()}<h3>1. RC 电路</h3><p>方波由 0 跳到 $U$ 时电容充电，$u_C=U\\left(1-e^{-t/\\tau}\\right)$；跳回 0 时放电，$u_C=Ue^{-t/\\tau}$，$\\tau=RC$。$u_C$ 变化到一半所用的时间 $t_{1/2}=\\tau\\ln 2$。方波半周期大于约 5τ 时，每次充放电都能基本完成。</p>
<h3>2. RLC 串联电路</h3><p>$LC\\dfrac{d^2u_C}{dt^2}+RC\\dfrac{du_C}{dt}+u_C=U$。令 $\\beta=\\dfrac{R}{2L}$，$\\omega_0=\\dfrac{1}{\\sqrt{LC}}$：</p>
<p>欠阻尼（$R<2\\sqrt{L/C}$）：$u_C=U\\left[1-e^{-\\beta t}\\left(\\cos\\omega_dt+\\dfrac{\\beta}{\\omega_d}\\sin\\omega_dt\\right)\\right]$，$\\omega_d=\\sqrt{\\omega_0^2-\\beta^2}$，振荡周期 $T_d=2\\pi/\\omega_d$，相邻两峰过冲之比 $h_1/h_2=e^{\\beta T_d}$。</p>
<p>临界阻尼（$R=R_c=2\\sqrt{L/C}$）：$u_C=U\\left[1-(1+\\omega_0t)e^{-\\omega_0t}\\right]$，最快地无振荡趋于终值。</p><p>过阻尼（$R>R_c$）：无振荡，缓慢趋于终值。</p>
<p>以上各式中的 $R$ 是回路的<b>总电阻</b>：电阻箱阻值、信号发生器输出电阻 $R_0=50\\ \\Omega$ 与线圈直流电阻 $R_L$ 之和。</p>
<h3>3. 本仿真的计算模型</h3><p>按实际接线列出电路，包括信号发生器内阻、线圈直流电阻与约 30 pF 分布电容、电容箱约 5 pF 分布电容、示波器 1 MΩ∥20 pF 输入，交给开源 SPICE 引擎 spice-ts 计算，用打靶法求方波激励下的周期稳态。元件值有出厂误差：电感 ±2%，电容箱 0.5 级，电阻箱 0.1 级；示波器扫描时间误差在 ±2% 以内。</p>`;
  }
}
