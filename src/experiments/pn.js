// 实验：PN 结与热敏电阻的温度特性（加热炉 + 温控仪 + PN 结特性测试仪 + 数字万用表）
// 加热炉内的空气温度由温控仪按一阶系统逼近设定值，样品座（PN 结与热敏电阻贴在同一铜块上）以更长的时间常数跟随；
// 温控仪的传感器在炉膛里，示数先到，样品后到。PN 结与热敏电阻的读数都按样品座温度计算（模型见 physics/semi.js）。
// 伏安特性用运放做电流–电压变换：U₂ = I·R_f（R_f = 1 MΩ），输出超过约 11.8 V 饱和。
import * as THREE from 'three';
import { meta, thumb } from './pn.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, relErr, pct, clamp, fmtU, linFit, mean, sig } from '../core/Stats.js';
import { makeJunction, makeNTC, QE, KB, T25 } from '../physics/semi.js';
import { pnFig } from './modernFigs.js';

const RF = 1e6, USAT = 11.8, K0 = 273.15;
const SETS = [30, 40, 50, 60, 70, 80];
const IFS = [10e-6, 50e-6, 100e-6];
const SVG = (inner) => `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;

export class PnExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.T0 = rand(18, 25); this.Ta = this.T0; this.Ts = this.T0;
    this.tauA = rand(40, 55); this.tauS = rand(70, 100);
    this.heat = false; this.set = Math.round(this.T0);
    this.mode = 'iu'; this.U1 = 0; this.IF = 100e-6; this.timeScale = 1; this.t = 0;
    this.pn = makeJunction({ Is300: rand(2e-15, 6e-15), n: rand(1.004, 1.015), r: 3, Ir300: rand(1e-13, 3e-13) });
    this.off = rand(-1.5e-3, 1.5e-3); this.nz = 0; // 运放输出失调（V）与室温的缓慢起伏（K）
    this.ntc = makeNTC({ R25: 10e3 * rand(0.97, 1.03), B: rand(3350, 3500), g: rand(1.5e4, 3.5e4) });
  }

  // ---------- 仪器示数 ----------
  get TK() { return this.Ts + this.nz + K0; }
  get Tshow() { return Math.round((this.Ta + 0.1 * (this.Ta - this.Ts)) * 10) / 10; }
  get I() { return this.pn.current(this.U1, this.TK); }
  get U2() { return Math.round(clamp(this.I * RF + this.off, 0, USAT) * 1000) / 1000; }
  get U1show() { return Math.round(this.U1 * 1000) / 1000; }
  get UF() { return Math.round(this.pn.voltage(this.IF, this.TK) * 1e4) / 10; } // mV，0.1 mV
  get R() { return Number(sig(this.ntc.R(this.TK) / 1e3, 4)); } // kΩ，4 位有效数字
  steady() { return Math.abs(this.Ta - this.set) < 0.2 && Math.abs(this.Ts - this.Ta) < 0.08; }

  tick(dt) {
    const a = this.app, sdt = Math.min(40, dt * (a.running ? a.speed * 25 : this.timeScale));
    if (!(sdt > 0)) return;
    const n = Math.max(1, Math.ceil(sdt / 0.5)), h = sdt / n;
    for (let i = 0; i < n; i++) {
      const target = this.heat ? this.set : this.T0;
      let dTa = (target - this.Ta) / this.tauA;
      if (this.heat) dTa = clamp(dTa * 1.6, -0.03, 0.3); // 加热功率有限；降温靠自然散热
      this.Ta += dTa * h;
      this.Ts += ((this.Ta - this.Ts) / this.tauS) * h;
      this.nz += (-this.nz / 30 + 0.012 * (Math.random() - 0.5)) * h; // 样品座温度的小起伏（约 ±0.03 K）
      this.t += h;
    }
    a.changed();
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 70, 105], target: [0, 10, 0] }, { name: '仪器面板', pos: [8, 30, 52], target: [8, 8, -10] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 70));
    app.stage.setLightTarget(0, 10, 0);
    // 加热炉：立式圆筒，样品管从顶部插入
    const oven = new THREE.Group(); oven.position.set(-44, 0, 4);
    oven.add(mesh(new THREE.CylinderGeometry(9, 10, 22, 40), MAT.paint(0x2f6f5f), 0, 11, 0));
    oven.add(mesh(new THREE.CylinderGeometry(9.2, 9.2, 1.2, 40), MAT.alu(), 0, 22.4, 0));
    oven.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 14, 20), MAT.chrome(), 0, 28, 0));
    oven.add(mesh(new THREE.CylinderGeometry(2.4, 2.4, 2.4, 20), MAT.black(), 0, 35, 0));
    this.ovenGlow = MAT.emissive(0xff5a1f, 0); oven.add(mesh(new THREE.TorusGeometry(9.1, 0.25, 8, 48), this.ovenGlow, 0, 5, 0).rotateX(Math.PI / 2));
    const tc = (this.tcBox = meterBox(18, 10, 12, '温控仪')); tc.group.position.set(-20, 0, -14);
    app.addComponent(new Component({
      key: 'oven', name: '加热炉与温控仪', zone: 'none', fixed: true, required: true, object: new THREE.Group().add(oven, tc.group), labelY: 38,
      icon: SVG('<rect x="10" y="8" width="18" height="26" rx="3"/><path d="M19 8V2"/><rect x="36" y="16" width="22" height="16"/>'),
      desc: '样品管内的铜座上贴着一只硅三极管（b、c 短接作 PN 结）和一只 NTC 热敏电阻，插在加热炉中。温控仪的传感器在炉膛里，显示精度 0.1 °C。加热时炉温约 0.3 °C/s 上升，接近设定值时减慢；样品座的温度要再晚一两分钟才跟上。',
      controls: () => [
        { type: 'toggle', label: '加热', get: () => this.heat, set: (v) => { this.heat = v; app.changed(); } },
        { type: 'knob', label: '设定温度', get: () => this.set, set: (v) => { this.set = clamp(Math.round(v * 10) / 10, 15, 95); app.changed(); }, min: 15, max: 95, step: 0.1, bigStep: 5, perRev: 20, digits: 1, unit: '°C' },
        { type: 'readout', label: '炉温', get: () => `${this.Tshow.toFixed(1)} °C` },
      ],
    }));
    const tb = (this.tbBox = meterBox(30, 11, 14, 'PN 结特性测试仪')); tb.group.position.set(10, 0, -12);
    app.addComponent(new Component({
      key: 'tester', name: 'PN 结特性测试仪', zone: 'none', fixed: true, required: true, object: tb.group, labelY: 15,
      icon: SVG('<rect x="6" y="10" width="52" height="22" rx="2"/><path d="M14 21h10M30 15v12M30 21l8-6v12z"/>'),
      desc: '两种工作方式。“伏安特性”：给 PN 结加可调正向电压 U₁（0–0.65 V，示数 1 mV），电流经运放变换为电压 U₂ = I·R_f，R_f = 1.000 MΩ，U₂ 超过约 11.8 V 时运放饱和。“恒流”：提供 10 / 50 / 100 μA 恒定正向电流，显示 PN 结正向压降 U_F（0.1 mV）。',
      controls: () => [
        { type: 'segment', label: '工作方式', get: () => this.mode, set: (v) => { this.mode = v; app.changed(); app.renderInspector(); }, options: [{ label: '伏安特性', value: 'iu' }, { label: '恒流 U_F', value: 'uf' }] },
        ...(this.mode === 'iu'
          ? [{ type: 'knob', label: '正向电压 U₁', get: () => this.U1, set: (v) => { this.U1 = clamp(Math.round(v * 2000) / 2000, 0, 0.65); app.changed(); }, min: 0, max: 0.65, step: 0.0005, bigStep: 0.01, perRev: 0.05, digits: 3, unit: 'V' }]
          : [{ type: 'segment', label: '正向电流 I_F', get: () => this.IF, set: (v) => { this.IF = v; app.changed(); }, options: IFS.map((i) => ({ label: `${i * 1e6} μA`, value: i })) }]),
      ],
    }));
    const dm = (this.dmBox = meterBox(12, 14, 8, '万用表')); dm.group.position.set(42, 0, -8); dm.group.rotation.y = -0.3;
    app.addComponent(new Component({
      key: 'dmm', name: '数字万用表（测热敏电阻）', zone: 'none', fixed: true, object: dm.group, labelY: 17,
      icon: SVG('<rect x="18" y="4" width="28" height="32" rx="3"/><rect x="22" y="8" width="20" height="9"/><circle cx="32" cy="27" r="4"/>'),
      desc: '电阻挡，显示 4 位有效数字。测量电流很小（约 10 μA），热敏电阻的自热可以忽略。',
      controls: () => [{ type: 'readout', label: '热敏电阻 R_T', get: () => `${this.R} kΩ` }],
    }));
    // 连线：样品管顶部 → 测试仪、万用表；温控仪 → 炉子
    const wire = (pts, c) => { const cv = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))); scene.add(mesh(new THREE.TubeGeometry(cv, 40, 0.28, 8), MAT.paint(c))); };
    wire([[-44, 36, 4], [-36, 40, 0], [-12, 18, -6], [-2, 6, -6]], 0x1b1b1b);
    wire([[-43, 36, 5], [-30, 42, 6], [20, 22, 4], [38, 8, -4]], 0xc81e1e);
    wire([[-36, 3, 2], [-28, 1, -6], [-24, 4, -10]], 0x1f4fbf);
    this.view = app.addView({ id: 'panel', title: '仪器读数', w: 300, h: 168, res: 1.5 });
  }

  update() {
    const tS = `${this.Tshow.toFixed(1)}|${this.set}|${this.heat}`;
    if (tS !== this._ts) { this._ts = tS; this.tcBox.setText(this.Tshow.toFixed(1), '°C', `设定 ${this.set.toFixed(1)} °C ${this.heat ? '加热中' : '停止'}`); }
    const main = this.mode === 'iu' ? this.U2.toFixed(3) : this.UF.toFixed(1), sub = this.mode === 'iu' ? `U₁ = ${this.U1show.toFixed(3)} V   U₂ (V)` : `I_F = ${this.IF * 1e6} μA   U_F (mV)`;
    if (main + sub !== this._tb) { this._tb = main + sub; this.tbBox.setText(main, this.mode === 'iu' ? 'V' : 'mV', sub); }
    const r = String(this.R);
    if (r !== this._dm) { this._dm = r; this.dmBox.setText(r, 'kΩ', '电阻挡'); }
    this.ovenGlow.emissiveIntensity = this.heat && this.Ta < this.set - 0.3 ? 0.9 : this.heat ? 0.25 : 0;

    const v = this.view, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    const lcd = (x, y, w, label, val, unit, color) => {
      g.fillStyle = '#9aa5ab'; g.font = `${H * 0.075}px "Microsoft YaHei"`; g.textAlign = 'left'; g.fillText(label, x, y);
      g.fillStyle = '#0b1410'; g.fillRect(x, y + H * 0.04, w, H * 0.22);
      g.fillStyle = color; g.font = `600 ${H * 0.15}px "IBM Plex Mono", monospace`; g.textAlign = 'right'; g.fillText(val, x + w - H * 0.2, y + H * 0.21);
      g.fillStyle = '#7d8a90'; g.font = `${H * 0.07}px "IBM Plex Mono", monospace`; g.textAlign = 'left'; g.fillText(unit, x + w - H * 0.18, y + H * 0.21);
    };
    lcd(W * 0.04, H * 0.1, W * 0.42, '温控仪 t', this.Tshow.toFixed(1), '°C', '#ff9b6b');
    lcd(W * 0.54, H * 0.1, W * 0.42, '万用表 R_T', String(this.R), 'kΩ', '#8fe3a5');
    if (this.mode === 'iu') { lcd(W * 0.04, H * 0.52, W * 0.42, '正向电压 U₁', this.U1show.toFixed(3), 'V', '#8fe3a5'); lcd(W * 0.54, H * 0.52, W * 0.42, '运放输出 U₂', this.U2.toFixed(3), 'V', this.U2 >= USAT ? '#ff6b6b' : '#8fe3a5'); }
    else lcd(W * 0.04, H * 0.52, W * 0.92, `恒流 ${this.IF * 1e6} μA 时的正向压降 U_F`, this.UF.toFixed(1), 'mV', '#8fe3a5');
    const dT = this.Ta - this.Ts;
    v.foot(this.mode === 'iu' && this.U2 >= USAT ? '运放已饱和：电流超过 11.8 μA，减小 U₁'
      : this.heat && Math.abs(this.Ta - this.set) > 0.3 ? '升温中……'
      : Math.abs(dT) > 0.08 ? `炉温已稳定，样品座还差 ${dT.toFixed(2)} °C，读数还在变`
      : '温度稳定，可以记录');
  }
  globalControls() { return [{ type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×5', value: 5 }, { label: '×20', value: 20 }] }]; }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'iu', title: 'PN 结伏安特性（室温）', maxRows: 14,
        columns: [
          { key: 'T', label: 't/°C', digits: 1, readTol: 0.06 },
          { key: 'U1', label: 'U₁/V', digits: 3, readTol: 0.0011 },
          { key: 'U2', label: 'U₂/V', digits: 3, readTol: 0.0011 },
          { key: 'I', label: 'I/μA', digits: 4, calc: (r) => r.U2 / RF * 1e6 },
          { key: 'lnI', label: 'ln(I/A)', digits: 3, calc: (r) => Math.log(r.U2 / RF) },
        ],
        buttons: [{ label: '记录 t、U₁、U₂', onClick: (t) => this.recIU(t) }],
        note: '加热关闭、样品在室温下测。U₂ 取 0.02 V 到 10 V 之间（电流跨两个半数量级以上），按 U₁ 由小到大大致等间隔取 8 组以上。',
      },
      {
        id: 'ut', title: 'U_F 与 R_T 随温度的变化', maxRows: 12,
        columns: [
          { key: 'T', label: 't/°C', digits: 1, readTol: 0.06 },
          { key: 'UF', label: 'U_F/mV', digits: 1, readTol: 0.11 },
          { key: 'R', label: 'R_T/kΩ', digits: 3, readTol: (ref) => Math.max(0.0011, Math.abs(ref) * 0.0011) },
        ],
        buttons: [{ label: '记录 t、U_F、R_T', onClick: (t) => this.recUT(t) }],
        note: '测试仪置“恒流”，I_F 取 100 μA 且整个过程不变。第一行在室温下记，之后每升高约 10 °C，等 U_F 不再变化再记录。',
      },
    ];
  }
  recIU(t) {
    const a = this.app;
    if (this.mode !== 'iu') return a.toast('测试仪还在“恒流”方式：切换到“伏安特性”', 'warn');
    if (this.U2 >= USAT) return a.toast('运放已饱和，这一点不能用：减小 U₁', 'warn');
    if (this.U2 < 0.005) return a.toast('U₂ 太小（电流不到 5 nA），读数的相对误差太大：增大 U₁', 'warn');
    if (this.Ts > this.T0 + 1.5) a.toast('样品不在室温：伏安特性应在室温下、温度不变时测', 'warn');
    if (t.rows.some((r) => Math.abs(r.U1 - this.U1show) < 0.0005)) return a.toast('这个 U₁ 已经记过了', 'warn');
    t.addRow({ T: this.Tshow, U1: this.U1show, U2: this.U2 });
  }
  recUT(t) {
    const a = this.app;
    if (this.mode !== 'uf') return a.toast('测试仪还在“伏安特性”方式：切换到“恒流”', 'warn');
    const first = t.rows.find((r) => r._IF);
    if (first && first._IF !== this.IF) a.toast(`前面是用 ${first._IF * 1e6} μA 测的，同一组数据的正向电流必须保持不变`, 'warn');
    if (Math.abs(this.Ts - this.Ta) > 0.08) a.toast(`样品座比炉温${this.Ts < this.Ta ? '低' : '高'} ${Math.abs(this.Ta - this.Ts).toFixed(2)} °C，U_F 还在变：等稳定再记`, 'warn');
    if (t.rows.some((r) => Math.abs(r.T - this.Tshow) < 1)) a.toast('这个温度已经记过了', 'warn');
    t.addRow({ T: this.Tshow, UF: this.UF, R: this.R, _IF: this.IF });
  }

  // ======================= 自动操作 =======================
  async heatTo(T) {
    const a = this.app;
    a.select(a.comp('oven'));
    await a.tween(() => this.set, (v) => (this.set = Math.round(v * 10) / 10), T, 600); this.set = T; this.heat = true; a.renderInspector();
    await a.until(() => this.steady(), 150000);
  }
  async cool() {
    const a = this.app;
    if (this.heat) { a.select(a.comp('oven')); this.heat = false; a.renderInspector(); }
    if (this.Ts > this.T0 + 0.5) { a.say('关闭加热，等样品冷却到室温'); await a.until(() => this.Ts < this.T0 + 0.5 && this.Ta < this.T0 + 0.5, 200000); }
  }
  setMode(m) { this.mode = m; this.app.select(this.app.comp('tester')); this.app.renderInspector(); this.app.changed(); }
  steps() {
    const app = this.app;
    const iu = () => app.table('iu').rows.filter((r) => isFinite(r.U2) && r.U2 >= 0.005 && r.U2 < USAT);
    const ut = () => app.table('ut').rows.filter((r) => isFinite(r.UF) && isFinite(r.T));
    return [
      {
        title: '室温下测 PN 结的伏安特性',
        html: '<p>加热关闭，样品在室温。测试仪置“伏安特性”，从约 0.4 V 起逐步增大正向电压 $U_1$，记下运放输出 $U_2$，$I=U_2/R_f$。$U_2$ 从几十毫伏取到约 10 V，至少 8 组。同时记下室温 $t$。</p>',
        hint: '电流按指数增长：U₁ 每增加约 60 mV，电流增大约 10 倍。U₂ 到 11.8 V 就饱和了。',
        status: () => `已记录 ${iu().length} 组有效数据`,
        check: () => { const r = iu(); if (r.length < 8) return false; const u = r.map((x) => x.U2); return Math.max(...u) / Math.min(...u) >= 100; },
        diagnose: () => {
          const out = [];
          if (this.Ts > this.T0 + 1.5) out.push({ msg: `样品现在约 ${this.Ts.toFixed(1)} °C，不在室温。伏安特性要在温度不变时测，先关掉加热等它冷下来。`, fix: { label: '关加热，等冷却', run: () => this.cool() } });
          if (this.mode !== 'iu') out.push({ msg: '测试仪在“恒流”方式，伏安特性要切到“伏安特性”。', fix: { label: '切到伏安特性', run: () => this.setMode('iu') } });
          else if (this.U2 >= USAT) out.push({ msg: '运放饱和了（U₂ ≈ 11.8 V），这时的读数不能用。把 U₁ 调小。' });
          else if (this.U2 < 0.005) out.push({ msg: `U₁ = ${this.U1show.toFixed(3)} V 时电流还不到 5 nA。PN 结要到 0.4 V 左右才有可测的电流。` });
          const r = iu();
          if (r.length >= 3) { const u = r.map((x) => x.U2); if (Math.max(...u) / Math.min(...u) < 100) out.push({ msg: '已记的点电流范围太窄。U₂ 最好从 0.02 V 取到 10 V，跨越两个数量级以上，ln I–U 才拟合得准。' }); }
          return out;
        },
        auto: async () => {
          await this.cool();
          this.setMode('iu'); app.showTable(0);
          const Is = [0.03, 0.08, 0.2, 0.5, 1.2, 2.5, 4.5, 7, 9.5].map((x) => x * 1e-6);
          for (const I of Is) {
            const U = Math.round(this.pn.voltage(I, this.TK) * 1000) / 1000;
            if (app.table('iu').rows.some((r) => Math.abs(r.U1 - U) < 0.0005)) continue;
            await app.tween(() => this.U1, (v) => (this.U1 = v), U, 300); this.U1 = U;
            await app.record('iu', 0);
          }
        },
      },
      {
        title: '恒流 100 μA，记录室温下的 U_F 与 R_T',
        html: '<p>测试仪切到“恒流”，正向电流 $I_F$ 取 100 μA。在室温下记录温度 $t$、PN 结正向压降 $U_F$ 和热敏电阻阻值 $R_T$，作为第一组数据。</p>',
        check: () => ut().some((r) => r.T < this.T0 + 2),
        diagnose: () => {
          const out = [];
          if (this.mode !== 'uf') out.push({ msg: '测试仪还在“伏安特性”方式。', fix: { label: '切到恒流 100 μA', run: () => { this.IF = 100e-6; this.setMode('uf'); } } });
          else if (this.IF !== 100e-6) out.push({ msg: `正向电流现在是 ${this.IF * 1e6} μA，本实验约定用 100 μA。`, fix: { label: '改为 100 μA', run: () => { this.IF = 100e-6; app.renderInspector(); } } });
          if (this.Ts > this.T0 + 2) out.push({ msg: '样品已经不在室温。第一组数据要在加热前记录；可以关掉加热等它冷却。', fix: { label: '关加热，等冷却', run: () => this.cool() } });
          return out;
        },
        auto: async () => { await this.cool(); this.IF = 100e-6; this.setMode('uf'); app.showTable(1); await app.record('ut', 0); },
      },
      {
        title: '逐步升温到 80 °C，每 10 °C 记录一次',
        html: '<p>温控仪设定 30 °C，打开加热。炉温到达设定值后，样品座的温度还要一段时间才跟上：<b>等 $U_F$ 不再变化</b>再记录 $t$、$U_F$、$R_T$。然后依次设定 40、50、60、70、80 °C 重复。</p>',
        hint: '炉温先稳定，样品后稳定。可以把时间流速调快。',
        status: () => `已记录 ${ut().length} 个温度点`,
        check: () => ut().length >= 6 && Math.max(...ut().map((r) => r.T)) >= 75,
        diagnose: () => {
          const out = [];
          if (this.mode !== 'uf') out.push({ msg: '测试仪要在“恒流”方式下测 U_F。', fix: { label: '切到恒流', run: () => this.setMode('uf') } });
          if (!this.heat) out.push({ msg: '还没有开始加热：设定一个比上一次高约 10 °C 的温度，打开加热。', fix: { label: '帮我设到下一个温度', run: () => this.heatTo(SETS.find((s) => !ut().some((r) => Math.abs(r.T - s) < 2)) ?? 80) } });
          else if (Math.abs(this.Ts - this.Ta) > 0.08) out.push({ msg: `样品座还比炉温低 ${(this.Ta - this.Ts).toFixed(2)} °C。现在记录，t 偏高（U_F 对应的实际温度更低），S 的绝对值会偏小。` });
          const IFs = [...new Set(app.table('ut').rows.map((r) => r._IF).filter(Boolean))];
          if (IFs.length > 1) out.push({ msg: '表里的数据用了不同的正向电流，U_F–T 不再是同一条直线。清空本表，用同一电流重测。' });
          return out;
        },
        auto: async () => {
          if (this.mode !== 'uf') this.setMode('uf');
          const IF0 = app.table('ut').rows.find((r) => r._IF)?._IF ?? 100e-6;
          if (this.IF !== IF0) { this.IF = IF0; app.renderInspector(); }
          app.showTable(1);
          for (const T of SETS) { if (ut().some((r) => Math.abs(r.T - T) < 2)) continue; await this.heatTo(T); app.select(app.comp('tester')); await app.record('ut', 0); }
        },
      },
      {
        title: '数据处理',
        html: '<p>作 $\\ln I$–$U$ 图求玻尔兹曼常数 $k$；作 $U_F$–$T$ 图求温度灵敏度 $S$，外推到 0 K 得 $E_g(0)$；作 $\\ln R_T$–$1/T$ 图求 $B$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const app = this.app;
    const iu = app.table('iu').completeRows().filter((r) => r.U2 >= 0.005 && r.U2 < USAT);
    const ut = app.table('ut').completeRows();
    let html = '', ok = false;
    const answers = [], plots = [];
    if (iu.length >= 3) {
      const f = linFit(iu.map((r) => r.U1), iu.map((r) => Math.log(r.U2 / RF))), TK = mean(iu.map((r) => r.T)) + K0;
      const k = QE / (f.k * TK), uk = (k * f.uk) / f.k;
      html += `<h3>1. 玻尔兹曼常数</h3><p>室温 $T$ = ${TK.toFixed(1)} K。小电流下扩散电流占主导，$I\\approx I_s e^{eU/kT}$，故 $\\ln I=\\ln I_s+\\dfrac{e}{kT}U$。最小二乘拟合 $\\ln I$–$U$：斜率 $${f.k.toFixed(3)}\\ \\mathrm{V^{-1}}$，$r$ = ${f.r.toFixed(6)}。</p>
        <div class="result-box">$k=\\dfrac{e}{T\\cdot\\text{斜率}}=${fmtU(k * 1e23, uk * 1e23).replace('±', '\\pm')}\\times10^{-23}\\ \\mathrm{J/K}$</div>
        <div class="result-box warn">公认值 1.380649×10⁻²³ J/K，相对误差 ${pct(relErr(k, KB))}。实际 PN 结的理想因子略大于 1（本样品约 ${this.pn.n.toFixed(3)}），使测得的 k 略偏大；电流太小时复合电流占比增大，太大时体电阻压降使曲线下弯。</div>`;
      answers.push({ label: '$k$', unit: '×10⁻²³ J/K', value: k * 1e23, digits: 3, tolRel: 0.01 });
      plots.push({ title: 'ln I – U（室温）', xLabel: 'U₁ / V', yLabel: 'ln(I/A)', series: [{ type: 'scatter', data: iu.map((r) => [r.U1, Math.log(r.U2 / RF)]), label: '实验点' }, { type: 'line', data: [iu[0].U1, iu[iu.length - 1].U1].map((x) => [x, f.k * x + f.b]), label: '拟合直线' }] });
      ok = true;
    } else html += '<h3>1. 玻尔兹曼常数</h3><p>伏安特性至少要 3 组有效数据。</p>';
    if (ut.length >= 3) {
      const IF = ut.find((r) => r._IF)?._IF ?? this.IF;
      const Ts = ut.map((r) => r.T + K0), f = linFit(Ts, ut.map((r) => r.UF / 1000));
      const ref = linFit(Ts, Ts.map((T) => this.pn.voltage(IF, T)));
      html += `<h3>2. PN 结温度灵敏度与禁带宽度</h3><table><tr><th>t/°C</th><th>T/K</th><th>U_F/mV</th><th>R_T/kΩ</th></tr>${ut.map((r) => `<tr><td>${r.T.toFixed(1)}</td><td>${(r.T + K0).toFixed(1)}</td><td>${r.UF.toFixed(1)}</td><td>${r.R}</td></tr>`).join('')}</table>
        <p>恒流 $I_F$ = ${IF * 1e6} μA，拟合 $U_F=U(0)+ST$：$r$ = ${f.r.toFixed(5)}。</p>
        <div class="result-box">$S=${fmtU(f.k * 1000, f.uk * 1000).replace('±', '\\pm')}\\ \\mathrm{mV/K}$，$\\quad E_g(0)=eU(0)=${fmtU(f.b, f.ub).replace('±', '\\pm')}\\ \\mathrm{eV}$</div>
        <div class="result-box warn">按本样品的模型在同样温度点上算出的 S = ${(ref.k * 1000).toFixed(3)} mV/K（相对误差 ${pct(relErr(f.k, ref.k))}），外推 U(0) = ${ref.b.toFixed(3)} V。教材给出的硅禁带宽度 E_g(0) ≈ 1.21 eV；直线外推得到的值偏大约 0.05–0.1 eV，来自 U_F 中的非线性项 $-\\dfrac{kT}{e}\\ln T^{r}$。</div>`;
      answers.push({ label: '$S$', unit: 'mV/K', value: f.k * 1000, digits: 3, tolRel: 0.02 }, { label: '$E_g(0)$', unit: 'eV', value: f.b, digits: 3, tolRel: 0.01 });
      plots.push({ title: `U_F – T（I_F = ${IF * 1e6} μA）`, xLabel: 'T / K', yLabel: 'U_F / mV', series: [{ type: 'scatter', data: ut.map((r) => [r.T + K0, r.UF]), label: '实验点' }, { type: 'line', data: [Ts[0], Ts[Ts.length - 1]].map((x) => [x, (f.k * x + f.b) * 1000]), label: '拟合直线' }] });
      const rr = ut.filter((r) => r.R > 0);
      const g = linFit(rr.map((r) => 1 / (r.T + K0)), rr.map((r) => Math.log(r.R * 1e3)));
      const gref = linFit(rr.map((r) => 1 / (r.T + K0)), rr.map((r) => Math.log(this.ntc.R(r.T + K0))));
      const R25 = Math.exp(g.k / T25 + g.b), al = -g.k / (T25 * T25);
      html += `<h3>3. 热敏电阻的 B 值</h3><p>$R_T=R_{25}e^{B(1/T-1/T_{25})}$，取对数 $\\ln R_T=B\\cdot\\dfrac1T+\\text{常数}$。拟合 $\\ln R_T$–$1/T$：$r$ = ${g.r.toFixed(5)}。</p>
        <div class="result-box">$B=${fmtU(g.k, g.uk).replace('±', '\\pm')}\\ \\mathrm{K}$，$\\ R_{25}=${(R25 / 1e3).toFixed(3)}\\ \\mathrm{k\\Omega}$，$\\ \\alpha_{25}=-B/T_{25}^2=${(al * 100).toFixed(2)}\\ \\%/\\mathrm{K}$</div>
        <div class="result-box warn">按本样品的模型在同样温度点上拟合得 B = ${gref.k.toFixed(0)} K，相对误差 ${pct(relErr(g.k, gref.k))}。B 值随温度略有变化，所以产品手册给 B 值时要注明温度区间（如 B₂₅/₅₀ 或 B₂₅/₈₅）。</div>`;
      answers.push({ label: '$B$', unit: 'K', value: g.k, digits: 0, tolRel: 0.01 });
      plots.push({ title: 'ln R_T – 1/T', xLabel: '1/T / K⁻¹', yLabel: 'ln(R_T/Ω)', series: [{ type: 'scatter', data: rr.map((r) => [1 / (r.T + K0), Math.log(r.R * 1e3)]), label: '实验点' }, { type: 'line', data: [1 / (rr[0].T + K0), 1 / (rr[rr.length - 1].T + K0)].map((x) => [x, g.k * x + g.b]), label: '拟合直线' }] });
      ok = true;
    } else html += '<h3>2. 温度特性</h3><p>U_F–T 至少要 3 个温度点。</p>';
    html += '<p>误差来源：样品座温度滞后于温控仪示数（没等稳定就读，S、B 都偏小）；理想因子不为 1；伏安特性测量时环境温度的波动；运放的失调电压与输入偏置电流。</p>';
    return { html, ok, answers, plots };
  }

  principle() {
    return `<h3>1. PN 结的伏安特性与玻尔兹曼常数</h3>${pnFig()}<p>理想 PN 结的正向电流与电压的关系为</p>$$I=I_s\\left(e^{eU/kT}-1\\right)\\approx I_s\\,e^{eU/kT}\\quad(eU\\gg kT)$$<p>取对数 $\\ln I=\\ln I_s+\\dfrac{e}{kT}U$。室温下测出 $\\ln I$–$U$ 直线的斜率，已知 $e$ 和 $T$ 即可求出玻尔兹曼常数 $k$。电流只有纳安到微安量级，用运算放大器组成电流–电压变换器：反相输入端“虚地”，PN 结两端电压就是 $U_1$，电流全部流过反馈电阻 $R_f$，输出 $U_2=IR_f$。</p>
