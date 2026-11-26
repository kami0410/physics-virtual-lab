// 实验：金属线膨胀系数的测定（电加热管 + 温控仪 + 千分表）
// 加热管内空气温度由温控仪按一阶系统逼近设定值（带少量过冲），金属棒温度再以更长的时间常数跟随管内温度；
// 温度计测的是管内靠近棒的位置，示数先到，棒的伸长后到。千分表读数 = 棒的伸长量（含各温度下 α 的变化）。
import * as THREE from 'three';
import { meta, thumb } from './expansion.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, relErr, pct, clamp, gauss, fmtU, linFit } from '../core/Stats.js';
import { expansionFig } from './mechFigs2.js';

// 平均线膨胀系数（20–100 °C）与随温度的变化率 dα/dT（1/K²），数据取自常用物性手册
const RODS = {
  cu: { name: '紫铜棒', a: 16.9e-6, da: 0.010e-6, color: 0xb87333 },
  al: { name: '铝棒', a: 23.4e-6, da: 0.018e-6, color: 0xc9ced3 },
  fe: { name: '钢棒（45 号钢）', a: 11.9e-6, da: 0.009e-6, color: 0x6f7780 },
};
const L0 = 500; // mm
const SETS = [30, 40, 50, 60, 70, 80];
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class ExpansionExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.T0 = rand(17, 24); this.Ta = this.T0; // 管内空气温度
    // 每根棒各自的温度（两段近似：棒体与两端）；在管外时向室温冷却
    this.rT = Object.fromEntries(Object.keys(RODS).map((k) => [k, { Tr: this.T0, Tr2: this.T0 }]));
    this.noRod = { Tr: this.T0, Tr2: this.T0 };
    this.Lmeas = L0 + rand(-0.4, 0.4); // 棒的实际长度 mm
    this.heat = false; this.set = this.T0; this.zero = rand(0.12, 0.85); // 千分表初读数（mm）
    this.zeroAdj = 0; this.timeScale = 1; this.t = 0;
    // 千分表装在支架上要自己往前推，使测杆顶住棒端并压进一段（预压）；一开始测杆和棒端之间有缝
    this.pre = -rand(0.05, 0.3);
    this.tauA = rand(55, 70); this.tauR = rand(95, 130);
  }
  /** 加热管里的棒：'cu' | 'al' | 'fe' | null（由拖放决定） */
  get mat() { const z = this.app.zones && this.app.zones.find((q) => q.id === 'tube'); return z && z.occupant ? z.occupant.key.slice(4) : null; }
  get rod() { return RODS[this.mat] || { name: '（管里没有棒）', a: 0, da: 0, color: 0x888888 }; }
  get rs() { return this.rT[this.mat] || this.noRod; }
  get Tr() { return this.rs.Tr; } set Tr(v) { this.rs.Tr = v; }
  get Tr2() { return this.rs.Tr2; } set Tr2(v) { this.rs.Tr2 = v; }
  canPlace(comp, o = {}) {
    const sl = o.slot ?? comp.defaultSlot;
    if (sl === 'tube' && this.pre > 0) return '千分表测杆伸在管口，棒插不进去：先把千分表往后退';
    return null;
  }
  onPlace() { this.app.renderInspector(); this.app.changed(); }
  onSlotChange() { this.onPlace(); }
  onRemove() { this.onPlace(); }
  /** 自动操作：把 k 棒放进加热管（原来的放回台面） */
  async putRod(k) {
    const a = this.app;
    if (this.mat === k) return;
    if (this.pre > 0) { await a.tween(() => this.pre, (v) => (this.pre = v), -0.1, 300); this.pre = -0.1; }
    if (this.mat) a.moveSlot(a.comp('rod_' + this.mat), 'rest_' + this.mat, { silent: true });
    await a.autoPut('rod_' + k, 'tube');
  }
  /** 棒的伸长量（mm）：∫α(T)dT·L0；两端与支架接触处温度偏低，按 3% 的长度取端部温度 */
  get dL() {
    if (!this.mat) return 0;
    const r = this.rod, ext = (T) => r.a * (T - this.T0) + (r.da / 2) * ((T - 60) ** 2 - (this.T0 - 60) ** 2);
    return this.Lmeas * (0.97 * ext(this.Tr) + 0.03 * ext(this.Tr2));
  }
  /** 千分表读数 mm：测杆没碰到棒端时，棒要先伸长把缝填上，表才开始走；压进去的量也计入读数；超过量程（1 mm）指针顶死 */
  get gauge() { const gap = Math.max(0, -this.pre), push = Math.max(0, this.pre) + Math.max(0, this.dL - gap); return this.zero + this.zeroAdj + Math.min(1, push); }
  get contactText() { if (!this.mat) return '加热管里没有棒'; const g = -this.pre - this.dL; return g > 0.002 ? `测杆没有碰到棒端（缝约 ${g.toFixed(2)} mm），棒伸长时表不动` : this.pre + this.dL > 0.98 ? '测杆压得太深，已经到量程尽头，指针顶死' : `测杆顶住棒端，压进约 ${(this.pre + this.dL).toFixed(2)} mm`; }
  get Tshow() { return Math.round((this.Ta + 0.15 * (this.Ta - this.Tr)) * 10) / 10; } // 温度传感器在管内，靠近棒但更快
  tick(dt) {
    const a = this.app, sdt = Math.min(30, dt * (a.running ? a.speed * 25 : this.timeScale));
    if (!(sdt > 0)) return;
    const n = Math.max(1, Math.ceil(sdt / 0.5)), h = sdt / n, m = this.mat;
    for (let i = 0; i < n; i++) {
      const target = this.heat ? this.set : this.T0;
      // 温控：加热功率有限（升温最快约 0.25 K/s），接近设定值时按一阶系统逼近；不加热时自然冷却
      let dTa = (target - this.Ta) / this.tauA;
      if (this.heat) dTa = clamp(dTa * 1.6, -0.02, 0.25);
      this.Ta += dTa * h;
      for (const [k, r] of Object.entries(this.rT)) {
        if (k === m) { r.Tr += ((this.Ta - r.Tr) / this.tauR) * h; r.Tr2 += ((0.7 * this.Ta + 0.3 * this.T0 - r.Tr2) / (this.tauR * 1.4)) * h; }
        else { r.Tr += ((this.T0 - r.Tr) / (this.tauR * 3)) * h; r.Tr2 = r.Tr; } // 在台面上自然冷却
      }
      this.t += h;
    }
    a.changed();
  }
  steady() { return Math.abs(this.Ta - this.set) < 0.15 && Math.abs(this.Tr - this.Ta) < 0.05; }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [20, 60, 110], target: [0, 12, 0] }, { name: '千分表', pos: [42, 26, 30], target: [34, 14, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 70));
    app.stage.setLightTarget(0, 12, 0);
    const g = new THREE.Group(), frame = MAT.paint(0x2b3440);
    g.add(mesh(new THREE.BoxGeometry(80, 2, 16), frame, 0, 1, 0));
    const tube = mesh(new THREE.CylinderGeometry(4.5, 4.5, 56, 32), MAT.paint(0x8e3b2f), 0, 12, 0); tube.rotation.z = Math.PI / 2; g.add(tube);
    for (const x of [-28.5, 28.5]) { const c = mesh(new THREE.CylinderGeometry(4.8, 4.8, 1, 32), MAT.alu(), x, 12, 0); c.rotation.z = Math.PI / 2; g.add(c); }
    for (const x of [-26, 26]) g.add(mesh(new THREE.BoxGeometry(3, 8, 8), frame, x, 6, 0));
    // 三根待测棒：从器材柜拿出来，拖进加热管（插到固定端）；不用的放在台面上
    app.addSlot({ id: 'tube', pos: new THREE.Vector3(0, 12, 0), accepts: Object.keys(RODS).map((k) => 'rod_' + k), label: '加热管里（一端顶住固定端）', r: 4, snap: 12 });
    Object.entries(RODS).forEach(([k, r], i) => {
      app.addSlot({ id: 'rest_' + k, pos: new THREE.Vector3(0, 0.4, 16 + i * 3), accepts: ['rod_' + k], label: '台面', r: 3, snap: 8 });
      const rg = new THREE.Group(), rm = mesh(new THREE.CylinderGeometry(0.4, 0.4, L0 / 10, 16), new THREE.MeshStandardMaterial({ color: r.color, metalness: 0.85, roughness: 0.3 })); rm.rotation.z = Math.PI / 2; rg.add(rm);
      app.addComponent(new Component({
        key: 'rod_' + k, name: r.name, zone: 'slot', defaultSlot: 'tube', object: rg, labelY: 2,
        icon: SVG(`<rect x="4" y="17" width="56" height="6" rx="2" fill="currentColor"/>`),
        desc: `待测${r.name}，长约 ${L0} mm。在台面上用米尺量长度，再拖进加热管：插之前千分表要退开，插好后再把千分表推上去顶住棒端。`,
      }));
    });
    g.add(mesh(new THREE.BoxGeometry(2, 10, 6), frame, -31, 7, 0)); // 固定端
    // 千分表
    const dial = new THREE.Group();
    dial.add(mesh(new THREE.CylinderGeometry(4, 4, 1.6, 40), MAT.alu(), 0, 0, 0));
    this.dialCv = document.createElement('canvas'); this.dialCv.width = this.dialCv.height = 256;
    this.dialTex = new THREE.CanvasTexture(this.dialCv); this.dialTex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.CircleGeometry(3.7, 40), new THREE.MeshBasicMaterial({ map: this.dialTex })); face.rotation.x = -Math.PI / 2; face.position.y = 0.82; dial.add(face);
    dial.rotation.z = Math.PI / 2; dial.rotation.y = 0; dial.position.set(36, 12, 0);
    dial.rotation.set(0, 0, 0); dial.position.set(36, 17, 0);
    g.add(dial, mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 10), MAT.metal(), 31.5, 12, 0).rotateZ(Math.PI / 2), mesh(new THREE.BoxGeometry(2, 14, 4), frame, 38, 7, 0));
    app.addComponent(new Component({
      key: 'rig', name: '线膨胀仪', zone: 'none', fixed: true, required: true, object: g, labelY: 26,
      icon: SVG('<rect x="8" y="16" width="44" height="8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="56" cy="20" r="5" fill="none" stroke="currentColor"/>'),
      desc: `待测金属棒（长约 ${L0} mm）放在电加热管中，一端顶在固定端上，另一端推动千分表的测杆。千分表分度值 0.001 mm（指针转一圈 0.2 mm，小表盘记圈数）。加热管内的温度传感器接到温控仪。`,
      controls: () => [
        { type: 'readout', label: '加热管里', get: () => (this.mat ? this.rod.name : '没有棒：从器材柜拖一根进来') },
        { type: 'knob', label: '千分表前后位置（推向棒端）', get: () => this.pre, set: (v) => { this.pre = clamp(Math.round(v * 1000) / 1000, -0.5, 1.2); app.changed(); }, min: -0.5, max: 1.2, step: 0.005, bigStep: 0.05, perRev: 0.5, digits: 3, unit: 'mm' },
        { type: 'readout', label: '测杆与棒端', get: () => this.contactText },
        { type: 'knob', label: '千分表调零（转表圈）', get: () => this.zeroAdj, set: (v) => { this.zeroAdj = clamp(Math.round(v * 1000) / 1000, -1, 1); app.changed(); }, min: -1, max: 1, step: 0.001, bigStep: 0.05, perRev: 0.2, digits: 3, unit: 'mm' },
      ],
    }));
    const tc = (this.tcBox = meterBox(18, 10, 12, '温控仪')); tc.group.position.set(-46, 0, -14);
    app.addComponent(new Component({
      key: 'ctrl', name: '温控仪', zone: 'none', fixed: true, object: tc.group, labelY: 14,
      desc: '设定加热管的目标温度（0.1 °C），显示管内温度传感器的读数。加热功率有限，升温时管内温度按约 0.25 °C/s 上升，接近设定值时减慢，可能有少量过冲。',
      controls: () => [
        { type: 'toggle', label: '加热', get: () => this.heat, set: (v) => { this.heat = v; app.changed(); } },
        { type: 'knob', label: '设定温度', get: () => this.set, set: (v) => { this.set = clamp(Math.round(v * 10) / 10, 15, 95); app.changed(); }, min: 15, max: 95, step: 0.1, bigStep: 5, perRev: 20, digits: 1, unit: '°C' },
      ],
    }));
    this.gv = app.addView({ id: 'gauge', title: '千分表与温控仪读数', w: 300, h: 250, res: 1.6 });
  }
  update() {
    const s = `${this.Tshow.toFixed(1)}`;
    if (s !== this._ts || this.heat !== this._th) { this._ts = s; this._th = this.heat; this.tcBox.setText(s, '°C', `设定 ${this.set.toFixed(1)} °C ${this.heat ? '加热中' : '停止'}`); }
    this.drawDial(this.dialCv.getContext('2d'), 256, 256, false); this.dialTex.needsUpdate = true;
    const v = this.gv, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W * 0.04, H * 0.04); this.drawDial(g, H * 0.86, H * 0.86, true); g.restore();
    g.fillStyle = '#0b1410'; g.fillRect(W * 0.66, H * 0.08, W * 0.3, H * 0.2);
    g.fillStyle = '#ff9b6b'; g.font = `bold ${H * 0.09}px "IBM Plex Mono"`; g.textAlign = 'right'; g.fillText(this.Tshow.toFixed(1), W * 0.94, H * 0.22);
    g.fillStyle = '#9aa5ab'; g.font = `${H * 0.045}px "IBM Plex Mono"`; g.textAlign = 'left'; g.fillText('温度 °C', W * 0.67, H * 0.34); g.fillText(`设定 ${this.set.toFixed(1)}`, W * 0.67, H * 0.42);
    const dT = this.Ta - this.Tr;
    v.foot(!this.heat && this.Ta < this.T0 + 0.3 ? '常温。读千分表初读数，然后设定温度、开始加热' : Math.abs(this.Ta - this.set) > 0.3 && this.heat ? '升温中……' : Math.abs(dT) > 0.05 ? `温度示数已接近设定值，但棒还在伸长（千分表指针还在走）` : '温度与千分表读数都已稳定，可以记录');
  }
  /** 千分表：大指针 0.001 mm/格，一圈 200 格 = 0.2 mm；小指针记圈数 */
  drawDial(g, w, h, labels) {
    const R = Math.min(w, h) / 2 - 2, cx = w / 2, cy = h / 2, x = this.gauge;
    g.fillStyle = '#f4f1e6'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
    g.strokeStyle = '#1d2832'; g.lineWidth = Math.max(1, R * 0.02); g.stroke();
    for (let k = 0; k < 200; k++) {
      const a = (k / 200) * 2 * Math.PI - Math.PI / 2, l = k % 10 === 0 ? 0.14 : k % 5 === 0 ? 0.1 : 0.06;
      g.lineWidth = k % 10 === 0 ? R * 0.012 : R * 0.006;
      g.beginPath(); g.moveTo(cx + R * 0.94 * Math.cos(a), cy + R * 0.94 * Math.sin(a)); g.lineTo(cx + R * (0.94 - l) * Math.cos(a), cy + R * (0.94 - l) * Math.sin(a)); g.stroke();
      if (labels && k % 20 === 0) { g.fillStyle = '#1d2832'; g.font = `${R * 0.085}px "IBM Plex Mono"`; g.textAlign = 'center'; g.fillText(String(k), cx + R * 0.7 * Math.cos(a), cy + R * 0.7 * Math.sin(a) + R * 0.03); }
    }
    // 小表盘（圈数，0.2 mm/格）
    const r2 = R * 0.2, cy2 = cy + R * 0.4;
    g.strokeStyle = '#1d2832'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy2, r2, 0, 7); g.stroke();
    for (let k = 0; k < 10; k++) { const a = (k / 10) * 2 * Math.PI - Math.PI / 2; g.beginPath(); g.moveTo(cx + r2 * Math.cos(a), cy2 + r2 * Math.sin(a)); g.lineTo(cx + r2 * 0.75 * Math.cos(a), cy2 + r2 * 0.75 * Math.sin(a)); g.stroke(); }
    const as = ((x / 0.2) / 10) * 2 * Math.PI - Math.PI / 2; g.strokeStyle = '#2f3a44'; g.lineWidth = R * 0.025; g.beginPath(); g.moveTo(cx, cy2); g.lineTo(cx + r2 * 0.85 * Math.cos(as), cy2 + r2 * 0.85 * Math.sin(as)); g.stroke();
    const am = ((x % 0.2) / 0.2) * 2 * Math.PI - Math.PI / 2;
    g.strokeStyle = '#c41e3a'; g.lineWidth = R * 0.025; g.beginPath(); g.moveTo(cx - R * 0.12 * Math.cos(am), cy - R * 0.12 * Math.sin(am)); g.lineTo(cx + R * 0.86 * Math.cos(am), cy + R * 0.86 * Math.sin(am)); g.stroke();
    g.fillStyle = '#1d2832'; g.beginPath(); g.arc(cx, cy, R * 0.04, 0, 7); g.fill();
    if (labels) { g.fillStyle = '#4b5963'; g.font = `${R * 0.07}px "IBM Plex Mono"`; g.textAlign = 'center'; g.fillText('0.001 mm', cx, cy - R * 0.3); }
  }
  globalControls() { return [{ type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×5', value: 5 }, { label: '×20', value: 20 }] }]; }

  // ======================= 数据表 =======================
  tables() {
    return [
      { id: 'len', title: '金属棒的长度', fixedRows: true, initRows: () => [{ what: '常温下棒长' }], columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'L', label: 'L₀/mm', digits: 1, readTol: 0.6 }], buttons: [{ label: '用米尺量棒长', onClick: (t) => {
        const a = this.app, onBench = Object.keys(RODS).filter((k) => a.slotOf('rod_' + k) === 'rest_' + k);
        if (!onBench.length) return a.toast(this.mat ? '棒已经插在加热管里，米尺量不到：先拿出来放在台面上' : '台面上没有棒：从器材柜拿一根出来', 'warn');
        t.set(0, 'L', Math.round((this.Lmeas + gauss(0.2)) * 2) / 2);
      } }], note: '放进加热管之前用米尺量（分度值 1 mm，估读到 0.5 mm）。' },
      {
        id: 'dl', title: '温度与千分表读数', maxRows: 10,
        columns: [{ key: 'mat', label: '棒', type: 'text', readonly: true }, { key: 'T', label: 't/°C', digits: 1, readTol: 0.06 }, { key: 'x', label: '千分表读数/mm', digits: 3, readTol: 0.0011 }, { key: 'dx', label: 'ΔL/mm', digits: 3, calc: (r, i, rows) => { const f = rows.find((q) => q.mat === r.mat); return f ? r.x - f.x : NaN; } }],
        buttons: [{ label: '记录温度与千分表读数', onClick: (t) => this.rec(t) }],
        note: '第一行记常温下的读数（初读数）。之后每升高约 10 °C，等温度示数和千分表读数都稳定再记录。',
      },
    ];
  }
  rec(t) {
    const a = this.app;
    if (!this.mat) return a.toast('加热管里没有棒', 'warn');
    if (Math.abs(this.Tr - this.Ta) > 0.05) a.toast(`千分表指针还在走：棒的温度比管内温度${this.Tr < this.Ta ? '低' : '高'} ${Math.abs(this.Ta - this.Tr).toFixed(2)} °C，要等它稳定`, 'warn');
    if (t.rows.some((r) => r.mat === this.rod.name && Math.abs(r.T - this.Tshow) < 1)) a.toast('这个温度已经记过了', 'warn');
    if (-this.pre - this.dL > 0.002) a.toast('千分表测杆没有顶住棒端：表不随棒伸长而走', 'warn');
    else if (this.pre < 0.05 && !t.rows.some((r) => r.mat === this.rod.name)) a.toast('测杆几乎没有预压，接触不稳，读数容易跳', 'warn');
    if (this.pre + this.dL > 0.98) a.toast('千分表指针已经顶到量程尽头', 'warn');
    t.addRow({ mat: this.rod.name, T: this.Tshow, x: Math.round(this.gauge * 1000) / 1000 });
  }

  // ======================= 自动操作 =======================
  async heatTo(T) {
    const a = this.app;
    a.select(a.comp('ctrl'));
    await a.tween(() => this.set, (v) => (this.set = Math.round(v * 10) / 10), T, 600); this.set = T; this.heat = true; a.renderInspector();
    await a.until(() => this.steady() && Math.abs(this.Tr2 - (0.7 * this.Ta + 0.3 * this.T0)) < 0.2, 120000);
  }
  steps() {
    const app = this.app, rows = () => app.table('dl').rows.filter((r) => r.mat === this.rod.name && isFinite(r.x));
    return [
      {
        title: '量棒长，记千分表初读数',
        html: '<p>从器材柜拿一根金属棒放在台面上，用米尺量出常温下的长度 $L_0$。千分表先退开，<b>把棒拖进加热管</b>，使千分表测杆与棒端接触并有一定压缩量。在常温下记下温度和千分表的初读数。</p>',
        check: () => isFinite(app.table('len').rows[0].L) && rows().length >= 1,
        diagnose: () => (this.heat ? [{ msg: '初读数要在常温下记录，先别加热。' }] : []),
        auto: async () => {
          app.showTable(0);
          if (!this.mat && !app.comp('rod_cu').placed) await app.autoPut('rod_cu', 'rest_cu');
          if (!isFinite(app.table('len').rows[0].L)) { if (this.mat) app.moveSlot(app.comp('rod_' + this.mat), 'rest_' + this.mat, { silent: true }); await app.record('len', 0); }
          if (!this.mat) await this.putRod('cu');
          app.showTable(1); app.select(app.comp('rig'));
          if (this.pre < 0.08 || this.pre > 0.2) { await app.tween(() => this.pre, (v) => (this.pre = v), 0.12, 500); this.pre = 0.12; app.changed(); }
          await app.wait(300); await app.record('dl', 0);
        },
      },
      {
        title: '逐步升温，每 10 °C 记录一次',
        html: '<p>温控仪设定 30 °C，开始加热。管内温度到达设定值后，棒的温度还要一段时间才跟上——<b>等千分表指针停止移动</b>再记录温度和读数。然后依次设定 40、50、60、70、80 °C 重复。</p>',
        hint: '温度示数先稳定，千分表后稳定。可以把时间流速调快。',
        status: () => `已记录 ${rows().length - 1 > 0 ? rows().length - 1 : 0} 个升温点`,
        check: () => rows().filter((r) => r.T > this.T0 + 5).length >= 5,
        diagnose: () => {
          const out = [];
          if (!this.heat) out.push({ msg: '还没开始加热：设定一个比室温高约 10 °C 的温度，打开加热。', fix: { label: '帮我设到下一个温度', run: () => this.heatTo(SETS.find((s) => !rows().some((r) => Math.abs(r.T - s) < 2)) ?? 80) } });
          else if (Math.abs(this.Tr - this.Ta) > 0.05) out.push({ msg: `棒的温度还比管内低 ${(this.Ta - this.Tr).toFixed(2)} °C，千分表读数还会增大。现在记录，ΔL 偏小、α 偏小。` });
          return out;
        },
        auto: async () => {
          app.showTable(1);
          for (const T of SETS) { if (rows().some((r) => Math.abs(r.T - T) < 2)) continue; await this.heatTo(T); app.select(app.comp('rig')); await app.record('dl', 0); }
        },
      },
      {
        title: '数据处理',
        html: '<p>作 $\\Delta L$–$t$ 图，由直线斜率 $k$ 求 $\\alpha=k/L_0$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const L = +this.app.table('len').rows[0].L;
    if (!isFinite(L)) return { html: '<p>请先量出棒长 L₀。</p>', ok: false };
    const all = this.app.table('dl').rows.filter((r) => isFinite(r.T) && isFinite(r.x));
    const mats = [...new Set(all.map((r) => r.mat))];
    let html = `<h3>1. 棒长</h3><p>$L_0$ = ${L.toFixed(1)} mm。</p>`, answers = [], plots = [], main = null;
    for (const m of mats) {
      const rs = all.filter((r) => r.mat === m);
      if (rs.length < 3) continue;
      const f = linFit(rs.map((r) => r.T), rs.map((r) => r.x)), al = f.k / L, ual = f.uk / L;
      const key = Object.keys(RODS).find((k) => RODS[k].name === m), ref = RODS[key];
      html += `<h3>2. ${m}</h3><table><tr><th>t/°C</th><th>千分表/mm</th><th>ΔL/mm</th></tr>${rs.map((r) => `<tr><td>${r.T.toFixed(1)}</td><td>${r.x.toFixed(3)}</td><td>${(r.x - rs[0].x).toFixed(3)}</td></tr>`).join('')}</table>
        <p>最小二乘拟合 $\\Delta L=kt+b$：$k$ = ${(f.k * 1000).toFixed(3)} μm/°C，$r$ = ${f.r.toFixed(5)}。</p>
        <div class="result-box">$\\alpha=k/L_0=${fmtU(al * 1e6, ual * 1e6)}\\times10^{-6}\\ ^\\circ\\text{C}^{-1}$</div>
        <div class="result-box warn">${m}在 20–100 °C 的平均线膨胀系数参考值约 ${(ref.a * 1e6).toFixed(1)}×10⁻⁶ /°C，相对误差 ${pct(relErr(al, ref.a))}。</div>`;
      answers.push({ label: `$\\alpha$（${m}）`, unit: '×10⁻⁶ /°C', value: al * 1e6, digits: 2, tolRel: 0.01 });
      plots.push({ title: `ΔL–t（${m}）`, xLabel: 't / °C', yLabel: 'ΔL / mm', series: [{ type: 'scatter', data: rs.map((r) => [r.T, r.x - rs[0].x]), label: '实验点' }, { type: 'line', data: [rs[0].T, rs[rs.length - 1].T].map((x) => [x, f.k * x + f.b - rs[0].x]), label: '拟合直线' }] });
      main = main || al;
    }
    if (!main) return { html: html + '<p>同一根棒至少要 3 个温度点。</p>', ok: false };
    html += '<p>误差来源：棒的温度滞后于温度计（没等千分表稳定就读，α 偏小）；棒两端与支架接触处温度偏低；千分表测杆的回程误差。α 本身随温度略有增大，所以 ΔL–t 图线略向上弯。</p>';
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 线膨胀系数</h3>${expansionFig()}<p>固体受热时长度增加。温度变化不大时，伸长量与原长和温度变化成正比：</p>$$\\Delta L=\\alpha L_0\\,\\Delta t\\qquad\\Rightarrow\\qquad\\alpha=\\frac{\\Delta L}{L_0\\,\\Delta t}$$<p>金属的 α 约为 10⁻⁵ /°C 量级：0.5 m 长的铜棒升温 60 °C，只伸长约 0.5 mm，所以要用千分表（分度值 0.001 mm）来测。</p>
<h3>2. 作图法</h3><p>测出多个温度下的千分表读数，作 $\\Delta L$–$t$ 图，直线斜率 $k=\\alpha L_0$。作图法用到了全部数据，并且与初读数的误差无关。</p>
<h3>3. 本仿真的计算模型</h3><p>温控仪使加热管内的温度按一阶系统逼近设定值（升温速率有上限），金属棒的温度以更长的时间常数（约 100 s）跟随管内温度；棒两端约 3% 的长度与支架接触、温度偏低。伸长量按 $\\Delta L=L_0\\int\\alpha(T)\\,dT$ 计算，α 随温度略有增大。</p>`;
  }
}
