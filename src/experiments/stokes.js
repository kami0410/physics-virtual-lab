// 实验：落球法测液体的黏滞系数（蓖麻油 · 筒壁筒底修正 · 雷诺数）
// 小球下落速度按 physics/stokes.js 的收尾速度逐点计算（含筒壁 Faxén 修正、离筒底高度的 Lorentz 修正、Oseen 惯性修正），
// 刚入液的几厘米内受投放扰动略快；未浸润的小球会带着小气泡，偏离轴线时筒壁阻力更大。
import * as THREE from 'three';
import { meta, thumb } from './stokes.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss, fmtU } from '../core/Stats.js';
import { Micrometer, Caliper, Tape, Stopwatch } from '../core/gauges.js';
import { castorEta, castorRho, terminalV } from '../physics/stokes.js';
import { stokesFig } from './mechFigs.js';

const G = 9.794;
const HT = 46; // 量筒高 cm
const RHO_LABEL = 7.80, RHO0_LABEL = 0.96; // 标签上给出的密度 g/cm³
const BALLS = [['A1', 1.5], ['A2', 1.5], ['A3', 1.5], ['B1', 2.5], ['B2', 2.5], ['B3', 2.5]];
const MISC = [['L', '两标线间距 L / cm'], ['D', '量筒内径 D / mm'], ['H', '油柱高度 H / cm'], ['T', '油温 T / °C']];
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class StokesExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.T = Math.round(rand(18, 26) * 10) / 10 + rand(-0.04, 0.04);
    this.k = rand(0.93, 1.05);
    this.eta = castorEta(this.T, this.k); this.rho0 = castorRho(this.T);
    this.rho = RHO_LABEL * 1000 * (1 + rand(-0.003, 0.003));
    this.Din = rand(38, 42) / 1000; this.Hl = rand(38, 41) / 100;
    this.balls = BALLS.map(([id, dn]) => ({ id, d: (dn + rand(-0.012, 0.012)) / 1000, used: false, wet: false }));
    this.y1 = this.Hl * 100 - rand(1.5, 3.5); this.y2 = rand(1.5, 3); // 上、下标线离筒底高度 cm（学生可移动）
    this.mic = new Micrometer({ zero: Math.round(rand(-10, 12)) / 1000 || -0.003 });
    this.cal = new Caliper(); this.tape = new Tape({ label: '' });
    this.tool = 'd'; this.cur = 0; // tool：读数窗显示哪件量具（单击量具切换）；cur：最近拿的那颗小球
    this.mic.setObject(null); this.mic.gap = 2;
    this.sw = new Stopwatch(); this.ball = null; this.auto = null;
    this.timeScale = 1; this.assist = false;
    // 量筒要用底座螺丝调竖直（看铅垂线与筒壁是否平行）；没调时筒轴偏离竖直 1～2.5°
    this.tilt = (Math.random() < 0.5 ? -1 : 1) * rand(1, 2.5);
  }
  /** 小球在深度 s 处离筒轴的相对距离：筒倾斜时小球竖直下落，越落越偏向筒壁 */
  eccAt(bl, y) { const s = (this.Hl * 100 - y) / 100; return Math.min(0.9, Math.hypot(bl.ecc, (s * Math.tan((bl.tilt * Math.PI) / 180)) / (this.Din / 2))); }

  // ======================= 拖放 =======================
  get falling() { return !!(this.ball && this.ball.y > (this.ball.b.d * 100) / 2 + 0.01); }
  /** 千分尺测砧间夹着的小球序号（没有为 -1） */
  get inMic() { const z = this.app.zones && this.app.zones.find((q) => q.id === 'micJaw'); return z && z.occupant ? +z.occupant.key.slice(4) : -1; }
  canPlace(comp, o = {}) {
    const sl = o.slot ?? comp.defaultSlot;
    if (comp.key.startsWith('ball')) {
      const b = this.balls[+comp.key.slice(4)];
      if (sl === 'micJaw') {
        if (!this.app.comp('mic').placed) return '台上还没有千分尺';
        if (this.mic.gap < b.d * 1000) return `测砧间只有 ${this.mic.gap.toFixed(2)} mm，比小球小，放不进去：先退开微分筒`;
      }
      if ((sl === 'dropC' || sl === 'dropW') && this.falling) return '上一颗小球还在下落，等它落到筒底再放';
    }
    if (comp.key === 'tape' && (sl === 'tapeL' || sl === 'tapeH') && this.falling) return '小球正在下落，别把尺子伸进去';
    return null;
  }
  canRemove(comp) {
    if (this._sink) return null;
    if (comp.key.startsWith('ball') && this.balls[+comp.key.slice(4)].used) return '小球已经沉在蓖麻油里，取不回来了';
    return null;
  }
  onPlace(c) {
    if (!c) return;
    const a = this.app, sl = a.slotOf(c.key);
    if (c.key.startsWith('ball')) {
      const i = +c.key.slice(4), b = this.balls[i];
      this.cur = i;
      if (sl === 'dip') { b.wet = true; a.toast(`小球 ${b.id} 在油里浸润过了`, 'ok'); }
      if (sl === 'dropC' || sl === 'dropW') { this.drop(i, sl === 'dropC'); this._sink = true; a.moveSlot(c, 'sunk' + i, { silent: true }); this._sink = false; }
    }
    this.syncMic();
    if (c.key === 'mic') this.tool = 'd';
    if (c.key === 'cal') { this.tool = 'D'; this.cal.setObject(sl === 'calD' ? this.Din * 1000 : null); }
    if (c.key === 'tape') { if (sl === 'tapeL') { this.tool = 'L'; this.tape.measure(this.y1 - this.y2, { sigma: 0.03 }); } else if (sl === 'tapeH') { this.tool = 'H'; this.tape.measure(this.Hl * 100, { sigma: 0.04 }); } }
    a.renderInspector(); a.changed();
  }
  onSlotChange(c) { this.onPlace(c); }
  onRemove(c) { if (c && c.key === 'cal') this.cal.setObject(null); this.syncMic(); this.app.renderInspector(); }
  onSelect(c) { if (c.key === 'mic') this.tool = 'd'; else if (c.key === 'cal') this.tool = 'D'; else if (c.key === 'tape') { const sl = this.app.slotOf('tape'); if (sl === 'tapeH') this.tool = 'H'; else this.tool = 'L'; } }
  syncMic() { const i = this.inMic; if ((i < 0 ? null : this.balls[i].d * 1000) !== this.mic.obj) this.mic.setObject(i < 0 ? null : this.balls[i].d * 1000); }

  // ======================= 下落 =======================
  drop(i = this.cur, onAxis = true) {
    const a = this.app, b = this.balls[i];
    b.used = true;
    const ecc = onAxis ? rand(0, 0.12) : rand(0.5, 0.7);
    const bubble = b.wet ? 0 : rand(0.012, 0.03);
    this.ball = { b, y: this.Hl * 100, ecc, bubble, ang: rand(0, 6.28), t1: null, t2: null, tilt: this.tilt };
    a.renderInspector(); a.changed();
  }
  vAt(y) {
    const bl = this.ball, b = bl.b;
    const v = terminalV({ d: b.d, rho: this.rho * (1 - bl.bubble), rho0: this.rho0, eta: this.eta, D: this.Din, h: y / 100, ecc: this.eccAt(bl, y), g: G });
    const s = this.Hl * 100 - y; // 入液深度 cm
    return v * (1 + 0.25 * Math.exp(-s / 1.5));
  }
  tick(dt) {
    const a = this.app, sdt = Math.min(5, dt * (a.running ? a.speed * (this.auto ? 4 : 1) : this.timeScale));
    if (!(sdt > 0)) return;
    this.sw.tick(sdt);
    const bl = this.ball;
    if (!bl || bl.y <= 0) { if (this.sw.run) a.changed(); return; }
    const bottom = (bl.b.d * 100) / 2;
    const n = Math.ceil(sdt / 0.02), h = sdt / n;
    let tLeft = sdt;
    for (let i = 0; i < n && bl.y > bottom; i++) {
      const y0 = bl.y, v = this.vAt(y0) * 100; // cm/s
      bl.y = Math.max(bottom, y0 - v * h); tLeft -= h;
      for (const [mk, key] of [[this.y1, 't1'], [this.y2, 't2']]) {
        if (y0 > mk && bl.y <= mk) {
          const tc = tLeft + ((mk - bl.y) / (y0 - bl.y)) * h; // 过线后又走了多久
          this.onMark(key, tc);
        }
      }
    }
    if (bl.y <= bottom) bl.y = 0.0001 + bottom;
    a.changed();
  }
  /** 小球经过标线：自动计时时在此启停秒表（tAgo：过线时刻距本帧末的时间） */
  onMark(key, tAgo) {
    const au = this.auto;
    if (!au) return;
    if (key === 't1') { this.sw.reset(); this.sw.run = true; this.sw.t = tAgo + gauss(0.03); }
    else { this.sw.run = false; this.sw.t = Math.max(0, this.sw.t - tAgo + gauss(0.03)); this.auto = null; }
  }

  // ======================= 场景 =======================
  cameras() {
    return [
      { name: '全景', pos: [55, 48, 95], target: [8, 22, 0] },
      { name: '量筒', pos: [34, 36, 70], target: [2, 22, 0] },
      { name: '标线', pos: [12, this.y1 + 6, 26], target: [0, this.y1 - 3, 0] },
    ];
  }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 80));
    app.stage.setLightTarget(0, 20, 0);
    const R = (this.Din * 100) / 2;
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(R + 3, R + 3.5, 1.6, 40), MAT.paint(0x2b3440), 0, 0.8, 0));
    g.add(mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, HT, 48, 1, true), MAT.glass(0xdbeafe, 0.22), 0, HT / 2 + 1.6, 0));
    g.add(mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.6, 48), MAT.glass(0xdbeafe, 0.3), 0, 1.9, 0));
    const oil = mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.02, this.Hl * 100, 48), new THREE.MeshStandardMaterial({ color: 0xd49a2a, transparent: true, opacity: 0.42, roughness: 0.1, depthWrite: false }), 0, (this.Hl * 100) / 2 + 2.2, 0);
    g.add(oil);
    this.marks = [0, 1].map(() => { const m = mesh(new THREE.TorusGeometry(R + 0.42, 0.16, 8, 48), MAT.black(), 0, 0, 0); m.rotation.x = Math.PI / 2; g.add(m); return m; });
    // 温度计
    g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 30, 10), MAT.glass(0xffffff, 0.6), R * 0.62, this.Hl * 100 + 2.2 - 9, -R * 0.3));
    g.add(mesh(new THREE.BoxGeometry(3.2, 5, 1.6), MAT.paint(0x1f2937), R * 0.62, this.Hl * 100 + 2.2 + 8, -R * 0.3));
    // 小球盒与浸润用的油皿
    g.add(mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.8, 32), MAT.paint(0xe5e7eb), 18, 0.4, 8));
    g.add(mesh(new THREE.CylinderGeometry(2.4, 2.2, 0.8, 28), MAT.glass(0xdbeafe, 0.35), 26, 0.4, 2));
    g.add(mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.4, 28), new THREE.MeshStandardMaterial({ color: 0xd49a2a, transparent: true, opacity: 0.6 }), 26, 0.5, 2));
    const surf = this.Hl * 100 + 2.2;
    app.addSlot({ id: 'dip', pos: new THREE.Vector3(26, 0.6, 2), accepts: this.balls.map((_, i) => 'ball' + i), label: '油皿（浸润小球）', r: 1.6, snap: 4 });
    app.addSlot({ id: 'dropC', pos: new THREE.Vector3(0, surf + 0.4, 0), accepts: this.balls.map((_, i) => 'ball' + i), label: '液面中心（沿中心轴放手）', r: 0.8, snap: 3 });
    app.addSlot({ id: 'dropW', pos: new THREE.Vector3(R * 0.72, surf + 0.4, 0), accepts: this.balls.map((_, i) => 'ball' + i), label: '液面靠近筒壁处', r: 0.8, snap: 3 });
    this.balls.forEach((b, i) => {
      const k = 'ball' + i, home = new THREE.Vector3(16.2 + (i % 3) * 1.8, 1.0, 7 + Math.floor(i / 3) * 2);
      app.addSlot({ id: 'box' + i, pos: home, accepts: [k], label: '小球盒', r: 0.8, snap: 3 });
      app.addSlot({ id: 'sunk' + i, pos: new THREE.Vector3(0, -50, 0), accepts: [k], label: '油里', r: 0.01, snap: 0.01 });
      const bg = new THREE.Group(); bg.add(mesh(new THREE.SphereGeometry(Math.max(0.12, b.d * 50), 14, 10), new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.9, roughness: 0.2 })));
      app.addComponent(new Component({
        key: k, name: `小球 ${b.id}`, group: `钢球（标称 ${BALLS[i][1]} mm）`, zone: 'slot', defaultSlot: 'box' + i, object: bg, labelY: 1, showLabel: false, noShelf: true, home: '小球盒',
        icon: SVG('<circle cx="32" cy="20" r="7" fill="currentColor"/>'),
        desc: `钢球 ${b.id}（标称直径 ${BALLS[i][1]} mm）。用镊子夹起：拖到千分尺测砧间量直径，拖到油皿里浸润，再拖到量筒液面中心放手。`,
      }));
      app.place(app.comp(k), { slot: 'box' + i, silent: true });
    });
    // 千分尺、游标卡尺、钢尺：从器材柜拿出来
    const mg = new THREE.Group();
    mg.add(mesh(new THREE.BoxGeometry(1, 2.6, 0.6), MAT.paint(0x2b3440), -1.6, 1.3, 0), mesh(new THREE.BoxGeometry(4, 0.6, 0.6), MAT.paint(0x2b3440), 0, 0.3, 0));
    const sp = mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 12), MAT.chrome(), 2.6, 1.6, 0); sp.rotation.z = Math.PI / 2; mg.add(sp);
    app.addSlot({ id: 'micRest', pos: new THREE.Vector3(34, 0, 12), accepts: ['mic'], label: '台面', r: 4, snap: 10 });
    app.addSlot({ id: 'micJaw', pos: new THREE.Vector3(33, 1.6, 12), accepts: this.balls.map((_, i) => 'ball' + i), label: '千分尺测砧间', r: 0.8, snap: 3 });
    app.addComponent(new Component({
      key: 'mic', name: '螺旋测微器', zone: 'slot', defaultSlot: 'micRest', object: mg, labelY: 4,
      icon: SVG('<path d="M10 30V12h8M18 30H10" fill="none" stroke="currentColor" stroke-width="2"/><rect x="24" y="14" width="30" height="8" fill="none" stroke="currentColor" stroke-width="1.5"/>'),
      desc: '分度值 0.01 mm（估读到 0.001 mm）。合拢读零点；退开微分筒后把小球拖到测砧间，转测力装置夹住读数。',
      controls: () => [{ type: 'readout', label: '测砧间', get: () => (this.inMic < 0 ? '空（可读零点）' : `小球 ${this.balls[this.inMic].id}`) }, ...this.mic.controls(() => app.changed())],
    }));
    const cg = new THREE.Group();
    cg.add(mesh(new THREE.BoxGeometry(20, 0.25, 1.6), MAT.chrome(), 4, 0, 0), mesh(new THREE.BoxGeometry(0.8, 0.25, 3.6), MAT.chrome(), -1.4, 0, -1.6), mesh(new THREE.BoxGeometry(3, 0.4, 2), MAT.alu(), 2.6, 0.05, 0));
    app.addSlot({ id: 'calRest', pos: new THREE.Vector3(30, 0.15, 26), accepts: ['cal'], label: '台面', r: 4, snap: 10 });
    app.addSlot({ id: 'calD', pos: new THREE.Vector3(0, HT + 1.9, 0), accepts: ['cal'], label: '量筒口（内量爪撑住内壁）', r: 2, snap: 6 });
    app.addComponent(new Component({
      key: 'cal', name: '游标卡尺', zone: 'slot', defaultSlot: 'calRest', object: cg, labelY: 3,
      icon: SVG('<path d="M4 14h56v6H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 14V4h4v10M22 20v10h4V20" fill="none" stroke="currentColor" stroke-width="1.5"/>'),
      desc: '分度值 0.02 mm。拖到量筒口，用内量爪撑住内壁量内径 D。',
      controls: () => this.cal.controls(() => app.changed()),
    }));
    const tg = new THREE.Group(); tg.add(mesh(new THREE.BoxGeometry(1.6, 40, 0.1), MAT.paint(0xe9dfb8), 0, -20, 0));
    app.addSlot({ id: 'tapeRest', pos: new THREE.Vector3(-34, 0.1, 22), accepts: ['tape'], label: '台面', r: 4, snap: 10 });
    app.addSlot({ id: 'tapeL', pos: new THREE.Vector3(R + 1.4, this.y1 + 2.2, 0), accepts: ['tape'], label: '贴着筒壁、零点对准上标线', r: 1.5, snap: 5 });
    app.addSlot({ id: 'tapeH', pos: new THREE.Vector3(-R - 1.4, surf, 0), accepts: ['tape'], label: '贴着筒壁、零点对准液面', r: 1.5, snap: 5 });
    app.addComponent(new Component({
      key: 'tape', name: '钢尺', zone: 'slot', defaultSlot: 'tapeL', object: tg, labelY: 2,
      icon: SVG('<rect x="6" y="15" width="52" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 15v4M20 15v6M28 15v4M36 15v6M44 15v4M52 15v6" stroke="currentColor"/>'),
      desc: '分度值 1 mm。贴着筒壁竖直放：零点对准上标线量两标线间距 L，零点对准液面量油柱高度 H。',
    }));
    app.addComponent(new Component({
      key: 'tube', name: '落球法黏度计', zone: 'none', fixed: true, required: true, object: g, labelY: HT + 6,
      icon: SVG('<rect x="24" y="2" width="16" height="36" fill="none" stroke="currentColor" stroke-width="2"/>'),
      desc: `玻璃量筒中盛蓖麻油（密度 ρ₀ ≈ ${RHO0_LABEL.toFixed(2)} g/cm³），筒外套两根橡皮筋作为计时标线，可以上下移动。小球为钢球（密度 ρ = ${RHO_LABEL.toFixed(2)} g/cm³）。筒中插有数显温度计。`,
      controls: () => [
        { type: 'knob', label: '上标线（橡皮筋）', get: () => this.y1, set: (v) => (this.y1 = clamp(v, this.y2 + 5, HT - 2)), step: 0.1, bigStep: 1, perRev: 5, fmt: () => '上下移动' },
        { type: 'knob', label: '下标线（橡皮筋）', get: () => this.y2, set: (v) => (this.y2 = clamp(v, 0.5, this.y1 - 5)), step: 0.1, bigStep: 1, perRev: 5, fmt: () => '上下移动' },
        { type: 'readout', label: '数显温度计', get: () => `${this.T.toFixed(1)} °C` },
      ],
    }));
    this.fv = app.addView({ id: 'fall', title: '量筒（侧视）与秒表', w: 210, h: 300, res: 1.6 });
    this.gv = app.addView({ id: 'tool', title: '量具读数', w: 330, h: 150, res: 1.8 });
  }

  update() {
    const R = (this.Din * 100) / 2;
    this.marks[0].position.y = this.y1 + 2.2; this.marks[1].position.y = this.y2 + 2.2;
    const a = this.app, bl = this.ball, zs = (id) => a.zones.find((q) => q.id === id);
    if (bl) { const i = this.balls.indexOf(bl.b), z = zs('sunk' + i), e = this.eccAt(bl, bl.y); if (z) { z.pos.set(R * e * Math.cos(bl.ang), bl.y + 2.2, R * e * Math.sin(bl.ang)); if (z.occupant) z.occupant.root.position.copy(z.pos); } }
    const tl = zs('tapeL'); if (tl) { tl.pos.y = this.y1 + 2.2; if (tl.marker) tl.marker.position.y = tl.pos.y + 0.15; if (tl.occupant && !(a.drag && a.drag.comp === tl.occupant)) tl.occupant.root.position.copy(tl.pos); }
    const tc = a.comp('tape'); if (tc && tc.placed) tc.root.rotation.z = a.slotOf('tape') === 'tapeRest' ? Math.PI / 2 : 0;
    this.drawFall(); this.drawTool();
  }

  drawFall() {
    const v = this.fv, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    const top = H * 0.04, bot = H * 0.78, sc = (bot - top) / HT; // 每 cm 像素
    const x0 = W * 0.28, x1 = W * 0.62;
    const Y = (y) => bot - y * sc;
    g.fillStyle = 'rgba(212,154,42,.55)'; g.fillRect(x0, Y(this.Hl * 100), x1 - x0, bot - Y(this.Hl * 100));
    g.strokeStyle = '#9fb3c8'; g.lineWidth = 2; g.strokeRect(x0, top, x1 - x0, bot - top);
    g.fillStyle = '#111'; for (const y of [this.y1, this.y2]) g.fillRect(x0 - 4, Y(y) - 2, x1 - x0 + 8, 4);
    const bl = this.ball;
    if (bl) { g.fillStyle = '#cfd6dd'; g.beginPath(); g.arc((x0 + x1) / 2 + ((x1 - x0) / 2) * this.eccAt(bl, bl.y) * Math.cos(bl.ang), Y(bl.y), Math.max(2.5, bl.b.d * 100 * sc * 0.5 * 1.6), 0, 7); g.fill(); }
    g.fillStyle = '#c9ced3'; g.font = `${H * 0.034}px "Microsoft YaHei"`; g.textAlign = 'left';
    g.fillText('上标线', x1 + 8, Y(this.y1) + 4); g.fillText('下标线', x1 + 8, Y(this.y2) + 4);
    this.sw.draw(g, W * 0.08, H * 0.83, W * 0.84, H * 0.13);
    let foot;
    if (bl && bl.y > (bl.b.d * 100) / 2 + 0.01) foot = `小球 ${bl.b.id} 正在下落：经过上标线时开表，经过下标线时停表`;
    else if (this.Hl * 100 - this.y1 < 5) foot = '上标线离液面太近：小球刚入液时还在受扰动';
    else if (this.y2 < 4) foot = '下标线离筒底太近：筒底使小球减速';
    else foot = `${this.balls.filter((q) => q.used).length} 颗已投放；把下一颗小球拖到液面中心放手`;
    v.foot(foot);
  }

  gauge() { return this.tool === 'd' ? this.mic : this.tool === 'D' ? this.cal : this.tape; }
  /** 自动操作：把量具放到量 t 的位置（'d' 千分尺放到台上） */
  setTool(t) {
    const a = this.app, put = (k, sl) => { const c = a.comp(k); if (c.placed) a.moveSlot(c, sl, { silent: true }); else a.place(c, { slot: sl, silent: true }); };
    if (t === 'd') put('mic', 'micRest');
    if (t === 'L') put('tape', 'tapeL');
    if (t === 'H') put('tape', 'tapeH');
    if (t === 'D') { if (this.cal.open < this.Din * 1000) this.cal.open = this.Din * 1000 + 6; put('cal', 'calD'); }
    this.tool = t;
    if (t === 'L') this.tape.measure(this.y1 - this.y2, { sigma: 0.03 });
    if (t === 'H') this.tape.measure(this.Hl * 100, { sigma: 0.04 });
  }
  /** 当前读数窗对应的量具有没有放到位 */
  toolReady() {
    const a = this.app, t = this.tool;
    return t === 'd' ? a.comp('mic').placed : t === 'D' ? a.slotOf('cal') === 'calD' : a.slotOf('tape') === (t === 'L' ? 'tapeL' : 'tapeH');
  }
  drawTool() {
    const v = this.gv, g = v.ctx, W = v.W, H = v.H, o = { assist: this.assist };
    if (!this.toolReady()) { g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H); v.foot({ d: '台上还没有千分尺：从器材柜拿出来', D: '游标卡尺还没卡在量筒口', L: '钢尺还没有对准上标线贴在筒壁上', H: '钢尺还没有对准液面贴在筒壁上' }[this.tool]); return; }
    if (this.tool === 'L' && Math.abs(this.tape.value - (this.y1 - this.y2)) > 1e-6) this.tape.measure(this.y1 - this.y2, { sigma: 0.03 });
    if (this.tool === 'd') this.mic.draw(g, W, H, o);
    else if (this.tool === 'D') this.cal.draw(g, W, H, o);
    else this.tape.draw(g, W, H, { ...o, mark: this.tool === 'L' ? '下标线' : '液面' });
    const nm = { d: `螺旋测微器：${this.inMic < 0 ? '零点' : `小球 ${this.balls[this.inMic].id} 的直径`}`, L: '钢尺：两标线间距（零点对准上标线）', D: '游标卡尺（内量爪）：量筒内径', H: '钢尺：筒底到液面的高度' }[this.tool];
    const p = this.tool === 'd' ? this.mic.problem() : this.tool === 'D' ? this.cal.problem() : null;
    v.foot(p ? `${nm} —— ${p}` : nm);
  }

  globalControls() {
    const a = this.app, rer = () => { a.renderInspector(); a.changed(); };
    const out = [
      { type: 'knob', label: '底座调节螺丝（使量筒竖直）', get: () => this.tilt, set: (v) => { this.tilt = clamp(v, -4, 4); a.changed(); }, min: -4, max: 4, step: 0.02, bigStep: 0.5, perRev: 2, fmt: () => (Math.abs(this.tilt) < 0.2 ? '铅垂线与筒壁平行' : `铅垂线与筒壁夹角约 ${Math.abs(this.tilt).toFixed(1)}°`) },
      { type: 'button', label: this.sw.run ? '秒表：停止' : '秒表：开始', onClick: () => { if (this.sw.run) this.sw.stop(gauss(0.04) * this.timeScale); else { this.sw.reset(); this.sw.start(0); } rer(); } },
      { type: 'button', label: '秒表：清零', onClick: () => { this.sw.reset(); a.changed(); } },
      { type: 'readout', label: '读数窗', get: () => `${{ d: '螺旋测微器', D: '游标卡尺', L: '钢尺（L）', H: '钢尺（H）' }[this.tool]}（单击量具切换）` },
    ];
    if ((this.tool === 'L' || this.tool === 'H') && this.toolReady()) out.push({ type: 'button', label: '钢尺重新对一次零点再读', onClick: () => { this.setTool(this.tool); a.changed(); } });
    out.push(
      { type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×2', value: 2 }, { label: '×4', value: 4 }] },
      { type: 'toggle', label: '读数辅助（显示数值）', get: () => this.assist, set: (v) => (this.assist = v) },
    );
    return out;
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'ball', title: '小球直径与下落时间', fixedRows: true,
        initRows: () => [{ k: 'z', what: '千分尺零点' }, ...BALLS.map(([id, dn]) => ({ k: id, what: `小球 ${id}（${dn} mm）` }))],
        columns: [
          { key: 'what', label: '', type: 'text', readonly: true },
          { key: 'r', label: '千分尺读数/mm', digits: 3, readTol: 0.0025 },
          { key: 'd', label: '直径 d/mm', digits: 3, calc: (r, i, rows) => (r.k === 'z' ? NaN : r.r - rows[0].r) },
          { key: 't', label: '下落时间 t/s', digits: 2, readTol: 0.011, optional: true },
        ],
        buttons: [{ label: '记录千分尺读数', onClick: (t) => this.recD(t) }, { label: '记录秒表读数', onClick: (t) => this.recT(t) }],
        note: '先读千分尺零点，再逐个测小球直径。小球经过上标线时开表、经过下标线时停表，时间记在该小球的行里。',
      },
      {
        id: 'misc', title: '其他量', fixedRows: true,
        initRows: () => MISC.map(([k, what]) => ({ k, what })),
        columns: [{ key: 'what', label: '待测量', type: 'text', readonly: true }, { key: 'v', label: '测量值', digits: 2, readTol: 0.05 }],
        buttons: [{ label: '记录当前量具读数', onClick: (t) => this.recM(t) }, { label: '记录油温', onClick: (t) => t.set(t.rows.findIndex((r) => r.k === 'T'), 'v', Math.round(this.T * 10) / 10) }],
        note: '量完所有小球后再测 L（两标线间距）、D、H，实验前后各读一次油温取平均（本实验中油温不变）。',
      },
    ];
  }
  recD(t) {
    const a = this.app;
    if (!a.comp('mic').placed) return a.toast('台上还没有千分尺', 'warn');
    this.tool = 'd';
    const p = this.mic.problem();
    if (p) { a.toast(p, 'warn'); if (this.mic.squeeze <= 0.0015) return; }
    const k = this.inMic < 0 ? 'z' : this.balls[this.inMic].id;
    const i = t.rows.findIndex((r) => r.k === k);
    t.set(i, 'r', Math.round((this.mic.reading + (k === 'z' ? 0 : gauss(0.0008))) * 1000) / 1000);
  }
  recT(t) {
    const a = this.app, bl = this.ball;
    if (this.sw.run) a.toast('秒表还在走', 'warn');
    if (!bl) return a.toast('还没有投放小球', 'warn');
    if (!(this.sw.value > 0)) return a.toast('秒表读数为零', 'warn');
    const i = t.rows.findIndex((r) => r.k === bl.b.id);
    if (bl.bubble > 0) a.toast('这颗小球没有先在油中浸润，表面带着小气泡，下落偏慢', 'warn');
    if (bl.ecc > 0.4) a.toast('这颗小球是靠近筒壁落下的，筒壁阻力比修正公式估计的大', 'warn');
    else if (Math.abs(bl.tilt) > 0.3) a.toast(`量筒没有调竖直（偏约 ${Math.abs(bl.tilt).toFixed(1)}°）：小球越落越靠近筒壁，下落变慢`, 'warn');
    t.set(i, 't', this.sw.value);
  }
  recM(t) {
    const a = this.app, k = this.tool;
    if (k === 'd') return a.toast('千分尺的读数记在小球表里', 'warn');
    if (!this.toolReady()) return a.toast({ D: '游标卡尺还没卡在量筒口', L: '钢尺还没有对准上标线', H: '钢尺还没有对准液面' }[k], 'warn');
    if (k === 'D') { const p = this.cal.problem(); if (p) a.toast(p, 'warn'); }
    const i = t.rows.findIndex((r) => r.k === k);
    t.set(i, 'v', Math.round((k === 'D' ? this.cal.reading : this.tape.reading) * 100) / 100);
  }

  // ======================= 自动操作 =======================
  async knob(get, set, to, ms = 400) { await this.app.tween(get, set, to, ms); set(to); this.app.changed(); }
  async measureBall(i) {
    const a = this.app;
    const s = this.balls[i].d * 1000;
    if (this.mic.gap < s + 0.2) await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), s + 0.4, 200);
    await a.autoPut('ball' + i, 'micJaw');
    await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), s + 0.1, 250);
    await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), s - 0.02, 250);
    await a.record('ball', 0);
    await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), s + 0.4, 150);
    await a.autoPut('ball' + i, 'box' + i);
  }
  async fallOnce(i) {
    const a = this.app;
    if (Math.abs(this.tilt) > 0.1) { await a.tween(() => this.tilt, (v) => (this.tilt = v), 0, 500); this.tilt = 0; a.changed(); }
    if (a.slotOf('tape') === 'tapeL' || a.slotOf('tape') === 'tapeH') a.moveSlot(a.comp('tape'), 'tapeRest', { silent: true });
    if (!this.balls[i].wet) { await a.autoPut('ball' + i, 'dip'); await a.wait(300); }
    this.sw.reset(); this.auto = { phase: 'arm' };
    await a.autoPut('ball' + i, 'dropC');
    if (!(await a.until(() => !this.auto))) { this.auto = null; return; }
    await a.record('ball', 1);
    while (this.ball && this.ball.y > (this.ball.b.d * 100) / 2 + 0.02) await a.wait(120);
  }
  steps() {
    const app = this.app, rows = () => app.table('ball').rows;
    const has = (r, k) => r[k] != null && r[k] !== '' && isFinite(r[k]);
    return [
      {
        title: '调整标线位置',
        html: '<p>上标线应在液面下 5 cm 以上（小球刚入液时受投放的扰动，还没有达到匀速），下标线离筒底也要有几厘米（筒底使小球减速）。两标线间距尽量大一些，计时的相对误差小。</p>',
        check: () => this.Hl * 100 - this.y1 >= 5 && this.y2 >= 4 && this.y1 - this.y2 >= 20,
        auto: async () => {
          await app.view('量筒'); app.select(app.comp('tube'));
          await this.knob(() => this.y1, (v) => (this.y1 = v), Math.round((this.Hl * 100 - 6) * 10) / 10);
          await this.knob(() => this.y2, (v) => (this.y2 = v), 5);
        },
      },
      {
        title: '用千分尺测小球直径',
        html: '<p>从器材柜拿出千分尺，先合拢读零点。然后退开微分筒，<b>把小球拖到测砧间</b>，旋转测力装置夹住，读数。每颗小球都要测（编号对应，投放后就找不回来了）。</p>',
        check: () => rows().every((r) => has(r, 'r')),
        auto: async () => {
          app.showTable(0); this.setTool('d'); app.renderInspector();
          await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), 0.3, 250);
          await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), -0.02, 250);
          await app.record('ball', 0);
          for (let i = 0; i < this.balls.length; i++) await this.measureBall(i);
        },
      },
      {
        title: '投放小球，测下落时间',
        html: '<p>小球先<b>拖到油皿里浸润</b>（去掉表面的气泡），再<b>拖到液面中心</b>放手，使它沿筒的中心轴下落。眼睛平视标线，小球经过上标线时开表，经过下标线时停表。6 颗小球各测一次。</p>',
        hint: '大球下落快，时间短，计时的相对误差大；小球下落慢，但直径测量的相对误差大。',
        check: () => rows().filter((r) => r.k !== 'z' && has(r, 't')).length >= 6,
        auto: async () => {
          await app.view('全景'); app.showTable(0);
          for (let i = 0; i < this.balls.length; i++) if (!this.balls[i].used) await this.fallOnce(i);
        },
      },
      {
        title: '测 L、D、H 和油温',
        html: '<p>把钢尺拖到筒壁边，零点对准上标线量两标线间距 L、对准液面量油柱高度 H；把游标卡尺拖到量筒口，用内量爪量内径 D；读油温。</p>',
        check: () => app.table('misc').rows.every((r) => has(r, 'v')),
        auto: async () => {
          app.showTable(1);
          for (const k of ['L', 'D', 'H']) {
            this.setTool(k); app.renderInspector(); app.changed();
            if (k === 'D') { const s = this.Din * 1000; this.cal.open = s + 6; await this.knob(() => this.cal.open, (v) => this.cal.push(v), s - 1); }
            await app.wait(300); await app.record('misc', 0);
          }
          await app.record('misc', 1);
        },
      },
      {
        title: '数据处理',
        html: '<p>计算每颗小球给出的黏度，作筒壁、筒底修正；计算雷诺数，判断是否需要再作惯性修正。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, rows = a.table('ball').rows, z = +rows[0].r;
    const mv = Object.fromEntries(a.table('misc').rows.map((r) => [r.k, r.v === '' || r.v == null ? NaN : +r.v]));
    const okRow = (r) => r.k !== 'z' && isFinite(r.r) && r.r !== '' && r.r != null && isFinite(r.t) && r.t !== '' && r.t != null && r.t > 0;
    const data = rows.filter(okRow);
    if (!isFinite(z) || rows[0].r === '' || rows[0].r == null) return { html: '<p>请先读千分尺零点。</p>', ok: false };
    if (!data.length) return { html: '<p>请先测量小球直径和下落时间。</p>', ok: false };
    if (!['L', 'D', 'H'].every((k) => mv[k] > 0)) return { html: '<p>请先测 L、D、H。</p>', ok: false };
    const T = isFinite(mv.T) ? mv.T : this.T;
    const rho = RHO_LABEL * 1000, rho0 = RHO0_LABEL * 1000, L = mv.L / 100, D = mv.D / 1000, H = mv.H / 100;
    const res = data.map((r) => {
      const d = (r.r - z) / 1000, t = +r.t, v = L / t;
      const kw = 1 + (2.4 * d) / D, kb = 1 + (1.6 * d) / H;
      const eta = ((rho - rho0) * G * d * d * t) / (18 * L * kw * kb);
      const Re = (rho0 * v * d) / eta;
      const eta2 = eta / (1 + (3 * Re) / 16);
      return { id: r.k, d, t, v, kw, kb, eta, Re, eta2 };
    });
    const f = (x, n = 4) => x.toFixed(n);
    let html = `<h3>1. 各小球的结果</h3><p>ρ = ${RHO_LABEL.toFixed(2)} g/cm³，ρ₀ = ${RHO0_LABEL.toFixed(2)} g/cm³；L = ${f(mv.L, 2)} cm，D = ${f(mv.D, 2)} mm，H = ${f(mv.H, 2)} cm；千分尺零点 ${f(z, 3)} mm。</p>
      <table><tr><th>小球</th><th>d/mm</th><th>t/s</th><th>v/(mm/s)</th><th>1+2.4d/D</th><th>1+1.6d/H</th><th>η/(Pa·s)</th><th>Re</th><th>η′=η/(1+3Re/16)</th></tr>
      ${res.map((x) => `<tr><td>${x.id}</td><td>${f(x.d * 1000, 3)}</td><td>${f(x.t, 2)}</td><td>${f(x.v * 1000, 3)}</td><td>${f(x.kw, 4)}</td><td>${f(x.kb, 4)}</td><td>${f(x.eta, 4)}</td><td>${x.Re.toFixed(4)}</td><td>${f(x.eta2, 4)}</td></tr>`).join('')}</table>`;
    const grp = (p) => res.filter((x) => x.id[0] === p);
    const A = grp('A'), B = grp('B');
    const answers = [];
    if (A.length && B.length) {
      const eA = mean(A.map((x) => x.eta)), eB = mean(B.map((x) => x.eta));
      html += `<p>未作惯性修正时，小球 A 组平均 ${f(eA)} Pa·s，B 组 ${f(eB)} Pa·s，大球测得的值偏大 ${pct((eB - eA) / eA, 2)}——大球的雷诺数大，斯托克斯公式的误差也大。作 Oseen 修正后两组一致性更好。</p>`;
      answers.push({ label: '$\\eta_A$', unit: 'Pa·s', value: eA, digits: 4, tolRel: 0.006 });
    }
    const all = res.map((x) => x.eta2), em = mean(all);
    const uA = all.length > 1 ? stdev(all) / Math.sqrt(all.length) : 0;
    const rB = Math.hypot(0.04 / mean(res.map((x) => x.t)), 0.05 / mv.L, (2 * 0.001) / mean(res.map((x) => x.d * 1000)));
    const u = Math.hypot(uA, em * rB);
    html += `<h3>2. 结果</h3><div class="result-box">油温 ${f(T, 1)} °C 时，蓖麻油的黏滞系数 $\\eta=${fmtU(em, u)}$ Pa·s</div>
      <p>不确定度包括各次结果的分散（A 类 ${f(uA)} Pa·s）和计时、L、d 的测量误差（B 类约 ${pct(rB, 2)}）。蓖麻油的黏度随温度变化很快，约每升高 1 °C 减小 8%，所以必须同时报告油温。</p>`;
    const ref = this.eta;
    html += `<div class="result-box warn">本瓶蓖麻油在 ${this.T.toFixed(2)} °C 时的黏度参考值 ${ref.toFixed(4)} Pa·s，测量值相对误差 ${pct(relErr(em, ref), 2)}。</div>`;
    answers.push({ label: '$\\eta$', unit: 'Pa·s', value: em, digits: 4, tolRel: 0.006 });
    const plots = [{ title: 'η 与雷诺数', xLabel: 'Re', yLabel: 'η / (Pa·s)', series: [{ type: 'scatter', data: res.map((x) => [x.Re, x.eta]), label: '斯托克斯公式' }, { type: 'scatter', data: res.map((x) => [x.Re, x.eta2]), label: '惯性修正后' }] }];
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 斯托克斯公式</h3>${stokesFig()}<p>半径 $a$ 的小球在无限广延的黏滞液体中以很小的速度 $v$ 运动时，受到的阻力 $F=6\\pi\\eta av$。小球在液体中下落，受重力、浮力和阻力，很快达到匀速（收尾速度）：</p>$$\\frac43\\pi a^3(\\rho-\\rho_0)g=6\\pi\\eta av\\quad\\Rightarrow\\quad\\eta=\\frac{(\\rho-\\rho_0)gd^2}{18v}$$
<h3>2. 筒壁与筒底修正</h3><p>液体装在内径 $D$、深 $H$ 的圆筒中时，筒壁和筒底使阻力增大。常用的经验修正：</p>$$\\eta=\\frac{(\\rho-\\rho_0)gd^2t}{18L\\left(1+2.4\\dfrac dD\\right)\\left(1+1.6\\dfrac dH\\right)}$$<p>其中 $t$ 是小球匀速通过两标线（间距 $L$）的时间。</p>
<h3>3. 雷诺数</h3><p>斯托克斯公式只在雷诺数 $Re=\\rho_0vd/\\eta\\ll1$ 时成立。$Re$ 稍大时，阻力还要乘以 $(1+\\tfrac{3}{16}Re)$（Oseen 修正），由斯托克斯公式算出的 $\\eta$ 要除以这个因子。</p>
<h3>4. 本仿真的计算模型</h3><p>小球在每个位置的速度按收尾速度计算：筒壁修正用 Faxén 公式（与经验公式 $1+2.4d/D$ 相差约 0.3%），筒底修正用随离底高度变化的 Lorentz 公式，再乘以 Oseen 因子。刚入液的约 3 cm 内，小球受投放扰动略快；没有浸润的小球带着小气泡，有效密度小 1%–3%；偏离中心轴下落时筒壁阻力更大。蓖麻油的黏度按 Arrhenius 型公式随温度变化（20 °C 时约 1 Pa·s，每升高 1 °C 约减小 8%），每瓶油还有 ±5% 的批次差别。</p>`;
  }
}
