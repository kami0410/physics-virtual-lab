// 实验：模拟法描绘静电场（导电纸 · 同轴电极 · 两平行长直导线 · 平行板）
// 导电纸上的稳恒电流场与真空中的静电场满足同样的拉普拉斯方程。电位分布由 physics/laplace.js 数值求解：
// 电极边界用 Shortley–Weller 精确处理，纸边绝缘，导电纸的电导率有约 ±10% 的不均匀，等势线因此略有畸变。
import * as THREE from 'three';
import { meta, thumb } from './efield.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, canvasTexture, meterBox } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss, fmtU, linFit } from '../core/Stats.js';
import { FieldSheet, SDF, coaxR } from '../physics/laplace.js';
import { efieldFig } from './mechFigs2.js';

const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;
const R1 = 8, R2 = 60; // 同轴电极标称半径 mm
const TARGETS = { coax: [2, 4, 6, 8], pair: [2, 3, 4, 5, 6, 7, 8], plates: [2, 4, 5, 6, 8] };
const SETS = {
  coax: { name: '同轴电极（模拟同轴电缆）', box: [-66, 66, -66, 66] },
  pair: { name: '两平行长直导线（模拟等量异号线电荷）', box: [-80, 80, -60, 60] },
  plates: { name: '平行板电极（看边缘效应）', box: [-80, 80, -60, 60] },
};
const COLORS = ['#c41e3a', '#a86a12', '#2d7a4e', '#1d4ed8', '#6d28d9', '#0e7490', '#9d174d'];

