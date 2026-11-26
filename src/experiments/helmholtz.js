// 实验：圆线圈与亥姆霍兹线圈的磁场（霍尔探头特斯拉计 · 轴线磁场分布 · 叠加原理 · 线圈间距）
// 磁场用 src/physics/loopfield.js（移植自 Magpylib 的电流环精确解）计算，绕组按有限宽度分层叠加；
// 线圈中的电流由直流电路求解得到（含方向），所以接反、只接一个线圈都会如实反映在磁场上。
import * as THREE from 'three';
import { meta, thumb } from './helmholtz.meta.js';
import { Circuit, benchTable, panelMesh } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, canvasTexture } from '../core/Models.js';
import { coilsB, MU0 } from '../physics/loopfield.js';
import { mean, rand, relErr, pct, clamp, gauss } from '../core/Stats.js';
import { helmholtzFig } from './circuitFigs.js';

const R = 0.100; // 线圈平均半径 m（铭牌）
const N = 500; // 每个线圈的匝数
const W = 0.016; // 绕组轴向宽度 m
const RC = 24; // 线圈电阻 Ω
const SPACINGS = { half: 0.05, one: 0.1, two: 0.2 };
const SP_LABEL = { half: 'd = R/2', one: 'd = R', two: 'd = 2R' };

const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

