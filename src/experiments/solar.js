// 实验：太阳能电池的基本特性
// 单晶硅电池（有效面积 10.0 cm²）按单二极管模型计算（physics/solarcell.js），参数个体随机：理想因子 1.3–1.4，
// 串联电阻约 0.1 Ω，并联电阻 5–9 kΩ。卤钨灯光谱中红外占很大比例，硅电池对它的光电流响应约 20 mA/cm²（每 1000 W/m²）。卤钨灯在导轨上移动，电池处的辐照度近似按距离平方反比变化，另有约 3 W/m² 的室内光。
// 测量电路由电路盒上的开关切换：暗特性——直流电源经 3 Ω 限流电阻和电流表加正向电压；输出特性——电池接电阻箱和电流表。
// 电压表（2 V 档，10 MΩ）始终接在电池两端；电流表内阻 0.5 Ω 串在回路里（测“短路电流”时它就是负载）。
import * as THREE from 'three';
import { meta, thumb } from './solar.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, gauss, clamp, relErr, pct, linFit } from '../core/Stats.js';
import { cellI, withLoad, withSupply, KB, QE } from '../physics/solarcell.js';

const AREA = 10.0; // cm²
const RA = 0.5, RP = 3; // 电流表内阻、电源限流电阻（Ω）
const XC = 28; // 电池的位置（cm）
const T25 = 298.15;
const FACE_TOL = 2; // 电池板正对灯的标准（°）
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class SolarCellExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.cell = { I0: rand(0.8, 1.6) * 1e-9, n: rand(1.3, 1.4), Rs: rand(0.08, 0.15), Rsh: rand(5000, 9000), T: T25, IL: 0 };
    this.P0 = rand(660, 720); this.Eamb = rand(2.5, 3.5); this.kL = rand(0.019, 0.022) * AREA / 1000; // A per W/m²
    this.mode = 'dark'; this.lamp = false;
    this.Es = 0; this.R = 100; this.load = false;
    this.tilt = Math.round((Math.random() < 0.5 ? -1 : 1) * rand(8, 20) * 10) / 10; // 电池板相对“正对灯”转过的角度（°）
    this._key = ''; this.op = { U: 0, I: 0 }; this.lastE = null; this.lastUoc = null; this.lastIsc = null;
  }
  /** 灯到电池的距离：灯座在导轨上的读数（导轨刻度零点在电池板处） */
  get d() { const c = this.app.comp && this.app.comp('lamp'); return c && c.placed ? c.pos : 30; }
  set d(v) { const c = this.app.comp('lamp'); if (c) this.app.setRailPos(c, Math.round(v * 10) / 10); }
  /** 遮光罩、照度计探头：从器材柜拿来放到电池板前面 */
  get cover() { const c = this.app.comp && this.app.comp('hood'); return !!(c && c.placed); }
  set cover(v) { this.put('hood', v); }
  get probe() { const c = this.app.comp && this.app.comp('probe'); return !!(c && c.placed); }
  set probe(v) { this.put('probe', v); }
  put(k, v) {
    const a = this.app, c = a.comp(k), o = a.comp(k === 'hood' ? 'probe' : 'hood');
    if (v && !c.placed) { if (o.placed) a.remove(o); a.place(c, { silent: true }); } else if (!v && c.placed) a.remove(c);
  }
  get facing() { return Math.abs(this.tilt) <= FACE_TOL; }
  Elamp(d = this.d) { return this.lamp ? this.P0 * (20 / d) ** 2 : 0; }
  /** 照度计读数（探头放在电池处，探头面正对灯） */
  Emeter() { return this.Elamp() + this.Eamb; }
  /** 电池接收的辐照度：电池板斜着时灯光部分按 cosθ 减小 */
  Ecell() { return this.cover || this.probe ? 0 : this.Elamp() * Math.cos((this.tilt * Math.PI) / 180) + this.Eamb; }
  solve() {
    const key = [this.mode, this.cover, this.lamp, this.d, this.probe, this.Es, this.R, this.load, this.tilt].join();
    if (key === this._key) return this.op;
    this._key = key;
    const c = { ...this.cell, IL: this.kL * this.Ecell() };
    if (this.mode === 'dark') { const r = withSupply(this.Es, RP + RA, c); this.op = { U: r.U, I: r.I }; }
    else { const r = withLoad(this.load ? this.R + RA : Infinity, c); this.op = { U: r.U, I: r.I }; }
    return this.op;
  }
  // 数字表的显示
  fmtU(U) { return U.toFixed(4); }
  fmtI(I) { const a = Math.abs(I * 1000); return (I * 1000).toFixed(a < 2 ? 4 : a < 20 ? 3 : a < 200 ? 2 : 1); }
  readI(I) { return +this.fmtI(I); }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 70, 96], target: [0, 6, -4] }, { name: '仪表', pos: [10, 36, 38], target: [10, 6, -24] }, { name: '光源与电池', pos: [6, 34, 54], target: [6, 10, 4] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 90));
    app.stage.setLightTarget(0, 6, 0);
    const dark = MAT.paint(0x2b3440), alu = MAT.alu();
    // 导轨、灯、电池
    scene.add(mesh(new THREE.BoxGeometry(100, 1.6, 6), alu, -10, 0.8, 6));
    for (let k = 0; k <= 70; k++) scene.add(mesh(new THREE.BoxGeometry(0.12, 0.05, k % 10 === 0 ? 2.4 : k % 5 === 0 ? 1.7 : 1.0), MAT.paint(0x222222), XC - k, 1.63, 8.2)); // 刻度：零点在电池板处
    app.addRail({ id: 'lamp', origin: new THREE.Vector3(XC, 0, 6), dir: new THREE.Vector3(-1, 0, 0), min: 20, max: 60, accepts: ['lamp'] });
    app.addSlot({ id: 'hood', pos: new THREE.Vector3(XC - 0.6, 0, 6), accepts: ['hood'] });
    app.addSlot({ id: 'probe', pos: new THREE.Vector3(XC - 1.0, 0, 6), accepts: ['probe'] });
    this.lampG = new THREE.Group();
    this.lampG.add(mesh(new THREE.BoxGeometry(5, 2, 5), dark, 0, 2.6, 0));
    this.lampG.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 8, 10), MAT.chrome(), 0, 7, 0));
    const hood = mesh(new THREE.CylinderGeometry(4.2, 2.4, 6, 24, 1, true), MAT.paint(0x3a3f44), 3, 12, 0); hood.rotation.z = Math.PI / 2; this.lampG.add(hood);
    this.bulb = mesh(new THREE.SphereGeometry(1.6, 16, 12), MAT.emissive(0xfff1c4, 0), 2.4, 12, 0); this.lampG.add(this.bulb);
    const ch = new THREE.Group(); ch.position.set(XC, 0, 6);
    ch.add(mesh(new THREE.BoxGeometry(5, 2, 5), dark, 0, 2.6, 0));
    ch.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 8, 10), MAT.chrome(), 0, 7, 0));
    this.head = new THREE.Group(); ch.add(this.head); // 电池板可绕立杆转动
    this.head.add(mesh(new THREE.BoxGeometry(0.8, 9, 9), MAT.paint(0x22262a), 0.6, 12, 0));
    const pv = mesh(new THREE.BoxGeometry(0.2, 6.3, 6.3), MAT.paint(0x1d3557), 0.1, 12, 0); this.head.add(pv);
    for (let k = -2; k <= 2; k++) this.head.add(mesh(new THREE.BoxGeometry(0.22, 6.3, 0.08), MAT.metal(), 0.05, 12, k * 1.3));
    app.addComponent(new Component({
      key: 'lamp', name: '卤钨灯（光源）', zone: 'rail', rail: 'lamp', fixed: true, defaultPos: 30, object: this.lampG, labelY: 18,
      desc: '100 W 卤钨灯，灯座在导轨上，直接拖动改变灯到电池的距离。导轨刻度的零点在电池板处，灯座刻线的读数就是距离。',
      controls: () => [
        { type: 'toggle', label: '灯', get: () => this.lamp, set: (v) => { this.lamp = v; app.changed(); } },
      ],
    }));
    app.addComponent(new Component({
      key: 'cell', name: '太阳能电池', zone: 'none', fixed: true, required: true, object: ch, labelY: 20,
      icon: SVG('<rect x="18" y="6" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M18 15 H46 M18 24 H46 M27 6 V34 M37 6 V34" stroke="currentColor" stroke-width=".8"/>'),
      desc: `单晶硅太阳能电池，有效面积 ${AREA.toFixed(1)} cm²，装在可以绕立杆转动的支架上。电池板要正对灯：斜着时照到板上的光按 cosθ 减少，短路电流和效率都偏低。测暗特性时从器材柜拿遮光罩罩上；测辐照度时把照度计探头放到电池板前（会挡住电池）。`,
      controls: () => [
        { type: 'knob', label: '电池板转角', get: () => this.tilt, set: (v) => { this.tilt = Math.round(clamp(v, -40, 40) * 10) / 10; }, step: 0.2, bigStep: 2, perRev: 10, fmt: () => '绕立杆转动' },
        { type: 'readout', label: '从上往下看', get: () => { const t = Math.round(this.tilt / 5) * 5; return t === 0 ? '电池板大致正对灯（细调可让短路电流最大）' : `电池板${t > 0 ? '向后' : '向前'}偏转约 ${Math.abs(t)}°`; } },
      ],
    }));
    const hoodG = new THREE.Group(); hoodG.add(mesh(new THREE.BoxGeometry(1.4, 10, 10), MAT.black(), 0, 12, 0)); hoodG.add(mesh(new THREE.BoxGeometry(3, 0.6, 3), MAT.black(), 0.6, 7.2, 0));
    app.addComponent(new Component({
      key: 'hood', name: '遮光罩', zone: 'slot', defaultSlot: 'hood', object: hoodG, labelY: 19,
      icon: SVG('<rect x="20" y="6" width="24" height="28" fill="currentColor"/>'),
      desc: '测暗特性时罩在电池板前，挡住所有光。',
    }));
    const probeG = new THREE.Group(); { const p = mesh(new THREE.CylinderGeometry(2, 2, 0.8, 20), MAT.paint(0xdedede), 0, 12, 0); p.rotation.z = Math.PI / 2; probeG.add(p); probeG.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 8), MAT.chrome(), 0, 8, 0)); }
    app.addComponent(new Component({
      key: 'probe', name: '照度计探头', zone: 'slot', defaultSlot: 'probe', object: probeG, labelY: 18,
      icon: SVG('<circle cx="32" cy="16" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M32 25v10" stroke="currentColor" stroke-width="2"/>'),
      desc: '光功率计的探头。放到电池板前面（探头面正对灯）读出电池所在位置的辐照度，读完要拿开，否则它挡住了电池。',
      controls: () => [{ type: 'readout', label: '照度计读数', get: () => `${this.Emeter().toFixed(1)} W/m²` }],
    }));
    // 仪表与电路盒
    const mg = new THREE.Group();
    const vm = (this.vBox = meterBox(18, 9, 11, '数字电压表')); vm.group.position.set(-26, 0, -26); mg.add(vm.group);
    const am = (this.aBox = meterBox(18, 9, 11, '数字电流表')); am.group.position.set(-4, 0, -26); mg.add(am.group);
    const ps = (this.pBox = meterBox(18, 9, 11, '直流稳压电源')); ps.group.position.set(18, 0, -26); mg.add(ps.group);
    const rb = (this.rBox = meterBox(20, 7, 12, '电阻箱')); rb.group.position.set(42, 0, -24); mg.add(rb.group);
    app.addComponent(new Component({
      key: 'meters', name: '电路盒与仪表', zone: 'none', fixed: true, object: mg, labelY: 14,
      desc: `电路盒上的开关选择测量电路。“暗特性”：直流稳压电源（0–2 V）经 ${RP} Ω 限流电阻和电流表给电池加正向电压。“输出特性”：电池接电阻箱（0–99999.9 Ω）和电流表，负载开关断开时电压表读的就是开路电压。电压表 2 V 档，分辨 0.1 mV；电流表自动换档，内阻 ${RA} Ω。`,
      controls: () => [
        { type: 'segment', label: '测量电路', options: [{ value: 'dark', label: '暗特性（外加电压）' }, { value: 'out', label: '输出特性（接负载）' }], get: () => this.mode, set: (v) => { this.mode = v; app.changed(); } },
        { type: 'knob', label: '电源输出电压', get: () => this.Es, set: (v) => { this.Es = Math.round(clamp(v, 0, 2) * 1000) / 1000; app.changed(); }, min: 0, max: 2, step: 0.001, bigStep: 0.05, perRev: 0.2, digits: 3, unit: 'V' },
        { type: 'toggle', label: '负载开关', get: () => this.load, set: (v) => { this.load = v; app.changed(); } },
        { type: 'knob', label: '电阻箱', get: () => this.R, set: (v) => { this.R = Math.round(clamp(v, 0, 99999.9) * 10) / 10; app.changed(); }, min: 0, max: 99999.9, step: 0.1, bigStep: 1, perRev: 10, digits: 1, unit: 'Ω' },
      ],
    }));
  }
  /** 记下最近一次在当前距离上的照度、开路电压、短路电流（供“光强特性”表使用） */
  track() {
    const op = this.solve(), sU = +this.fmtU(op.U), sI = this.readI(op.I);
    if (this.probe) this.lastE = { d: this.d, lamp: this.lamp, E: +this.Emeter().toFixed(1) };
    if (this.mode === 'out' && !this.cover && !this.probe && this.lamp) {
      if (!this.load) this.lastUoc = { d: this.d, U: sU };
      else if (this.R <= 0.05) this.lastIsc = { d: this.d, I: sI };
    }
  }
  update() {
    const op = this.solve();
    this.track();
    this.head.rotation.y = (this.tilt * Math.PI) / 180;
    this.bulb.material.emissiveIntensity = this.lamp ? 2.2 : 0;
    const sU = this.fmtU(op.U), sI = this.fmtI(this.mode === 'dark' ? op.I : op.I);
    if (sU !== this._sU) { this._sU = sU; this.vBox.setText(sU, 'V', '2 V 档'); }
    if (sI !== this._sI) { this._sI = sI; this.aBox.setText(sI, 'mA', '自动量程'); }
    const sp = this.mode === 'dark' ? this.Es.toFixed(3) : '----';
    if (sp !== this._sp) { this._sp = sp; this.pBox.setText(sp, this.mode === 'dark' ? 'V' : '', this.mode === 'dark' ? '输出' : '未接入'); }
    const sr = this.mode === 'out' ? (this.load ? this.R.toFixed(1) : '断开') : '----';
    if (sr !== this._sr) { this._sr = sr; this.rBox.setText(sr, this.mode === 'out' && this.load ? 'Ω' : '', this.mode === 'out' ? '负载' : '未接入'); }
  }

  // ======================= 数据表 =======================
  tables() {
    const iTol = (ref) => 0.004 * Math.abs(ref) + 0.002;
    return [
      {
        id: 'dark', title: '暗特性（遮光，外加正向电压）', maxRows: 16,
        columns: [
          { key: 'U', label: 'U/V', digits: 4, readTol: 0.0003 },
          { key: 'I', label: 'I/mA', digits: 4, readTol: iTol },
          { key: 'lnI', label: 'ln(I/mA)', digits: 3, calc: (r) => Math.log(r.I) },
        ],
        buttons: [{ label: '记录电压表、电流表读数', onClick: (t) => this.recDark(t) }],
        note: '盖上遮光罩，电路盒选“暗特性”。电源电压从 0 慢慢升高，电流从约 0.1 mA 到约 80 mA 之间取 10 个以上的点（电流小时点密一些）。',
      },
      {
        id: 'iv', title: '输出特性', maxRows: 20,
        columns: [
          { key: 'Rt', label: '负载 R/Ω', type: 'text', auto: true },
          { key: 'U', label: 'U/V', digits: 4, readTol: 0.0003 },
          { key: 'I', label: 'I/mA', digits: 3, readTol: iTol },
          { key: 'P', label: 'P=UI /mW', digits: 2, calc: (r) => r.U * r.I },
        ],
        buttons: [{ label: '记录电压表、电流表读数', onClick: (t) => this.recIV(t) }],
        note: '取下遮光罩，开灯，灯到电池 25.0 cm，电路盒选“输出特性”。先用照度计测出电池处的辐照度，再把探头拿开。负载开关断开测开路电压；接通后电阻箱从 0 起逐渐增大，在最大功率点（约几欧）附近多测几点。',
      },
      {
        id: 'light', title: '开路电压、短路电流与光强', maxRows: 8,
        columns: [
          { key: 'd', label: '距离/cm', digits: 1, auto: true },
          { key: 'E', label: 'E/(W/m²)', digits: 1, readTol: (r) => 0.01 * r + 0.2 },
          { key: 'Uoc', label: 'U_oc/V', digits: 4, readTol: 0.0003 },
          { key: 'Isc', label: 'I_sc/mA', digits: 2, readTol: iTol },
        ],
        buttons: [{ label: '记录这一距离的 E、U_oc、I_sc', onClick: (t) => this.recLight(t) }],
        note: '每个距离上：照度计测 E（读完把探头拿开）；负载开关断开读开路电压；接通负载、电阻箱调到 0 读短路电流。',
      },
    ];
  }
  canPlace(c) {
    if (c.key === 'hood' && this.probe) return '照度计探头还在电池板前，先把它拿开';
    if (c.key === 'probe' && this.cover) return '遮光罩还罩着，先把它取下';
    return null;
  }
  recDark(t) {
    const a = this.app, op = this.solve();
    if (this.mode !== 'dark') a.toast('电路盒没有切到“暗特性”', 'warn');
    const fl = [];
    if (!this.cover) fl.push('没有盖遮光罩：电池同时产生反向的光电流，测到的电流比暗电流小');
    if (op.I < 1e-5) a.toast('电流太小（不到 0.01 mA，或者光电流把它抵消成了负值），升高电源电压', 'warn');
    if (t.rows.some((r) => Math.abs(r.U - op.U) < 0.004)) a.toast('和已有的点太接近了，换一个电压', 'warn');
    t.flagAll(t.addRow({ U: +this.fmtU(op.U), I: this.readI(op.I) }), fl);
  }
  recIV(t) {
    const a = this.app, op = this.solve();
    if (this.mode !== 'out') a.toast('电路盒没有切到“输出特性”', 'warn');
    const fl = [];
    if (this.cover || this.probe) fl.push('电池被遮光罩或照度计探头挡着');
    else if (!this.lamp) fl.push('灯没开');
    if (t.rows.length && Math.abs(t.rows[0]._d - this.d) > 0.05) fl.push('灯的距离和第一行不同，光照变了');
    const Rt = this.load ? this.R.toFixed(1) : '断开';
    if (t.rows.some((r) => r.Rt === Rt)) a.toast('这个负载已经测过了', 'warn');
    const E = this.lastE && this.lastE.d === this.d && this.lastE.lamp ? this.lastE.E : null;
    if (E == null) a.toast('还没有用照度计测这个位置的辐照度，算效率时要用到', 'warn');
    if (t.rows.length && Math.abs((t.rows[0]._tilt ?? 0) - this.tilt) > 0.05) fl.push('电池板的转角和第一行不同，光照变了');
    if (!this.facing) fl.push('电池板没有正对灯，照到板上的光比照度计测的少');
    t.flagAll(t.addRow({ Rt, U: +this.fmtU(op.U), I: this.readI(op.I), _R: this.load ? this.R : 1e12, _d: this.d, _E: E, _tilt: this.tilt }), fl);
  }
  recLight(t) {
    const a = this.app, d = this.d;
    if (!this.lamp) return a.toast('灯没开', 'warn');
    if (!this.lastE || this.lastE.d !== d || !this.lastE.lamp) return a.toast('先在这个距离上用照度计测辐照度', 'warn');
    if (!this.lastUoc || this.lastUoc.d !== d) return a.toast('还没有在这个距离上读开路电压（负载开关断开）', 'warn');
    if (!this.lastIsc || this.lastIsc.d !== d) return a.toast('还没有在这个距离上读短路电流（负载接通、电阻箱调到 0）', 'warn');
    if (t.rows.some((r) => Math.abs(r.d - d) < 0.05)) a.toast('这个距离已经测过了', 'warn');
    const fl = [];
    if (!this.facing) fl.push('电池板没有正对灯，短路电流偏小');
    t.flagAll(t.addRow({ d, E: this.lastE.E, Uoc: this.lastUoc.U, Isc: this.lastIsc.I, _tilt: this.tilt }), fl);
  }

  // ======================= 自动操作 =======================
  async adj(comp, key, to, ms = 400) { const a = this.app; a.select(a.comp(comp)); await a.tween(() => this[key], (v) => (this[key] = v), to, ms); this[key] = to; this.track(); a.changed(); await a.wait(120); }
  async flag(comp, key, v) { const a = this.app; if (a.comp(comp).placed) a.select(a.comp(comp)); this[key] = v; if (a.comp(comp).placed) a.select(a.comp(comp)); a.renderInspector(); this.track(); a.changed(); await a.wait(150); }
  async faceLamp() { if (!this.facing || Math.abs(this.tilt) > 0.4) await this.adj('cell', 'tilt', Math.round(rand(-0.4, 0.4) * 10) / 10, 500); }
  /** 暗特性：电池端电压为 U 时电源应输出的电压 */
  EsFor(U) { const I = -cellI(U, { ...this.cell, IL: 0 }); return U + I * (RP + RA); }
  steps() {
    const app = this.app, rows = (id) => app.table(id).rows;
    const darkRows = () => rows('dark').filter((r) => r.U > 0 && r.I > 0);
    return [
      {
        title: '测暗伏安特性',
        html: '<p>盖上遮光罩，电路盒选“暗特性”。从 0 开始慢慢升高电源电压，电流在 0.1 mA 到 80 mA 之间取 10 个以上的点，记下电池两端的电压 $U$ 和电流 $I$。</p>',
        hint: '电流随电压按指数增大：电压每升高约 0.08 V，电流增大约 10 倍。所以低电压处要密，高电压处步子要小，免得电流太大。',
        status: () => `已记录 ${darkRows().length} 个点${darkRows().length ? `，电流 ${Math.min(...darkRows().map((r) => r.I)).toFixed(2)}–${Math.max(...darkRows().map((r) => r.I)).toFixed(1)} mA` : ''}`,
        check: () => { const r = darkRows(); return r.length >= 10 && Math.max(...r.map((x) => x.I)) >= 20 && Math.min(...r.map((x) => x.I)) <= 1; },
        diagnose: () => (this.mode !== 'dark' ? [{ msg: '电路盒没有切到“暗特性”。', fix: { label: '切过去', run: async () => { this.mode = 'dark'; } } }] : !this.cover ? [{ msg: '遮光罩没有盖上。', fix: { label: '盖上', run: async () => { this.cover = true; this.probe = false; } } }] : []),
        auto: async () => {
          app.showTable(0); await app.view('仪表');
          await this.flag('meters', 'mode', 'dark'); await this.flag('hood', 'cover', true);
          for (const U of [0.36, 0.40, 0.44, 0.47, 0.50, 0.52, 0.54, 0.56, 0.58, 0.60, 0.62, 0.635]) {
            if (darkRows().some((r) => Math.abs(r.U - U) < 0.006)) continue;
            await this.adj('meters', 'Es', Math.round(this.EsFor(U) * 1000) / 1000, 300);
            await app.record('dark', 0);
          }
          await this.adj('meters', 'Es', 0, 300);
        },
      },
      {
        title: '测光照下的输出特性',
        html: '<p>取下遮光罩，打开灯，把灯座拖到 25.0 cm。<b>转动电池板使它正对灯</b>（目测摆正后，可以接通负载、电阻箱调到 0，细调转角使短路电流最大）。把照度计探头放到电池板前测辐照度 $E$，记下后拿开。电路盒选“输出特性”：负载断开读开路电压；接通负载，电阻箱从 0 起逐渐增大到几百欧，记下 12 组以上的 $U$、$I$。</p>',
        hint: '最大功率点在 U ≈ 0.8 U_oc 附近，对应的负载只有几欧，这一段要测得密一些。电池板斜 10° 时光少 1.5%，斜 20° 时少 6%。',
        status: () => `已记录 ${rows('iv').length} 组${this.facing ? '' : ' · 电池板没有正对灯'}`,
        check: () => { const r = rows('iv'); return r.length >= 12 && r.some((x) => x.Rt === '断开') && r.some((x) => x._R <= 0.5) && r.some((x) => x._E > 0) && r.every((x) => Math.abs(x._tilt ?? 0) <= FACE_TOL); },
        diagnose: () => {
          const o = [];
          if (this.cover) o.push({ msg: '遮光罩还盖着。', fix: { label: '取下', run: async () => { this.cover = false; } } });
          if (!this.lamp) o.push({ msg: '灯没开。', fix: { label: '开灯', run: async () => { this.lamp = true; } } });
          if (this.mode !== 'out') o.push({ msg: '电路盒没有切到“输出特性”。', fix: { label: '切过去', run: async () => { this.mode = 'out'; } } });
          if (!this.facing) o.push({ msg: '电池板没有正对灯，照到板上的光比照度计测的少，效率会算低。', fix: { label: '帮我转正', run: () => this.faceLamp() } });
          if (rows('iv').some((x) => Math.abs(x._tilt ?? 0) > FACE_TOL)) o.push({ msg: '表里有电池板斜着时测的数据，转正后要重测。', fix: { label: '清空本表', run: async () => app.table('iv').clear() } });
          return o;
        },
        auto: async () => {
          app.showTable(1); await app.view('光源与电池');
          if (rows('iv').some((x) => Math.abs(x._tilt ?? 0) > FACE_TOL)) app.table('iv').clear();
          await this.flag('hood', 'cover', false); await this.flag('lamp', 'lamp', true);
          if (!rows('iv').length) await this.adj('lamp', 'd', 25, 500);
          await this.faceLamp();
          await this.flag('probe', 'probe', true); await app.wait(300); await this.flag('probe', 'probe', false);
          await this.flag('meters', 'mode', 'out'); await app.view('仪表');
          const Rs = [null, 0, 1, 2, 3, 4, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9, 11, 15, 30, 100];
          for (const R of Rs) {
            if (rows('iv').length >= 18) break;
            const Rt = R == null ? '断开' : R.toFixed(1);
            if (rows('iv').some((r) => r.Rt === Rt)) continue;
            if (R == null) await this.flag('meters', 'load', false);
            else { if (!this.load) await this.flag('meters', 'load', true); await this.adj('meters', 'R', R, 250); }
            await app.record('iv', 0);
          }
        },
      },
      {
        title: '开路电压、短路电流与光强',
        html: '<p>把灯座依次拖到 20、25、30、40、50、60 cm 处。每个位置测辐照度 $E$（放上照度计探头，读完拿开）、开路电压 $U_{oc}$（负载断开）和短路电流 $I_{sc}$（负载接通、电阻箱为 0）。电池板保持正对灯。</p>',
        status: () => `已测 ${rows('light').length} 个距离`,
        check: () => rows('light').length >= 5,
        diagnose: () => (!this.facing ? [{ msg: '电池板没有正对灯：短路电流偏小，I_sc–E 直线的斜率偏低。', fix: { label: '帮我转正', run: () => this.faceLamp() } }] : []),
        auto: async () => {
          app.showTable(2); await app.view('光源与电池');
          await this.flag('hood', 'cover', false); await this.flag('lamp', 'lamp', true); await this.flag('meters', 'mode', 'out');
          await this.faceLamp();
          for (const d of [20, 25, 30, 40, 50, 60]) {
            if (rows('light').some((r) => Math.abs(r.d - d) < 0.05)) continue;
            await this.adj('lamp', 'd', d, 400);
            await this.flag('probe', 'probe', true); await this.flag('probe', 'probe', false);
            await this.flag('meters', 'load', false);
            await this.flag('meters', 'load', true); await this.adj('meters', 'R', 0, 250); await app.wait(150);
            await app.record('light', 0);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>作暗特性的 $\\ln I$–$U$ 图求理想因子；作输出特性的 $I$–$U$ 和 $P$–$R$ 图，求最大功率、最佳负载、填充因子和效率；作 $I_{sc}$–$E$ 和 $U_{oc}$–$\\ln E$ 图。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, VT = (KB * T25) / QE;
    const D = a.table('dark').rows.filter((r) => r.U > 0 && r.I > 0), V = a.table('iv').rows.filter((r) => r.U >= 0 && r.I >= 0 && r.Rt), L = a.table('light').rows.filter((r) => r.E > 0 && r.Uoc > 0 && r.Isc > 0);
    if (D.length < 3 && V.length < 3 && L.length < 2) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = ''; const answers = [], plots = [];
    if (D.length >= 3) {
      const F = D.filter((r) => r.I >= 1 && r.I <= 20), use = F.length >= 3 ? F : D;
      const fit = linFit(use.map((r) => r.U), use.map((r) => Math.log(r.I / 1000))), n = 1 / (fit.k * VT), I0 = Math.exp(fit.b);
      html += `<h3>1. 暗特性</h3><p>无光照时电池就是一个面积很大的 PN 结二极管：$I=I_0\\left[e^{qU/nkT}-1\\right]$。$U\\gg nkT/q$ 时 $\\ln I=\\ln I_0+\\dfrac{q}{nkT}U$。取 1–20 mA 之间的 ${use.length} 个点拟合 $\\ln I$–$U$：斜率 ${fit.k.toFixed(2)} V⁻¹（r = ${fit.r.toFixed(5)}）。</p>
        <div class="result-box">理想因子 $n=\\dfrac{q}{kT\\cdot k}=${n.toFixed(3)}$（T = 298 K），反向饱和电流 $I_0=${(I0 * 1e9).toFixed(2)}$ nA</div>
        <p>$n$ 介于 1（理想扩散电流）和 2（势垒区复合电流）之间。电流小时，并联电阻（漏电）的电流 $U/R_{sh}$ 不可忽略，$\\ln I$–$U$ 向上弯；电流大时串联电阻上的压降 $IR_s$ 使曲线向下弯。所以只用中间一段拟合。</p>`;
      answers.push({ label: '二极管理想因子 $n$', unit: '', value: n, digits: 3, tolRel: 0.01 });
      const ux = [Math.min(...use.map((r) => r.U)), Math.max(...use.map((r) => r.U))];
      plots.push({ title: '暗特性 ln I – U', xLabel: 'U / V', yLabel: 'ln(I/A)', series: [{ type: 'scatter', data: D.map((r) => [r.U, Math.log(r.I / 1000)]), label: '实验点' }, { type: 'line', data: ux.map((u) => [u, fit.k * u + fit.b]), label: '拟合段' }] });
    }
    if (V.length >= 3) {
      const open = V.find((r) => r.Rt === '断开'), short = V.filter((r) => r._R < 1e11).sort((x, y) => x._R - y._R)[0];
      const P = V.map((r) => ({ ...r, P: r.U * r.I })), pm = P.reduce((x, y) => (y.P > x.P ? y : x));
      const E = V.find((r) => r._E > 0)?._E;
      html += `<h3>2. 输出特性（灯距 ${V[0]._d.toFixed(1)} cm${E ? `，E = ${E.toFixed(1)} W/m²` : ''}）</h3><table><tr><th>R/Ω</th><th>U/V</th><th>I/mA</th><th>P/mW</th></tr>${P.map((r) => `<tr${r === pm ? ' style="font-weight:600"' : ''}><td>${r.Rt}</td><td>${r.U.toFixed(4)}</td><td>${r.I.toFixed(2)}</td><td>${r.P.toFixed(2)}</td></tr>`).join('')}</table>`;
      if (open && short) {
        const Uoc = open.U, Isc = short.I, FF = pm.P / (Uoc * Isc);
        html += `<p>开路电压 $U_{oc}$ = ${Uoc.toFixed(4)} V，短路电流 $I_{sc}$ = ${Isc.toFixed(2)} mA（负载 ${short.Rt} Ω 加电流表内阻 0.5 Ω，端电压 ${short.U.toFixed(4)} V，与真正的短路电流相差不到 0.1%）。最大输出功率 $P_m$ = ${pm.P.toFixed(2)} mW，在 $R$ = ${pm.Rt} Ω（加上电流表内阻约 ${(+pm.Rt + RA).toFixed(1)} Ω）。</p>
          <div class="result-box">填充因子 $FF=\\dfrac{P_m}{U_{oc}I_{sc}}=${FF.toFixed(3)}$${E ? `，转换效率 $\\eta=\\dfrac{P_m}{EA}=\\dfrac{${(pm.P / 1000).toFixed(4)}}{${E.toFixed(1)}\\times${(AREA / 1e4).toFixed(4)}}=${((100 * pm.P) / 1000 / (E * AREA * 1e-4)).toFixed(2)}\\%$` : ''}</div>
          <p>最大功率点由测量点中功率最大的一点给出；在它两侧多测几点、作 $P$–$R$ 曲线可以把峰值定得更准。填充因子越接近 1，$I$–$U$ 曲线越“方”；串联电阻越大、并联电阻越小，FF 越低。卤钨灯的光谱偏红外，硅电池对它的效率比对太阳光低一些。</p>`;
        answers.push({ label: '填充因子 $FF$', unit: '', value: FF, digits: 3, tolRel: 0.01 });
        if (E) answers.push({ label: '转换效率 $\\eta$', unit: '%', value: (100 * pm.P) / 1000 / (E * AREA * 1e-4), digits: 2, tolRel: 0.02 });
      } else html += '<p>缺少开路（负载断开）或短路（R = 0）的数据，求不出填充因子。</p>';
      plots.push({ title: '输出特性 I – U', xLabel: 'U / V', yLabel: 'I / mA', series: [{ type: 'scatter', data: P.map((r) => [r.U, r.I]), label: 'I–U' }] });
      const Pr = P.filter((r) => r._R < 1e11 && r._R > 0);
      if (Pr.length >= 3) plots.push({ title: '输出功率 P – R', xLabel: 'R / Ω', yLabel: 'P / mW', series: [{ type: 'scatter', data: Pr.map((r) => [r._R, r.P]), label: 'P–R' }, { type: 'line', data: Pr.slice().sort((x, y) => x._R - y._R).map((r) => [r._R, r.P]), label: '' }] });
    }
    if (L.length >= 2) {
      const fi = linFit(L.map((r) => r.E), L.map((r) => r.Isc)), fu = linFit(L.map((r) => Math.log(r.E)), L.map((r) => r.Uoc)), nL = fu.k / VT;
      html += `<h3>3. 短路电流、开路电压与光强</h3><table><tr><th>d/cm</th><th>E/(W/m²)</th><th>U_oc/V</th><th>I_sc/mA</th></tr>${L.map((r) => `<tr><td>${r.d.toFixed(1)}</td><td>${r.E.toFixed(1)}</td><td>${r.Uoc.toFixed(4)}</td><td>${r.Isc.toFixed(2)}</td></tr>`).join('')}</table>
        <p>$I_{sc}$–$E$ 直线：斜率 ${(fi.k).toFixed(4)} mA/(W·m⁻²)，截距 ${fi.b.toFixed(2)} mA（r = ${fi.r.toFixed(5)}）——短路电流就是光生电流，与光强成正比。</p>
        <p>开路时 $I_L=I_0(e^{qU_{oc}/nkT}-1)$，$U_{oc}=\\dfrac{nkT}{q}\\ln\\dfrac{I_L}{I_0}$：与光强的对数成线性关系。$U_{oc}$–$\\ln E$ 斜率 ${(fu.k * 1000).toFixed(2)} mV，对应 $n$ = ${nL.toFixed(3)}，与暗特性的结果比较。</p>
        <div class="result-box">光电流响应度 ${(fi.k * 1000 / AREA).toFixed(4)} mA/(W·m⁻²) 每平方厘米</div>`;
      answers.push({ label: '$I_{sc}$–$E$ 直线斜率', unit: 'mA/(W·m⁻²)', value: fi.k, digits: 4, tolRel: 0.02 });
      plots.push({ title: 'I_sc – E', xLabel: 'E / (W/m²)', yLabel: 'I_sc / mA', series: [{ type: 'scatter', data: L.map((r) => [r.E, r.Isc]), label: '实验点' }, { type: 'line', data: [0, Math.max(...L.map((r) => r.E))].map((e) => [e, fi.k * e + fi.b]), label: '拟合' }] });
      plots.push({ title: 'U_oc – ln E', xLabel: 'ln(E / W·m⁻²)', yLabel: 'U_oc / V', series: [{ type: 'scatter', data: L.map((r) => [Math.log(r.E), r.Uoc]), label: '实验点' }, { type: 'line', data: [Math.min(...L.map((r) => Math.log(r.E))), Math.max(...L.map((r) => Math.log(r.E)))].map((x) => [x, fu.k * x + fu.b]), label: '拟合' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    const fig = `<svg viewBox="0 0 440 150" style="max-width:440px;width:100%" font-family="IBM Plex Sans, sans-serif" font-size="12" fill="none" stroke="#1d2832" stroke-width="1.4">
      <circle cx="60" cy="75" r="20"/><path d="M60 62v26M54 82l6 6 6-6" /><text x="34" y="122" fill="#1d2832" stroke="none">光电流 I_L</text>
      <path d="M60 55V25h80v20M60 95v30h80v-20"/><path d="M128 45h24l-12 18z M128 63h24"/><text x="112" y="140" fill="#1d2832" stroke="none">二极管</text>
      <path d="M140 25h70v20M140 125h70v-20"/><rect x="202" y="45" width="16" height="60"/><text x="186" y="140" fill="#1d2832" stroke="none">R_sh</text>
      <path d="M210 25h40"/><rect x="250" y="17" width="44" height="16"/><text x="258" y="12" fill="#1d2832" stroke="none">R_s</text>
      <path d="M294 25h70M210 125h154"/><circle cx="364" cy="25" r="3" fill="#1d2832"/><circle cx="364" cy="125" r="3" fill="#1d2832"/><text x="372" y="80" fill="#1d2832" stroke="none">U（端电压）</text>
      <path d="M330 18l14 7-14 7" /><text x="318" y="48" fill="#1d2832" stroke="none">I</text></svg>`;
    return `<h3>1. 工作原理</h3><p>太阳能电池是一个大面积的 PN 结。光子能量大于禁带宽度时在结附近产生电子–空穴对，内建电场把它们分开，形成与正向电流方向相反的光生电流 $I_L$。等效电路为一个电流源、一个二极管、并联电阻 $R_{sh}$（漏电）和串联电阻 $R_s$（体电阻与电极接触电阻）：</p>${fig}$$I=I_L-I_0\\left[e^{\\frac{q(U+IR_s)}{nkT}}-1\\right]-\\frac{U+IR_s}{R_{sh}}$$
<h3>2. 暗特性</h3><p>无光照时 $I_L=0$，电池就是二极管。加正向电压，在电流不太小也不太大的一段，$\\ln I$ 与 $U$ 成直线，斜率为 $q/nkT$，由此求理想因子 $n$。</p>
<h3>3. 输出特性</h3><p>有光照时接负载电阻 $R$，工作点在 $I$–$U$ 曲线与直线 $U=IR$ 的交点。$R=0$ 时得到短路电流 $I_{sc}\\approx I_L$，$R\\to\\infty$ 时得到开路电压 $U_{oc}$。输出功率 $P=UI$ 在某一负载下最大，$P_m=U_mI_m$。</p>$$FF=\\frac{U_mI_m}{U_{oc}I_{sc}},\\qquad \\eta=\\frac{P_m}{EA}$$<p>$E$ 为电池表面的辐照度，$A$ 为有效面积。</p>
<h3>4. 与光强的关系</h3><p>$I_{sc}=I_L\\propto E$；$U_{oc}=\\dfrac{nkT}{q}\\ln\\left(\\dfrac{I_L}{I_0}+1\\right)$，与 $\\ln E$ 成线性关系。</p>
<h3>5. 本仿真的计算模型</h3><p>按上面的单二极管方程用二分法求工作点；电流表内阻、电源限流电阻都在回路中。电池参数（$n$、$I_0$、$R_s$、$R_{sh}$、光电流响应度）个体随机；灯的辐照度近似按距离平方反比变化，另有约 3 W/m² 的室内光。电池板开始时随机偏转 8°–20°，灯光部分按入射角的余弦减少（室内散射光不变），照度计探头则总是正对灯。</p>`;
  }
}
