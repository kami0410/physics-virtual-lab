// 实验：RC、RLC 串联电路的稳态特性（正弦激励，双踪示波器测幅度与相位差）
// 仪器与电路计算与暂态实验相同：spice-ts 按实际接线求周期稳态，信号发生器内阻 50 Ω、线圈直流电阻与分布电容、
// 示波器输入阻抗都在电路里。电阻接在接地端，CH2 看电阻电压（代表电流），CH1 看信号发生器输出端（总电压）。
import * as THREE from 'three';
import { meta, thumb } from './rlcss.meta.js';
import { Circuit, benchTable, resistanceBox } from '../core/circuit.js';
import { funcGen, oscilloscope, capacitorBox, inductor } from '../core/oscillo.js';
import { VDIV, TDIV } from '../core/scopeEngine.js';
import { rand, linFit, relErr, pct } from '../core/Stats.js';

const DEG = 180 / Math.PI;

export class RlcSteadyExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) { this.app = app; this.RL = +rand(18, 32).toFixed(1); }

  cameras() {
    return [
      { name: '全景', pos: [0, 85, 95], target: [0, 2, -2] },
      { name: '示波器', pos: [10, 28, 36], target: [10, 9, -16] },
    ];
  }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    const slot = (id, x, z, accepts) => app.addSlot({ id, pos: new THREE.Vector3(x, 0, z), accepts });
    slot('osc', 12, -22, ['osc']); slot('gen', -50, -18, ['gen']);
    slot('ind', -42, 22, ['ind']); slot('cbox', -12, 20, ['cbox']); slot('rbox', 22, 20, ['rbox']);
    this.view = app.addView({ id: 'scr', title: '示波器荧光屏', w: 360, h: 284, res: 1 });
    const cir = (this.cir = new Circuit(app));
    this.gen = cir.add(funcGen({ defaultSlot: 'gen', f: 1000, vpp: 4, shape: 'sine' }));
    this.ind = cir.add(inductor({ defaultSlot: 'ind', L: 10e-3, R: this.RL }));
    this.cbox = cir.add(capacitorBox({ defaultSlot: 'cbox', C: 0.1e-6 }));
    this.rbox = cir.add(resistanceBox({ defaultSlot: 'rbox', cls: 0.1 }));
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
  /** gen:out → chain 中元件依次串联 → gen:gnd；电阻箱在最后（接地端），CH1 接 gen:out，CH2 接电阻箱非接地端 */
  series(chain) {
    const cir = this.cir;
    if (!['gen', 'osc', ...chain].every((k) => cir.placed(k))) return false;
    const n = cir.nets(), E = n('gen:gnd');
    const walk = (i, node) => {
      if (i === chain.length) return node === E ? [] : null;
      const k = chain[i];
      for (const [p, q] of [['a', 'b'], ['b', 'a']]) {
        if (n(`${k}:${p}`) !== node) continue;
        const rest = walk(i + 1, n(`${k}:${q}`));
        if (rest) return [{ k, p, q }, ...rest];
      }
      return null;
    };
    const path = walk(0, n('gen:out'));
    if (!path) return false;
    const r = path[path.length - 1];
    return n('osc:ch1') === n('gen:out') && n('osc:ch2') === n(`rbox:${r.p}`) && n('osc:gnd') === E;
  }
  rcOK() { return this.series(['cbox', 'rbox']); }
  rlcOK() { return this.series(['ind', 'cbox', 'rbox']); }

  /** 两个通道的基波：峰峰值（V）与 CH2 相对 CH1 的超前角（度） */
  phasors() {
    const sig = this.osc.sig;
    if (!sig || sig.groups.length !== 1) return null;
    const g = sig.groups[0], out = {};
    for (const c of ['ch1', 'ch2']) {
      const d = g.data[c], n = d.length;
      let a = 0, b = 0, mx = -Infinity, mn = Infinity;
      for (let i = 0; i < n; i++) { const th = (2 * Math.PI * i) / n; a += d[i] * Math.cos(th); b += d[i] * Math.sin(th); mx = Math.max(mx, d[i]); mn = Math.min(mn, d[i]); }
      out[c] = { vpp: mx - mn, ph: Math.atan2(b, a) };
    }
    let lead = (out.ch1.ph - out.ch2.ph) * DEG; // u = A cos(ωt − ph)：ph 小的超前
    lead = ((lead + 540) % 360) - 180;
    return { v1: out.ch1.vpp, v2: out.ch2.vpp, lead, T: g.T };
  }
  tEff() { const s = this.s; return (TDIV[s.tdiv] / (s.mag ? 10 : 1)) * this.eng.tcal; }
  div(c, v) { return (v * this.eng.gain[c]) / this.eng.vEff(c); }

  common(rlc) {
    const s = this.s, app = this.app;
    if (!this.cir.placed('osc') || !s.power) return app.toast('示波器没有打开', 'warn'), false;
    if (!(rlc ? this.rlcOK() : this.rcOK())) return app.toast(rlc ? '没有接成“输出 → 电感 → 电容 → 电阻箱 → ⊥”，或 CH1、CH2 接错' : '没有接成“输出 → 电容 → 电阻箱 → ⊥”，或 CH1 没接输出端、CH2 没接电阻箱的非接地端', 'warn'), false;
    if (!this.gen.on || this.gen.shape !== 'sine') return app.toast('信号发生器应输出正弦波', 'warn'), false;
    if (this.gen.offOn && this.gen.off) app.toast('信号发生器加了直流偏置，最好关掉', 'warn');
    this.osc.refresh(this.cir);
    if (this.osc.busy || !this.osc.sig) return app.toast('示波器还在计算电路，稍等再记录', 'warn'), false;
    return true;
  }

  tables() {
    return [
      {
        id: 'rc', title: 'RC 电路的相频特性', maxRows: 10,
        columns: [
          { key: 'f', label: 'f/Hz', digits: 1, auto: true },
          { key: 'X', label: '一个周期/div', digits: 2, readTol: 0.1 },
          { key: 'dx', label: 'CH2 超前/div', digits: 2, readTol: 0.1 },
          { key: 'phi', label: 'φ/°', digits: 1, calc: (r) => (360 * r.dx) / r.X },
        ],
        buttons: [{ label: '记录一组', onClick: (t) => this.recRC(t) }],
        note: '双踪显示，CH1 为总电压 u，CH2 为电阻电压 u_R（与电流同相）。读一个周期的长度和两条曲线过零点的水平距离，φ = 360°·Δx/X。可以用“微调”把一个周期调成整格数。',
      },
      {
        id: 'res', title: 'RLC 串联谐振曲线', maxRows: 18,
        columns: [
          { key: 'f', label: 'f/Hz', digits: 1, auto: true },
          { key: 'R', label: 'R/Ω', digits: 1, auto: true },
          { key: 'v1', label: 'CH1 V/div', digits: 3, auto: true },
          { key: 'A1', label: 'u 峰峰/div', digits: 2, readTol: 0.1 },
          { key: 'v2', label: 'CH2 V/div', digits: 3, auto: true },
          { key: 'A2', label: 'u_R 峰峰/div', digits: 2, readTol: 0.1 },
          { key: 'Y', label: 'I/U /mS', digits: 3, calc: (r) => ((r.A2 * r.v2) / r.R / (r.A1 * r.v1)) * 1000 },
        ],
        buttons: [{ label: '记录一组', onClick: (t) => this.recRes(t) }],
        note: '每改一次频率读一次两路峰峰值（纵向“微调”必须在校准位置）。信号发生器有 50 Ω 内阻，输出端电压随频率变化，所以用 I/U 作谐振曲线。谐振峰附近和两侧半功率点附近多测几点。',
      },
      {
        id: 'f0', title: '谐振频率', maxRows: 4,
        columns: [{ key: 'f0', label: 'f₀/Hz', digits: 1, auto: true }],
        buttons: [{ label: '记录当前频率为谐振频率', onClick: (t) => this.recF0(t) }],
        note: '谐振时 u 与 u_R 同相：双踪显示两条曲线同时过零；X-Y 方式下李萨如图形闭合成一条直线。',
      },
    ];
  }
  recRC(t) {
    if (!this.common(false)) return;
    const p = this.phasors(), app = this.app;
    if (!p) return app.toast('只能接一个信号源', 'warn');
    if (this.s.mode !== 'DUAL') return app.toast('测相位差要用双踪显示', 'warn');
    const X = p.T / this.tEff(), dx = (p.lead / 360) * X;
    if (X > 10.2) return app.toast('一个周期超出了屏幕：增大 TIME/DIV', 'warn');
    if (X < 4) app.toast('一个周期不到 4 格，相位差读不准：减小 TIME/DIV 或用扫描微调把一个周期展宽', 'warn');
    if (p.lead < 0) app.toast('CH2 比 CH1 落后？RC 电路中电流应超前总电压，检查接线', 'warn');
    t.addRow({ f: +this.gen.f.toPrecision(6), X: +X.toFixed(3), dx: +dx.toFixed(3) });
  }
  recRes(t) {
    if (!this.common(true)) return;
    const p = this.phasors(), app = this.app, s = this.s;
    if (!p) return app.toast('只能接一个信号源', 'warn');
    if (s.ch[0].var < 0.999 || s.ch[1].var < 0.999) return app.toast('纵向“微调”不在校准位置，幅度读数不准', 'warn');
    const A1 = this.div(0, p.v1), A2 = this.div(1, p.v2);
    if (A1 > 8.05 || A2 > 8.05) return app.toast('波形超出屏幕：增大 V/div', 'warn');
    if (A2 < 1.5 || A1 < 1.5) app.toast('波形不到 1.5 格高，读数误差大：减小 V/div', 'warn');
    if (t.rows.some((r) => Math.abs(r.f - this.gen.f) < 0.5)) return app.toast('这个频率已经记过了', 'warn');
    t.addRow({ f: +this.gen.f.toPrecision(6), R: this.rbox.nominal(), v1: VDIV[s.ch[0].vdiv], A1: +A1.toFixed(3), v2: VDIV[s.ch[1].vdiv], A2: +A2.toFixed(3) });
  }
  recF0(t) {
    if (!this.common(true)) return;
    const p = this.phasors(), app = this.app;
    if (!p) return;
    if (Math.abs(p.lead) > 2) return app.toast(`u 与 u_R 还有约 ${Math.abs(p.lead).toFixed(0)}° 的相位差（李萨如图形还是椭圆），${p.lead > 0 ? '升高' : '降低'}频率`, 'warn');
    t.addRow({ f0: +this.gen.f.toPrecision(6) });
  }

  // ---------------- 自动操作 ----------------
  async idle() { if (this.cir.placed('osc')) this.osc.refresh(this.cir); const t0 = performance.now(); while ((this.osc.busy || !this.osc.sig) && performance.now() - t0 < 6000) await this.app.wait(30, true); await this.app.wait(150, true); }
  async scope(fn, ms = 200) { this.app.select(this.osc.comp); fn(this.s); this.app.changed(); await this.app.wait(ms); }
  async setGen(f, vpp = 4) {
    const app = this.app, g = this.gen;
    app.select(g.comp);
    g.on = true; g.shape = 'sine'; g.vpp = vpp; g.offOn = false; g.off = 0;
    g.range = [10, 100, 1e3, 1e4, 1e5, 1e6].findIndex((r) => f <= 2 * r);
    g.setF(f); app.changed(); await app.wait(60); // 直接置数：中间频率都要重算电路，旋钮动画只会拖慢
  }
  baseScope(x) {
    x.power = true; x.inten = 0.6; x.focus = 0.5; x.mode = 'DUAL'; x.mag = false; x.tvar = 1; x.xpos = 0;
    x.ch[0].cpl = 'AC'; x.ch[1].cpl = 'AC'; x.ch[0].var = 1; x.ch[1].var = 1; x.ch[0].pos = 0; x.ch[1].pos = 0; x.ch[1].inv = false;
    x.trig.src = 0; x.trig.slope = 1; x.trig.level = 0; x.trig.mode = 'AUTO';
  }
  /** 让一个周期在 4–10 格之间 */
  tdivFor(f) { const T = 1 / f; let k = TDIV.findIndex((td) => T / td <= 9.2); return Math.max(0, k); }
  vdivFor(vpp) { let k = VDIV.findIndex((v) => vpp / v <= 7.5); return k < 0 ? VDIV.length - 1 : k; }
  wiring(rlc) {
    const chain = rlc ? [['gen:out', 'ind:a'], ['ind:b', 'cbox:a'], ['cbox:b', 'rbox:a']] : [['gen:out', 'cbox:a'], ['cbox:b', 'rbox:a']];
    return [...chain, ['rbox:b', 'gen:gnd'], ['osc:ch1', 'gen:out'], ['osc:ch2', 'rbox:a'], ['osc:gnd', 'gen:gnd']];
  }
  async fitAmp() {
    await this.idle();
    const p = this.phasors(); if (!p) return;
    await this.scope((x) => { x.ch[0].vdiv = this.vdivFor(p.v1 * this.eng.gain[0]); x.ch[1].vdiv = this.vdivFor(p.v2 * this.eng.gain[1]); }, 100);
  }
  async ensure() { for (const k of ['osc', 'gen', 'ind', 'cbox', 'rbox']) if (!this.cir.placed(k)) await this.app.autoPlace(k); }
  f0True() { return 1 / (2 * Math.PI * Math.sqrt(this.ind.L * (this.cbox.value() + 20e-12))); }

  steps() {
    const app = this.app, cir = this.cir, s = this.s;
    const rows = (id) => app.table(id).completeRows();
    return [
      {
        title: '摆放仪器',
        html: '<p>把示波器、函数信号发生器、电感线圈、电容箱和电阻箱放到实验桌上。</p>',
        check: () => ['osc', 'gen', 'ind', 'cbox', 'rbox'].every((k) => cir.placed(k)),
        auto: async () => { await app.view('全景'); for (const k of ['osc', 'gen', 'ind', 'cbox', 'rbox']) await app.autoPlace(k); },
      },
      {
        title: '连接 RC 串联电路',
        html: '<p>信号发生器“输出” → 电容箱 → 电阻箱 → 信号发生器“⊥”，<b>电阻箱接在接地的一端</b>。示波器 CH1 接信号发生器输出端（总电压 $u$），CH2 接电阻箱的非接地端（$u_R=iR$，与电流同相），示波器“⊥”接地。$R$ = 1000 Ω，$C$ = 0.1 μF，信号发生器输出正弦波、4 Vpp。</p>',
        hint: '示波器的地与信号发生器的地相通，被测电压都要以接地点为参考，所以电阻必须接在接地端。',
        check: () => this.rcOK() && this.gen.on && this.gen.shape === 'sine' && s.power,
        status: () => (this.rcOK() ? '已接好 RC 串联电路' : '尚未接好 RC 串联电路'),
        auto: async () => {
          await this.ensure();
          await cir.rewire(this.wiring(false));
          app.select(this.rbox.comp); this.rbox.set(1000); app.select(this.cbox.comp); this.cbox.set(0.1e-6);
          await this.setGen(1000);
          await this.scope((x) => { this.baseScope(x); x.ch[0].vdiv = 6; x.ch[1].vdiv = 6; x.tdiv = this.tdivFor(1000); });
        },
      },
      {
        title: '测 RC 电路的相频特性',
        html: '<p>在 200 Hz 到 8 kHz 之间取 6 个以上频率。每个频率调 TIME/DIV 使一个周期占 4–10 格，读出一个周期的长度 $X$ 和 CH2 超前 CH1 的距离 $\\Delta x$，$\\varphi=360°\\cdot\\Delta x/X$。</p>',
        hint: '低频时电容的容抗大，电流超前总电压接近 90°；高频时容抗小，相位差趋于 0。φ = 45° 时 ωRC = 1。',
        status: () => `已测 ${rows('rc').length} 个频率`,
        check: () => rows('rc').length >= 6,
        diagnose: () => (this.rcOK() ? [] : [{ msg: '电路没有接成 RC 串联（或者已经改接了 RLC）。测完 RC 再改接。' }]),
        auto: async () => {
          await this.ensure();
          if (!this.rcOK()) { await cir.rewire(this.wiring(false)); this.rbox.set(1000); this.cbox.set(0.1e-6); }
          app.showTable(0);
          for (const f of [200, 500, 1000, 2000, 4000, 8000]) {
            if (rows('rc').some((r) => Math.abs(r.f - f) < 1)) continue;
            await this.setGen(f);
            await this.scope((x) => { this.baseScope(x); x.ch[0].vdiv = 6; x.ch[1].vdiv = 6; x.tdiv = this.tdivFor(f); });
            await app.view('示波器'); await this.idle();
            await app.record('rc');
          }
        },
      },
      {
        title: '改接 RLC 串联电路',
        html: '<p>在信号发生器输出端与电容箱之间串入电感线圈：输出 → 电感 → 电容 → 电阻箱 → ⊥。$R$ 改为 100 Ω，$C$ 仍为 0.1 μF。估算 $f_0=\\dfrac{1}{2\\pi\\sqrt{LC}}\\approx 5$ kHz。</p>',
        check: () => this.rlcOK(),
        status: () => (this.rlcOK() ? '已接好 RLC 串联电路' : '尚未接好 RLC 串联电路'),
        auto: async () => {
          await app.view('全景'); await this.ensure();
          await cir.rewire(this.wiring(true));
          app.select(this.rbox.comp); this.rbox.set(100); app.select(this.cbox.comp); this.cbox.set(0.1e-6);
          await this.setGen(5000);
          await this.scope((x) => { this.baseScope(x); x.tdiv = this.tdivFor(5000); });
        },
      },
      {
        title: '找谐振频率',
        html: '<p>改变频率，观察 $u_R$ 的幅度和两路波形的相位关系。$u$ 与 $u_R$ 同相时电路谐振，此时 $u_R$ 最大。可以把示波器切到 X-Y 方式：谐振时李萨如图形闭合成一条直线。记下谐振频率。</p>',
        check: () => rows('f0').length >= 1,
        diagnose: () => (this.rlcOK() ? [] : [{ msg: '电路还不是 RLC 串联，或示波器接错。', fix: { label: '帮我改接', run: () => cir.rewire(this.wiring(true)) } }]),
        auto: async () => {
          await this.ensure(); if (!this.rlcOK()) { await cir.rewire(this.wiring(true)); this.rbox.set(100); this.cbox.set(0.1e-6); }
          app.showTable(2);
          const f0 = +this.f0True().toPrecision(5);
          await this.setGen(f0);
          await this.scope((x) => { this.baseScope(x); x.mode = 'XY'; x.tdiv = this.tdivFor(f0); });
          await this.fitAmp(); await app.view('示波器'); await app.wait(400);
          await app.record('f0');
          await this.scope((x) => { x.mode = 'DUAL'; });
        },
      },
      {
        title: '测谐振曲线',
        html: '<p>在 $f_0$ 两侧（约 0.4 $f_0$ 到 2.5 $f_0$）取 12 个以上频率，峰值附近和 $I/U$ 降到峰值 $1/\\sqrt2$ 的两个半功率点附近要密一些。每个频率读出 $u$ 和 $u_R$ 的峰峰值格数。</p>',
        hint: '频率改变时 u_R 的幅度变化很大，要随时调 CH2 的 V/div，使波形占 3 格以上。',
        status: () => `已测 ${rows('res').length} 个频率`,
        check: () => { const r = rows('res'); if (r.length < 12) return false; const f0 = rows('f0')[0]?.f0 ?? this.f0True(); return r.some((x) => x.f < 0.7 * f0) && r.some((x) => x.f > 1.4 * f0); },
        auto: async () => {
          await this.ensure();
          if (!this.rlcOK()) { await cir.rewire(this.wiring(true)); this.rbox.set(100); this.cbox.set(0.1e-6); }
          app.showTable(1);
          const f0 = this.f0True();
          for (const k of [0.45, 0.65, 0.8, 0.86, 0.93, 1, 1.07, 1.15, 1.25, 1.4, 1.7, 2.2]) {
            const f = +(f0 * k).toPrecision(3);
            if (rows('res').some((r) => Math.abs(r.f - f) < 1)) continue;
            await this.setGen(f);
            await this.scope((x) => { this.baseScope(x); x.tdiv = this.tdivFor(f); });
            await this.fitAmp(); await this.idle();
            await app.record('res');
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>作 RC 电路的 tanφ–1/f 图，由斜率求电容；作 RLC 谐振曲线，求谐振频率、通频带和品质因数，与理论值比较。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const app = this.app;
    const RC = app.table('rc').completeRows().filter((r) => r.X > 0 && r.dx > 0), RS = app.table('res').completeRows().filter((r) => r.A1 > 0 && r.A2 > 0), F0 = app.table('f0').completeRows();
    if (!RC.length && !RS.length && !F0.length) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = '';
    const answers = [], plots = [];
    if (RC.length >= 3) {
      const R = 1000, xs = RC.map((r) => 1 / r.f), ys = RC.map((r) => Math.tan(((360 * r.dx) / r.X) / DEG)), f = linFit(xs, ys);
      const C = 1 / (2 * Math.PI * R * f.k);
      html += `<h3>1. RC 电路的相频特性</h3><table><tr><th>f/Hz</th><th>φ 测/°</th><th>φ 理论/°</th></tr>${RC.map((r) => `<tr><td>${r.f}</td><td>${((360 * r.dx) / r.X).toFixed(1)}</td><td>${(Math.atan(1 / (2 * Math.PI * r.f * R * 0.1e-6)) * DEG).toFixed(1)}</td></tr>`).join('')}</table>
        <p>$\\tan\\varphi=\\dfrac{1}{\\omega RC}=\\dfrac{1}{2\\pi RC}\\cdot\\dfrac1f$，作 $\\tan\\varphi$–$1/f$ 直线，斜率 $k=${f.k.toFixed(2)}$ Hz（$r$ = ${f.r.toFixed(4)}），$R$ = 1000 Ω：</p>
        <div class="result-box">$C=\\dfrac{1}{2\\pi Rk}=${(C * 1e6).toFixed(4)}\\ \\mu\\mathrm F$（标称 0.1 μF，相对偏差 ${pct(relErr(C, 0.1e-6))}）</div>
        <p>理论值按标称 R、C 计算。相位差主要由读数误差决定：Δx 读错 0.1 格，在一个周期 8 格时就是 4.5°；φ 接近 0° 或 90° 时 tanφ 对误差特别敏感，这两端的点在拟合中权重应小一些。</p>`;
      answers.push({ label: '由相频特性求出的电容 $C$', unit: 'μF', value: C * 1e6, digits: 4, tolRel: 0.03 });
      plots.push({ title: 'tan φ – 1/f', xLabel: '1/f / s', yLabel: 'tan φ', series: [{ type: 'scatter', data: xs.map((x, i) => [x, ys[i]]), label: '实验点' }, { type: 'line', data: [0, Math.max(...xs)].map((x) => [x, f.k * x + f.b]), label: '拟合' }] });
    } else if (RC.length) html += '<h3>1. RC 电路</h3><p>至少测 3 个频率。</p>';
    const L = 0.01, Cn = 0.1e-6, Rn = 100;
    const f0th = 1 / (2 * Math.PI * Math.sqrt(L * Cn));
    if (F0.length) {
      const f0 = F0[0].f0;
      html += `<h3>2. 谐振频率</h3><div class="result-box">$f_0=${f0.toFixed(1)}$ Hz，理论值（标称 L、C）$\\dfrac{1}{2\\pi\\sqrt{LC}}=${f0th.toFixed(1)}$ Hz，相对偏差 ${pct(relErr(f0, f0th))}</div><p>偏差来自电感 ±2%、电容 0.5 级的出厂误差（f₀ 与 √(LC) 成反比）。</p>`;
      answers.push({ label: '$f_0$', unit: 'Hz', value: f0, digits: 1, tolRel: 0.005 });
    }
    if (RS.length >= 5) {
      const pts = RS.map((r) => ({ f: r.f, Y: (r.A2 * r.v2) / r.R / (r.A1 * r.v1) })).sort((a, b) => a.f - b.f);
      const top = pts.reduce((a, b) => (b.Y > a.Y ? b : a)), lvl = top.Y / Math.SQRT2;
      const cross = (dir) => { const i0 = pts.indexOf(top); for (let i = i0; i + dir >= 0 && i + dir < pts.length; i += dir) { const a = pts[i], b = pts[i + dir]; if (b.Y <= lvl) return a.f + ((lvl - a.Y) / (b.Y - a.Y)) * (b.f - a.f); } return NaN; };
      const f1 = cross(-1), f2 = cross(1), f0 = F0[0]?.f0 ?? top.f, Q = f0 / (f2 - f1), Qth = Math.sqrt(L / Cn) / (Rn + this.RL);
      html += `<h3>3. 谐振曲线与品质因数</h3><p>以 $Y=I/U=\\dfrac{U_R/R}{U}$ 表示回路导纳，峰值 $Y_{\\max}$ = ${(top.Y * 1000).toFixed(3)} mS（在 ${top.f} Hz）。$Y$ 降到 $Y_{\\max}/\\sqrt2$ 的两个频率由相邻测量点线性插值得到：$f_1$ = ${f1.toFixed(0)} Hz，$f_2$ = ${f2.toFixed(0)} Hz。</p>
        <div class="result-box">通频带 $\\Delta f=f_2-f_1=${(f2 - f1).toFixed(0)}$ Hz，$Q=\\dfrac{f_0}{\\Delta f}=${Q.toFixed(2)}$</div>
        <div class="result-box warn">理论 $Q=\\dfrac{1}{R+R_L}\\sqrt{\\dfrac LC}=\\dfrac{1}{${Rn}+${this.RL}}\\sqrt{\\dfrac{0.01}{10^{-7}}}=${Qth.toFixed(2)}$（$R_L$ 为线圈直流电阻；信号发生器内阻不计入，因为 U 取的是输出端电压）。谐振时 $1/Y_{\\max}$ 应等于 $R+R_L$：实测 ${(1 / top.Y).toFixed(1)} Ω。</div>`;
      answers.push({ label: '品质因数 $Q$', unit: '', value: Q, digits: 2, tolRel: 0.03 });
      const fx = Array.from({ length: 120 }, (_, i) => pts[0].f + ((pts[pts.length - 1].f - pts[0].f) * i) / 119);
      plots.push({ title: '谐振曲线 I/U – f', xLabel: 'f / Hz', yLabel: 'I/U / mS', series: [{ type: 'scatter', data: pts.map((p) => [p.f, p.Y * 1000]), label: '实验点' }, { type: 'line', data: fx.map((f) => { const w = 2 * Math.PI * f, X = w * L - 1 / (w * Cn); return [f, 1000 / Math.hypot(Rn + this.RL, X)]; }), label: '理论（标称值）' }] });
    } else if (RS.length) html += '<h3>3. 谐振曲线</h3><p>至少测 5 个频率。</p>';
    return { html, ok: true, answers, plots };
  }

  principle() {
    const fig = `<svg viewBox="0 0 520 170" style="max-width:520px;width:100%" font-family="IBM Plex Sans, sans-serif" font-size="12" fill="none" stroke="#1d2832" stroke-width="1.4">
      <circle cx="50" cy="85" r="18"/><path d="M40 85q5-10 10 0t10 0"/><text x="28" y="125" fill="#1d2832" stroke="none">信号源（内阻 50 Ω）</text>
      <path d="M50 67V30h70"/><path d="M120 30q6-10 12 0q6-10 12 0q6-10 12 0q6-10 12 0"/><text x="128" y="18" fill="#1d2832" stroke="none">L, R_L</text>
      <path d="M168 30h52M220 16v28M232 16v28M232 30h60"/><text x="214" y="58" fill="#1d2832" stroke="none">C</text>
      <rect x="292" y="22" width="56" height="16"/><text x="312" y="58" fill="#1d2832" stroke="none">R</text>
      <path d="M348 30h40v110H50v-37"/><path d="M380 150h16M384 155h8"/>
      <circle cx="50" cy="30" r="3" fill="#d4a017"/><text x="58" y="48" fill="#a07800" stroke="none">CH1：u</text>
      <circle cx="292" cy="30" r="3" fill="#1f4fbf"/><text x="262" y="78" fill="#1f4fbf" stroke="none">CH2：u_R = iR</text>
      <text x="400" y="145" fill="#1d2832" stroke="none">示波器 ⊥ 接地</text></svg>`;
    return `${fig}<h3>1. RC 串联电路</h3><p>正弦电压 $u$ 加在 R、C 串联电路上，回路电流的振幅与相位为</p>$$I=\\frac{U}{\\sqrt{R^2+(1/\\omega C)^2}},\\qquad \\tan\\varphi=\\frac{1}{\\omega RC}$$<p>φ 是电流超前总电压的角度。电阻上的电压 $u_R=iR$ 与电流同相，所以用示波器比较 $u_R$ 与 $u$ 的相位，就得到电流与总电压的相位差。</p>
<h3>2. RLC 串联谐振</h3><p>$Z=R+j\\left(\\omega L-\\dfrac{1}{\\omega C}\\right)$，$|Z|=\\sqrt{R^2+\\left(\\omega L-\\dfrac1{\\omega C}\\right)^2}$，$\\tan\\varphi=\\dfrac{1/\\omega C-\\omega L}{R}$。</p><p>当 $\\omega L=1/\\omega C$，即 $f_0=\\dfrac{1}{2\\pi\\sqrt{LC}}$ 时，阻抗最小且为纯电阻，电流最大并与总电压同相——串联谐振。电流降到最大值 $1/\\sqrt2$ 的两个频率 $f_1$、$f_2$ 之间叫通频带，</p>$$Q=\\frac{f_0}{f_2-f_1}=\\frac{\\omega_0L}{R}=\\frac1R\\sqrt{\\frac LC}$$<p>这里的 R 是回路的全部电阻（电阻箱加线圈电阻）。谐振时电感、电容上的电压都是总电压的 Q 倍。</p>
<h3>3. 双踪法测相位差</h3><p>两个同频正弦信号同时显示，一个周期在屏上占 $X$ 格，两波形相同相位点（如同向过零点）相距 $\\Delta x$ 格，则相位差 $\\varphi=360°\\cdot\\Delta x/X$。X-Y 方式下两路信号合成李萨如图形：同相或反相时为直线，相位差 90° 且幅度相等时为圆。</p>
<h3>4. 本仿真的计算模型</h3><p>按实际接线由开源 SPICE 引擎 spice-ts 求正弦稳态，包括信号发生器 50 Ω 内阻、线圈直流电阻与约 30 pF 分布电容、电容箱分布电容、示波器 1 MΩ∥20 pF 输入和交流耦合电容。电感 ±2%、电容 0.5 级、示波器垂直与水平 ±2% 的误差都按个体随机给定。</p>`;
  }
}
