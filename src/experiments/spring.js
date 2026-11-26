// 实验：弹簧振子的研究（静态法与动态法测劲度系数、弹簧的有效质量）
// 竖直悬挂的螺旋弹簧，下端挂砝码托（50 g）和若干 50 g 槽码。弹簧本身质量 m_s 个体随机（12–20 g），
// 周期按分布质量弹簧的精确解计算（physics/spring.js），所以 m₀ 只是近似等于 m_s/3。
// 静态法：指针在带反射镜的米尺上读平衡位置；动态法：光电门放在平衡位置，计时器测 n 个周期的总时间（分辨 1 ms）。
// 空气阻尼使振幅缓慢衰减（γ ≈ 0.02 s⁻¹），对周期的影响小于 10⁻⁶。
import * as THREE from 'three';
import { meta, thumb } from './spring.meta.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox, labTable } from '../core/Models.js';
import { rand, gauss, clamp, relErr, pct, linFit } from '../core/Stats.js';
import { springOmega } from '../physics/spring.js';

const G = 9.801; // 本地重力加速度（m/s²）
const MH = 50, MW = 50; // 砝码托、每个槽码的标称质量（g）
const TOP = 62, L0 = 16; // 弹簧上端高度、原长（cm）
const GAMMA = 0.02;
const NS = [10, 20, 30];

