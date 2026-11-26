// 实验：霍尔效应（对称测量法消除副效应 · V_H–I_s、V_H–I_M · 载流子类型、浓度、电导率、迁移率）
// 霍尔电压模型：V = V_H + V_E（爱廷豪森，∝I_sB，不能消除）+ V_N + V_RL（能斯特、里吉–勒迪克，∝B）+ V_0（不等位，∝I_s）
import * as THREE from 'three';
import { meta, thumb } from './hall.meta.js';
import { Circuit, benchTable, panelMesh } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, canvasTexture } from '../core/Models.js';
import { mean, rand, relErr, pct, clamp, linFit, gauss } from '../core/Stats.js';
import { hallFig } from './circuitFigs.js';

const QE = 1.602176634e-19;
const D = 0.5e-3, BW = 4.0e-3, LS = 3.0e-3; // 样品厚 d、宽 b、V_σ 电极间距 l（m）
const COMBO = { '++': 'V1', '+-': 'V2', '--': 'V3', '-+': 'V4' };

const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

/** 实验架：电磁铁 + 霍尔元件 + 三个换向开关 */
function hallStand({ key = 'mag', defaultSlot, kNom }) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(56, 2, 30), MAT.paint(0x2b3440), 0, 1, 0));
  // C 形电磁铁（气隙在右侧立柱上，磁场竖直）
  const iron = MAT.paint(0x4b5563);
  g.add(mesh(new THREE.BoxGeometry(30, 5, 7), iron, -6, 4.5, -6));
  g.add(mesh(new THREE.BoxGeometry(30, 5, 7), iron, -6, 29.5, -6));
  g.add(mesh(new THREE.BoxGeometry(5, 30, 7), iron, -18.5, 17, -6));
  g.add(mesh(new THREE.BoxGeometry(5, 10.6, 7), iron, 6.5, 12.3, -6));
  g.add(mesh(new THREE.BoxGeometry(5, 10.6, 7), iron, 6.5, 21.7, -6));
  const copper = new THREE.MeshStandardMaterial({ color: 0xb86b2b, metalness: 0.7, roughness: 0.4 });
  for (const y of [11, 23]) { const c = mesh(new THREE.CylinderGeometry(5.2, 5.2, 8, 28), copper, -18.5, y, -6); g.add(c); }
  const pole = MAT.paint(0x9aa3b2);
  g.add(mesh(new THREE.BoxGeometry(6, 0.6, 8), pole, 6.5, 17.6 + 0.3, -6));
  g.add(mesh(new THREE.BoxGeometry(6, 0.6, 8), pole, 6.5, 16.4 - 0.3, -6));
  // 样品臂：铝杆伸进气隙，末端是霍尔元件
  g.add(mesh(new THREE.BoxGeometry(18, 0.6, 1.4), MAT.alu(), 18, 17, -6));
  g.add(mesh(new THREE.BoxGeometry(2.6, 0.2, 2.2), MAT.paint(0x2f6b3a), 6.5, 17, -6));
  const chip = mesh(new THREE.BoxGeometry(1.0, 0.25, 0.8), MAT.paint(0x1f2937), 6.5, 17.15, -6); g.add(chip);
  g.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 15, 10), MAT.alu(), 26, 9.5, -6));
  // 铭牌与开关面板
  const panel = panelMesh(54, 12, (c, W, H) => {
    c.fillStyle = '#2b3440'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#e5e7eb'; c.font = `bold ${H * 0.1}px "Microsoft YaHei"`; c.textAlign = 'center';
    c.fillText('Iₛ 输入', W * 0.12, H * 0.15); c.fillText('Iₘ 输入', W * 0.88, H * 0.15); c.fillText('V 输出', W * 0.5, H * 0.92);
    c.fillText('Iₛ 换向 K₁', W * 0.3, H * 0.15); c.fillText('V_H / V_σ K₃', W * 0.5, H * 0.15); c.fillText('Iₘ 换向 K₂', W * 0.7, H * 0.15);
    c.font = `${H * 0.075}px "Microsoft YaHei"`; c.fillStyle = '#cbd5e1';
    c.fillText(`电磁铁 B = k·Iₘ，k = ${kNom.toFixed(1)} mT/A`, W * 0.5, H * 0.72);
    c.fillText(`样品 d = ${(D * 1e3).toFixed(2)} mm  b = ${(BW * 1e3).toFixed(2)} mm  l = ${(LS * 1e3).toFixed(2)} mm`, W * 0.5, H * 0.81);
    c.fillText('K₁、K₂ 扳向上为“+”：Iₛ 沿 +x，B 沿 +z（向上）', W * 0.5, H * 0.63);
  });
  panel.rotation.x = -Math.PI / 2; panel.position.set(0, 2.02, 8.5); g.add(panel);
  const levers = [];
  for (const x of [-10.8, 0, 10.8]) {
    g.add(mesh(new THREE.BoxGeometry(5, 0.8, 3.2), MAT.paint(0x8b5a2b), x, 2.4, 7.4));
    const lv = new THREE.Group(); lv.position.set(x, 2.8, 7.4);
    lv.add(mesh(new THREE.BoxGeometry(0.5, 3, 0.5), MAT.brass(), 0, 1.5, 0));
    lv.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), MAT.black(), 0, 3.2, 0));
    g.add(lv); levers.push(lv);
  }
  const dev = {
    key, short: '实验架', s1: '+', s2: '+', s3: 'H', burnt: false,
    terms: {
      'Is+': { pos: new THREE.Vector3(-25, 2, 6), label: 'Iₛ+', color: 0xb91c1c }, 'Is-': { pos: new THREE.Vector3(-21.5, 2, 6), label: 'Iₛ−', color: 0x1b1b1b },
      'IM+': { pos: new THREE.Vector3(21.5, 2, 6), label: 'Iₘ+', color: 0xb91c1c }, 'IM-': { pos: new THREE.Vector3(25, 2, 6), label: 'Iₘ−', color: 0x1b1b1b },
      'V+': { pos: new THREE.Vector3(-1.8, 2, 13), label: 'V+', color: 0xb91c1c }, 'V-': { pos: new THREE.Vector3(1.8, 2, 13), label: 'V−', color: 0x1b1b1b },
    },
    elements() { return []; },
    after() {
      levers[0].rotation.x = this.s1 === '+' ? -0.5 : 0.5;
      levers[1].rotation.x = this.s3 === 'H' ? -0.5 : 0.5;
      levers[2].rotation.x = this.s2 === '+' ? -0.5 : 0.5;
      chip.material.color.setHex(this.burnt ? 0x3a2410 : 0x1f2937);
    },
  };
  dev.comp = new Component({
    key, name: '霍尔效应实验架', icon: SVG('<path d="M10 6h30v8M10 6v28h30v-8" fill="none" stroke="currentColor" stroke-width="3"/><rect x="34" y="18" width="20" height="4" fill="#2f6b3a"/>'),
    zone: 'slot', defaultSlot, object: g, labelY: 34,
    desc: `电磁铁气隙中的磁场与励磁电流成正比，铭牌给出 B = k·Iₘ（k = ${kNom.toFixed(1)} mT/A）。气隙中央放着半导体霍尔元件。K₁、K₂ 分别改变 Iₛ、Iₘ 的方向，K₃ 选择输出霍尔电压 V_H 还是沿电流方向的电压 V_σ。`,
    controls: () => [
      { type: 'segment', label: 'K₁ 工作电流 Iₛ 方向', get: () => dev.s1, set: (v) => (dev.s1 = v), options: [{ label: '+Iₛ', value: '+' }, { label: '−Iₛ', value: '-' }] },
      { type: 'segment', label: 'K₂ 励磁电流 Iₘ 方向', get: () => dev.s2, set: (v) => (dev.s2 = v), options: [{ label: '+B', value: '+' }, { label: '−B', value: '-' }] },
      { type: 'segment', label: 'K₃ 测量', get: () => dev.s3, set: (v) => (dev.s3 = v), options: [{ label: 'V_H', value: 'H' }, { label: 'V_σ', value: 'S' }] },
      ...(dev.burnt ? [{ type: 'button', label: '换一片同批次的霍尔元件', onClick: () => { dev.burnt = false; } }] : []),
    ],
  });
  return dev;
}

