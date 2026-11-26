// 实验：绝热膨胀法测空气的比热容比 γ（打气 → 等温 → 放气 → 等温回升）
// 瓶内气体按 physics/gasvessel.js 的开口系统能量方程计算（打气时被压缩升温、放气时绝热膨胀降温、瓶壁传热使温度回到室温）。
// 放气阀在实时时间下操作：关得太早，瓶内压强还没降到大气压；关得太晚，回升的热量已经进来。两种情况 γ 都会测偏。
import * as THREE from 'three';
import { meta, thumb } from './gamma.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss, fmtU, tFactor } from '../core/Stats.js';
import { GasVessel, gammaOf } from '../physics/gasvessel.js';
import { gammaFig } from './mechFigs2.js';

const KP = 20; // 压强传感器灵敏度（标称）mV/kPa
const KT = 5; // AD590 + 5 kΩ：mV/K
const GAMMA_REF = 1.402;
const NRUN = 5;
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class GammaExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.Tw = 273.15 + rand(18, 26);
    this.p0 = Math.round(rand(99.8, 102.4) * 100) * 10; // Pa
    this.gas = new GasVessel({ V: 0.0102, Tw: this.Tw, p0: this.p0, gamma: rand(1.399, 1.403), tauH: rand(34, 46) });
    this.kp = KP * (1 + rand(-0.006, 0.006)); // 实际灵敏度
    this.zeroErr = rand(-2.5, 2.5); this.zero = 0; // 传感器零点漂移、调零旋钮（mV）
    this.c1 = false; this.c2 = true; this.timeScale = 1; this.hist = []; this.lastHist = 0;
    this.vent = null; this.lastVent = null; this.pumpQ = 0;
  }
  get dispP() { return (this.gas.p - this.p0) / 1000 * this.kp + this.zeroErr + this.zero; } // mV
  get dispT() { return this.gas.Ts * KT; }
  get hiss() { return this.c2 && this.gas.outflow() < -1e-4; }

  tick(dt) {
    const a = this.app;
    // 放气阀开着时按真实时间走（学生要凭“放气声”及时关阀）；其余时候可以加速
    const fast = a.running ? a.speed * (this.c1 ? 1 : 20) : this.c1 ? 1 : this.timeScale; // 打气（C1 开着）时不加速
    let sdt = this.c2 && this.gas.p - this.p0 > 30 ? Math.min(0.1, dt) : Math.min(fast * dt, 60);
    if (!(sdt > 0)) return;
    while (sdt > 0) {
      const h = Math.min(sdt, this.vent ? 0.01 : this.pumpQ > 0 ? this.pumpQ + 1e-9 : sdt);
      this.gas.inflow = this.pumpQ > 0 ? 0.021 : 0;
      if (this.pumpQ > 0) this.pumpQ = Math.max(0, this.pumpQ - h);
      // 进气阀 C1 开着而没有打气：气体从打气球处慢慢漏掉
      const leak = this.c1 && this.pumpQ <= 0 && this.gas.p > this.p0 ? -(this.gas.p - this.p0) * 3e-8 : 0;
      this.gas.inflow += leak;
      this.gas.valve = this.c2;
      this.gas.step(h);
      if (this.vent) {
        this.vent.dur += h;
        if (this.vent.auto && !this.hiss && this.vent.dur > 0.05) { this.vent.extra = (this.vent.extra || 0) + h; if (this.vent.extra > 0.08) this.closeC2(); }
      }
      sdt -= h;
    }
    if (this.gas.t - this.lastHist > 0.5) { this.lastHist = this.gas.t; this.hist.push([this.gas.t, this.dispP, this.dispT]); if (this.hist.length > 900) this.hist.shift(); }
    a.changed();
  }
  setC2(v) {
    if (v === this.c2) return;
    if (v) { this.c2 = true; this.vent = { dur: 0, dp0: this.gas.p - this.p0, auto: this.app.running && this.gas.p - this.p0 > 1500 }; } // 只有给打过气的瓶子放气时，自动操作才“听声关阀”
    else this.closeC2();
    this.app.changed();
  }
  closeC2() {
    if (!this.c2) return;
    this.c2 = false;
    if (this.vent && this.vent.dp0 > 1500) {
      const left = this.gas.p - this.p0;
      this.lastVent = { dur: this.vent.dur, left, at: this.gas.t };
      if (!this.app.running) {
        if (left > 60) this.app.toast(`放气阀关得太早：瓶内还比大气压高 ${left.toFixed(0)} Pa（放气声还没结束）。这次测出的 γ 会明显偏大`, 'warn');
        else if (this.vent.dur > 2.5) this.app.toast(`放气阀开了 ${this.vent.dur.toFixed(1)} s，太久：放气声停止后外面的热量已经传进来，γ 会偏小`, 'warn');
      }
    }
    this.vent = null;
    this.app.renderInspector();
  }
  squeeze() {
    const a = this.app;
    if (!this.c1) return a.toast('进气阀 C1 关着，捏打气球打不进气', 'warn');
    if (this.c2) a.toast('放气阀 C2 开着，打进去的气马上从 C2 跑掉了', 'warn');
    if (this.dispP > 190) return a.toast('压强已经接近传感器量程（10 kPa），不要再打气了', 'warn');
    this.pumpQ = 0.2; a.changed();
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [30, 60, 100], target: [0, 18, 0] }, { name: '测量仪', pos: [34, 26, 46], target: [30, 8, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(140, 70));
    app.stage.setLightTarget(0, 15, 0);
    const g = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xdfeee8, transparent: true, opacity: 0.28, roughness: 0.05, transmission: 0.6, side: THREE.DoubleSide });
    g.add(mesh(new THREE.CylinderGeometry(11, 11, 28, 40, 1, true), glass, 0, 14, 0));
    const dome = mesh(new THREE.SphereGeometry(11, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2.6), glass, 0, 28, 0); g.add(dome);
    g.add(mesh(new THREE.CylinderGeometry(11, 11, 0.6, 40), glass, 0, 0.3, 0));
    g.add(mesh(new THREE.CylinderGeometry(3.2, 2.8, 3, 24), MAT.paint(0x2d2a26), 0, 36, 0)); // 橡皮塞
    const tube = (x0, y0, x1, y1) => { const L = Math.hypot(x1 - x0, y1 - y0), m = mesh(new THREE.CylinderGeometry(0.35, 0.35, L, 8), MAT.paint(0x7a8a8f), (x0 + x1) / 2, (y0 + y1) / 2, 0); m.rotation.z = -Math.atan2(x1 - x0, y1 - y0); return m; };
    g.add(tube(-1.5, 37, -1.5, 42), tube(-1.5, 42, -12, 42), tube(1.5, 37, 1.5, 44), tube(0, 37, 0, 40), tube(0, 40, 22, 40), tube(22, 40, 26, 12));
    // C1（接打气球）、C2（通大气）两个阀门：阀体 + 手柄
    const valve = (x, y) => { const v = new THREE.Group(); v.add(mesh(new THREE.SphereGeometry(1.1, 16, 12), MAT.metal())); const hd = mesh(new THREE.BoxGeometry(3.6, 0.5, 0.8), MAT.paint(0xb91c1c), 0, 1.3, 0); v.add(hd); v.position.set(x, y, 0); v.userData.handle = hd; return v; };
    this.v1 = valve(-7, 42); this.v2 = valve(1.5, 45.5); g.add(this.v1, this.v2);
    // 打气球
    this.bulb = mesh(new THREE.SphereGeometry(3, 24, 16), MAT.paint(0x8b2d1f), -15, 40, 0); this.bulb.scale.set(1.4, 1, 1); g.add(this.bulb);
    app.addComponent(new Component({
      key: 'bottle', name: '储气瓶', zone: 'none', fixed: true, required: true, object: g, labelY: 50,
      icon: SVG('<rect x="20" y="8" width="24" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M28 8V3h8v5" stroke="currentColor" fill="none"/>'),
      desc: '约 10 L 的玻璃储气瓶，橡皮塞上装有进气阀 C1（接打气球）、放气阀 C2（通大气），以及接到测量仪的压强传感器和 AD590 温度传感器。',
      controls: () => [
        { type: 'toggle', label: '进气阀 C1', get: () => this.c1, set: (v) => { this.c1 = v; app.changed(); } },
        { type: 'button', label: '捏一下打气球', onClick: () => this.squeeze() },
        { type: 'toggle', label: '放气阀 C2（放气声一停立即关）', get: () => this.c2, set: (v) => this.setC2(v) },
      ],
    }));
    const mp = (this.mP = meterBox(16, 9, 10, '压强 / mV')), mt = (this.mT = meterBox(16, 9, 10, '温度 / mV'));
    mp.group.position.set(24, 0, 2); mt.group.position.set(42, 0, 2);
    const box = new THREE.Group(); box.add(mp.group, mt.group);
    app.addComponent(new Component({
      key: 'meter', name: '测量仪', zone: 'none', fixed: true, object: box, labelY: 13,
      desc: `压强传感器：显示瓶内压强比大气压高多少，灵敏度约 ${KP} mV/kPa（量程 0–10 kPa），开机后要在瓶内与大气相通时调零。温度传感器 AD590：输出电流 1 μA/K，经 5 kΩ 电阻显示为 ${KT} mV/K。`,
      controls: () => [
        { type: 'knob', label: '压强表调零', get: () => this.zero, set: (v) => { this.zero = clamp(Math.round(v * 10) / 10, -5, 5); app.changed(); }, min: -5, max: 5, step: 0.1, bigStep: 1, perRev: 4, digits: 1, unit: 'mV' },
        { type: 'readout', label: '气压计（大气压 p₀）', get: () => `${(this.p0 / 1000).toFixed(2)} kPa` },
      ],
    }));
    this.cv = app.addView({ id: 'chart', title: '测量仪读数与压强、温度曲线', w: 340, h: 250, res: 1.6 });
  }
  update() {
    const p = this.dispP, T = this.dispT;
    const sp = p.toFixed(1), st = T.toFixed(1);
    if (sp !== this._sp) { this._sp = sp; this.mP.setText(sp, 'mV', this.hiss ? '放气中……' : ''); }
    if (st !== this._st) { this._st = st; this.mT.setText(st, 'mV', `≈ ${(T / KT - 273.15).toFixed(2)} °C`); }
    this.v1.userData.handle.rotation.y = this.c1 ? 0 : Math.PI / 2;
    this.v2.userData.handle.rotation.y = this.c2 ? 0 : Math.PI / 2;
    this.bulb.scale.set(1.4, this.pumpQ > 0 ? 0.7 : 1, this.pumpQ > 0 ? 0.8 : 1);
    this.drawChart();
  }
  drawChart() {
    const v = this.cv, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    // 两块读数
    g.font = `bold ${H * 0.09}px "IBM Plex Mono"`; g.textAlign = 'right';
    const lcd = (x, label, val, c) => { g.fillStyle = '#0b1410'; g.fillRect(x, H * 0.04, W * 0.44, H * 0.17); g.fillStyle = c; g.fillText(val, x + W * 0.42, H * 0.17); g.fillStyle = '#9aa5ab'; g.font = `${H * 0.04}px "IBM Plex Mono"`; g.textAlign = 'left'; g.fillText(label, x + 4, H * 0.08); g.font = `bold ${H * 0.09}px "IBM Plex Mono"`; g.textAlign = 'right'; };
    lcd(W * 0.04, '压强 mV', this.dispP.toFixed(1), '#7dff9e'); lcd(W * 0.52, '温度 mV', this.dispT.toFixed(1), '#ffd27d');
    // 曲线：最近 240 s
    const x0 = W * 0.1, x1 = W * 0.96, y0 = H * 0.3, y1 = H * 0.9, t1 = this.gas.t, span = 240;
    g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 1; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    const hs = this.hist.filter((h) => h[0] > t1 - span);
    if (hs.length > 1) {
      const pMax = Math.max(40, ...hs.map((h) => h[1])) * 1.1, Ts = hs.map((h) => h[2]), Tm = (Math.max(...Ts) + Math.min(...Ts)) / 2, Tr = Math.max(4, Math.max(...Ts) - Math.min(...Ts)) * 0.6;
      const X = (t) => x1 - ((t1 - t) / span) * (x1 - x0);
      g.strokeStyle = '#7dff9e'; g.beginPath(); hs.forEach((h, i) => { const y = y1 - (h[1] / pMax) * (y1 - y0); i ? g.lineTo(X(h[0]), y) : g.moveTo(X(h[0]), y); }); g.stroke();
      g.strokeStyle = '#ffd27d'; g.beginPath(); hs.forEach((h, i) => { const y = (y0 + y1) / 2 - ((h[2] - Tm) / Tr) * (y1 - y0) * 0.5; i ? g.lineTo(X(h[0]), y) : g.moveTo(X(h[0]), y); }); g.stroke();
      g.fillStyle = '#9aa5ab'; g.font = `${H * 0.038}px "IBM Plex Mono"`; g.textAlign = 'left';
      g.fillText(`绿：压强（0–${pMax.toFixed(0)} mV）  黄：温度（±${(Tr / KT).toFixed(1)} K）  最近 ${span} s`, x0, H * 0.97);
    }
    const dT = this.gas.Ts - this.Tw, lv = this.lastVent;
    let foot;
    if (this.hiss) foot = '嘶——（放气声）……声音一停就关 C2';
    else if (this.pumpQ > 0) foot = '打气中';
    else if (Math.abs(dT) > 0.05) foot = `瓶内温度${dT > 0 ? '高于' : '低于'}室温 ${Math.abs(dT).toFixed(2)} K，正在${dT > 0 ? '降温' : '回升'}：等温度读数稳定`;
    else foot = this.c2 ? '瓶内与大气相通' : `温度稳定，瓶内比大气压高 ${((this.gas.p - this.p0)).toFixed(0)} Pa${lv && this.gas.t - lv.at < 400 ? `（上次放气 ${lv.dur.toFixed(2)} s）` : ''}`;
    v.foot(foot);
  }
  globalControls() {
    return [{ type: 'segment', label: '时间流速（放气时自动恢复实时）', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×4', value: 4 }, { label: '×10', value: 10 }] }];
  }

  // ======================= 数据表 =======================
  tables() {
    const p = (k) => (r) => (isFinite(r.p0) && isFinite(r[k]) ? r.p0 + r[k] / KP : NaN);
    return [{
      id: 'run', title: '各次测量', maxRows: 8,
      columns: [
        { key: 'p0', label: 'p₀/kPa', digits: 2, readTol: 0.006 },
        { key: 'U1', label: '状态Ⅰ 压强 U₁/mV', digits: 1, readTol: 0.06 },
        { key: 'T1', label: '状态Ⅰ 温度/mV', digits: 1, readTol: 0.06 },
        { key: 'U2', label: '状态Ⅲ 压强 U₂/mV', digits: 1, readTol: 0.06 },
        { key: 'T2', label: '状态Ⅲ 温度/mV', digits: 1, readTol: 0.06 },
        { key: 'g', label: 'γ', digits: 4, calc: (r) => gammaOf(r.p0, p('U1')(r), p('U2')(r)) },
      ],
      buttons: [{ label: '记录状态Ⅰ（新的一行）', onClick: (t) => this.rec1(t) }, { label: '记录状态Ⅲ', onClick: (t) => this.rec3(t) }],
      note: `p₁ = p₀ + U₁/${KP}，p₂ = p₀ + U₂/${KP}（kPa）。状态Ⅰ：打气后温度回到室温；状态Ⅲ：放气后温度回到室温。两次的温度读数应相同。`,
    }];
  }
  settled() { return Math.abs(this.gas.Ts - this.Tw) < 0.02 && Math.abs(this.gas.T - this.Tw) < 0.02; }
  rec1(t) {
    const a = this.app;
    if (this.c2) a.toast('放气阀 C2 开着，瓶内就是大气压', 'warn');
    if (this.dispP < 40) a.toast('瓶内压强太低：先打气到 100–150 mV', 'warn');
    if (this.c1) a.toast('进气阀 C1 没关，瓶内的气在慢慢漏掉', 'warn');
    if (!this.settled()) a.toast(`温度还没回到室温（差 ${(this.gas.Ts - this.Tw).toFixed(2)} K），压强还会变`, 'warn');
    t.addRow({ p0: this.p0 / 1000, U1: Math.round(this.dispP * 10) / 10, T1: Math.round(this.dispT * 10) / 10 });
  }
  rec3(t) {
    const a = this.app, i = t.rows.length - 1;
    if (i < 0 || !isFinite(t.rows[i].U1)) return a.toast('先记录状态Ⅰ', 'warn');
    if (isFinite(t.rows[i].U2)) a.toast('这一行的状态Ⅲ已经记过了：重新打气，记录新的状态Ⅰ', 'warn');
    if (this.c2) a.toast('放气阀还开着，关上后等温度回升再记录', 'warn');
    if (!this.lastVent) return a.toast('还没有放气', 'warn');
    if (!this.settled()) a.toast(`温度还没回升到室温（差 ${(this.gas.Ts - this.Tw).toFixed(2)} K），压强还在升`, 'warn');
    t.set(i, 'U2', Math.round(this.dispP * 10) / 10); t.set(i, 'T2', Math.round(this.dispT * 10) / 10);
  }

  // ======================= 自动操作 =======================
  async settle() { return this.app.until(() => Math.abs(this.gas.Ts - this.Tw) < 0.004 && Math.abs(this.gas.T - this.Tw) < 0.004 && this.pumpQ <= 0, 120000); }
  async pumpUp() {
    const a = this.app;
    a.select(a.comp('bottle'));
    this.setC2(false);
    // 打气时气体被压缩升温，冷却后压强会回落：打一轮、等稳定，不够再补
    for (let round = 0; round < 4; round++) {
      this.c1 = true; a.renderInspector();
      for (let k = 0; k < 12 && this.dispP < 130; k++) { this.squeeze(); await a.until(() => this.pumpQ <= 0, 5000); await a.wait(200); }
      this.c1 = false; a.renderInspector();
      await this.settle();
      if (this.dispP >= 95) break;
    }
  }
  async ventOnce() {
    const a = this.app;
    a.select(a.comp('bottle'));
    this.setC2(true); a.renderInspector();
    if (!(await a.until(() => !this.c2, 20000))) this.closeC2();
    await this.settle();
  }
  steps() {
    const app = this.app, rows = () => app.table('run').rows, done = () => rows().filter((r) => isFinite(r.U1) && isFinite(r.U2));
    const bottleFix = { label: '关上 C1', run: async () => { this.c1 = false; } };
    return [
      {
        title: '压强表调零，记下大气压',
        html: '<p>打开放气阀 C2，使瓶内与大气相通，转动“压强表调零”使压强读数为 0.0 mV。从气压计读出大气压 $p_0$。</p>',
        status: () => `压强读数 ${this.dispP.toFixed(1)} mV${this.c2 ? '' : '（C2 关着）'}`,
        check: () => this.c2 && Math.abs(this.dispP) < 0.15,
        diagnose: () => (!this.c2 ? [{ msg: '调零要在瓶内与大气相通时进行：先打开放气阀 C2。', fix: { label: '打开 C2', run: async () => this.setC2(true) } }] : Math.abs(this.dispP) >= 0.15 ? [{ msg: `压强读数 ${this.dispP.toFixed(1)} mV，不是零：把“压强表调零”往${this.dispP > 0 ? '负' : '正'}方向转。`, fix: { label: '帮我调零', run: async () => { const z = this.zero - this.dispP; await app.tween(() => this.zero, (v) => (this.zero = v), z, 600); this.zero = Math.round(z * 10) / 10; } } }] : []),
        auto: async () => {
          app.select(app.comp('meter')); this.setC2(true); app.renderInspector();
          await app.until(() => this.gas.p - this.p0 < 1, 20000);
          const z = Math.round((this.zero - this.dispP) * 10) / 10;
          await app.tween(() => this.zero, (v) => (this.zero = v), z, 700); this.zero = z; app.changed();
        },
      },
      {
        title: '打气，等温度回到室温（状态Ⅰ）',
        html: '<p>关闭 C2，打开 C1，捏打气球把空气压入瓶内，使压强读数为 100–150 mV，关闭 C1。气体被压缩后温度升高，要等它通过瓶壁散热、温度读数回到室温并稳定（压强也随之稳定），再记录 $U_1$ 和温度——这是状态Ⅰ $(p_1,T_0)$。</p>',
        hint: '温度读数和压强读数都不再变化（看右侧曲线变平）才算稳定，大约要 2–3 分钟，可以把时间流速调快。',
        check: () => rows().some((r) => isFinite(r.U1)),
        diagnose: () => {
          const out = [];
          if (this.c2) out.push({ msg: '放气阀 C2 还开着，打进去的气会跑掉。', fix: { label: '关上 C2', run: async () => this.setC2(false) } });
          else if (this.dispP < 90 && !this.c1) out.push({ msg: `压强只有 ${this.dispP.toFixed(1)} mV：打开进气阀 C1 再捏打气球。`, fix: { label: '帮我打气', run: () => this.pumpUp() } });
          else if (this.dispP < 90) out.push({ msg: `压强 ${this.dispP.toFixed(1)} mV，再捏几下打气球，到 100–150 mV。`, fix: { label: '帮我打气', run: () => this.pumpUp() } });
          if (this.c1 && this.dispP >= 90) out.push({ msg: '打完气要关上进气阀 C1，否则瓶内的气会从打气球那边慢慢漏掉。', fix: bottleFix });
          if (!this.c2 && this.dispP >= 90 && !this.settled()) out.push({ msg: `温度比室温还${this.gas.Ts > this.Tw ? '高' : '低'} ${Math.abs(this.gas.Ts - this.Tw).toFixed(2)} K，压强还在变。等曲线变平再记录（可以把时间流速调到 ×10）。` });
          return out;
        },
        auto: async () => { app.showTable(0); await this.pumpUp(); await app.record('run', 0); },
      },
      {
        title: '放气，等温度回升（状态Ⅲ）',
        html: '<p>打开放气阀 C2，瓶内气体迅速冲出，<b>听到放气声刚停止就立即关闭 C2</b>。这一瞬间瓶内气体近似作绝热膨胀，压强降到 $p_0$、温度降到 $T_1$（状态Ⅱ）。关闭后气体从瓶壁吸热，温度回升到室温，压强升到 $p_2$（状态Ⅲ），稳定后记录 $U_2$ 与温度。</p>',
        hint: '关早了，瓶内压强还没降到大气压；关晚了，外面的热量已经传进来。两种情况 γ 都会测偏，关早的影响更大。',
        check: () => { const r = rows()[rows().length - 1]; return !!r && isFinite(r.U2); },
        diagnose: () => {
          const out = [], lv = this.lastVent;
          if (this.c1) out.push({ msg: '进气阀 C1 开着，先关上。', fix: bottleFix });
          if (lv && lv.left > 60) out.push({ msg: `上一次放气关阀太早：关阀时瓶内还比大气压高 ${lv.left.toFixed(0)} Pa。这样测出的 γ 会偏大很多，应重新打气再做一次。`, fix: { label: '帮我重新打气', run: () => this.pumpUp() } });
          else if (lv && lv.dur > 2.5) out.push({ msg: `上一次放气阀开了 ${lv.dur.toFixed(1)} s，太久了。放气声一停（约 0.4 s）就要关。` });
          if (!this.c2 && lv && !this.settled()) out.push({ msg: `温度还比室温低 ${Math.abs(this.gas.Ts - this.Tw).toFixed(2)} K，正在回升。等它稳定再记录状态Ⅲ。` });
          return out;
        },
        auto: async () => { app.showTable(0); const r = rows()[rows().length - 1]; if (!r || isFinite(r.U2) || this.c2) { await this.pumpUp(); await app.record('run', 0); } await this.ventOnce(); await app.record('run', 1); },
      },
      {
        title: `重复测量，共 ${NRUN} 次`,
        html: `<p>每次都从打气开始，重复 ${NRUN} 次。打气的多少可以不同。</p>`,
        status: () => `已完成 ${done().length} / ${NRUN} 次`,
        check: () => done().length >= NRUN,
        auto: async () => { app.showTable(0); for (let k = 0; k < 10 && done().length < NRUN; k++) { await this.pumpUp(); await app.record('run', 0); await this.ventOnce(); await app.record('run', 1); } },
      },
      {
        title: '数据处理',
        html: '<p>由 $\\gamma=\\dfrac{\\ln(p_1/p_0)}{\\ln(p_1/p_2)}$ 算出每次的 γ，求平均值和不确定度。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const rows = this.app.table('run').rows.filter((r) => isFinite(r.p0) && isFinite(r.U1) && isFinite(r.U2) && r.U1 > r.U2);
    if (!rows.length) return { html: '<p>请先完成至少一次完整的测量（状态Ⅰ和状态Ⅲ）。</p>', ok: false };
    const res = rows.map((r) => { const p1 = r.p0 + r.U1 / KP, p2 = r.p0 + r.U2 / KP; return { ...r, p1, p2, g: gammaOf(r.p0, p1, p2), ga: r.U1 / (r.U1 - r.U2) }; });
    const gs = res.map((x) => x.g), gm = mean(gs), n = gs.length, s = n > 1 ? stdev(gs) : 0, uA = n > 1 ? (tFactor(n) * s) / Math.sqrt(n) : 0;
    let html = `<h3>1. 测量数据</h3><table><tr><th>p₀/kPa</th><th>U₁/mV</th><th>U₂/mV</th><th>p₁/kPa</th><th>p₂/kPa</th><th>T₁ /mV</th><th>T₃ /mV</th><th>γ</th></tr>
      ${res.map((x) => `<tr><td>${x.p0.toFixed(2)}</td><td>${x.U1.toFixed(1)}</td><td>${x.U2.toFixed(1)}</td><td>${x.p1.toFixed(3)}</td><td>${x.p2.toFixed(3)}</td><td>${(+x.T1).toFixed(1)}</td><td>${(+x.T2).toFixed(1)}</td><td>${x.g.toFixed(4)}</td></tr>`).join('')}</table>
      <p>两个状态的温度读数应相同（都等于室温）；若不同，说明记录时温度还没稳定。由于 $p_1-p_0\\ll p_0$，$\\gamma\\approx\\dfrac{U_1}{U_1-U_2}$（本组近似值 ${mean(res.map((x) => x.ga)).toFixed(4)}），压强传感器的灵敏度误差在比值中抵消，所以只需要它线性好、零点准。</p>
      <div class="result-box">$\\gamma=${fmtU(gm, uA)}$（${n} 次，A 类不确定度，置信概率 0.95）</div>
      <p>误差来源：放气时间（关早使 γ 偏大，关晚使 γ 偏小）；记录状态Ⅰ、Ⅲ时温度没有完全回到室温；放气过程中仍有少量热交换，所以即使操作理想，测得值也会略小于理论值。</p>`;
    html += `<div class="result-box warn">干燥空气 γ 的公认值约 ${GAMMA_REF}（双原子分子理想气体 7/5 = 1.400），测量值相对误差 ${pct(relErr(gm, GAMMA_REF), 2)}。</div>`;
    return { html, ok: true, answers: [{ label: '$\\bar\\gamma$', unit: '', value: gm, digits: 3, tolRel: 0.003 }], plots: [{ title: '各次测得的 γ', xLabel: '序号', yLabel: 'γ', series: [{ type: 'scatter', data: gs.map((g, i) => [i + 1, g]), label: '测量值' }, { type: 'line', data: [[0.5, GAMMA_REF], [n + 0.5, GAMMA_REF]], label: '公认值' }] }] };
  }

  principle() {
    return `<h3>1. 比热容比</h3><p>气体的定压摩尔热容与定容摩尔热容之比 $\\gamma=C_p/C_v$。理想气体 $C_p-C_v=R$；双原子分子在室温下 $C_v=\\frac52R$，$\\gamma=1.40$。</p>
<h3>2. 三个状态</h3>${gammaFig()}<p>Ⅰ：打气后关闭 C1，等瓶内气体温度回到室温 $T_0$，压强 $p_1$。<br>Ⅱ：打开 C2 迅速放气，压强降到大气压 $p_0$ 时立即关闭。这一过程很快，来不及与外界交换热量，瓶内剩余的气体作<b>绝热膨胀</b>，温度降到 $T_1<T_0$：$p_1^{\\gamma-1}T_0^{-\\gamma}=p_0^{\\gamma-1}T_1^{-\\gamma}$。<br>Ⅲ：关闭 C2 后气体等容吸热，温度回升到 $T_0$，压强升到 $p_2$。Ⅱ→Ⅲ 是等容过程：$p_0/T_1=p_2/T_0$。</p>
<p>消去温度得</p>$$\\gamma=\\frac{\\ln(p_1/p_0)}{\\ln(p_1/p_2)}$$
<h3>3. 本仿真的计算模型</h3><p>瓶内空气按开口系统的能量方程积分：放气时流出的气体带走焓，剩下的气体相当于绝热膨胀；打气时进来的气体带入焓、瓶内气体被压缩升温；瓶壁传热 $\\dot Q=-K(T-T_0)$，热弛豫时间约 40 s。放气阀按孔口流量计算，压差约 6 kPa 时约 0.4 s 放完（这就是“放气声”持续的时间）。温度传感器 AD590 有约 2.5 s 的响应时间。放气阀开着时仿真按真实时间进行，关阀的时机由你掌握。</p>`;
  }
}