/** 线圈架：两个同轴线圈 + 探头导轨与标尺 */
function coilStand({ key = 'coils', defaultSlot, Rtrue }) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(64, 2, 34), MAT.paint(0xd8d2c4), 0, 1, 0));
  const AX = 16; // 轴线高度
  // 标尺（沿轴线，正下方的底板上）
  const ruler = panelMesh(44, 3, (c, w, h) => {
    c.fillStyle = '#efe6cf'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#222'; c.fillStyle = '#222';
    for (let i = 0; i <= 440; i++) {
      const x = (i / 440) * (w - 2) + 1, l = i % 10 === 0 ? 0.55 : i % 5 === 0 ? 0.38 : 0.22;
      c.lineWidth = i % 10 === 0 ? 1.4 : 0.8; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h * l); c.stroke();
      if (i % 20 === 0) { c.font = `bold ${h * 0.3}px Arial`; c.textAlign = 'center'; c.fillText(String((i - 220) / 10), clamp(x, 12, w - 12), h * 0.86); }
    }
  }, 40);
  ruler.rotation.x = -Math.PI / 2; ruler.position.set(0, 2.03, 9); g.add(ruler);
  // 导轨与探头
  g.add(mesh(new THREE.BoxGeometry(48, 0.6, 0.6), MAT.alu(), 0, AX - 1.4, 0));
  for (const x of [-24, 24]) g.add(mesh(new THREE.BoxGeometry(1, AX - 1.4, 1), MAT.alu(), x, (AX - 1.4) / 2 + 1, 0));
  const probe = new THREE.Group();
  probe.add(mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), MAT.black(), 0, AX - 1.4, 0));
  probe.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 8), MAT.paint(0x6b7280), 0, AX - 0.4, 0));
  probe.add(mesh(new THREE.BoxGeometry(0.5, 0.15, 0.5), MAT.paint(0x2f6b3a), 0, AX + 0.3, 0));
  const ptr = mesh(new THREE.BoxGeometry(0.12, 0.08, 9), MAT.paint(0xc41e3a), 0, 2.2, 4.6); probe.add(ptr);
  probe.add(mesh(new THREE.BoxGeometry(0.4, AX - 3, 0.4), MAT.paint(0x6b7280), 0, (AX - 1.4) / 2 + 0.6, 0.4));
  g.add(probe);
  // 线圈
  const copper = new THREE.MeshStandardMaterial({ color: 0xb86b2b, metalness: 0.65, roughness: 0.42 });
  const frameM = MAT.paint(0x374151);
  const coils = [0, 1].map((i) => {
    const c = new THREE.Group();
    const ring = mesh(new THREE.TorusGeometry(Rtrue * 100, 0.9, 12, 64), copper, 0, AX, 0); ring.rotation.y = Math.PI / 2; ring.scale.set(1, 1, 1.0); c.add(ring);
    const rim = mesh(new THREE.CylinderGeometry(Rtrue * 100 + 1.1, Rtrue * 100 + 1.1, 2.0, 64, 1, true), frameM, 0, AX, 0); rim.rotation.z = Math.PI / 2; c.add(rim);
    c.add(mesh(new THREE.BoxGeometry(2.2, AX - Rtrue * 100 - 1, 4), frameM, 0, (AX - Rtrue * 100 - 1) / 2 + 2, 0));
    c.add(mesh(new THREE.BoxGeometry(4, 1, 12), frameM, 0, 2.5, -2));
    const lab = panelMesh(4, 2, (cx, w, h) => { cx.fillStyle = '#374151'; cx.fillRect(0, 0, w, h); cx.fillStyle = '#f3f4f6'; cx.font = `bold ${h * 0.5}px "Microsoft YaHei"`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(`线圈${i + 1}`, w / 2, h / 2); });
    lab.rotation.x = -Math.PI / 2; lab.position.set(0, 3.02, -6); c.add(lab);
    g.add(c); return c;
  });
  const term = (i, s) => new THREE.Vector3(0, 3, s === 'a' ? -9 : -4.5);
  const dev = {
    key, short: '线圈架', sp: 'one', x: 0, Rtrue,
    terms: {
      'c1a': { pos: term(0, 'a'), label: '线圈1 a', color: 0xb91c1c }, 'c1b': { pos: term(0, 'b'), label: '线圈1 b', color: 0x1b1b1b },
      'c2a': { pos: term(1, 'a'), label: '线圈2 a', color: 0xb91c1c }, 'c2b': { pos: term(1, 'b'), label: '线圈2 b', color: 0x1b1b1b },
    },
    elements(t) { return [{ type: 'R', a: t('c1a'), b: t('c1b'), R: RC, tag: 'L1' }, { type: 'R', a: t('c2a'), b: t('c2b'), R: RC * 1.01, tag: 'L2' }]; },
    after(sol, t, els) {
      this.I1 = sol.cur(els.find((e) => e.tag === 'L1')); this.I2 = sol.cur(els.find((e) => e.tag === 'L2'));
      this.place();
    },
    place() {
      probe.position.x = this.x * 100;
      if (this._sp === this.sp && this._nw === (this._cir ? this._cir.wires.length : 0)) return;
      this._sp = this.sp;
      const d = SPACINGS[this.sp] * 100;
      coils[0].position.x = -d / 2; coils[1].position.x = d / 2;
      for (const [i, k] of [[0, 'c1'], [1, 'c2']]) for (const s of ['a', 'b']) { const o = this.termObjs && this.termObjs[k + s]; if (o) { o.position.x = i ? d / 2 : -d / 2; o.position.z = s === 'a' ? -9 : -5.5; } }
      // 线圈移动后，接在线圈上的导线跟着重画
      const cir = this._cir;
      if (cir) {
        this._nw = cir.wires.length;
        cir.wires.forEach((w) => { if (/^coils:/.test(w.a) || /^coils:/.test(w.b)) { cir.group.remove(w.mesh); w.mesh.traverse((o) => o.geometry && o.geometry.dispose()); cir.buildWire(w); } });
      }
    },
    bindCircuit(cir) { this._cir = cir; },
  };
  dev.comp = new Component({
    key, name: '亥姆霍兹线圈架', icon: SVG('<ellipse cx="24" cy="20" rx="5" ry="15" fill="none" stroke="#b86b2b" stroke-width="3"/><ellipse cx="40" cy="20" rx="5" ry="15" fill="none" stroke="#b86b2b" stroke-width="3"/><path d="M4 20h56" stroke="currentColor" stroke-width="1.2"/>'),
    zone: 'slot', defaultSlot, object: g, labelY: 30,
    desc: `两个相同的圆线圈，平均半径 R = ${(R * 1000).toFixed(0)} mm，各 ${N} 匝，同轴放置，间距可选 R/2、R、2R（两线圈对称地位于标尺零点两侧）。霍尔探头装在沿轴线移动的滑座上，位置由底板标尺读出（零点在两线圈的正中间）。电流从 a 端流入时，线圈产生的磁场沿 +x 方向（向右）。`,
    controls: () => [
      { type: 'segment', label: '两线圈间距', get: () => dev.sp, set: (v) => { dev.sp = v; }, options: Object.keys(SPACINGS).map((k) => ({ label: SP_LABEL[k], value: k })) },
      { type: 'knob', label: '探头位置 x', get: () => dev.x * 1000, set: (v) => (dev.x = clamp(Math.round(v), -200, 200) / 1000), min: -200, max: 200, step: 1, bigStep: 10, perRev: 50, digits: 0, unit: 'mm' },
    ],
  });
  return dev;
}

