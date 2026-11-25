// 实验：密立根油滴实验测电子电荷（静态平衡法）
// 每颗油滴的半径、所带电荷（整数个电子）随机；运动按 physics/millikan.js 的收尾速度（斯托克斯阻力 + 坎宁汉修正）计算，
// 叠加布朗运动；仪器不水平时电场不竖直，油滴会横向漂移。计时由学生按秒表。
import * as THREE from 'three';
import { meta, thumb } from './millikan.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { mean, rand, relErr, pct, clamp, gauss, fmtU } from '../core/Stats.js';
import { Stopwatch } from '../core/gauges.js';
import { E0, dropV, balanceU, diffusion, chargeStatic, airEta } from '../physics/millikan.js';
import { millikanFig } from './mechFigs2.js';

const D = 5.0e-3, L = 2.0e-3, RHO = 981; // 板间距、计时距离、钟表油密度
const YA = 1.0, YB = -1.0; // 计时线（mm，视场坐标，向上为正）
const NT = 3; // 每颗油滴测下落时间的次数
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class MillikanExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.Tc = Math.round(rand(18, 26) * 10) / 10; this.p = Math.round(rand(100.2, 102.2) * 100) * 10; // Pa
    this.tilt = [rand(1, 3) * (Math.random() < 0.5 ? -1 : 1), rand(1, 3) * (Math.random() < 0.5 ? -1 : 1)]; // 两个调平螺丝造成的倾角（°）
    this.focus = rand(-0.6, 0.6); // 0 为清晰
    this.U = 0; this.mode = 'bal'; this.drops = []; this.sel = -1; this.sprays = 0;
    this.sw = new Stopwatch(); this.auto = null; this.timeScale = 1;
  }
  get tiltDeg() { return Math.hypot(this.tilt[0], this.tilt[1]); }
  get Uplates() { return this.mode === 'bal' ? this.U : this.mode === 'up' ? this.U + 200 : 0; }
  spray() {
    const a = this.app;
    this.sprays++;
    this.drops = Array.from({ length: 7 }, (_, k) => {
      const r = rand(0.45, 1.25) * 1e-6, n = Math.max(1, Math.round(Math.exp(rand(0, 2.6))));
      return { id: `${this.sprays}-${k + 1}`, a: r, q: n * E0, n, x: rand(-1.2, 1.2), y: rand(0.6, 1.5), lost: false };
    });
    this.sel = 0; a.renderInspector(); a.changed();
  }
  env() { return { d: D, rho: RHO, Tc: this.Tc, p: this.p }; }
  vOf(dp, U) { return dropV({ a: dp.a, q: dp.q, U, ...this.env() }); } // m/s，向下为正
  get cur() { return this.drops[this.sel]; }

  tick(dt) {
    const a = this.app, sdt = Math.min(2, dt * (a.running ? a.speed * (this.auto ? 3 : 1) : this.timeScale));
    if (!(sdt > 0)) return;
    this.sw.tick(sdt);
    if (!this.drops.length) { if (this.sw.run) a.changed(); return; }
    const U = this.Uplates, tl = this.tilt.map((t) => (t * Math.PI) / 180);
    const n = Math.max(1, Math.ceil(sdt / 0.05)), h = sdt / n;
    for (const dp of this.drops) {
      if (dp.lost) continue;
      const Dm = diffusion({ a: dp.a, Tc: this.Tc, p: this.p }), sig = Math.sqrt(2 * Dm * h) * 1000; // mm
      const vE = (dropV({ a: dp.a, q: dp.q, U: 0, ...this.env() }) - this.vOf(dp, U)) * 1000; // 电场力引起的速度（mm/s，向上）
      for (let i = 0; i < n; i++) {
        const y0 = dp.y;
        dp.y += -this.vOf(dp, U) * 1000 * h + gauss(sig);
        dp.x += vE * Math.sin(tl[0]) * h + gauss(sig);
        if (dp === this.cur && this.auto) this.mark(y0, dp.y, sdt - (i + 1) * h);
      }
      if (Math.abs(dp.y) > 1.7 || Math.abs(dp.x) > 1.6) { dp.lost = true; if (dp === this.cur && !a.running) a.toast('跟踪的油滴跑出了视野：注意及时切到“平衡”', 'warn'); }
    }
    a.changed();
  }
  /** 自动计时：油滴向下经过 A 线开表，经过 B 线停表（tAgo：过线时刻距本帧末的时间） */
  mark(y0, y1, tAgo) {
    const au = this.auto;
    if (au.phase === 'arm' && y0 > YA && y1 <= YA) { this.sw.reset(); this.sw.run = true; this.sw.t = tAgo + gauss(0.03); au.phase = 'run'; }
    else if (au.phase === 'run' && y0 > YB && y1 <= YB) { this.sw.run = false; this.sw.t = Math.max(0, this.sw.t - tAgo + gauss(0.03)); this.auto = null; this.mode = 'bal'; }
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [50, 70, 110], target: [0, 16, 0] }, { name: '油滴盒', pos: [16, 34, 40], target: [0, 20, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 80));
    app.stage.setLightTarget(0, 15, 0);
    const g = new THREE.Group(), dark = MAT.paint(0x2b3440);
    g.add(mesh(new THREE.BoxGeometry(36, 2, 26), dark, 0, 1, 0));
    for (const [x, z] of [[-15, 10], [15, 10], [0, -11]]) g.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 12), MAT.metal(), x, -0.2, z));
    g.add(mesh(new THREE.CylinderGeometry(6, 6, 9, 32), MAT.paint(0x4b5a53), 0, 7, 0)); // 油滴盒
    g.add(mesh(new THREE.CylinderGeometry(6.4, 6.4, 0.8, 32), MAT.alu(), 0, 11.8, 0)); // 上电极
    g.add(mesh(new THREE.CylinderGeometry(0.8, 0.5, 2.5, 12), MAT.alu(), 0, 13.4, 0)); // 喷雾孔
    const mic = mesh(new THREE.CylinderGeometry(1.4, 1.4, 16, 20), MAT.black(), 0, 7, 14); mic.rotation.x = Math.PI / 2; g.add(mic);
    g.add(mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshStandardMaterial({ color: 0x86efac, emissive: 0x16a34a, emissiveIntensity: 0.5 }), 10, 2.4, 8)); // 水准泡
    app.addComponent(new Component({
      key: 'cell', name: '油滴仪', zone: 'none', fixed: true, required: true, object: g, labelY: 18,
      icon: SVG('<rect x="18" y="8" width="28" height="4" fill="currentColor"/><rect x="18" y="28" width="28" height="4" fill="currentColor"/><circle cx="32" cy="20" r="2" fill="currentColor"/>'),
      desc: `两块水平放置的平行金属板（间距 d = ${(D * 1000).toFixed(2)} mm）构成油滴盒，上板中央有喷雾孔。显微镜（配 CCD 显示）对准两板之间，分划板上相邻刻线间距 0.25 mm。底座有两个调平螺丝和水准泡。`,
      controls: () => [
        { type: 'knob', label: '调平螺丝 1', get: () => this.tilt[0], set: (v) => { this.tilt[0] = clamp(v, -5, 5); app.changed(); }, min: -5, max: 5, step: 0.05, bigStep: 0.5, perRev: 2, fmt: () => `水准泡偏 ${this.tiltDeg.toFixed(1)}°` },
        { type: 'knob', label: '调平螺丝 2', get: () => this.tilt[1], set: (v) => { this.tilt[1] = clamp(v, -5, 5); app.changed(); }, min: -5, max: 5, step: 0.05, bigStep: 0.5, perRev: 2, fmt: () => `水准泡偏 ${this.tiltDeg.toFixed(1)}°` },
        { type: 'knob', label: '显微镜调焦', get: () => this.focus, set: (v) => { this.focus = clamp(v, -1.5, 1.5); app.changed(); }, min: -1.5, max: 1.5, step: 0.01, bigStep: 0.1, perRev: 0.5, fmt: () => (Math.abs(this.focus) < 0.05 ? '清晰' : '模糊') },
        { type: 'button', label: '用喷雾器喷油', onClick: () => this.spray() },
      ],
    }));
    const pw = (this.pwBox = meterBox(18, 10, 12, '油滴仪电源')); pw.group.position.set(-42, 0, -12);
    app.addComponent(new Component({
      key: 'power', name: '油滴仪电源', zone: 'none', fixed: true, object: pw.group, labelY: 15,
      desc: '平衡电压 0–500 V 连续可调（数字显示，1 V）。工作状态开关：“平衡”——两板加平衡电压；“提升”——在平衡电压上再加约 200 V，把油滴提上去；“0 V”——两板短接，油滴在重力下自由下落。',
      controls: () => [
        { type: 'knob', label: '平衡电压', get: () => this.U, set: (v) => { this.U = clamp(Math.round(v), 0, 500); app.changed(); }, min: 0, max: 500, step: 1, bigStep: 10, perRev: 40, digits: 0, unit: 'V' },
        { type: 'segment', label: '工作状态', get: () => this.mode, set: (v) => { this.mode = v; app.changed(); }, options: [{ label: '平衡', value: 'bal' }, { label: '提升', value: 'up' }, { label: '0 V（下落）', value: 'fall' }] },
        { type: 'readout', label: '室温 / 气压', get: () => `${this.Tc.toFixed(1)} °C / ${(this.p / 1000).toFixed(2)} kPa` },
      ],
    }));
    this.mv = app.addView({ id: 'ccd', title: '显微镜视场（CCD 显示）与秒表', w: 280, h: 300, res: 1.6, onTap: (X, Y) => this.tap(X, Y) });
  }
  view() { const v = this.mv, s = (v.H * 0.74) / 3.4; return { s, cx: v.W / 2, cy: v.H * 0.4 }; }
  tap(X, Y) {
    const f = this.view(), x = (X - f.cx) / f.s, y = -(Y - f.cy) / f.s;
    let best = -1, bd = 0.25;
    this.drops.forEach((dp, k) => { if (!dp.lost) { const d = Math.hypot(dp.x - x, dp.y - y); if (d < bd) { bd = d; best = k; } } });
    if (best >= 0) { this.sel = best; this.app.renderInspector(); this.app.changed(); }
  }
  update() {
    const s = this.U.toFixed(0) + (this.mode === 'up' ? '+' : this.mode === 'fall' ? '·0' : '');
    if (s !== this._ps) { this._ps = s; this.pwBox.setText(this.mode === 'fall' ? '0' : String(this.Uplates), 'V', { bal: '平衡', up: '提升', fall: '0 V 下落' }[this.mode]); }
    const v = this.mv, g = v.ctx, W = v.W, H = v.H, f = this.view();
    g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H);
    const T = (x, y) => [f.cx + x * f.s, f.cy - y * f.s];
    // 分划板：0.25 mm 一格
    g.strokeStyle = 'rgba(160,200,170,.55)'; g.lineWidth = 1; g.fillStyle = 'rgba(160,200,170,.8)'; g.font = `${H * 0.03}px "IBM Plex Mono"`; g.textAlign = 'right';
    for (let k = -6; k <= 6; k++) { const [, y] = T(0, k * 0.25), [x0] = T(-0.5, 0), [x1] = T(0.5, 0); g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
    { const [x, y0] = T(0, 1.5), [, y1] = T(0, -1.5); g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); }
    for (const [yy, t] of [[YA, 'A'], [YB, 'B']]) { const [x, y] = T(-0.55, yy); g.fillStyle = '#e8b84a'; g.fillText(t, x, y + 4); const [a0] = T(-0.5, 0), [a1] = T(0.5, 0); g.strokeStyle = 'rgba(232,184,74,.8)'; g.beginPath(); g.moveTo(a0, y); g.lineTo(a1, y); g.stroke(); }
    // 油滴
    const blur = Math.abs(this.focus);
    this.drops.forEach((dp, k) => {
      if (dp.lost) return;
      const [x, y] = T(dp.x, dp.y), r = 1.6 + (dp.a / 1e-6) * 1.4 + blur * 8;
      g.fillStyle = `rgba(235,240,255,${clamp(0.95 - blur * 0.8, 0.12, 0.95)})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      if (k === this.sel) { g.strokeStyle = '#c41e3a'; g.lineWidth = 1.2; g.strokeRect(x - r - 4, y - r - 4, 2 * r + 8, 2 * r + 8); }
    });
    this.sw.draw(g, W * 0.12, H * 0.82, W * 0.76, H * 0.12);
    const c = this.cur;
    let foot;
    if (!this.drops.length) foot = '视场里还没有油滴：先喷油';
    else if (!c || c.lost) foot = '跟踪的油滴已经不在视野里：点击视场中的另一颗，或重新喷油';
    else { const vv = this.vOf(c, this.Uplates) * 1e6; foot = `跟踪油滴 ${c.id}：${Math.abs(vv) < 3 ? '几乎静止' : vv > 0 ? `下降 ${vv.toFixed(0)} μm/s` : `上升 ${(-vv).toFixed(0)} μm/s`}${blur > 0.05 ? '；图像模糊，先调焦' : ''}`; }
    v.foot(foot);
  }
  globalControls() {
    const a = this.app, rer = () => { a.renderInspector(); a.changed(); };
    return [
      { type: 'select', label: '跟踪的油滴（也可在视场中点击）', get: () => (this.drops.length ? this.sel : -1), set: (v) => { if (+v >= 0 && this.drops[+v]) { this.sel = +v; a.changed(); } }, options: this.drops.length ? this.drops.map((dp, k) => ({ value: k, label: `油滴 ${dp.id}${dp.lost ? '（已离开视野）' : ''}` })) : [{ value: -1, label: '（还没有喷油）' }] },
      { type: 'button', label: this.sw.run ? '秒表：停止' : '秒表：开始', onClick: () => { if (this.sw.run) this.sw.stop(gauss(0.04) * this.timeScale); else { this.sw.reset(); this.sw.start(0); } rer(); } },
      { type: 'button', label: '秒表：清零', onClick: () => { this.sw.reset(); a.changed(); } },
      { type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×2', value: 2 }, { label: '×4', value: 4 }] },
    ];
  }

  // ======================= 数据表 =======================
  tables() {
    const cols = [{ key: 'id', label: '油滴', type: 'text', readonly: true }, { key: 'U', label: '平衡电压 U/V', digits: 0, readTol: 0.6 }];
    for (let k = 1; k <= NT; k++) cols.push({ key: 't' + k, label: `t${k}/s`, digits: 2, readTol: 0.011, optional: true });
    cols.push({ key: 'tm', label: 't̄/s', digits: 2, calc: (r) => { const ts = [1, 2, 3].map((k) => r['t' + k]).filter((x) => isFinite(x) && x > 0); return ts.length ? mean(ts) : NaN; } });
    return [{
      id: 'drop', title: '油滴的平衡电压与下落时间', maxRows: 10, columns: cols,
      buttons: [{ label: '记录平衡电压（新油滴）', onClick: (t) => this.recU(t) }, { label: '记录下落时间', onClick: (t) => this.recT(t) }],
      note: `调好平衡后先记平衡电压；然后“提升”到 A 线以上，切到“0 V”让它下落，经过 A 线开表、经过 B 线停表（l = ${(L * 1000).toFixed(2)} mm）。每颗油滴测 ${NT} 次，共测 5 颗。`,
    }];
  }
  recU(t) {
    const a = this.app, c = this.cur;
    if (!c || c.lost) return a.toast('没有正在跟踪的油滴', 'warn');
    if (this.mode !== 'bal') return a.toast('先切到“平衡”状态，调到油滴静止，再记录平衡电压', 'warn');
    const v = Math.abs(this.vOf(c, this.U)) * 1e6;
    if (v > 4) a.toast(`油滴还在以 ${v.toFixed(0)} μm/s 的速度${this.vOf(c, this.U) > 0 ? '下降' : '上升'}，没有平衡`, 'warn');
    if (this.tiltDeg > 0.5) a.toast('仪器没有调水平：电场不竖直，油滴会横向漂移', 'warn');
    if (t.rows.some((r) => r.drop === c.id)) return a.toast('这颗油滴已经记过平衡电压了', 'warn');
    t.addRow({ id: c.id, drop: c.id, U: this.U });
  }
  recT(t) {
    const a = this.app, c = this.cur;
    if (this.sw.run) return a.toast('秒表还在走', 'warn');
    if (!(this.sw.value > 0)) return a.toast('秒表读数为零', 'warn');
    const i = c ? t.rows.findIndex((r) => r.drop === c.id) : -1;
    if (i < 0) return a.toast('先给正在跟踪的这颗油滴记录平衡电压', 'warn');
    const k = [1, 2, 3].find((k) => !isFinite(t.rows[i]['t' + k]) || t.rows[i]['t' + k] === '' || t.rows[i]['t' + k] == null);
    if (!k) return a.toast(`这颗油滴已经测了 ${NT} 次`, 'warn');
    t.set(i, 't' + k, this.sw.value);
  }

  // ======================= 自动操作 =======================
  /** 挑一颗平衡电压 120–380 V、下落时间 8–35 s 的油滴 */
  pickGood() {
    const used = new Set(this.app.table('drop').rows.map((r) => r.drop));
    return this.drops.findIndex((dp) => { if (dp.lost || used.has(dp.id)) return false; const U = balanceU({ a: dp.a, q: dp.q, ...this.env() }), tg = (L / this.vOf(dp, 0)); return U > 120 && U < 380 && tg > 8 && tg < 35 && Math.abs(dp.y) < 1.4; });
  }
  async oneDrop() {
    const a = this.app;
    a.select(a.comp('power'));
    let k = this.pickGood();
    for (let tries = 0; k < 0 && tries < 12; tries++) { this.spray(); k = this.pickGood(); }
    if (k < 0) return;
    this.sel = k; this.mode = 'bal'; a.renderInspector();
    const c = this.cur, Ub = Math.round(balanceU({ a: c.a, q: c.q, ...this.env() }));
    await a.tween(() => this.U, (v) => (this.U = Math.round(v)), Ub, 600); this.U = Ub; a.changed();
    await a.wait(500);
    await a.record('drop', 0);
    for (let n = 0; n < NT; n++) {
      if (c.lost) return;
      this.mode = 'up'; a.renderInspector();
      if (!(await a.until(() => c.y > YA + 0.35 || c.lost, 60000))) return;
      this.mode = 'fall'; this.sw.reset(); this.auto = { phase: 'arm' }; a.renderInspector();
      if (!(await a.until(() => !this.auto || c.lost, 90000))) { this.auto = null; return; }
      this.mode = 'bal'; a.renderInspector();
      await a.record('drop', 1);
    }
  }
  steps() {
    const app = this.app, rows = () => app.table('drop').rows;
    const nT = (r) => [1, 2, 3].filter((k) => isFinite(r['t' + k]) && r['t' + k] > 0).length;
    return [
      {
        title: '调水平、调焦',
        html: '<p>调两个调平螺丝，使水准泡居中（平行板水平，电场竖直）。喷一次油，调显微镜焦距，使油滴成清晰的亮点。</p>',
        status: () => `倾斜 ${this.tiltDeg.toFixed(2)}°；${Math.abs(this.focus) < 0.05 ? '已调焦' : '未调焦'}`,
        check: () => this.tiltDeg < 0.3 && Math.abs(this.focus) < 0.05,
        diagnose: () => {
          const out = [];
          if (this.tiltDeg >= 0.3) out.push({ msg: `水准泡还偏 ${this.tiltDeg.toFixed(2)}°（螺丝 1：${this.tilt[0].toFixed(2)}，螺丝 2：${this.tilt[1].toFixed(2)}，两个都要调到 0 附近）。`, fix: { label: '帮我调平', run: async () => { await app.tween(() => this.tilt[0], (v) => (this.tilt[0] = v), 0, 600); await app.tween(() => this.tilt[1], (v) => (this.tilt[1] = v), 0, 600); this.tilt = [0, 0]; } } });
          if (Math.abs(this.focus) >= 0.05) out.push({ msg: this.drops.length ? `图像${this.focus > 0 ? '焦点偏后' : '焦点偏前'}，转动调焦旋钮使油滴成为清晰的小亮点。` : '视场里还没有油滴，没法判断焦距：先喷一次油。', fix: { label: '帮我调焦', run: async () => { if (!this.drops.length) this.spray(); await app.tween(() => this.focus, (v) => (this.focus = v), 0, 600); this.focus = 0; } } });
          return out;
        },
        auto: async () => {
          await app.view('油滴盒'); app.select(app.comp('cell'));
          await app.tween(() => this.tilt[0], (v) => (this.tilt[0] = v), 0, 600); await app.tween(() => this.tilt[1], (v) => (this.tilt[1] = v), 0, 600); this.tilt = [0, 0];
          if (!this.drops.length) this.spray();
          await app.tween(() => this.focus, (v) => (this.focus = v), 0, 600); this.focus = 0; app.changed();
        },
      },
      {
        title: '选一颗油滴，调平衡电压',
        html: '<p>喷油后在视场中挑一颗亮度适中、运动较慢的油滴（点击它即可跟踪）。在“平衡”状态下调平衡电压，直到它静止不动。平衡电压在 150–350 V、下落 2 mm 需要 10–30 s 的油滴最合适：太大的油滴下落快、计时误差大，太小的布朗运动明显。</p>',
        hint: '电压调高油滴上升，调低油滴下降。调好后观察十几秒，确认它不再漂移。',
        check: () => rows().length >= 1,
        diagnose: () => {
          const c = this.cur, out = [];
          if (!this.drops.length) return [{ msg: '还没有喷油。', fix: { label: '喷油', run: async () => this.spray() } }];
          if (!c || c.lost) return [{ msg: '跟踪的油滴已经离开视野，挑另一颗或重新喷油。', fix: { label: '重新喷油', run: async () => this.spray() } }];
          if (this.mode !== 'bal') out.push({ msg: `电源在“${this.mode === 'up' ? '提升' : '0 V'}”状态，调平衡要切到“平衡”。`, fix: { label: '切到平衡', run: async () => { this.mode = 'bal'; } } });
          const Ub = balanceU({ a: c.a, q: c.q, ...this.env() }), tg = L / this.vOf(c, 0);
          if (Ub > 420 || tg < 6) out.push({ msg: `这颗油滴太大或带电太少（平衡要 ${Ub > 500 ? '超过 500' : Ub.toFixed(0)} V，下落只要 ${tg.toFixed(1)} s），换一颗。` });
          else if (tg > 45) out.push({ msg: `这颗油滴太小，下落 2 mm 要 ${tg.toFixed(0)} s，布朗运动影响大，换一颗。` });
          else if (this.mode === 'bal' && Math.abs(this.U - Ub) > 3) out.push({ msg: `现在 ${this.U} V，这颗油滴在${this.U > Ub ? '上升' : '下降'}：把电压往${this.U > Ub ? '低' : '高'}调。`, fix: { label: '帮我调平衡', run: () => app.tween(() => this.U, (v) => (this.U = Math.round(v)), Math.round(Ub), 600).then(() => { this.U = Math.round(Ub); }) } });
          return out;
        },
        auto: async () => {
          app.showTable(0); a0(app);
          let k = this.pickGood();
          for (let tries = 0; k < 0 && tries < 12; tries++) { this.spray(); k = this.pickGood(); }
          if (k < 0) return;
          this.sel = k; this.mode = 'bal'; app.renderInspector();
          const c = this.cur, Ub = Math.round(balanceU({ a: c.a, q: c.q, ...this.env() }));
          await app.tween(() => this.U, (v) => (this.U = Math.round(v)), Ub, 600); this.U = Ub; app.changed();
          await app.wait(400); await app.record('drop', 0);
        },
      },
      {
        title: `测下落时间（${NT} 次）`,
        html: `<p>切到“提升”把油滴提到 A 线上方，再切到“0 V”让它自由下落：经过 A 线开表，经过 B 线停表，随即切回“平衡”。重复 ${NT} 次。</p>`,
        check: () => rows().some((r) => nT(r) >= NT),
        auto: async () => {
          app.showTable(0);
          const r = rows()[rows().length - 1], c = this.drops.find((d) => d.id === r.drop);
          if (!c || c.lost) { await this.oneDrop(); return; }
          this.sel = this.drops.indexOf(c);
          for (let n = nT(r); n < NT; n++) {
            this.mode = 'up'; app.renderInspector();
            if (!(await app.until(() => c.y > YA + 0.35 || c.lost, 60000))) return;
            this.mode = 'fall'; this.sw.reset(); this.auto = { phase: 'arm' }; app.renderInspector();
            if (!(await app.until(() => !this.auto || c.lost, 90000))) { this.auto = null; return; }
            this.mode = 'bal'; app.renderInspector(); await app.record('drop', 1);
          }
        },
      },
      {
        title: '再测 4 颗油滴',
        html: '<p>换不同的油滴（最好挑平衡电压差别较大的，它们带的电荷数不同），共测 5 颗。</p>',
        status: () => `已测完 ${rows().filter((r) => nT(r) >= NT).length} / 5 颗`,
        check: () => rows().filter((r) => nT(r) >= NT).length >= 5,
        auto: async () => { app.showTable(0); for (let k = 0; k < 12 && rows().filter((r) => nT(r) >= NT).length < 5; k++) await this.oneDrop(); },
      },
      {
        title: '数据处理',
        html: '<p>由平衡电压和下落时间算出每颗油滴的电荷 $q$，求 $q$ 是 $e$ 的几倍（取整得 $n$），再求 $e=q/n$ 的平均值。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, rows = a.table('drop').rows.filter((r) => isFinite(r.U) && r.U > 0);
    const ts = (r) => [1, 2, 3].map((k) => r['t' + k]).filter((x) => isFinite(x) && x > 0);
    const data = rows.filter((r) => ts(r).length);
    if (!data.length) return { html: '<p>请先测量油滴的平衡电压和下落时间。</p>', ok: false };
    const env = { l: L, d: D, rho: RHO, Tc: this.Tc, p: this.p };
    const res = data.map((r) => { const t = mean(ts(r)), q = chargeStatic({ U: r.U, tg: t, ...env }), n = Math.max(1, Math.round(q / E0)); return { id: r.id, U: r.U, t, q, n, e: q / n }; });
    const e = mean(res.map((x) => x.e)), ue = res.length > 1 ? Math.sqrt(res.reduce((s, x) => s + (x.e - e) ** 2, 0) / (res.length - 1) / res.length) : 0;
    let html = `<h3>1. 实验条件</h3><p>板间距 d = ${(D * 1000).toFixed(2)} mm，计时距离 l = ${(L * 1000).toFixed(2)} mm，油的密度 ρ = ${RHO} kg/m³，室温 ${this.Tc.toFixed(1)} °C（空气黏度 η = ${(airEta(this.Tc) * 1e5).toFixed(3)}×10⁻⁵ Pa·s），气压 p = ${(this.p / 1000).toFixed(2)} kPa，坎宁汉修正常数 b = 8.23×10⁻³ Pa·m。</p>
      <h3>2. 各油滴的电荷</h3><table><tr><th>油滴</th><th>U/V</th><th>t̄/s</th><th>q/(10⁻¹⁹ C)</th><th>n = q/e₀ 取整</th><th>e = q/n /(10⁻¹⁹ C)</th></tr>
      ${res.map((x) => `<tr><td>${x.id}</td><td>${x.U}</td><td>${x.t.toFixed(2)}</td><td>${(x.q * 1e19).toFixed(3)}</td><td>${x.n}</td><td>${(x.e * 1e19).toFixed(4)}</td></tr>`).join('')}</table>
      <p>各油滴的电荷都接近某个最小电荷的整数倍——这正是电荷量子化的证据。这里用公认值 $e_0$ 来确定倍数 $n$（“倒过来验证”）；也可以不借助公认值，求各 $q$ 的“最大公约数”。</p>
      <div class="result-box">$e=${fmtU(e * 1e19, ue * 1e19)}\\times10^{-19}$ C</div>
      <p>公式里求油滴半径时用了未经修正的黏度，并略去了空气浮力，这两个近似使算出的 $q$ 偏大约 0.3%–1.5%（小油滴偏得多），这是本方法的系统误差。</p>`;
    html += `<div class="result-box warn">元电荷公认值 1.6022×10⁻¹⁹ C，测量值相对误差 ${pct(relErr(e, E0), 2)}。</div>`;
    const answers = [{ label: '$e$', unit: '×10⁻¹⁹ C', value: e * 1e19, digits: 3, tolRel: 0.005 }];
    return { html, ok: true, answers, plots: [{ title: '各油滴的电荷', xLabel: 'n（电荷数）', yLabel: 'q / 10⁻¹⁹ C', series: [{ type: 'scatter', data: res.map((x) => [x.n, x.q * 1e19]), label: '实验' }, { type: 'line', data: [[0, 0], [Math.max(...res.map((x) => x.n)) + 1, (Math.max(...res.map((x) => x.n)) + 1) * 1.602]], label: 'q = n e₀' }] }] };
  }

  principle() {
    return `<h3>1. 平衡</h3>${millikanFig()}<p>带电荷 $q$ 的油滴处在两平行板之间，板间电压 $U$、间距 $d$。调节 $U$ 使油滴静止，电场力与重力平衡（浮力很小，略去）：</p>$$mg=q\\frac Ud$$
<h3>2. 由下落速度求油滴质量</h3><p>撤去电压，油滴加速下落，很快达到匀速 $v_g$，此时重力与空气的黏滞阻力平衡（斯托克斯公式）：$mg=6\\pi\\eta a v_g$，而 $m=\\frac43\\pi a^3\\rho$，得 $a=\\sqrt{\\dfrac{9\\eta v_g}{2\\rho g}}$。</p>
<p>油滴半径（约 1 μm）与空气分子的平均自由程（约 0.07 μm）相比不算太大，斯托克斯公式要作坎宁汉修正：$\\eta'=\\dfrac{\\eta}{1+b/(pa)}$。用 $v_g=l/t_g$ 代入整理得</p>$$q=\\frac{18\\pi}{\\sqrt{2\\rho g}}\\left[\\frac{\\eta l}{t_g\\left(1+\\frac b{pa}\\right)}\\right]^{3/2}\\frac dU$$
<h3>3. 电荷量子化</h3><p>测出若干油滴的 $q$，它们都是某个最小电荷 $e$ 的整数倍：$q=ne$。</p>
<h3>4. 本仿真的计算模型</h3><p>每次喷油得到 7 颗半径 0.45–1.25 μm、带 1–13 个电子电荷的油滴。油滴的速度按完整的力平衡计算：重力减浮力、电场力、斯托克斯阻力（坎宁汉修正），空气黏度按 Sutherland 公式随室温变化；同时叠加布朗运动（扩散系数 $D=kT/6\\pi\\eta'a$，每秒约 5 μm）。仪器不水平时电场不竖直，油滴会横向漂移。</p>`;
  }
}

/** 自动操作开始前选中电源（便于学生看到旋钮转动） */
function a0(app) { app.select(app.comp('power')); }
