// 实验：双臂电桥测低电阻（金属棒的电阻率）
// 整个电路由 core/circuit.js 的节点电压法求解：每根导线（含接触）约 0.01 Ω，比待测的 10⁻⁴ Ω 量级电阻大得多，
// 所以必须用四端接法——电流端 C 通大电流，电位端 P 只接到高阻的桥臂上，导线和接触电阻落在桥臂或电流回路里，不影响平衡。
// 待测棒和标准电阻的电位端各有几微伏的温差电动势（铜与棒、刀口之间），电流换向后它的影响反号，正反向各测一次取平均即可消除。
import * as THREE from 'three';
import { meta, thumb } from './kelvin.meta.js';
import { Circuit, benchTable, analogMeter, dcSupply, rheostat, knifeSwitch, panelMesh, drawDialFace } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss, linFit } from '../core/Stats.js';
import { kelvinFig } from './circuitFigs.js';

const G_PER_DIV = 2e-9, G_DIVS = 60; // 灵敏检流计：每格约 2 nA，±30 格
const RN = 0.001; // 标准电阻标称值（Ω）
const ROD = 50; // 两电流夹之间的棒长（cm）
const LS = [15, 20, 25, 30, 35]; // 自动测量时取的电位刀口间距（cm）
const MATS = {
  cu: { name: '紫铜棒', rho20: 1.72e-8, alpha: 0.00393, color: 0xb87333 },
  al: { name: '铝棒', rho20: 2.83e-8, alpha: 0.00403, color: 0xc9ced3 },
};
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;
const ICON4 = SVG('<rect x="6" y="16" width="52" height="8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 24v8M20 24v8M44 24v8M54 24v8" stroke="currentColor"/>');

