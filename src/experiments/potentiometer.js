// 实验：十一线电位差计测干电池的电动势和内阻
// 补偿法 · 标准电池电动势的温度修正 · 校准工作电流 · 保护电阻与跃接 · 内阻（外接负载电阻）
import * as THREE from 'three';
import { meta, thumb } from './potentiometer.meta.js';
import { Circuit, benchTable, analogMeter, dcSupply, rheostat, knifeSwitch, resistanceBox, panelMesh, drawDialFace } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, canvasTexture } from '../core/Models.js';
import { mean, uA, rand, relErr, pct, clamp } from '../core/Stats.js';
import { potentiometerFig } from './circuitFigs.js';

const G_PER_DIV = 3e-7; // 检流计每格电流 A
const G_DIVS = 60; // ±30 格
const U0_SET = 0.2; // 预定的工作电流对应的单位长度电压 V/m
const ES_ILIM = 1e-5; // 标准电池允许的电流（超过后累计时间，过久则损坏）

/** 饱和标准电池电动势的温度公式（国际通用的 Wolff 公式，V） */
export const westonE = (E20, t) => E20 - (39.94 * (t - 20) + 0.929 * (t - 20) ** 2 - 0.009 * (t - 20) ** 3) * 1e-6;

const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

// ============================ 十一线电位差计 ============================
function elevenWire({ key = 'pot', defaultSlot }) {
  const BW = 112, BD = 36, BH = 2;
  const zRow = (r) => -15 + r * 2.6; // 0..9 折返的十根电阻丝
  const zS = 12.4; // 第 11 根：带滑键的直电阻丝
  const xL = -50, xR = 50;
  const sockX = (s) => (s % 2 === 0 ? xL - 1.6 : xR + 1.6);
  const sockZ = (s) => (s === 10 ? zRow(0) : s === 0 ? (zRow(9) + zS) / 2 : (zRow(9 - s) + zRow(10 - s)) / 2);
  const g = new THREE.Group();
  // 底板
  const top = canvasTexture(2048, 660, (c, W, H) => {
    c.fillStyle = '#b7925e'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) {
      c.strokeStyle = `rgba(90,58,26,${0.05 + Math.random() * 0.08})`; c.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * H; c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= W; x += 80) c.lineTo(x, y + Math.sin(x / 140 + i) * 4); c.stroke();
    }
    const px = (x) => ((x + BW / 2) / BW) * W, pz = (z) => ((z + BD / 2) / BD) * H;
    c.fillStyle = '#2b2118'; c.font = `bold ${H * 0.045}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let s = 0; s <= 10; s++) c.fillText(String(s), px(sockX(s) + (s % 2 === 0 ? -2.6 : 2.6)), pz(sockZ(s)));
    c.font = `${H * 0.04}px "Microsoft YaHei"`;
    c.fillText('十一线电位差计', px(0), pz(-17.0));
    c.textAlign = 'left'; c.fillText('A', px(-55.6), pz(-10.6)); c.fillText('C', px(-55.6), pz(1.4));
    c.textAlign = 'right'; c.fillText('B', px(55.6), pz(1.4)); c.fillText('D', px(55.6), pz(9.4));
  });
  const base = mesh(new THREE.BoxGeometry(BW, BH, BD), [MAT.paint(0x6b4a2a), MAT.paint(0x6b4a2a), new THREE.MeshStandardMaterial({ map: top, roughness: 0.7 }), MAT.paint(0x6b4a2a), MAT.paint(0x6b4a2a), MAT.paint(0x6b4a2a)], 0, BH / 2, 0);
  base.receiveShadow = true; g.add(base);
  // 米尺
  const ruler = panelMesh(100, 3.2, (c, W, H) => {
    c.fillStyle = '#efe6cf'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#222'; c.fillStyle = '#222';
    for (let i = 0; i <= 1000; i++) {
      const x = (i / 1000) * (W - 2) + 1, l = i % 10 === 0 ? 0.55 : i % 5 === 0 ? 0.38 : 0.24;
      c.lineWidth = i % 10 === 0 ? 1.4 : 0.9; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H * l); c.stroke();
      if (i % 50 === 0) { c.font = `bold ${H * 0.3}px Arial`; c.textAlign = 'center'; c.fillText(String(i / 10), clamp(x, 10, W - 10), H * 0.82); }
    }
  }, 40.96);
  ruler.rotation.x = -Math.PI / 2; ruler.position.set(0, BH + 0.03, zS + 2.6); g.add(ruler);
  // 电阻丝
  const wireM = new THREE.MeshStandardMaterial({ color: 0xb9b2a6, metalness: 0.9, roughness: 0.35 });
  const wire = (x0, x1, z) => { const m = mesh(new THREE.CylinderGeometry(0.07, 0.07, x1 - x0, 6), wireM, (x0 + x1) / 2, BH + 0.6, z); m.rotation.z = Math.PI / 2; g.add(m); };
  for (let r = 0; r < 10; r++) wire(xL - 1.6, xR + 1.6, zRow(r));
  wire(xL - 1.6, xR + 2.5, zS);
  // 铜接线条（插孔）
  const brass = MAT.brass();
  for (let s = 0; s <= 10; s++) {
    const z0 = s === 10 ? zRow(0) - 0.7 : s === 0 ? zRow(9) - 0.4 : zRow(9 - s) - 0.4, z1 = s === 10 ? zRow(0) + 0.7 : s === 0 ? zS + 0.4 : zRow(10 - s) + 0.4;
    g.add(mesh(new THREE.BoxGeometry(1.6, 0.9, z1 - z0), brass, sockX(s), BH + 0.45, (z0 + z1) / 2));
    g.add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 12), MAT.black(), sockX(s), BH + 0.92, sockZ(s)));
  }
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.9, 1.0), brass, xR + 2.5, BH + 0.45, zS));
  // 插头 C 与滑键 D
  const plug = new THREE.Group();
  plug.add(mesh(new THREE.CylinderGeometry(0.55, 0.45, 2.4, 14), MAT.paint(0xb91c1c), 0, 1.2, 0));
  plug.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8), brass, 0, -0.2, 0));
  g.add(plug);
  const slider = new THREE.Group();
  slider.add(mesh(new THREE.BoxGeometry(2.4, 1.6, 3.4), MAT.black(), 0, BH + 1.7, 0.2));
  const btn = mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.8, 14), MAT.paint(0xb91c1c), 0, BH + 2.8, 0.2); slider.add(btn);
  slider.add(mesh(new THREE.BoxGeometry(0.06, 0.9, 3.2), brass, 0, BH + 0.7, 0.9)); // 刀口（读数线）
  g.add(slider);
  g.add(mesh(new THREE.BoxGeometry(xR - xL + 4, 0.4, 0.5), MAT.alu(), 0, BH + 2.2, zS - 1.6));
  const leadM = { C: MAT.paint(0xb91c1c), D: MAT.paint(0x1b1b1b) };
  const leads = {};
  const lead = (k, p0, p1) => {
    if (leads[k]) { g.remove(leads[k]); leads[k].geometry.dispose(); }
    const mid = p0.clone().lerp(p1, 0.5); mid.y += 4 + 0.04 * p0.distanceTo(p1);
    const curve = new THREE.CatmullRomCurve3([p0, p0.clone().add(new THREE.Vector3(0, 2, 0)), mid, p1.clone().add(new THREE.Vector3(0, 2, 0)), p1]);
    leads[k] = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.16, 6, false), leadM[k]);
    leads[k].userData.noHL = true; g.add(leads[k]);
  };

  // 电阻丝阻值：每米约 4 Ω，各段有 ±0.05% 的不均匀，直丝沿长度有微小起伏
  const r1 = 4.0 * (1 + rand(-0.03, 0.03));
  const eps = Array.from({ length: 10 }, () => rand(-5e-4, 5e-4));
  const epsS = rand(-5e-4, 5e-4), wob = rand(-6e-4, 6e-4), ph = rand(0, 6.28);
  const Rs = (x) => r1 * (1 + epsS) * (x + (wob / (2 * Math.PI)) * (Math.sin(2 * Math.PI * x + ph) - Math.sin(ph)));
  const terms = {
    A: { pos: new THREE.Vector3(-54.4, BH, -9), label: 'A' },
    C: { pos: new THREE.Vector3(-54.4, BH, 3), label: 'C（插头）', color: 0xb91c1c },
    B: { pos: new THREE.Vector3(54.4, BH, 3), label: 'B', color: 0x1b1b1b },
    D: { pos: new THREE.Vector3(54.4, BH, 11), label: 'D（滑键）', color: 0x1b1b1b },
  };
  const dev = {
    key, short: '电位差计', n: 0, x: 0.5, pressed: false, terms, r1,
    /** 插头与滑键之间电阻丝的真实电阻比（用于核对） */
    L() { return this.n + this.x; },
    elements(t) {
      const E = [{ type: 'R', a: t('A'), b: t('s10'), R: 0.004 }];
      for (let k = 0; k < 10; k++) E.push({ type: 'R', a: t('s' + (k + 1)), b: t('s' + k), R: r1 * (1 + eps[k]), tag: 'w' + k });
      const Rx = Rs(this.x), Rt = Rs(1.025);
      E.push({ type: 'R', a: t('s0'), b: t('d'), R: Math.max(1e-5, Rx) }, { type: 'R', a: t('d'), b: t('B'), R: Math.max(1e-5, Rt - Rx) });
      E.push({ type: 'R', a: t('C'), b: t('s' + this.n), R: 0.008 });
      if (this.pressed) E.push({ type: 'R', a: t('D'), b: t('d'), R: 0.03 });
      return E;
    },
    after(sol, t, els) {
      const w = els.find((e) => e.tag === 'w5');
      this.Iw = w ? sol.cur(w) : 0;
      this.U0 = (sol.v(t('s10')) - sol.v(t('s0'))) / 10;
      plug.position.set(sockX(this.n), BH + 0.9, sockZ(this.n));
      slider.position.set(xL + this.x * (xR - xL), 0, zS);
      btn.position.y = BH + (this.pressed ? 2.45 : 2.8);
      const tp = (n) => terms[n].pos.clone().add(new THREE.Vector3(0, 2.2, 0));
      if (this._ln !== this.n) { this._ln = this.n; lead('C', plug.position.clone().add(new THREE.Vector3(0, 2.4, 0)), tp('C')); }
      if (this._lx !== this.x) { this._lx = this.x; lead('D', slider.position.clone().add(new THREE.Vector3(0, BH + 2.4, 1.6)), tp('D')); }
    },
  };
  dev.comp = new Component({
    key, name: '十一线电位差计', icon: SVG('<path d="M6 8h52M58 8v5M6 13h52M6 13v5M6 18h52M58 18v5M6 23h52M6 30h52" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="28" y="26" width="6" height="7" fill="currentColor"/><circle cx="58" cy="13" r="2" fill="#c41e3a"/>'),
    zone: 'slot', defaultSlot, object: g, labelY: 8,
    desc: '11 根各长 1.000 m 的电阻丝串联：前 10 根经铜条折返，铜条上的插孔 0–10 供插头 C 插入；第 11 根是直丝，下面有米尺，滑键 D 可在上面滑动，按下滑键才与电阻丝接触。C、D 之间的电阻丝长度 L = 插孔号 + 滑键读数（m）。A、B 两端接工作电源。',
    controls: () => [
      { type: 'knob', label: '插头 C 插入的插孔', get: () => dev.n, set: (v) => (dev.n = clamp(Math.round(v), 0, 10)), min: 0, max: 10, step: 1, bigStep: 1, perRev: 6, digits: 0, unit: '号' },
      { type: 'slider', label: '滑键 D（在直丝上滑动）', get: () => dev.x, set: (v) => (dev.x = clamp(v, 0, 1)), min: 0, max: 1, step: 0.0005, fmt: (v) => `约 ${Math.round(v * 100)} cm`, sub: '位置请在“米尺”窗口读，估读到 0.1 mm' },
      { type: 'knob', label: '滑键微调', get: () => dev.x, set: (v) => (dev.x = clamp(Math.round(v * 1e4) / 1e4, 0, 1)), min: 0, max: 1, step: 0.0001, bigStep: 0.001, perRev: 0.005, fmt: () => '±0.1 mm / 格' },
      { type: 'toggle', label: '按下滑键 D（接通补偿回路）', get: () => dev.pressed, set: (v) => (dev.pressed = v) },
    ],
  });
  return dev;
}

// ============================ 标准电池 ============================
function standardCell({ key = 'es', defaultSlot, E20, temp }) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(11, 8, 8), MAT.paint(0x4a3020), 0, 4, 0));
  const face = panelMesh(11, 8, (c, W, H) => {
    c.fillStyle = '#efe6cf'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#1f2937'; c.textAlign = 'center';
    c.font = `bold ${H * 0.11}px "Microsoft YaHei"`; c.fillText('饱和标准电池', W / 2, H * 0.17);
    c.font = `${H * 0.085}px "Microsoft YaHei"`; c.fillText('0.005 级 · 内阻 < 1 kΩ', W / 2, H * 0.31);
    c.font = `bold ${H * 0.1}px Arial`; c.fillText(`E₂₀ = ${E20.toFixed(5)} V`, W / 2, H * 0.48);
    c.font = `${H * 0.075}px "Microsoft YaHei"`; c.fillText('只许跃接，电流不得超过 1 μA', W / 2, H * 0.62);
    c.fillText('严禁倒置、摇晃，严禁用电压表测量', W / 2, H * 0.74);
    c.fillStyle = '#b91c1c'; c.font = `bold ${H * 0.12}px Arial`; c.fillText('+', W * 0.26, H * 0.93); c.fillStyle = '#1f2937'; c.fillText('−', W * 0.74, H * 0.93);
  });
  face.rotation.x = -Math.PI / 2; face.position.y = 8.02; g.add(face);
  // 温度计
  g.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 9, 8), MAT.glass(0xeef6ff, 0.5), 6.6, 4.5, -2.5));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 2 + (temp - 10) * 0.25, 6), MAT.paint(0xc41e3a), 6.6, 1 + (2 + (temp - 10) * 0.25) / 2, -2.5));
  const dev = {
    key, short: '标准电池', E20, temp, damage: 0, over: 0, I: 0,
    E() { return westonE(E20, temp) - this.damage; },
    terms: { '+': { pos: new THREE.Vector3(-2.8, 8, 3.2), label: '+' }, '-': { pos: new THREE.Vector3(2.8, 8, 3.2), label: '−', color: 0x1b1b1b } },
    elements(t) { return [{ type: 'V', a: t('+'), b: t('-'), E: this.E(), r: 820, tag: 'es' }]; },
    after(sol, t, els) { this.I = Math.abs(sol.cur(els[0])); },
  };
  dev.comp = new Component({
    key, name: '饱和标准电池', icon: SVG('<rect x="12" y="6" width="40" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M24 14v12M28 18v4M36 14v12M40 18v4" stroke="currentColor" stroke-width="2"/>'),
    zone: 'slot', defaultSlot, object: g, labelY: 11,
    desc: `镉汞饱和标准电池。20 °C 时的电动势 E₂₀ 见铭牌，其他温度下按 $E_t=E_{20}-[39.94(t-20)+0.929(t-20)^2-0.009(t-20)^3]\\times10^{-6}$ V 修正。内阻约 800 Ω，只能通过极小的电流，不能用电压表直接测量。`,
    controls: () => [
      { type: 'readout', label: '室温（盒上温度计）', get: () => `${temp.toFixed(1)} °C` },
      { type: 'readout', label: '流过的电流', get: () => (dev.I < 1e-7 ? '≈ 0' : `${(dev.I * 1e6).toFixed(2)} μA`) },
    ],
  });
  return dev;
}

// ============================ 干电池 ============================
function dryCell({ key = 'ex', defaultSlot, E, r }) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(10, 1.2, 6), MAT.paint(0x1f2937), 0, 0.6, 0));
  const cell = new THREE.Group();
  cell.add(mesh(new THREE.CylinderGeometry(1.7, 1.7, 6, 24), new THREE.MeshStandardMaterial({ map: canvasTexture(256, 128, (c, W, H) => { c.fillStyle = '#1e40af'; c.fillRect(0, 0, W, H); c.fillStyle = '#facc15'; c.fillRect(0, H * 0.38, W, H * 0.24); c.fillStyle = '#fff'; c.font = `bold ${H * 0.2}px Arial`; c.fillText('1.5V  R20', W * 0.1, H * 0.56); }), roughness: 0.5 }), 0, 0, 0));
  cell.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12), MAT.chrome(), 0, 3.2, 0));
  cell.rotation.z = Math.PI / 2; cell.position.y = 3.0; g.add(cell);
  for (const x of [-3.6, 3.6]) g.add(mesh(new THREE.BoxGeometry(0.4, 3.2, 2.6), MAT.chrome(), x, 2.0, 0));
  const dev = {
    key, short: '干电池', E, r,
    terms: { '+': { pos: new THREE.Vector3(-3.0, 1.2, 2.2), label: '+' }, '-': { pos: new THREE.Vector3(3.0, 1.2, 2.2), label: '−', color: 0x1b1b1b } },
    elements(t) { return [{ type: 'V', a: t('+'), b: t('-'), E, r, tag: 'ex' }]; },
    after(sol, t, els) { this.I = Math.abs(sol.cur(els[0])); },
  };
  dev.comp = new Component({
    key, name: '待测干电池', icon: SVG('<rect x="10" y="13" width="40" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="50" y="17" width="4" height="6" fill="currentColor"/>'),
    zone: 'slot', defaultSlot, object: g, labelY: 7,
    desc: '1 号干电池（标称 1.5 V），用过一段时间，内阻约 1 Ω。',
  });
  return dev;
}

// ============================ 单刀双掷开关 ============================
function selector({ key = 'sel', defaultSlot }) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(12, 1.2, 6), MAT.paint(0x8b5a2b), 0, 0.6, 0));
  for (const x of [-4, 4]) g.add(mesh(new THREE.BoxGeometry(0.8, 1.6, 1), MAT.brass(), x, 1.6, -0.6));
  g.add(mesh(new THREE.BoxGeometry(0.9, 1.6, 1), MAT.brass(), 0, 1.6, 1.4));
  const blade = new THREE.Group(); blade.position.set(0, 2.3, 1.4);
  blade.add(mesh(new THREE.BoxGeometry(0.25, 0.7, 4.6), MAT.brass(), 0, 0, -2.2));
  blade.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.8, 10), MAT.black(), 0, 0.9, -4.4));
  g.add(blade);
  const lab = panelMesh(12, 1.6, (c, W, H) => { c.fillStyle = '#8b5a2b'; c.fillRect(0, 0, W, H); c.fillStyle = '#f5ecd8'; c.font = `bold ${H * 0.62}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Eₛ', W * 0.17, H / 2); c.fillText('Eₓ', W * 0.83, H / 2); });
  lab.rotation.x = -Math.PI / 2; lab.position.set(0, 1.22, -2.3); g.add(lab);
  const dev = {
    key, short: '换向开关', pos: 'off',
    terms: { s: { pos: new THREE.Vector3(-5, 1.2, 1.6), label: 'Eₛ', color: 0x1b1b1b }, com: { pos: new THREE.Vector3(0, 1.2, 2.4), label: '公共端', color: 0x1b1b1b }, x: { pos: new THREE.Vector3(5, 1.2, 1.6), label: 'Eₓ', color: 0x1b1b1b } },
    elements(t) { return this.pos === 'off' ? [] : [{ type: 'R', a: t('com'), b: t(this.pos), R: 0.004 }]; },
    after() { blade.rotation.y = this.pos === 's' ? 0.72 : this.pos === 'x' ? -0.72 : 0; blade.rotation.x = this.pos === 'off' ? -0.9 : 0; },
  };
  dev.comp = new Component({
    key, name: '单刀双掷开关 K₂', icon: SVG('<circle cx="10" cy="28" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="54" cy="28" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="32" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M32 13L14 26" stroke="currentColor" stroke-width="2"/>'),
    zone: 'slot', defaultSlot, object: g, labelY: 8,
    desc: '把检流计支路接到标准电池（Eₛ，校准）或待测电池（Eₓ，测量）。',
    controls: () => [{ type: 'segment', label: '刀闸位置', get: () => dev.pos, set: (v) => (dev.pos = v), options: [{ label: 'Eₛ', value: 's' }, { label: '断开', value: 'off' }, { label: 'Eₓ', value: 'x' }] }],
  });
  return dev;
}