<h3>2. 恒流下正向压降随温度的变化</h3><p>反向饱和电流 $I_s=CT^r e^{-E_g(0)/kT}$，代入上式并保持 $I_F$ 不变，得</p>$$U_F=\\frac{E_g(0)}{e}-\\left(\\frac ke\\ln\\frac{C}{I_F}\\right)T-\\frac{kT}{e}\\ln T^{r}$$<p>最后一项随温度变化很慢，在几十摄氏度的范围内 $U_F$ 与 $T$ 近似成线性关系，斜率 $S=\\mathrm dU_F/\\mathrm dT$ 约为 −2 mV/K。把直线外推到 $T=0$，截距 $U(0)$ 近似等于 $E_g(0)/e$。这正是 PN 结温度传感器和集成温度传感器的工作原理。</p>
<h3>3. NTC 热敏电阻</h3><p>负温度系数热敏电阻是掺杂的过渡金属氧化物半导体，载流子浓度随温度按指数增加，阻值按指数减小：</p>$$R_T=R_{25}\\exp\\!\\left[B\\left(\\frac1T-\\frac1{T_{25}}\\right)\\right],\\qquad \\alpha_T=\\frac1R\\frac{\\mathrm dR}{\\mathrm dT}=-\\frac{B}{T^2}$$<p>$\\ln R_T$ 与 $1/T$ 成线性关系，斜率就是材料常数 $B$（单位 K）。热敏电阻灵敏度高（约 −4 %/K），但非线性强；PN 结线性好，但灵敏度低。</p>
<h3>4. 本仿真的计算模型</h3><p>PN 结电流包括扩散电流（理想因子 $n$ 略大于 1）和势垒区复合电流（理想因子 2）；$I_s\\propto T^3 e^{-E_g(T)/nkT}$，硅的禁带宽度按 Varshni 式 $E_g(T)=1.170-4.73\\times10^{-4}T^2/(T+636)$ eV 随温度变化。热敏电阻在指数式上加了一个很小的二次项，使 B 值随温度略有变化。加热炉与样品座按两个串联的一阶热惯性环节计算。</p>`;
  }
}