export class KelvinExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.mat = Math.random() < 0.5 ? 'cu' : 'al';
    this.Tc = Math.round(rand(18, 26) * 10) / 10;
    const m = MATS[this.mat];
    this.rho = m.rho20 * (1 + m.alpha * (this.Tc - 20)) * (1 + gauss(0.004)); // 这根棒的真实电阻率（材料批次差异）
    this.d = rand(3.96, 4.04) / 1000; // 直径（m）
    this.taper = gauss(0.004) / 1000; // 直径沿棒的微小变化
    this.mic0 = Math.round(rand(-6, 6)) / 1000; // 螺旋测微器零点读数（mm）
    this.L = 25; this.dL = gauss(0.03); // 刀口间距设定值与刀口实际接触点的偏差（cm）
    this.Rn = RN * (1 + rand(-5, 5) * 1e-5);
    this.R1 = 100; this.r1e = [1 + gauss(5e-5), 1 + gauss(5e-5)];
    this.r2e = [1 + gauss(5e-5), 1 + gauss(5e-5)];
    this.eth = [rand(1.5, 4) * (Math.random() < 0.5 ? -1 : 1) * 1e-6, rand(0.5, 2) * (Math.random() < 0.5 ? -1 : 1) * 1e-6]; // 温差电动势（V）
    this.rev = 0; this.nDia = 0;
    this._warned = {};
  }
  /** 刀口之间的真实电阻（Ω） */
  Rx(L = this.L) { return (this.rho * ((L + this.dL) / 100)) / ((Math.PI / 4) * this.d * this.d); }

  cameras() {
    return [
      { name: '全景', pos: [0, 105, 98], target: [0, 0, 0] },
      { name: '检流计', pos: [14, 44, 14], target: [14, 2, -26] },
      { name: '待测棒', pos: [-10, 40, 60], target: [-10, 2, 24] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(180, 95));
    app.stage.setLightTarget(0, 0, 0);
    const slot = (id, x, z) => app.addSlot({ id, pos: new THREE.Vector3(x, 0, z), accepts: [id] });
    slot('supply', -64, -26); slot('rev', -66, 12); slot('ratio', -38, -6); slot('dual', -8, -8); slot('g', 18, -28); slot('gp', 48, -28); slot('kg', 22, -6); slot('rx', -12, 28); slot('rn', 44, 26); slot('mic', 66, 2);
    const cir = (this.cir = new Circuit(app));
    this.sup = cir.add(dcSupply({ defaultSlot: 'supply', vmax: 6, imax: 3 }));
    this.rv = cir.add(this.reverser());
    this.ratio = cir.add(this.ratioArms());
    this.dual = cir.add(this.dualBox());
    this.gd = cir.add(analogMeter({ key: 'g', name: '灵敏检流计', short: '检流计', kind: 'G', center: true, divs: G_DIVS, perDiv: G_PER_DIV, Rg: 50, defaultSlot: 'g', desc: '零点在中央，左右各 30 格，每格约 2 nA，内阻约 50 Ω。远离平衡时很容易过载，要先串联保护电阻、跃接试探。' }));
    this.gp = cir.add(rheostat({ key: 'gp', name: '保护电阻（0–100 kΩ 电位器）', R: 100000, Imax: 0.01, defaultSlot: 'gp' }));
    this.gp.s = 1;
    cir.add(knifeSwitch({ key: 'kg', name: '检流计按键', defaultSlot: 'kg' }));
    this.rxd = cir.add(this.rodBoard());
    this.rnd = cir.add(this.stdResistor());
    // 螺旋测微器（不接入电路）
    const mg = new THREE.Group();
    mg.add(mesh(new THREE.TorusGeometry(2.4, 0.45, 8, 24, Math.PI), MAT.paint(0x2c3e50), 0, 2.6, 0));
    mg.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 4, 12), MAT.chrome(), 2.4, 2.6, 0).rotateZ(Math.PI / 2));
    mg.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 4.2, 20), MAT.alu(), 5.5, 2.6, 0).rotateZ(Math.PI / 2));
    app.addComponent(new Component({
      key: 'mic', name: '螺旋测微器', zone: 'slot', defaultSlot: 'mic', object: mg, labelY: 6, icon: SVG('<path d="M10 28a14 14 0 0 1 28 0" fill="none" stroke="currentColor" stroke-width="2"/><path d="M38 28h18" stroke="currentColor" stroke-width="3"/>'),
      desc: `量程 0–25 mm，分度值 0.01 mm，估读到 0.001 mm。测砧与测微螺杆并拢时的零点读数为 ${this.mic0 >= 0 ? '+' : '−'}${Math.abs(this.mic0).toFixed(3)} mm，测得值要减去它。`,
      controls: () => [{ type: 'button', label: '在棒的另一个位置测一次直径', onClick: () => this.recDia(this.app.table('dia')) }, { type: 'readout', label: '零点读数', get: () => `${this.mic0 >= 0 ? '+' : '−'}${Math.abs(this.mic0).toFixed(3)} mm` }],
    }));
    this.view = app.addView({ id: 'g', title: '检流计', w: 260, h: 150, res: 1 });
  }

  // ---------------- 自制仪器 ----------------
  /** 待测金属棒：两端电流夹 C₁C₂，中间两个可移动的刀口 P₁P₂ */
  rodBoard() {
    const me = this, W = 58, m = MATS[this.mat];
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(W, 1.2, 9), MAT.paint(0x3b2a1e), 0, 0.6, 0));
    const ruler = panelMesh(ROD, 1.4, (c, w, h) => {
      c.fillStyle = '#efe9d8'; c.fillRect(0, 0, w, h); c.strokeStyle = '#222'; c.fillStyle = '#222'; c.font = `${h * 0.42}px Arial`; c.textAlign = 'center';
      for (let mm = 0; mm <= ROD * 10; mm++) { const x = (mm / (ROD * 10)) * w, l = mm % 10 === 0 ? 0.55 : mm % 5 === 0 ? 0.38 : 0.24; c.lineWidth = 1; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h * l); c.stroke(); if (mm % 50 === 0) c.fillText(String(mm / 10 - ROD / 2), x, h * 0.92); }
    }, 40);
    ruler.rotation.x = -Math.PI / 2; ruler.position.set(0, 1.22, -2.6); g.add(ruler);
    const rod = mesh(new THREE.CylinderGeometry(0.25, 0.25, ROD + 3, 20), new THREE.MeshStandardMaterial({ color: m.color, metalness: 0.85, roughness: 0.3 }), 0, 3.3, 0); rod.rotation.z = Math.PI / 2; g.add(rod);
    for (const x of [-ROD / 2 - 0.6, ROD / 2 + 0.6]) { g.add(mesh(new THREE.BoxGeometry(1.6, 3.4, 2.6), MAT.brass(), x, 2.9, 0)); g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 12), MAT.black(), x, 5.1, 0)); }
    const knives = [0, 1].map(() => { const k = new THREE.Group(); k.add(mesh(new THREE.BoxGeometry(0.9, 2.6, 2.4), MAT.brass(), 0, 2.2, 0)); const w = mesh(new THREE.BoxGeometry(0.12, 0.6, 2.4), MAT.chrome(), 0, 3.3, 0); k.add(w); k.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 10), MAT.black(), 0, 4.0, 0)); g.add(k); return k; });
    const dev = {
      key: 'rx', short: '待测棒',
      terms: { C1: { pos: new THREE.Vector3(-W / 2 + 1.4, 1.2, 3.3), label: 'C₁', color: 0x1b1b1b }, P1: { pos: new THREE.Vector3(-W / 2 + 4.2, 1.2, 3.3), label: 'P₁' }, P2: { pos: new THREE.Vector3(W / 2 - 4.2, 1.2, 3.3), label: 'P₂' }, C2: { pos: new THREE.Vector3(W / 2 - 1.4, 1.2, 3.3), label: 'C₂', color: 0x1b1b1b } },
      elements(t) {
        const A = (Math.PI / 4) * me.d * me.d, seg = (me.rho * ((ROD - me.L) / 2 / 100)) / A;
        return [
          { type: 'R', a: t('C1'), b: t('_n1'), R: seg + 0.004 }, // 电流夹接触 + 夹到刀口间的一段棒
          { type: 'V', a: t('_m1'), b: t('_n1'), E: me.eth[0], r: 0.003 }, // 刀口与棒之间的温差电动势和接触电阻
          { type: 'R', a: t('_m1'), b: t('P1'), R: 0.02 },
          { type: 'R', a: t('_n1'), b: t('_n2'), R: me.Rx() },
          { type: 'R', a: t('_n2'), b: t('P2'), R: 0.023 },
          { type: 'R', a: t('_n2'), b: t('C2'), R: seg + 0.004 },
        ];
      },
      after() { knives[0].position.x = -me.L / 2; knives[1].position.x = me.L / 2; },
    };
    dev.comp = new Component({
      key: 'rx', name: `待测${m.name}（四端接法）`, zone: 'slot', defaultSlot: 'rx', object: g, labelY: 8, icon: ICON4,
      desc: `${m.name}夹在两个电流夹 C₁、C₂ 之间（相距 ${ROD} cm），工作电流从这里进出；中间两个刀口 P₁、P₂ 是电位端，可以沿棒移动，刀口间距 L 由下面的米尺读出。室温 ${this.Tc.toFixed(1)} °C。`,
      controls: () => [
        { type: 'knob', label: '刀口间距 L（两刀口对称移动）', get: () => me.L, set: (v) => { me.L = clamp(Math.round(v * 10) / 10, 8, 44); }, min: 8, max: 44, step: 0.1, bigStep: 1, perRev: 5, digits: 1, unit: 'cm' },
      ],
    });
    return dev;
  }
  /** 标准电阻 0.001 Ω（四端） */
  stdResistor() {
    const me = this, g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(18, 1.4, 8), MAT.paint(0x2a2a2a), 0, 0.7, 0));
    g.add(mesh(new THREE.BoxGeometry(12, 1.6, 2.2), MAT.brass(), 0, 2.2, -1));
    for (const x of [-6, 6]) g.add(mesh(new THREE.BoxGeometry(1.2, 2.2, 2.6), MAT.brass(), x, 1.9, -1));
    const lab = panelMesh(9, 2.2, (c, w, h) => { c.fillStyle = '#2a2a2a'; c.fillRect(0, 0, w, h); c.fillStyle = '#f0e6c8'; c.font = `bold ${h * 0.4}px Arial`; c.textAlign = 'center'; c.fillText('0.001 Ω  0.01 级', w / 2, h * 0.62); });
    lab.rotation.x = -Math.PI / 2; lab.position.set(0, 1.42, 2.2); g.add(lab);
    const dev = {
      key: 'rn', short: '标准电阻',
      terms: { C1: { pos: new THREE.Vector3(-7.6, 1.4, 3), label: 'C₁', color: 0x1b1b1b }, P1: { pos: new THREE.Vector3(-4.6, 1.4, 3), label: 'P₁' }, P2: { pos: new THREE.Vector3(4.6, 1.4, 3), label: 'P₂' }, C2: { pos: new THREE.Vector3(7.6, 1.4, 3), label: 'C₂', color: 0x1b1b1b } },
      elements(t) {
        return [
          { type: 'R', a: t('C1'), b: t('_n1'), R: 0.0006 },
          { type: 'V', a: t('P1'), b: t('_m1'), E: me.eth[1], r: 0.002 },
          { type: 'R', a: t('_m1'), b: t('_n1'), R: 0.003 },
          { type: 'R', a: t('_n1'), b: t('_n2'), R: me.Rn },
          { type: 'R', a: t('_n2'), b: t('P2'), R: 0.005 },
          { type: 'R', a: t('_n2'), b: t('C2'), R: 0.0006 },
        ];
      },
    };
    dev.comp = new Component({ key: 'rn', name: '标准电阻 Rₙ（0.001 Ω）', zone: 'slot', defaultSlot: 'rn', object: g, labelY: 6, icon: ICON4, desc: '四端标准电阻，标称 0.001 Ω，0.01 级（误差不超过 ±0.01%）。粗的 C₁、C₂ 是电流端，细的 P₁、P₂ 是电位端，Rₙ 指两个电位端之间的电阻。' });
    return dev;
  }
  /** 比率臂 R₁ = R₁′（同轴切换的两只精密电阻） */
  ratioArms() {
    const me = this, g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(16, 4.5, 10), MAT.paint(0x1f2a24), 0, 2.25, 0));
    const knob = mesh(new THREE.CylinderGeometry(1.8, 1.8, 1, 24), MAT.black(), 0, 5, -1.5); g.add(knob);
    knob.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 1.6), MAT.white(), 0, 0.55, -0.9));
    const lab = panelMesh(14, 2.4, (c, w, h) => { c.fillStyle = '#1f2a24'; c.fillRect(0, 0, w, h); c.fillStyle = '#f0e6c8'; c.font = `bold ${h * 0.38}px "Microsoft YaHei", Arial`; c.textAlign = 'center'; c.fillText('R₁ = R₁′   10 · 100 · 1000 Ω', w / 2, h * 0.62); });
    lab.rotation.x = -Math.PI / 2; lab.position.set(0, 4.52, 2.6); g.add(lab);
    const dev = {
      key: 'ratio', short: '比率臂',
      terms: { A1: { pos: new THREE.Vector3(-6, 4.5, 4), label: 'R₁ 端 1' }, B1: { pos: new THREE.Vector3(-3, 4.5, 4), label: 'R₁ 端 2', color: 0x1b1b1b }, A2: { pos: new THREE.Vector3(3, 4.5, 4), label: 'R₁′ 端 1' }, B2: { pos: new THREE.Vector3(6, 4.5, 4), label: 'R₁′ 端 2', color: 0x1b1b1b } },
      elements(t) { return [{ type: 'R', a: t('A1'), b: t('B1'), R: me.R1 * me.r1e[0] }, { type: 'R', a: t('A2'), b: t('B2'), R: me.R1 * me.r1e[1] }]; },
      after() { knob.rotation.y = -Math.log10(me.R1) * 0.9; },
    };
    dev.comp = new Component({
      key: 'ratio', name: '比率臂 R₁ = R₁′', zone: 'slot', defaultSlot: 'ratio', object: g, labelY: 7, icon: ICON4,
      desc: '一个转换开关同时切换两只阻值相同的精密电阻 R₁、R₁′（10、100、1000 Ω，误差 ±0.01%）。R₁ 接待测棒远端的电位端（外臂），R₁′ 接近端的电位端（内臂）。',
      controls: () => [{ type: 'segment', label: 'R₁ = R₁′', get: () => me.R1, set: (v) => (me.R1 = v), options: [10, 100, 1000].map((v) => ({ label: `${v} Ω`, value: v })) }],
    });
    return dev;
  }
  /** 双十进电阻箱：R₂ 与 R₂′ 由同一组旋钮同步调节 */
  dualBox() {
    const me = this, g = new THREE.Group(), W = 24, D = 14, Hh = 6, mult = [1000, 100, 10, 1, 0.1];
    g.add(mesh(new THREE.BoxGeometry(W, Hh, D), MAT.paint(0x1f2a24), 0, Hh / 2, 0));
    g.add(mesh(new THREE.BoxGeometry(W + 0.4, 0.6, D + 0.4), MAT.paint(0x3a2a1a), 0, Hh + 0.3, 0));
    const dials = mult.map((mm, i) => {
      const x = -W / 2 + 3 + i * 4.5, d = new THREE.Group(); d.position.set(x, Hh + 0.95, -2);
      d.add(mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.7, 24), MAT.black())); d.add(mesh(new THREE.BoxGeometry(0.25, 0.1, 1.4), MAT.white(), 0, 0.4, -0.8));
      const lab = panelMesh(4, 1, (c, w, h) => { c.fillStyle = '#3a2a1a'; c.fillRect(0, 0, w, h); c.fillStyle = '#f0e6c8'; c.font = `bold ${h * 0.7}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('×' + mm, w / 2, h / 2); });
      lab.rotation.x = -Math.PI / 2; lab.position.set(x, Hh + 0.62, 0.6); g.add(lab); g.add(d); return d;
    });
    const dev = {
      key: 'dual', short: '双十进电阻箱', d: [0, 2, 0, 0, 0],
      terms: { a: { pos: new THREE.Vector3(-8, Hh + 0.6, D / 2 - 1.8), label: 'R₂ 端 1' }, b: { pos: new THREE.Vector3(-4.5, Hh + 0.6, D / 2 - 1.8), label: 'R₂ 端 2', color: 0x1b1b1b }, c: { pos: new THREE.Vector3(4.5, Hh + 0.6, D / 2 - 1.8), label: 'R₂′ 端 1' }, d: { pos: new THREE.Vector3(8, Hh + 0.6, D / 2 - 1.8), label: 'R₂′ 端 2', color: 0x1b1b1b } },
      nominal() { return this.d.reduce((s, v, i) => s + v * mult[i], 0); },
      set(R) { let r = Math.round(clamp(R, 0, 9999.9) * 10); for (let i = 4; i >= 0; i--) { this.d[i] = r % 10; r = Math.floor(r / 10); } },
      elements(t) { const n = this.nominal(); return [{ type: 'R', a: t('a'), b: t('b'), R: Math.max(0.005, n * me.r2e[0] + 0.005) }, { type: 'R', a: t('c'), b: t('d'), R: Math.max(0.005, n * me.r2e[1] + 0.005) }]; },
      after() { dials.forEach((m, i) => (m.rotation.y = -(this.d[i] / 10) * Math.PI * 2)); },
    };
    dev.comp = new Component({
      key: 'dual', name: '双十进电阻箱 R₂ = R₂′', zone: 'slot', defaultSlot: 'dual', object: g, labelY: 12, icon: ICON4,
      desc: '五个十进盘（×1000 … ×0.1 Ω），每个盘同时带动两组电阻 R₂ 和 R₂′，两者始终相等（误差 ±0.01%）。R₂ 接标准电阻远端的电位端，R₂′ 接近端的电位端。',
      controls: () => [
        { type: 'readout', label: '示值 R₂ = R₂′', get: () => `${dev.nominal().toFixed(1)} Ω` },
        ...mult.map((mm, i) => ({ type: 'knob', label: `×${mm}`, get: () => dev.d[i], set: (v) => (dev.d[i] = ((Math.round(v) % 10) + 10) % 10), min: 0, max: 9, step: 1, bigStep: 1, perRev: 10, digits: 0, wrap: true, unit: '' })),
      ],
    });
    return dev;
  }
  /** 双刀双掷换向开关 */
  reverser() {
    const me = this, g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(12, 1.2, 9), MAT.paint(0x8b5a2b), 0, 0.6, 0));
    for (const z of [-2, 2]) for (const x of [-4, 0, 4]) g.add(mesh(new THREE.BoxGeometry(0.8, 1.6, 1), MAT.brass(), x, 1.6, z));
    const blades = new THREE.Group(); blades.position.set(0, 2.2, 0);
    for (const z of [-2, 2]) blades.add(mesh(new THREE.BoxGeometry(4.4, 0.25, 0.6), MAT.brass(), 2.2, 0, z));
    blades.add(mesh(new THREE.BoxGeometry(0.6, 0.6, 5), MAT.black(), 4.4, 0.3, 0));
    g.add(blades);
    const dev = {
      key: 'rev', short: '换向开关',
      terms: { i1: { pos: new THREE.Vector3(-1.2, 1.2, 4), label: '中 1' }, i2: { pos: new THREE.Vector3(1.2, 1.2, 4), label: '中 2', color: 0x1b1b1b }, o1: { pos: new THREE.Vector3(5.2, 1.2, 4), label: '出 1' }, o2: { pos: new THREE.Vector3(5.2, 1.2, -4), label: '出 2', color: 0x1b1b1b } },
      elements(t) {
        if (me.rev === 0) return [];
        const [p, q] = me.rev > 0 ? ['o1', 'o2'] : ['o2', 'o1'];
        return [{ type: 'R', a: t('i1'), b: t(p), R: 0.003 }, { type: 'R', a: t('i2'), b: t(q), R: 0.003 }];
      },
      after() { blades.rotation.z = me.rev === 0 ? 1.2 : me.rev > 0 ? 0 : Math.PI; },
    };
    dev.comp = new Component({
      key: 'rev', name: '换向开关 K', zone: 'slot', defaultSlot: 'rev', object: g, labelY: 6, icon: SVG('<path d="M14 28L40 12M24 32L50 16" stroke="currentColor" stroke-width="2"/><circle cx="14" cy="28" r="2.5" fill="currentColor"/><circle cx="24" cy="32" r="2.5" fill="currentColor"/>'),
      desc: '双刀双掷开关：刀片合向一边时“出 1”接“中 1”、“出 2”接“中 2”（正向）；合向另一边时交叉连接（反向），流过待测棒的电流反向。中间位置断开。',
      controls: () => [{ type: 'segment', label: '刀片位置', get: () => me.rev, set: (v) => (me.rev = v), options: [{ label: '正向', value: 1 }, { label: '断开', value: 0 }, { label: '反向', value: -1 }] }],
    });
    return dev;
  }

  pointerDown(e) { return this.cir.pointerDown(e); }
  pointerMove(e) { return this.cir.pointerMove(e); }
  onRemove(c) { this.cir.removeDevice(c.key); }
  tick(dt) { this.cir.tick(dt); }

  update() {
    this.cir.solve();
    const v = this.view;
    drawDialFace(v.ctx, 0, 0, v.W, v.H, { kind: 'G', divs: G_DIVS, center: true, cls: '', unit: 'G', theta: this.gd.comp.placed ? this.gd.theta : 0 });
    const I = this.current();
    v.foot(this.valid() ? `工作电流 ${I.toFixed(2)} A · R₁ = ${this.R1} Ω · R₂ = ${this.dual.nominal().toFixed(1)} Ω · L = ${this.L.toFixed(1)} cm` : '电桥还没有接好');
    const over = this.gd.comp.placed && Math.abs(this.gd.target) > 0.52;
    if (over && !this._warned.g) this.app.toast('检流计过载！松开按键，把保护电阻调大', 'warn');
    this._warned.g = over;
  }
  /** 流过待测棒的电流（A，带方向） */
  current() { const s = this.cir.sol; if (!s || !this.cir.placed('rx')) return 0; const e = s.elems && s.elems.find((x) => x.dev === this.rxd && x.a === 'rx:_n1' && x.b === 'rx:_n2'); return e ? s.cur(e) : 0; }
  gDiv() { return this.gd.theta * G_DIVS; }

  // ---------------- 接线检查 ----------------
  wiring() {
    return [
      ['supply:+', 'rev:i1'], ['supply:-', 'rev:i2'], ['rev:o1', 'rx:C1'], ['rx:C2', 'rn:C1'], ['rn:C2', 'rev:o2'],
      ['rx:P1', 'ratio:A1'], ['ratio:B1', 'dual:a'], ['dual:b', 'rn:P2'],
      ['rx:P2', 'ratio:A2'], ['ratio:B2', 'dual:c'], ['dual:d', 'rn:P1'],
      ['ratio:B1', 'gp:A'], ['gp:C', 'kg:a'], ['kg:b', 'g:+'], ['g:-', 'ratio:B2'],
    ];
  }
  /** 还没有接上的连接（按“同一节点”判断，接法等价即可） */
  missing() {
    const keys = ['supply', 'rev', 'rx', 'rn', 'ratio', 'dual', 'g', 'gp', 'kg'];
    if (!keys.every((k) => this.cir.placed(k))) return null;
    const n = this.cir.nets();
    const same = (a, b) => n(a) === n(b);
    const miss = [];
    for (const [a, b] of this.wiring().slice(0, 11)) if (!same(a, b)) miss.push([a, b]);
    // 检流计支路：B1 —（保护电阻 A–C 或 B–C）—（按键）— 检流计 — B2，各元件顺序、极性不限
    const pairs = [['gp:A', 'gp:C'], ['gp:B', 'gp:C'], ['kg:a', 'kg:b'], ['g:+', 'g:-']];
    const full = (from, to) => { const ok = (path) => path.has('gp') && path.has('kg') && path.has('g'); const walk = (cur, used) => { if (used.size === 3) return same(cur, to) && ok(used); for (const [p, q] of pairs) { const k = p.split(':')[0]; if (used.has(k)) continue; for (const [x, y] of [[p, q], [q, p]]) if (same(cur, x) && walk(y, new Set([...used, k]))) return true; } return false; }; return walk(from, new Set()); };
    if (!full('ratio:B1', 'ratio:B2') && !full('ratio:B2', 'ratio:B1')) miss.push(['ratio:B1', 'g', 'ratio:B2']);
    return miss;
  }
  valid() { const m = this.missing(); return !!m && m.length === 0; }

  // ---------------- 数据表 ----------------
  tables() {
    const rx = (r) => (r.R1 * RN * 1e6 * (1 / r.R2p + 1 / r.R2m)) / 2;
    return [
      { id: 'dia', title: '金属棒直径', maxRows: 10, columns: [{ key: 'd', label: '读数 d′/mm', digits: 3, readTol: 0.0012 }, { key: 'dc', label: 'd = d′ − d₀ /mm', digits: 3, calc: (r) => r.d - this.mic0 }], buttons: [{ label: '在另一个位置测一次直径', onClick: (t) => this.recDia(t) }], note: '沿棒的不同位置、不同方向测 6 次。d₀ 为螺旋测微器的零点读数。' },
      {
        id: 'bal', title: '电桥平衡', maxRows: 10,
        columns: [{ key: 'L', label: 'L/cm', digits: 1, readTol: 0.06 }, { key: 'R1', label: 'R₁/Ω', digits: 0, readonly: true }, { key: 'R2p', label: '正向 R₂/Ω', digits: 1, readTol: 0.06 }, { key: 'R2m', label: '反向 R₂/Ω', digits: 1, readTol: 0.06 }, { key: 'Rx', label: 'Rₓ/μΩ', digits: 2, calc: rx }],
        buttons: [{ label: '记录平衡时的 R₂（按换向开关的方向填入）', onClick: (t) => this.recBal(t) }],
        note: 'Rₓ = R₁Rₙ/R₂，正、反向电流各平衡一次，取两次 Rₓ 的平均（消除温差电动势）。Rₙ = 0.001 Ω。',
      },
    ];
  }
  recDia(t) {
    if (t.rows.length >= 10) return this.app.toast('已经测够了', 'warn');
    const pos = (this.nDia++ % 6) / 5 - 0.5; // 沿棒的位置
    const d = this.d * 1000 + this.taper * 1000 * pos * 2 + gauss(0.0015) + this.mic0;
    t.addRow({ d: Math.round(d * 1000) / 1000 });
  }
  recBal(t) {
    const a = this.app;
    if (!this.valid()) return a.toast('电桥没有接好', 'warn');
    if (!this.sup.on || this.rev === 0) return a.toast('工作电流没有接通', 'warn');
    const fl = [];
    if (!this.cir.dev('kg').closed) fl.push('检流计按键没有按下，没法判断是否平衡');
    else {
      if (this.gp.s * 100000 > 500) fl.push('保护电阻没有减到零，平衡判断不够灵敏');
      if (Math.abs(this.gDiv()) > 0.6) fl.push('检流计还没有指零');
    }
    if (Math.abs(this.current()) < 1) fl.push('工作电流太小（不到 1 A），电桥不灵敏');
    const key = this.rev > 0 ? 'R2p' : 'R2m', R2 = Math.round(this.dual.nominal() * 10) / 10, L = this.L;
    let i = t.rows.findIndex((r) => Math.abs(r.L - L) < 0.01 && r.R1 === this.R1 && !isFinite(r[key]));
    if (i < 0) i = t.addRow({ L, R1: this.R1, [key]: R2 }); else t.set(i, key, R2);
    t.flagAll(i, fl);
  }

  // ---------------- 自动操作 ----------------
  /** 当前接线下平衡时的 R₂（数值求解，含温差电动势） */
  balanceR2() {
    const du = this.dual, kg = this.cir.dev('kg'), d0 = du.d.slice(), k0 = kg.closed;
    kg.closed = true;
    const gAt = (R) => { du.set(R); this.cir.solve(); return this.gd.target; };
    let lo = 1, hi = 9999.9; const s = Math.sign(gAt(lo));
    if (Math.sign(gAt(hi)) === s) { du.d = d0; kg.closed = k0; this.cir.solve(); return null; }
    for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (Math.sign(gAt(m)) === s) lo = m; else hi = m; }
    const R = Math.sqrt(lo * hi), q = (x) => Math.round(x * 10) / 10;
    const best = [q(R) - 0.1, q(R), q(R) + 0.1].reduce((a, c) => (Math.abs(gAt(c)) < Math.abs(gAt(a)) ? c : a));
    du.d = d0; kg.closed = k0; this.cir.solve();
    return { R, best };
  }
  async balance() {
    const app = this.app, du = this.dual, gp = this.gp, kg = this.cir.dev('kg');
    const b = this.balanceR2();
    if (!b) return null;
    app.select(gp.comp); await app.tween(() => gp.s, (v) => (gp.s = v), 1, 300);
    app.select(du.comp); await app.tween(() => du.nominal(), (v) => du.set(v), b.R * (1 + gauss(0.01)), 600);
    app.select(kg.comp); kg.closed = true; app.changed(); await app.wait(250);
    app.select(du.comp); await app.tween(() => du.nominal(), (v) => du.set(v), b.R * (1 + gauss(0.001)), 600);
    await this.cir.settle([this.gd], 1500);
    app.select(gp.comp); await app.tween(() => gp.s, (v) => (gp.s = v), 0, 400);
    app.select(du.comp); await app.tween(() => du.nominal(), (v) => du.set(v), b.best, 500); du.set(b.best); app.changed();
    await this.cir.settle([this.gd], 5000);
    return b.best;
  }
  async wireUp() {
    const app = this.app;
    this.rev = 0; this.cir.dev('kg').closed = false; app.changed();
    for (const k of ['supply', 'rev', 'ratio', 'dual', 'g', 'gp', 'kg', 'rx', 'rn']) await app.autoPlace(k);
    await this.cir.rewire(this.wiring());
  }
  async powerOn() {
    const app = this.app, s = this.sup;
    app.select(s.comp);
    if (!s.on) { s.Vset = 3; s.Ilim = 2.0; s.on = true; }
    if (Math.abs(s.Ilim - 2) > 0.3) { await app.tween(() => s.Ilim, (v) => (s.Ilim = v), 2.0, 400); }
    if (s.Vset < 2) s.Vset = 3;
    app.renderInspector();
    app.select(this.rv.comp); if (this.rev === 0) this.rev = 1; app.renderInspector(); app.changed(); await app.wait(300);
  }
  doneRows() { return this.app.table('bal').rows.filter((r) => isFinite(r.R2p) && isFinite(r.R2m) && isFinite(r.L)); }
  steps() {
    const app = this.app, cir = this.cir;
    return [
      {
        title: '用螺旋测微器测棒的直径',
        html: '<p>先读螺旋测微器的零点读数 $d_0$，再在棒的不同位置、互相垂直的方向测直径 6 次。</p>',
        status: () => `已测 ${app.table('dia').rows.length} / 6 次`,
        check: () => app.table('dia').rows.filter((r) => isFinite(r.d)).length >= 6,
        auto: async () => { app.showTable(0); app.select(app.comp('mic')); for (let k = app.table('dia').rows.length; k < 6; k++) { await app.record('dia', 0); await app.wait(150); } },
      },
      {
        title: '按四端接法连接双臂电桥',
        html: '<p>电流回路：电源 → 换向开关 → 待测棒 C₁…C₂ → 粗短导线 → 标准电阻 C₁…C₂ → 换向开关。桥臂：待测棒<b>远端</b>电位端 P₁ 接 R₁，标准电阻远端 P₂ 接 R₂；<b>近端</b>的两个电位端分别接 R₁′、R₂′。检流计串联保护电阻和按键，接在 R₁、R₂ 的连接点与 R₁′、R₂′ 的连接点之间。</p>',
        hint: '电流端和电位端千万不要接反：电位端接到电流端上，导线电阻（约 0.01 Ω）就串进了被测电阻，比 Rₓ 本身大几十倍。',
        check: () => this.valid(),
        diagnose: () => {
          const m = this.missing();
          if (!m) return [{ msg: '还有仪器没放到桌上。', fix: { label: '帮我摆好并接线', run: () => this.wireUp() } }];
          if (!m.length) return [];
          const nm = (id) => { const [k, t] = id.split(':'); const d = cir.dev(k); return d ? `${d.short || k} 的 ${d.terms[t]?.label ?? t}` : id; };
          const first = m.slice(0, 3).map((p) => (p.length === 3 ? '检流计支路（保护电阻、按键、检流计串联在 R₁、R₂ 连接点与 R₁′、R₂′ 连接点之间）' : `${nm(p[0])} ↔ ${nm(p[1])}`)).join('；');
          return [{ msg: `还有 ${m.length} 处没接对：${first}${m.length > 3 ? '……' : ''}`, fix: { label: '帮我改接', run: () => this.wireUp() } }];
        },
        auto: () => this.wireUp(),
      },
      {
        title: '接通约 2 A 的工作电流',
        html: '<p>保护电阻调到最大，电源限流调到约 2 A，合上换向开关（正向）。低电阻电桥要用大电流，Rₓ 两端才有足够的电压使检流计灵敏。</p>',
        status: () => `工作电流 ${Math.abs(this.current()).toFixed(2)} A`,
        check: () => this.valid() && this.sup.on && this.rev !== 0 && Math.abs(this.current()) > 1.5 && Math.abs(this.current()) < 2.6,
        diagnose: () => {
          const I = Math.abs(this.current());
          if (!this.sup.on) return [{ msg: '电源没开。', fix: { label: '打开电源', run: () => this.powerOn() } }];
          if (this.rev === 0) return [{ msg: '换向开关在中间（断开）位置。', fix: { label: '合到正向', run: async () => { this.rev = 1; } } }];
          if (I <= 1.5) return [{ msg: `电流只有 ${I.toFixed(2)} A：调大电源的限流（和电压）。`, fix: { label: '调到 2 A', run: () => this.powerOn() } }];
          if (I >= 2.6) return [{ msg: `电流 ${I.toFixed(2)} A 偏大，标准电阻和棒会发热。`, fix: { label: '调到 2 A', run: async () => { this.sup.Ilim = 2; } } }];
          return [];
        },
        auto: async () => { app.select(this.gp.comp); this.gp.s = 1; await this.powerOn(); },
      },
      {
        title: '改变 L，正反向电流下调平衡（5 组）',
        html: '<p>选好比率臂 R₁（使 R₂ 有 4 位以上有效数字），按下检流计按键，先粗后细地调 R₂ 使检流计指零，记下 R₂；把换向开关合向另一边再调一次。改变刀口间距 L，共测 5 组。</p>',
        hint: '刚开始离平衡很远，保护电阻要大、按键要“跃接”（点一下就松开）；接近平衡后再把保护电阻减到零细调。',
        status: () => `已测 ${this.doneRows().length} / 5 组`,
        check: () => new Set(this.doneRows().map((r) => r.L)).size >= 5,
        diagnose: () => {
          const out = [];
          if (!this.valid()) return [{ msg: '电桥接线不对，先回到上一步检查。', fix: { label: '帮我改接', run: () => this.wireUp() } }];
          if (!this.sup.on || this.rev === 0 || Math.abs(this.current()) < 1) out.push({ msg: '工作电流没有接通或太小。', fix: { label: '接通 2 A', run: () => this.powerOn() } });
          const b = this.balanceR2();
          if (b && (b.R < 100 || b.R > 9999)) out.push({ msg: `按现在的比率臂 R₁ = ${this.R1} Ω，平衡时 R₂ 约 ${b.R.toFixed(1)} Ω，${b.R < 100 ? '有效数字太少：把 R₁ 调大' : '超出电阻箱量程：把 R₁ 调小'}。`, fix: { label: '换成 100 Ω', run: async () => { this.R1 = 100; } } });
          if (!cir.dev('kg').closed) out.push({ msg: '检流计按键没按下，看不出是否平衡。', fix: { label: '按下按键', run: async () => { cir.dev('kg').closed = true; } } });
          else if (Math.abs(this.gDiv()) > 0.6 && b) out.push({ msg: `检流计偏 ${this.gDiv().toFixed(1)} 格，R₂ 还要往${this.dual.nominal() < b.best ? '大' : '小'}调。`, fix: { label: '帮我调平衡', run: () => this.balance() } });
          if (this.gp.s * 100000 > 500 && cir.dev('kg').closed && Math.abs(this.gDiv()) < 3) out.push({ msg: '已经接近平衡：把保护电阻减到零再细调，才能看出 0.1 Ω 的差别。', fix: { label: '保护电阻调零', run: async () => { this.gp.s = 0; } } });
          return out;
        },
        auto: async () => {
          app.showTable(1);
          if (this.R1 !== 100) { app.select(this.ratio.comp); this.R1 = 100; app.renderInspector(); }
          if (!this.sup.on || this.rev === 0 || Math.abs(this.current()) < 1) await this.powerOn();
          for (const L of LS) {
            if (this.doneRows().some((r) => Math.abs(r.L - L) < 0.01)) continue;
            app.select(this.rxd.comp); await app.tween(() => this.L, (v) => (this.L = v), L, 500); this.L = L; app.changed();
            for (const dir of [1, -1]) {
              app.select(this.rv.comp); this.cir.dev('kg').closed = false; this.rev = dir; app.renderInspector(); app.changed(); await app.wait(200);
              if ((await this.balance()) == null) break;
              await app.record('bal', 0);
            }
            this.cir.dev('kg').closed = false; app.changed();
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>作 Rₓ–L 图，由斜率 $k$ 求电阻率 $\\rho=k\\cdot\\pi d^2/4$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ---------------- 数据处理 ----------------
  analyze() {
    const ds = this.app.table('dia').rows.filter((r) => isFinite(r.d)).map((r) => r.d - this.mic0);
    const rs = this.doneRows();
    if (ds.length < 3 || rs.length < 2) return { html: '<p>请先测直径（至少 3 次）和至少两个 L 下的平衡（正反向）。</p>', ok: false };
    const dm = mean(ds), sd = ds.length > 1 ? stdev(ds) : 0;
    const Rx = rs.map((r) => (r.R1 * RN * (1 / r.R2p + 1 / r.R2m)) / 2), Ls = rs.map((r) => r.L);
    const fit = linFit(Ls.map((L) => L / 100), Rx); // Ω/m
    const A = (Math.PI / 4) * (dm / 1000) ** 2, rho = fit.k * A, m = MATS[this.mat], ref = m.rho20 * (1 + m.alpha * (this.Tc - 20));
    const asym = rs.map((r) => (r.R1 * RN * (1 / r.R2p - 1 / r.R2m)) / 2 / (r.R1 * RN * (1 / r.R2p + 1 / r.R2m) / 2));
    const html = `<h3>1. 直径</h3><p>零点读数 $d_0$ = ${this.mic0.toFixed(3)} mm，修正后 ${ds.map((d) => d.toFixed(3)).join('、')} mm，$\\bar d$ = ${dm.toFixed(4)} mm（标准差 ${sd.toFixed(4)} mm）。</p>
      <h3>2. 电阻</h3><table><tr><th>L/cm</th><th>R₁/Ω</th><th>正向 R₂/Ω</th><th>反向 R₂/Ω</th><th>Rₓ/μΩ</th><th>正反向差</th></tr>
      ${rs.map((r, i) => `<tr><td>${r.L.toFixed(1)}</td><td>${r.R1}</td><td>${r.R2p.toFixed(1)}</td><td>${r.R2m.toFixed(1)}</td><td>${(Rx[i] * 1e6).toFixed(2)}</td><td>${pct(Math.abs(asym[i]))}</td></tr>`).join('')}</table>
      <p>正、反向的 R₂ 不同，来自电位端的温差电动势（几微伏）：它不随电流反向，平均后消去。</p>
      <p>最小二乘拟合 $R_x=kL+b$：$k$ = ${(fit.k * 1e6).toFixed(3)} μΩ/m，$b$ = ${(fit.b * 1e6).toFixed(3)} μΩ，$r$ = ${fit.r.toFixed(5)}。截距接近零，说明接触电阻、跨线电阻已被双臂电桥消除。</p>
      <div class="result-box">$\\rho=k\\cdot\\dfrac{\\pi\\bar d^2}{4}=${(rho * 1e8).toFixed(3)}\\times10^{-8}\\ \\Omega\\cdot\\text{m}$（${m.name}，${this.Tc.toFixed(1)} °C）</div>
      <div class="result-box warn">手册值：${m.name} 20 °C 时 ${(m.rho20 * 1e8).toFixed(2)}×10⁻⁸ Ω·m，温度系数 ${m.alpha}/K，换算到 ${this.Tc.toFixed(1)} °C 为 ${(ref * 1e8).toFixed(3)}×10⁻⁸ Ω·m，相对差 ${pct(relErr(rho, ref))}（不同批次材料的电阻率本身相差约 0.5%）。</div>`;
    return {
      html, ok: true,
      answers: [{ label: '$\\bar d$', unit: 'mm', value: dm, digits: 4, tolRel: 0.0005 }, { label: '斜率 $k$', unit: 'μΩ/m', value: fit.k * 1e6, digits: 3, tolRel: 0.004 }, { label: '$\\rho$', unit: '×10⁻⁸ Ω·m', value: rho * 1e8, digits: 3, tolRel: 0.006 }],
      plots: [{ title: 'Rₓ – L', xLabel: 'L / cm', yLabel: 'Rₓ / μΩ', series: [{ type: 'scatter', data: Ls.map((L, i) => [L, Rx[i] * 1e6]), label: '实验点' }, { type: 'line', data: [0, Math.max(...Ls)].map((L) => [L, (fit.k * (L / 100) + fit.b) * 1e6]), label: '拟合直线' }] }],
    };
  }

  principle() {
    return `<h3>1. 为什么惠斯通电桥测不准低电阻</h3><p>用惠斯通电桥测 10⁻³ Ω 以下的电阻时，连接导线电阻（约 10⁻² Ω）和接线柱的接触电阻都串在被测臂里，比被测电阻本身还大，测量失去意义。</p>
<h3>2. 四端接法与双臂电桥</h3>${kelvinFig()}<p>待测电阻 Rₓ 和标准电阻 Rₙ 都做成四端：外侧的电流端 C 通工作电流，内侧的电位端 P 之间才是被测电阻。电流端的接触电阻在电流回路里，只影响电流大小；电位端的接触电阻、导线电阻串在几十到几千欧的桥臂里，可以忽略。Rₓ 与 Rₙ 相连处的跨线电阻 r 由增加的一对“内臂” R₁′、R₂′ 来抵消：</p>
$$R_x=\\frac{R_1}{R_2}R_n+\\frac{rR_2'}{R_1'+R_2'+r}\\left(\\frac{R_1}{R_2}-\\frac{R_1'}{R_2'}\\right)$$
<p>只要 $R_1=R_1'$、$R_2=R_2'$（同轴的比率臂和双十进电阻箱保证这一点），第二项为零：$R_x=\\dfrac{R_1}{R_2}R_n$。</p>
<h3>3. 电阻率</h3><p>$R_x=\\rho\\dfrac{L}{S}=\\dfrac{4\\rho}{\\pi d^2}L$，改变刀口间距 L 作 Rₓ–L 图，斜率 $k$ 给出 $\\rho=k\\pi d^2/4$。</p>
<h3>4. 本仿真的计算模型</h3><p>整个电路（含每根导线 0.01 Ω、各接触电阻、电位端几微伏的温差电动势）用节点电压法求解，检流计按二阶阻尼系统摆动。棒的电阻率按材料、室温和批次差异给出，直径沿棒有微小变化。</p>`;
  }
}