/** 恒流源：0–0.500 A，输出电压上限 30 V */
function ccSource({ key = 'src', defaultSlot }) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(18, 9, 14), MAT.paint(0xc9c4b8), 0, 4.5, 0));
  const cv = document.createElement('canvas'); cv.width = 432; cv.height = 216;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(17, 8.4), new THREE.MeshBasicMaterial({ map: tex })); face.position.set(0, 4.5, 7.02); face.userData.noHL = true; g.add(face);
  const knob = mesh(new THREE.CylinderGeometry(1.1, 1.2, 1.2, 20), MAT.black(), 4.5, 2.2, 7.6); knob.rotation.x = Math.PI / 2; g.add(knob);
  const err = 1 + rand(-0.002, 0.002);
  const dev = {
    key, short: '恒流源', on: false, Iset: 0, iout: 0, cv: false,
    /** 电流表示数（含示值误差，A） */
    shownI() { return this.on ? Math.round((this.iout / err) * 1000) / 1000 : 0; },
    terms: { '+': { pos: new THREE.Vector3(-6, 0, 7.4), label: '+' }, '-': { pos: new THREE.Vector3(-3, 0, 7.4), label: '−', color: 0x1b1b1b } },
    elements(t) { return this.on ? [{ type: 'V', a: t('+'), b: t('-'), E: 30, r: 0.01, ilim: Math.max(1e-6, this.Iset * err), tag: 'v' }] : []; },
    after(sol, t, els) {
      const e = els.find((x) => x.tag === 'v');
      this.iout = e ? (e.cc ? Math.abs(e.I) : Math.abs(sol.cur(e))) : 0; this.cv = !!(e && !e.cc && this.Iset > 0.001);
      knob.rotation.y = -this.Iset * 10; draw();
    },
  };
  let last = '';
  const draw = () => {
    const txt = dev.on ? (dev.iout / err).toFixed(3) : '', sig = txt + dev.cv;
    if (sig === last) return; last = sig;
    const c = cv.getContext('2d');
    c.fillStyle = '#c9c4b8'; c.fillRect(0, 0, 432, 216);
    c.fillStyle = '#1f2937'; c.font = 'bold 22px "Microsoft YaHei"'; c.fillText('直流恒流源 0–0.5 A', 14, 30);
    c.fillStyle = '#0a1a10'; c.fillRect(14, 44, 260, 80);
    c.fillStyle = '#5eea8c'; c.font = 'bold 58px Consolas, monospace'; c.textAlign = 'right'; c.fillText(txt, 230, 106);
    c.font = 'bold 24px Consolas'; c.textAlign = 'left'; c.fillText('A', 236, 106);
    c.fillStyle = dev.cv ? '#ef4444' : '#444'; c.beginPath(); c.arc(30, 160, 8, 0, 7); c.fill();
    c.fillStyle = '#1f2937'; c.font = '17px "Microsoft YaHei"'; c.fillText('电压到限（开路）', 46, 166);
    c.fillText('电流调节', 300, 200);
    tex.needsUpdate = true;
  };
  draw();
  dev.comp = new Component({
    key, name: '直流恒流源', icon: SVG('<rect x="6" y="6" width="52" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="11" y="11" width="24" height="10" fill="none" stroke="currentColor"/><circle cx="46" cy="22" r="5" fill="none" stroke="currentColor"/>'),
    zone: 'slot', defaultSlot, object: g, labelY: 13,
    desc: '输出电流 0–0.500 A 连续可调，与负载电阻无关（输出电压上限 30 V）。外电路断开时“电压到限”灯亮。',
    controls: () => [
      { type: 'toggle', label: '输出', get: () => dev.on, set: (v) => (dev.on = v) },
      { type: 'knob', label: '电流调节', get: () => dev.Iset, set: (v) => (dev.Iset = clamp(Math.round(v * 1000) / 1000, 0, 0.5)), min: 0, max: 0.5, step: 0.001, bigStep: 0.01, perRev: 0.1, digits: 3, unit: 'A' },
      { type: 'readout', label: '电流表', get: () => (dev.on ? `${(dev.iout / err).toFixed(3)} A` : '—') },
    ],
  });
  return dev;
}

