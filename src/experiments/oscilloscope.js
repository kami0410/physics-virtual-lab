// 实验：示波器的使用 —— 调出扫描线、触发同步、测电压与频率、李萨如图形测频率
// 电路（信号源内阻、示波器 1 MΩ∥20 pF 输入、交流耦合电容）由 spice-ts 按实际接线求周期稳态，
// 荧光屏按真实时间扫描：触发同步时各次扫描重合，否则波形晃动；X-Y 方式下频率比稍有偏差，图形就缓慢转动。
import * as THREE from 'three';
import { meta, thumb } from './oscilloscope.meta.js';
import { Circuit, benchTable } from '../core/circuit.js';
import { funcGen, mysterySource, oscilloscope } from '../core/oscillo.js';
import { VDIV, TDIV, fmtV, fmtT } from '../core/scopeEngine.js';
import { mean, stdev, rand, relErr, pct, clamp } from '../core/Stats.js';
import { oscilloscopeFig } from './circuitFigs.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export class OscilloscopeExperiment {
  static meta = meta;
  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.fy = rand(220, 420); // 待测信号频率
  }

  cameras() {
    return [
      { name: '全景', pos: [0, 80, 92], target: [0, 4, -4] },
      { name: '示波器', pos: [0, 28, 38], target: [0, 9, -14] },
      { name: '信号源', pos: [-30, 36, 52], target: [-30, 2, 12] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    const slot = (id, x, z, accepts) => app.addSlot({ id, pos: new THREE.Vector3(x, 0, z), accepts });
    slot('osc', 0, -22, ['osc']); slot('gen', -46, 14, ['gen']); slot('unk', 42, 18, ['unk']);
    this.view = app.addView({ id: 'scr', title: '示波器荧光屏', w: 360, h: 284, res: 1 });
    const cir = (this.cir = new Circuit(app));
    this.gen = cir.add(funcGen({ defaultSlot: 'gen', f: 1000, vpp: 4 }));
    this.unk = cir.add(mysterySource({ defaultSlot: 'unk', f: this.fy, vpp: 3 }));
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

  update() {
    const cir = this.cir;
    for (const d of cir.devices.values()) if (d.comp.placed && d.after) d.after();
    if (cir.placed('osc')) { this.osc.refresh(cir); this.osc.drawView(); }
    else { const v = this.view, c = v.ctx; c.fillStyle = '#2b2e31'; c.fillRect(0, 0, v.W, v.H); v.foot('示波器尚未放到桌上'); }
  }

  // ---------------- 接线判断 ----------------
  linked(a, b) { const n = this.cir.nets(); return n(a) === n(b); }
  genOnCh1() { return this.cir.placed('gen') && this.linked('gen:out', 'osc:ch1'); }
  unkOnCh2() { return this.cir.placed('unk') && this.linked('unk:out', 'osc:ch2'); }

  /** 通道 c 信号在屏幕上的峰峰高度（格）——学生读数的参照值 */
  heightDiv(c) {
    const sig = this.osc.sig;
    if (!sig) return NaN;
    const T = sig.groups.length ? Math.max(...sig.groups.map((g) => g.T)) : 1;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < 4000; i++) { const v = sig.at(c ? 'ch2' : 'ch1', (i / 4000) * T); mn = Math.min(mn, v); mx = Math.max(mx, v); }
    return ((mx - mn) * this.eng.gain[c]) / this.eng.vEff(c);
  }
  calOK() {
    const s = this.s;
    if (s.ch[0].var < 0.999 || s.tvar < 0.999) { this.app.toast('“微调”旋钮不在校准位置（CAL），这时不能按面板刻度读数', 'warn'); return false; }
    if (s.mag) { this.app.toast('请先关闭 ×10 扩展再读数（或把扫描时间除以 10）', 'warn'); return false; }
    return true;
  }

  tables() {
    return [
      {
        id: 'wave', title: '测正弦信号的电压与频率',
        columns: [
          { key: 'f0', label: '发生器 f₀/Hz', digits: 2, auto: true },
          { key: 'U0', label: '发生器 U₀/V', digits: 2, auto: true },
          { key: 'vd', label: 'V/div', digits: 3, auto: true },
          { key: 'H', label: '峰峰高度/div', digits: 2, readTol: 0.12 },
          { key: 'td', label: 'ms/div', digits: 4, auto: true },
          { key: 'n', label: '周期数 n', digits: 0, auto: true },
          { key: 'D', label: 'n 个周期/div', digits: 2, readTol: 0.12 },
          { key: 'U', label: 'U_pp/V', digits: 3, calc: (r) => r.H * r.vd },
          { key: 'f', label: 'f/Hz', digits: 1, calc: (r) => r.n / (r.D * r.td / 1000) },
        ],
        maxRows: 10,
        buttons: [{ label: '按当前屏幕记录一组', onClick: (t) => this.recWave(t) }],
        note: '读数估读到 0.1 格（小格的一半）。峰峰高度尽量占 4～8 格，n 个周期的长度尽量占满屏幕。',
      },
      {
        id: 'liss', title: '李萨如图形测频率',
        columns: [
          { key: 'fx', label: '发生器 f_x/Hz', digits: 2, auto: true },
          { key: 'Nx', label: '水平切线切点数 N_x', digits: 0, readTol: 0.01 },
          { key: 'Ny', label: '垂直切线切点数 N_y', digits: 0, readTol: 0.01 },
          { key: 'fy', label: 'f_y = f_x·N_x/N_y /Hz', digits: 2, calc: (r) => (r.fx * r.Nx) / r.Ny },
        ],
        maxRows: 10,
        buttons: [{ label: '图形稳定时记录一组', onClick: (t) => this.recLiss(t) }],
        note: '调节信号发生器频率，使图形转得最慢（几乎静止）时记录。数图形与水平线、垂直线的切点数。',
      },
    ];
  }

  recWave(t) {
    const s = this.s, app = this.app;
    if (!this.cir.placed('osc') || !s.power) return app.toast('示波器没有打开', 'warn');
    if (!this.genOnCh1()) return app.toast('信号发生器的输出没有接到 CH1', 'warn');
    if (!this.gen.on) return app.toast('信号发生器没有输出', 'warn');
    if (s.mode !== 'CH1' && s.mode !== 'DUAL') return app.toast('垂直方式请选 CH1（或双踪）', 'warn');
    if (s.ch[0].cpl === 'GND') return app.toast('CH1 耦合在 GND 位置，看不到信号', 'warn');
    if (!this.eng.triggered) return app.toast('波形不稳定（未触发），请调触发电平', 'warn');
    if (!this.calOK()) return;
    this.osc.refresh(this.cir);
    if (this.osc.busy || !this.osc.sig) return app.toast('示波器还在计算电路，稍等再记录', 'warn');
    const H = this.heightDiv(0);
    if (H > 8.05) return app.toast('波形超出屏幕，增大 V/div', 'warn');
    if (H < 3) app.toast('波形高度不到 3 格，读数相对误差较大，可减小 V/div', 'warn');
    const w = this.gen.wave(), T = 1 / w.f, tE = TDIV[s.tdiv] * this.eng.tcal;
    const n = Math.max(1, Math.floor((10 * TDIV[s.tdiv]) / T + 1e-9));
    if ((10 * TDIV[s.tdiv]) / T < 1) return app.toast('屏幕上不到一个周期，增大 TIME/DIV', 'warn');
    if ((n * T) / TDIV[s.tdiv] < 5) app.toast('所读周期总长不到 5 格，可减小 TIME/DIV 使波形展开', 'warn');
    t.addRow({ f0: +this.gen.f.toFixed(2), U0: this.gen.vpp, vd: VDIV[s.ch[0].vdiv], H: +H.toFixed(3), td: TDIV[s.tdiv] * 1000, n, D: +((n * T) / tE).toFixed(3) });
  }

  /** 当前 f_y/f_x 最接近的简单整数比 */
  ratio() {
    const r = this.unk.f / this.gen.wave().f;
    let best = null;
    for (let q = 1; q <= 6; q++) for (let p = 1; p <= 6; p++) { if (gcd(p, q) !== 1) continue; const e = Math.abs(r / (p / q) - 1); if (!best || e < best.e) best = { p, q, e }; }
    return best;
  }
  recLiss(t) {
    const s = this.s, app = this.app;
    if (!this.cir.placed('osc') || !s.power) return app.toast('示波器没有打开', 'warn');
    if (s.mode !== 'XY') return app.toast('垂直方式请选 X-Y', 'warn');
    if (!this.genOnCh1()) return app.toast('信号发生器应接 CH1(X)', 'warn');
    if (!this.unkOnCh2()) return app.toast('待测信号源应接 CH2(Y)', 'warn');
    if (!this.gen.on || !this.unk.on) return app.toast('信号源没有输出', 'warn');
    if (s.ch[0].cpl === 'GND' || s.ch[1].cpl === 'GND') return app.toast('有通道耦合在 GND 位置', 'warn');
    const r = this.ratio();
    if (r.e > 2e-3) return app.toast('图形还在快速变化，频率比不是简单整数比。继续细调信号发生器的频率', 'warn');
    if (r.e > 2e-4) app.toast('图形还在转动，再细调频率使它转得更慢，记录更准', 'warn');
    const tb = t.rows.find((x) => x.Nx === r.p && x.Ny === r.q && !t.isPend(x, 'Nx'));
    if (tb) app.toast(`频率比 ${r.p}:${r.q} 已经记录过，换一个比值`, 'warn');
    t.addRow({ fx: +this.gen.f.toFixed(2), Nx: r.p, Ny: r.q });
  }

  // ---------------- 自动操作 ----------------
  async setGen(f, vpp) {
    const app = this.app, g = this.gen;
    app.select(g.comp);
    if (!g.on) { g.on = true; app.changed(); await app.wait(150); }
    g.range = [10, 100, 1e3, 1e4, 1e5, 1e6].findIndex((r) => f <= 2 * r);
    await app.tween(() => g.f, (v) => g.setF(v), f, 500);
    if (vpp != null) await app.tween(() => g.vpp, (v) => (g.vpp = v), vpp, 300);
  }
  /** 等电路计算完成、波形触发稳定 */
  async idle() { if (this.cir.placed('osc')) this.osc.refresh(this.cir); const t0 = performance.now(); while ((this.osc.busy || !this.osc.sig) && performance.now() - t0 < 6000) await this.app.wait(30, true); await this.app.wait(120, true); }
  async scope(fn, ms = 200) { this.app.select(this.osc.comp); fn(this.s); this.app.changed(); await this.app.wait(ms); }
  /** 选择合适的 V/div 与 TIME/DIV */
  fitWave() {
    const s = this.s, w = this.gen.wave(), U = 2 * w.amp, T = 1 / w.f;
    s.ch[0].vdiv = VDIV.findIndex((v) => U / v <= 7.6);
    let k = TDIV.findIndex((td) => 10 * td >= 1.6 * T);
    s.tdiv = k < 0 ? TDIV.length - 1 : k;
  }

  steps() {
    const app = this.app, cir = this.cir, s = this.s;
    const rows = (id) => app.table(id).completeRows();
    const focusOK = () => Math.abs(s.focus - 0.5) < 0.06;
    return [
      {
        title: '摆放仪器',
        html: '<p>把双踪示波器、函数信号发生器和待测信号源放到实验桌上。</p>',
        check: () => ['osc', 'gen', 'unk'].every((k) => cir.placed(k)),
        auto: async () => { await app.view('全景'); for (const k of ['osc', 'gen', 'unk']) await app.autoPlace(k); },
      },
      {
        title: '开机，调出清晰的扫描线',
        html: '<p>打开示波器电源，垂直方式选 CH1，CH1 耦合拨到 <b>GND</b>（输入接地，屏幕上应出现一条水平扫描线；若看不到，加大辉度、调垂直位移）。</p><p>调<b>辉度</b>使亮度适中，调<b>聚焦</b>使线条最细，再用 CH1 <b>垂直位移</b>把扫描线移到屏幕中央的水平刻度线上——这就是 0 V 的位置。</p>',
        hint: '触发方式用 AUTO：没有信号时示波器自激扫描，才能看到扫描线。辉度不要开得过亮，长时间亮点会灼伤荧光屏。',
        check: () => cir.placed('osc') && s.power && s.mode === 'CH1' && s.inten > 0.3 && focusOK() && Math.abs(s.ch[0].pos) < 0.1,
        status: () => !s.power ? '示波器未开' : `辉度 ${Math.round(s.inten * 100)}% ${s.inten > 0.3 ? '✓' : '偏暗'} · 聚焦 ${focusOK() ? '✓' : '未调好'} · 基线偏离中心 ${s.ch[0].pos.toFixed(2)} 格`,
        auto: async () => {
          await app.view('示波器');
          await this.scope((x) => { x.power = true; x.mode = 'CH1'; x.ch[0].cpl = 'GND'; x.trig.mode = 'AUTO'; });
          await app.tween(() => s.inten, (v) => (s.inten = v), 0.6, 400);
          await app.tween(() => s.focus, (v) => (s.focus = v), 0.5, 500);
          await app.tween(() => s.ch[0].pos, (v) => (s.ch[0].pos = v), 0, 500);
        },
      },
      {
        title: '接入正弦信号，调出稳定的波形',
        html: '<p>用导线把信号发生器“输出”接 CH1，“⊥”接示波器“⊥”。信号发生器选正弦波、约 1 kHz、4 Vpp，打开输出。CH1 耦合拨到 DC。</p><p>调 VOLTS/DIV 使波形高度占 4～8 格，调 TIME/DIV 使屏幕上显示 1～2 个周期。若波形左右晃动，调<b>触发电平</b>，使它落在波形的上下限之间——每次扫描都从信号的同一相位开始，图形才会静止。</p>',
        hint: '把触发电平调到超出波形范围，观察 AUTO 方式下波形“跑动”；改成 NORM 方式，扫描线会消失。',
        check: () => this.genOnCh1() && this.gen.on && s.power && s.ch[0].cpl !== 'GND' && (s.mode === 'CH1' || s.mode === 'DUAL') && this.eng.triggered,
        status: () => !this.genOnCh1() ? '发生器尚未接到 CH1' : !this.gen.on ? '发生器没有输出' : this.eng.triggered ? '已触发，波形稳定' : '波形不稳定',
        auto: async () => {
          await app.view('全景');
          await cir.rewire([['gen:out', 'osc:ch1'], ['gen:gnd', 'osc:gnd']]);
          await this.setGen(1000, 4);
          await this.scope((x) => { x.ch[0].cpl = 'DC'; x.trig.src = 0; x.trig.level = 0.4; x.trig.slope = 1; x.ch[0].var = 1; x.tvar = 1; x.mag = false; this.fitWave(); });
          await app.view('示波器'); await app.wait(400);
        },
      },
      {
        title: '测量信号的电压和频率',
        html: '<p>读出波形的<b>峰峰高度 H</b>（格）和 <b>n 个周期的水平长度 x</b>（格），由面板上的 V/div、TIME/DIV 求</p>$$U_{pp}=H\\cdot D_y,\\qquad f=\\frac{n}{x\\cdot D_x}$$<p>与信号发生器的显示比较。换 3 个以上不同频率（例如几百赫兹、几千赫兹、十几千赫兹）和幅度各测一组。</p>',
        hint: '读数前确认两个“微调”都在校准位置（CAL）。可以用水平位移把波形的一个波峰（或过零点）对准某条竖刻度线再数格。',
        check: () => { const fs = rows('wave').map((r) => r.f0).sort((a, b) => a - b); let k = fs.length ? 1 : 0; for (let i = 1; i < fs.length; i++) if (fs[i] > fs[i - 1] * 1.3) k++; return k >= 3; },
        status: () => `已记录 ${rows('wave').length} 组`,
        auto: async () => {
          for (const [f, U] of [[rand(400, 700), 3], [rand(1800, 3500), 6], [rand(11000, 16000), 1.6]]) {
            await this.setGen(+f.toFixed(1), U);
            await this.scope(() => this.fitWave(), 300);
            await this.idle();
            await app.record('wave');
          }
        },
      },
      {
        title: '李萨如图形测未知频率',
        html: '<p>把待测信号源接 CH2(Y)（地线接“⊥”），信号发生器仍接 CH1(X)，垂直方式选 <b>X-Y</b>。调两个通道的 VOLTS/DIV 使图形大小合适。</p><p>缓慢调节信号发生器的频率 $f_x$，当 $f_y:f_x$ 为简单整数比时出现稳定（缓慢转动）的李萨如图形。数图形与一条水平线的切点数 $N_x$、与一条垂直线的切点数 $N_y$，则</p>$$f_y=f_x\\frac{N_x}{N_y}$$<p>测 1:1、1:2、2:1、2:3 等 3 种以上比值。</p>',
        hint: '先用粗调接近，再用细调使图形转得最慢。两个信号源的频率都有微小的误差和漂移，图形不可能完全静止。',
        check: () => new Set(rows('liss').map((r) => `${r.Nx}:${r.Ny}`)).size >= 3,
        status: () => `已记录 ${new Set(rows('liss').map((r) => `${r.Nx}:${r.Ny}`)).size} 种频率比`,
        auto: async () => {
          await app.view('全景');
          await cir.rewire([['gen:out', 'osc:ch1'], ['gen:gnd', 'osc:gnd'], ['unk:out', 'osc:ch2'], ['unk:gnd', 'osc:gnd']]);
          await this.scope((x) => { x.mode = 'XY'; x.ch[0].cpl = 'DC'; x.ch[1].cpl = 'DC'; x.ch[0].vdiv = 6; x.ch[1].vdiv = 6; x.ch[0].var = 1; x.ch[1].var = 1; x.ch[0].pos = 0; x.ch[1].pos = 0; x.xpos = 0; });
          const k = this.gen.wave().f / this.gen.f;
          for (const [p, q] of [[1, 1], [1, 2], [2, 1], [2, 3]]) {
            const fx = (this.unk.f * q) / p / k;
            await this.setGen(+(fx * (1 + rand(-3e-5, 3e-5))).toFixed(2), 3);
            await app.view('示波器'); await this.idle();
            await app.record('liss');
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>计算各组 $U_{pp}$、$f$ 并与信号发生器的示值比较；由李萨如图形求待测频率的平均值。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const app = this.app;
    const W = app.table('wave').completeRows(), L = app.table('liss').completeRows();
    if (!W.length && !L.length) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = '';
    const answers = [], plots = [];
    if (W.length) {
      html += '<h3>电压与频率</h3><table><tr><th>$f_0$/Hz</th><th>$U_0$/V</th><th>$U_{pp}$/V</th><th>相对偏差</th><th>$f$/Hz</th><th>相对偏差</th></tr>';
      for (const r of W) {
        const U = r.H * r.vd, f = r.n / ((r.D * r.td) / 1000);
        html += `<tr><td>${r.f0}</td><td>${r.U0.toFixed(2)}</td><td>${U.toFixed(3)}</td><td>${pct((U - r.U0) / r.U0, 1)}</td><td>${f.toFixed(1)}</td><td>${pct((f - r.f0) / r.f0, 1)}</td></tr>`;
      }
      html += '</table><p>示波器垂直偏转因数和扫描时间的误差指标一般为 ±3%，读数误差约 0.1 格，偏差在这个范围内即属正常。信号发生器的频率准确度（±20 ppm）比示波器高得多，可以当作“真值”来校验示波器。</p>';
      const dU = W.map((r) => (r.H * r.vd) / r.U0 - 1), dF = W.map((r) => r.n / ((r.D * r.td) / 1000) / r.f0 - 1);
      html += `<div class="result-box">电压测量平均偏差 ${pct(mean(dU), 1)}，频率测量平均偏差 ${pct(mean(dF), 1)}</div>`;
    }
    if (L.length) {
      const fy = L.map((r) => (r.fx * r.Nx) / r.Ny), m = mean(fy);
      html += `<h3>李萨如图形</h3><table><tr><th>$N_x:N_y$</th><th>$f_x$/Hz</th><th>$f_y$/Hz</th></tr>${L.map((r, i) => `<tr><td>${r.Nx}:${r.Ny}</td><td>${r.fx}</td><td>${fy[i].toFixed(2)}</td></tr>`).join('')}</table>`;
      html += `<div class="result-box">$\\bar f_y = ${m.toFixed(2)}$ Hz${L.length > 1 ? `，标准差 ${stdev(fy).toFixed(2)} Hz` : ''}</div>`;
      html += `<div class="result-box warn">待测信号源的实际频率为 ${this.fy.toFixed(2)} Hz，相对误差 ${pct(relErr(m, this.fy), 3)}。李萨如法的准确度取决于信号发生器的频率准确度和“图形是否调稳”。</div>`;
      answers.push({ label: '待测信号的频率 $f_y$', unit: 'Hz', value: m, digits: 2, tolRel: 0.002 });
      plots.push({ title: '各频率比下求得的 f_y', xLabel: '序号', yLabel: 'f_y / Hz', series: [{ type: 'scatter', data: fy.map((v, i) => [i + 1, v]) }, { type: 'line', data: [[0.5, m], [fy.length + 0.5, m]], dash: [5, 4] }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 示波管与偏转</h3>${oscilloscopeFig()}<p>电子枪发出的电子束经垂直、水平两对偏转板打到荧光屏上。加在偏转板上的电压使光点偏移，偏移量与电压成正比。面板上的“偏转因数”$D_y$（V/div）表示光点偏移 1 格所需的输入电压。</p>
<h3>2. 扫描</h3><p>水平偏转板上加锯齿波电压，光点从左到右匀速移动，再迅速回到左端——这叫扫描，“扫描时间因数”$D_x$（TIME/DIV）表示光点移动 1 格所用的时间。垂直方向同时加被测信号，屏幕上就画出信号随时间变化的曲线。</p>
<h3>3. 触发同步</h3><p>每次扫描都在被测信号达到某一电平（触发电平）且沿规定方向（极性）变化时才开始，各次扫描画出的曲线完全重合，波形就稳定了。触发电平超出信号范围时没有触发：AUTO 方式自激扫描，波形左右“跑动”；NORM 方式则不扫描。</p>
<h3>4. 测电压和频率</h3><p>$U_{pp}=H\\cdot D_y$，$T=\\dfrac{x\\cdot D_x}{n}$，$f=1/T$。“微调”旋钮必须在校准位置，否则面板刻度不再代表实际的偏转因数和扫描时间。</p>
<h3>5. 李萨如图形</h3><p>不扫描，X、Y 两方向分别加正弦信号 $x=A\\sin(2\\pi f_xt)$、$y=B\\sin(2\\pi f_yt+\\varphi)$。$f_y:f_x$ 为整数比时光点轨迹是闭合的李萨如图形。在图形的一个循环周期内，$y$ 达到最大值的次数（与水平线的切点数 $N_x$）与 $x$ 达到最大值的次数（与垂直线的切点数 $N_y$）之比就是频率比：</p>$$\\frac{f_y}{f_x}=\\frac{N_x}{N_y}$$<p>频率比稍有偏差时，相位差 $\\varphi$ 随时间缓慢变化，图形就缓慢转动。</p>
<h3>6. 本仿真的计算模型</h3><p>按实际接线列出电路：信号发生器（内阻 50 Ω）、示波器输入（1 MΩ ∥ 20 pF，交流耦合时串入 0.047 μF 电容）、待测信号源（内阻 600 Ω）。各仪器的“⊥”都经电源插头接地。电路交给开源 SPICE 引擎 spice-ts 计算，用打靶法直接求周期稳态。荧光屏按真实时间扫描，亮度按电子束在轨迹上的停留时间计算，荧光有约 45 ms 的余辉。示波器偏转因数和扫描时间带有 ±2% 以内的固定误差，信号发生器频率误差约 ±20 ppm。</p>`;
  }
}
