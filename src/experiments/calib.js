// 实验：电表的改装与校准（替代法测表头内阻 · 并联分流改装电流表 · 串联分压改装电压表 · 校准曲线与准确度等级）
import * as THREE from 'three';
import { meta, thumb } from './calib.meta.js';
import { Circuit, benchTable, analogMeter, dcSupply, rheostat, knifeSwitch, resistanceBox, drawDialFace } from '../core/circuit.js';
import { mean, gauss, rand, relErr, pct, clamp } from '../core/Stats.js';
import { calibFig } from './circuitFigs.js';

const IG = 100e-6; // 表头满偏电流（标称）
const MU_DIVS = 100;
const SA_RANGES = [0.15, 1.5, 7.5].map((m) => ({ label: `${m}mA`, full: m / 1000, R: 0.075 / (m / 1000) }));
const SV_RANGES = [1.5, 3].map((v) => ({ label: `${v}V`, full: v }));
const CLASSES = [0.1, 0.2, 0.5, 1.0, 1.5, 2.5, 5.0];

export class CalibExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.Rg = rand(1600, 2400);
    this._warned = {};
  }

  cameras() {
    return [
      { name: '全景', pos: [0, 100, 92], target: [0, 0, -2] },
      { name: '电表', pos: [10, 48, 22], target: [10, 2, -24] },
      { name: '电阻箱', pos: [30, 50, 40], target: [30, 2, 8] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    const slot = (id, x, z) => app.addSlot({ id, pos: new THREE.Vector3(x, 0, z), accepts: [id] });
    slot('supply', -62, -22); slot('sw', -40, 14); slot('rheo', -22, -24);
    slot('mu', -2, -24); slot('sa', 22, -24); slot('sv', 46, -24);
    slot('rs', 8, 14); slot('rb', 38, 14);
    const cir = (this.cir = new Circuit(app));
    this.sup = cir.add(dcSupply({ defaultSlot: 'supply', vmax: 15, imax: 1 }));
    cir.add(knifeSwitch({ defaultSlot: 'sw' }));
    this.rheo = cir.add(rheostat({ R: 1000, Imax: 0.3, name: '滑线变阻器 1000 Ω', defaultSlot: 'rheo' }));
    this.mu = cir.add(analogMeter({ key: 'mu', name: '待改装表头（100 μA）', short: '表头', kind: 'A', ranges: [{ label: '100μA', full: IG, R: this.Rg }], divs: MU_DIVS, cls: 1.5, nonlin: rand(-0.007, 0.007), nonlin2: rand(-0.004, 0.004), unit: 'μA', defaultSlot: 'mu', desc: '磁电式表头，满偏电流 100 μA，100 格，内阻约 2 kΩ（待测），1.5 级。' }));
    this.sa = cir.add(analogMeter({ key: 'sa', name: '标准毫安表（0.5 级）', short: '标准毫安表', kind: 'A', ranges: SA_RANGES, defaultSlot: 'sa', desc: '0.5 级，150 格，量程 0.15 / 1.5 / 7.5 mA，满偏压降 75 mV。' }));
    this.sv = cir.add(analogMeter({ key: 'sv', name: '标准电压表（0.5 级）', short: '标准电压表', kind: 'V', ranges: SV_RANGES, ohmPerV: 1000, defaultSlot: 'sv', desc: '0.5 级，150 格，量程 1.5 / 3 V，1000 Ω/V。' }));
    this.rs = cir.add(resistanceBox({ key: 'rs', name: '电阻箱 R（替代 / 分流 / 分压）', defaultSlot: 'rs' }));
    this.rb = cir.add(resistanceBox({ key: 'rb', name: '电阻箱 R′（限流）', defaultSlot: 'rb' }));
    this.view = app.addView({ id: 'm', title: '表头（左） · 标准表（右）', w: 320, h: 150, res: 1 });
  }

  pointerDown(e) { return this.cir.pointerDown(e); }
  pointerMove(e) { return this.cir.pointerMove(e); }
  onRemove(c) { this.cir.removeDevice(c.key); }
  tick(dt) { this.cir.tick(dt); }

  update() {
    this.cir.solve();
    const v = this.view, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262a'; g.fillRect(0, 0, W, H);
    const st = this.state();
    const std = st && st.mode === 'vol' ? this.sv : this.sa;
    for (const [m, x, unit] of [[this.mu, 0, 'μA'], [std, W / 2 + 2, std === this.sv ? 'V' : 'mA']]) {
      if (!m.comp.placed) continue;
      const r = m.read();
      drawDialFace(g, x, 0, W / 2 - 2, H, { kind: m.kind, divs: m.divs, cls: m.cls, unit, theta: m.theta, range: r.range ? `量程 ${r.range.label}` : '' });
    }
    v.foot(st ? { rg: '表头与标准表串联', sub: '电阻箱替代表头', amm: `改装电流表：表头 ∥ R = ${this.rs.nominal().toFixed(1)} Ω`, vol: `改装电压表：表头 + R = ${this.rs.nominal().toFixed(1)} Ω` }[st.mode] : '');
    for (const m of [this.mu, this.sa, this.sv]) {
      const k = m.key, over = m.comp.placed && (m.over || m.rev);
      if (over && !this._warned[k]) this.app.toast(`${m.short}${m.rev ? '反偏' : '超量程'}！`, 'warn');
      this._warned[k] = over;
    }
  }

  /** 识别当前电路是哪一种连接 */
  state() {
    const c = this.cir;
    if (!c.placed('mu') || !c.placed('rs') || !c.sol) return null;
    const Imu = c.V('mu:r0', 'mu:com') / this.Rg;
    const Irs = Math.abs(c.V('rs:b', 'rs:a') / this.rs.value());
    const sa = c.placed('sa') && this.sa.rangeIdx >= 0 ? c.V(`sa:r${this.sa.rangeIdx}`, 'sa:com') / SA_RANGES[this.sa.rangeIdx].R : 0;
    const n = c.nets();
    const par = new Set([n('mu:com'), n('mu:r0')]);
    const isPar = par.size === 2 && par.has(n('rs:a')) && par.has(n('rs:b'));
    const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-12);
    if (sa > 2e-6) {
      if (isPar && near(Math.abs(Imu) + Irs, sa, 0.004)) return { mode: 'amm' };
      if (Irs < 1e-9 && near(Imu, sa, 0.003)) return { mode: 'rg' };
      if (Math.abs(Imu) < 1e-9 && near(Irs, sa, 0.003)) return { mode: 'sub' };
    }
    if (!isPar && Imu > 1e-7 && near(Imu, Irs, 0.003) && c.placed('sv') && this.sv.rangeIdx >= 0) {
      const Vsv = c.V(`sv:r${this.sv.rangeIdx}`, 'sv:com');
      const Vser = Math.abs(c.V('mu:r0', 'mu:com')) + Math.abs(c.V('rs:a', 'rs:b'));
      if (near(Vsv, Vser, 0.004)) return { mode: 'vol' };
    }
    return null;
  }
  q(m) { const r = m.read(); return (Math.round(m.theta * m.divs * 10) / 10 / m.divs) * (r.range ? r.range.full : 0); }

  tables() {
    return [
      {
        id: 'rg', title: '替代法测 R_g', maxRows: 4,
        columns: [{ key: 'I0', label: '标准表 I₀/μA', digits: 1 }, { key: 'R', label: '替代电阻 R/Ω', digits: 1 }],
        buttons: [{ label: '记录 I₀（接表头时）', onClick: (t) => this.recI0(t) }, { label: '记录电阻箱示值（替代后）', onClick: (t) => this.recSub(t) }],
        note: '表头与标准表串联，读 I₀；用电阻箱 R 替换表头，其他不动，调 R 使标准表仍为 I₀，则 R_g = R。',
      },
      {
        id: 'ca', title: '校准 1 mA 电流表', maxRows: 10,
        columns: [{ key: 'Ix', label: '改装表示值 I_x/mA', digits: 3 }, { key: 'Is', label: '标准表 I_s/mA', digits: 3 }, { key: 'd', label: 'ΔI = I_s − I_x /mA', digits: 3, calc: (r) => r.Is - r.Ix }],
        buttons: [{ label: '记录（改装表与标准表读数）', onClick: (t) => this.recCal(t, 'amm') }],
        note: '先调满偏：使标准表为 1.000 mA，微调分流电阻使表头恰好满偏。再从大到小取 5 个整刻度点。',
      },
      {
        id: 'cv', title: '校准 1 V 电压表', maxRows: 10,
        columns: [{ key: 'Ux', label: '改装表示值 U_x/V', digits: 3 }, { key: 'Us', label: '标准表 U_s/V', digits: 3 }, { key: 'd', label: 'ΔU = U_s − U_x /V', digits: 3, calc: (r) => r.Us - r.Ux }],
        buttons: [{ label: '记录（改装表与标准表读数）', onClick: (t) => this.recCal(t, 'vol') }],
        note: '先调满偏：使标准表为 1.000 V，微调分压电阻使表头恰好满偏。',
      },
    ];
  }
  live() { return this.cir.dev('sw').closed && this.sup.on; }
  recI0(t) {
    const st = this.state();
    if (!this.live()) return this.app.toast('电路没有接通', 'warn');
    if (!st || st.mode !== 'rg') this.app.toast('应把表头与标准毫安表串联', 'warn');
    if (this.mu.theta < 0.6) this.app.toast('表头偏转小，宜调到接近满偏再测', 'warn');
    t.addRow({ I0: Math.round(this.q(this.sa) * 1e7) / 10 });
  }
  recSub(t) {
    const st = this.state();
    if (!this.live()) return this.app.toast('电路没有接通', 'warn');
    if (!st || st.mode !== 'sub') this.app.toast('应用电阻箱 R 替换表头，其余不动', 'warn');
    const i = t.rows.length - 1;
    if (i < 0 || t.rows[i].I0 == null) return this.app.toast('请先记录 I₀', 'warn');
    if (Math.abs(this.q(this.sa) * 1e6 - t.rows[i].I0) > 0.25) this.app.toast('标准表读数与 I₀ 不同，继续调 R', 'warn');
    t.set(i, 'R', Math.round(this.rs.nominal() * 10) / 10);
  }
  recCal(t, mode) {
    const st = this.state();
    if (!this.live()) return this.app.toast('电路没有接通', 'warn');
    if (!st || st.mode !== mode) this.app.toast(mode === 'amm' ? '应把电阻箱并联在表头两端，再与标准毫安表串联' : '应把电阻箱与表头串联，再与标准电压表并联', 'warn');
    if (this.mu.over || this.sa.over || this.sv.over) return this.app.toast('有电表超量程', 'warn');
    const n = Math.round(this.mu.theta * MU_DIVS * 10) / 10;
    if (mode === 'amm') t.addRow({ Ix: n / 100, Is: +(this.q(this.sa) * 1000).toFixed(4), R: this.rs.nominal() });
    else t.addRow({ Ux: n / 100, Us: +this.q(this.sv).toFixed(4), R: this.rs.nominal() });
  }

  // ---------------- 自动操作 ----------------
  /** 二分调节 set(x)，使 f() 达到目标（f 随 x 单调） */
  find(set, f, lo, hi, target) {
    const flo = (set(lo), this.cir.solve(), f()), up = f;
    let a = lo, b = hi;
    for (let i = 0; i < 50; i++) { const m = (a + b) / 2; set(m); this.cir.solve(); const v = up(); if ((v - target) * (flo - target) > 0) a = m; else b = m; }
    return (a + b) / 2;
  }
  async slide(f, target) {
    const rh = this.rheo, s0 = rh.s;
    const s = this.find((x) => (rh.s = x), f, 0, 1, target);
    rh.s = s0; this.cir.solve();
    this.app.select(rh.comp);
    await this.app.tween(() => rh.s, (v) => (rh.s = v), clamp(s + gauss(0.0005), 0, 1), 500);
    await this.cir.settle([this.mu, this.sa, this.sv]);
  }
  async boxTo(box, R, ms = 600) {
    this.app.select(box.comp);
    await this.app.tween(() => box.nominal(), (v) => box.set(v), R, ms); box.set(R); this.app.changed();
    await this.cir.settle([this.mu, this.sa, this.sv]);
  }
  async power(on) { const sw = this.cir.dev('sw'); this.app.select(sw.comp); sw.closed = on; this.app.changed(); await this.app.wait(250); }
  boxFind(box, f, lo, hi, target) {
    const d0 = box.d.slice();
    const R = this.find((x) => box.set(x), f, lo, hi, target);
    box.d = d0; this.cir.solve();
    return Math.round(R * 10) / 10;
  }

  steps() {
    const app = this.app, cir = this.cir;
    const rgRow = () => app.table('rg').completeRows().pop();
    const divider = [['supply:+', 'sw:a'], ['sw:b', 'rheo:A'], ['rheo:B', 'supply:-']];
    const calibrate = async (mode) => {
      const id = mode === 'amm' ? 'ca' : 'cv';
      app.showTable(app.tables.findIndex((t) => t.id === id));
      // 调满偏：标准表为满量程值，再微调电阻箱使表头满偏
      const stdF = mode === 'amm' ? () => this.sa.target * SA_RANGES[this.sa.rangeIdx].full * 1000 : () => this.sv.target * SV_RANGES[this.sv.rangeIdx].full;
      await this.slide(stdF, 1.0);
      const R = this.boxFind(this.rs, () => this.mu.target, mode === 'amm' ? 50 : 5000, mode === 'amm' ? 600 : 12000, 1.0);
      await this.boxTo(this.rs, R, 500);
      await this.slide(stdF, 1.0);
      for (const n of [1.0, 0.8, 0.6, 0.4, 0.2]) { await this.slide(() => this.mu.target, n); await app.record(id); }
    };
    return [
      {
        title: '摆放仪器',
        html: '<p>把电源、开关、滑线变阻器、表头、标准毫安表、标准电压表和两个电阻箱放到桌上。</p>',
        check: () => ['supply', 'sw', 'rheo', 'mu', 'sa', 'sv', 'rs', 'rb'].every((k) => cir.placed(k)),
        auto: async () => { await app.view('全景'); for (const k of ['supply', 'sw', 'rheo', 'mu', 'sa', 'sv', 'rs', 'rb']) await app.autoPlace(k); },
      },
      {
        title: '替代法测表头内阻',
        html: '<p>电源 → 开关 → 限流电阻箱 R′（先放约 9 kΩ）→ 标准毫安表（0.15 mA 档）→ 表头 → 电源负极。电源调到约 1 V，使表头接近满偏，记录标准表读数 $I_0$。</p><p>断开开关，用电阻箱 R 换下表头，其余不动；合上开关，调 R 使标准表读数仍为 $I_0$，记录 R，即 $R_g$。</p>',
        check: () => { const r = rgRow(); return !!r && relErr(r.R, this.Rg) < 0.02; },
        status: () => { const r = rgRow(); return r ? `R_g ≈ ${r.R.toFixed(1)} Ω` : ''; },
        auto: async () => {
          await this.power(false);
          await this.boxTo(this.rb, 9000, 400);
          await cir.rewire([['supply:+', 'sw:a'], ['sw:b', 'rb:b'], ['rb:a', 'sa:r0'], ['sa:com', 'mu:r0'], ['mu:com', 'supply:-']]);
          const sp = this.sup; app.select(sp.comp); sp.on = true;
          sp.Vset = 0.5; await this.power(true);
          const V = this.find((x) => (sp.Vset = x), () => this.mu.target, 0.1, 2, 0.95);
          sp.Vset = 0.5; this.cir.solve();
          app.select(sp.comp); await app.tween(() => sp.Vset, (x) => (sp.Vset = x), Math.round(V * 100) / 100, 600);
          await cir.settle([this.mu, this.sa]);
          app.showTable(0); await app.record('rg', 0);
          const I0 = this.sa.target;
          await this.power(false);
          await this.boxTo(this.rs, 2000, 300);
          await cir.rewire([['supply:+', 'sw:a'], ['sw:b', 'rb:b'], ['rb:a', 'sa:r0'], ['sa:com', 'rs:b'], ['rs:a', 'supply:-']]);
          await this.power(true);
          await this.boxTo(this.rs, this.boxFind(this.rs, () => this.sa.target, 500, 4000, I0), 800);
          await app.record('rg', 1);
        },
      },
      {
        title: '改装成 1 mA 电流表并校准',
        html: '<p>按 $R_s=R_g/(n-1)$（$n=10$）算出分流电阻，在电阻箱 R 上置好，并联在表头两端。用分压电路供电：滑动端 C → 限流电阻箱 R′（约 500 Ω）→ 标准毫安表（1.5 mA 档）→ 改装表 → B。</p><p>先调满偏，再从大到小取表头 100、80、60、40、20 格五点，记录改装表示值与标准表读数。</p>',
        check: () => app.table('ca').completeRows().length >= 5,
        status: () => `已记录 ${app.table('ca').completeRows().length} 组`,
        auto: async () => {
          await this.power(false);
          const Rg = rgRow() ? rgRow().R : 2000;
          await this.boxTo(this.rs, Math.round((Rg / 9) * 10) / 10, 400);
          await this.boxTo(this.rb, 500, 400);
          const sp = this.sup; app.select(sp.comp); await app.tween(() => sp.Vset, (x) => (sp.Vset = x), 2, 400);
          const rh = this.rheo; app.select(rh.comp); await app.tween(() => rh.s, (v) => (rh.s = v), 1, 300);
          await cir.rewire([...divider, ['rheo:C', 'rb:a'], ['rb:b', 'sa:r1'], ['sa:com', 'mu:r0'], ['mu:com', 'rheo:B'], ['rs:a', 'mu:r0'], ['rs:b', 'mu:com']]);
          await this.power(true);
          await app.view('电表');
          await calibrate('amm');
        },
      },
      {
        title: '改装成 1 V 电压表并校准',
        html: '<p>按 $R_m=U/I_g-R_g$ 算出分压电阻（$U$ = 1 V），置于电阻箱 R，与表头串联。改装表与标准电压表（1.5 V 档）并联后接在分压输出 C、B 之间。同样先调满偏，再校准五点。</p>',
        check: () => app.table('cv').completeRows().length >= 5,
        status: () => `已记录 ${app.table('cv').completeRows().length} 组`,
        auto: async () => {
          await this.power(false);
          const Rg = rgRow() ? rgRow().R : 2000;
          await this.boxTo(this.rs, Math.round((1 / IG - Rg) * 10) / 10, 400);
          const rh = this.rheo; app.select(rh.comp); await app.tween(() => rh.s, (v) => (rh.s = v), 1, 300);
          await cir.rewire([...divider, ['rheo:C', 'mu:r0'], ['mu:com', 'rs:a'], ['rs:b', 'rheo:B'], ['sv:r0', 'rheo:C'], ['sv:com', 'rheo:B']]);
          await this.power(true);
          await calibrate('vol');
          await this.power(false);
        },
      },
      {
        title: '数据处理：校准曲线与准确度等级',
        html: '<p>以改装表示值为横坐标、修正值 Δ 为纵坐标，相邻点连成折线，得校准曲线。（最大修正值 + 标准表允许误差）÷ 量程，确定改装表的准确度等级。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const app = this.app;
    const rg = app.table('rg').completeRows(), ca = app.table('ca').completeRows(), cv = app.table('cv').completeRows();
    if (!rg.length && !ca.length && !cv.length) return { html: '<p>请先测量。</p>', ok: false };
    let html = '';
    const answers = [], plots = [];
    if (rg.length) {
      const Rg = mean(rg.map((r) => r.R));
      html += `<h3>1. 表头内阻</h3><p>替代法：$R_g=${Rg.toFixed(1)}$ Ω。</p><div class="result-box">$R_s=\\dfrac{R_g}{n-1}=\\dfrac{${Rg.toFixed(1)}}{9}=${(Rg / 9).toFixed(1)}$ Ω，$R_m=\\dfrac{1\\ \\text{V}}{100\\ \\mu\\text{A}}-R_g=${(1 / IG - Rg).toFixed(1)}$ Ω</div>`;
      answers.push({ label: '表头内阻 $R_g$', unit: 'Ω', value: Rg, digits: 1, tolRel: 0.006 });
      answers.push({ label: '分流电阻 $R_s$（1 mA）', unit: 'Ω', value: Rg / 9, digits: 1, tolRel: 0.006 });
      answers.push({ label: '分压电阻 $R_m$（1 V）', unit: 'Ω', value: 1 / IG - Rg, digits: 1, tolRel: 0.003 });
      html += `<p>表头内阻实际值 ${this.Rg.toFixed(1)} Ω，替代法相对误差 ${pct(relErr(Rg, this.Rg))}。</p>`;
    }
    const cal = (rows, xk, sk, full, stdFull, unit, title) => {
      const pts = rows.map((r) => [r[xk], r[sk] - r[xk]]).sort((a, b) => a[0] - b[0]);
      const dmax = Math.max(...pts.map((p) => Math.abs(p[1])));
      const dstd = stdFull * 0.005;
      const a = ((dmax + dstd) / full) * 100;
      const c0 = CLASSES.find((c) => c >= a - 1e-9);
      const cls = c0 == null ? '低于 5.0' : c0.toFixed(1);
      const R = mean(rows.map((r) => r.R));
      html += `<h3>${title}</h3><p>满偏校准后电阻箱示值 ${R.toFixed(1)} Ω。最大修正值 $|\\Delta|_{max}=${dmax.toFixed(3)}$ ${unit}；标准表（0.5 级，${stdFull} ${unit} 档）最大允许误差 $\\Delta_s=${stdFull}\\times0.5\\%=${dstd.toFixed(4)}$ ${unit}。</p><div class="result-box">$E=\\dfrac{|\\Delta|_{max}+\\Delta_s}{量程}\\times100\\%=${a.toFixed(2)}\\%$，改装表定为 ${cls} 级</div>`;
      plots.push({ title: `${title}：校准曲线`, xLabel: `示值 / ${unit}`, yLabel: `修正值 Δ / ${unit}`, series: [{ type: 'scatter', data: [[0, 0], ...pts] }, { type: 'line', data: [[0, 0], ...pts] }] });
    };
    if (ca.length >= 2) cal(ca, 'Ix', 'Is', 1, 1.5, 'mA', '2. 改装电流表（1 mA）');
    if (cv.length >= 2) cal(cv, 'Ux', 'Us', 1, 1.5, 'V', '3. 改装电压表（1 V）');
    html += '<p class="muted">改装表的误差包括标准表本身的误差（0.5 级）、表头刻度的非线性和读数误差，所以改装表的等级不可能高于标准表。</p>';
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 表头</h3><p>磁电式表头允许通过的最大电流（满偏电流 $I_g$）很小，线圈有内阻 $R_g$。要测较大的电流或电压，需要扩大量程。</p>
<h3>2. 替代法测内阻</h3><p>表头与标准表串联，读 $I_0$；用电阻箱换下表头，调电阻箱使电路电流仍为 $I_0$，则电阻箱示值等于 $R_g$。结果与标准表的准确度无关，只取决于电阻箱和判断“相等”的灵敏度。</p>
${calibFig()}
<h3>3. 改装成电流表</h3><p>表头并联分流电阻 $R_s$，量程扩大为 $I=nI_g$：</p>$$R_s=\\frac{R_g}{n-1}$$
<h3>4. 改装成电压表</h3><p>表头串联分压电阻 $R_m$，量程为 $U$：</p>$$R_m=\\frac{U}{I_g}-R_g$$
<h3>5. 校准</h3><p>改装表与标准表同时测同一量，修正值 $\\Delta=x_s-x$。以示值为横坐标、修正值为纵坐标，相邻点用直线连接成折线，即校准曲线；使用改装表时按曲线修正。最大修正值加上标准表本身的最大允许误差，再除以量程，得到改装表的标定误差，向上取到国家标准规定的等级（0.1、0.2、0.5、1.0、1.5、2.5、5.0）。</p>
<h3>6. 本仿真的计算模型</h3><p>电路用改进节点法求解，每个电表都作为带内阻的元件接入电路。表头实际满偏电流与标称值有 1.5 级以内的偏差，并有轻微的刻度非线性，所以需要“调满偏”，校准曲线也不是一条直线。</p>`;
  }
}