/** 霍尔效应测试仪：两路恒流源 + 毫伏表 */
function hallTester({ key = 'tester', defaultSlot }) {
  const W = 36, Hh = 12, Dp = 20;
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(W, Hh, Dp), MAT.paint(0xd6d3cb), 0, Hh / 2, 0));
  const cv = document.createElement('canvas'); cv.width = 864; cv.height = 288;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, Hh - 0.6), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, Hh / 2, Dp / 2 + 0.02); face.userData.noHL = true; g.add(face);
  const knobs = [];
  for (const x of [-11, 11]) { const k = mesh(new THREE.CylinderGeometry(1.4, 1.5, 1.4, 24), MAT.black(), x, 2.4, Dp / 2 + 0.7); k.rotation.x = Math.PI / 2; g.add(k); knobs.push(k); }
  const dev = {
    key, short: '测试仪', on: false, Is: 0, IM: 0, V: null,
    terms: {
      'Is+': { pos: new THREE.Vector3(-15, Hh, 6), label: 'Iₛ+', color: 0xb91c1c }, 'Is-': { pos: new THREE.Vector3(-11.5, Hh, 6), label: 'Iₛ−', color: 0x1b1b1b },
      'V+': { pos: new THREE.Vector3(-1.8, Hh, 6), label: 'V+', color: 0xb91c1c }, 'V-': { pos: new THREE.Vector3(1.8, Hh, 6), label: 'V−', color: 0x1b1b1b },
      'IM+': { pos: new THREE.Vector3(11.5, Hh, 6), label: 'Iₘ+', color: 0xb91c1c }, 'IM-': { pos: new THREE.Vector3(15, Hh, 6), label: 'Iₘ−', color: 0x1b1b1b },
    },
    elements() { return []; },
    after() { draw(); knobs[0].rotation.y = -dev.Is / 10 * 5; knobs[1].rotation.y = -dev.IM * 5; },
    shown() {
      return {
        Is: this.on ? this.Is.toFixed(2) : '', IM: this.on ? this.IM.toFixed(3) : '',
        V: !this.on ? '' : this.V == null ? '  0.00' : Math.abs(this.V) >= 199.995 ? (this.V < 0 ? '-1    ' : ' 1    ') : (this.V < 0 ? '-' : ' ') + Math.abs(this.V).toFixed(2),
      };
    },
  };
  let last = '';
  const draw = () => {
    const s = dev.shown(), sig = JSON.stringify(s);
    if (sig === last) return; last = sig;
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    c.fillStyle = '#d6d3cb'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f2937'; c.font = 'bold 26px "Microsoft YaHei"'; c.textAlign = 'left'; c.fillText('霍尔效应测试仪', 18, 36);
    const box = (x, label, txt, unit, col) => {
      c.fillStyle = '#1f2937'; c.font = '22px "Microsoft YaHei"'; c.textAlign = 'center'; c.fillText(label, x + 120, 76);
      c.fillStyle = '#120808'; c.fillRect(x, 88, 240, 82);
      c.fillStyle = col; c.font = 'bold 56px Consolas, monospace'; c.textAlign = 'right'; c.fillText(txt, x + 196, 150);
      c.font = 'bold 22px Consolas'; c.textAlign = 'left'; c.fillText(unit, x + 200, 150);
    };
    box(24, '工作电流 Iₛ', s.Is, 'mA', '#ff5a3c'); box(312, '测量电压', s.V, 'mV', '#ff5a3c'); box(600, '励磁电流 Iₘ', s.IM, 'A', '#ff5a3c');
    c.fillStyle = '#1f2937'; c.font = '20px "Microsoft YaHei"'; c.textAlign = 'center';
    c.fillText('Iₛ 调节 0–10 mA', 144, 270); c.fillText('Iₘ 调节 0–1 A', 720, 270);
    c.fillStyle = dev.on ? '#22c55e' : '#444'; c.beginPath(); c.arc(410, 230, 9, 0, 7); c.fill();
    c.fillStyle = '#1f2937'; c.fillText('电源', 456, 237);
    tex.needsUpdate = true;
  };
  draw();
  dev.comp = new Component({
    key, name: '霍尔效应测试仪', icon: SVG('<rect x="6" y="8" width="52" height="24" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="10" y="12" width="13" height="7" fill="currentColor"/><rect x="26" y="12" width="13" height="7" fill="currentColor"/><rect x="42" y="12" width="13" height="7" fill="currentColor"/>'),
    zone: 'slot', defaultSlot, object: g, labelY: 16,
    desc: '两路恒流源：Iₛ 0–10 mA（接霍尔元件），Iₘ 0–1 A（接电磁铁线圈）；数字毫伏表 ±199.99 mV。两路电流的输出端不能接错：Iₘ 若接到霍尔元件上会立即把元件烧坏。',
    controls: () => [
      { type: 'toggle', label: '电源', get: () => dev.on, set: (v) => (dev.on = v) },
      { type: 'knob', label: 'Iₛ 调节', get: () => dev.Is, set: (v) => (dev.Is = clamp(Math.round(v * 100) / 100, 0, 10)), min: 0, max: 10, step: 0.01, bigStep: 0.1, perRev: 2, digits: 2, unit: 'mA' },
      { type: 'knob', label: 'Iₘ 调节', get: () => dev.IM, set: (v) => (dev.IM = clamp(Math.round(v * 1000) / 1000, 0, 1)), min: 0, max: 1, step: 0.001, bigStep: 0.01, perRev: 0.2, digits: 3, unit: 'A' },
      { type: 'readout', label: '毫伏表', get: () => (dev.on ? `${dev.shown().V.trim()} mV` : '—') },
    ],
  });
  return dev;
}

