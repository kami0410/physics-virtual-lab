// 实验：电子束的电偏转与磁聚焦（示波管 + 长螺线管）
// 示波管装在长螺线管内，管轴与螺线管轴重合。电偏转、磁聚焦的计算见 physics/crt.js。
// 偏转板边缘场使实际偏转灵敏度比 l_pL/2dU_a 小 0.5%–2.5%；地磁场的横向分量使未偏转的光点偏离屏中心（随 U_a 变化，要用 X、Y 位移旋钮调零），
// 纵向分量叠加在螺线管磁场上（正、反向电流取平均可以消去）。聚焦极电压与 U_a 之比合适时光点最小。
import * as THREE from 'three';
import { meta, thumb } from './ebeam.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, gauss, clamp, relErr, pct, linFit, propFit, mean } from '../core/Stats.js';
import { spot, deflAngle, focusB, solenoidK, beam, EM, QE, ME, C0 } from '../physics/crt.js';

const LP = 0.018, DP = 0.005, LL = 0.12; // 偏转板长、间距，偏转区到屏的距离（m，铭牌值）
const NS = 1000, LS = 0.25, DS = 0.09; // 螺线管匝数、长度、直径
const UAS = [700, 800, 900, 1000, 1100];
const UAC = 18; // 交流偏转电压幅值（V）
const R_SCR = 20; // 荧光屏有效半径（mm）