export class SpringExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.k = rand(12, 18); this.ms = rand(12, 20) / 1000;
    this.mh = (MH + gauss(0.02)) / 1000; this.mw = Array.from({ length: 4 }, () => (MW + gauss(0.02)) / 1000);
    this.r0 = rand(18, 22); // 只挂弹簧时指针在米尺上的读数（cm），读数向下增大
    this.nW = 0; this.A = 0; this.tRel = 0; this.clock = 0; this.timeScale = 1;
    this.n = 20; this.timer = null;
  }
  /** 振子质量（kg，真实值）与标称值（g） */
  M() { return this.mh + this.mw.slice(0, this.nW).reduce((s, v) => s + v, 0); }
  mNom() { return MH + MW * this.nW; }
  omega() { return springOmega(this.k, this.ms, this.M()); }
  Td() { const w = this.omega(); return (2 * Math.PI) / Math.sqrt(w * w - GAMMA * GAMMA); }
  /** 静伸长（cm）：弹簧自重使各段伸长不同，指针（下端）的伸长相当于挂了 M + m_s/2 */
  ext() { return ((this.M() + this.ms / 2) * G) / this.k * 100; }
  /** 位移（cm，向下为正） */
  x(t = this.clock) { if (!this.A) return 0; const s = t - this.tRel; return this.A * Math.exp(-GAMMA * s) * Math.cos((2 * Math.PI * s) / this.Td()); }
  moving() { return this.A > 0 && this.A * Math.exp(-GAMMA * (this.clock - this.tRel)) > 0.02; }
  reading() { return this.r0 + this.ext() - this.extEmpty(); }
  extEmpty() { return ((this.ms / 2) * G) / this.k * 100; }
  tick(dt) {
    const a = this.app;
    this.clock += dt * (a.running ? a.speed * 4 : this.timeScale);
    this.pose();
    this.showTimer();
  }
  globalControls() { return [{ type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×4', value: 4 }] }]; }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 52, 80], target: [0, 32, 0] }, { name: '米尺', pos: [14, 44, 30], target: [4, 40, 0] }, { name: '计时器', pos: [18, 26, 34], target: [18, 8, -6] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(labTable(120, 70));
    app.stage.setLightTarget(0, 30, 0);
    // 支架
    scene.add(mesh(new THREE.BoxGeometry(22, 1.6, 14), MAT.paint(0x2b3440), -4, 0.8, 0));
    scene.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 66, 12), MAT.chrome(), -12, 33, 0));
    scene.add(mesh(new THREE.BoxGeometry(14, 1.4, 2), MAT.paint(0x3a3f44), -5, TOP + 0.7, 0));
    // 米尺与反射镜
    const ruler = new THREE.Group(); ruler.position.set(4, 0, 0);
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 1024;
    const c = cv.getContext('2d'); c.fillStyle = '#efe9d6'; c.fillRect(0, 0, 64, 1024); c.fillStyle = '#222'; c.font = 'bold 20px Consolas';
    for (let mm = 0; mm <= 500; mm++) { const y = (mm / 500) * 1024, l = mm % 10 === 0 ? 26 : mm % 5 === 0 ? 18 : 10; c.fillRect(0, y, l, mm % 10 === 0 ? 2 : 1); if (mm % 50 === 0 && mm) c.fillText(String(mm / 10), 30, y + 7); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    // 米尺 0 刻度在上（y = TOP − 2），向下 50 cm
    ruler.add(mesh(new THREE.PlaneGeometry(3, 50), new THREE.MeshBasicMaterial({ map: tex }), 0, TOP - 2 - 25, 0.2));
    ruler.add(mesh(new THREE.BoxGeometry(3.4, 50.4, 0.3), MAT.paint(0x8a8f96), 0, TOP - 2 - 25, 0));
    scene.add(ruler);
    this.rulerTop = TOP - 2;
    // 弹簧（螺旋线，按伸长缩放）
    const pts = []; const turns = 26;
    for (let i = 0; i <= turns * 24; i++) { const t = i / (turns * 24), a = t * turns * Math.PI * 2; pts.push(new THREE.Vector3(1.3 * Math.cos(a), -t, 1.3 * Math.sin(a))); }
    this.spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 24, 0.11, 6), MAT.chrome());
    this.spring.position.set(0, TOP, 0); scene.add(this.spring);
    // 振子：指针、砝码托、槽码
    this.bob = new THREE.Group(); scene.add(this.bob);
    this.bob.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 3, 6), MAT.metal(), 0, -1.5, 0));
    this.bob.add(mesh(new THREE.BoxGeometry(4.2, 0.12, 0.3), MAT.paint(0xb91c1c), 2.1, -0.6, 0.3));
    this.bob.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 8), MAT.chrome(), 0, -4, 0));
    this.bob.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.6, 24), MAT.brass(), 0, -7, 0));
    this.discs = [];
    for (let i = 0; i < 4; i++) { const d = mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.8, 24), MAT.paint(0x56606c), 0, -6.3 + i * 0.85, 0); d.visible = false; this.bob.add(d); this.discs.push(d); }
    // 光电门
    this.gate = new THREE.Group(); this.gate.position.set(0, 0, 0); scene.add(this.gate);
    this.gate.add(mesh(new THREE.BoxGeometry(1.4, 4, 1.2), MAT.paint(0x1f2937), -4.2, 0, 0));
    this.gate.add(mesh(new THREE.BoxGeometry(1.4, 4, 1.2), MAT.paint(0x1f2937), 4.2, 0, 0));
    this.gate.add(mesh(new THREE.BoxGeometry(9.8, 1, 1.2), MAT.paint(0x1f2937), 0, -2.5, -0.6));
    this.ray = mesh(new THREE.CylinderGeometry(0.06, 0.06, 7, 6), MAT.emissive(0xff3030, 1.2), 0, 0, 0); this.ray.rotation.z = Math.PI / 2; this.gate.add(this.ray);
    // 计时器
    const tm = (this.tBox = meterBox(18, 9, 10, '光电计时器')); tm.group.position.set(18, 0, -6); scene.add(tm.group);
    app.addComponent(new Component({
      key: 'spring', name: '弹簧与砝码', zone: 'none', fixed: true, required: true, object: this.bob, labelY: 4,
      icon: '<svg viewBox="0 0 64 40"><path d="M32 2v4l-6 3 12 3-12 3 12 3-12 3 12 3-6 3v3" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="24" y="31" width="16" height="7" fill="currentColor"/></svg>',
      desc: `螺旋弹簧（天平称得质量 m<sub>s</sub> = ${(this.ms * 1000).toFixed(2)} g）下端挂砝码托（${MH} g），托上可加 50 g 槽码，最多 4 个。弹簧下端的红色指针对着带反射镜的米尺（读数时眼睛、指针和它的像三点一线，估读到 0.1 mm）。本地 g = ${G} m/s²。`,
      controls: () => [
        { type: 'segment', label: '槽码个数', options: [0, 1, 2, 3, 4].map((v) => ({ value: v, label: String(v) })), get: () => this.nW, set: (v) => { this.nW = v; this.A = 0; this.timer = null; app.changed(); } },
        { type: 'button', label: '向下拉 2 cm 后释放', onClick: () => { this.release(2); app.changed(); } },
        { type: 'button', label: '用手让振子停下', onClick: () => { this.A = 0; app.changed(); } },
        { type: 'readout', label: '振子质量（标称）', get: () => `${this.mNom()} g` },
      ],
    }));
    app.addComponent(new Component({
      key: 'timer', name: '光电计时器', zone: 'none', fixed: true, object: tm.group, labelY: 12,
      desc: '光电门放在振子的平衡位置，挡光杆每经过一次光电门计一次数。“周期”模式下，按“开始”后从第一次挡光起计时，测满设定的周期数（每周期挡光两次）后停止，分辨 1 ms。',
      controls: () => [
        { type: 'segment', label: '周期数 n', options: NS.map((v) => ({ value: v, label: String(v) })), get: () => this.n, set: (v) => { this.n = v; this.timer = null; app.changed(); } },
        { type: 'button', label: '开始计时', onClick: () => { this.arm(); app.changed(); } },
        { type: 'readout', label: '计时', get: () => this.timerText() },
      ],
    }));
    this.view = app.addView({ id: 'ruler', title: '米尺读数（放大）', w: 220, h: 200, res: 1.6 });
  }
  release(A) { this.A = A; this.tRel = this.clock; this.timer = null; }
  arm() { this.timer = { t0: this.clock, n: this.n, m: this.nW, Td: this.Td() }; }
  timerState() {
    const tm = this.timer; if (!tm) return { s: 'idle' };
    if (!this.A || tm.m !== this.nW) return { s: 'wait' };
    const w = (2 * Math.PI) / tm.Td, s0 = tm.t0 - this.tRel;
    const j = Math.max(0, Math.ceil((w * s0 - Math.PI / 2) / Math.PI - 1e-12)), tf = this.tRel + (Math.PI / 2 + j * Math.PI) / w, te = tf + tm.n * tm.Td;
    if (this.clock < tf) return { s: 'wait' };
    if (this.clock < te) return { s: 'run', v: this.clock - tf };
    return { s: 'done', v: Math.round(tm.n * tm.Td * 1000) / 1000 };
  }
  timerText() { const s = this.timerState(); return s.s === 'idle' ? '未开始' : s.s === 'wait' ? '等待挡光' : s.s === 'run' ? `${s.v.toFixed(3)} s（计时中）` : `${s.v.toFixed(3)} s（${this.timer.n} 个周期）`; }
  showTimer() {
    const s = this.timerState(), txt = s.s === 'idle' || s.s === 'wait' ? '0.000' : s.v.toFixed(3);
    const sub = s.s === 'idle' ? `周期 ×${this.n}` : s.s === 'wait' ? '等待挡光' : s.s === 'run' ? '计时中' : `${this.timer.n} 个周期`;
    if (txt + sub !== this._tt) { this._tt = txt + sub; this.tBox.setText(txt, 's', sub); }
  }
  pose() {
    const L = L0 + this.ext() + this.x();
    this.spring.scale.y = L; this.bob.position.set(0, TOP - L, 0);
    this.gate.position.set(0, TOP - L0 - this.ext() - 4, 0);
    this.discs.forEach((d, i) => (d.visible = i < this.nW));
    this.drawRuler();
  }
  update() { this.pose(); this.showTimer(); }
  drawRuler() {
    const v = this.view; if (!v) return;
    const pr = this.reading() + this.x();
    const key = pr.toFixed(3); if (key === this._rk) return; this._rk = key;
    const g = v.ctx, W = v.W, H = v.H, ppc = H / 4; // 每厘米像素
    g.fillStyle = '#d9dde0'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#efe9d6'; g.fillRect(W * 0.3, 0, W * 0.4, H);
    g.fillStyle = '#9aa3ab'; g.fillRect(W * 0.7, 0, W * 0.08, H);
    g.fillStyle = '#222'; g.font = `bold ${H * 0.07}px Consolas, monospace`; g.textAlign = 'left';
    for (let mm = Math.floor((pr - 2.2) * 10); mm <= Math.ceil((pr + 2.2) * 10); mm++) {
      const y = H / 2 + (mm / 10 - pr) * ppc, l = mm % 10 === 0 ? 0.16 : mm % 5 === 0 ? 0.11 : 0.06;
      g.fillRect(W * 0.3, y - (mm % 10 === 0 ? 1 : 0.5), W * l, mm % 10 === 0 ? 2 : 1);
      if (mm % 10 === 0) g.fillText(String(mm / 10), W * 0.48, y + H * 0.025);
    }
    g.fillStyle = '#b91c1c'; g.fillRect(W * 0.05, H / 2 - 1, W * 0.4, 2);
    g.fillStyle = 'rgba(185,28,28,.35)'; g.fillRect(W * 0.7, H / 2 - 1, W * 0.08, 2);
    v.foot(this.moving() ? '振子在振动，指针晃动，读不准' : '红线：指针（右侧镜中是它的像）');
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'static', title: '静态法：指针读数', maxRows: 5,
        columns: [{ key: 'm', label: '振子质量 m/g', digits: 0, auto: true }, { key: 'x', label: '指针读数 x/cm', digits: 2, readTol: 0.03 }],
        buttons: [{ label: '记录指针读数', onClick: (t) => this.recS(t) }],
        note: '依次加 0–4 个槽码，振子静止后读指针在米尺上的位置。',
      },
      {
        id: 'dyn', title: '动态法：周期', maxRows: 8,
        columns: [{ key: 'm', label: '振子质量 m/g', digits: 0, auto: true }, { key: 'n', label: '周期数 n', digits: 0, auto: true }, { key: 't', label: 'n 个周期 t/s', digits: 3, readTol: 0.002 }, { key: 'T', label: 'T/s', digits: 4, calc: (r) => r.t / r.n }, { key: 'T2', label: 'T²/s²', digits: 5, calc: (r) => (r.t / r.n) ** 2 }],
        buttons: [{ label: '记录计时器读数', onClick: (t) => this.recD(t) }],
        note: '每个质量下把振子向下拉约 2 cm 释放，按“开始计时”测 20 个周期的总时间。',
      },
    ];
  }
  recS(t) {
    const a = this.app;
    if (this.moving()) a.toast('振子还在振动，读数在跳动', 'warn');
    if (t.rows.some((r) => r.m === this.mNom())) a.toast('这个质量已经记过了', 'warn');
    t.addRow({ m: this.mNom(), x: Math.round(this.reading() * 100) / 100 });
  }
  recD(t) {
    const a = this.app, s = this.timerState();
    if (s.s !== 'done') a.toast(s.s === 'run' ? '还在计时，等计时器停下' : '计时器没有测完：先让振子振动，再按“开始计时”', 'warn');
    if (t.rows.some((r) => r.m === this.mNom() && r.n === this.timer.n)) a.toast('这个质量已经测过了', 'warn');
    if (!this.timer || !(s.v > 0)) return; // 计时器上还没有任何读数
    t.addRow({ m: this.mNom(), n: this.timer.n, t: s.v });
  }

  // ======================= 自动操作 =======================
  async seg(comp, key, v) { const a = this.app; a.select(a.comp(comp)); this[key] = v; if (key === 'nW') { this.A = 0; this.timer = null; } if (key === 'n') this.timer = null; a.renderInspector(); a.changed(); await a.wait(200); }
  steps() {
    const app = this.app, rows = (id) => app.table(id).completeRows();
    return [
      {
        title: '静态法测劲度系数',
        html: '<p>只挂砝码托时，待振子静止后读指针在米尺上的位置。然后逐个加上 50 g 槽码，每次读一次，共 5 个读数。</p>',
        hint: '读数时视线要使指针与它在镜中的像重合，消除视差。',
        status: () => `已记录 ${rows('static').length} 个读数`,
        check: () => rows('static').length >= 5,
        auto: async () => {
          app.showTable(0); await app.view('米尺');
          for (let k = 0; k <= 4; k++) {
            if (rows('static').some((r) => r.m === MH + MW * k)) continue;
            await this.seg('spring', 'nW', k); await app.wait(300); await app.record('static', 0);
          }
        },
      },
      {
        title: '动态法测周期',
        html: '<p>对每个振子质量（0–4 个槽码），把振子向下拉约 2 cm 后释放，等振动平稳后按计时器的“开始计时”，测 20 个周期的总时间。</p>',
        hint: '光电门要放在平衡位置：那里速度最大，挡光时刻最准。',
        status: () => `已测 ${rows('dyn').length} 个质量`,
        check: () => new Set(rows('dyn').map((r) => r.m)).size >= 5,
        auto: async () => {
          app.showTable(1); await app.view('全景');
          if (this.n !== 20) await this.seg('timer', 'n', 20);
          for (let k = 0; k <= 4; k++) {
            if (rows('dyn').some((r) => r.m === MH + MW * k)) continue;
            await this.seg('spring', 'nW', k);
            app.select(app.comp('spring')); this.release(2); app.changed(); await app.wait(300);
            app.select(app.comp('timer')); this.arm(); app.changed();
            await app.until(() => this.timerState().s === 'done', 60000);
            await app.record('dyn', 0);
          }
          app.select(app.comp('spring')); this.A = 0; app.changed();
        },
      },
      {
        title: '数据处理',
        html: '<p>作 $x$–$m$ 图，由斜率求静态法的劲度系数；作 $T^2$–$m$ 图，由斜率和截距求动态法的劲度系数和弹簧的有效质量 $m_0$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, S = a.table('static').completeRows(), D = a.table('dyn').completeRows();
    if (S.length < 3 && D.length < 3) return { html: '<p>请先测量至少 3 组静态或动态数据。</p>', ok: false };
    let html = ''; const answers = [], plots = []; let ks = null;
    if (S.length >= 3) {
      const f = linFit(S.map((r) => r.m), S.map((r) => r.x)); ks = (G * 1e-3) / (f.k * 1e-2);
      html += `<h3>1. 静态法</h3><p>$x$–$m$ 直线斜率 ${f.k.toFixed(5)} cm/g（r = ${f.r.toFixed(6)}）。由胡克定律 $mg=k\\Delta x$：</p><div class="result-box">$k=\\dfrac{g}{\\text{斜率}}=\\dfrac{${G}\\times10^{-3}}{${(f.k / 100).toExponential(4)}}=${ks.toFixed(3)}$ N/m</div>`;
      answers.push({ label: '静态法劲度系数 $k$', unit: 'N/m', value: ks, digits: 3, tolRel: 0.01 });
      plots.push({ title: '指针读数 x – 质量 m', xLabel: 'm / g', yLabel: 'x / cm', series: [{ type: 'scatter', data: S.map((r) => [r.m, r.x]), label: '实验点' }, { type: 'line', data: [40, 260].map((m) => [m, f.k * m + f.b]), label: '拟合' }] });
    }
    if (D.length >= 3) {
      const xs = D.map((r) => r.m / 1000), ys = D.map((r) => (r.t / r.n) ** 2), f = linFit(xs, ys), kd = (4 * Math.PI * Math.PI) / f.k, m0 = (f.b / f.k) * 1000, ms3 = (this.ms * 1000) / 3;
      html += `<h3>2. 动态法</h3><p>$T^2$–$m$ 直线：斜率 ${f.k.toFixed(5)} s²/kg，截距 ${f.b.toFixed(6)} s²（r = ${f.r.toFixed(6)}）。由 $T^2=\\dfrac{4\\pi^2}{k}(m+m_0)$：</p>
        <div class="result-box">$k=\\dfrac{4\\pi^2}{\\text{斜率}}=${kd.toFixed(3)}$ N/m，$m_0=\\dfrac{\\text{截距}}{\\text{斜率}}=${m0.toFixed(2)}$ g</div>`;
      if (ks) html += `<p>动态法与静态法的劲度系数相对偏差 ${pct(relErr(kd, ks))}。</p>`;
      const fth = linFit(xs, xs.map((m) => ((2 * Math.PI) / springOmega(1, this.ms, m)) ** 2)), m0th = (fth.b / fth.k) * 1000;
      html += `<p>弹簧质量 $m_s$ = ${(this.ms * 1000).toFixed(2)} g，$m_s/3$ = ${ms3.toFixed(2)} g，实测 $m_0$ 比它${m0 >= ms3 ? '大' : '小'} ${Math.abs(m0 - ms3).toFixed(2)} g。$m_0=m_s/3$ 是假设弹簧上各点速度线性分布得到的近似。把弹簧当作连续弹性体严格求解，基频满足 $\\beta\\tan\\beta=m_s/m$，$\\omega=\\beta\\sqrt{k/m_s}$；$m_s\\ll m$ 时展开得 $m_0\\approx m_s/3$，振子越轻，有效质量比 $m_s/3$ 越大一点。用严格解在同样几个质量下算出周期、同样作 $T^2$–$m$ 直线，得 $m_0$ = ${m0th.toFixed(2)} g，实测值与它的相对偏差 ${pct(relErr(m0, m0th))}。截距是外推得到的，对周期和砝码质量的误差很敏感，所以 $m_0$ 的相对误差比 $k$ 大得多。</p>`;
      answers.push({ label: '动态法劲度系数 $k$', unit: 'N/m', value: kd, digits: 3, tolRel: 0.01 }, { label: '有效质量 $m_0$', unit: 'g', value: m0, digits: 2, tolAbs: 0.3 });
      plots.push({ title: 'T² – m', xLabel: 'm / kg', yLabel: 'T² / s²', series: [{ type: 'scatter', data: xs.map((x, i) => [x, ys[i]]), label: '实验点' }, { type: 'line', data: [-m0 / 1000, 0.27].map((x) => [x, f.k * x + f.b]), label: '拟合（延长到 T² = 0）' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 胡克定律与静态法</h3><p>在弹性限度内，弹簧的伸长与拉力成正比：$F=k\\Delta x$。挂上质量 $m$ 的物体，平衡时 $mg=k\\Delta x$。逐次增加砝码，作 $x$–$m$ 直线，斜率为 $g/k$。</p>
<h3>2. 弹簧振子与动态法</h3><p>把振子从平衡位置拉开后释放，它在弹力作用下作简谐振动。若弹簧质量可以忽略，周期 $T=2\\pi\\sqrt{m/k}$。实际弹簧有质量 $m_s$，振动时它的各部分速度不同：上端不动，下端与振子同速。设速度沿弹簧线性分布，弹簧的动能为 $\\frac12\\cdot\\frac{m_s}{3}v^2$，相当于振子多了 $m_0=m_s/3$ 的质量：</p>$$T=2\\pi\\sqrt{\\frac{m+m_0}{k}},\\qquad T^2=\\frac{4\\pi^2}{k}m+\\frac{4\\pi^2}{k}m_0$$<p>作 $T^2$–$m$ 直线，由斜率求 $k$，由截距与斜率之比求 $m_0$。</p>
<h3>3. 本仿真的计算模型</h3><p>周期按均匀弹簧的连续体精确解计算：$\\beta\\tan\\beta=m_s/m$，$\\omega=\\beta\\sqrt{k/m_s}$。静伸长计入弹簧自重（相当于下端多挂 $m_s/2$，它对每次读数的贡献相同，不影响斜率）。砝码质量有约 ±0.02 g 的误差；空气阻尼使振幅缓慢衰减。</p>`;
  }
}
