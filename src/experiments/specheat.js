// 实验：冷却法测金属的比热容（加热炉 + 样品架与防风筒 + 铜–康铜热电偶 + 数字毫伏表 + 秒表 + 分析天平）
// 三个样品（铜、铁、铝）是同样尺寸的小圆柱，表面状况相近。加热炉套在样品上把它加热到 120 °C 以上，
// 移开加热炉后样品在防风筒内自然冷却（对流 + 辐射，模型见 physics/coolmetal.js）。
// 测热电势从 E(102 °C) 降到 E(98 °C) 所用的时间；以铜为标准，c₂ = c₁·(m₁/m₂)·(Δt₂/Δt₁)。
import * as THREE from 'three';
import { meta, thumb } from './specheat.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { Stopwatch } from '../core/gauges.js';
import { rand, gauss, clamp, mean, uA, fmtU, relErr, pct } from '../core/Stats.js';
import { emfT, METALS, lossPower } from '../physics/coolmetal.js';

const KEYS = ['Cu', 'Fe', 'Al'], N = 5;
const T1 = 102, T2 = 98, E1 = Math.round(emfT(T1) * 1000) / 1000, E2 = Math.round(emfT(T2) * 1000) / 1000;
const C_REF = METALS.Cu.c(100); // 手册给出的铜在 100 °C 附近的比热容
const SVG = (inner) => `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;

export class SpecHeatExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.T0 = rand(18, 25); this.Tf = this.T0; this.heat = false; this.over = false; this.timeScale = 1; this.t = 0;
    this.s = Object.fromEntries(KEYS.map((k, i) => {
      const d = 0.005 * rand(0.995, 1.005), L = 0.03 * rand(0.995, 1.005), V = (Math.PI * d * d * L) / 4 * 1e6;
      return [k, { d, L, eps: [0.1, 0.12, 0.09][i] * rand(0.85, 1.15), m: METALS[k].rho * V * rand(0.998, 1.002), T: this.T0 }];
    }));
    this.cur = 'Cu'; this.sw = new Stopwatch(); this.arm = null; this.cross = {}; this.hist = []; this.nz = 0;
  }
  get S() { return this.s[this.cur]; }
  get E() { return Math.round((emfT(this.S.T) + this.nz) * 1000) / 1000; }

  tick(dt) {
    const a = this.app, sdt = Math.min(20, dt * (a.running ? a.speed * 25 : this.timeScale));
    if (!(sdt > 0)) return;
    const h = this.arm ? 0.01 : 0.05, n = Math.max(1, Math.ceil(sdt / h)), hh = sdt / n;
    for (let i = 0; i < n; i++) {
      this.Tf += ((this.heat ? 260 : this.T0) - this.Tf) / (this.heat ? 90 : 400) * hh;
      for (const k of KEYS) {
        const s = this.s[k];
        if (k === this.cur && this.over) s.T += ((this.Tf - s.T) / 25) * hh;
        else s.T -= (lossPower(s.T, this.T0, s) / (s.m * METALS[k].c(s.T))) * hh;
      }
      const T = this.S.T;
      // 记录热电势经过 E1、E2 的时刻（只在加热炉移开、自然冷却时）
      if (!this.over) {
        if (this._pT > T1 && T <= T1) this.cross = { k: this.cur, t1: this.t };
        if (this._pT > T2 && T <= T2 && this.cross.k === this.cur && this.cross.t1 != null) this.cross.t2 = this.t;
        if (this.arm) {
          if (this.arm.st === 'w1' && this._pT > T1 && T <= T1) { this.sw.reset(); this.sw.start(); this.sw.t = Math.max(0, gauss(0.04)); this.arm.st = 'w2'; }
          else if (this.arm.st === 'w2' && this._pT > T2 && T <= T2) { this.sw.stop(gauss(0.04)); this.arm = null; }
        }
      }
      this._pT = T;
      this.sw.tick(hh); this.t += hh;
    }
    this.nz = gauss(0.0006);
    if (!this.hist.length || this.t - this.hist[this.hist.length - 1][0] > 0.5) { this.hist.push([this.t, emfT(this.S.T)]); if (this.hist.length > 400) this.hist.shift(); }
    a.changed();
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 60, 90], target: [0, 14, 0] }, { name: '样品', pos: [-18, 30, 40], target: [-18, 16, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(140, 64));
    app.stage.setLightTarget(0, 14, 0);
    const X = -18;
    const rig = new THREE.Group(); rig.position.set(X, 0, 0);
    rig.add(mesh(new THREE.BoxGeometry(22, 1.4, 16), MAT.paint(0x2b3138), 0, 0.7, 0));
    rig.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 44, 12), MAT.chrome(), -8, 22, -4));
    // 防风筒（铜杯）与样品
    const cup = new THREE.Group(); cup.position.set(0, 1.4, 0);
    cup.add(mesh(new THREE.CylinderGeometry(4.2, 4.2, 9, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }), 0, 4.5, 0));
    cup.add(mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.4, 32), MAT.paint(0x8a5a2b), 0, 0.2, 0));
    rig.add(cup);
    this.sampleMat = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.85, roughness: 0.3, emissive: 0xff4400, emissiveIntensity: 0 });
    rig.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 12, 8), MAT.paint(0x5a5a5a), 0, 10, 0));
    this.sample = mesh(new THREE.CylinderGeometry(1, 1, 5, 20), this.sampleMat, 0, 17, 0); rig.add(this.sample);
    // 加热炉：可以沿立柱上下滑动
    this.furnace = new THREE.Group();
    this.furnaceMat = new THREE.MeshStandardMaterial({ color: 0x6b2a1a, metalness: 0.3, roughness: 0.5, emissive: 0xff3300, emissiveIntensity: 0 });
    this.furnace.add(mesh(new THREE.CylinderGeometry(4.6, 4.6, 12, 32), this.furnaceMat), mesh(new THREE.BoxGeometry(8, 1.2, 1.2), MAT.chrome(), -4, 4, -2));
    rig.add(this.furnace);
    app.addComponent(new Component({
      key: 'rig', name: '加热炉与样品架', zone: 'none', fixed: true, object: rig, labelY: 46,
      icon: SVG('<rect x="22" y="4" width="20" height="16" rx="2"/><path d="M32 20v10"/><rect x="24" y="26" width="16" height="10"/>'),
      desc: '加热炉套到样品上通电加热；把炉子提起移开后，样品在防风筒中自然冷却。三个样品尺寸相同（直径 5 mm、长 30 mm），表面都经过抛光。换样品要在炉子移开时进行。',
      controls: () => [
        { type: 'segment', label: '样品', get: () => this.cur, set: (v) => this.pick(v), options: KEYS.map((k) => ({ label: METALS[k].name, value: k })) },
        { type: 'segment', label: '加热炉', get: () => (this.over ? 'on' : 'off'), set: (v) => this.setOver(v === 'on'), options: [{ label: '套在样品上', value: 'on' }, { label: '提起移开', value: 'off' }] },
        { type: 'toggle', label: '加热电源', get: () => this.heat, set: (v) => { this.heat = v; app.changed(); } },
        { type: 'readout', label: '样品温度（参考）', get: () => `约 ${Math.round(this.S.T)} °C` },
      ],
    }));
    // 冰水瓶（冷端）与数字毫伏表
    scene.add(mesh(new THREE.CylinderGeometry(3, 3, 12, 24), MAT.white(), 4, 6, -10));
    const mv = (this.mvBox = meterBox(16, 10, 10, '数字毫伏表')); mv.group.position.set(18, 0, -6);
    app.addComponent(new Component({
      key: 'mv', name: '数字毫伏表（热电偶）', zone: 'none', fixed: true, object: mv.group, labelY: 14,
      icon: SVG('<rect x="12" y="6" width="40" height="28" rx="2"/><rect x="17" y="11" width="30" height="10"/><path d="M4 30c4-6 6-6 8 0"/>'),
      desc: `铜–康铜（T 型）热电偶的热端插在样品中心的小孔里，冷端放在冰水混合物中（0 °C）。毫伏表分度值 0.001 mV。102 °C 对应 ${E1.toFixed(3)} mV，98 °C 对应 ${E2.toFixed(3)} mV。`,
      controls: () => [{ type: 'readout', label: '热电势', get: () => `${this.E.toFixed(3)} mV` }],
    }));
    const sw = (this.swBox = meterBox(10, 7, 6, '秒表')); sw.group.position.set(30, 0, 12); sw.group.rotation.y = -0.3;
    app.addComponent(new Component({
      key: 'sw', name: '秒表', zone: 'none', fixed: true, object: sw.group, labelY: 10,
      icon: SVG('<circle cx="32" cy="22" r="13"/><path d="M32 22V14M28 6h8"/>'),
      desc: '分度值 0.01 s。热电势降到 E₁ 时按“开始”，降到 E₂ 时按“停止”。',
      controls: () => [
        { type: 'button', label: this.sw.run ? '停止' : '开始', onClick: () => { if (this.sw.run) this.sw.stop(); else { this.sw.reset(); this.sw.start(); } app.renderInspector(); app.changed(); } },
        { type: 'button', label: '清零', onClick: () => { this.sw.reset(); app.renderInspector(); app.changed(); } },
        { type: 'readout', label: '时间', get: () => this.sw.shown },
      ],
    }));
    const bal = (this.balBox = meterBox(14, 6, 12, '分析天平')); bal.group.position.set(46, 0, -12);
    app.addComponent(new Component({
      key: 'bal', name: '分析天平', zone: 'none', fixed: true, object: bal.group, labelY: 9,
      icon: SVG('<rect x="8" y="22" width="48" height="12" rx="2"/><path d="M14 18h36"/>'),
      desc: '分度值 0.001 g，已置零。称哪个样品就在样品架上先选哪个（冷却后再称）。',
      controls: () => [{ type: 'readout', label: `${METALS[this.cur].name}样品`, get: () => `${this.mShow.toFixed(3)} g` }],
    }));
    this.view = app.addView({ id: 'panel', title: '毫伏表、秒表与冷却曲线', w: 340, h: 200, res: 1.5 });
  }
  get mShow() { return Math.round(this.S.m * 1000) / 1000; }
  pick(k) {
    const a = this.app;
    if (this.over) { a.toast('加热炉还套在样品上：先把炉子提起移开再换样品', 'warn'); a.renderInspector(); return; }
    this.cur = k; this.arm = null; this.cross = {}; this._pT = this.S.T; this.hist = [];
    this.sampleMat.color.set({ Cu: 0xb87333, Fe: 0x6e737a, Al: 0xc9ced6 }[k]);
    a.changed(); a.renderInspector();
  }
  setOver(v) { this.over = v; if (v) this.arm = null; this.app.changed(); this.app.renderInspector(); }

  update() {
    this.furnace.position.set(0, this.over ? 17 : 34, 0);
    this.furnaceMat.emissiveIntensity = clamp((this.Tf - 80) / 300, 0, 0.6);
    this.sampleMat.emissiveIntensity = clamp((this.S.T - 300) / 400, 0, 0.5);
    const e = this.E.toFixed(3);
    if (e !== this._e) { this._e = e; this.mvBox.setText(e, 'mV', `T 型热电偶  冷端 0 °C`); }
    const sws = this.sw.shown;
    if (sws !== this._sw) { this._sw = sws; this.swBox.setText(sws, '', this.sw.run ? '计时中' : ''); }
    const m = this.mShow.toFixed(3);
    if (m + this.cur !== this._m) { this._m = m + this.cur; this.balBox.setText(m, 'g', `${METALS[this.cur].name}样品`); }

    const v = this.view, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    const lcd = (x, y, wd, label, val, unit) => {
      g.fillStyle = '#9aa5ab'; g.font = `${H * 0.06}px "Microsoft YaHei"`; g.textAlign = 'left'; g.fillText(label, x, y);
      g.fillStyle = '#0b1410'; g.fillRect(x, y + H * 0.03, wd, H * 0.16);
      g.fillStyle = '#8fe3a5'; g.font = `600 ${H * 0.115}px "IBM Plex Mono", monospace`; g.textAlign = 'right'; g.fillText(val, x + wd - H * 0.13, y + H * 0.155);
      g.fillStyle = '#7d8a90'; g.font = `${H * 0.055}px "IBM Plex Mono", monospace`; g.textAlign = 'left'; g.fillText(unit, x + wd - H * 0.11, y + H * 0.155);
    };
    lcd(W * 0.03, H * 0.07, W * 0.4, `热电势（${METALS[this.cur].name}）`, this.E.toFixed(3), 'mV');
    lcd(W * 0.03, H * 0.35, W * 0.4, '秒表', this.sw.shown, '');
    g.fillStyle = '#9aa5ab'; g.font = `${H * 0.055}px "Microsoft YaHei"`; g.textAlign = 'left';
    g.fillText(`E₁ = ${E1.toFixed(3)} mV（102 °C）`, W * 0.03, H * 0.66); g.fillText(`E₂ = ${E2.toFixed(3)} mV（98 °C）`, W * 0.03, H * 0.75);
    // 冷却曲线：最近 3 分钟
    const x0 = W * 0.5, x1 = W * 0.97, y0 = H * 0.86, y1 = H * 0.08;
    g.strokeStyle = '#4b5963'; g.lineWidth = 1; g.strokeRect(x0, y1, x1 - x0, y0 - y1);
    const tN = this.t, span = 180, Emax = 7;
    const X = (t) => x1 - ((tN - t) / span) * (x1 - x0), Y = (E) => y0 - (clamp(E, 0, Emax) / Emax) * (y0 - y1);
    for (const [E, c] of [[E1, '#e0a050'], [E2, '#6fa8dc']]) { g.strokeStyle = c; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x0, Y(E)); g.lineTo(x1, Y(E)); g.stroke(); }
    g.setLineDash([]); g.strokeStyle = '#8fe3a5'; g.lineWidth = 1.5; g.beginPath();
    let first = true; for (const [t, E] of this.hist) { if (tN - t > span) continue; first ? g.moveTo(X(t), Y(E)) : g.lineTo(X(t), Y(E)); first = false; } g.stroke();
    g.fillStyle = '#7d8a90'; g.font = `${H * 0.05}px "IBM Plex Mono", monospace`; g.textAlign = 'left'; g.fillText('E–t，最近 3 min', x0 + 3, y1 + H * 0.06);
    v.foot(this.over ? (this.heat ? '加热中……热电势升到 5 mV 以上（约 120 °C）就可以停止加热、移开炉子' : '炉子套在样品上但没有加热') : this.S.T > T1 ? '样品在防风筒中冷却：示数降到 E₁ 时开始计时' : this.sw.run ? '计时中：降到 E₂ 时停止' : '样品温度低于 102 °C：要再测一次需重新加热');
  }
  globalControls() { return [{ type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×5', value: 5 }, { label: '×20', value: 20 }] }]; }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'mass', title: '样品质量', fixedRows: true,
        initRows: () => KEYS.map((k) => ({ k, what: `${METALS[k].name}样品 / g` })),
        columns: [{ key: 'what', label: '样品', type: 'text', readonly: true }, { key: 'm', label: '质量 m', digits: 3, readTol: 0.0006 }],
        buttons: [{ label: '记录天平示数', onClick: (t) => { const i = KEYS.indexOf(this.cur); t.set(i, 'm', this.mShow); } }],
        note: '在样品架上选中样品，天平显示它的质量。',
      },
      {
        id: 'time', title: '102 °C → 98 °C 的冷却时间', fixedRows: true,
        initRows: () => Array.from({ length: N }, (_, i) => ({ i: i + 1 })),
        columns: [{ key: 'i', label: '次数', digits: 0, readonly: true }, ...KEYS.map((k) => ({ key: k, label: `${METALS[k].name} Δt/s`, digits: 2, readTol: 0.006 }))],
        buttons: [{ label: '记录秒表读数', onClick: (t) => this.recTime(t) }],
        note: `每个样品加热到 120 °C 以上后移开炉子，热电势降到 ${E1.toFixed(3)} mV 时开始计时，降到 ${E2.toFixed(3)} mV 时停止。每个样品测 ${N} 次。`,
      },
    ];
  }
  nextRow(k) { const i = this.app.table('time').rows.findIndex((r) => !(r[k] != null && r[k] !== '' && isFinite(r[k]))); return i; }
  recTime(t) {
    const a = this.app, k = this.cur;
    if (this.sw.run) a.toast('秒表还在走：先停表再记录', 'warn');
    if (!(this.sw.value > 0)) return a.toast('秒表读数为 0：还没有计时', 'warn');
    const i = this.nextRow(k);
    if (i < 0) return a.toast(`${METALS[k].name}样品已经测满 ${N} 次`, 'warn');
    const c = this.cross;
    if (c.k === k && c.t1 != null && c.t2 != null) {
      const dt = c.t2 - c.t1;
      if (Math.abs(this.sw.value - dt) > 0.4) a.toast(`热电势从 E₁ 降到 E₂ 实际用了约 ${dt.toFixed(1)} s，秒表是 ${this.sw.value.toFixed(2)} s：起停时刻没有对准`, 'warn');
    } else a.toast('这次计时没有对应一次完整的 102 °C→98 °C 冷却过程', 'warn');
    t.set(i, k, this.sw.value);
    this.sw.reset(); this.cross = {}; a.renderInspector();
  }

  // ======================= 自动操作 =======================
  async runOnce() {
    const a = this.app; a.select(a.comp('rig'));
    if (!this.over) this.setOver(true);
    this.heat = true; a.renderInspector();
    await a.until(() => this.S.T > 125, 60000);
    this.heat = false; this.setOver(false);
    this.sw.reset(); this.arm = { st: 'w1' }; a.select(a.comp('sw'));
    await a.until(() => !this.arm && !this.sw.run && this.sw.value > 0, 60000);
    await a.record('time');
  }
  stepFor(k) {
    const app = this.app, cnt = () => app.table('time').rows.filter((r) => r[k] != null && r[k] !== '' && isFinite(r[k])).length;
    return {
      title: `测${METALS[k].name}样品的冷却时间`,
      html: `<p>样品架上选${METALS[k].name}样品，把加热炉套上并接通电源，热电势升到 5 mV 以上后断电、提起移开炉子。样品在防风筒中冷却，热电势降到 $E_1=${E1.toFixed(3)}$ mV 时按秒表开始，降到 $E_2=${E2.toFixed(3)}$ mV 时停止，记下 $\\Delta t$。重复 ${N} 次。</p>`,
      hint: '冷却只需十几秒，眼睛盯着毫伏表的末两位，提前做好按表的准备。',
      status: () => `已测 ${cnt()}/${N} 次`,
      check: () => cnt() >= N,
      diagnose: () => {
        const out = [];
        if (this.cur !== k) out.push({ msg: `现在样品架上是${METALS[this.cur].name}样品。`, fix: { label: `换成${METALS[k].name}`, run: () => { this.setOver(false); this.pick(k); } } });
        if (this.over && !this.heat && this.S.T < 110) out.push({ msg: '炉子套在样品上但没有通电。', fix: { label: '接通加热', run: () => { this.heat = true; app.renderInspector(); } } });
        if (this.over && this.S.T > 120) out.push({ msg: '温度已经够了：断电并把炉子移开，让样品冷却。', fix: { label: '断电、移开炉子', run: () => { this.heat = false; this.setOver(false); } } });
        if (!this.over && this.S.T < T1 && !this.sw.run) out.push({ msg: '样品温度已低于 102 °C，要测下一次需重新加热。', fix: { label: '套上炉子加热', run: () => { this.setOver(true); this.heat = true; app.renderInspector(); } } });
        return out;
      },
      auto: async () => {
        app.showTable(1); app.select(app.comp('rig'));
        if (this.cur !== k) { this.setOver(false); this.pick(k); }
        while (cnt() < N) await this.runOnce();
      },
    };
  }
  steps() {
    const app = this.app;
    return [
      {
        title: '称三个样品的质量',
        html: '<p>在样品架上依次选铜、铁、铝样品，用分析天平称出质量 $m$。</p>',
        check: () => app.table('mass').rows.every((r) => r.m > 0),
        auto: async () => {
          app.showTable(0);
          for (const k of KEYS) { this.setOver(false); this.pick(k); app.select(app.comp('bal')); await app.wait(300); await app.record('mass'); }
          this.pick('Cu');
        },
      },
      this.stepFor('Cu'), this.stepFor('Fe'), this.stepFor('Al'),
      {
        title: '数据处理',
        html: '<p>以铜为标准，计算铁和铝的比热容及其不确定度。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, mr = a.table('mass').rows, tr = a.table('time').rows;
    const m = Object.fromEntries(KEYS.map((k, i) => [k, +mr[i].m]));
    const ts = Object.fromEntries(KEYS.map((k) => [k, tr.map((r) => r[k]).filter((x) => x > 0).map(Number)]));
    if (!KEYS.every((k) => m[k] > 0)) return { html: '<p>请先称出三个样品的质量。</p>', ok: false };
    if (ts.Cu.length < 2) return { html: '<p>铜样品至少要测 2 次冷却时间。</p>', ok: false };
    const uB = 0.01 / Math.sqrt(3), um = 0.001 / Math.sqrt(3);
    const st = (k) => { const x = ts[k]; return { m: mean(x), u: Math.hypot(uA(x), uB) }; };
    const cu = st('Cu');
    let html = `<table><tr><th>样品</th><th>m/g</th>${Array.from({ length: N }, (_, i) => `<th>Δt${i + 1}/s</th>`).join('')}<th>平均/s</th><th>u/s</th></tr>${KEYS.map((k) => { const s = ts[k].length ? st(k) : null; return `<tr><td>${METALS[k].name}</td><td>${m[k].toFixed(3)}</td>${Array.from({ length: N }, (_, i) => `<td>${ts[k][i] != null ? ts[k][i].toFixed(2) : ''}</td>`).join('')}<td>${s ? s.m.toFixed(3) : '—'}</td><td>${s ? s.u.toFixed(3) : '—'}</td></tr>`; }).join('')}</table>
      <p>铜在 100 °C 附近的比热容取 $c_1=${C_REF.toFixed(3)}\\ \\mathrm{J/(g\\cdot K)}$。$\\Delta t$ 的不确定度含 A 类和秒表的 B 类（0.01/√3 s）。</p>`;
    const answers = [];
    let ok = false;
    for (const k of ['Fe', 'Al']) {
      if (ts[k].length < 2) { html += `<p>${METALS[k].name}样品至少测 2 次。</p>`; continue; }
      const s = st(k), c = C_REF * (m.Cu / m[k]) * (s.m / cu.m);
      const er = Math.sqrt((s.u / s.m) ** 2 + (cu.u / cu.m) ** 2 + (um / m.Cu) ** 2 + (um / m[k]) ** 2), ref = METALS[k].c(100);
      html += `<h3>${METALS[k].name}</h3><p>$c=c_1\\dfrac{m_1}{m}\\cdot\\dfrac{\\Delta t}{\\Delta t_1}=${C_REF.toFixed(3)}\\times\\dfrac{${m.Cu.toFixed(3)}}{${m[k].toFixed(3)}}\\times\\dfrac{${s.m.toFixed(3)}}{${cu.m.toFixed(3)}}$，$\\dfrac{u_c}{c}=${(er * 100).toFixed(2)}\\%$</p>
        <div class="result-box">$c_{\\text{${METALS[k].name}}}=${fmtU(c, c * er).replace('±', '\\pm')}\\ \\mathrm{J/(g\\cdot K)}$</div>
        <div class="result-box warn">手册值（100 °C）约 ${ref.toFixed(3)} J/(g·K)，相对误差 ${pct(relErr(c, ref))}。</div>`;
      answers.push({ label: `$c_{\\text{${METALS[k].name}}}$`, unit: 'J/(g·K)', value: c, digits: 3, tolRel: 0.01 });
      ok = true;
    }
    html += '<p>误差来源：按秒表的反应时间（每次约 ±0.05 s，占 Δt 的 0.5% 左右）；三个样品的表面发射率、尺寸并不完全相同，散热条件有差别；铜的比热容取的是手册值。</p>';
    return { html, ok, answers };
  }

  principle() {
    return `<h3>1. 牛顿冷却定律与比较法</h3><p>温度为 $\\theta$ 的小样品放在温度为 $\\theta_0$ 的环境中，单位时间散失的热量</p>$$\\frac{\\Delta Q}{\\Delta t}=cm\\frac{\\Delta\\theta}{\\Delta t}=\\alpha S(\\theta-\\theta_0)^n$$<p>其中 α 为散热系数，与表面状况和环境有关，$S$ 为表面积，$n$ 是与对流方式有关的常数。两个形状、大小、表面状况都相同的样品，在同一环境中从同一温度 $\\theta_1$ 冷却到同一温度 $\\theta_2$，右边完全相同，于是</p>$$c_1m_1\\frac{\\Delta\\theta}{(\\Delta t)_1}=c_2m_2\\frac{\\Delta\\theta}{(\\Delta t)_2}\\quad\\Longrightarrow\\quad c_2=c_1\\frac{m_1}{m_2}\\cdot\\frac{(\\Delta t)_2}{(\\Delta t)_1}$$<p>已知标准样品（铜）的比热容，测出两者的质量和冷却时间，就能求出待测样品的比热容。这就是比较法。</p>
<h3>2. 热电偶测温</h3><p>铜–康铜热电偶的热端插在样品中心，冷端放在冰水混合物（0 °C）中，热电势只与热端温度有关：100 °C 时约 4.28 mV，每升高 1 °C 约增加 0.047 mV。本实验只需要在热电势经过两个固定值时计时，不必换算成温度。</p>
<h3>3. 本仿真的计算模型</h3><p>热电势用 NIST ITS-90 的 T 型热电偶参考函数计算。样品散热包括自然对流 $h=1.32(\\Delta T/D)^{1/4}$ W/(m²·K) 和表面辐射 $\\varepsilon\\sigma(T^4-T_0^4)$，三个样品的抛光表面发射率在 0.09–0.12 之间、尺寸有千分之几的差别，比热容随温度线性变化，所以比较法的结果与手册值有 1% 左右的偏差。</p>`;
  }
}