/** 霍尔探头特斯拉计：测轴向分量，分辨 0.001 mT */
function teslameter({ key = 'tm', defaultSlot }) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(16, 8, 12), MAT.paint(0x2a2f36), 0, 4, 0));
  const cv = document.createElement('canvas'); cv.width = 384; cv.height = 192;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(15, 7.5), new THREE.MeshBasicMaterial({ map: tex })); face.position.set(0, 4, 6.02); face.userData.noHL = true; g.add(face);
  const cable = mesh(new THREE.TorusGeometry(4, 0.2, 6, 24, Math.PI), MAT.black(), -9, 4, -2); cable.rotation.y = Math.PI / 2; g.add(cable);
  const dev = {
    key, short: '特斯拉计', on: true, zero: 0, raw: 0, shown: 0,
    terms: {},
    elements() { return []; },
  };
  let last = '';
  dev.draw = () => {
    const txt = dev.on ? (dev.shown < 0 ? '-' : ' ') + Math.abs(dev.shown).toFixed(3) : '';
    if (txt === last) return; last = txt;
    const c = cv.getContext('2d');
    c.fillStyle = '#2a2f36'; c.fillRect(0, 0, 384, 192);
    c.fillStyle = '#e5e7eb'; c.font = 'bold 20px "Microsoft YaHei"'; c.fillText('特斯拉计（霍尔探头）', 14, 28);
    c.fillStyle = '#120808'; c.fillRect(14, 42, 300, 84);
    c.fillStyle = '#ff5a3c'; c.font = 'bold 60px Consolas, monospace'; c.textAlign = 'right'; c.fillText(txt, 262, 106);
    c.font = 'bold 24px Consolas'; c.textAlign = 'left'; c.fillText('mT', 266, 106);
    c.fillStyle = '#e5e7eb'; c.font = '17px "Microsoft YaHei"'; c.fillText('调零', 330, 170);
    tex.needsUpdate = true;
  };
  dev.draw();
  dev.comp = new Component({
    key, name: '特斯拉计', icon: SVG('<rect x="18" y="6" width="40" height="26" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="23" y="11" width="30" height="10" fill="currentColor"/><path d="M18 26H4" stroke="currentColor" stroke-width="2"/>'),
    zone: 'slot', defaultSlot, object: g, labelY: 12,
    desc: '霍尔探头测磁感应强度沿线圈轴向的分量，量程 ±2 mT，分辨 0.001 mT。不通电流时也有读数（地磁场的分量、探头的不等位电压），测量前要在线圈断电时调零。',
    controls: () => [
      { type: 'button', label: '调零（使当前读数为 0）', onClick: () => { dev.zero = dev.raw; } },
      { type: 'readout', label: '读数', get: () => `${dev.shown.toFixed(3)} mT` },
    ],
  });
  return dev;
}

