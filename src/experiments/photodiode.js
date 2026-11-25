// 实验：光敏二极管的光电特性
// 暗箱内白光 LED 照射硅光敏二极管（光敏面 7 mm²），旁边是照度计探头（读数 1 lx，定标误差个体随机 ±1.5%）。
// 光电特性测试仪：可调直流电源 0–12 V；接法有三种——
//   反偏：电源经 1 kΩ 限流电阻加反向电压，数字电压表测二极管上的电压，微电流表测电流；
//   开路：数字电压表（内阻 10 MΩ）直接接二极管两端，测开路电压；
//   负载：电源经负载电阻 R_L 加反向电压，R_L 上的电压接示波器（输入电容与连线合计 15 pF），LED 改为 20 kHz 方波脉冲。
// 器件参数（灵敏度 S、饱和电流 I_s、理想因子 n、产生电流、零偏结电容）个体随机，模型见 physics/photodiode.js。
import * as THREE from 'three';
import { meta, thumb } from './photodiode.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, clamp, relErr, pct, linFit } from '../core/Stats.js';
import { biasPoint, openVoltage, junctionC, riseTime, stepResp, VT } from '../physics/photodiode.js';

const RP = 1e3, RIN = 10e6, CIN = 15e-12, EMAX = 1250, GAM = 1.2;
const RLS = [1, 2, 5, 10, 20, 50]; // kΩ
const TBS = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2]; // μs/div
const VDIVS = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];
const SVG = (inner) => `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;

export class PhotodiodeExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.S = rand(55, 80) * 1e-9; // A/lx
    this.dev = { Iph: 0, Is: rand(1, 3) * 1e-9, n: rand(1.05, 1.2), Ig: rand(1, 2) * 1e-9, Rsh: rand(1.5, 4) * 1e9, T: 273.15 + Math.round(rand(20, 26) * 10) / 10 };
    this.Cj0 = rand(55, 75) * 1e-12; this.t0 = rand(2, 4) * 1e-9;
    this.cal = rand(-0.015, 0.015);
    this.level = 0; this.pulse = false; this.mode = 'rev'; this.Us = 0; this.RL = 10; this.tb = 0.5;
  }
  get E() { return EMAX * (this.level / 100) ** GAM; }
  levelFor(Eread) { return clamp(100 * (Eread / (EMAX * (1 + this.cal))) ** (1 / GAM), 0, 100); }
  luxRead() { return Math.round(this.E * (1 + this.cal) * (this.pulse ? 0.5 : 1)); }
  devAt(E) { return { ...this.dev, Iph: this.S * E }; }
  /** 当前接法下的电压（V）与电流（A），脉冲光时取平均 */
  state() {
    const E = this.pulse ? this.E / 2 : this.E, d = this.devAt(E);
    if (this.mode === 'oc') return { U: openVoltage(RIN, d), I: 0 };
    const p = biasPoint(this.Us, this.mode === 'rev' ? RP : this.RL * 1e3, d);
    return { U: p.U, I: p.I };
  }
  fmtI(I) { const a = Math.abs(I); return a < 1e-6 ? `${(I * 1e9).toFixed(2)} nA` : a < 1e-5 ? `${(I * 1e6).toFixed(3)} μA` : `${(I * 1e6).toFixed(2)} μA`; }
  readI() { const I = this.state().I, a = Math.abs(I); return a < 1e-6 ? Math.round(I * 1e11) / 1e5 : a < 1e-5 ? Math.round(I * 1e9) / 1e3 : Math.round(I * 1e8) / 100; } // μA
  readU() { const U = this.state().U; return this.mode === 'oc' ? Math.round(U * 1e4) / 10 : Math.round(U * 100) / 100; } // 开路 mV，其余 V
  /** 负载接法下的脉冲响应：τ₁ = R_L(C_j + C_in)，幅度 I_ph·R_L */
  pulseResp() {
    const RL = this.RL * 1e3, Iph = this.S * this.E, A = Iph * RL;
    const Cj = junctionC(this.Us - A / 2, this.Cj0), t1 = RL * (Cj + CIN), t2 = this.t0;
    return { A, t1, t2, tr: riseTime(t1, t2) };
  }
  trRead() { const q = this.tb / 50, r = this.pulseResp(); return Math.round((r.tr * 1e6) / q) * q; }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 58, 86], target: [0, 8, -2] }, { name: '暗箱', pos: [-34, 30, 30], target: [-34, 6, -2] }, { name: '仪器', pos: [16, 28, 40], target: [16, 8, -6] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 80));
    app.stage.setLightTarget(0, 6, 0);
    // 暗箱（掀开前盖可见内部）
    const box = new THREE.Group(); box.position.set(-36, 0, 0); scene.add(box);
    const blk = MAT.paint(0x1d2024);
    box.add(mesh(new THREE.BoxGeometry(34, 1, 14), blk, 0, 0.5, 0));
    box.add(mesh(new THREE.BoxGeometry(34, 12, 0.8), blk, 0, 6.5, -6.6));
    box.add(mesh(new THREE.BoxGeometry(0.8, 12, 14), blk, -16.6, 6.5, 0));
    box.add(mesh(new THREE.BoxGeometry(0.8, 12, 14), blk, 16.6, 6.5, 0));
    box.add(mesh(new THREE.BoxGeometry(34, 0.8, 14), new THREE.MeshStandardMaterial({ color: 0x1d2024, transparent: true, opacity: 0.25 }), 0, 12.6, 0));
    this.ledM = MAT.emissive(0xfff3d6, 0);
    box.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 3, 20), MAT.paint(0x6b7280), -12, 6, 0).rotateZ(Math.PI / 2));
    box.add(mesh(new THREE.SphereGeometry(1.1, 16, 12), this.ledM, -10.2, 6, 0));
    this.beam = mesh(new THREE.ConeGeometry(4, 20, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }), 0, 6, 0);
    this.beam.rotation.z = Math.PI / 2; box.add(this.beam);
    box.add(mesh(new THREE.BoxGeometry(2, 6, 6), MAT.paint(0x2b3440), 11, 3.5, 0));
    box.add(mesh(new THREE.BoxGeometry(0.4, 1.6, 1.6), MAT.paint(0x3b2a12), 9.9, 7.3, 1.4));
    box.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.5, 20), MAT.white(), 9.9, 7.3, -1.6).rotateZ(Math.PI / 2));
    const lux = (this.luxBox = meterBox(14, 8, 8, '照度计')); lux.group.position.set(-36, 0, 16); scene.add(lux.group);
    app.addComponent(new Component({
      key: 'box', name: '暗箱与光源', zone: 'none', fixed: true, required: true, object: box, labelY: 15,
      icon: SVG('<rect x="4" y="8" width="56" height="24"/><circle cx="14" cy="20" r="3"/><path d="M18 20h24" stroke-dasharray="3 2"/><rect x="46" y="15" width="4" height="10"/>'),
      desc: '暗箱里装有白光 LED 和硅光敏二极管，二极管旁边是照度计的探头，两者与 LED 距离相同。调节 LED 的驱动电流改变照度。LED 可以切换成 20 kHz 方波脉冲（占空比 50%），这时照度计显示的是平均照度。',
      controls: () => [
        { type: 'knob', label: '光源强度', get: () => this.level, set: (v) => { this.level = clamp(v, 0, 100); app.changed(); }, min: 0, max: 100, step: 0.1, bigStep: 5, perRev: 20, digits: 1, unit: '%' },
        { type: 'segment', label: 'LED 驱动', options: [{ value: false, label: '连续' }, { value: true, label: '方波脉冲 20 kHz' }], get: () => this.pulse, set: (v) => { this.pulse = v; app.changed(); } },
        { type: 'readout', label: '照度计', get: () => `${this.luxRead()} lx${this.pulse ? '（平均）' : ''}` },
      ],
    }));
    // 光电特性测试仪
    const vm = (this.vBox = meterBox(16, 9, 10, '电压表')); vm.group.position.set(6, 0, -10); scene.add(vm.group);
    const am = (this.aBox = meterBox(16, 9, 10, '微电流表')); am.group.position.set(24, 0, -10); scene.add(am.group);
    const tester = new THREE.Group().add(vm.group, am.group); scene.add(tester);
    const wire = (pts, c) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 32, 0.25, 6), MAT.paint(c));
    scene.add(wire([[-25, 4, 0], [-14, 2, 2], [0, 2, -4], [6, 3, -5]], 0xb91c1c), wire([[-25, 3, -1], [-12, 1.5, 0], [10, 2, -2], [24, 3, -5]], 0x111827));
    app.addComponent(new Component({
      key: 'tester', name: '光电特性测试仪', zone: 'none', fixed: true, required: true, object: tester, labelY: 12,
      icon: SVG('<rect x="4" y="8" width="26" height="22"/><rect x="34" y="8" width="26" height="22"/><path d="M9 19h16M39 19h16"/>'),
      desc: `内含 0–12 V 可调直流电源、限流电阻 1 kΩ、负载电阻 1–50 kΩ、数字电压表（内阻 10 MΩ）和自动量程微电流表（分辨率 0.01 nA）。三种接法：反偏测电流；开路测电压（光伏工作方式）；接负载电阻 R_L，R_L 两端接示波器看脉冲响应。室温 ${(this.dev.T - 273.15).toFixed(1)} °C。`,
      controls: () => [
        { type: 'segment', label: '接法', options: [{ value: 'rev', label: '反偏（测电流）' }, { value: 'oc', label: '开路（测电压）' }, { value: 'load', label: '负载 R_L + 示波器' }], get: () => this.mode, set: (v) => { this.mode = v; app.renderInspector(); app.changed(); } },
        { type: 'knob', label: '反向偏压（电源）', get: () => this.Us, set: (v) => { this.Us = Math.round(clamp(v, 0, 12) * 100) / 100; app.changed(); }, min: 0, max: 12, step: 0.01, bigStep: 0.5, perRev: 2, digits: 2, unit: 'V' },
        { type: 'segment', label: '负载电阻 R_L', options: RLS.map((r) => ({ value: r, label: `${r} kΩ` })), get: () => this.RL, set: (v) => { this.RL = v; app.changed(); } },
        { type: 'readout', label: '电压表', get: () => (this.mode === 'oc' ? `${this.readU().toFixed(1)} mV` : `${this.readU().toFixed(2)} V`) },
        { type: 'readout', label: '微电流表', get: () => (this.mode === 'oc' ? '（开路）' : this.fmtI(this.state().I)) },
      ],
    }));
    // 示波器
    const sc = new THREE.Group(); sc.position.set(48, 0, -8); scene.add(sc);
    sc.add(mesh(new THREE.BoxGeometry(26, 15, 14), MAT.paint(0xc9c6bd), 0, 7.5, 0));
    sc.add(mesh(new THREE.BoxGeometry(15, 10, 0.3), new THREE.MeshStandardMaterial({ color: 0x0b1a12, emissive: 0x0b2a18, emissiveIntensity: 0.6 }), -4, 8, 7.05));
    for (let i = 0; i < 6; i++) sc.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.8, 16), MAT.black(), 7 + (i % 2) * 3, 12 - Math.floor(i / 2) * 3, 7.3).rotateX(Math.PI / 2));
    app.addComponent(new Component({
      key: 'scope', name: '示波器', zone: 'none', fixed: true, object: sc, labelY: 17,
      desc: '数字示波器，接在负载电阻 R_L 两端。垂直灵敏度自动；扫描速度（时基）手动选择，触发在脉冲上升沿。自动测量"上升时间"（10%–90%），分辨率为一格的 1/50，上升沿至少要占 1.5 格才测得准。',
      controls: () => [
        { type: 'segment', label: '时基', options: TBS.map((t) => ({ value: t, label: t < 1 ? `${Math.round(t * 1000)} ns` : `${t} μs` })), get: () => this.tb, set: (v) => { this.tb = v; app.changed(); } },
        { type: 'readout', label: '上升时间', get: () => (this.mode === 'load' && this.pulse && this.E > 0.5 ? `${this.trRead().toFixed(3)} μs` : '----') },
      ],
    }));
    this.view = app.addView({ id: 'scope', title: '示波器（R_L 两端电压）', w: 300, h: 220, res: 1.6 });
  }
  update() {
    const k = this.level / 100;
    this.ledM.emissiveIntensity = 0.2 + 3 * k * (this.pulse ? 0.6 : 1); this.beam.material.opacity = 0.18 * k;
    const lx = this.luxRead(); if (lx !== this._lx) { this._lx = lx; this.luxBox.setText(String(lx), 'lx', this.pulse ? '平均照度' : ''); }
    const u = this.mode === 'oc' ? this.readU().toFixed(1) : this.readU().toFixed(2), us = this.mode === 'oc' ? 'mV' : 'V';
    if (u + us !== this._u) { this._u = u + us; this.vBox.setText(u, us, `室温 ${(this.dev.T - 273.15).toFixed(1)} °C`); }
    const i = this.mode === 'oc' ? '----' : this.fmtI(this.state().I);
    if (i !== this._i) { this._i = i; const [n, un] = i.split(' '); this.aBox.setText(n, un || '', this.mode === 'rev' ? '反偏' : this.mode === 'load' ? `R_L = ${this.RL} kΩ` : '开路'); }
    this.draw();
  }
  draw() {
    const v = this.view, g = v.ctx, W = v.W, H = v.H, nx = 10, ny = 8, dx = W / nx, dy = H / ny;
    g.fillStyle = '#0c1813'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,190,150,.22)'; g.lineWidth = 1;
    for (let i = 1; i < nx; i++) { g.beginPath(); g.moveTo(i * dx, 0); g.lineTo(i * dx, H); g.stroke(); }
    for (let j = 1; j < ny; j++) { g.beginPath(); g.moveTo(0, j * dy); g.lineTo(W, j * dy); g.stroke(); }
    const live = this.mode === 'load';
    let foot = '接法不是"负载 R_L"，示波器没有信号';
    if (live) {
      const r = this.pulseResp(), y0 = H - 1.5 * dy, tb = this.tb * 1e-6;
      const amp = this.pulse ? r.A : this.state().I * this.RL * 1e3;
      const vd = VDIVS.find((d) => amp / d <= 5.5) || 1;
      g.strokeStyle = '#7cf0a8'; g.lineWidth = 2; g.beginPath();
      for (let px = 0; px <= W; px += 1) {
        const t = (px / dx - 1) * tb; // 上升沿在第 1 格
        const y = this.pulse ? amp * (stepResp(t, r.t1, r.t2) - stepResp(t - 25e-6, r.t1, r.t2)) : amp;
        const py = clamp(y0 - (y / vd) * dy, 1, H - 1);
        if (px === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
      g.fillStyle = '#7cf0a8'; g.font = `${H * 0.055}px Consolas, monospace`; g.textAlign = 'left';
      const tbs = this.tb < 1 ? `${Math.round(this.tb * 1000)} ns/div` : `${this.tb} μs/div`, vds = vd < 1 ? `${Math.round(vd * 1000)} mV/div` : `${vd} V/div`;
      g.fillText(`${vds}   ${tbs}`, 6, H * 0.07);
      foot = this.pulse && this.E > 0.5 ? `上升时间 tr = ${this.trRead().toFixed(3)} μs` : this.pulse ? '光源强度为零' : 'LED 是连续光：示波器上只有直流电平';
    }
    v.foot(foot);
  }

  // ======================= 数据表 =======================
  tables() {
    const ti = (r) => 0.005 * Math.abs(r) + 2e-5;
    return [
      {
        id: 'vi', title: '反向伏安特性', maxRows: 40,
        columns: [{ key: 'E', label: '照度 E/lx', digits: 0, auto: true }, { key: 'U', label: '反向电压 U/V', digits: 2, auto: true }, { key: 'I', label: '反向电流 I/μA', readTol: ti }],
        buttons: [{ label: '记录', onClick: (t) => this.recVI(t) }],
        note: '接法选"反偏"、LED 连续。先在暗态（照度 0）下测暗电流随电压的变化，再在几个照度下各测一组。',
      },
      {
        id: 'lux', title: '光照特性（反向电压 5 V）', maxRows: 16,
        columns: [{ key: 'E', label: '照度 E/lx', digits: 0, auto: true }, { key: 'I', label: '光电流 I/μA', readTol: ti }],
        buttons: [{ label: '记录', onClick: (t) => this.recLux(t) }],
        note: '反向电压保持 5.00 V 左右不变，照度从 0 到 500 lx 每隔 50 lx 测一次。',
      },
      {
        id: 'voc', title: '开路电压', maxRows: 12,
        columns: [{ key: 'E', label: '照度 E/lx', digits: 0, auto: true }, { key: 'V', label: '开路电压 U_oc/mV', digits: 1, readTol: 0.15 }],
        buttons: [{ label: '记录', onClick: (t) => this.recVoc(t) }],
        note: '接法选"开路"。照度跨几个数量级取点（如 10、20、50、100、200、500、1000 lx）。',
      },
      {
        id: 'tr', title: '时间响应（脉冲光）', maxRows: 10,
        columns: [{ key: 'RL', label: '负载 R_L/kΩ', digits: 0, auto: true }, { key: 'U', label: '偏压/V', digits: 2, auto: true }, { key: 'tr', label: '上升时间 t_r/μs', readTol: (r) => 0.01 * r + 0.002 }],
        buttons: [{ label: '记录', onClick: (t) => this.recTr(t) }],
        note: '接法选"负载 R_L"，LED 换成方波脉冲，偏压保持不变。依次换不同的 R_L，选合适的时基，读出上升时间。',
      },
    ];
  }
  needCont(mode) {
    const a = this.app;
    if (this.mode !== mode) { a.toast(mode === 'rev' ? '接法要选"反偏（测电流）"' : '接法要选"开路（测电压）"', 'warn'); return false; }
    if (this.pulse) { a.toast('LED 现在是脉冲光，电表读的是平均值：改成连续光', 'warn'); return false; }
    return true;
  }
  recVI(t) {
    if (!this.needCont('rev')) return;
    const E = this.luxRead(), U = this.readU();
    if (t.rows.some((r) => Math.abs(r.E - E) <= 2 && Math.abs(r.U - U) < 0.05)) return this.app.toast('这个照度、电压的点已经测过了', 'warn');
    t.addRow({ E, U, I: this.readI() });
  }
  recLux(t) {
    if (!this.needCont('rev')) return;
    const U = this.readU();
    if (Math.abs(U - 5) > 0.2) return this.app.toast('反向电压要保持在 5 V 左右（4.8–5.2 V）', 'warn');
    const E = this.luxRead();
    if (t.rows.some((r) => Math.abs(r.E - E) <= 2)) return this.app.toast('这个照度已经测过了', 'warn');
    t.addRow({ E, I: this.readI() });
  }
  recVoc(t) {
    if (!this.needCont('oc')) return;
    const E = this.luxRead();
    if (E < 1) return this.app.toast('照度为零时开路电压为零，没有意义', 'warn');
    if (t.rows.some((r) => Math.abs(r.E - E) <= Math.max(1, 0.02 * E))) return this.app.toast('这个照度已经测过了', 'warn');
    t.addRow({ E, V: this.readU() });
  }
  recTr(t) {
    const a = this.app;
    if (this.mode !== 'load') return a.toast('接法要选"负载 R_L + 示波器"', 'warn');
    if (!this.pulse) return a.toast('LED 要切换成方波脉冲', 'warn');
    if (this.E < 0.5) return a.toast('光源强度为零，没有信号', 'warn');
    const r = this.pulseResp();
    if (r.A > 0.3) return a.toast('光脉冲太强：输出幅度超过 0.3 V，结上的电压变化会使结电容跟着变。把光源调弱一些', 'warn');
    if (this.Us < 1) return a.toast('偏压太低，结电容大且随信号变化：至少加 1 V 反向偏压', 'warn');
    const tr = this.trRead();
    if (tr < 1.5 * this.tb) return a.toast('上升沿不到 1.5 格，测量分辨率不够：把时基调快', 'warn');
    if (tr > 6 * this.tb) return a.toast('上升沿超出 6 格，看不到平顶：把时基调慢', 'warn');
    if (t.rows.length && Math.abs(t.rows[0].U - this.Us) > 0.02) return a.toast(`偏压要和第一行相同（${t.rows[0].U.toFixed(2)} V）`, 'warn');
    if (t.rows.some((x) => x.RL === this.RL)) return a.toast('这个负载电阻已经测过了', 'warn');
    t.addRow({ RL: this.RL, U: this.Us, tr: +tr.toFixed(4) });
  }

  // ======================= 自动操作 =======================
  async seg(comp, key, v) { const a = this.app; a.select(a.comp(comp)); if (this[key] !== v) { this[key] = v; a.renderInspector(); a.changed(); await a.wait(120); } }
  async adj(comp, key, to, ms = 250) { const a = this.app; a.select(a.comp(comp)); if (Math.abs(this[key] - to) > 1e-9) await a.tween(() => this[key], (v) => (this[key] = v), to, ms); this[key] = to; a.changed(); await a.wait(60); }
  async lux(E) { await this.adj('box', 'level', Math.round(this.levelFor(E) * 10) / 10); }
  steps() {
    const app = this.app, rows = (id) => app.table(id).completeRows();
    const Es = () => [...new Set(rows('vi').map((r) => Math.round(r.E / 10) * 10))];
    return [
      {
        title: '暗电流与反向伏安特性',
        html: '<p>接法选"反偏"，LED 连续。先把光源关到 0，测暗电流随反向电压（0–10 V）的变化；再在 100、300、500 lx 左右各测一组伏安特性。</p>',
        hint: '暗电流只有几个纳安，随反向电压略有增大（耗尽层变宽，产生电流增加）；有光照时电流几乎不随电压变化——光电流只取决于照度。',
        status: () => `已测 ${rows('vi').length} 点，${Es().length} 个照度`,
        check: () => rows('vi').length >= 16 && Es().length >= 3 && Es().includes(0),
        auto: async () => {
          app.showTable(0); await app.view('全景');
          await this.seg('box', 'pulse', false); await this.seg('tester', 'mode', 'rev');
          for (const E of [0, 100, 300, 500]) {
            await this.lux(E);
            for (const U of [0, 1, 2, 4, 6, 8, 10]) {
              const Er = this.luxRead();
              if (rows('vi').some((r) => Math.abs(r.E - Er) <= 2 && Math.abs(r.U - U) < 0.08)) continue;
              await this.adj('tester', 'Us', U + Math.round(this.state().I * RP * 100) / 100, 200);
              await app.record('vi', 0);
            }
          }
        },
      },
      {
        title: '光照特性',
        html: '<p>反向电压调到 5 V，照度从 0 到 500 lx 每隔 50 lx 测一次光电流。</p>',
        status: () => `已测 ${rows('lux').length} 个照度`,
        check: () => rows('lux').length >= 6,
        auto: async () => {
          app.showTable(1); await app.view('全景');
          await this.seg('box', 'pulse', false); await this.seg('tester', 'mode', 'rev');
          for (let E = 0; E <= 500; E += 50) {
            await this.lux(E);
            if (rows('lux').some((r) => Math.abs(r.E - this.luxRead()) <= 2)) continue;
            await this.adj('tester', 'Us', Math.round((5 + this.state().I * RP) * 100) / 100, 150);
            await app.record('lux', 0);
          }
        },
      },
      {
        title: '开路电压',
        html: '<p>接法改为"开路"，在 10–1000 lx 范围内取几个照度（每个数量级 2–3 个），测开路电压。</p>',
        hint: '开路电压随照度增大而增大，但越来越慢：照度增大 10 倍，开路电压只增加几十毫伏。',
        status: () => `已测 ${rows('voc').length} 个照度`,
        check: () => rows('voc').length >= 5,
        auto: async () => {
          app.showTable(2); await app.view('全景');
          await this.seg('box', 'pulse', false); await this.seg('tester', 'mode', 'oc');
          for (const E of [10, 20, 50, 100, 200, 500, 1000]) {
            await this.lux(E);
            const Er = this.luxRead();
            if (rows('voc').some((r) => Math.abs(r.E - Er) <= Math.max(1, 0.02 * Er))) continue;
            await app.record('voc', 0);
          }
        },
      },
      {
        title: '时间响应',
        html: '<p>接法改为"负载 R_L + 示波器"，LED 换成方波脉冲，反向偏压 5 V，光源调弱（输出幅度不超过 0.3 V）。依次取 R_L = 1、2、5、10、20、50 kΩ，选合适的时基，读出上升时间。</p>',
        hint: '上升时间主要由 R_L 和总电容（结电容 + 示波器输入电容）的时间常数决定：t_r ≈ 2.2 R_L C。',
        status: () => `已测 ${rows('tr').length} 个负载`,
        check: () => rows('tr').length >= 4,
        auto: async () => {
          app.showTable(3); await app.view('仪器');
          await this.seg('tester', 'mode', 'load'); await this.seg('box', 'pulse', true);
          const U0 = rows('tr')[0]?.U ?? 5;
          await this.adj('tester', 'Us', U0, 200);
          for (const RL of RLS) {
            if (rows('tr').some((r) => r.RL === RL)) continue;
            await this.seg('tester', 'RL', RL);
            const Amax = 0.15; // V
            const Emax = Amax / (this.S * RL * 1e3);
            await this.lux(Math.min(60, Emax * (1 + this.cal)));
            const tr = this.pulseResp().tr * 1e6;
            const tb = TBS.filter((t) => tr / t >= 1.6 && tr / t <= 5.5).sort((x, y) => tr / y - tr / x)[0] ?? TBS[0];
            await this.seg('scope', 'tb', tb);
            await app.record('tr', 0);
          }
          await this.seg('box', 'pulse', false);
        },
      },
      {
        title: '数据处理',
        html: '<p>作伏安特性曲线；由光照特性直线求灵敏度 $S$；由 $U_{oc}$–$\\ln E$ 直线求理想因子 $n$；由 $t_r$–$R_L$ 直线求结电容。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, V = a.table('vi').completeRows(), L = a.table('lux').completeRows(), O = a.table('voc').completeRows(), R = a.table('tr').completeRows();
    if (V.length + L.length + O.length + R.length < 2) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = ''; const answers = [], plots = [];
    const Tc = this.dev.T - 273.15;
    if (V.length >= 2) {
      const groups = {};
      for (const r of V) { const k = Math.round(r.E / 10) * 10; (groups[k] ||= []).push(r); }
      const keys = Object.keys(groups).map(Number).sort((x, y) => x - y);
      const dark = (groups[0] || []).slice().sort((x, y) => x.U - y.U);
      html += '<h3>1. 反向伏安特性</h3>';
      if (dark.length) html += `<p>暗电流随反向电压由 ${(dark[0].I * 1000).toFixed(2)} nA（${dark[0].U.toFixed(2)} V）增大到 ${(dark.at(-1).I * 1000).toFixed(2)} nA（${dark.at(-1).U.toFixed(2)} V）。反向电压使耗尽层变宽，其中热激发产生的载流子增多，暗电流略有增加。</p>`;
      const lit = keys.filter((k) => k > 0).map((k) => { const g = groups[k].slice().sort((x, y) => x.U - y.U); return `${k} lx：${g[0].I.toFixed(2)}–${g.at(-1).I.toFixed(2)} μA`; });
      if (lit.length) html += `<p>有光照时，反向电流在 0–10 V 范围内几乎不变（${lit.join('；')}），只取决于照度。即使不加偏压（U = 0），光电流也已经存在，这就是光伏效应。</p>`;
      plots.push({ title: '反向伏安特性', xLabel: 'U / V', yLabel: 'I / μA', series: keys.flatMap((k) => { const d = groups[k].slice().sort((x, y) => x.U - y.U).map((r) => [r.U, r.I]); return [{ type: 'scatter', data: d, label: k ? `${k} lx` : '暗态' }, { type: 'line', data: d, label: '' }]; }) });
    }
    if (L.length >= 3) {
      const f = linFit(L.map((r) => r.E), L.map((r) => r.I)), S = f.k * 1000;
      html += `<h3>2. 光照特性</h3><p>反向电压 5 V 下光电流与照度的拟合直线：$I=${f.k.toFixed(5)}E${f.b >= 0 ? '+' : '-'}${Math.abs(f.b).toFixed(4)}$（μA，r = ${f.r.toFixed(6)}），线性很好；截距是暗电流。</p>
        <div class="result-box">光电灵敏度 $S=${S.toFixed(2)}$ nA/lx</div><p>器件参数（仿真设定值）${(this.S * 1e9).toFixed(2)} nA/lx，相对偏差 ${pct(relErr(S, this.S * 1e9))}，主要来自照度计的定标误差。</p>`;
      answers.push({ label: '光电灵敏度 $S$', unit: 'nA/lx', value: S, digits: 2, tolRel: 0.01 });
      plots.push({ title: '光电流 I – 照度 E', xLabel: 'E / lx', yLabel: 'I / μA', series: [{ type: 'scatter', data: L.map((r) => [r.E, r.I]), label: '实验点' }, { type: 'line', data: [0, Math.max(...L.map((r) => r.E))].map((x) => [x, f.k * x + f.b]), label: '拟合' }] });
    }
    if (O.length >= 3) {
      const f = linFit(O.map((r) => Math.log(r.E)), O.map((r) => r.V)), n = f.k / 1000 / VT(this.dev.T);
      html += `<h3>3. 开路电压</h3><p>开路时外电路电流为零，光电流全部变成正向扩散电流：$I_{ph}=I_s(e^{eU_{oc}/nkT}-1)$，所以 $U_{oc}\\approx\\dfrac{nkT}{e}\\ln\\dfrac{SE}{I_s}$，与 $\\ln E$ 成直线。拟合斜率 ${f.k.toFixed(2)} mV（r = ${f.r.toFixed(5)}），室温 ${Tc.toFixed(1)} °C 时 $kT/e$ = ${(VT(this.dev.T) * 1000).toFixed(2)} mV：</p>
        <div class="result-box">$n=\\dfrac{\\text{斜率}}{kT/e}=${n.toFixed(3)}$</div><p>器件参数（仿真设定值）${this.dev.n.toFixed(3)}，相对偏差 ${pct(relErr(n, this.dev.n))}。照度很低时光电流只有零点几微安，电压表内阻（10 MΩ）分走的电流不能忽略，读数会略偏低。</p>`;
      answers.push({ label: '理想因子 $n$', unit: '', value: n, digits: 3, tolRel: 0.01 });
      plots.push({ title: '开路电压 – ln E', xLabel: 'ln(E/lx)', yLabel: 'U_oc / mV', series: [{ type: 'scatter', data: O.map((r) => [Math.log(r.E), r.V]), label: '实验点' }, { type: 'line', data: [Math.min(...O.map((r) => Math.log(r.E))), Math.max(...O.map((r) => Math.log(r.E)))].map((x) => [x, f.k * x + f.b]), label: '拟合' }] });
    }
    if (R.length >= 3) {
      const f = linFit(R.map((r) => r.RL), R.map((r) => r.tr)), C = (f.k * 1000) / Math.log(9), Cj = C - CIN * 1e12, U = R[0].U, Cjt = junctionC(U, this.Cj0) * 1e12;
      html += `<h3>4. 时间响应</h3><p>输出电压按 $1-e^{-t/\\tau}$ 上升，$\\tau=R_L(C_j+C_{in})$，10%–90% 上升时间 $t_r=\\tau\\ln 9\\approx2.2\\tau$。$t_r$–$R_L$ 直线斜率 ${f.k.toFixed(4)} μs/kΩ（r = ${f.r.toFixed(5)}），截距 ${(f.b * 1000).toFixed(1)} ns 来自载流子的渡越时间。</p>
        <div class="result-box">$C_j+C_{in}=\\dfrac{\\text{斜率}}{\\ln 9}=${C.toFixed(1)}$ pF，$C_j=${Cj.toFixed(1)}$ pF（偏压 ${U.toFixed(2)} V，$C_{in}$ = 15 pF）</div><p>器件参数（仿真设定值）${Cjt.toFixed(1)} pF，相对偏差 ${pct(relErr(Cj, Cjt))}。负载电阻越大输出电压越高，但响应越慢；加大反向偏压使耗尽层变宽、结电容减小，可以加快响应。</p>`;
      answers.push({ label: '结电容 $C_j$', unit: 'pF', value: Cj, digits: 1, tolRel: 0.03 });
      plots.push({ title: '上升时间 – 负载电阻', xLabel: 'R_L / kΩ', yLabel: 't_r / μs', series: [{ type: 'scatter', data: R.map((r) => [r.RL, r.tr]), label: '实验点' }, { type: 'line', data: [0, Math.max(...R.map((r) => r.RL))].map((x) => [x, f.k * x + f.b]), label: '拟合' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 光敏二极管</h3><p>光敏二极管是一个 PN 结（常做成 PIN 结构）。能量大于禁带宽度的光子在耗尽区及其附近产生电子–空穴对，在内建电场作用下分离，形成从 N 区流向 P 区的光电流 $I_{ph}$。在照度不太大时，$I_{ph}=SE$，$S$ 叫光电灵敏度。</p>
<h3>2. 两种工作方式</h3><p><b>光电导方式</b>：加反向偏压，反向电流 $I=I_{ph}+I_d$。暗电流 $I_d$ 很小，所以反向电流几乎只取决于照度，伏安特性是一组几乎水平的直线。</p><p><b>光伏方式</b>：不加偏压，开路时光电流全部转为正向电流，</p>$$U_{oc}=\\frac{nkT}{e}\\ln\\left(\\frac{I_{ph}}{I_s}+1\\right)$$<p>$U_{oc}$ 与 $\\ln E$ 成直线，斜率为 $nkT/e$，$n$ 为理想因子（1–2）。</p>
<h3>3. 时间响应</h3><p>光敏二极管与负载电阻 $R_L$ 串联，输出取自 $R_L$ 两端。光脉冲到来时，输出按 $1-e^{-t/\\tau}$ 上升，$\\tau=R_L(C_j+C_{in})$，其中 $C_j$ 为结电容（随反向电压增大而减小，$C_j\\propto(1+U/V_{bi})^{-1/2}$），$C_{in}$ 为示波器输入电容与连线电容。上升时间 $t_r=2.2\\tau$。</p>
<h3>4. 本仿真的计算模型</h3><p>反向电流 $I=SE+I_s(1-e^{-U/nV_T})+I_g\\sqrt U+U/R_{sh}$；开路电压按电压表内阻 10 MΩ 求解；脉冲响应为 RC 一阶响应串联几纳秒的渡越时间（两极点）。灵敏度、饱和电流、理想因子、零偏结电容、照度计定标误差都个体随机。</p>`;
  }
}