// ============================ 实验 ============================
export class PotentiometerExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.E20 = Math.round((1.0186 + rand(-4e-5, 4e-5)) * 1e5) / 1e5;
    this.temp = Math.round(rand(14, 29) * 10) / 10;
    this.Ex = rand(1.50, 1.60);
    this.rx = rand(0.6, 1.6);
    this._warned = {};
  }

  cameras() {
    return [
      { name: '全景', pos: [0, 112, 96], target: [0, 0, -2] },
      { name: '电阻丝', pos: [-4, 70, 30], target: [-4, 0, -22] },
      { name: '滑键', pos: [20, 30, 6], target: [20, 0, -12] },
      { name: '检流计', pos: [30, 46, 62], target: [30, 2, 26] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    const slot = (id, x, z) => app.addSlot({ id, pos: new THREE.Vector3(x, 0, z), accepts: [id] });
    slot('pot', -4, -22); slot('supply', -72, 18); slot('K', -72, 36); slot('rp', -44, 14); slot('rp2', -44, 32);
    slot('es', -12, 18); slot('ex', 6, 18); slot('sel', -2, 34); slot('gp', 30, 14); slot('g', 30, 32); slot('rl', 64, 14); slot('K3', 64, 34);
    const cir = (this.cir = new Circuit(app));
    this.pot = cir.add(elevenWire({ defaultSlot: 'pot' }));
    this.sup = cir.add(dcSupply({ defaultSlot: 'supply', vmax: 15, imax: 1 }));
    this.K = cir.add(knifeSwitch({ key: 'K', name: '电源开关 K₁', defaultSlot: 'K' }));
    this.rp = cir.add(rheostat({ key: 'rp', name: '调节电阻 Rp（粗）50 Ω', R: 50, Imax: 1, defaultSlot: 'rp' }));
    this.rp2 = cir.add(rheostat({ key: 'rp2', name: '调节电阻 Rp′（细）5 Ω', R: 5, Imax: 1, defaultSlot: 'rp2' }));
    this.es = cir.add(standardCell({ defaultSlot: 'es', E20: this.E20, temp: this.temp }));
    this.ex = cir.add(dryCell({ defaultSlot: 'ex', E: this.Ex, r: this.rx }));
    this.sel = cir.add(selector({ defaultSlot: 'sel' }));
    this.g = cir.add(analogMeter({ key: 'g', name: '指针式检流计', short: '检流计', kind: 'G', center: true, divs: G_DIVS, perDiv: G_PER_DIV, Rg: 60, defaultSlot: 'g', desc: '零点在中央，左右各 30 格，每格约 0.3 μA，内阻约 60 Ω。' }));
    this.gp = cir.add(rheostat({ key: 'gp', name: '保护电阻 Rg（0–10 kΩ）', R: 10000, Imax: 0.05, defaultSlot: 'gp' }));
    this.rl = cir.add(resistanceBox({ key: 'rl', name: '电阻箱 R（负载）', defaultSlot: 'rl' }));
    this.K3 = cir.add(knifeSwitch({ key: 'K3', name: '负载开关 K₃', defaultSlot: 'K3' }));
    this.gv = app.addView({ id: 'g', title: '检流计', w: 260, h: 150, res: 1 });
    this.rv = app.addView({ id: 'ruler', title: '米尺（滑键 D 处）', w: 300, h: 120, res: 2 });
  }

  pointerDown(e) { return this.cir.pointerDown(e); }
  pointerMove(e) { return this.cir.pointerMove(e); }
  onRemove(c) { this.cir.removeDevice(c.key); }
  tick(dt) {
    this.cir.tick(dt);
    // 标准电池：电流超过 10 μA 时累计时间，超过 3 s 视为损坏（电动势下降）
    const es = this.es;
    if (es.comp.placed && es.I > ES_ILIM) {
      es.over += dt;
      if (es.over > 3 && !es.damage) { es.damage = rand(3e-4, 8e-4); this.app.toast('标准电池长时间通过大电流，已经损坏：电动势下降，此后的校准不再可靠', 'warn'); this.app.changed(); }
    }
  }

  update() {
    this.cir.solve();
    const v = this.gv;
    drawDialFace(v.ctx, 0, 0, v.W, v.H, { kind: 'G', divs: G_DIVS, center: true, cls: '', unit: 'G', theta: this.g.comp.placed ? this.g.theta : 0 });
    v.foot(this.pot.comp.placed ? `插头 C 在 ${this.pot.n} 号孔 · 滑键${this.pot.pressed ? '按下' : '抬起'} · K₂ ${this.sel.pos === 's' ? '接 Eₛ' : this.sel.pos === 'x' ? '接 Eₓ' : '断开'}` : '');
    this.drawRuler();
    const over = this.g.comp.placed && Math.abs(this.g.target) > 0.52;
    if (over && !this._warned.g) this.app.toast('检流计过载！松开滑键，加大保护电阻', 'warn');
    this._warned.g = over;
    const esHi = this.es.comp.placed && this.es.I > ES_ILIM;
    if (esHi && !this._warned.es) this.app.toast(`标准电池电流 ${(this.es.I * 1e6).toFixed(0)} μA，过大！应立即松开滑键`, 'warn');
    this._warned.es = esHi;
  }

  drawRuler() {
    const v = this.rv, c = v.ctx, W = v.W, H = v.H;
    const x = this.pot.x * 1000; // mm
    const span = 24, k = W / span, x0 = x - span / 2;
    c.fillStyle = '#b7925e'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#efe6cf'; c.fillRect(0, H * 0.46, W, H * 0.54);
    c.strokeStyle = '#2a2a2a'; c.fillStyle = '#2a2a2a';
    for (let m = Math.floor(x0); m <= x0 + span + 1; m++) {
      if (m < 0 || m > 1000) continue;
      const px = (m - x0) * k, l = m % 10 === 0 ? 0.3 : m % 5 === 0 ? 0.2 : 0.12;
      c.lineWidth = m % 10 === 0 ? 2.2 : 1.4; c.beginPath(); c.moveTo(px, H * 0.46); c.lineTo(px, H * (0.46 + l)); c.stroke();
      if (m % 10 === 0) { c.font = `bold ${H * 0.16}px Arial`; c.textAlign = 'center'; c.fillText(String(m / 10), px, H * 0.94); }
    }
    // 电阻丝与滑键刀口
    c.strokeStyle = '#8a8378'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, H * 0.3); c.lineTo(W, H * 0.3); c.stroke();
    const px = W / 2;
    c.fillStyle = 'rgba(17,17,17,.92)'; c.fillRect(px - 26, 0, 52, H * 0.24);
    c.fillStyle = '#c8a24a'; c.beginPath(); c.moveTo(px - 4, H * 0.24); c.lineTo(px + 4, H * 0.24); c.lineTo(px + 0.6, H * 0.62); c.lineTo(px - 0.6, H * 0.62); c.closePath(); c.fill();
    c.strokeStyle = '#7a5a12'; c.lineWidth = 1; c.beginPath(); c.moveTo(px, H * 0.24); c.lineTo(px, H * 0.62); c.stroke();
    v.foot('刻度单位 cm，最小分度 1 mm；读刀口所对位置，估读到 0.1 mm');
  }

  // ---------------- 接线识别 ----------------
  /** 补偿回路：Eₛ、Eₓ 的正极接 C，负极分别接 K₂ 的两个刀位，K₂ 公共端经保护电阻、检流计接 D */
  compOK() {
    const c = this.cir;
    if (!['pot', 'es', 'ex', 'sel', 'g', 'gp'].every((k) => c.placed(k))) return false;
    const n = c.nets(), N = (s) => n(s);
    if (N('es:+') !== N('pot:C') || N('ex:+') !== N('pot:C') || N('es:-') !== N('sel:s') || N('ex:-') !== N('sel:x')) return false;
    const S = N('sel:com'), E = N('pot:D');
    const two = (k, a, b) => [N(`${k}:${a}`), N(`${k}:${b}`)];
    const gpN = two('gp', 'A', 'C'), gN = two('g', '+', '-');
    const via = (p, q) => { for (const [u, w] of [[p[0], p[1]], [p[1], p[0]]]) for (const [y, z] of [[q[0], q[1]], [q[1], q[0]]]) if (u === S && w === y && z === E) return true; return false; };
    return via(gpN, gN) || via(gN, gpN);
  }
  /** 工作回路：电流从 A 流向 B（A 接正极） */
  workOK() { return this.pot.comp.placed && this.sup.on && this.K.closed && this.pot.Iw > 0.005; }
  workWiring() { return [['supply:+', 'K:a'], ['K:b', 'rp:A'], ['rp:C', 'rp2:A'], ['rp2:C', 'pot:A'], ['pot:B', 'supply:-']]; }
  compWiring() { return [['es:+', 'pot:C'], ['ex:+', 'pot:C'], ['es:-', 'sel:s'], ['ex:-', 'sel:x'], ['sel:com', 'gp:A'], ['gp:C', 'g:+'], ['g:-', 'pot:D']]; }
  loadWiring() { return [['rl:b', 'ex:+'], ['rl:a', 'K3:a'], ['K3:b', 'ex:-']]; }

  /** 已校准的单位长度电压（取最近一次校准） */
  U0() {
    const cal = this.app.table('cal').completeRows();
    if (!cal.length) return NaN;
    const r = cal[cal.length - 1];
    return westonE(this.E20, r.t) / (r.n + r.x);
  }

  tables() {
    const L = (r) => r.n + r.x;
    return [
      {
        id: 'cal', title: '校准工作电流', maxRows: 6,
        columns: [
          { key: 't', label: '室温 t/°C', digits: 1, auto: true },
          { key: 'Es', label: 'Eₜ/V', digits: 5, calc: (r) => westonE(this.E20, r.t) },
          { key: 'n', label: 'C 插孔号', digits: 0, auto: true },
          { key: 'x', label: '滑键读数/m', digits: 4, readTol: 0.0003 },
          { key: 'Ls', label: 'Lₛ/m', digits: 4, calc: L },
          { key: 'U0', label: 'U₀/(V/m)', digits: 5, calc: (r) => westonE(this.E20, r.t) / L(r) },
        ],
        buttons: [{ label: '记录（校准平衡时）', onClick: (t) => this.recCal(t) }],
        note: `先按室温算出标准电池的电动势 $E_t$，取 $U_0=0.2$ V/m，把 C、D 之间的长度定为 $L_s=E_t/U_0$，再调 Rp 使检流计指零。铭牌：$E_{20}=${this.E20.toFixed(5)}$ V。`,
      },
      {
        id: 'ex', title: '测电动势 Eₓ', maxRows: 8,
        columns: [
          { key: 'n', label: 'C 插孔号', digits: 0, auto: true },
          { key: 'x', label: '滑键读数/m', digits: 4, readTol: 0.0003 },
          { key: 'Lx', label: 'Lₓ/m', digits: 4, calc: L },
          { key: 'Ex', label: 'Eₓ = U₀Lₓ /V', digits: 5, calc: (r) => this.U0() * L(r) },
        ],
        buttons: [{ label: '记录（测量平衡时）', onClick: (t) => this.recEx(t) }],
        note: '保持 Rp 不动，K₂ 扳向 Eₓ，移动 C、D 使检流计指零。每次测量前都应重新检查校准。',
      },
      {
        id: 'r', title: '测内阻', maxRows: 6,
        columns: [
          { key: 'R', label: '负载 R/Ω', digits: 1, auto: true },
          { key: 'n', label: 'C 插孔号', digits: 0, auto: true },
          { key: 'x', label: '滑键读数/m', digits: 4, readTol: 0.0003 },
          { key: 'Lp', label: "L′/m", digits: 4, calc: L },
          { key: 'r', label: 'r/Ω', digits: 3, calc: (r) => (this.lxMean() / L(r) - 1) * r.R },
        ],
        buttons: [{ label: '记录（接负载、平衡时）', onClick: (t) => this.recR(t) }],
        note: "合上 K₃，干电池接上负载电阻 R，测出端电压对应的长度 L′。$r=(L_x/L'-1)R$。",
      },
    ];
  }
  lxMean() { const xs = this.app.table('ex').completeRows().map((r) => r.n + r.x); return xs.length ? mean(xs) : NaN; }

  checkBal(sel) {
    const app = this.app;
    if (!this.workOK()) { app.toast('工作回路没有电流（检查电源、开关 K₁ 和 A、B 两端的极性）', 'warn'); return false; }
    if (!this.compOK()) { app.toast('补偿回路没有接好', 'warn'); return false; }
    if (this.sel.pos !== sel) app.toast(sel === 's' ? 'K₂ 没有扳向 Eₛ，平衡的不是标准电池' : 'K₂ 没有扳向 Eₓ，平衡的不是待测电池', 'warn');
    if (!this.pot.pressed) app.toast('没有按下滑键，检流计不通电，并没有判断是否平衡', 'warn');
    if (this.gp.s * 10000 > 50) app.toast('保护电阻没有减到零，平衡判断不够灵敏', 'warn');
    if (Math.abs(this.g.theta * G_DIVS) > 0.5) app.toast('检流计还没有指零', 'warn');
    return true;
  }
  recCal(t) {
    if (!this.checkBal('s')) return;
    t.addRow({ t: this.temp, n: this.pot.n, x: Math.round(this.pot.x * 1e4) / 1e4 });
  }
  recEx(t) {
    if (!this.app.table('cal').completeRows().length) this.app.toast('请先校准工作电流', 'warn');
    if (!this.checkBal('x')) return;
    if (this.ex.I > 0.01) this.app.toast('负载开关 K₃ 合着，测到的是端电压而不是电动势', 'warn');
    t.addRow({ n: this.pot.n, x: Math.round(this.pot.x * 1e4) / 1e4 });
  }
  recR(t) {
    if (!this.app.table('ex').completeRows().length) this.app.toast('请先测电动势', 'warn');
    if (!this.checkBal('x')) return;
    if (!(this.ex.I > 0.05)) this.app.toast('干电池没有接上负载（合上 K₃，电阻箱并在电池两端）', 'warn');
    t.addRow({ R: this.rl.nominal(), n: this.pot.n, x: Math.round(this.pot.x * 1e4) / 1e4 });
  }

  // ---------------- 自动操作 ----------------
  snap() { const p = this.pot; return [p.n, p.x, p.pressed, this.rp.s, this.rp2.s, this.gp.s, this.sel.pos]; }
  restore(s) { const p = this.pot; [p.n, p.x, p.pressed, this.rp.s, this.rp2.s, this.gp.s, this.sel.pos] = s; }
  gWith(mut) { const s = this.snap(); mut(); this.cir.solve(); const v = this.g.target; this.restore(s); this.cir.solve(); return v; }
  setL(L) { const p = this.pot; p.n = Math.min(10, Math.floor(L)); p.x = L - p.n; }
  /** 二分法：找使检流计为零的参数 */
  bisect(f, lo, hi, n = 40) {
    let flo = Math.sign(f(lo));
    for (let i = 0; i < n; i++) { const m = (lo + hi) / 2; if (Math.sign(f(m)) === flo) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  async press(on) { this.pot.pressed = on; this.app.changed(); await this.app.wait(on ? 450 : 150); }
  async calibrate() {
    const app = this.app, p = this.pot;
    const Ls = westonE(this.E20, this.temp) / U0_SET;
    app.select(this.sel.comp); this.sel.pos = 's'; app.changed(); await app.wait(200);
    app.select(p.comp);
    p.n = Math.floor(Ls); app.changed(); await app.wait(200);
    await app.tween(() => p.x, (v) => (p.x = v), Math.round((Ls - p.n) * 1e4) / 1e4, 700);
    // 粗调：保护电阻最大，跃接
    app.select(this.gp.comp); await app.tween(() => this.gp.s, (v) => (this.gp.s = v), 1, 400);
    const gc = (s) => this.gWith(() => { this.rp.s = s; this.rp2.s = 0.5; this.pot.pressed = true; });
    const sc = Math.floor(this.bisect(gc, 0, 1) * 1000) / 1000;
    app.select(this.rp.comp); await app.tween(() => this.rp.s, (v) => (this.rp.s = v), sc, 800);
    await app.tween(() => this.rp2.s, (v) => (this.rp2.s = v), 0.5, 300);
    await this.press(true); await this.cir.settle([this.g], 1200); await this.press(false);
    // 细调：保护电阻减到零
    app.select(this.gp.comp); await app.tween(() => this.gp.s, (v) => (this.gp.s = v), 0, 500);
    const gf = (s) => this.gWith(() => { this.rp2.s = s; this.pot.pressed = true; this.gp.s = 0; });
    const sf = Math.round(this.bisect(gf, 0, 1) * 1000) / 1000;
    app.select(this.rp2.comp); await app.tween(() => this.rp2.s, (v) => (this.rp2.s = v), sf, 700); this.rp2.s = sf;
    await this.press(true); await this.cir.settle([this.g], 5000);
    app.showTable(0); await app.record('cal');
    await this.press(false);
  }
  async balanceX() {
    const app = this.app, p = this.pot;
    app.select(this.sel.comp); this.sel.pos = 'x'; app.changed(); await app.wait(200);
    const f = (L) => this.gWith(() => { this.setL(L); this.pot.pressed = true; this.gp.s = 0; });
    const L = this.bisect(f, 0.001, 10.999);
    // 先粗略放到附近（保护电阻最大），再细找
    app.select(this.gp.comp); await app.tween(() => this.gp.s, (v) => (this.gp.s = v), 1, 400);
    app.select(p.comp);
    p.n = Math.min(10, Math.floor(L)); app.changed(); await app.wait(250);
    await app.tween(() => p.x, (v) => (p.x = v), clamp(L - p.n + rand(-0.01, 0.01), 0, 1), 800);
    await this.press(true); await this.cir.settle([this.g], 1200); await this.press(false);
    app.select(this.gp.comp); await app.tween(() => this.gp.s, (v) => (this.gp.s = v), 0, 500);
    app.select(p.comp);
    const q = Math.round((L - p.n) * 1e4) / 1e4;
    const cand = [q - 1e-4, q, q + 1e-4].filter((v) => v >= 0 && v <= 1);
    const best = cand.reduce((a, c) => (Math.abs(this.gWith(() => { p.x = c; p.pressed = true; })) < Math.abs(this.gWith(() => { p.x = a; p.pressed = true; })) ? c : a));
    await app.tween(() => p.x, (v) => (p.x = v), best, 600); p.x = best;
    await this.press(true); await this.cir.settle([this.g], 5000);
  }

  steps() {
    const app = this.app, cir = this.cir;
    const main = ['pot', 'supply', 'K', 'rp', 'rp2', 'es', 'ex', 'sel', 'g', 'gp'];
    return [
      {
        title: '摆放仪器',
        html: '<p>把十一线电位差计、稳压电源、开关 K₁、调节电阻 Rp（粗、细各一个）、标准电池、待测干电池、单刀双掷开关 K₂、检流计和保护电阻放到桌上。</p>',
        check: () => main.every((k) => cir.placed(k)),
        auto: async () => { await app.view('全景'); for (const k of main) await app.autoPlace(k); },
      },
      {
        title: '连接工作回路和补偿回路',
        html: '<p><b>工作回路</b>：电源正极 → K₁ → Rp（粗） → Rp′（细） → 电位差计 A 端，B 端回电源负极。<b>补偿回路</b>：标准电池和干电池的<b>正极都接插头 C</b>，负极分别接 K₂ 的 Eₛ、Eₓ 两个刀位，K₂ 的公共端经保护电阻、检流计接滑键 D。</p>',
        hint: '工作电流从 A 流向 B，A 端电位高。被测电池的正极必须接在电位高的一端（C），才可能与电阻丝上的电压“对顶”而平衡。',
        check: () => this.compOK() && (() => { const n = cir.nets(); return n('pot:A') !== n('pot:B') && cir.wired('pot:A') && cir.wired('pot:B'); })(),
        status: () => (this.compOK() ? '补偿回路已接好' : '补偿回路未接好'),
        auto: async () => { await cir.rewire([...this.workWiring(), ...this.compWiring()]); },
      },
      {
        title: '校准工作电流',
        html: `<p>读室温（标准电池盒上的温度计），按铭牌上的 $E_{20}$ 算出此温度下的 $E_t$。取 $U_0=0.200\\,0$ V/m，算出 $L_s=E_t/U_0$，把插头 C 插入整数部分的插孔，滑键 D 放到小数部分。</p><p>电源调到约 3 V，合上 K₁，K₂ 扳向 Eₛ。保护电阻放最大，<b>跃接</b>滑键，调 Rp 使检流计偏转变小；再把保护电阻减到零，用细调 Rp′ 使检流计指零，记录。</p>`,
        hint: '$E_t=E_{20}-[39.94(t-20)+0.929(t-20)^2-0.009(t-20)^3]\\times10^{-6}$ V',
        check: () => app.table('cal').completeRows().length > 0,
        auto: async () => {
          const sp = this.sup; app.select(sp.comp); sp.on = true; await app.tween(() => sp.Vset, (v) => (sp.Vset = v), 3, 500);
          app.select(this.K.comp); this.K.closed = true; app.changed();
          this.rp.s = 0.6; this.rp2.s = 0.5;
          await app.view('电阻丝');
          await this.calibrate();
        },
      },
      {
        title: '测干电池的电动势',
        html: '<p><b>Rp、Rp′ 不能再动。</b>K₂ 扳向 Eₓ，保护电阻放最大，移动插头 C 和滑键 D 找到使检流计偏转最小的位置；减小保护电阻后细调 D 到指零，记录。重复 3 次，每次之前把 K₂ 扳回 Eₛ 检查校准是否改变。</p>',
        check: () => app.table('ex').completeRows().length >= 3,
        auto: async () => {
          for (let i = app.table('ex').completeRows().length; i < 3; i++) {
            if (i > 0) await this.calibrate();
            await this.balanceX();
            app.showTable(1); await app.record('ex');
            await this.press(false);
          }
        },
      },
      {
        title: '测干电池的内阻',
        html: '<p>把电阻箱 R 和开关 K₃ 串联后并在干电池两端。R 取 10 Ω，合上 K₃，此时测到的是端电压 $U=E_x R/(R+r)$，对应长度 $L\'$。记录后再取 R = 5 Ω 测一次。测完立即断开 K₃，免得电池长时间放电。</p>',
        check: () => app.table('r').completeRows().length >= 2,
        auto: async () => {
          for (const k of ['rl', 'K3']) await app.autoPlace(k);
          await cir.rewire([...this.workWiring(), ...this.compWiring(), ...this.loadWiring()]);
          for (const R of [10, 5]) {
            app.select(this.rl.comp); this.rl.set(R); app.changed(); await app.wait(300);
            app.select(this.K3.comp); this.K3.closed = true; app.changed(); await app.wait(200);
            await this.balanceX();
            app.showTable(2); await app.record('r');
            await this.press(false);
            this.K3.closed = false; app.changed();
          }
          this.K.closed = false; this.sel.pos = 'off'; app.changed();
        },
      },
      {
        title: '数据处理',
        html: '<p>由校准求 $U_0$，算 $E_x=U_0L_x$ 并估算不确定度；由 $L_x$、$L\'$ 算内阻。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const app = this.app;
    const cal = app.table('cal').completeRows(), ex = app.table('ex').completeRows(), rr = app.table('r').completeRows();
    if (!cal.length || !ex.length) return { html: '<p>请先校准工作电流并测电动势。</p>', ok: false };
    const last = cal[cal.length - 1];
    const Et = westonE(this.E20, last.t), Ls = last.n + last.x, U0 = Et / Ls;
    const Lx = ex.map((r) => r.n + r.x), Exs = Lx.map((L) => U0 * L), E = mean(Exs);
    let html = `<h3>1. 标准电池电动势与工作电流的校准</h3><p>室温 $t=${last.t.toFixed(1)}$ °C，$E_t=${this.E20.toFixed(5)}-[39.94(${(last.t - 20).toFixed(1)})+0.929(${(last.t - 20).toFixed(1)})^2-0.009(${(last.t - 20).toFixed(1)})^3]\\times10^{-6}=${Et.toFixed(5)}$ V。</p>
      <p>校准时 $L_s=${Ls.toFixed(4)}$ m，$U_0=E_t/L_s=${U0.toFixed(5)}$ V/m。</p>`;
    const ua = uA(Exs);
    const uL = 0.0003 / Math.sqrt(3); // 滑键读数与平衡判断，约 0.3 mm
    const uRel = Math.sqrt((uL / mean(Lx)) ** 2 + (uL / Ls) ** 2 + (5e-5 / Math.sqrt(3)) ** 2 + (5e-4 / Math.sqrt(3)) ** 2);
    const uB = E * uRel, u = Math.hypot(ua, uB);
    html += `<h3>2. 电动势</h3><table><tr><th>次</th><th>$L_x$/m</th><th>$E_x$/V</th></tr>${Lx.map((L, i) => `<tr><td>${i + 1}</td><td>${L.toFixed(4)}</td><td>${Exs[i].toFixed(5)}</td></tr>`).join('')}</table>
      <p>$\\bar E_x=${E.toFixed(5)}$ V。A 类不确定度 $u_A=${(ua * 1e3).toFixed(3)}$ mV；B 类：长度读数与平衡判断各约 0.3 mm，标准电池 0.005 级，电阻丝不均匀约 0.05%，合成 $u_B=${(uB * 1e3).toFixed(3)}$ mV。</p>
      <div class="result-box">$E_x=(${E.toFixed(4)}\\pm${u.toFixed(4)})$ V</div>`;
    const answers = [
      { label: '$U_0$', unit: 'V/m', value: U0, digits: 5, tolRel: 0.0004 },
      { label: '$E_x$', unit: 'V', value: E, digits: 4, tolRel: 0.0004 },
    ];
    const tail = [`干电池实际电动势 ${this.Ex.toFixed(5)} V，测量值相对误差 ${pct(relErr(E, this.Ex), 3)}`];
    if (this.es.damage) tail.push(`标准电池在实验中被大电流损坏，电动势下降了 ${(this.es.damage * 1e3).toFixed(2)} mV，校准偏了`);
    if (rr.length) {
      const LxM = mean(Lx);
      const rs = rr.map((r) => (LxM / (r.n + r.x) - 1) * r.R), rm = mean(rs);
      html += `<h3>3. 内阻</h3><table><tr><th>$R$/Ω</th><th>$L'$/m</th><th>$r=(L_x/L'-1)R$ /Ω</th></tr>${rr.map((r, i) => `<tr><td>${r.R.toFixed(1)}</td><td>${(r.n + r.x).toFixed(4)}</td><td>${rs[i].toFixed(3)}</td></tr>`).join('')}</table>
        <p>平均 $\\bar r=${rm.toFixed(3)}$ Ω。$L_x-L'$ 只有几百毫米，长度读数 0.3 mm 引起的相对误差约 ${pct(0.0003 / (LxM - mean(rr.map((r) => r.n + r.x))), 1)}。</p><div class="result-box">$r\\approx${rm.toFixed(2)}$ Ω</div>`;
      answers.push({ label: '$r$', unit: 'Ω', value: rm, digits: 3, tolRel: 0.02 });
      tail.push(`实际内阻 ${this.rx.toFixed(3)} Ω，相对误差 ${pct(relErr(rm, this.rx), 1)}`);
    }
    html += `<div class="result-box warn">${tail.join('；')}。</div>`;
    return { html, ok: true, answers, plots: [] };
  }

  principle() {
    return `<h3>1. 补偿法</h3><p>用电压表测电池两端电压时，电池中有电流 $I$，读数是端电压 $U=E-Ir$，不是电动势。补偿法用一个可调的已知电压 $U_{CD}$ 与被测电池“对顶”：当检流计中无电流时 $E_x=U_{CD}$，此时被测电池不输出电流，内阻上没有电压降。</p>
${potentiometerFig()}
<h3>2. 十一线电位差计</h3><p>工作电流 $I_0$ 流过均匀电阻丝 AB，丝上单位长度的电压 $U_0=I_0r_0$ 处处相等，C、D 间长度为 $L$ 时 $U_{CD}=U_0L$。十一根各 1 m 的电阻丝中，十根经插孔折返，插头 C 选整米数，第十一根直丝上的滑键 D 读小数部分。</p>
<h3>3. 校准工作电流</h3><p>标准电池的电动势已知（随温度略有变化，需按公式修正）。先定 $U_0$（本实验取 0.2 V/m），把 C、D 间长度定为 $L_s=E_s/U_0$，调 Rp 使检流计指零，工作电流就被“校准”。此后 Rp 不能再动，于是</p>$$E_x=U_0L_x=\\frac{L_x}{L_s}E_s$$<p>结果只取决于标准电池和两个长度之比，与电阻丝每米的阻值、工作电流的具体数值无关。</p>
<h3>4. 内阻</h3><p>电池接上负载 R 后，测到的是端电压 $U=U_0L'=\\dfrac{R}{R+r}E_x$，所以 $r=\\left(\\dfrac{L_x}{L'}-1\\right)R$。</p>
<h3>5. 注意事项</h3><p>工作电源与被测电池必须“正对正”（都接在电位高的一端），否则找不到平衡点。标准电池只能通过微安级电流：调平衡时先串大的保护电阻、跃接滑键，接近平衡后再减小保护电阻。</p>
<h3>6. 本仿真的计算模型</h3><p>整个电路（含 11 段电阻丝、导线和接触电阻、标准电池和干电池的内阻、检流计内阻、保护电阻）用改进节点法求解；各段电阻丝有 ±0.05% 的不均匀，直丝沿长度有微小起伏。标准电池按 Wolff 温度公式计算电动势，通过它的电流超过 10 μA 累计 3 s 会损坏（电动势下降）。</p>`;
  }
}