export class HelmholtzExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.Rtrue = R * (1 + rand(-0.004, 0.004));
    this.gain = 1 + rand(-0.004, 0.004);
    this.Bbg = rand(0.025, 0.045) * (Math.random() < 0.5 ? -1 : 1) + rand(-0.02, 0.02); // 地磁场轴向分量 + 探头零点，mT
  }

  cameras() {
    return [
      { name: '全景', pos: [0, 86, 90], target: [0, 6, 0] },
      { name: '线圈', pos: [-4, 40, 52], target: [-4, 14, -12] },
      { name: '标尺', pos: [-4, 30, 26], target: [-4, 2, -4] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    app.addSlot({ id: 'coils', pos: new THREE.Vector3(-4, 0, -14), accepts: ['coils'] });
    app.addSlot({ id: 'src', pos: new THREE.Vector3(-56, 0, 24), accepts: ['src'] });
    app.addSlot({ id: 'tm', pos: new THREE.Vector3(48, 0, 22), accepts: ['tm'] });
    const cir = (this.cir = new Circuit(app));
    this.coil = cir.add(coilStand({ defaultSlot: 'coils', Rtrue: this.Rtrue }));
    this.src = cir.add(ccSource({ defaultSlot: 'src' }));
    this.tm = cir.add(teslameter({ defaultSlot: 'tm' }));
    this.view = app.addView({ id: 'tm', title: '特斯拉计读数', w: 240, h: 96, res: 1 });
  }

  pointerDown(e) { return this.cir.pointerDown(e); }
  pointerMove(e) { return this.cir.pointerMove(e); }
  onRemove(c) { this.cir.removeDevice(c.key); }
  tick(dt) { this.cir.tick(dt); }

  /** 探头处的真实磁场轴向分量（mT） */
  Bx(x = this.coil.x) {
    const c = this.coil, d = SPACINGS[c.sp];
    const I1 = c.comp.placed ? c.I1 || 0 : 0, I2 = c.comp.placed ? c.I2 || 0 : 0;
    return coilsB([{ R: this.Rtrue, N, I: I1, z: -d / 2, w: W }, { R: this.Rtrue, N, I: I2, z: d / 2, w: W }], 0, 0, x)[2] * 1e3;
  }
  refresh() {
    const tm = this.tm;
    tm.raw = this.gain * this.Bx() + this.Bbg;
    tm.shown = Math.round((tm.raw - tm.zero + gauss(0.0006)) * 1000) / 1000;
    tm.draw();
    return tm.shown;
  }
  update() {
    this.cir.solve();
    const B = this.refresh();
    const v = this.view, c = v.ctx;
    c.fillStyle = '#2a2f36'; c.fillRect(0, 0, v.W, v.H);
    c.fillStyle = '#120808'; c.fillRect(12, 12, v.W - 24, v.H - 40);
    c.fillStyle = '#ff5a3c'; c.font = 'bold 34px Consolas, monospace'; c.textAlign = 'right'; c.fillText(this.tm.comp.placed ? `${B < 0 ? '-' : ' '}${Math.abs(B).toFixed(3)}` : '', v.W - 58, 52);
    c.font = 'bold 15px Consolas'; c.textAlign = 'left'; c.fillText('mT', v.W - 52, 52);
    v.foot(this.coil.comp.placed ? `探头 x = ${(this.coil.x * 1000).toFixed(0)} mm · ${SP_LABEL[this.coil.sp]} · I = ${this.src.shownI().toFixed(3)} A` : '');
  }

  /** 当前接法：'1'、'2'、'12'（同向串联）、'12r'（反向）、null */
  config() {
    const c = this.coil;
    if (!c.comp.placed || !this.src.on) return null;
    const a = Math.abs(c.I1 || 0), b = Math.abs(c.I2 || 0);
    if (a < 1e-4 && b < 1e-4) return null;
    if (b < 1e-4) return '1';
    if (a < 1e-4) return '2';
    return Math.sign(c.I1) === Math.sign(c.I2) ? '12' : '12r';
  }
  cfgName(k, sp) { return { 1: '线圈1', 2: '线圈2', 12: `双线圈 ${SP_LABEL[sp]}`, '12r': '反向串联' }[k]; }

  tables() {
    return [
      {
        id: 'axis', title: '轴线磁场', maxRows: 120,
        columns: [
          { key: 'cfg', label: '接法', type: 'text' },
          { key: 'I', label: 'I/A', digits: 3, auto: true },
          { key: 'x', label: 'x/mm', digits: 0, auto: true },
          { key: 'B', label: 'B/mT', digits: 3, readTol: 0.002 },
          { key: 'Bt', label: '理论 B/mT', digits: 3, calc: (r) => this.theory(r) },
        ],
        buttons: [{ label: '记录当前位置的 B', onClick: (t) => this.rec(t) }],
        note: '理论值按细线圈公式 $B=\\dfrac{\\mu_0NIR^2}{2(R^2+x\'^2)^{3/2}}$ 计算（x′ 为到线圈中心的距离），双线圈为两者之和。',
      },
    ];
  }
  /** 细导线圆环的理论值（教材公式），mT */
  theory(r) {
    const sp = r.sp, d = SPACINGS[sp] ?? 0.1, x = r.x / 1000, I = r.I;
    const one = (x0) => (MU0 * N * I * R * R) / (2 * Math.pow(R * R + (x - x0) ** 2, 1.5)) * 1e3;
    if (r.k === '1') return one(-d / 2);
    if (r.k === '2') return one(d / 2);
    if (r.k === '12') return one(-d / 2) + one(d / 2);
    if (r.k === '12r') return one(-d / 2) - one(d / 2);
    return NaN;
  }
  rec(t) {
    const app = this.app, k = this.config();
    if (!this.tm.comp.placed) return app.toast('特斯拉计没有放上', 'warn');
    if (!k) app.toast('线圈中没有电流（检查接线和恒流源输出）', 'warn');
    if (!this.zeroed()) app.toast('特斯拉计没有在断电时调零，读数里混有地磁场', 'warn');
    const B = this.refresh();
    t.addRow({ cfg: k ? this.cfgName(k, this.coil.sp) : '线圈中无电流', k, sp: this.coil.sp, I: this.src.shownI(), x: Math.round(this.coil.x * 1000), B });
  }
  zeroed() { return Math.abs(this.tm.zero - this.Bbg) < 0.004; }

  // ---------------- 自动操作 ----------------
  async scan(xs) {
    const app = this.app, c = this.coil;
    app.select(c.comp);
    for (const x of xs) {
      await app.tween(() => c.x * 1000, (v) => (c.x = Math.round(v) / 1000), x, 160); c.x = x / 1000; app.changed();
      await app.wait(60);
      await app.record('axis');
    }
  }
  async zeroNow() {
    const app = this.app, s = this.src;
    app.select(s.comp); s.on = false; app.changed(); await app.wait(200);
    this.cir.solve(); this.refresh();
    app.select(this.tm.comp); this.tm.zero = this.tm.raw; app.changed(); await app.wait(250);
    app.select(s.comp); s.on = true; app.changed(); await app.wait(200);
  }
  rows(k, sp) { return this.app.table('axis').completeRows().filter((r) => r.k === k && (k === '1' || k === '2' || r.sp === sp)); }

  steps() {
    const app = this.app, cir = this.cir;
    const range = (a, b, s) => { const o = []; for (let x = a; x <= b + 1e-9; x += s) o.push(x); return o; };
    return [
      {
        title: '摆放仪器，线圈 1 单独接恒流源',
        html: '<p>把线圈架、恒流源和特斯拉计放到桌上。先只把<b>线圈 1</b> 接到恒流源：+ 接 a 端，b 端接 −。</p>',
        check: () => ['coils', 'src', 'tm'].every((k) => cir.placed(k)) && (() => { const n = cir.nets(); return n('src:+') === n('coils:c1a') && n('src:-') === n('coils:c1b'); })(),
        auto: async () => { await app.view('全景'); for (const k of ['coils', 'src', 'tm']) await app.autoPlace(k); await cir.rewire([['src:+', 'coils:c1a'], ['coils:c1b', 'src:-']]); },
      },
      {
        title: '特斯拉计调零',
        html: '<p>恒流源<b>关闭</b>（线圈中无电流）时，特斯拉计仍有零点几十微特的读数——这是地磁场沿轴向的分量和探头本身的零点。按“调零”使读数为 0，然后打开恒流源，电流调到 0.200 A。</p>',
        check: () => this.zeroed() && this.src.on && Math.abs(this.src.Iset - 0.2) < 0.0015,
        auto: async () => {
          await this.zeroNow();
          const s = this.src; app.select(s.comp); await app.tween(() => s.Iset, (v) => (s.Iset = v), 0.2, 500); s.Iset = 0.2; app.changed();
        },
      },
      {
        title: '单线圈轴线磁场',
        html: '<p>间距放在 d = R（线圈 1 的中心在 x = −50 mm）。探头从 x = −150 mm 移到 +50 mm，每 10 mm 记录一次 B，与理论曲线比较。</p>',
        check: () => this.rows('1').length >= 11,
        auto: async () => { this.coil.sp = 'one'; app.changed(); await app.view('线圈'); app.showTable(0); await this.scan(range(-150, 50, 10)); },
      },
      {
        title: '线圈 2 单独通电',
        html: '<p>改接线圈 2（+ 接 a，b 接 −），重新在断电时调零，电流仍为 0.200 A。在 x = −100…+100 mm 每 20 mm 测一次，留作验证叠加原理。</p>',
        check: () => this.rows('2').length >= 6,
        auto: async () => {
          await cir.rewire([['src:+', 'coils:c2a'], ['coils:c2b', 'src:-']]);
          await this.zeroNow();
          await this.scan(range(-100, 100, 20));
        },
      },
      {
        title: '亥姆霍兹线圈（d = R）',
        html: '<p>两线圈<b>同向串联</b>：+ → 线圈1 a，线圈1 b → 线圈2 a，线圈2 b → −。间距 d = R。在 x = −100…+100 mm 每 10 mm 测一次。检查：同一点 B₁ + B₂ 是否等于两线圈同时通电时的 B？</p>',
        hint: '如果中心的磁场接近零，说明有一个线圈接反了。',
        check: () => this.rows('12', 'one').length >= 11,
        auto: async () => {
          await cir.rewire([['src:+', 'coils:c1a'], ['coils:c1b', 'coils:c2a'], ['coils:c2b', 'src:-']]);
          await this.zeroNow();
          await this.scan(range(-100, 100, 10));
        },
      },
      {
        title: '改变线圈间距',
        html: '<p>把间距改为 d = R/2 和 d = 2R，各在 x = −100…+100 mm 每 20 mm 测一次。比较三种间距下中心附近磁场的均匀程度。</p>',
        check: () => this.rows('12', 'half').length >= 6 && this.rows('12', 'two').length >= 6,
        auto: async () => {
          for (const sp of ['half', 'two']) { app.select(this.coil.comp); this.coil.sp = sp; app.changed(); await app.wait(300); await this.scan(range(-100, 100, 20)); }
          this.src.on = false; this.coil.sp = 'one'; app.changed();
        },
      },
      {
        title: '数据处理',
        html: '<p>作各种情况下的 B–x 图并与理论曲线比较；验证叠加原理；由中心磁场求 μ₀；比较亥姆霍兹线圈的均匀区。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const rows1 = this.rows('1'), rows2 = this.rows('2'), H = this.rows('12', 'one');
    if (rows1.length < 3) return { html: '<p>请先测单线圈轴线上的磁场。</p>', ok: false };
    const plots = [], answers = [];
    const curve = (k, sp, I, a, b) => { const o = []; for (let i = 0; i <= 120; i++) { const x = a + ((b - a) * i) / 120; o.push([x, this.theory({ k, sp, I, x })]); } return o; };
    const at = (rows, x) => rows.find((r) => r.x === x);
    // 单线圈
    const I1 = rows1[0].I, c1 = at(rows1, -50);
    let html = `<h3>1. 单线圈（线圈 1，I = ${I1.toFixed(3)} A）</h3>`;
    const dev1 = rows1.map((r) => (r.B - this.theory(r)) / this.theory({ k: '1', sp: 'one', I: r.I, x: -50 }));
    html += `<p>共测 ${rows1.length} 点，与细线圈理论值的偏差在中心磁场的 ${pct(Math.max(...dev1.map(Math.abs)), 1)} 以内。</p>`;
    if (c1) {
      const mu = (2 * R * c1.B * 1e-3) / (N * c1.I);
      html += `<p>线圈中心（x = −50 mm）$B_0=${c1.B.toFixed(3)}$ mT。由 $B_0=\\dfrac{\\mu_0NI}{2R}$ 得 $\\mu_0=\\dfrac{2RB_0}{NI}=${(mu * 1e7).toFixed(3)}\\times10^{-7}$ T·m/A，与 $4\\pi\\times10^{-7}=12.566\\times10^{-7}$ 相差 ${pct(relErr(mu, MU0), 2)}。</p>`;
      answers.push({ label: '$\\mu_0$（单线圈中心）', unit: '10⁻⁷ T·m/A', value: mu * 1e7, digits: 3, tolRel: 0.003 });
    }
    plots.push({ title: '单线圈轴线磁场', xLabel: 'x / mm', yLabel: 'B / mT', series: [{ type: 'line', data: curve('1', 'one', I1, Math.min(...rows1.map((r) => r.x)), Math.max(...rows1.map((r) => r.x))), dash: [5, 4] }, { type: 'scatter', data: rows1.map((r) => [r.x, r.B]) }] });
    // 叠加原理
    if (rows2.length && H.length) {
      const pts = H.map((r) => { const a = at(rows1, r.x), b = at(rows2, r.x); return a && b && Math.abs(a.I - r.I) < 0.002 && Math.abs(b.I - r.I) < 0.002 ? { x: r.x, s: a.B + b.B, B: r.B } : null; }).filter(Boolean);
      if (pts.length) {
        html += `<h3>2. 叠加原理</h3><table><tr><th>x/mm</th>${pts.map((p) => `<td>${p.x}</td>`).join('')}</tr><tr><th>B₁+B₂ /mT</th>${pts.map((p) => `<td>${p.s.toFixed(3)}</td>`).join('')}</tr><tr><th>B₁₂ /mT</th>${pts.map((p) => `<td>${p.B.toFixed(3)}</td>`).join('')}</tr></table><p>两者之差不超过 ${Math.max(...pts.map((p) => Math.abs(p.s - p.B))).toFixed(3)} mT，在读数误差范围内，验证了磁场的叠加原理。</p>`;
      }
    }
    // 亥姆霍兹
    if (H.length >= 3) {
      const c = at(H, 0);
      html += `<h3>3. 亥姆霍兹线圈（d = R）</h3>`;
      if (c) {
        const mu = (c.B * 1e-3 * R) / (Math.pow(0.8, 1.5) * N * c.I);
        const inBand = H.filter((r) => Math.abs(r.B - c.B) / c.B <= 0.01).map((r) => r.x);
        html += `<p>中心 $B_O=${c.B.toFixed(3)}$ mT，理论 $\\left(\\frac45\\right)^{3/2}\\frac{\\mu_0NI}{R}=${this.theory({ k: '12', sp: 'one', I: c.I, x: 0 }).toFixed(3)}$ mT。由此 $\\mu_0=${(mu * 1e7).toFixed(3)}\\times10^{-7}$ T·m/A。</p><p>磁场与中心值相差不超过 1% 的范围约为 x = ${Math.min(...inBand)} … ${Math.max(...inBand)} mm，约占线圈半径的 ${Math.round(((Math.max(...inBand) - Math.min(...inBand)) / 2 / (R * 1000)) * 100)}%。</p>`;
        answers.push({ label: '$\\mu_0$（亥姆霍兹中心）', unit: '10⁻⁷ T·m/A', value: mu * 1e7, digits: 3, tolRel: 0.003 });
        html += `<div class="result-box">单线圈中心 $B_0=${c1 ? c1.B.toFixed(3) : '—'}$ mT，亥姆霍兹线圈中心 $B_O=${c.B.toFixed(3)}$ mT，比值 ${c1 ? (c.B / c1.B).toFixed(3) : '—'}（理论 $2\\times(4/5)^{3/2}=1.431$）</div>`;
      }
    }
    const series = [];
    for (const sp of ['half', 'one', 'two']) {
      const rs = this.rows('12', sp);
      if (rs.length < 3) continue;
      series.push({ type: 'scatter', data: rs.map((r) => [r.x, r.B]), label: SP_LABEL[sp] });
      series.push({ type: 'line', data: curve('12', sp, rs[0].I, -100, 100), dash: [5, 4] });
    }
    if (series.length) {
      plots.push({ title: '两线圈同向串联：不同间距下的轴线磁场', xLabel: 'x / mm', yLabel: 'B / mT', series });
      html += `<h3>4. 线圈间距的影响</h3><p>d = R/2 时中心处磁场最强但向两侧单调下降（中心是极大值）；d = 2R 时中心出现凹陷（中心是极小值）；d = R 时中心处 $\\mathrm{d}^2B/\\mathrm{d}x^2=0$，中心附近最均匀。</p>`;
    }
    const tail = [`线圈实际平均半径 ${(this.Rtrue * 1000).toFixed(2)} mm（铭牌 ${(R * 1000).toFixed(0)} mm），绕组宽 ${(W * 1000).toFixed(0)} mm；特斯拉计示值误差 ${pct(this.gain - 1, 2)}`];
    if (c1) tail.push(`μ₀ 测量值相对误差 ${pct(relErr((2 * R * c1.B * 1e-3) / (N * c1.I), MU0), 2)}`);
    html += `<div class="result-box warn">${tail.join('；')}。细线圈公式忽略了绕组的截面尺寸，也是理论与实测之间微小差别的来源。</div>`;
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 圆电流轴线上的磁场</h3><p>由毕奥–萨伐尔定律，半径 R、N 匝、电流 I 的圆线圈在轴线上距中心 x 处的磁感应强度沿轴向：</p>$$B(x)=\\frac{\\mu_0NIR^2}{2\\left(R^2+x^2\\right)^{3/2}},\\qquad B_0=\\frac{\\mu_0NI}{2R}$$
<h3>2. 亥姆霍兹线圈</h3>${helmholtzFig((k, x) => (k ? 1 / Math.pow(1 + (x - k / 2) ** 2, 1.5) + 1 / Math.pow(1 + (x + k / 2) ** 2, 1.5) : 1 / Math.pow(1 + x * x, 1.5)))}<p>两个相同的线圈同轴放置、通以同向电流，间距 d 时轴线上的磁场是两者之和（叠加原理）。中点处 $\\mathrm{d}B/\\mathrm{d}x=0$；当 $d=R$ 时还有 $\\mathrm{d}^2B/\\mathrm{d}x^2=0$，中点附近的磁场最均匀，此时</p>$$B_O=\\left(\\frac45\\right)^{3/2}\\frac{\\mu_0NI}{R}\\approx0.7155\\frac{\\mu_0NI}{R}$$<p>间距小于 R 时中点是磁场的极大值，大于 R 时中点是极小值。</p>
<h3>3. 霍尔探头测磁场</h3><p>特斯拉计的探头是一片霍尔元件，输出电压与垂直于元件的磁感应强度分量成正比。探头在线圈断电时仍有读数（地磁场在轴向的分量约几十微特，以及元件的不等位电压），所以每次改接线路后都要在断电时调零。</p>
<h3>4. 本仿真的计算模型</h3><p>线圈的磁场用电流环的精确解计算（广义完全椭圆积分，算法移植自开源库 Magpylib），每个线圈的绕组按轴向宽度 ${(W * 1000).toFixed(0)} mm 分层叠加，不是理想细线圈；线圈的实际半径与铭牌有 ±0.4% 的偏差。线圈中的电流由直流电路求解得到，含方向，接反或只接一个都如实反映。特斯拉计有 ±0.4% 的示值误差、地磁场背景和末位跳动。</p>`;
  }
}
