// 实验六：光的偏振（马吕斯定律 · 1/2 波片 · 1/4 波片）
import * as THREE from 'three';
import { meta, thumb } from './polarization.meta.js';
import { Component } from '../core/Component.js';
import { AXIS_Y, MAT, mesh, labTable, opticalRail, carriage, laserMesh, Beam, ICONS, meterBox, rotatorMesh } from '../core/Models.js';
import { sourceStokes, polarizerM, retarderM, applyM, ellipseOf, rad, deg } from '../physics/polarization.js';
import { linFit, fmtU, texU, gauss, rand, pct, sig } from '../core/Stats.js';
import { fnData } from '../core/Plot.js';

const P0 = 1000; // 激光功率 μW
const RANGES = [20, 200, 2000]; // μW
const OPT = ['p1', 'hwp', 'qwp', 'p2'];
const wrap360 = (v) => ((v % 360) + 360) % 360;
/** 把角度差折算到 (−p/2, p/2] */
const angDiff = (a, b, p = 180) => { let d = (((a - b) % p) + p) % p; if (d > p / 2) d -= p; return d; };
const rngLabel = (r) => (r >= 1000 ? '2 mW' : `${r} μW`);

export class PolarizationExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.laserOn = false;
    this.srcPsi = rand(0, Math.PI);
    this.srcDop = rand(0.25, 0.45);
    // 各转盘读数与“0 刻度—主轴”偏差（度）
    this.r = { p1: 0, p2: Math.round(rand(20, 70)), hwp: 0, qwp: 0 };
    this.o = { p1: rand(-8, 8), p2: rand(-8, 8), hwp: rand(-30, 30), qwp: rand(-30, 30) };
    this.dH = Math.PI * (1 + gauss(0.015));
    this.dQ = (Math.PI / 2) * (1 + gauss(0.02));
    this.range = 2;
    this.showEll = true;
    this.fluct = 0; this.noise = 0.01;
  }

  cameras() {
    return [
      { name: '全景', pos: [48, 70, 125], target: [48, 18, 0] },
      { name: '元件', pos: [45, 34, 42], target: [45, 22, 0] },
      { name: '探头', pos: [72, 36, 48], target: [86, 16, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(210, 80); t.position.set(50, 0, 0); scene.add(t);
    scene.add(opticalRail(100));
    app.addRail({ origin: new THREE.Vector3(0, 0, 0), min: 0, max: 100 });
    app.stage.setLightTarget(50, 0, 0);

    const lc = carriage(0x9aa3b2, AXIS_Y);
    const lz = laserMesh(24); lz.group.position.set(2, 0, 0); lc.top.add(lz.group);
    this.laserAp = lz.aperture;
    app.addComponent(new Component({
      key: 'laser', name: 'He-Ne 激光器', icon: ICONS.laser, zone: 'rail', defaultPos: 4, required: true, object: lc.group, labelY: 30,
      desc: '632.8 nm，输出约 1 mW 的部分偏振光。',
      controls: () => [{ type: 'toggle', label: '激光电源', get: () => this.laserOn, set: (v) => (this.laserOn = v) }],
    }));

    this.rot = {};
    const rotComp = (key, name, tint, pos, desc, extra = []) => {
      const c = carriage(0x9aa3b2, AXIS_Y);
      const r = rotatorMesh(tint);
      c.top.add(r.group);
      this.rot[key] = r.rot;
      app.addComponent(new Component({
        key, name, icon: key.startsWith('p') ? ICONS.polarizer : ICONS.waveplate, zone: 'rail', defaultPos: pos, required: key.startsWith('p'), object: c.group, labelY: 31, desc,
        controls: () => [
          { type: 'knob', label: '转盘读数', get: () => this.r[key], set: (v) => (this.r[key] = v), wrap: 360, step: 0.5, bigStep: 5, perRev: 30, digits: 1, unit: '°', sub: '刻度分度值 1°，可估读到 0.5°' },
          ...extra,
        ],
      }));
    };
    rotComp('p1', '起偏器 P₁', 0x3b4a6b, 22, '偏振片，透振方向与转盘 0 刻度不一定重合。');
    rotComp('hwp', '1/2 波片', 0x6b5a2c, 45, '对 632.8 nm 的半波片（云母），快轴方向未知。');
    rotComp('qwp', '1/4 波片', 0x2c6b4f, 45, '对 632.8 nm 的四分之一波片，快轴方向未知。');
    rotComp('p2', '检偏器 P₂', 0x3b4a6b, 66, '偏振片，用作检偏器。');

    // 探头 + 光功率计
    const dc = carriage(0x9aa3b2, AXIS_Y);
    const head = new THREE.Group();
    head.add(mesh(new THREE.CylinderGeometry(2, 2, 5, 28), MAT.black(), 1.2, 0, 0).rotateZ(Math.PI / 2));
    head.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.2, 24), MAT.emissive(0x222222, 0.1), -1.35, 0, 0).rotateZ(Math.PI / 2));
    dc.top.add(head);
    const meter = meterBox(14, 8, 9, '光功率计');
    meter.group.position.set(4, -AXIS_Y, 17); meter.group.rotation.y = -0.25;
    dc.group.add(meter.group);
    this.meter = meter;
    app.addComponent(new Component({
      key: 'det', name: '光电探头与光功率计', icon: ICONS.detector, zone: 'rail', defaultPos: 86, required: true, object: dc.group, labelY: 30,
      desc: '硅光电池探头，光功率计量程 20 μW / 200 μW / 2 mW。',
      controls: () => [
        { type: 'segment', label: '量程', get: () => this.range, set: (v) => (this.range = v), options: RANGES.map((r, i) => ({ label: rngLabel(r), value: i })) },
        { type: 'readout', label: '光功率计示数', get: () => this.meterStr() },
      ],
    }));

    this.beams = [0, 1, 2, 3, 4].map(() => { const b = new Beam(0xff2a2a, 0.09, 0.35); scene.add(b.group); return b; });
    this.ellView = app.addView({ id: 'ell', title: '偏振态示意（教学辅助）', w: 300, h: 118, res: 1.6 });
  }

  canPlace(comp) {
    if (comp.key === 'hwp' && this.app.comp('qwp').placed) return '光路中已有 1/4 波片，请先取下';
    if (comp.key === 'qwp' && this.app.comp('hwp').placed) return '光路中已有 1/2 波片，请先取下';
    return null;
  }

  // ---------------- 物理 ----------------
  axis(key) { return rad(this.r[key] + this.o[key]); }
  M(key) {
    if (key === 'p1' || key === 'p2') return polarizerM(this.axis(key));
    return retarderM(this.axis(key), key === 'hwp' ? this.dH : this.dQ);
  }
  /** 沿光路依次经过的元件（位于激光器与探头之间） */
  chain() {
    const app = this.app, l = app.comp('laser'), d = app.comp('det');
    if (!l.placed) return [];
    const end = d.placed ? d.pos : 1e9;
    return OPT.map((k) => app.comp(k)).filter((c) => c.placed && c.pos > l.pos && c.pos < end).sort((a, b) => a.pos - b.pos);
  }
  /** 在 key 元件之前（不含）的斯托克斯矢量；key 省略则到达探头 */
  stokes(beforeKey) {
    let S = sourceStokes(this.laserOn ? 1 : 0, this.srcDop, this.srcPsi);
    for (const c of this.chain()) { if (c.key === beforeKey) break; S = applyM(this.M(c.key), S); }
    return S;
  }
  lit() { return this.laserOn && this.app.comp('laser').placed && this.app.comp('det').placed && this.app.comp('det').pos > this.app.comp('laser').pos; }
  power() { return this.lit() ? this.stokes()[0] * P0 * (1 + this.fluct) * this.app.coaxT('det') + this.noise : this.noise; }
  meterRead() {
    const r = RANGES[this.range], p = this.power();
    if (p > r * 0.9995) return { over: true };
    const dec = r === 20 ? 2 : r === 200 ? 1 : 0;
    return { value: +p.toFixed(dec), str: p.toFixed(dec) };
  }
  meterStr() { if (!this.app.comp('det').placed) return '----'; const m = this.meterRead(); return m.over ? '1  (超量程)' : `${m.str} μW`; }
  bestRange(p = this.power()) { const i = RANGES.findIndex((r) => r > p * 1.03); return i < 0 ? 2 : i; }
  /** 检偏器 P₂ 转一周时探头光强的极大、极小（理论值，用于判断） */
  p2Extremes() {
    const S = this.stokes('p2'), p = 0.85, q = 0.00085;
    const L = Math.hypot(S[1], S[2]);
    const k = (P0 * (1 + this.fluct));
    return { max: ((p + q) / 2 * S[0] + (p - q) / 2 * L) * k, min: ((p + q) / 2 * S[0] - (p - q) / 2 * L) * k, psi: 0.5 * Math.atan2(S[2], S[1]) };
  }
  /** 使 P₂ 位于极小（ext=true）或极大时的转盘读数，取离当前读数最近者 */
  p2Target(ext = true, near = this.r.p2) {
    const { psi } = this.p2Extremes();
    const base = deg(psi) + (ext ? 90 : 0) - this.o.p2;
    return near + angDiff(base, near, 180);
  }
  /** P₂ 与 P₁ 是否正交（度） */
  crossErr() { return angDiff(this.r.p2 + this.o.p2, this.r.p1 + this.o.p1 + 90, 180); }
  plateErr(k) { return angDiff(this.r[k] + this.o[k], this.r.p1 + this.o.p1, 90); }
  relI() { const e = this.p2Extremes(); return e.max > 0 ? (this.power() - this.noise) / e.max : 1; }

  // ---------------- 显示 ----------------
  update() {
    const app = this.app;
    this.fluct = gauss(0.002); this.noise = 0.004 + Math.abs(gauss(0.004));
    this.laserAp.material.emissiveIntensity = this.laserOn && app.comp('laser').placed ? 3 : 0.1;
    for (const k of OPT) this.rot[k].rotation.x = -rad(this.r[k]);
    // 分段光束
    const P = (x) => this.app.coaxV(x, AXIS_Y); // 光束沿实际光路
    const l = app.comp('laser');
    this.beams.forEach((b) => b.hide());
    if (this.laserOn && l.placed) {
      let S = sourceStokes(1, this.srcDop, this.srcPsi), x = l.pos + 2.4, i = 0;
      for (const c of this.chain()) { this.beams[i++].set(P(x), P(c.pos), S[0]); S = applyM(this.M(c.key), S); x = c.pos; }
      const d = app.comp('det');
      this.beams[i].set(P(x), P(d.placed && d.pos > x ? d.pos - 1.3 : 100), S[0]);
    }
    const m = this.meterRead();
    this.meter.setText(app.comp('det').placed ? (m.over ? '1   ' : m.str) : '----', 'μW', `量程 ${rngLabel(RANGES[this.range])}`);
    this.drawEllipses();
  }

  drawEllipses() {
    const v = this.ellView, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#101513'; g.fillRect(0, 0, W, H);
    if (!this.showEll) { v.foot('已隐藏（可在“测量与读数”中打开）'); return; }
    const ch = this.lit() || this.laserOn ? this.chain() : [];
    const panels = [{ name: '入射光', S: this.laserOn && this.app.comp('laser').placed ? sourceStokes(1, this.srcDop, this.srcPsi) : [0, 0, 0, 0] }];
    let S = panels[0].S;
    for (const c of ch) { S = applyM(this.M(c.key), S); panels.push({ name: { p1: 'P₁ 后', hwp: '1/2 波片后', qwp: '1/4 波片后', p2: 'P₂ 后' }[c.key], S }); }
    const n = panels.length, pw = W / n, R = Math.min(pw * 0.34, H * 0.3);
    g.font = `${Math.round(H * 0.085)}px "Noto Serif SC", serif`; g.textAlign = 'center';
    panels.forEach((p, i) => {
      const cx = pw * (i + 0.5), cy = H * 0.4;
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - R - 4, cy); g.lineTo(cx + R + 4, cy); g.moveTo(cx, cy - R - 4); g.lineTo(cx, cy + R + 4); g.stroke();
      const e = ellipseOf(p.S);
      const s = Math.sqrt(Math.max(0, e.I)) * R;
      // 非偏振部分：淡圆斑
      if (e.I > 1e-4) {
        g.fillStyle = `rgba(224,67,90,${0.25 * (1 - e.dop)})`;
        g.beginPath(); g.arc(cx, cy, s, 0, Math.PI * 2); g.fill();
        const sp = Math.sqrt(Math.max(0, e.I * e.dop)) * R; // 偏振部分的振幅
        const a = sp * Math.cos(e.chi), b = sp * Math.abs(Math.sin(e.chi));
        g.strokeStyle = '#ff6a7d'; g.lineWidth = 2.2;
        g.beginPath(); g.ellipse(cx, cy, Math.max(a, 0.5), Math.max(b, 0.5), -e.psi, 0, Math.PI * 2); g.stroke();
        if (Math.abs(e.chi) > 0.05) { // 旋向箭头
          const t = e.chi > 0 ? 0.3 : -0.3;
          const px = cx + a * Math.cos(t) * Math.cos(-e.psi) - b * Math.sin(t) * Math.sin(-e.psi);
          const py = cy + a * Math.cos(t) * Math.sin(-e.psi) + b * Math.sin(t) * Math.cos(-e.psi);
          g.fillStyle = '#ff6a7d'; g.beginPath(); g.arc(px, py, 3.5, 0, Math.PI * 2); g.fill();
        }
      }
      g.fillStyle = '#c9d1cc'; g.fillText(p.name, cx, H * 0.84);
      g.fillStyle = '#7d8a84'; g.fillText(e.I > 1e-4 ? `P=${(e.dop * 100).toFixed(0)}%` : '—', cx, H * 0.96);
    });
    v.foot('红色椭圆：偏振部分的振动轨迹；淡圆斑：非偏振成分；P 为偏振度');
  }

  globalControls() {
    return [
      { type: 'readout', label: '光功率计', get: () => this.meterStr() },
      { type: 'toggle', label: '偏振态示意', get: () => this.showEll, set: (v) => (this.showEll = v) },
    ];
  }

  // ---------------- 数据 ----------------
  tables() {
    const unwrapB = (rows) => { // Δβ 连续展开（消光位置以 180° 为周期）
      const out = []; let prev = 0;
      rows.forEach((r, i) => { if (i === 0 || r.b == null) { out.push(0); return; } let d = r.b - rows[0].b; d = prev + angDiff(d, prev, 180); out.push(d); prev = d; });
      return out;
    };
    const dA = (rows, i) => angDiff(rows[i].a, rows[0].a, 360); // 刻度盘读数跨过 0° 时展开
    return [
      {
        id: 'malus', title: '马吕斯定律',
        columns: [{ key: 'th', label: 'P₂ 读数 θ/(°)', digits: 1 }, { key: 'I', label: '光功率 P/μW', digits: 2 }, { key: 'rng', label: '量程', type: 'text', readonly: true, optional: true }],
        buttons: [
          { label: '记录并转过 10°', onClick: (t) => { if (this.recMalus(t)) { this.r.p2 = wrap360(this.r.p2 + 10); this.app.changed(); } } },
          { label: '只记录当前点', primary: false, onClick: (t) => this.recMalus(t) },
        ],
        note: '从消光位置开始，检偏器每转 10° 记录一次，至少转过 180°。',
      },
      {
        id: 'hwp', title: '1/2 波片',
        columns: [
          { key: 'a', label: '波片读数 α/(°)', digits: 1 }, { key: 'b', label: 'P₂ 消光读数 β/(°)', digits: 1 },
          { key: 'da', label: 'Δα/(°)', digits: 1, calc: (r, i, rows) => dA(rows, i) },
          { key: 'db', label: 'Δβ/(°)', digits: 1, calc: (r, i, rows) => unwrapB(rows)[i] },
        ],
        buttons: [{ label: '记录 (α, β)', onClick: (t) => this.recHwp(t) }],
        note: '第一行为 P₁、P₂ 正交且波片处于消光位置时的读数。之后波片每转 15°，转动 P₂ 重新找到消光位置再记录。',
      },
      {
        id: 'qwp', title: '1/4 波片',
        columns: [
          { key: 'a', label: '波片读数 α/(°)', digits: 1 }, { key: 'mx', label: 'P_max/μW', digits: 2 }, { key: 'mn', label: 'P_min/μW', digits: 2 },
          { key: 'da', label: 'Δα/(°)', digits: 1, calc: (r, i, rows) => dA(rows, i) },
          { key: 'ratio', label: 'P_min/P_max', digits: 3, calc: (r) => r.mn / r.mx },
        ],
        buttons: [{ label: '记录 P_max', onClick: (t) => this.recQwp(t, 'mx') }, { label: '记录 P_min', onClick: (t) => this.recQwp(t, 'mn') }],
        note: '每个波片位置下，把 P₂ 转一周，分别在光强最大和最小处记录。',
      },
    ];
  }

  read() {
    if (!this.app.comp('det').placed) { this.app.toast('请先放置光电探头', 'warn'); return null; }
    if (!this.laserOn) { this.app.toast('激光器还没有打开', 'warn'); return null; }
    const m = this.meterRead();
    if (m.over) { this.app.toast('光功率计超量程，请换大一挡量程', 'warn'); return null; }
    return m.value;
  }
  recMalus(t) {
    const v = this.read(); if (v == null) return false;
    t.addRow({ th: Math.round(this.r.p2 * 2) / 2, I: v, rng: rngLabel(RANGES[this.range]) });
    return true;
  }
  recHwp(t) {
    if (!this.app.comp('hwp').placed) { this.app.toast('光路中没有 1/2 波片', 'warn'); return; }
    if (this.read() == null) return;
    const rel = this.relI();
    if (rel > 0.03) { this.app.toast(`P₂ 还没有处于消光位置（当前光强为极大值的 ${pct(rel)}）`, 'warn'); return; }
    if (rel > 0.004) this.app.toast('提示：可换小量程，把消光位置找得更准', 'warn');
    t.addRow({ a: Math.round(this.r.hwp * 2) / 2, b: Math.round(this.r.p2 * 2) / 2 });
  }
  recQwp(t, key) {
    if (!this.app.comp('qwp').placed) { this.app.toast('光路中没有 1/4 波片', 'warn'); return; }
    const v = this.read(); if (v == null) return;
    const e = this.p2Extremes(), p = this.power();
    if (key === 'mx' && p < e.max * 0.985) this.app.toast('提示：P₂ 可能还没转到光强最大处', 'warn');
    if (key === 'mn' && p > e.min * 1.03 + 0.05) this.app.toast('提示：P₂ 可能还没转到光强最小处', 'warn');
    const a = Math.round(this.r.qwp * 2) / 2;
    let i = t.rows.findIndex((r) => r.a != null && Math.abs(r.a - a) < 0.3);
    if (i < 0) i = t.addRow({ a });
    if (i >= 0) t.set(i, key, v);
  }

  // ---------------- 步骤 ----------------
  /** 等高共轴调节：光路顺序、光束与各元件通光孔（cm） */
  coaxSpec() {
    return {
      keys: ['laser', 'p1', 'hwp', 'qwp', 'p2', 'det'],
      beam: { laser: { w: 0.05, div: 0.0005 } },
      ap: { p1: { y: 0.6, z: 0.6 }, hwp: { y: 0.5, z: 0.5 }, qwp: { y: 0.5, z: 0.5 }, p2: { y: 0.6, z: 0.6 }, det: { y: 0.25, z: 0.25 } },
      axes: { laser: 'ya', p1: 'yz', hwp: 'yz', qwp: 'yz', p2: 'yz', det: 'yz' },
    };
  }

  steps() {
    const app = this.app;
    const on = (k) => app.comp(k).placed;
    const pos = (k) => app.comp(k).pos;
    const rotTo = (k, to, ms = 900) => app.tween(() => this.r[k], (v) => (this.r[k] = wrap360(v)), this.r[k] + angDiff(to, this.r[k], 360), ms);
    const toExt = async (fine = true) => {
      app.select(app.comp('det'));
      this.range = 2; app.changed();
      await rotTo('p2', this.p2Target(true) + 6, 900);
      this.range = this.bestRange(this.p2Extremes().min + 1); app.changed();
      await rotTo('p2', this.p2Target(true) + (fine ? gauss(0.25) : 0), 600);
    };
    const between = (k) => on(k) && pos(k) > pos('p1') && pos(k) < pos('p2');
    const alignPlate = async (k) => {
      app.select(app.comp(k));
      const target = this.r[k] + angDiff(this.r.p1 + this.o.p1 - this.o[k], this.r[k], 90);
      await rotTo(k, target + 5, 900);
      this.range = this.bestRange(5); app.changed();
      await rotTo(k, target + gauss(0.3), 600);
    };
    return [
      {
        title: '在导轨上放置激光器、起偏器、检偏器和探头',
        html: '<p>按 <b>激光器 → 起偏器 P₁ → 检偏器 P₂ → 光电探头</b> 的顺序放在导轨上，使各元件共轴。波片暂时不放。</p>',
        check: () => ['laser', 'p1', 'p2', 'det'].every(on) && pos('laser') < pos('p1') && pos('p1') < pos('p2') && pos('p2') < pos('det') && !on('hwp') && !on('qwp'),
        auto: async () => { await app.view('全景'); for (const [k, x] of [['laser', 4], ['p1', 22], ['p2', 66], ['det', 86]]) await app.autoPlace(k, { pos: x }); },
      },
      {
        title: '打开激光器，使 P₁、P₂ 正交（消光）',
        html: '<p>打开激光器，转动检偏器 P₂ 一周，观察光强变化：出现两次最亮和两次最暗（消光）。把 P₂ 停在<b>消光位置</b>，此时 P₁ 与 P₂ 透振方向正交。</p>',
        hint: '在消光位置附近换用 20 μW 量程，左右微调找读数最小处。',
        check: () => this.laserOn && Math.abs(this.crossErr()) < 2,
        status: () => `光功率计 <b>${this.meterStr()}</b>`,
        auto: async () => {
          app.select(app.comp('laser')); this.laserOn = true; app.changed(); await app.wait(300);
          await app.view('元件');
          app.select(app.comp('p2'));
          app.say('转动检偏器，光强出现两明两暗');
          await rotTo('p2', this.r.p2 + 170, 2200);
          await toExt();
        },
      },
      {
        title: '验证马吕斯定律',
        html: '<p>从消光位置开始，检偏器每转过 10° 记录一次读数 θ 和光功率 P，至少转过 180°。选用不超量程的合适量程。</p>',
        check: () => { const r = app.table('malus').completeRows(); if (r.length < 19) return false; const th = r.map((q) => q.th); const sp = Math.max(...th) - Math.min(...th); return sp >= 170; },
        status: () => `已记录 <b>${app.table('malus').completeRows().length}</b> 点`,
        auto: async () => {
          const t = app.table('malus'); app.showTable(app.tables.indexOf(t));
          await app.view('探头');
          this.range = this.bestRange(this.p2Extremes().max); app.changed();
          await rotTo('p2', Math.round(this.r.p2), 300);
          const start = this.r.p2;
          for (let k = 0; k <= 18; k++) {
            app.checkAbort();
            this.r.p2 = wrap360(start + 10 * k); app.changed(); await app.wait(80);
            this.recMalus(t); await app.wait(80);
          }
        },
      },
      {
        title: '插入 1/2 波片并调到消光',
        html: '<p>使 P₂ 回到与 P₁ 正交的消光位置，在 P₁ 与 P₂ 之间放入 <b>1/2 波片</b>，消光被破坏。转动波片，直到重新消光——此时波片的快轴（或慢轴）与 P₁ 透振方向平行。</p>',
        check: () => between('hwp') && Math.abs(this.crossErr()) < 2 && Math.abs(this.plateErr('hwp')) < 1.5,
        status: () => `P₂ 与 P₁ 正交偏差 ${this.crossErr().toFixed(1)}°；光功率计 <b>${this.meterStr()}</b>`,
        auto: async () => {
          await app.view('元件');
          if (Math.abs(this.crossErr()) > 1) { app.select(app.comp('p2')); await toExt(false); }
          await app.autoPlace('hwp', { pos: 44 });
          await alignPlate('hwp');
        },
      },
      {
        title: '研究 1/2 波片：振动面转过 2Δα',
        html: '<p>先记录当前波片读数 α₀ 与 P₂ 读数 β₀。然后把波片每次转过 15°，转动 P₂ 重新找到消光位置，记录 α、β，直到波片共转过 90°。</p>',
        hint: '线偏振光通过 1/2 波片后仍为线偏振光，振动面转过 2Δα，因此 Δβ 应约为 2Δα。',
        check: () => { const r = app.table('hwp').completeRows(); if (r.length < 6) return false; const a = r.map((q) => angDiff(q.a, r[0].a, 360)); return Math.max(...a) - Math.min(...a) >= 74; },
        status: () => `已记录 <b>${app.table('hwp').completeRows().length}</b> 组`,
        auto: async () => {
          const t = app.table('hwp'); app.showTable(app.tables.indexOf(t));
          const a0 = this.r.hwp;
          for (let k = 0; k <= 6; k++) {
            app.checkAbort();
            if (k) { app.select(app.comp('hwp')); await rotTo('hwp', a0 + 15 * k, 500); }
            app.select(app.comp('p2'));
            this.range = 2; app.changed();
            await rotTo('p2', this.p2Target(true), 600);
            this.range = this.bestRange(this.p2Extremes().min + 1); app.changed();
            this.r.p2 = wrap360(this.r.p2 + gauss(0.25)); app.changed();
            await app.wait(150);
            this.recHwp(t); await app.wait(150);
          }
        },
      },
      {
        title: '换上 1/4 波片并调到消光',
        html: '<p>取下 1/2 波片，把 P₂ 转回与 P₁ 正交的消光位置，放入 <b>1/4 波片</b>，转动它直到重新消光。</p>',
        check: () => between('qwp') && !on('hwp') && Math.abs(this.crossErr()) < 2 && Math.abs(this.plateErr('qwp')) < 1.5,
        status: () => `P₂ 与 P₁ 正交偏差 ${this.crossErr().toFixed(1)}°；光功率计 <b>${this.meterStr()}</b>`,
        auto: async () => {
          app.remove(app.comp('hwp')); await app.wait(300);
          app.select(app.comp('p2')); await toExt(false);
          await app.autoPlace('qwp', { pos: 44 });
          await alignPlate('qwp');
        },
      },
      {
        title: '研究 1/4 波片：椭圆与圆偏振光',
        html: '<p>波片从消光位置起每次转过 15°（共 90°）。每个位置都把 P₂ 转一周，分别记录光强的<b>极大值</b>和<b>极小值</b>，判断出射光的偏振态。</p>',
        hint: 'Δα = 45° 时极大与极小几乎相等，出射光为圆偏振光；0° 和 90° 时为线偏振光；其余为椭圆偏振光。',
        check: () => { const r = app.table('qwp').completeRows(); if (r.length < 5) return false; const a = r.map((q) => angDiff(q.a, r[0].a, 360)); return Math.max(...a) - Math.min(...a) >= 74; },
        status: () => `已完成 <b>${app.table('qwp').completeRows().length}</b> 个位置`,
        auto: async () => {
          const t = app.table('qwp'); app.showTable(app.tables.indexOf(t));
          await app.view('探头');
          const a0 = this.r.qwp;
          for (let k = 0; k <= 6; k++) {
            app.checkAbort();
            app.select(app.comp('qwp')); await rotTo('qwp', a0 + 15 * k, 400);
            app.select(app.comp('p2'));
            await rotTo('p2', this.p2Target(false) + gauss(0.4), 500);
            this.range = this.bestRange(this.p2Extremes().max); app.changed(); await app.wait(120);
            this.recQwp(t, 'mx'); await app.wait(120);
            await rotTo('p2', this.p2Target(true) + gauss(0.3), 500);
            this.range = this.bestRange(this.p2Extremes().min + 0.2); app.changed(); await app.wait(120);
            this.recQwp(t, 'mn'); await app.wait(120);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>拟合 $P$–$\\cos^2\\theta$ 直线验证马吕斯定律；作 Δβ–Δα 图求斜率；由 $P_{min}/P_{max}$ 判断 1/4 波片出射光的偏振态。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ---------------- 数据处理 ----------------
  analyze() {
    const app = this.app;
    const mal = app.table('malus').completeRows();
    let html = '', plots = [], ok = false; const answers = [];
    if (mal.length >= 8) {
      // 最小二乘拟合 P = c0 + c1 cos2θ + c2 sin2θ（线性三参数）
      const X = mal.map((r) => [1, Math.cos(2 * rad(r.th)), Math.sin(2 * rad(r.th))]), Y = mal.map((r) => r.I);
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
      X.forEach((x, n) => { for (let i = 0; i < 3; i++) { B[i] += x[i] * Y[n]; for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j]; } });
      const c = solve3(A, B);
      const th0 = deg(0.5 * Math.atan2(c[2], c[1]));
      const amp = 2 * Math.hypot(c[1], c[2]);
      const Pmin = c[0] - amp / 2, Pmax = c[0] + amp / 2;
      const cos2 = mal.map((r) => Math.cos(rad(r.th - th0)) ** 2);
      const f = linFit(cos2, Y);
      html += `<h3>1. 马吕斯定律</h3><p>拟合得光强最大时检偏器读数 $\\theta_0=${wrap360(th0).toFixed(1)}^\\circ$（以 180° 为周期），$P_{max}=${Pmax.toFixed(1)}$ μW，$P_{min}=${Math.max(0, Pmin).toFixed(2)}$ μW。</p>
        <p>以 $\\cos^2(\\theta-\\theta_0)$ 为横坐标作直线拟合：斜率 ${f.k.toFixed(1)} μW，截距 ${f.b.toFixed(2)} μW，相关系数 $r=${f.r.toFixed(5)}$。</p>
        <div class="result-box">$r=${f.r.toFixed(5)}$，$P$ 与 $\\cos^2\\theta$ 成线性关系，马吕斯定律得到验证；P₁、P₂ 正交时的消光比约 ${Pmin > 0.01 ? sig(Pmax / Math.max(Pmin, 1e-3), 2) + ' : 1' : '> 1000 : 1'}。</div>
        <div class="plot-wrap"><canvas data-plot="0" style="height:280px"></canvas></div><div class="plot-wrap"><canvas data-plot="1" style="height:260px"></canvas></div>`;
      const thMin = Math.min(...mal.map((r) => r.th)), thMax = Math.max(...mal.map((r) => r.th));
      plots.push({ title: '光强随检偏器角度的变化', xLabel: 'θ / (°)', yLabel: 'P / μW', yZero: true, series: [
        { type: 'scatter', data: mal.map((r) => [r.th, r.I]), label: '实验数据', radius: 3 },
        { type: 'line', data: fnData((t) => c[0] + c[1] * Math.cos(2 * rad(t)) + c[2] * Math.sin(2 * rad(t)), thMin, thMax, 300), label: '最小二乘拟合' },
      ] });
      plots.push({ title: 'P – cos²(θ−θ₀)', xLabel: 'cos²(θ−θ₀)', yLabel: 'P / μW', yZero: true, series: [
        { type: 'scatter', data: cos2.map((x, i) => [x, Y[i]]), label: '实验数据', radius: 3 },
        { type: 'line', data: [[0, f.b], [1, f.k + f.b]], label: `拟合直线 r=${f.r.toFixed(4)}` },
      ] });
      ok = true;
    } else html += '<h3>1. 马吕斯定律</h3><p>数据不足（至少 8 点）。</p>';

    const ht = app.table('hwp');
    const hr = ht.completeRows();
    if (hr.length >= 3) {
      const da = hr.map((r) => ht.value(r, 'da', ht.rows.indexOf(r))), db = hr.map((r) => ht.value(r, 'db', ht.rows.indexOf(r)));
      const f = linFit(da, db);
      html += `<h3>2. 1/2 波片</h3><table><tr><th>Δα/(°)</th>${da.map((v) => `<td>${v.toFixed(1)}</td>`).join('')}</tr><tr><th>Δβ/(°)</th>${db.map((v) => `<td>${v.toFixed(1)}</td>`).join('')}</tr></table>
        <div class="result-box">Δβ–Δα 直线斜率 $k=${texU(f.k, f.uk)}$（理论值 2），说明线偏振光经 1/2 波片后振动面转过 $2\\Delta\\alpha$。</div>
        <div class="plot-wrap"><canvas data-plot="${plots.length}" style="height:260px"></canvas></div>`;
      plots.push({ title: 'Δβ – Δα', xLabel: 'Δα / (°)', yLabel: 'Δβ / (°)', series: [
        { type: 'scatter', data: da.map((x, i) => [x, db[i]]), label: '实验数据', radius: 3.5 },
        { type: 'line', data: [[0, f.b], [Math.max(...da), f.k * Math.max(...da) + f.b]], label: `拟合 k=${f.k.toFixed(3)}` },
      ] });
      answers.push({ label: '1/2 波片：$\Delta\beta$–$\Delta\alpha$ 直线斜率 $k$', value: f.k, digits: 3, tolAbs: 0.02 });
      ok = true;
    }

    const qt = app.table('qwp');
    const qr = qt.completeRows();
    if (qr.length >= 3) {
      const state = (d, q) => { const m = ((Math.round(d) % 180) + 180) % 180; if (q < 0.05) return '线偏振光'; if (q > 0.75 && Math.abs(m - 45) < 8) return q > 0.95 ? '圆偏振光' : '近似圆偏振光'; return '椭圆偏振光'; };
      const theo = (d) => { const a = rad(d); return Math.min(Math.tan(a) ** 2, 1 / Math.max(1e-9, Math.tan(a) ** 2)); };
      const rows = qr.map((r) => { const d = qt.value(r, 'da', qt.rows.indexOf(r)); return { d, q: r.mn / r.mx }; });
      html += `<h3>3. 1/4 波片</h3><table><tr><th>Δα/(°)</th><th>P_min/P_max</th><th>理论值</th><th>出射光</th></tr>${rows.map((r) => `<tr><td>${r.d.toFixed(1)}</td><td>${r.q.toFixed(3)}</td><td>${theo(r.d).toFixed(3)}</td><td>${state(r.d, r.q)}</td></tr>`).join('')}</table>
        <p>理论上入射线偏振光与快轴夹角为 Δα 时，出射椭圆的短长轴之比为 $\\tan\\Delta\\alpha$，故 $P_{min}/P_{max}=\\tan^2\\Delta\\alpha$（Δα ≤ 45°）。Δα = 45° 时比值不严格等于 1，主要来自波片相位延迟的偏差（本样品 δ = ${(deg(this.dQ)).toFixed(1)}°）。</p>
        <div class="plot-wrap"><canvas data-plot="${plots.length}" style="height:260px"></canvas></div>`;
      plots.push({ title: 'P_min/P_max – Δα', xLabel: 'Δα / (°)', yLabel: 'P_min / P_max', yZero: true, series: [
        { type: 'scatter', data: rows.map((r) => [r.d, r.q]), label: '实验数据', radius: 3.5 },
        { type: 'line', data: fnData(theo, 0, 90, 200), label: '理想 1/4 波片' },
      ] });
      ok = true;
    }
    html += `<div class="result-box warn">本次样品参考值：1/2 波片相位延迟 ${deg(this.dH).toFixed(1)}°，1/4 波片 ${deg(this.dQ).toFixed(1)}°；偏振片主透射率 0.85，消光比 1000 : 1；光源偏振度 ${pct(this.srcDop)}。</div>`;
    return { html, ok, plots, answers };
  }

  principle() {
    return `<h3>1. 马吕斯定律</h3><p>线偏振光通过检偏器，透射光强</p>$$I=I_0\\cos^2\\theta$$<p>$\\theta$ 为入射光振动方向与检偏器透振方向的夹角。$\\theta=90^\\circ$ 时消光。</p>
<h3>2. 波片</h3><p>波片的 o 光与 e 光产生相位差 $\\delta=\\dfrac{2\\pi}{\\lambda}(n_o-n_e)d$。$\\delta=\\pi$ 为 1/2 波片：线偏振光入射时出射仍为线偏振光，若入射振动方向与快轴夹角为 $\\alpha$，出射光振动面转过 $2\\alpha$。$\\delta=\\pi/2$ 为 1/4 波片：出射光一般为椭圆偏振光，长短轴之比为 $\\cot\\alpha$；$\\alpha=45^\\circ$ 时为圆偏振光，$\\alpha=0,90^\\circ$ 时仍为线偏振光。</p>
<h3>3. 本仿真的计算模型（斯托克斯—穆勒矩阵）</h3><p>光的偏振态用斯托克斯矢量 $S=(S_0,S_1,S_2,S_3)^T$ 表示，可同时描述自然光、部分偏振光和完全偏振光。每个元件对应一个 4×4 穆勒矩阵，出射光为</p>$$S_{out}=M_{P_2}\\,M_{W}\\,M_{P_1}\\,S_{in}$$
<p>偏振片按实际的二向色性模型计算（主透射率 $p=0.85$，消光比 $p/q=1000$），因此消光位置的光强不为零；波片的相位延迟带有约 2% 的制造偏差；光源是偏振度约 30% 的部分偏振光。转盘的 0 刻度与元件主轴之间的夹角随机生成，需要通过实验确定。</p>`;
  }
}

function solve3(A, B) {
  const M = A.map((r, i) => [...r, B[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = 0; k < 3; k++) if (k !== i) { const f = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j]; }
  }
  return M.map((r, i) => r[3] / r[i]);
}