export class HallExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.type = Math.random() < 0.6 ? 'n' : 'p';
    this.n = rand(0.8, 2.2) * 1e21; // 载流子浓度 m⁻³
    this.mu = this.type === 'n' ? rand(0.30, 0.40) : rand(0.15, 0.20); // 迁移率 m²/(V·s)
    this.RH = (this.type === 'n' ? -1 : 1) / (this.n * QE);
    this.sigma = this.n * QE * this.mu;
    this.kNom = Math.round(rand(300, 380) * 10) / 10; // 铭牌 mT/A
    this.k = this.kNom * (1 + rand(-0.004, 0.004)) * 1e-3; // 实际 T/A
    this.R0 = rand(0.35, 0.9) * (Math.random() < 0.5 ? -1 : 1); // 不等位电阻 Ω
    this.aE = rand(0.002, 0.005) * Math.abs(this.RH) / D; // 爱廷豪森，与 V_H 同号的小量
    this.bN = rand(0.6, 1.4) * 1e-3 * (Math.random() < 0.5 ? -1 : 1); // 能斯特 + 里吉–勒迪克 V/T
    this._warned = {};
  }

  cameras() {
    return [
      { name: '全景', pos: [0, 90, 92], target: [0, 6, 0] },
      { name: '电磁铁', pos: [-6, 40, 40], target: [-6, 14, -14] },
      { name: '测试仪', pos: [36, 34, 56], target: [36, 6, 14] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    app.addSlot({ id: 'mag', pos: new THREE.Vector3(-26, 0, -12), accepts: ['mag'] });
    app.addSlot({ id: 'tester', pos: new THREE.Vector3(36, 0, 4), accepts: ['tester'] });
    const cir = (this.cir = new Circuit(app));
    this.mag = cir.add(hallStand({ defaultSlot: 'mag', kNom: this.kNom }));
    this.tst = cir.add(hallTester({ defaultSlot: 'tester' }));
    this.view = app.addView({ id: 'mv', title: '测试仪读数', w: 300, h: 110, res: 1 });
  }

  pointerDown(e) { return this.cir.pointerDown(e); }
  pointerMove(e) { return this.cir.pointerMove(e); }
  onRemove(c) { this.cir.removeDevice(c.key); }
  tick(dt) { this.cir.tick(dt); }

  /** 两个接线柱对是否按“同名端”或“反接”相连：返回 1、−1 或 0 */
  pair(a, b) {
    const n = this.cir.nets();
    const [a1, a2, b1, b2] = [n(a + '+'), n(a + '-'), n(b + '+'), n(b + '-')];
    if (a1 === a2) return 0;
    if (a1 === b1 && a2 === b2) return 1;
    if (a1 === b2 && a2 === b1) return -1;
    return 0;
  }
  /** 当前的物理状态：元件中的电流、磁场、毫伏表读数 */
  state() {
    const t = this.tst, m = this.mag;
    const ok = t.comp.placed && m.comp.placed && t.on;
    if (!ok) return { Is: 0, B: 0, V: null };
    // 接错：Iₘ 输出接到元件上
    if (this.pair('tester:IM', 'mag:Is') !== 0 && t.IM > 0.02 && !m.burnt) {
      m.burnt = true;
      this.app.toast('Iₘ 接到了霍尔元件的 Iₛ 输入端，元件被大电流烧坏！断开电源、改正接线后，在实验架上换一片元件', 'warn');
      this.app.renderInspector && this.app.renderInspector();
    }
    const Is = m.burnt ? 0 : (this.pair('tester:Is', 'mag:Is') * t.Is * 1e-3) * (m.s1 === '+' ? 1 : -1);
    const IM = this.pair('tester:IM', 'mag:IM') * t.IM * (m.s2 === '+' ? 1 : -1);
    const a = Math.abs(IM);
    const B = Math.sign(IM) * this.k * a * (1 - 0.02 * a ** 4);
    const vp = this.pair('tester:V', 'mag:V');
    let V = null;
    if (vp) {
      if (m.burnt) V = vp * 150 + gauss(20);
      else if (m.s3 === 'H') V = (this.RH * Is * B / D + this.aE * Is * B + this.bN * B + this.R0 * Is) * 1e3;
      else V = Is * (LS / (this.sigma * BW * D)) * (1 + 0.3 * (this.mu * B) ** 2) * 1e3;
      V = vp * V + gauss(0.004);
    }
    return { Is, B, V, IM };
  }

  /** 重新计算仪器示数（记录前也调用，保证读到的是当前状态） */
  refresh() {
    const st = (this.st = this.state());
    this.tst.V = st.V == null ? null : Math.round(st.V * 100) / 100;
    this.tst.after();
    return st;
  }
  update() {
    this.cir.solve();
    this.refresh();
    const v = this.view, c = v.ctx, W = v.W, H = v.H;
    c.fillStyle = '#d6d3cb'; c.fillRect(0, 0, W, H);
    const s = this.tst.shown();
    const box = (x, lab, txt, unit) => {
      c.fillStyle = '#1f2937'; c.font = '12px "Microsoft YaHei"'; c.textAlign = 'center'; c.fillText(lab, x + 46, 18);
      c.fillStyle = '#120808'; c.fillRect(x, 26, 92, 46);
      c.fillStyle = '#ff5a3c'; c.font = 'bold 24px Consolas, monospace'; c.textAlign = 'right'; c.fillText(txt, x + 74, 58);
      c.font = 'bold 11px Consolas'; c.textAlign = 'left'; c.fillText(unit, x + 76, 58);
    };
    box(4, 'Iₛ', s.Is, 'mA'); box(104, '测量电压', s.V, 'mV'); box(204, 'Iₘ', s.IM, 'A');
    v.foot(this.mag.comp.placed ? `K₁ ${this.mag.s1}Iₛ · K₂ ${this.mag.s2}B · K₃ ${this.mag.s3 === 'H' ? 'V_H' : 'V_σ'}${this.mag.burnt ? ' · 元件已烧坏' : ''}` : '');
  }

  // ---------------- 数据表 ----------------
  tables() {
    const vcol = (k, lab) => ({ key: k, label: lab, digits: 2, readTol: 0.02 });
    const VH = (r) => (r.V1 - r.V2 + r.V3 - r.V4) / 4;
    const four = [vcol('V1', 'V₁(+Iₛ,+B)/mV'), vcol('V2', 'V₂(+Iₛ,−B)/mV'), vcol('V3', 'V₃(−Iₛ,−B)/mV'), vcol('V4', 'V₄(−Iₛ,+B)/mV')];
    return [
      {
        id: 'is', title: 'V_H–Iₛ（Iₘ 固定）', maxRows: 10,
        columns: [{ key: 'IM', label: 'Iₘ/A', digits: 3, auto: true }, { key: 'Is', label: 'Iₛ/mA', digits: 2, auto: true }, ...four, { key: 'VH', label: 'V_H/mV', digits: 3, calc: VH }],
        buttons: [{ label: '记录（按 K₁、K₂ 的位置填入 V₁…V₄）', onClick: (t) => this.recHall(t) }],
        note: 'Iₘ 保持 0.500 A，Iₛ 取 1.00–5.00 mA。每个 Iₛ 下按 (+Iₛ,+B)、(+Iₛ,−B)、(−Iₛ,−B)、(−Iₛ,+B) 四种组合各记一次。$V_H=(V_1-V_2+V_3-V_4)/4$。',
      },
      {
        id: 'im', title: 'V_H–Iₘ（Iₛ 固定）', maxRows: 10,
        columns: [{ key: 'Is', label: 'Iₛ/mA', digits: 2, auto: true }, { key: 'IM', label: 'Iₘ/A', digits: 3, auto: true }, ...four, { key: 'VH', label: 'V_H/mV', digits: 3, calc: VH }],
        buttons: [{ label: '记录（按 K₁、K₂ 的位置填入 V₁…V₄）', onClick: (t) => this.recHall(t) }],
        note: 'Iₛ 保持 3.00 mA，Iₘ 取 0.100–0.800 A，同样每点测四种组合。',
      },
      {
        id: 'sig', title: 'V_σ（Iₘ = 0）', maxRows: 6,
        columns: [{ key: 'Is', label: 'Iₛ/mA', digits: 2, auto: true }, { key: 'Vp', label: 'V_σ(+Iₛ)/mV', digits: 2, readTol: 0.02 }, { key: 'Vm', label: 'V_σ(−Iₛ)/mV', digits: 2, readTol: 0.02 }, { key: 'Vs', label: 'V_σ/mV', digits: 3, calc: (r) => (r.Vp - r.Vm) / 2 }],
        buttons: [{ label: '记录（按 K₁ 的位置填入）', onClick: (t) => this.recSig(t) }],
        note: 'K₃ 扳向 V_σ，Iₘ 调到零，Iₛ 取 1.00 mA，正反向各测一次。$\\sigma=\\dfrac{I_s l}{V_\\sigma bd}$。',
      },
    ];
  }
  ready(mode) {
    const app = this.app, st = this.refresh();
    if (!this.tst.on) { app.toast('测试仪电源没开', 'warn'); return false; }
    if (this.mag.burnt) { app.toast('霍尔元件已烧坏', 'warn'); return false; }
    if (!this.pair('tester:Is', 'mag:Is') || !this.pair('tester:V', 'mag:V') || (mode === 'H' && !this.pair('tester:IM', 'mag:IM'))) { app.toast('接线不完整：测试仪的 Iₛ、Iₘ、V 三组端子要分别接到实验架的对应端子', 'warn'); return false; }
    if (this.mag.s3 !== mode) { app.toast(mode === 'H' ? 'K₃ 应扳向 V_H' : 'K₃ 应扳向 V_σ', 'warn'); return false; }
    if (!(Math.abs(st.Is) > 0)) { app.toast('Iₛ 为零', 'warn'); return false; }
    return true;
  }
  recHall(t) {
    if (!this.ready('H')) return;
    const Is = this.tst.Is, IM = this.tst.IM;
    if (!(IM > 0)) this.app.toast('Iₘ 为零，没有磁场', 'warn');
    const col = COMBO[this.mag.s1 + this.mag.s2];
    let i = t.rows.findIndex((r) => Math.abs(r.Is - Is) < 1e-6 && Math.abs(r.IM - IM) < 1e-6);
    if (i < 0) i = t.addRow({ Is, IM });
    if (i < 0) return;
    t.set(i, col, this.tst.V);
  }
  recSig(t) {
    if (!this.ready('S')) return;
    if (this.tst.IM > 0.0005) this.app.toast('测 V_σ 时应把 Iₘ 调到零（磁阻效应和霍尔电压会混进来）', 'warn');
    const Is = this.tst.Is;
    let i = t.rows.findIndex((r) => Math.abs(r.Is - Is) < 1e-6);
    if (i < 0) i = t.addRow({ Is });
    if (i < 0) return;
    t.set(i, this.mag.s1 === '+' ? 'Vp' : 'Vm', this.tst.V);
  }

  // ---------------- 自动操作 ----------------
  wiring() { return [['tester:Is+', 'mag:Is+'], ['tester:Is-', 'mag:Is-'], ['tester:IM+', 'mag:IM+'], ['tester:IM-', 'mag:IM-'], ['tester:V+', 'mag:V+'], ['tester:V-', 'mag:V-']]; }
  async four(id) {
    const app = this.app, m = this.mag;
    for (const [s1, s2] of [['+', '+'], ['+', '-'], ['-', '-'], ['-', '+']]) {
      app.select(m.comp); m.s1 = s1; m.s2 = s2; app.changed(); await app.wait(220);
      await app.record(id);
    }
  }
  async setI(which, v) { const t = this.tst; this.app.select(t.comp); await this.app.tween(() => t[which], (x) => (t[which] = x), v, 350); t[which] = v; this.app.changed(); await this.app.wait(120); }

  steps() {
    const app = this.app, cir = this.cir;
    const rowsDone = (id) => app.table(id).completeRows().filter((r) => ['V1', 'V2', 'V3', 'V4'].every((k) => isFinite(r[k]))).length;
    return [
      {
        title: '摆放仪器并接线',
        html: '<p>把实验架和测试仪放到桌上。用导线把测试仪的 <b>Iₛ 输出</b>接实验架的 Iₛ 输入，<b>Iₘ 输出</b>接 Iₘ 输入（电磁铁线圈），实验架的 V 输出接测试仪的电压输入。</p><p><b>注意</b>：Iₛ 与 Iₘ 绝不能接反，否则霍尔元件会被烧坏。开电源前先把两个电流旋钮调到零。</p>',
        check: () => cir.placed('mag') && cir.placed('tester') && this.pair('tester:Is', 'mag:Is') === 1 && this.pair('tester:IM', 'mag:IM') === 1 && this.pair('tester:V', 'mag:V') === 1,
        auto: async () => { await app.view('全景'); await app.autoPlace('mag'); await app.autoPlace('tester'); await cir.rewire(this.wiring()); },
      },
      {
        title: '测 V_H–Iₛ 关系',
        html: '<p>开电源，K₃ 扳向 V_H。Iₘ 调到 0.500 A，Iₛ 依次取 1.00、2.00、3.00、4.00、5.00 mA。每个 Iₛ 下用 K₁、K₂ 换向，测出四种组合下的电压 V₁–V₄。</p>',
        hint: '四个电压中，不等位电压 V₀ 只随 Iₛ 反向，能斯特、里吉–勒迪克电压只随 B 反向，取 $(V_1-V_2+V_3-V_4)/4$ 后都被消去；爱廷豪森电压与 V_H 同样随 Iₛ、B 变号，无法消除，但它很小。',
        check: () => rowsDone('is') >= 4,
        auto: async () => {
          const t = this.tst; app.select(t.comp); t.on = true; app.changed();
          this.mag.s3 = 'H';
          await app.view('测试仪');
          await this.setI('IM', 0.5);
          app.showTable(0);
          for (const Is of [1, 2, 3, 4, 5]) { await this.setI('Is', Is); await this.four('is'); }
        },
      },
      {
        title: '测 V_H–Iₘ 关系',
        html: '<p>Iₛ 保持 3.00 mA，Iₘ 依次取 0.100、0.200 … 0.800 A，同样每点测四种组合。</p>',
        check: () => rowsDone('im') >= 5,
        auto: async () => {
          await this.setI('Is', 3);
          app.showTable(1);
          for (const IM of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) { await this.setI('IM', IM); await this.four('im'); }
        },
      },
      {
        title: '测 V_σ',
        html: '<p>Iₘ 调到零，K₃ 扳向 V_σ，Iₛ 取 1.00 mA，用 K₁ 正反向各测一次 V_σ。由此求电导率 $\\sigma=I_sl/(V_\\sigma bd)$。</p>',
        check: () => app.table('sig').completeRows().some((r) => isFinite(r.Vp) && isFinite(r.Vm)),
        auto: async () => {
          await this.setI('IM', 0);
          app.select(this.mag.comp); this.mag.s3 = 'S'; app.changed();
          await this.setI('Is', 1);
          app.showTable(2);
          for (const s1 of ['+', '-']) { this.mag.s1 = s1; app.changed(); await app.wait(220); await app.record('sig'); }
          this.mag.s1 = '+'; this.mag.s3 = 'H'; await this.setI('Is', 0); this.tst.on = false; app.changed();
        },
      },
      {
        title: '数据处理',
        html: '<p>作 V_H–Iₛ、V_H–Iₘ 图，由斜率求霍尔系数 R_H；判断导电类型，求载流子浓度 n、电导率 σ 和迁移率 μ。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const app = this.app;
    const full = (id) => app.table(id).completeRows().filter((r) => ['V1', 'V2', 'V3', 'V4'].every((k) => isFinite(r[k]))).map((r) => ({ ...r, VH: (r.V1 - r.V2 + r.V3 - r.V4) / 4 }));
    const A = full('is'), Bm = full('im'), S = app.table('sig').completeRows().filter((r) => isFinite(r.Vp) && isFinite(r.Vm));
    if (A.length < 2) return { html: '<p>请先完成 V_H–Iₛ 的测量（至少两个 Iₛ，每个四种组合）。</p>', ok: false };
    const kT = this.kNom * 1e-3;
    const plots = [];
    // V_H–Iₛ：斜率 = R_H B / d
    const IM1 = A[0].IM, B1 = kT * IM1;
    const f1 = linFit(A.map((r) => r.Is), A.map((r) => r.VH));
    const RH1 = f1.k * D / B1; // 斜率 mV/mA 即 V/A
    let html = `<h3>1. V_H–Iₛ（Iₘ = ${IM1.toFixed(3)} A，B = kIₘ = ${(B1 * 1e3).toFixed(1)} mT）</h3>
      <table><tr><th>Iₛ/mA</th>${A.map((r) => `<td>${r.Is.toFixed(2)}</td>`).join('')}</tr><tr><th>V_H/mV</th>${A.map((r) => `<td>${r.VH.toFixed(3)}</td>`).join('')}</tr><tr><th>V₀=(V₁+V₂−V₃−V₄)/4</th>${A.map((r) => `<td>${((r.V1 + r.V2 - r.V3 - r.V4) / 4).toFixed(3)}</td>`).join('')}</tr></table>
      <p>最小二乘拟合：斜率 ${f1.k.toFixed(4)} mV/mA，截距 ${f1.b.toFixed(3)} mV，相关系数 r = ${f1.r.toFixed(5)}。</p>
      <p>$R_H=\\dfrac{d}{B}\\cdot\\dfrac{\\Delta V_H}{\\Delta I_s}=${(RH1 * 1e3).toFixed(4)}\\times10^{-3}$ m³/C</p>`;
    plots.push({ title: 'V_H–Iₛ', xLabel: 'Iₛ / mA', yLabel: 'V_H / mV', series: [{ type: 'scatter', data: A.map((r) => [r.Is, r.VH]) }, { type: 'line', data: [[0, f1.b], [Math.max(...A.map((r) => r.Is)) * 1.05, f1.b + f1.k * Math.max(...A.map((r) => r.Is)) * 1.05]], dash: [5, 4] }] });
    let RH = RH1;
    const answers = [];
    if (Bm.length >= 2) {
      const Is2 = Bm[0].Is * 1e-3;
      const lin = Bm.filter((r) => r.IM <= 0.6 + 1e-9);
      const f2 = linFit((lin.length >= 2 ? lin : Bm).map((r) => r.IM), (lin.length >= 2 ? lin : Bm).map((r) => r.VH));
      const RH2 = (f2.k * 1e-3) * D / (kT * Is2);
      html += `<h3>2. V_H–Iₘ（Iₛ = ${(Is2 * 1e3).toFixed(2)} mA）</h3><table><tr><th>Iₘ/A</th>${Bm.map((r) => `<td>${r.IM.toFixed(3)}</td>`).join('')}</tr><tr><th>V_H/mV</th>${Bm.map((r) => `<td>${r.VH.toFixed(3)}</td>`).join('')}</tr></table>
        <p>用 Iₘ ≤ 0.6 A 的点拟合（大电流时铁芯开始饱和，B 略低于 kIₘ）：斜率 ${f2.k.toFixed(3)} mV/A，$R_H=\\dfrac{d}{kI_s}\\cdot\\dfrac{\\Delta V_H}{\\Delta I_M}=${(RH2 * 1e3).toFixed(4)}\\times10^{-3}$ m³/C。</p>`;
      plots.push({ title: 'V_H–Iₘ', xLabel: 'Iₘ / A', yLabel: 'V_H / mV', series: [{ type: 'scatter', data: Bm.map((r) => [r.IM, r.VH]) }, { type: 'line', data: [[0, f2.b], [0.85, f2.b + f2.k * 0.85]], dash: [5, 4] }] });
      RH = (RH1 + RH2) / 2;
      html += `<p>两种方法取平均：$R_H=${(RH * 1e3).toFixed(4)}\\times10^{-3}$ m³/C。</p>`;
    }
    const type = RH < 0 ? 'n' : 'p';
    const nC = 1 / (Math.abs(RH) * QE);
    html += `<h3>3. 导电类型与载流子浓度</h3><p>K₁、K₂ 都在“+”位置时 Iₛ 沿 +x、B 沿 +z，测得的 V_H ${RH < 0 ? '为负' : '为正'}，由 $R_H=V_Hd/(I_sB)$ 知 $R_H$ ${RH < 0 ? '为负' : '为正'}：${type === 'n' ? '载流子带负电（电子），样品为 <b>N 型</b>' : '载流子带正电（空穴），样品为 <b>P 型</b>'}。</p>`;
    html += `<p>$n=\\dfrac{1}{|R_H|e}=${(nC / 1e21).toFixed(3)}\\times10^{21}$ m⁻³</p>`;
    answers.push({ label: '$|R_H|$', unit: '10⁻³ m³/C', value: Math.abs(RH) * 1e3, digits: 3, tolRel: 0.01 });
    answers.push({ label: '$n$', unit: '10²¹ m⁻³', value: nC / 1e21, digits: 3, tolRel: 0.01 });
    const tail = [`样品实际为 ${this.type === 'n' ? 'N' : 'P'} 型，R_H = ${(this.RH * 1e3).toFixed(4)}×10⁻³ m³/C，测量值相对误差 ${pct(relErr(RH, this.RH), 2)}`];
    if (S.length) {
      const Vs = mean(S.map((r) => (r.Vp - r.Vm) / 2)), Is3 = S[0].Is * 1e-3;
      const sg = (Is3 * LS) / (Vs * 1e-3 * BW * D), mu = Math.abs(RH) * sg;
      html += `<h3>4. 电导率与迁移率</h3><p>$V_\\sigma=${Vs.toFixed(3)}$ mV（Iₛ = ${(Is3 * 1e3).toFixed(2)} mA）。$\\sigma=\\dfrac{I_sl}{V_\\sigma bd}=${sg.toFixed(2)}$ S/m，$\\mu=|R_H|\\sigma=${mu.toFixed(4)}$ m²/(V·s)。</p>
        <div class="result-box">${type === 'n' ? 'N' : 'P'} 型；$n=${(nC / 1e21).toFixed(3)}\\times10^{21}$ m⁻³，$\\sigma=${sg.toFixed(2)}$ S/m，$\\mu=${mu.toFixed(3)}$ m²/(V·s)</div>`;
      answers.push({ label: '$\\sigma$', unit: 'S/m', value: sg, digits: 2, tolRel: 0.01 });
      answers.push({ label: '$\\mu$', unit: 'm²/(V·s)', value: mu, digits: 4, tolRel: 0.015 });
      tail.push(`电导率实际 ${this.sigma.toFixed(2)} S/m（相对误差 ${pct(relErr(sg, this.sigma), 2)}），迁移率实际 ${this.mu.toFixed(4)} m²/(V·s)（相对误差 ${pct(relErr(mu, this.mu), 2)}）`);
    }
    html += `<div class="result-box warn">${tail.join('；')}。电磁铁实际 k = ${(this.k * 1e3).toFixed(1)} mT/A（铭牌 ${this.kNom.toFixed(1)}）。</div>`;
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 霍尔效应</h3>${hallFig()}<p>电流 $I_s$ 沿 x 方向流过厚 $d$、宽 $b$ 的半导体薄片，磁场 B 沿 z 方向。载流子受洛伦兹力向 y 方向偏转，在两侧积累电荷，形成横向电场 $E_H$，直到电场力与洛伦兹力平衡：$qE_H=qvB$。由 $I_s=nqvbd$ 得</p>$$V_H=E_Hb=\\frac{1}{nq}\\cdot\\frac{I_sB}{d}=R_H\\frac{I_sB}{d},\\qquad R_H=\\frac{1}{nq}$$<p>$R_H$ 的符号与载流子电荷的符号相同：N 型 $R_H<0$，P 型 $R_H>0$。$n$ 越小 $V_H$ 越大，所以霍尔元件用载流子浓度低的半导体。</p>
<h3>2. 副效应与对称测量法</h3><p>测到的电压中还有：不等位电压 $V_0$（两个电极不在同一等势面上，$\\propto I_s$）；能斯特效应、里吉–勒迪克效应（$\\propto B$，与 $I_s$ 方向无关）；爱廷豪森效应（$\\propto I_sB$，与 $V_H$ 一样随 $I_s$、$B$ 变号）。分别改变 $I_s$ 和 $B$ 的方向测四次：</p>$$V_H=\\frac{V_1-V_2+V_3-V_4}{4}$$<p>除爱廷豪森效应外的副效应都被消去。</p>
<h3>3. 电导率与迁移率</h3><p>沿电流方向相距 $l$ 的两电极间电压 $V_\\sigma=\\dfrac{I_sl}{\\sigma bd}$，所以 $\\sigma=\\dfrac{I_sl}{V_\\sigma bd}$。又 $\\sigma=nq\\mu$，得 $\\mu=|R_H|\\sigma$。</p>
<h3>4. 本仿真的计算模型</h3><p>样品为随机生成的 N 型或 P 型半导体（浓度约 $10^{21}$ m⁻³），霍尔电压按上式计算，并叠加不等位电压、能斯特与里吉–勒迪克电压、爱廷豪森电压（约为 $V_H$ 的 0.2%–0.5%）以及毫伏表的末位跳动。电磁铁在大电流时略有饱和（1 A 时比 $kI_M$ 低 2%）；铭牌 k 值与实际值有 ±0.4% 的偏差。测 V_σ 时若有磁场，会叠加磁阻效应。</p>`;
  }
}