export class EFieldExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.r1 = R1 * (1 + rand(-0.006, 0.006)); this.r2 = R2 * (1 + rand(-0.003, 0.003));
    // 导电纸不均匀：几个随机方向的缓变起伏叠加
    this.waves = Array.from({ length: 5 }, () => ({ kx: rand(-1, 1) / 14, ky: rand(-1, 1) / 14, ph: rand(0, 6.28), a: rand(0.03, 0.05) }));
    this.ex = rand(-0.35, 0.35); this.ey = rand(-0.35, 0.35); // 内电极没有压在正中心
    this.set = 'coax'; this.V0 = 0; this.on = false; this.target = 2;
    this.px = 30; this.py = 0;
    this.meterErr = 1 + rand(-0.002, 0.002);
    this.sheets = {};
    this.sheet();
  }
  sigma(x, y) { let s = 1; for (const w of this.waves) s += w.a * Math.sin(w.kx * x + w.ky * y + w.ph); return s; }
  /** 当前电极的场（电极电位按 1 V 求解，读数时乘以电源电压） */
  sheet() {
    if (this.sheets[this.set]) return this.sheets[this.set];
    const [x0, x1, y0, y1] = SETS[this.set].box, sg = (x, y) => this.sigma(x, y);
    let el;
    if (this.set === 'coax') el = [{ sdf: SDF.circle(this.ex, this.ey, this.r1), V: 1 }, { sdf: SDF.outside(0, 0, this.r2), V: 0 }];
    else if (this.set === 'pair') el = [{ sdf: SDF.circle(-40, 0, 5), V: 1 }, { sdf: SDF.circle(40, 0, 5), V: 0 }];
    else el = [{ sdf: SDF.rect(-37, -40, -33, 40), V: 1 }, { sdf: SDF.rect(33, -40, 37, 40), V: 0 }];
    const F = new FieldSheet({ x0, x1, y0, y1, n: this.set === 'coax' ? 181 : 161, electrodes: el, sigma: sg });
    F.solve({ tol: 1e-8 });
    return (this.sheets[this.set] = F);
  }
  /** 探针处的真实电位（V） */
  Utrue(x = this.px, y = this.py) { if (!this.on) return 0; const v = this.sheet().at(x, y); return isFinite(v) ? v * this.V0 : NaN; }
  /** 数字电压表示数：三位半，分辨率 0.01 V */
  get reading() { const u = this.Utrue(); if (!isFinite(u)) return NaN; return Math.round((u * this.meterErr + gauss(0.002)) * 100) / 100; }
  setSet(s) {
    if (s === this.set) return;
    this.set = s; this.target = TARGETS[s][0];
    const [x0, x1, y0, y1] = SETS[s].box; this.px = clamp(this.px, x0, x1); this.py = clamp(this.py, y0, y1);
    this.app.toast('正在计算这组电极的电位分布…', '');
    this.sheet(); this.paintBoard(); this.app.renderInspector(); this.app.changed();
  }
  moveProbe(x, y) {
    const [x0, x1, y0, y1] = SETS[this.set].box;
    this.px = clamp(Math.round(x * 10) / 10, x0, x1); this.py = clamp(Math.round(y * 10) / 10, y0, y1);
    this.app.changed();
  }

  // ======================= 场景 =======================
  cameras() {
    return [
      { name: '全景', pos: [0, 95, 110], target: [0, 4, 0] },
      { name: '导电纸', pos: [0, 70, 26], target: [0, 2, -2] },
    ];
  }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 90));
    app.stage.setLightTarget(0, 5, 0);
    // 描迹板：底板 + 导电纸（纹理随电极更换）
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(42, 1.6, 34), MAT.paint(0x3a3f46), 0, 0.8, 0));
    this.tex = canvasTexture(512, 400, () => {});
    this.paper = mesh(new THREE.PlaneGeometry(36, 28), new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.95 }), 0, 1.62, 0);
    this.paper.rotation.x = -Math.PI / 2; g.add(this.paper);
    // 探针（笔杆 + 针尖）
    this.probe = new THREE.Group();
    this.probe.add(mesh(new THREE.CylinderGeometry(0.35, 0.12, 6, 12), MAT.paint(0xb91c1c), 0, 3.0, 0));
    this.probe.add(mesh(new THREE.ConeGeometry(0.12, 0.6, 8), MAT.metal(), 0, 0, 0));
    g.add(this.probe);
    this.paintBoard();
    app.addComponent(new Component({
      key: 'board', name: '导电纸描迹板', zone: 'none', fixed: true, required: true, object: g, labelY: 10,
      icon: SVG('<rect x="8" y="6" width="48" height="28" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="20" r="4" fill="currentColor"/>'),
      desc: '导电纸上压着金属电极，电极接直流电源。探针接数字电压表（负端接电源负极），在导电纸上移动探针即可测出各点的电位。点击“导电纸”观察窗中的任意位置，探针就移到那里。',
      controls: () => [
        { type: 'select', label: '电极', get: () => this.set, set: (v) => this.setSet(v), options: Object.entries(SETS).map(([k, s]) => ({ value: k, label: s.name })) },
        { type: 'knob', label: '探针 x', get: () => this.px, set: (v) => this.moveProbe(v, this.py), step: 0.1, bigStep: 2, perRev: 10, digits: 1, unit: 'mm' },
        { type: 'knob', label: '探针 y', get: () => this.py, set: (v) => this.moveProbe(this.px, v), step: 0.1, bigStep: 2, perRev: 10, digits: 1, unit: 'mm' },
      ],
    }));
    const sup = (this.supBox = meterBox(16, 9, 12, '直流稳压电源')); sup.group.position.set(-44, 0, -18);
    app.addComponent(new Component({
      key: 'supply', name: '直流稳压电源', zone: 'none', fixed: true, object: sup.group, labelY: 14,
      desc: '0–15 V 连续可调，接在两个电极上（内电极 / 左电极接正极）。',
      controls: () => [
        { type: 'toggle', label: '电源开关', get: () => this.on, set: (v) => { this.on = v; app.changed(); } },
        { type: 'knob', label: '输出电压', get: () => this.V0, set: (v) => { this.V0 = clamp(v, 0, 15); app.changed(); }, min: 0, max: 15, step: 0.01, bigStep: 0.5, perRev: 2, digits: 2, unit: 'V' },
      ],
    }));
    const vm = (this.vmBox = meterBox(14, 8, 10, '数字电压表')); vm.group.position.set(44, 0, -18);
    app.addComponent(new Component({
      key: 'meter', name: '数字电压表', zone: 'none', fixed: true, object: vm.group, labelY: 13,
      desc: '三位半数字电压表，20 V 挡，分辨率 0.01 V。负端接电源负极（外电极 / 右电极），正端接探针。',
      controls: () => [{ type: 'readout', label: '示数', get: () => (isFinite(this.reading) ? `${this.reading.toFixed(2)} V` : '— 探针不在纸上') }],
    }));
    this.pv = app.addView({ id: 'paper', title: '导电纸（俯视，坐标纸 mm）', w: 330, h: 270, res: 1.6, onTap: (X, Y) => this.tap(X, Y) });
  }
  /** 观察窗坐标 ↔ 纸面坐标（mm） */
  frame() {
    const v = this.pv, [x0, x1, y0, y1] = SETS[this.set].box, pad = 10, s = Math.min((v.W - 2 * pad) / (x1 - x0), (v.H - 2 * pad - 18) / (y1 - y0));
    return { s, cx: v.W / 2, cy: (v.H - 18) / 2 + 2, x0, x1, y0, y1 };
  }
  tap(X, Y) {
    const f = this.frame(), x = (X - f.cx) / f.s, y = -(Y - f.cy) / f.s;
    if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1) return;
    this.moveProbe(x, y); this.app.renderInspector();
  }
  drawElectrodes(g, T, s) {
    g.fillStyle = '#8a9199'; g.strokeStyle = '#3a3f46'; g.lineWidth = 1;
    if (this.set === 'coax') {
      const [cx, cy] = T(0, 0), [ix, iy] = T(this.ex, this.ey);
      g.beginPath(); g.arc(cx, cy, this.r2 * s, 0, 7); g.arc(cx, cy, (this.r2 + 5) * s, 0, 7, true); g.fill();
      g.beginPath(); g.arc(ix, iy, this.r1 * s, 0, 7); g.fill();
    } else if (this.set === 'pair') for (const x of [-40, 40]) { const [cx, cy] = T(x, 0); g.beginPath(); g.arc(cx, cy, 5 * s, 0, 7); g.fill(); }
    else for (const x of [-37, 33]) { const [a, b] = T(x, 40); g.fillRect(a, b, 4 * s, 80 * s); }
  }
  paintBoard() {
    const cv = this.tex.image, g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const [x0, x1, y0, y1] = SETS[this.set].box, s = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.92;
    const T = (x, y) => [W / 2 + x * s, H / 2 - y * s];
    g.fillStyle = '#2b2f33'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3d4247'; const [a, b] = T(x0, y1); g.fillRect(a, b, (x1 - x0) * s, (y1 - y0) * s);
    this.drawElectrodes(g, T, s);
    this.tex.needsUpdate = true;
    this.paperScale = { s: (36 / W) * s, W, H };
  }
  update() {
    const ps = this.paperScale;
    this.probe.position.set(this.px * ps.s, 1.62, -this.py * ps.s);
    const sv = this.on ? this.V0.toFixed(2) : '----', mv = isFinite(this.reading) ? this.reading.toFixed(2) : '-.--';
    if (sv !== this._sv) { this._sv = sv; this.supBox.setText(sv, 'V', this.on ? '输出' : '关'); }
    if (mv !== this._mv) { this._mv = mv; this.vmBox.setText(mv, 'V', '20 V 挡'); }
    this.drawPaper();
  }
  drawPaper() {
    const v = this.pv, g = v.ctx, f = this.frame(), s = f.s;
    const T = (x, y) => [f.cx + x * s, f.cy - y * s];
    g.fillStyle = '#20262b'; g.fillRect(0, 0, v.W, v.H);
    // 坐标纸
    const [ax, ay] = T(f.x0, f.y1);
    g.fillStyle = '#f4f6f1'; g.fillRect(ax, ay, (f.x1 - f.x0) * s, (f.y1 - f.y0) * s);
    for (let x = Math.ceil(f.x0 / 5) * 5; x <= f.x1; x += 5) { const [px] = T(x, 0); g.fillStyle = x % 10 ? '#dbe8de' : '#b9d0c0'; g.fillRect(px - 0.4, ay, 0.8, (f.y1 - f.y0) * s); }
    for (let y = Math.ceil(f.y0 / 5) * 5; y <= f.y1; y += 5) { const [, py] = T(0, y); g.fillStyle = y % 10 ? '#dbe8de' : '#b9d0c0'; g.fillRect(ax, py - 0.4, (f.x1 - f.x0) * s, 0.8); }
    const [ox, oy] = T(0, 0); g.fillStyle = '#85919a'; g.fillRect(ox - 0.5, ay, 1, (f.y1 - f.y0) * s); g.fillRect(ax, oy - 0.5, (f.x1 - f.x0) * s, 1);
    this.drawElectrodes(g, T, s);
    // 已记录的等势点
    const ts = TARGETS[this.set];
    for (const r of this.app.table('eq').rows) {
      if (r.set !== this.set || !isFinite(r.x)) continue;
      const [px, py] = T(r.x, r.y), k = ts.indexOf(r.U);
      g.fillStyle = COLORS[(k < 0 ? 0 : k) % COLORS.length]; g.beginPath(); g.arc(px, py, 2.6, 0, 7); g.fill();
    }
    // 探针
    const [qx, qy] = T(this.px, this.py);
    g.strokeStyle = '#c41e3a'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(qx - 7, qy); g.lineTo(qx + 7, qy); g.moveTo(qx, qy - 7); g.lineTo(qx, qy + 7); g.stroke();
    g.beginPath(); g.arc(qx, qy, 3.5, 0, 7); g.stroke();
    // 电压表 LCD
    const u = this.reading, lw = 92, lh = 24, lx = v.W - lw - 6, ly = v.H - lh - 4;
    g.fillStyle = '#0c140f'; g.fillRect(lx, ly, lw, lh);
    g.fillStyle = '#8fe3a5'; g.font = '600 15px "IBM Plex Mono"'; g.textAlign = 'right';
    g.fillText(isFinite(u) ? `${u.toFixed(2)} V` : '-.-- V', lx + lw - 6, ly + 17);
    g.textAlign = 'left'; g.fillStyle = '#c9ced3'; g.font = '12px "IBM Plex Mono"';
    g.fillText(`探针 (${this.px.toFixed(1)}, ${this.py.toFixed(1)}) mm`, 6, v.H - 9);
    v.foot(!this.on ? '电源未打开' : `正在找 ${this.target} V 的等势点：移动探针（点击纸面或拧旋钮），使电压表示数等于 ${this.target.toFixed(2)} V 后记录`);
  }
  globalControls() {
    const a = this.app;
    return [
      { type: 'select', label: '正在找的等势线', get: () => this.target, set: (v) => { this.target = +v; a.changed(); }, options: TARGETS[this.set].map((u) => ({ value: u, label: `${u} V` })) },
      { type: 'readout', label: '电压表示数', get: () => (isFinite(this.reading) ? `${this.reading.toFixed(2)} V` : '—') },
    ];
  }

  // ======================= 数据表 =======================
  tables() {
    return [{
      id: 'eq', title: '等势点坐标', maxRows: 120,
      columns: [
        { key: 'name', label: '电极', type: 'text', readonly: true },
        { key: 'U', label: '等势线 U/V', digits: 0, readonly: true },
        { key: 'x', label: 'x/mm', digits: 1, readTol: 0.06 },
        { key: 'y', label: 'y/mm', digits: 1, readTol: 0.06 },
        { key: 'Um', label: '电压表/V', digits: 2, readTol: 0.006 },
        { key: 'r', label: 'r/mm（同轴）', digits: 1, calc: (r) => (r.set === 'coax' ? Math.hypot(r.x, r.y) : NaN) },
      ],
      buttons: [{ label: '记录这个等势点', onClick: (t) => this.rec(t) }],
      note: '每条等势线至少取 6 个点，沿着电极一周均匀分布（同轴电极每隔约 45° 取一点）。',
    }];
  }
  rec(t) {
    const a = this.app, u = this.reading;
    if (!this.on || this.V0 < 1) return a.toast('电源没有打开或电压太低', 'warn');
    if (!isFinite(u)) return a.toast('探针不在导电纸上', 'warn');
    if (Math.abs(u - this.target) > 0.05) a.toast(`电压表示数 ${u.toFixed(2)} V，与要找的 ${this.target} V 差得较多，这个点不在等势线上`, 'warn');
    t.addRow({ name: SETS[this.set].name.replace(/（.*/, ''), set: this.set, U: this.target, x: this.px, y: this.py, Um: u });
  }

  // ======================= 自动操作 =======================
  /** 沿 (x0,y0)→(x1,y1) 的线段二分，找到电位等于 U 的点（电位沿线段单调） */
  findOnSegment(U, x0, y0, x1, y1) {
    const f = (t) => this.Utrue(x0 + t * (x1 - x0), y0 + t * (y1 - y0)) - U;
    let lo = 0, hi = 1, flo = f(lo), fhi = f(hi);
    if (!(flo * fhi < 0)) return null;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2, fm = f(m); if (fm * flo > 0) { lo = m; flo = fm; } else hi = m; }
    const t = (lo + hi) / 2;
    return [x0 + t * (x1 - x0), y0 + t * (y1 - y0)];
  }
  async goRecord(p) {
    const a = this.app;
    await a.tween(() => this.px, (v) => this.moveProbe(v, this.py), Math.round(p[0] * 10) / 10, 300);
    await a.tween(() => this.py, (v) => this.moveProbe(this.px, v), Math.round(p[1] * 10) / 10, 300);
    // 最后在 0.1 mm 格点上微调到示数最接近目标值
    let best = [this.px, this.py, Math.abs(this.Utrue() - this.target)];
    for (const dx of [-0.1, 0, 0.1]) for (const dy of [-0.1, 0, 0.1]) { const x = Math.round((p[0] + dx) * 10) / 10, y = Math.round((p[1] + dy) * 10) / 10, e = Math.abs(this.Utrue(x, y) - this.target); if (e < best[2]) best = [x, y, e]; }
    this.moveProbe(best[0], best[1]);
    await a.record('eq', 0);
  }
  async powerUp() {
    const a = this.app;
    a.select(a.comp('supply'));
    this.on = true; a.renderInspector();
    await a.tween(() => this.V0, (v) => (this.V0 = v), 10, 700); this.V0 = 10; a.changed();
  }
  steps() {
    const app = this.app, rows = () => app.table('eq').rows;
    const lines = (set, n) => TARGETS[set].map((U) => rows().filter((r) => r.set === set && r.U === U)).filter((rs) => rs.length >= n).length;
    return [
      {
        title: '接通电源，把电压调到 10.00 V',
        html: '<p>选同轴电极，打开电源，把输出电压调到 10.00 V。可以把探针放到内电极上，用电压表核对一下电极间的电压。</p>',
        check: () => this.on && Math.abs(this.V0 - 10) < 0.02 && this.set === 'coax',
        status: () => `电极：${SETS[this.set].name}；电源 ${this.on ? '开' : '关'}，${this.V0.toFixed(2)} V`,
        diagnose: () => {
          const out = [];
          if (this.set !== 'coax') out.push({ msg: '这一步用同轴电极。', fix: { label: '换成同轴电极', run: async () => this.setSet('coax') } });
          if (!this.on) out.push({ msg: '电源开关没有打开，电极间没有电压。', fix: { label: '打开电源', run: async () => { this.on = true; app.changed(); } } });
          else if (Math.abs(this.V0 - 10) >= 0.02) out.push({ msg: `电源输出是 ${this.V0.toFixed(2)} V，要调到 10.00 V（各条等势线的电位按 10 V 设计）。`, fix: { label: '调到 10.00 V', run: () => app.tween(() => this.V0, (v) => (this.V0 = v), 10, 600).then(() => { this.V0 = 10; }) } });
          return out;
        },
        auto: async () => { await app.view('导电纸'); app.select(app.comp('board')); this.setSet('coax'); await this.powerUp(); },
      },
      {
        title: '描绘同轴电极的等势线',
        html: '<p>分别找 2 V、4 V、6 V、8 V 四条等势线，每条至少 6 个点，沿圆周均匀分布。在纸面上点击可以把探针移过去，再用 x、y 旋钮细调，直到电压表示数等于要找的电位。</p>',
        hint: '先沿某条半径移动探针，找到示数合适的位置；再转过 45° 换一条半径。离内电极越近，电位变化越快，越要细调。',
        status: () => `已完成 ${lines('coax', 6)} / 4 条（每条 ≥ 6 点）`,
        check: () => lines('coax', 6) >= 4,
        diagnose: () => {
          const out = [], u = this.reading;
          if (!this.on || this.V0 < 9.9) out.push({ msg: '电源没开或电压不是 10 V，等势线的电位对不上。', fix: { label: '打开并调到 10 V', run: () => this.powerUp() } });
          if (this.set !== 'coax') out.push({ msg: '现在的电极不是同轴电极。', fix: { label: '换成同轴电极', run: async () => this.setSet('coax') } });
          if (isFinite(u) && this.on && Math.abs(u - this.target) > 0.05) {
            const r = Math.hypot(this.px, this.py), rr = coaxR(this.target, this.r1, this.r2, this.V0 || 10);
            out.push({ msg: `探针处是 ${u.toFixed(2)} V，要找 ${this.target} V：应该${u > this.target ? '往外（远离内电极）' : '往里（靠近内电极）'}移。这条等势线的半径大约 ${rr.toFixed(0)} mm，探针现在离中心 ${r.toFixed(1)} mm。`, fix: { label: '帮我把探针移到等势线上', run: async () => { const a0 = Math.atan2(this.py, this.px), p = this.findOnSegment(this.target, (this.r1 + 0.3) * Math.cos(a0), (this.r1 + 0.3) * Math.sin(a0), (this.r2 - 0.3) * Math.cos(a0), (this.r2 - 0.3) * Math.sin(a0)); if (p) { await app.tween(() => this.px, (v) => this.moveProbe(v, this.py), p[0], 400); await app.tween(() => this.py, (v) => this.moveProbe(this.px, v), p[1], 400); this.moveProbe(p[0], p[1]); } } } });
          }
          for (const U of TARGETS.coax) { const n = rows().filter((r) => r.set === 'coax' && r.U === U).length; if (n && n < 6) out.push({ msg: `${U} V 等势线只取了 ${n} 个点，至少要 6 个。` }); }
          return out;
        },
        auto: async () => {
          app.showTable(0); app.select(app.comp('board'));
          for (const U of TARGETS.coax) {
            this.target = U; app.renderInspector();
            const have = rows().filter((r) => r.set === 'coax' && r.U === U).length;
            for (let k = have; k < 8; k++) {
              const ang = (k * Math.PI) / 4 + 0.15, c = Math.cos(ang), s = Math.sin(ang);
              const p = this.findOnSegment(U, (this.r1 + 0.3) * c, (this.r1 + 0.3) * s, (this.r2 - 0.3) * c, (this.r2 - 0.3) * s);
              if (p) await this.goRecord(p);
            }
          }
        },
      },
      {
        title: '描绘两平行长直导线的等势线（选做）', optional: true,
        html: '<p>换成两个圆电极（模拟两根等量异号的长直线电荷），描绘 3 V、5 V、7 V 等势线，每条 5 个点以上。5 V 等势线应该是两电极连线的中垂线。</p>',
        check: () => lines('pair', 5) >= 3,
        auto: async () => {
          app.showTable(0); app.select(app.comp('board')); this.setSet('pair'); await this.powerUp();
          for (const U of [3, 5, 7]) {
            this.target = U; app.renderInspector();
            for (const y of [-40, -20, 0, 20, 40]) { const p = this.findOnSegment(U, -79, y, 79, y); if (p) await this.goRecord(p); }
          }
          this.setSet('coax');
        },
      },
      {
        title: '数据处理',
        html: '<p>求同轴电极每条等势线的平均半径，与理论值 $r=r_2(r_1/r_2)^{U/U_0}$ 比较；作 $\\ln r$–$U$ 图，求电场强度随 $r$ 的变化。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, rows = a.table('eq').rows.filter((r) => r.set === 'coax' && isFinite(r.x) && isFinite(r.y));
    const groups = TARGETS.coax.map((U) => ({ U, rs: rows.filter((r) => r.U === U) })).filter((g) => g.rs.length >= 3);
    if (groups.length < 2) return { html: '<p>请至少描绘同轴电极的两条等势线（每条 ≥ 3 点）。</p>', ok: false };
    const U0 = 10;
    for (const g of groups) { const r = g.rs.map((p) => Math.hypot(p.x, p.y)); g.r = mean(r); g.sr = r.length > 1 ? stdev(r) : 0; g.th = coaxR(g.U, R1, R2, U0); }
    const f = linFit(groups.map((g) => g.U), groups.map((g) => Math.log(g.r)));
    const ratio = Math.exp(-f.k * U0), uRatio = ratio * U0 * f.uk;
    let html = `<h3>1. 各等势线的半径</h3><p>电极标称半径 $r_1$ = ${R1} mm，$r_2$ = ${R2} mm，$U_0$ = ${U0} V。</p>
      <table><tr><th>U/V</th><th>点数</th><th>平均半径 r̄/mm</th><th>标准差/mm</th><th>理论 r/mm</th><th>相对偏差</th></tr>
      ${groups.map((g) => `<tr><td>${g.U}</td><td>${g.rs.length}</td><td>${g.r.toFixed(2)}</td><td>${g.sr.toFixed(2)}</td><td>${g.th.toFixed(2)}</td><td>${pct((g.r - g.th) / g.th, 2)}</td></tr>`).join('')}</table>
      <p>同一条等势线上各点的半径有 ${(mean(groups.map((g) => g.sr))).toFixed(2)} mm 左右的分散：导电纸各处的电导率不完全均匀，电极也不是理想的同心圆，所以等势线不是正圆。</p>
      <h3>2. ln r–U 图线</h3><p>由 $U=U_0\\dfrac{\\ln(r_2/r)}{\\ln(r_2/r_1)}$ 得 $\\ln r=\\ln r_2-\\dfrac{\\ln(r_2/r_1)}{U_0}U$，是一条直线。拟合得斜率 ${f.k.toFixed(5)} V⁻¹，截距 ${f.b.toFixed(4)}，相关系数 ${f.r.toFixed(5)}。</p>
      <div class="result-box">$r_2/r_1=e^{-kU_0}=${fmtU(ratio, uRatio)}$（标称 ${(R2 / R1).toFixed(3)}），截距给出 $r_2=${Math.exp(f.b).toFixed(1)}$ mm</div>
      <h3>3. 电场强度</h3><p>相邻两条等势线之间的平均场强 $E\\approx\\Delta U/\\Delta r$，与理论 $E=\\dfrac{U_0}{r\\ln(r_2/r_1)}$ 比较：</p>
      <table><tr><th>区间</th><th>r 中点/mm</th><th>ΔU/Δr /(V/mm)</th><th>理论 E/(V/mm)</th></tr>
      ${groups.slice(1).map((g, i) => { const p = groups[i], rm = (g.r + p.r) / 2, E = Math.abs(g.U - p.U) / Math.abs(p.r - g.r); return `<tr><td>${p.U}–${g.U} V</td><td>${rm.toFixed(1)}</td><td>${E.toFixed(4)}</td><td>${(U0 / (rm * Math.log(R2 / R1))).toFixed(4)}</td></tr>`; }).join('')}</table>
      <p>场强与 $r$ 成反比：越靠近内电极，等势线越密。</p>`;
    html += `<div class="result-box warn">本套电极实际半径 r₁ = ${this.r1.toFixed(2)} mm、r₂ = ${this.r2.toFixed(2)} mm，r₂/r₁ 的参考值 ${(this.r2 / this.r1).toFixed(3)}，测量值相对误差 ${pct(relErr(ratio, this.r2 / this.r1), 2)}。</div>`;
    const g4 = groups.find((g) => g.U === 4) || groups[0];
    const answers = [{ label: `$\\bar r$（${g4.U} V 等势线）`, unit: 'mm', value: g4.r, digits: 2, tolRel: 0.004 }, { label: '$r_2/r_1$', value: ratio, digits: 3, tolRel: 0.01 }];
    const pts = TARGETS.coax.map((U, k) => ({ type: 'scatter', label: `${U} V`, data: rows.filter((r) => r.U === U).map((r) => [r.x, r.y]), color: COLORS[k], keepColor: true })).filter((s) => s.data.length);
    const circ = groups.map((g) => ({ type: 'line', data: Array.from({ length: 73 }, (_, i) => [g.th * Math.cos((i * Math.PI) / 36), g.th * Math.sin((i * Math.PI) / 36)]), color: '#85919a', keepColor: true, dash: [4, 3] }));
    return {
      html, ok: true, answers,
      plots: [
        { title: '等势点（虚线为理论等势圆）', xLabel: 'x / mm', yLabel: 'y / mm', series: [...circ, ...pts], xRange: [-62, 62], yRange: [-62, 62] },
        { title: 'ln r – U', xLabel: 'U / V', yLabel: 'ln(r/mm)', series: [{ type: 'scatter', data: groups.map((g) => [g.U, Math.log(g.r)]), label: '实验' }, { type: 'line', data: [[0, f.b], [10, f.k * 10 + f.b]], label: '拟合' }] },
      ],
    };
  }

  principle() {
    return `<h3>1. 为什么可以用电流场模拟静电场</h3>${efieldFig()}<p>直接测静电场很困难：探针一放进去就会改变原来的场。导电纸（或水槽）中的稳恒电流场里，电位 $U$ 满足</p>$$\\nabla\\cdot(\\sigma\\nabla U)=0\\ \\xrightarrow{\\sigma\\ \\text{均匀}}\\ \\nabla^2U=0$$<p>与无电荷空间中静电场的拉普拉斯方程相同。只要电极形状相同、电极上的电位相同（边界条件相同），两种场的电位分布就完全一样。电流场中电压表从探针取走的电流极小，不会明显改变场。</p>
<h3>2. 同轴电极的理论分布</h3><p>内电极半径 $r_1$、电位 $U_0$，外电极半径 $r_2$、电位 0，两极间的场由高斯定理得 $E=\\dfrac{\\lambda}{2\\pi\\varepsilon r}$，积分得</p>$$U(r)=U_0\\frac{\\ln(r_2/r)}{\\ln(r_2/r_1)},\\qquad E(r)=\\frac{U_0}{r\\ln(r_2/r_1)}$$<p>等势线是同心圆，半径 $r=r_2(r_1/r_2)^{U/U_0}$。</p>
<h3>3. 等势线与电场线</h3><p>电场线与等势线处处正交，从高电位指向低电位；等势线越密的地方场强越大。描出等势线后，可以画出与之正交的电场线。</p>
<h3>4. 本仿真的计算模型</h3><p>导电纸上的电位由有限差分法数值求解 $\\nabla\\cdot(\\sigma\\nabla U)=0$（超松弛迭代）：电极边缘不落在网格点上时按实际位置用 Shortley–Weller 非等距差分，纸边绝缘（法向电流为零）。导电纸的电导率有约 ±10% 的缓变不均匀，内电极没有压在正中心（偏约 0.3 mm），电极半径与标称值也有约 0.5% 的差别。对理想均匀导电纸，数值解与解析解的差别在 0.02% 以内。</p>`;
  }
}
