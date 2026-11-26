// 实验：单摆测重力加速度（改变摆长作 T²–L 图 · 大摆角对周期的影响 · 秒表计时）
// 摆的运动按 physics/pendulum.js 的精确方程积分（不作小角近似，摆球按复摆处理，含空气阻尼）：
// 摆角大时周期变长；秒表由学生按，起停时摆球是否在最低点、人的反应时间都会进入结果。
import * as THREE from 'three';
import { meta, thumb } from './pendulum.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss, fmtU, linFit } from '../core/Stats.js';
import { Caliper, Tape, Stopwatch } from '../core/gauges.js';
import { Pendulum, equivLength, periodExact } from '../physics/pendulum.js';
import { pendulumFig } from './mechFigs2.js';

const YS = 128; // 悬点高度 cm
const NP = 30; // 每次计时的全振动次数
const D2R = Math.PI / 180;
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class PendulumExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.g = rand(9.780, 9.815);
    this.dBall = rand(19.9, 20.1); // 摆球直径 mm
    this.l = Math.round(rand(55, 70) * 10) / 10 + rand(-0.04, 0.04); // 摆线长 cm（悬点到球顶）
    this.gamma = rand(0.003, 0.005); // 空气阻尼（1/s）
    this.p = new Pendulum({ Leq: this.Leq(), g: this.g, gamma: this.gamma });
    this.amp0 = 4; // 释放时的摆角（°）
    this.cal = new Caliper({ zero: Math.round(rand(-2, 2)) * 0.02 });
    this.tape = new Tape({ label: '悬点到球顶' });
    this.tool = 'd'; // 读数窗显示哪件量具：'d' 游标卡尺，'l' 米尺
    this.cal.setObject(null); this.cal.open = 0;
    this.sw = new Stopwatch(); this.cross = 0; this.lastCross = -1e9; this.auto = null; this.startInfo = null;
    this.timeScale = 1; this.assist = false;
  }
  /** 游标卡尺是否夹着摆球 */
  get ballIn() { return !!(this.app.slotOf && this.app.slotOf('cal') === 'calBall'); }
  get tapeOn() { return !!(this.app.slotOf && this.app.slotOf('tape') === 'tapeHang'); }
  canPlace(comp, o = {}) {
    const sl = o.slot ?? comp.defaultSlot;
    if (sl === 'calBall') {
      if (this.moving) return '摆球还在摆动，先用手止住再用卡尺夹';
      if (this.cal.open < this.dBall) return `量爪开口只有 ${this.cal.open.toFixed(1)} mm，比摆球小，夹不进去：先把尺框拉开`;
    }
    return null;
  }
  onPlace(c) {
    if (!c) return;
    if (c.key === 'cal') { this.tool = 'd'; this.cal.setObject(this.ballIn ? this.dBall : null); }
    if (c.key === 'tape') { if (this.tapeOn) { this.tool = 'l'; this.tape.measure(this.l, { sigma: 0.04 }); } }
    this.app.changed();
  }
  onSlotChange(c) { this.onPlace(c); }
  onRemove(c) {
    if (c && c.key === 'cal') { this.cal.setObject(null); if (this.tapeOn) this.tool = 'l'; }
    if (c && c.key === 'tape' && this.app.comp('cal').placed) this.tool = 'd';
  }
  onSelect(c) { if (c.key === 'cal') this.tool = 'd'; else if (c.key === 'tape') this.tool = 'l'; }
  /** 自动操作：卡尺夹 / 不夹摆球 */
  setBallIn(v) {
    const a = this.app, c = a.comp('cal'), slot = v ? 'calBall' : 'calRest';
    if (v) { this.stopBall(); if (this.cal.open < this.dBall) this.cal.open = this.dBall + 5; }
    if (c.placed) a.moveSlot(c, slot, { silent: true }); else a.place(c, { slot, silent: true });
    this.onPlace(c);
  }
  Leq() { const r = this.dBall / 2000, L = this.l / 100 + r; return equivLength(L, r); }
  setLength(v) {
    this.l = clamp(v, 40, 112);
    this.p.th = 0; this.p.w = 0; this.p.Leq = this.Leq();
    if (this.tool === 'l') this.tape.measure(this.l, { sigma: 0.04 });
    this.app.changed();
  }

  // ======================= 运动 =======================
  release() {
    if (this.ballIn) { this.app.toast('游标卡尺还夹着摆球，拉不开：先把卡尺拿开', 'warn'); return; }
    this.p.Leq = this.Leq();
    this.p.th = this.amp0 * D2R; this.p.w = 0;
    this.app.changed();
  }
  stopBall() { this.p.th = 0; this.p.w = 0; this.app.changed(); }
  get moving() { return Math.abs(this.p.th) > 1e-5 || Math.abs(this.p.w) > 1e-5; }
  tick(dt) {
    const a = this.app, sdt = Math.min(3, dt * (a.running ? a.speed * (this.auto ? 4 : 1) : this.timeScale));
    if (!(sdt > 0)) return;
    const evs = [];
    if (this.moving) this.p.step(sdt, (tc) => evs.push(tc)); else this.p.t += sdt;
    const tEnd = this.p.t;
    this.sw.tick(sdt);
    for (const tc of evs) {
      this.cross++; this.lastCross = tc;
      const au = this.auto;
      if (!au) continue;
      if (au.phase === 'arm') { this.sw.reset(); this.sw.run = true; this.sw.t = tEnd - tc + gauss(0.02); au.phase = 'run'; au.stopAt = this.cross + au.N; this.startInfo = this.info(); this.counted = 0; }
      else if (au.phase === 'run' && this.cross >= au.stopAt) { this.sw.run = false; this.sw.t = Math.max(0, this.sw.t - (tEnd - tc) + gauss(0.02)); this.stopPhase = 0; this.auto = null; }
    }
    if (this.sw.run && this.startInfo) this.counted = this.cross - this.startInfo.cross;
    if (this.moving || this.sw.run) a.changed();
  }
  /** 离最低点有多远（以周期计） */
  phaseErr() { const T = 2 * Math.PI * Math.sqrt(this.p.Leq / this.g), d = (((this.p.t - this.lastCross) % T) + T) % T; return Math.min(d, Math.abs(d - T / 2), T - d) / T; }
  info() { return { amp: this.p.amp / D2R, l: this.l, cross: this.cross, phase: this.phaseErr() }; }
  swStart() { if (this.sw.run) return; this.sw.reset(); this.sw.start(0); this.startInfo = this.info(); this.counted = 0; this.app.changed(); }
  swStop() { if (!this.sw.run) return; this.sw.stop(gauss(0.035) * this.timeScale); this.stopPhase = this.phaseErr(); this.app.changed(); }

  // ======================= 场景 =======================
  cameras() {
    return [
      { name: '全景', pos: [70, 100, 190], target: [0, 70, 0] },
      { name: '摆球', pos: [22, YS - this.l - 4, 60], target: [0, YS - this.l - 6, 0] },
      { name: '悬点', pos: [18, YS + 6, 34], target: [0, YS - 4, 0] },
    ];
  }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 80));
    app.stage.setLightTarget(0, 70, 0);
    const g = new THREE.Group(), dark = MAT.paint(0x2b3440), steel = MAT.metal();
    g.add(mesh(new THREE.BoxGeometry(40, 2.4, 30), dark, -10, 1.2, 0));
    g.add(mesh(new THREE.CylinderGeometry(1.4, 1.6, YS + 8, 18), steel, -26, (YS + 8) / 2 + 2.4, 0));
    g.add(mesh(new THREE.BoxGeometry(30, 2.4, 3.6), dark, -12, YS + 4, 0));
    // 夹线器（悬点）：两块夹板
    g.add(mesh(new THREE.BoxGeometry(3.2, 3.2, 3.2), MAT.alu(), 0, YS + 1.6, 0));
    g.add(mesh(new THREE.BoxGeometry(0.6, 3.6, 3.6), MAT.black(), 1.9, YS + 1.6, 0));
    // 量角器（挂在悬点下方）
    const pro = new THREE.Mesh(new THREE.RingGeometry(9, 10.2, 48, 1, -Math.PI / 2 - 0.5, 1.0), new THREE.MeshBasicMaterial({ color: 0xe9ede6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    pro.position.set(0, YS, -0.4); g.add(pro);
    // 摆（悬点为原点，绕 z 轴转动）
    this.arm = new THREE.Group(); this.arm.position.set(0, YS, 0); g.add(this.arm);
    this.string = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), MAT.paint(0xe7e5e4), 0, -0.5, 0); this.arm.add(this.string);
    this.ballM = mesh(new THREE.SphereGeometry(this.dBall / 20, 28, 20), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.92, roughness: 0.18 }), 0, 0, 0);
    this.arm.add(this.ballM);
    // 底座上的平衡位置标记（竖直细杆）
    g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 14, 8), MAT.paint(0xb91c1c), 0, 9.4, -6));
    app.addComponent(new Component({
      key: 'stand', name: '单摆', zone: 'none', fixed: true, required: true, object: g, labelY: YS + 10,
      icon: SVG('<path d="M32 4v26" stroke="currentColor" stroke-width="1.5"/><circle cx="32" cy="32" r="5" fill="currentColor"/>'),
      desc: '细线一端夹在支架顶部的夹线器中（悬点），下端挂钢质摆球。松开夹线器可以改变摆线长度。悬点下方有量角器，用来估计释放时的摆角。',
      controls: () => [
        { type: 'knob', label: '摆线长度（松开夹子拉线）', get: () => this.l, set: (v) => this.setLength(v), min: 40, max: 112, step: 0.1, bigStep: 5, perRev: 10, fmt: () => '拉线调长短' },
        { type: 'knob', label: '释放摆角', get: () => this.amp0, set: (v) => (this.amp0 = clamp(Math.round(v * 2) / 2, 1, 20)), min: 1, max: 20, step: 0.5, bigStep: 2, perRev: 10, digits: 1, unit: '°', sub: '看量角器估计；小角近似要求 θ < 5°' },
        { type: 'button', label: '拉开摆球后释放', onClick: () => this.release() },
        { type: 'button', label: '用手止住摆球', onClick: () => this.stopBall() },
      ],
    }));
    // 游标卡尺、米尺：从器材柜拿出来。卡尺拖到摆球上就是夹住摆球，米尺拖到悬点旁就是挂好量摆线长
    const cal = new THREE.Group();
    cal.add(mesh(new THREE.BoxGeometry(20, 0.25, 1.6), MAT.chrome(), 4, 0, 0));
    cal.add(mesh(new THREE.BoxGeometry(0.8, 0.25, 3.6), MAT.chrome(), -1.4, 0, -1.6));
    cal.add(mesh(new THREE.BoxGeometry(3, 0.4, 2), MAT.alu(), 2.6, 0.05, 0));
    cal.add(mesh(new THREE.BoxGeometry(0.8, 0.25, 3.6), MAT.chrome(), 1.4, 0, -1.6));
    app.addSlot({ id: 'calRest', pos: new THREE.Vector3(30, 2.55, 22), accepts: ['cal'], label: '台面', r: 4, snap: 10 });
    app.addSlot({ id: 'calBall', pos: new THREE.Vector3(0, YS - this.l - this.dBall / 20, 1.6), accepts: ['cal'], label: '夹住摆球', r: 2, snap: 6 });
    app.addComponent(new Component({
      key: 'cal', name: '游标卡尺', zone: 'slot', defaultSlot: 'calRest', object: cal, labelY: 3,
      icon: SVG('<path d="M4 14h56v6H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 14V4h4v10M22 20v10h4V20" fill="none" stroke="currentColor" stroke-width="1.5"/>'),
      desc: '分度值 0.02 mm。放在台面上合拢量爪读零点；拉开尺框后拖到静止的摆球上，夹住摆球测直径。',
      controls: () => [{ type: 'readout', label: '量爪间', get: () => (this.ballIn ? '摆球' : '空着') }, ...this.cal.controls(() => app.changed())],
    }));
    const tp = new THREE.Group();
    tp.add(mesh(new THREE.BoxGeometry(2.4, 120, 0.2), MAT.paint(0xe9dfb8), 0, -60, 0));
    app.addSlot({ id: 'tapeRest', pos: new THREE.Vector3(-56, 2.55, 32), accepts: ['tape'], label: '台面', r: 4, snap: 10 });
    app.addSlot({ id: 'tapeHang', pos: new THREE.Vector3(3, YS, 1.5), accepts: ['tape'], label: '悬点旁（零点对准悬点）', r: 2.5, snap: 8 });
    app.addComponent(new Component({
      key: 'tape', name: '米尺', zone: 'slot', defaultSlot: 'tapeHang', object: tp, labelY: 2,
      icon: SVG('<rect x="6" y="15" width="52" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 15v4M20 15v6M28 15v4M36 15v6M44 15v4M52 15v6" stroke="currentColor"/>'),
      desc: '1 m 钢直尺。拖到悬点旁挂好（零点对准悬点），读球顶处的刻度得摆线长 l。',
    }));
    this.pv = app.addView({ id: 'swing', title: '摆动（正视）与秒表', w: 230, h: 300, res: 1.6 });
    this.gv = app.addView({ id: 'tool', title: '量具读数', w: 330, h: 150, res: 1.8 });
  }
  update() {
    const L = this.l + this.dBall / 20;
    this.string.scale.y = this.l; this.string.position.y = -this.l / 2;
    this.ballM.position.y = -L;
    this.arm.rotation.z = this.p.th;
    // 米尺平放在台面上；卡尺夹摆球的位置跟着摆长走
    const tc = this.app.comp('tape'); if (tc && tc.placed) tc.root.rotation.z = this.app.slotOf('tape') === 'tapeRest' ? Math.PI / 2 : 0;
    const zb = this.app.zones.find((q) => q.id === 'calBall');
    if (zb) { zb.pos.set(0, YS - L, 1.6); zb.marker && zb.marker.position.set(0, YS - L + 0.15, 1.6); if (this.ballIn && !(this.app.drag && this.app.drag.comp === zb.occupant)) zb.occupant.root.position.copy(zb.pos); }
    this.drawSwing(); this.drawTool();
  }
  drawSwing() {
    const v = this.pv, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    const top = H * 0.05, len = H * 0.62, cx = W / 2;
    // 量角器
    g.strokeStyle = 'rgba(233,237,230,.6)'; g.lineWidth = 1; g.fillStyle = '#c9ced3'; g.font = `${H * 0.03}px "IBM Plex Mono"`; g.textAlign = 'center';
    for (let k = -20; k <= 20; k++) {
      const a = k * D2R * 1, r1 = len * 0.42, r2 = r1 + (k % 5 === 0 ? 9 : 5);
      g.beginPath(); g.moveTo(cx + r1 * Math.sin(a), top + r1 * Math.cos(a)); g.lineTo(cx + r2 * Math.sin(a), top + r2 * Math.cos(a)); g.stroke();
      if (k % 5 === 0 && k) g.fillText(String(Math.abs(k)), cx + (r2 + 8) * Math.sin(a), top + (r2 + 8) * Math.cos(a) + 3);
    }
    g.strokeStyle = '#b91c1c'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(cx, top); g.lineTo(cx, top + len + 14); g.stroke(); g.setLineDash([]);
    // 摆（角度按比例画出）
    const th = this.p.th, bx = cx + len * Math.sin(th), by = top + len * Math.cos(th);
    g.strokeStyle = '#e7e5e4'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx, top); g.lineTo(bx, by); g.stroke();
    g.fillStyle = '#cfd6dd'; g.beginPath(); g.arc(bx, by, H * 0.03, 0, 7); g.fill();
    g.fillStyle = '#5b6470'; g.fillRect(cx - 8, top - 6, 16, 6);
    this.sw.draw(g, W * 0.08, H * 0.8, W * 0.84, H * 0.13);
    let foot;
    if (this.sw.run) foot = `计时中：已经过最低点（同方向）${this.counted || 0} 次`;
    else if (this.moving) foot = `摆动中，振幅约 ${(this.p.amp / D2R).toFixed(1)}°；摆球经过最低点时按表`;
    else foot = '摆球静止。拉开一个小角度后释放';
    v.foot(foot);
  }
  /** 自动操作：拿起某件量具（米尺挂到悬点旁，卡尺拿到台上） */
  setTool(t) {
    const a = this.app;
    if (t === 'l' && !this.tapeOn) { const c = a.comp('tape'); if (c.placed) a.moveSlot(c, 'tapeHang', { silent: true }); else a.place(c, { slot: 'tapeHang', silent: true }); }
    if (t === 'd' && !a.comp('cal').placed) a.place(a.comp('cal'), { slot: 'calRest', silent: true });
    this.tool = t;
    if (t === 'l') this.tape.measure(this.l, { sigma: 0.04 });
    else this.cal.setObject(this.ballIn ? this.dBall : null);
  }
  drawTool() {
    const v = this.gv, g = v.ctx, W = v.W, H = v.H, o = { assist: this.assist };
    const has = this.tool === 'l' ? this.tapeOn : this.app.comp('cal').placed;
    if (!has) { g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H); v.foot(this.tool === 'l' ? '米尺还没挂好：从器材柜拖到悬点旁' : '台上还没有游标卡尺：从器材柜拿出来'); return; }
    if (this.tool === 'l') { if (Math.abs(this.tape.value - this.l) > 1e-9) this.tape.measure(this.l, { sigma: 0.04 }); this.tape.draw(g, W, H, { ...o, mark: '球顶' }); v.foot('米尺：零点对准悬点（夹线器下沿），读球顶处的刻度'); return; }
    this.cal.draw(g, W, H, o);
    const p = this.cal.problem();
    v.foot(`游标卡尺：${this.ballIn ? '夹住摆球' : '两量爪合拢读零点'}${p ? ' —— ' + p : ''}`);
  }
  globalControls() {
    const a = this.app, rer = () => { a.renderInspector(); a.changed(); };
    const out = [
      { type: 'button', label: this.sw.run ? '秒表：停止' : '秒表：开始', onClick: () => { if (this.sw.run) this.swStop(); else this.swStart(); rer(); } },
      { type: 'button', label: '秒表：清零', onClick: () => { this.sw.reset(); a.changed(); } },
      { type: 'readout', label: '读数窗', get: () => (this.tool === 'l' ? '米尺（单击仪器切换）' : '游标卡尺（单击仪器切换）') },
    ];
    if (this.tool === 'l' && this.tapeOn) out.push({ type: 'button', label: '米尺重新对一次零点再读', onClick: () => { this.tape.measure(this.l, { sigma: 0.04 }); a.changed(); } });
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
        id: 'ball', title: '摆球直径', fixedRows: true,
        initRows: () => [{ k: 'z', what: '卡尺零点' }, { k: 1, what: '第 1 次' }, { k: 2, what: '第 2 次' }, { k: 3, what: '第 3 次' }],
        columns: [
          { key: 'what', label: '', type: 'text', readonly: true },
          { key: 'r', label: '卡尺读数/mm', digits: 2, readTol: 0.011 },
          { key: 'd', label: '直径 d/mm', digits: 2, calc: (r, i, rows) => (r.k === 'z' ? NaN : r.r - rows[0].r) },
        ],
        buttons: [{ label: '记录卡尺读数', onClick: (t) => this.recD(t) }],
        note: '先合拢量爪读零点，再在摆球不同方向上测三次直径。',
      },
      {
        id: 'per', title: '摆长与周期', maxRows: 8,
        columns: [
          { key: 'l', label: '摆线长 l/cm', digits: 2, readTol: 0.06 },
          { key: 't', label: `${NP}T/s`, digits: 2, readTol: 0.011 },
          { key: 'L', label: '摆长 L/cm', digits: 2, calc: (r) => r.l + this.dMean() / 20 },
          { key: 'T', label: '周期 T/s', digits: 4, calc: (r) => r.t / NP },
          { key: 'T2', label: 'T²/s²', digits: 4, calc: (r) => (r.t / NP) ** 2 },
        ],
        buttons: [{ label: '记录摆线长（新的一行）', onClick: (t) => this.recL(t) }, { label: '记录秒表读数', onClick: (t) => this.recT(t, 'per') }],
        note: `每改一次摆长：先用米尺量摆线长 l，再让摆角小于 5° 摆动，测 ${NP} 次全振动的时间。摆长 L = l + d/2。至少测 5 个摆长，范围尽量大。`,
      },
      {
        id: 'amp', title: '摆角的影响（选做）', maxRows: 6,
        columns: [
          { key: 'a', label: '释放摆角 θ₀/°', digits: 1, readTol: 0.6 },
          { key: 't', label: `${NP}T/s`, digits: 2, readTol: 0.011 },
          { key: 'T', label: '周期 T/s', digits: 4, calc: (r) => r.t / NP },
        ],
        buttons: [{ label: '记录摆角与秒表读数', onClick: (t) => this.recT(t, 'amp') }],
        note: '摆长不变，分别从 3°、10°、15°、20° 左右释放，测周期，看大摆角时周期变长多少。',
      },
    ];
  }
  dMean() {
    const rows = this.app.table('ball').rows, z = +rows[0].r;
    const ds = rows.slice(1).map((r) => r.r - z).filter((x) => isFinite(x) && x > 0);
    return ds.length ? mean(ds) : 20;
  }
  recD(t) {
    const a = this.app;
    if (!a.comp('cal').placed) return a.toast('台上还没有游标卡尺', 'warn');
    if (this.tool !== 'd') this.tool = 'd';
    const p = this.cal.problem();
    if (p) a.toast(p, 'warn');
    let i = 0;
    if (this.ballIn) { i = t.rows.findIndex((r, k) => k > 0 && (r.r == null || r.r === '')); if (i < 0) i = 3; }
    t.set(i, 'r', Math.round((this.cal.reading + (this.ballIn ? gauss(0.004) : 0)) / 0.02) * 0.02);
  }
  recL(t) {
    const a = this.app;
    if (!this.tapeOn) return a.toast('米尺还没挂到悬点旁', 'warn');
    if (this.tool !== 'l') this.tool = 'l';
    if (this.moving) a.toast('摆还在摆动，量摆线长前应先让它静止', 'warn');
    t.addRow({ l: Math.round(this.tape.reading * 100) / 100 });
  }
  recT(t, kind) {
    const a = this.app, si = this.startInfo;
    if (this.sw.run) a.toast('秒表还在走', 'warn');
    if (!(this.sw.value > 0) || !si) return a.toast('秒表读数为零：先计时', 'warn');
    if (si.phase > 0.06 || (this.stopPhase ?? 0) > 0.06) a.toast('开表或停表时摆球不在最低点附近，计时误差大（应在摆球经过最低点时按表）', 'warn');
    if (kind === 'per') {
      if (si.amp > 5.5) a.toast(`开始计时时摆角约 ${si.amp.toFixed(1)}°，超过 5°：周期比小角公式偏大`, 'warn');
      let i = -1;
      for (let k = t.rows.length - 1; k >= 0; k--) if (t.rows[k].t == null || t.rows[k].t === '') { i = k; break; }
      if (i < 0) return a.toast('先记录这一组的摆线长（新的一行），再记录时间', 'warn');
      if (Math.abs(t.rows[i].l - si.l) > 0.5) a.toast('这一行的摆线长和计时时的摆长不一样：改摆长后要重新量', 'warn');
      t.set(i, 't', this.sw.value);
    } else {
      t.addRow({ a: Math.round(si.amp * 2) / 2, t: this.sw.value });
    }
  }

  // ======================= 自动操作 =======================
  async knob(get, set, to, ms = 400) { await this.app.tween(get, set, to, ms); set(to); this.app.changed(); }
  async timeOnce(table, btn) {
    const a = this.app;
    if (this.ballIn) this.setBallIn(false);
    this.release(); await a.wait(600);
    this.sw.reset(); this.auto = { phase: 'arm', N: NP };
    if (!(await a.until(() => !this.auto))) { this.auto = null; return; }
    await a.record(table, btn);
    this.stopBall();
  }
  async measureLength(l) {
    const a = this.app;
    a.select(a.comp('stand'));
    this.stopBall();
    await this.knob(() => this.l, (v) => this.setLength(v), l, 600);
    this.amp0 = 3.5; this.setTool('l'); a.renderInspector(); a.changed();
    await a.wait(300);
    await a.record('per', 0);
    await this.timeOnce('per', 1);
  }
  steps() {
    const app = this.app, has = (r, k) => r[k] != null && r[k] !== '' && isFinite(r[k]);
    const perRows = () => app.table('per').rows.filter((r) => has(r, 'l') && has(r, 't'));
    return [
      {
        title: '用游标卡尺测摆球直径',
        html: '<p>从器材柜拿出游标卡尺，先合拢量爪读零点；再拉开尺框，<b>把卡尺拖到静止的摆球上</b>夹住摆球，在不同方向上测三次直径。</p>',
        check: () => app.table('ball').rows.every((r) => has(r, 'r')),
        auto: async () => {
          app.showTable(0); this.setTool('d'); this.setBallIn(false); app.renderInspector();
          await this.knob(() => this.cal.open, (v) => this.cal.push(v), 0);
          await app.record('ball', 0);
          this.cal.open = this.dBall + 5; this.setBallIn(true); app.renderInspector();
          for (let k = 0; k < 3; k++) { this.cal.open = this.dBall + 5; await this.knob(() => this.cal.open, (v) => this.cal.push(v), this.dBall - 1, 300); await app.record('ball', 0); }
        },
      },
      {
        title: `测一个摆长下的周期`,
        html: `<p>把摆线长调到 100 cm 左右，用米尺量悬点到球顶的距离 l。把摆球拉开不到 5° 释放，等摆动稳定后，在摆球经过最低点时开表，数 ${NP} 次全振动后停表。</p>`,
        hint: '在最低点按表：摆球在最低点速度最大，经过的时刻最容易判准；在端点按表，判断误差大得多。',
        check: () => perRows().length >= 1,
        auto: async () => { app.showTable(1); await app.view('全景'); await this.measureLength(100); },
      },
      {
        title: '改变摆长，测 5 组以上',
        html: '<p>摆线长在 50–110 cm 之间取 5 个以上的值（间隔尽量均匀），每个摆长都测 l 和 30 个周期的时间。</p>',
        status: () => { const rs = perRows(); const ls = rs.map((r) => r.l); return `已测 ${rs.length} 组${rs.length ? `，摆线长 ${Math.min(...ls).toFixed(1)}–${Math.max(...ls).toFixed(1)} cm` : ''}`; },
        check: () => { const ls = perRows().map((r) => r.l); return ls.length >= 5 && Math.max(...ls) - Math.min(...ls) >= 30; },
        diagnose: () => {
          const ls = perRows().map((r) => r.l), out = [];
          if (ls.length >= 5 && Math.max(...ls) - Math.min(...ls) < 30) out.push({ msg: `已经测了 ${ls.length} 组，但摆长只差 ${(Math.max(...ls) - Math.min(...ls)).toFixed(1)} cm。摆长范围太小，T²–L 直线的斜率误差大；再测一个 60 cm 以下或 100 cm 以上的。` });
          const pend = app.table('per').rows.filter((r) => has(r, 'l') && !has(r, 't'));
          if (pend.length) out.push({ msg: '最后一行只有摆线长、还没有时间：释放摆球，计时后点“记录秒表读数”。' });
          return out;
        },
        auto: async () => {
          app.showTable(1);
          const done = perRows().map((r) => r.l);
          for (const L of [55, 70, 85, 110, 100]) { if (perRows().length >= 5 && Math.max(...perRows().map((r) => r.l)) - Math.min(...perRows().map((r) => r.l)) >= 30) break; if (done.some((x) => Math.abs(x - L) < 3)) continue; await this.measureLength(L); }
        },
      },
      {
        title: '观察摆角对周期的影响（选做）', optional: true,
        html: '<p>摆长不变，分别从约 3°、10°、15°、20° 释放，测 30 个周期的时间，与 $T=T_0(1+\\theta_0^2/16)$ 比较。</p>',
        check: () => app.table('amp').rows.filter((r) => has(r, 't')).length >= 3,
        auto: async () => {
          app.showTable(2); app.select(app.comp('stand'));
          for (const a0 of [3, 10, 15, 20]) { this.amp0 = a0; app.renderInspector(); await this.timeOnce('amp', 0); }
        },
      },
      {
        title: '数据处理',
        html: '<p>作 $T^2$–$L$ 图，用最小二乘法求斜率 $k$，由 $g=4\\pi^2/k$ 求重力加速度，并评定不确定度。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, has = (r, k) => r[k] != null && r[k] !== '' && isFinite(r[k]);
    const br = a.table('ball').rows;
    if (!has(br[0], 'r') || !br.slice(1).some((r) => has(r, 'r'))) return { html: '<p>请先测摆球直径（含零点）。</p>', ok: false };
    const ds = br.slice(1).filter((r) => has(r, 'r')).map((r) => r.r - br[0].r), d = mean(ds);
    const rows = a.table('per').rows.filter((r) => has(r, 'l') && has(r, 't') && r.t > 0);
    if (rows.length < 3) return { html: '<p>至少需要 3 个摆长的数据（建议 5 个以上）。</p>', ok: false };
    const L = rows.map((r) => (r.l + d / 20) / 100), T = rows.map((r) => r.t / NP), T2 = T.map((x) => x * x);
    const f = linFit(L, T2), g = (4 * Math.PI ** 2) / f.k, ug = (g * f.uk) / f.k;
    const gi = L.map((x, i) => (4 * Math.PI ** 2 * x) / T2[i]);
    let html = `<h3>1. 摆球直径</h3><p>零点 ${(+br[0].r).toFixed(2)} mm，直径 ${ds.map((x) => x.toFixed(2)).join('、')} mm，平均 $\\bar d$ = ${d.toFixed(3)} mm。</p>
      <h3>2. 各摆长的周期</h3><table><tr><th>l/cm</th><th>L=l+d/2 /cm</th><th>${NP}T/s</th><th>T/s</th><th>T²/s²</th><th>4π²L/T² /(m/s²)</th></tr>
      ${rows.map((r, i) => `<tr><td>${r.l.toFixed(2)}</td><td>${(L[i] * 100).toFixed(2)}</td><td>${r.t.toFixed(2)}</td><td>${T[i].toFixed(4)}</td><td>${T2[i].toFixed(4)}</td><td>${gi[i].toFixed(3)}</td></tr>`).join('')}</table>
      <h3>3. 作图法（最小二乘）</h3><p>拟合 $T^2=kL+b$：$k$ = ${f.k.toFixed(4)} s²/m（$u_k$ = ${f.uk.toFixed(4)}），$b$ = ${f.b.toFixed(4)} s²，相关系数 $r$ = ${f.r.toFixed(6)}。截距应接近 0；不为 0 说明摆长的测量有系统误差（比如悬点位置没找准），而斜率不受这种误差影响——这正是作图法的好处。</p>
      <div class="result-box">$g=4\\pi^2/k=${fmtU(g, ug)}$ m/s²</div>`;
    const answers = [{ label: '$g$', unit: 'm/s²', value: g, digits: 3, tolRel: 0.003 }];
    const ar = a.table('amp').rows.filter((r) => has(r, 'a') && has(r, 't'));
    if (ar.length >= 2) {
      const base = ar.reduce((m, r) => (r.a < m.a ? r : m), ar[0]), T0 = base.t / NP / (1 + (base.a * D2R) ** 2 / 16);
      html += `<h3>4. 摆角的影响</h3><table><tr><th>θ₀/°</th><th>T/s</th><th>T/T₀（实测）</th><th>1+θ₀²/16</th><th>精确值</th></tr>
        ${ar.map((r) => { const th = r.a * D2R; return `<tr><td>${r.a.toFixed(1)}</td><td>${(r.t / NP).toFixed(4)}</td><td>${(r.t / NP / T0).toFixed(4)}</td><td>${(1 + th * th / 16).toFixed(4)}</td><td>${(periodExact(1, 1, th) / (2 * Math.PI)).toFixed(4)}</td></tr>`; }).join('')}</table>
        <p>摆角 5° 时周期只比小角公式大 0.05%，20° 时大约 0.8%。振幅在计时过程中因空气阻尼慢慢减小，表中摆角取释放时的值，所以实测的增大量略小于公式值。</p>`;
    }
    html += `<div class="result-box warn">本地重力加速度参考值 ${this.g.toFixed(4)} m/s²，测量值相对误差 ${pct(relErr(g, this.g), 2)}。</div>`;
    return { html, ok: true, answers, plots: [{ title: 'T²–L 图线', xLabel: 'L / m', yLabel: 'T² / s²', series: [{ type: 'scatter', data: L.map((x, i) => [x, T2[i]]), label: '实验点' }, { type: 'line', data: [[Math.min(...L) - 0.05, f.k * (Math.min(...L) - 0.05) + f.b], [Math.max(...L) + 0.05, f.k * (Math.max(...L) + 0.05) + f.b]], label: '最小二乘直线' }] }] };
  }

  principle() {
    return `<h3>1. 单摆的周期</h3>${pendulumFig()}<p>质量集中在摆球、摆线质量和伸长都可忽略时，摆角很小（$\\sin\\theta\\approx\\theta$）的单摆作简谐振动，周期</p>$$T=2\\pi\\sqrt{\\frac Lg}\\qquad\\Rightarrow\\qquad g=\\frac{4\\pi^2L}{T^2}$$<p>$L$ 是悬点到球心的距离：摆线长 $l$ 加上摆球半径 $d/2$。</p>
<h3>2. 作 $T^2$–$L$ 图</h3><p>改变摆长测多组 $T$，$T^2$ 与 $L$ 成正比，斜率 $k=4\\pi^2/g$。用斜率求 $g$，可以消除摆长中某个固定的系统误差（如悬点位置找得不准），也能用多组数据减小随机误差。</p>
<h3>3. 有限摆角的修正</h3><p>摆角 $\\theta_0$ 不是很小时，周期变长：</p>$$T=T_0\\left(1+\\frac{\\theta_0^2}{16}+\\frac{11\\theta_0^4}{3072}+\\cdots\\right)$$<p>$\\theta_0=5°$ 时修正约 0.05%，比计时误差小，所以要求摆角小于 5°。</p>
<h3>4. 计时</h3><p>测 $n=${NP}$ 次全振动的总时间再除以 $n$（累积放大法），人按秒表的误差（约 0.1 s）就被分摊到每个周期上。摆球经过最低点时速度最大，在这里开表、停表最准。</p>
<h3>5. 本仿真的计算模型</h3><p>摆的运动按非线性方程 $\\ddot\\theta=-(g/L_{eq})\\sin\\theta-\\gamma\\dot\\theta$ 用四阶龙格–库塔法积分：摆球按刚体处理，等效摆长 $L_{eq}=L+\\frac{2r^2}{5L}$；空气阻尼使振幅每分钟减小约 10%。有限振幅的周期与椭圆积分的精确值（用算术–几何平均算出）一致。秒表的起停时刻由你决定，人的反应时间按 ±0.035 s 计入。</p>`;
  }
}