export class ElectronBeamExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.geo = { lp: LP, d: DP, f: rand(0.975, 0.995) };
    this.L = LL * (1 + gauss(0.0008)); this.K = solenoidK(NS, LS, DS) * (1 + gauss(0.0015));
    this.Bz = rand(15, 35) * 1e-6 * (Math.random() < 0.5 ? -1 : 1);
    const a = rand(0, Math.PI * 2), m = rand(1.5, 3);
    this.e0 = [m * Math.cos(a), m * Math.sin(a)]; // U_a = 1000 V 时地磁场横向分量造成的光点偏移（mm）
    this.phi0 = rand(0.2, 0.26);
    this.power = false; this.Ua = 800; this.Uf = 120; this.Uy = 0; this.ac = false; this.I = 0; this.dir = 1; this.sx = 0; this.sy = 0;
  }
  earth() { const k = Math.sqrt(1000 / this.Ua); return [this.e0[0] * k, this.e0[1] * k]; }
  get B() { return this.dir * this.K * this.I + this.Bz; }
  theta() { const { v, g } = beam(this.Ua); return ((EM / g) * this.B * this.L) / v; }
  radius() { return clamp(0.3 + 25 * Math.abs(this.Uf / this.Ua - this.phi0), 0.3, 4); }
  /** 光点中心与交流亮线的半长矢量（mm） */
  geom() {
    const e = this.earth(), s = spot(0, deflAngle(this.Uy, this.Ua, this.geo), this.B, this.Ua, this.L);
    const c = [e[0] + this.sx + 1000 * s[0], e[1] + this.sy + 1000 * s[1]];
    const h = this.ac ? spot(0, deflAngle(UAC, this.Ua, this.geo), this.B, this.Ua, this.L).map((x) => 1000 * x) : [0, 0];
    return { c, h, r: this.radius() };
  }
  zeroErr() { const e = this.earth(); return Math.hypot(e[0] + this.sx, e[1] + this.sy); }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 58, 82], target: [0, 8, -6] }, { name: '荧光屏', pos: [26, 18, 24], target: [10, 12, -4] }, { name: '电源', pos: [-18, 28, 30], target: [-18, 6, -18] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(140, 86));
    app.stage.setLightTarget(0, 6, 0);
    // 螺线管与示波管（沿 x 轴）
    const tg = new THREE.Group(); tg.position.set(-2, 0, -4);
    for (const x of [-12, 12]) tg.add(mesh(new THREE.BoxGeometry(3, 7, 10), MAT.paint(0x3a3f44), x, 3.5, 0));
    const sol = mesh(new THREE.CylinderGeometry(5.2, 5.2, 28, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide }), 0, 12, 0); sol.rotation.z = Math.PI / 2; tg.add(sol);
    for (let k = -13; k <= 13; k += 1.3) { const r = mesh(new THREE.TorusGeometry(5.25, 0.12, 6, 40), MAT.paint(0x8a4f22), k, 12, 0); r.rotation.y = Math.PI / 2; tg.add(r); }
    const neck = mesh(new THREE.CylinderGeometry(1.4, 1.4, 22, 20), MAT.glass(0xd8eef7, 0.3), -4, 12, 0); neck.rotation.z = Math.PI / 2; tg.add(neck);
    const cone = mesh(new THREE.CylinderGeometry(4.2, 1.4, 6, 32, 1, true), MAT.glass(0xd8eef7, 0.3), 17, 12, 0); cone.rotation.z = Math.PI / 2; tg.add(cone);
    this.face = mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0x0c1a12, emissive: 0x1f6b35, emissiveIntensity: 0 }), 20.1, 12, 0); this.face.rotation.z = Math.PI / 2; tg.add(this.face);
    app.addComponent(new Component({
      key: 'tube', name: '示波管与螺线管', zone: 'none', fixed: true, object: tg, labelY: 22,
      icon: '<svg viewBox="0 0 64 40"><path d="M6 16h30l14-8v24l-14-8H6z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 10v20M16 10v20M22 10v20M28 10v20" stroke="currentColor" stroke-width="1"/></svg>',
      desc: `示波管装在长螺线管内，管轴与螺线管轴重合。偏转板长 l<sub>p</sub> = ${LP * 1000} mm，间距 d = ${DP * 1000} mm；偏转区（电子束交叉点）到荧光屏的距离 L = ${(LL * 1000).toFixed(0)} mm。螺线管 N = ${NS} 匝，长 L<sub>s</sub> = ${LS * 1000} mm，直径 D<sub>s</sub> = ${DS * 1000} mm，B = μ<sub>0</sub>NI/√(L<sub>s</sub>²+D<sub>s</sub>²)。荧光屏上的坐标格每小格 1 mm。`,
    }));
    // 电源箱
    const box = new THREE.Group(); box.position.set(-18, 0, -20);
    box.add(mesh(new THREE.BoxGeometry(46, 12, 16), MAT.paint(0xd6d3cb), 0, 6, 0));
    const mu = (this.uBox = meterBox(18, 9, 1, '加速电压')); mu.group.position.set(-11, 1.6, 7.6); box.add(mu.group);
    const mi = (this.iBox = meterBox(18, 9, 1, '励磁电流')); mi.group.position.set(11, 1.6, 7.6); box.add(mi.group);
    app.addComponent(new Component({
      key: 'supply', name: '电子束实验仪', zone: 'none', fixed: true, required: true, object: box, labelY: 16,
      desc: '示波管的高压电源（加速电压 600–1200 V，聚焦极电压 0–400 V）、偏转电压（直流 ±50 V，可叠加 50 Hz 交流）、光点 X/Y 位移，以及螺线管的直流励磁电源（0–3 A，可换向）。',
      controls: () => [
        { type: 'toggle', label: '电源', get: () => this.power, set: (v) => { this.power = v; app.changed(); } },
        { type: 'knob', label: '加速电压 U_a', get: () => this.Ua, set: (v) => { this.Ua = Math.round(clamp(v, 600, 1200)); app.changed(); }, min: 600, max: 1200, step: 1, bigStep: 50, perRev: 100, digits: 0, unit: 'V' },
        { type: 'knob', label: '聚焦极电压', get: () => this.Uf, set: (v) => { this.Uf = Math.round(clamp(v, 0, 400)); app.changed(); }, min: 0, max: 400, step: 1, bigStep: 10, perRev: 40, digits: 0, unit: 'V' },
        { type: 'knob', label: 'X 位移', get: () => this.sx, set: (v) => { this.sx = Math.round(clamp(v, -6, 6) * 20) / 20; app.changed(); }, min: -6, max: 6, step: 0.05, bigStep: 0.5, perRev: 2, digits: 2, unit: 'mm' },
        { type: 'knob', label: 'Y 位移', get: () => this.sy, set: (v) => { this.sy = Math.round(clamp(v, -6, 6) * 20) / 20; app.changed(); }, min: -6, max: 6, step: 0.05, bigStep: 0.5, perRev: 2, digits: 2, unit: 'mm' },
        { type: 'knob', label: 'Y 偏转电压（直流）', get: () => this.Uy, set: (v) => { this.Uy = Math.round(clamp(v, -50, 50)); app.changed(); }, min: -50, max: 50, step: 1, bigStep: 5, perRev: 20, digits: 0, unit: 'V' },
        { type: 'toggle', label: `叠加交流偏转（${UAC} V 峰值）`, get: () => this.ac, set: (v) => { this.ac = v; app.changed(); } },
        { type: 'knob', label: '励磁电流', get: () => this.I, set: (v) => { this.I = Math.round(clamp(v, 0, 3) * 1000) / 1000; app.changed(); }, min: 0, max: 3, step: 0.001, bigStep: 0.05, perRev: 0.2, digits: 3, unit: 'A' },
        { type: 'segment', label: '电流方向', options: [{ value: 1, label: '正向' }, { value: -1, label: '反向' }], get: () => this.dir, set: (v) => { this.dir = v; app.changed(); } },
      ],
    }));
    this.view = app.addView({ id: 'screen', title: '荧光屏', w: 260, h: 260, res: 1.6 });
  }
  update() {
    const on = this.power;
    const sU = on ? this.Ua.toFixed(0) : '', sI = on ? this.I.toFixed(3) : '';
    if (sU !== this._sU) { this._sU = sU; this.uBox.setText(sU, on ? 'V' : '', on ? '第二阳极' : ''); }
    if (sI + this.dir !== this._sI) { this._sI = sI + this.dir; this.iBox.setText(sI, on ? 'A' : '', on ? (this.dir > 0 ? '正向' : '反向') : ''); }
    this.face.material.emissiveIntensity = on ? 0.35 : 0;
    this.draw();
  }
  draw() {
    const v = this.view, g = v.ctx, W = v.W, H = v.H, cx = W / 2, cy = H / 2, k = (W * 0.46) / R_SCR;
    g.fillStyle = '#2a2f33'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#0b1610'; g.beginPath(); g.arc(cx, cy, R_SCR * k * 1.04, 0, 7); g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, R_SCR * k * 1.04, 0, 7); g.clip();
    if (this.power) {
      const { c, h, r } = this.geom(), X = (x) => cx + x * k, Y = (y) => cy - y * k;
      g.globalCompositeOperation = 'lighter';
      const blob = (x, y, rr, a) => { const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), rr * k * 1.6); gr.addColorStop(0, `rgba(170,255,190,${a})`); gr.addColorStop(0.45, `rgba(60,220,110,${a * 0.6})`); gr.addColorStop(1, 'rgba(20,120,50,0)'); g.fillStyle = gr; g.beginPath(); g.arc(X(x), Y(y), rr * k * 1.6, 0, 7); g.fill(); };
      const len = Math.hypot(...h);
      if (len < 0.05) blob(c[0], c[1], r, 0.95);
      else {
        const n = Math.max(8, Math.ceil((len * 2) / Math.max(0.15, r * 0.5)));
        // 正弦扫描：两端停留时间长，亮度高
        for (let i = 0; i <= n; i++) { const s = -1 + (2 * i) / n, w = 1 / Math.sqrt(Math.max(0.04, 1 - s * s)); blob(c[0] + s * h[0], c[1] + s * h[1], r, Math.min(0.9, (0.9 * w * 3) / n + 0.08)); }
      }
      g.globalCompositeOperation = 'source-over';
    }
    g.restore();
    // 坐标格
    g.strokeStyle = 'rgba(150,170,160,.45)'; g.lineWidth = 1;
    for (let m = -R_SCR; m <= R_SCR; m += 5) { const yy = Math.sqrt(R_SCR * R_SCR - m * m) * k; g.beginPath(); g.moveTo(cx + m * k, cy - yy); g.lineTo(cx + m * k, cy + yy); g.moveTo(cx - yy, cy + m * k); g.lineTo(cx + yy, cy + m * k); g.stroke(); }
    g.strokeStyle = 'rgba(190,210,200,.7)';
    for (let m = -R_SCR + 1; m < R_SCR; m++) { const t = m % 5 === 0 ? 4 : 2.2; g.beginPath(); g.moveTo(cx + m * k, cy - t); g.lineTo(cx + m * k, cy + t); g.moveTo(cx - t, cy - m * k); g.lineTo(cx + t, cy - m * k); g.stroke(); }
    g.strokeStyle = '#555c60'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R_SCR * k * 1.04, 0, 7); g.stroke();
    if (!this.power) return v.foot('电源未开');
    const { c, h } = this.geom(), len = 2 * Math.hypot(...h);
    v.foot(this.ac ? `亮线长约 ${len.toFixed(1)} mm${this.I > 0 ? `，方向 ${((Math.atan2(h[1], h[0]) * 180) / Math.PI).toFixed(0)}°` : ''}` : Math.hypot(...c) > R_SCR ? '光点跑出了荧光屏' : '光点');
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'edef', title: '电偏转（无磁场）', maxRows: 30,
        columns: [{ key: 'Ua', label: 'U_a/V', digits: 0, auto: true }, { key: 'Uy', label: 'U_y/V', digits: 0, auto: true }, { key: 'y', label: '光点位移 y/mm', digits: 1, readTol: 0.3 }],
        buttons: [{ label: '记录光点位置', onClick: (t) => this.recE(t) }],
        note: '螺线管电流为 0。每个加速电压下先调聚焦、再用 X/Y 位移把 U_y = 0 时的光点调到屏中心，然后改变 U_y，从屏上坐标格读光点的竖直位移 y。',
      },
      {
        id: 'focus', title: '磁聚焦电流（第一次聚焦）', fixedRows: true,
        initRows: () => UAS.map((Ua) => ({ Ua })),
        columns: [{ key: 'Ua', label: 'U_a/V', digits: 0, readonly: true }, { key: 'Ip', label: '正向 I/A', digits: 3, readTol: 0.004 }, { key: 'In', label: '反向 I/A', digits: 3, readTol: 0.004 }, { key: 'Im', label: '平均 I/A', digits: 3, calc: (r) => (r.Ip + r.In) / 2 }],
        buttons: [{ label: '记录聚焦电流', onClick: (t) => this.recF(t) }],
        note: '叠加交流偏转电压，屏上出现一条亮线。增大励磁电流，亮线一边旋转一边缩短，缩成一点时记下电流。换向后再测一次。',
      },
    ];
  }
  recE(t) {
    const a = this.app;
    if (!this.power) return a.toast('电源没开', 'warn');
    if (this.I > 0) return a.toast('测电偏转时螺线管电流要为 0', 'warn');
    if (this.ac) return a.toast('先关掉交流偏转，只加直流偏转电压', 'warn');
    if (this.radius() > 1) return a.toast('光点太大，先调聚焦极电压使光点最小', 'warn');
    if (this.zeroErr() > 0.3) return a.toast(`这个加速电压下还没调零：U_y = 0 时光点不在屏中心（偏 ${this.zeroErr().toFixed(1)} mm）`, 'warn');
    const { c } = this.geom();
    if (Math.abs(c[1]) > R_SCR - 1) return a.toast('光点超出坐标格范围，减小偏转电压', 'warn');
    if (t.rows.some((r) => r.Ua === this.Ua && r.Uy === this.Uy)) return a.toast('这一组已经记过了', 'warn');
    t.addRow({ Ua: this.Ua, Uy: this.Uy, y: Math.round(c[1] * 10) / 10 });
  }
  recF(t) {
    const a = this.app;
    if (!this.power) return a.toast('电源没开', 'warn');
    if (!this.ac) return a.toast('先叠加交流偏转电压：屏上有一条亮线才看得出是否聚焦', 'warn');
    const i = t.rows.findIndex((r) => r.Ua === this.Ua);
    if (i < 0) return a.toast(`加速电压 ${this.Ua} V 不在表中，调到 ${UAS.join('、')} V 之一`, 'warn');
    const { h } = this.geom();
    if (this.I <= 0 || Math.hypot(...h) > 0.25) return a.toast('亮线还没有缩成一点：还没聚焦', 'warn');
    if (Math.abs(this.theta()) > 3 * Math.PI) return a.toast('这是第二次（或更高次）聚焦，表中记第一次聚焦的电流', 'warn');
    t.set(i, this.dir > 0 ? 'Ip' : 'In', this.I);
  }

  // ======================= 自动操作 =======================
  async adj(key, to, ms = 300) { const a = this.app; a.select(a.comp('supply')); await a.tween(() => this[key], (v) => (this[key] = v), to, ms); this[key] = to; a.changed(); await a.wait(80); }
  async flag(key, v) { const a = this.app; a.select(a.comp('supply')); this[key] = v; a.renderInspector(); a.changed(); await a.wait(120); }
  /** 改变加速电压，并重新聚焦、调零 */
  async setUa(Ua) {
    await this.adj('Ua', Ua, 300);
    await this.adj('Uf', Math.round(this.phi0 * Ua), 250);
    const e = this.earth();
    await this.adj('sx', Math.round(-e[0] * 20) / 20, 200); await this.adj('sy', Math.round(-e[1] * 20) / 20, 200);
  }
  steps() {
    const app = this.app, rows = (id) => app.table(id).completeRows();
    const groups = () => { const m = new Map(); for (const r of rows('edef')) m.set(r.Ua, (m.get(r.Ua) || 0) + 1); return m; };
    return [
      {
        title: '开机、聚焦、调零',
        html: '<p>打开电源，加速电压调到约 800 V。调聚焦极电压使光点最小、最清晰。螺线管电流为 0、偏转电压为 0 时，用 X、Y 位移旋钮把光点调到荧光屏中心。</p>',
        hint: '光点不在中心，主要是地磁场的横向分量使电子束偏转。加速电压改变后要重新调焦、调零。',
        check: () => this.power && this.radius() <= 1 && this.zeroErr() <= 0.3 && this.I === 0 && this.Uy === 0,
        status: () => (!this.power ? '电源未开' : `光点直径约 ${(2 * this.radius()).toFixed(1)} mm，距中心 ${this.zeroErr().toFixed(1)} mm`),
        auto: async () => { await app.view('荧光屏'); await this.flag('power', true); if (this.I) await this.adj('I', 0); if (this.ac) await this.flag('ac', false); await this.adj('Uy', 0, 200); await this.setUa(800); },
      },
      {
        title: '测电偏转灵敏度',
        html: '<p>在 $U_a$ = 800 V 和 1000 V 两个加速电压下，$U_y$ 从 −40 V 到 +40 V 每隔 10 V 读一次光点位移 $y$。</p>',
        hint: '每换一个加速电压，都要重新聚焦、调零。',
        status: () => `已测 ${[...groups()].map(([u, n]) => `${u} V：${n} 点`).join('，') || '0 点'}`,
        check: () => [...groups().values()].filter((n) => n >= 5).length >= 2,
        diagnose: () => (this.I > 0 ? [{ msg: '螺线管电流不为 0。', fix: { label: '调到 0', run: async () => { this.I = 0; } } }] : this.ac ? [{ msg: '交流偏转还开着。', fix: { label: '关掉', run: async () => { this.ac = false; } } }] : []),
        auto: async () => {
          app.showTable(0); await app.view('荧光屏');
          if (!this.power) await this.flag('power', true);
          if (this.I) await this.adj('I', 0); if (this.ac) await this.flag('ac', false);
          for (const Ua of [800, 1000]) {
            if (rows('edef').filter((r) => r.Ua === Ua).length >= 9) continue;
            await this.adj('Uy', 0, 200); await this.setUa(Ua);
            for (let Uy = -40; Uy <= 40; Uy += 10) {
              if (rows('edef').some((r) => r.Ua === Ua && r.Uy === Uy)) continue;
              await this.adj('Uy', Uy, 200); await app.record('edef', 0);
            }
          }
          await this.adj('Uy', 0, 200);
        },
      },
      {
        title: '磁聚焦测荷质比',
        html: '<p>偏转电压调回 0，叠加交流偏转电压。加速电压依次取 700、800 … 1100 V（每次重新聚焦、调零），增大励磁电流直到亮线第一次缩成一点，记下电流；电流换向后再测一次。</p>',
        hint: '亮线缩短的同时在旋转，接近聚焦时电流要慢慢调。地磁场的纵向分量使正、反向的聚焦电流略有不同。',
        status: () => `已测 ${rows('focus').length} 个加速电压（正、反向都测了的）`,
        check: () => rows('focus').length >= 3,
        diagnose: () => (!this.ac ? [{ msg: '没有叠加交流偏转电压，看不出亮线是否缩成一点。', fix: { label: '打开交流', run: async () => { this.ac = true; } } }] : []),
        auto: async () => {
          app.showTable(1); await app.view('荧光屏');
          if (!this.power) await this.flag('power', true);
          await this.adj('Uy', 0, 200); if (!this.ac) await this.flag('ac', true);
          for (const Ua of UAS) {
            const r = app.table('focus').rows.find((x) => x.Ua === Ua);
            if (typeof r.Ip === 'number' && typeof r.In === 'number') continue;
            await this.adj('I', 0, 300); await this.setUa(Ua);
            for (const d of [1, -1]) {
              if (typeof r[d > 0 ? 'Ip' : 'In'] === 'number') continue;
              await this.adj('I', 0, 250); await this.flag('dir', d);
              const I = Math.round(((focusB(Ua, this.L) - d * this.Bz) / this.K) * 1000) / 1000;
              await this.adj('I', I, 600); await app.record('focus', 0);
            }
          }
          await this.adj('I', 0, 300);
        },
      },
      {
        title: '数据处理',
        html: '<p>由各加速电压下 $y$–$U_y$ 直线的斜率求偏转灵敏度 $D$，检验 $D\\cdot U_a$ 是否为常量；由 $U_a$–$\\bar I^2$ 直线的斜率求电子的荷质比。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, E = a.table('edef').completeRows(), F = a.table('focus').completeRows();
    const by = new Map(); for (const r of E) { if (!by.has(r.Ua)) by.set(r.Ua, []); by.get(r.Ua).push(r); }
    const G = [...by].filter(([, rs]) => rs.length >= 3).map(([Ua, rs]) => ({ Ua, rs, fit: linFit(rs.map((r) => r.Uy), rs.map((r) => r.y)) }));
    if (!G.length && F.length < 2) return { html: '<p>请先测量电偏转（至少一个加速电压下 3 个点）或磁聚焦电流（至少两个加速电压）。</p>', ok: false };
    let html = ''; const answers = [], plots = [];
    if (G.length) {
      const th = (LP * LL * 1000) / (2 * DP);
      html += `<h3>1. 电偏转灵敏度</h3><table><tr><th>U_a/V</th><th>D/(mm/V)</th><th>D·U_a/mm</th><th>r</th></tr>${G.map((g) => `<tr><td>${g.Ua}</td><td>${g.fit.k.toFixed(4)}</td><td>${(g.fit.k * g.Ua).toFixed(1)}</td><td>${g.fit.r.toFixed(5)}</td></tr>`).join('')}</table>`;
      const DU = G.map((g) => g.fit.k * g.Ua), m = mean(DU);
      if (G.length >= 2) html += `<p>不同加速电压下 $D\\cdot U_a$ 的最大相对偏差 ${pct((Math.max(...DU) - Math.min(...DU)) / m)}：偏转灵敏度与加速电压成反比。</p>`;
      html += `<p>由电极尺寸算出 $D\\cdot U_a=\\dfrac{l_pL}{2d}=${th.toFixed(1)}$ mm，实测平均 ${m.toFixed(1)} mm，相对偏差 ${pct(relErr(m, th))}。实测值略小，是因为偏转板边缘的电场比板间弱，等效板长比实际短。</p>`;
      answers.push({ label: `$U_a$ = ${G[0].Ua} V 时的偏转灵敏度 $D$`, unit: 'mm/V', value: G[0].fit.k, digits: 4, tolRel: 0.01 });
      plots.push({ title: '光点位移 y – 偏转电压 U_y', xLabel: 'U_y / V', yLabel: 'y / mm', series: G.flatMap((g) => [{ type: 'scatter', data: g.rs.map((r) => [r.Uy, r.y]), label: `${g.Ua} V` }, { type: 'line', data: [-45, 45].map((x) => [x, g.fit.k * x + g.fit.b]), label: '' }]) });
    }
    if (F.length >= 2) {
      const K = solenoidK(NS, LS, DS), c = (8 * Math.PI * Math.PI) / (LL * LL * K * K);
      const rows = F.map((r) => { const I = (r.Ip + r.In) / 2; return { ...r, I, em: (c * r.Ua) / (I * I) }; });
      const pf = propFit(rows.map((r) => r.I * r.I), rows.map((r) => r.Ua)), em = c * pf.k, err = relErr(em, EM);
      html += `<h3>2. 磁聚焦测荷质比</h3><p>螺线管中的磁场 $B=KI$，$K=\\dfrac{\\mu_0N}{\\sqrt{L_s^2+D_s^2}}=${(K * 1000).toFixed(4)}$ mT/A。第一次聚焦时电子在磁场中恰好转过一周：$\\dfrac{eB}{m}\\cdot\\dfrac{L}{v}=2\\pi$，$v=\\sqrt{2eU_a/m}$，所以 $\\dfrac em=\\dfrac{8\\pi^2U_a}{L^2K^2I^2}$。</p>
        <table><tr><th>U_a/V</th><th>正向 I/A</th><th>反向 I/A</th><th>平均 I/A</th><th>e/m/(10¹¹ C/kg)</th></tr>${rows.map((r) => `<tr><td>${r.Ua}</td><td>${r.Ip.toFixed(3)}</td><td>${r.In.toFixed(3)}</td><td>${r.I.toFixed(3)}</td><td>${(r.em / 1e11).toFixed(4)}</td></tr>`).join('')}</table>
        <p>正、反向聚焦电流相差 ${(mean(rows.map((r) => Math.abs(r.Ip - r.In))) * 1000).toFixed(1)} mA，相当于沿管轴约 ${((mean(rows.map((r) => Math.abs(r.Ip - r.In))) * K) / 2 * 1e6).toFixed(0)} μT 的地磁场分量，取平均后消去。作 $U_a$–$\\bar I^2$ 图，过原点直线的斜率 ${pf.k.toFixed(1)} V/A²：</p>
        <div class="result-box">$\\dfrac em=\\dfrac{8\\pi^2}{L^2K^2}\\cdot\\text{斜率}=${(em / 1e11).toFixed(4)}\\times10^{11}$ C/kg</div>
        <p>公认值 1.7588×10¹¹ C/kg，相对误差 ${pct(err)}。加速电压 1000 V 的电子速度已有光速的 6%，按相对论计算动量比 $\\sqrt{2meU_a}$ 大约 ${((Math.sqrt(1 + (QE * 1000) / (2 * ME * C0 * C0)) - 1) * 100).toFixed(2)}%，使测得的 e/m 偏小约 ${(((QE * 1000) / (2 * ME * C0 * C0)) * 100).toFixed(2)}%，可以忽略。</p>`;
      answers.push({ label: '电子荷质比 $e/m$', unit: '×10¹¹ C/kg', value: em / 1e11, digits: 4, tolRel: 0.01 });
      plots.push({ title: 'U_a – Ī²', xLabel: 'Ī² / A²', yLabel: 'U_a / V', series: [{ type: 'scatter', data: rows.map((r) => [r.I * r.I, r.Ua]), label: '实验点' }, { type: 'line', data: [0, Math.max(...rows.map((r) => r.I * r.I)) * 1.05].map((x) => [x, pf.k * x]), label: '过原点拟合' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 示波管</h3><p>示波管由电子枪、偏转系统和荧光屏组成。阴极发射的电子经第一阳极（聚焦极）和第二阳极加速、会聚，以速度 $v=\\sqrt{2eU_a/m}$ 射出，在荧光屏上打出一个亮点。</p>
<h3>2. 电偏转</h3><p>电子穿过长 $l_p$、间距 $d$、电压 $U_y$ 的偏转板时获得横向速度，出板后偏转角 $\\tan\\alpha=\\dfrac{l_pU_y}{2dU_a}$，在距偏转区 $L$ 的屏上偏移</p>$$y=\\frac{l_pL}{2dU_a}U_y,\\qquad D=\\frac{y}{U_y}=\\frac{l_pL}{2dU_a}$$<p>$D$ 叫电偏转灵敏度，与加速电压成反比。</p>
<h3>3. 纵向磁场聚焦</h3><p>示波管放在长螺线管中，磁场 $B$ 沿管轴。电子的纵向速度 $v$ 不受影响，横向速度 $v_\\perp$ 使它绕磁感线作匀速圆周运动，周期 $T=\\dfrac{2\\pi m}{eB}$ 与 $v_\\perp$ 无关。所以从偏转区同一点出发、横向速度不同的电子，经过一个周期都回到轴线上同一点。若渡越时间 $L/v$ 恰好等于 $T$，电子在屏上会聚成一点（第一次聚焦）：</p>$$\\frac{L}{v}=\\frac{2\\pi m}{eB}\\quad\\Rightarrow\\quad\\frac em=\\frac{8\\pi^2U_a}{L^2B^2}$$<p>在偏转板上加交流电压，屏上是一条亮线；增大 $B$，亮线一边旋转一边缩短（转过 $\\theta/2$，长度按 $|\\sin(\\theta/2)|/(\\theta/2)$ 变化，$\\theta=eBL/mv$），$\\theta=2\\pi$ 时缩成一点。</p>
<h3>4. 本仿真的计算模型</h3><p>横向运动用复数解析解 $z=u\\,\\dfrac{1-e^{-i\\theta}}{i\\theta}\\cdot\\dfrac Lv$ 计算，速度按相对论动量求出。偏转板边缘场修正、螺线管磁场系数与铭牌值的微小差别、地磁场的横向与纵向分量、聚焦极电压的最佳比例都个体随机。</p>`;
  }
}
