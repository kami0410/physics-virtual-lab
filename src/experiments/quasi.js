// 实验：准稳态法测导热系数和比热容
// 四块相同的有机玻璃样品（每块 90 mm × 90 mm × 10 mm）叠放，两片加热膜夹在第 1、2 块和第 3、4 块之间，外面包保温材料。
// 一对热电偶测加热面与中心面的温差（差分接法），另一支测中心面相对室温（冷端在室温）的温升。
// 温度场由 physics/quasisteady.js 按一维导热方程计算（含保温层的微小散热和加热膜热容），热电势用 NIST T 型分度函数。
// 测温仪有“定时”功能：每到整分钟蜂鸣一次，并把这一时刻的读数保持显示，方便逐分钟记录。
import * as THREE from 'three';
import { meta, thumb } from './quasi.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { mean, rand, gauss, clamp, linFit, relErr, pct } from '../core/Stats.js';
import { QuasiSlab } from '../physics/quasisteady.js';
import { emfT } from '../physics/coolmetal.js';

const RL = 0.0100, FL = 0.090 * 0.090, RHO_L = 1196, RHEAT_L = 110.0; // 标签值：样品厚度、面积、密度，加热膜电阻
const S_TC = Math.round(((emfT(40) - emfT(20)) / 20) * 10000) / 10000; // 热电偶灵敏度（mV/K，20–40 °C 平均）
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class QuasiSteadyExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.T0 = rand(18, 25);
    this.mat = { R: RL * (1 + gauss(0.002)), lam: rand(0.185, 0.2), rho: RHO_L * (1 + gauss(0.003)), c: rand(1380, 1450), h: rand(0.2, 0.5), Ch: 250 };
    this.rHeat = RHEAT_L * (1 + gauss(0.003)); this.F = FL * (1 + gauss(0.002));
    this.nz = () => gauss(0.0004);
    this.V = 0; this.heat = false; this.timeScale = 1;
    this.reset();
  }
  reset() {
    this.slab = new QuasiSlab({ ...this.mat, T0: this.T0 });
    this.t = 0; this.held = { m: 0, Vt: this.readVt(), Vc: this.readVc() }; this.heat = false;
  }
  get qc() { return (this.V * this.V) / (2 * this.F * this.rHeat); }
  readVt() { return Math.round((emfT(this.slab.Ts) - emfT(this.slab.Tc) + this.nz()) * 1000) / 1000; }
  readVc() { return Math.round((emfT(this.slab.Tc) - emfT(this.T0) + this.nz()) * 1000) / 1000; }
  /** 推进 T 秒，整分钟处采样保持 */
  advance(T) {
    while (T > 1e-9) {
      const next = (Math.floor(this.t / 60 + 1e-9) + 1) * 60;
      if (this.holdAt != null && this.t >= this.holdAt * 60 - 1e-6) return; // 自动记录时在整分钟处等一等
      const h = Math.min(T, next - this.t);
      this.slab.q = this.heat ? this.qc : 0;
      this.slab.advance(h); this.t += h; T -= h;
      if (Math.abs(this.t - next) < 1e-6) { this.t = next; this.held = { m: Math.round(next / 60), Vt: this.readVt(), Vc: this.readVc() }; }
    }
  }
  tick(dt) {
    if (!this.heat) return;
    const a = this.app, sdt = Math.min(60, dt * (a.running ? a.speed * 30 : this.timeScale));
    this.advance(sdt); a.changed();
  }
  globalControls() { return [{ type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×10', value: 10 }, { label: '×30', value: 30 }] }]; }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 58, 78], target: [0, 6, -4] }, { name: '样品', pos: [-14, 26, 30], target: [-14, 6, 0] }, { name: '仪器', pos: [16, 30, 30], target: [16, 6, -18] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(120, 80));
    app.stage.setLightTarget(0, 4, 0);
    const g = new THREE.Group(); g.position.set(-14, 0, 2);
    const foam = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.95, transparent: true, opacity: 0.45 });
    g.add(mesh(new THREE.BoxGeometry(20, 10, 20), foam, 0, 5, 0));
    const pmma = MAT.glass(0xd8e6ea, 0.55), film = MAT.paint(0xb5651d);
    for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(9, 1, 9), pmma, 0, 3 + i * 1.04, 0));
    for (const y of [3.52, 5.6]) g.add(mesh(new THREE.BoxGeometry(9.6, 0.06, 9.6), film, 0, y, 0));
    this.tcWire = MAT.paint(0x1f4e79);
    for (const [y, z] of [[3.52, 2], [4.56, -2]]) g.add(mesh(new THREE.BoxGeometry(14, 0.12, 0.12), this.tcWire, 7, y, z));
    app.addComponent(new Component({
      key: 'stack', name: '样品堆与保温箱', zone: 'none', fixed: true, required: true, object: g, labelY: 14,
      icon: SVG('<rect x="14" y="6" width="36" height="28" fill="none" stroke="currentColor" stroke-dasharray="3 2"/>' + [0, 1, 2, 3].map((i) => `<rect x="20" y="${10 + i * 5.5}" width="24" height="4.5" fill="none" stroke="currentColor"/>`).join('') + '<path d="M18 15 H46 M18 26 H46" stroke="#b5651d" stroke-width="1.5"/>'),
      desc: `有机玻璃样品四块，每块 ${(RL * 1000).toFixed(1)} mm 厚、90.0 mm × 90.0 mm，密度 ${RHO_L} kg/m³。两片加热膜（电阻各 ${RHEAT_L.toFixed(1)} Ω，并联接电源）夹在第 1、2 块和第 3、4 块之间。热电偶：一对差分接在加热面和中心面之间；另一支测中心面，冷端在室温。实验前样品应在室温下放置足够久，内部温度均匀。`,
      controls: () => [
        { type: 'button', label: '换一组已放凉的样品（重新开始）', onClick: () => { this.reset(); app.toast('换上了一组在室温下放置过的样品', 'ok'); app.changed(); } },
      ],
    }));
    const ins = (this.inst = meterBox(26, 11, 15, '导热系数测定仪')); ins.group.position.set(18, 0, -18);
    const ps = (this.ps = meterBox(16, 9, 12, '加热电源')); ps.group.position.set(-8, 0, -24);
    const mg = new THREE.Group(); mg.add(ins.group); mg.add(ps.group);
    app.addComponent(new Component({
      key: 'inst', name: '加热电源与测温仪', zone: 'none', fixed: true, object: mg, labelY: 14,
      desc: `加热电源 0–20 V，数显到 0.01 V。测温仪显示两路热电势（0.001 mV）：“温差”为加热面相对中心面，“温升”为中心面相对室温。定时功能：加热开始后每到整分钟蜂鸣，读数在该时刻保持显示。热电偶在 20–40 °C 的平均灵敏度 ${S_TC.toFixed(4)} mV/K。`,
      controls: () => [
        { type: 'knob', label: '加热电压', get: () => this.V, set: (v) => { this.V = Math.round(clamp(v, 0, 20) * 100) / 100; app.changed(); }, min: 0, max: 20, step: 0.01, bigStep: 0.5, perRev: 2, digits: 2, unit: 'V' },
        { type: 'toggle', label: '开始加热（同时开始计时）', get: () => this.heat, set: (v) => { if (v && this.t > 0) { app.toast('这组样品已经加热过，内部温度不均匀：先换一组放凉的样品', 'warn'); return; } this.heat = v; app.changed(); } },
        { type: 'readout', label: '计时', get: () => `${Math.floor(this.t / 60)} 分 ${String(Math.floor(this.t % 60)).padStart(2, '0')} 秒` },
        { type: 'readout', label: '保持的读数', get: () => `第 ${this.held.m} 分钟：温差 ${this.held.Vt.toFixed(3)} mV，温升 ${this.held.Vc.toFixed(3)} mV` },
      ],
    }));
    this.view = app.addView({ id: 'tprof', title: '样品内的温度分布（中心面 → 外表面）', w: 320, h: 200, res: 1.4 });
  }
  update() {
    const s = `${this.held.Vt.toFixed(3)}`, sub = `温升 ${this.held.Vc.toFixed(3)} mV · ${this.held.m} min`;
    if (s + sub !== this._s) { this._s = s + sub; this.inst.setText(s, 'mV', sub); }
    const p = this.V.toFixed(2);
    if (p + this.heat !== this._p) { this._p = p + this.heat; this.ps.setText(p, 'V', this.heat ? '加热中' : '未加热'); }
    this.drawProfile();
  }
  drawProfile() {
    const v = this.view, g = v.ctx, W = v.W, H = v.H, T = this.slab.T, N = this.slab.N, n = this.slab.n;
    g.fillStyle = '#f3f1ec'; g.fillRect(0, 0, W, H);
    const x0 = W * 0.12, x1 = W * 0.95, y0 = H * 0.85, y1 = H * 0.1, tmax = Math.max(this.T0 + 2, ...T), tmin = this.T0;
    g.fillStyle = 'rgba(181,101,29,.12)'; g.fillRect(x0, y1, (x1 - x0) / 2, y0 - y1);
    g.strokeStyle = '#b5651d'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + (x1 - x0) / 2, y1); g.lineTo(x0 + (x1 - x0) / 2, y0); g.stroke();
    g.strokeStyle = '#4b5963'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y1); g.lineTo(x0, y0); g.lineTo(x1, y0); g.stroke();
    g.strokeStyle = '#8c3b2e'; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= N; i++) { const x = x0 + ((x1 - x0) * i) / N, y = y0 - ((T[i] - tmin) / (tmax - tmin)) * (y0 - y1); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = '#4b5963'; g.font = `${Math.round(H * 0.06)}px "IBM Plex Mono", monospace`; g.textAlign = 'center';
    g.fillText('中心面', x0, y0 + H * 0.08); g.fillText('加热膜', x0 + (x1 - x0) / 2, y0 + H * 0.08); g.fillText('外表面', x1, y0 + H * 0.08);
    v.foot(this.heat ? `加热 ${(this.t / 60).toFixed(1)} min：中心面比室温高 ${(this.slab.Tc - this.T0).toFixed(2)} K，加热面比中心面高 ${(this.slab.Ts - this.slab.Tc).toFixed(2)} K` : this.t > 0 ? '已停止加热' : '尚未加热，样品内温度均匀');
  }

  // ======================= 数据表 =======================
  tables() {
    return [{
      id: 'rec', title: '每分钟的热电势读数', maxRows: 40,
      columns: [
        { key: 't', label: 't/min', digits: 0, auto: true },
        { key: 'Vt', label: '温差电势 V_t/mV', digits: 3, readTol: 0.0015 },
        { key: 'Vc', label: '温升电势 V_c/mV', digits: 3, readTol: 0.0015 },
        { key: 'dVc', label: 'ΔV_c（每分钟）/mV', digits: 3, calc: (r, i, rows) => (i > 0 && rows && rows[i - 1] ? r.Vc - rows[i - 1].Vc : NaN) },
      ],
      buttons: [{ label: '记录这一分钟的读数', onClick: (t) => this.rec(t) }],
      note: '加热开始后，每到整分钟仪器蜂鸣并保持读数，记下两路热电势。记录 25 分钟以上。温差电势基本不变、温升电势每分钟增加量基本相同时，就进入了准稳态。',
    }];
  }
  rec(t) {
    const a = this.app, h = this.held;
    if (!this.heat && this.t === 0) return a.toast('还没有开始加热', 'warn');
    if (h.m < 1) return a.toast('还没到第 1 分钟', 'warn');
    if (t.rows.some((r) => r.t === h.m)) return a.toast(`第 ${h.m} 分钟已经记过了，等下一分钟`, 'warn');
    t.addRow({ t: h.m, Vt: h.Vt, Vc: h.Vc, _V: this.V });
  }

  // ======================= 自动操作 =======================
  steps() {
    const app = this.app, rows = () => app.table('rec').rows.filter((r) => r.t > 0 && isFinite(r.Vt) && isFinite(r.Vc));
    return [
      {
        title: '检查样品，设定加热电压',
        html: '<p>确认样品内温度均匀（两路热电势都接近 0）。加热电压调到 18.00 V。</p>',
        hint: '电压太低温差太小、读数相对误差大；太高则温升太快，测量时间内样品升温过多，物性参数随温度的变化和散热都变得明显。',
        check: () => this.V >= 15 && this.V <= 20,
        status: () => `加热电压 ${this.V.toFixed(2)} V`,
        diagnose: () => (this.t > 0 && !this.heat ? [{ msg: '这组样品已经加热过。', fix: { label: '换一组放凉的样品', run: async () => this.reset() } }] : []),
        auto: async () => {
          if (this.t > 0 && rows().length === 0) this.reset();
          app.select(app.comp('inst')); await app.tween(() => this.V, (v) => (this.V = v), 18, 500); this.V = 18; app.changed();
        },
      },
      {
        title: '加热，每分钟记录一次',
        html: '<p>打开“开始加热”，计时同时开始。每到整分钟记下温差电势 $V_t$ 和温升电势 $V_c$，至少记录 25 分钟。可以把右上角的时间流速调快。</p>',
        hint: '开头几分钟温差逐渐增大，之后基本不变；温升电势每分钟的增量也逐渐稳定。这就是准稳态。',
        status: () => { const r = rows(); return r.length ? `已记录 ${r.length} 分钟（到第 ${Math.max(...r.map((x) => x.t))} 分钟）` : (this.heat ? '加热中，还没有记录' : '尚未加热'); },
        check: () => { const r = rows(); return r.length >= 20 && Math.max(...r.map((x) => x.t)) >= 25; },
        diagnose: () => (!this.heat && this.t === 0 ? [{ msg: '还没有开始加热。', fix: { label: '开始加热', run: async () => { this.heat = true; } } }] : []),
        auto: async () => {
          app.showTable(0); await app.view('仪器');
          if (!this.heat && this.t === 0) { app.select(app.comp('inst')); this.heat = true; app.renderInspector(); app.changed(); }
          for (let m = 1; m <= 26; m++) {
            if (rows().some((r) => r.t === m)) continue;
            if (this.held.m > m) continue;
            this.holdAt = m;
            await app.until(() => this.held.m >= m, 60000);
            try { if (this.held.m === m) await app.record('rec', 0); } finally { this.holdAt = null; }
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>找出准稳态段：温差电势取平均得 $\\Delta T$，温升电势对时间作直线得升温速率，求导热系数和比热容。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const R = this.app.table('rec').rows.filter((r) => r.t > 0 && isFinite(r.Vt) && isFinite(r.Vc)).sort((a, b) => a.t - b.t);
    if (R.length < 8) return { html: '<p>至少需要 8 分钟以上的数据（建议 25 分钟）。</p>', ok: false };
    // 准稳态段：从温差电势相邻变化连续 3 次都小于 0.003 mV 的地方开始
    let k0 = R.findIndex((r, i) => i >= 3 && [0, 1, 2].every((j) => Math.abs(R[i - j].Vt - R[i - j - 1].Vt) < 0.003));
    if (k0 < 0) k0 = Math.floor(R.length / 2);
    const Q = R.slice(k0), V = R[R.length - 1]._V || this.V, qc = (V * V) / (2 * FL * RHEAT_L);
    const Vt = mean(Q.map((r) => r.Vt)), dT = Vt / S_TC, lam = (qc * RL) / (2 * dT);
    const fit = linFit(Q.map((r) => r.t), Q.map((r) => r.Vc)), rate = fit.k / S_TC / 60, c = qc / (RHO_L * RL * rate);
    const html = `<h3>1. 准稳态段</h3><p>从第 ${Q[0].t} 分钟起，温差电势相邻两次的变化都小于 0.003 mV，取第 ${Q[0].t}–${Q[Q.length - 1].t} 分钟（${Q.length} 个点）为准稳态段。</p>
      <p>加热膜热流密度 $q_c=\\dfrac{V^2}{2Fr}=\\dfrac{${V.toFixed(2)}^2}{2\\times${FL.toFixed(4)}\\times${RHEAT_L.toFixed(1)}}=${qc.toFixed(1)}$ W/m²（每片加热膜的热量一半流向内侧、一半流向外侧）。</p>
      <h3>2. 导热系数</h3><p>准稳态时温差电势平均 $\\overline{V_t}$ = ${Vt.toFixed(4)} mV，$\\Delta T=\\overline{V_t}/S=${dT.toFixed(3)}$ K（$S$ = ${S_TC.toFixed(4)} mV/K）。</p>
      <div class="result-box">$\\lambda=\\dfrac{q_cR}{2\\Delta T}=${lam.toFixed(4)}$ W/(m·K)</div>
      <h3>3. 比热容</h3><p>准稳态段 $V_c$–$t$ 直线斜率 ${fit.k.toFixed(4)} mV/min（r = ${fit.r.toFixed(5)}），升温速率 $\\dfrac{dT}{dt}=${(rate * 60).toFixed(4)}$ K/min $=${rate.toExponential(3)}$ K/s。</p>
      <div class="result-box">$c=\\dfrac{q_c}{\\rho R\\,dT/dt}=${c.toFixed(0)}$ J/(kg·K)</div>
      <p>本组样品出厂时用稳态法、量热法标定的参考值：λ = ${this.mat.lam.toFixed(3)} W/(m·K)，c = ${this.mat.c.toFixed(0)} J/(kg·K)；本次测量的相对误差分别为 ${pct(relErr(lam, this.mat.lam))} 和 ${pct(relErr(c, this.mat.c))}。有机玻璃的文献值：λ ≈ 0.18–0.20 W/(m·K)，c ≈ 1.4×10³ J/(kg·K)。保温层并非完全绝热，外侧样品向外散热，使流向中心的热量略少于 $q_c$：温差和升温速率都偏小，于是 λ 和 c 都偏大，加热时间越长越明显；加热膜本身的热容使开头的升温略慢。</p>`;
    const answers = [{ label: '导热系数 $\\lambda$', unit: 'W/(m·K)', value: lam, digits: 4, tolRel: 0.01 }, { label: '比热容 $c$', unit: 'J/(kg·K)', value: c, digits: 0, tolRel: 0.01 }];
    const plots = [
      { title: '温差电势 V_t – t', xLabel: 't / min', yLabel: 'V_t / mV', series: [{ type: 'scatter', data: R.map((r) => [r.t, r.Vt]), label: 'V_t' }] },
      { title: '温升电势 V_c – t', xLabel: 't / min', yLabel: 'V_c / mV', series: [{ type: 'scatter', data: R.map((r) => [r.t, r.Vc]), label: 'V_c' }, { type: 'line', data: [Q[0].t, Q[Q.length - 1].t].map((t) => [t, fit.k * t + fit.b]), label: '准稳态段拟合' }] },
    ];
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 准稳态</h3><p>厚 $2R$ 的无限大平板，初始温度均匀为 $t_0$，从两个表面以恒定热流密度 $q_c$ 加热。导热方程 $\\dfrac{\\partial t}{\\partial\\tau}=a\\dfrac{\\partial^2t}{\\partial x^2}$（$a=\\lambda/\\rho c$）的解为</p>$$t(x,\\tau)-t_0=\\frac{q_c}{\\lambda}\\left[\\frac{a\\tau}{R}+\\frac{x^2}{2R}-\\frac R6+\\frac R{\\pi^2}\\sum_{n=1}^{\\infty}\\frac{2(-1)^{n+1}}{n^2}\\cos\\frac{n\\pi x}{R}\\,e^{-n^2\\pi^2a\\tau/R^2}\\right]$$<p>$x$ 从中心面量起。加热一段时间后（$a\\tau/R^2\\gtrsim0.5$）级数项衰减到可以忽略，各处温度随时间线性增加、升温速率相同，而任一点与中心面的温差不再变化——这种状态叫准稳态。</p>
<h3>2. 由温差求导热系数</h3><p>准稳态时加热面（$x=R$）与中心面（$x=0$）的温差</p>$$\\Delta t=\\frac{q_cR}{2\\lambda},\\qquad \\lambda=\\frac{q_cR}{2\\Delta t}$$
<h3>3. 由升温速率求比热容</h3><p>准稳态时 $\\dfrac{dt}{d\\tau}=\\dfrac{q_ca}{\\lambda R}=\\dfrac{q_c}{\\rho cR}$，所以 $c=\\dfrac{q_c}{\\rho R\\,dt/d\\tau}$。</p>
<h3>4. 实验装置</h3><p>用四块相同的样品叠放，两片加热膜分别放在第 1、2 块和第 3、4 块之间：中间两块就是被两面加热的“平板”，外侧两块则相当于把同样的热量也吸收掉，使加热膜两侧对称、每侧的热流密度都是 $q_c=\\dfrac{V^2}{2Fr}$（$F$ 为加热膜面积，$r$ 为电阻）。样品的横向尺寸是厚度的 9 倍，近似为无限大平板。</p>
<h3>5. 本仿真的计算模型</h3><p>按一维导热方程用有限体积法和 Crank–Nicolson 格式数值计算：中心面绝热（对称），加热膜有一定热容，外表面经保温层以很小的传热系数向室温散热。热电势按 NIST T 型热电偶分度函数计算，测温仪分辨 1 μV。</p>`;
  }
}
