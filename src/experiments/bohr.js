// 实验：用波尔共振仪研究受迫振动（摆轮 + 蜗卷弹簧 + 电磁阻尼 + 偏心轮电机 + 闪光灯 + 控制箱）
// 摆轮的运动由 physics/bohr.js 按 J·θ'' = −k(θ)θ − bθ' + kα₀cos ωt 实时积分；控制箱用光电门计振幅（1°）和周期（1 ms），
// 闪光灯在电机转到参考位置时闪一下，照亮摆轮上的长缺口，在有机玻璃转盘的刻度上读出相位差。
import * as THREE from 'three';
import { meta, thumb } from './bohr.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, clamp, mean, linFit, fmtU, relErr, pct, stdev } from '../core/Stats.js';
import { BohrWheel, steady } from '../physics/bohr.js';

const DEG = Math.PI / 180;
const SVG = (inner) => `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;

export class BohrExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.T0 = rand(1.55, 1.61);
    this.betas = [rand(0.0015, 0.0025), rand(0.022, 0.028), rand(0.040, 0.050), rand(0.060, 0.072)];
    this.damp = 0; this.motor = false; this.knob = 4; this.strobe = false; this.init = 160; this.timeScale = 1;
    this.pa = 1 + rand(-0.006, 0.006); // 电机周期刻度的个体差异
    this.wheel = new BohrWheel({ w0: (2 * Math.PI) / this.T0, beta: this.betas[0], c: rand(0.0012, 0.0019) });
    this.wheel.a0 = rand(3.2, 3.6) * DEG;
    this.wheel.w = this.wDrive;
    this.cap = null; this.mem = null; this.phNoise = 0;
  }

  /** 强迫力周期旋钮（十圈电位器 0–9.99）→ 电机周期 */
  get Td() { return (1.3 + 0.062 * this.knob + 0.0009 * this.knob * this.knob) * this.pa; }
  get wDrive() { return (2 * Math.PI) / this.Td; }
  get Ashow() { return Math.round(this.wheel.lastA); }
  get Tshow() { const T = this.wheel.lastT(this.motor ? 10 : 1); return isFinite(T) ? Math.round(T * 1000) / 1000 : NaN; }
  get phiShow() { const p = this.wheel.phase; return isFinite(p) ? Math.round(clamp(p + this.phNoise, 0, 180)) : NaN; }
  /** 稳态：最近 6 个峰值相差不到 0.5° */
  steadyNow() {
    const p = this.wheel.peaks;
    if (!this.motor || p.length < 6) return false;
    const a = p.slice(-6).map((x) => x.A);
    return Math.max(...a) - Math.min(...a) < 0.5 && this.wheel.t - (this._tDrive ?? 0) > 60;
  }
  setDamp(d) { this.damp = d; this.wheel.beta = this.betas[d]; this.app.changed(); }
  setMotor(v) { this.motor = v; this.wheel.drive = v; if (v) { this.wheel.w = this.wDrive; this._tDrive = this.wheel.t; } this.app.changed(); }
  setKnob(v) { this.knob = clamp(Math.round(v * 100) / 100, 0, 9.99); this.wheel.w = this.wDrive; this._tDrive = this.wheel.t; this.app.changed(); }
  release() {
    const w = this.wheel;
    w.th = this.init * DEG; w.om = 0; w.peaks.length = 0; w.ups.length = 0; w.refs.length = 0;
    this.cap = null; this._tDrive = w.t; this.app.changed();
  }
  startCapture() {
    const a = this.app;
    if (this.motor) a.toast('电机还开着：摆轮受强迫力作用，记下的不是自由衰减', 'warn');
    if (this.wheel.lastA < 20 && Math.abs(this.wheel.th) < 20 * DEG) return a.toast('摆轮几乎不动：先把摆轮转到约 160° 再松手', 'warn');
    this.cap = { t0: this.wheel.t, damp: this.damp, motor: this.motor }; this.mem = null;
    a.toast('控制箱开始记录接下来 10 次振动的振幅和周期', 'ok');
  }

  tick(dt) {
    const a = this.app, sdt = Math.min(20, dt * (a.running ? a.speed * 25 : this.timeScale));
    if (!(sdt > 0)) return;
    const n0 = this.wheel.refs.length;
    this.wheel.advance(sdt);
    if (this.wheel.refs.length !== n0) this.phNoise = rand(-1.2, 1.2);
    if (this.cap) {
      const pk = this.wheel.peaks.filter((p) => p.t > this.cap.t0), up = this.wheel.ups.filter((t) => t > this.cap.t0);
      if (pk.length >= 10 && up.length >= 11) {
        this.mem = { damp: this.cap.damp, motor: this.cap.motor, A: pk.slice(0, 10).map((p) => Math.round(p.A)), T: up.slice(0, 11).map((t, i, u) => (i ? Math.round((t - u[i - 1]) * 1000) / 1000 : 0)).slice(1) };
        this.cap = null; a.toast('阻尼振荡数据已存入控制箱，可以读取', 'ok');
      }
    }
    a.changed();
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 52, 86], target: [0, 18, 0] }, { name: '摆轮', pos: [-6, 26, 40], target: [-6, 22, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(130, 60));
    app.stage.setLightTarget(0, 18, 0);
    const R = 11, cy = 22, cx = -6;
    const frame = new THREE.Group();
    frame.add(mesh(new THREE.BoxGeometry(44, 1.5, 16), MAT.paint(0x2b3138), cx + 6, 0.75, 0));
    frame.add(mesh(new THREE.BoxGeometry(2, cy + 4, 2), MAT.paint(0x3a4150), cx - 15, (cy + 4) / 2, -3));
    frame.add(mesh(new THREE.BoxGeometry(16, 1.6, 1.6), MAT.paint(0x3a4150), cx - 7, cy + 3, -3));
    frame.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 12), MAT.chrome(), cx, cy, -1.5).rotateX(Math.PI / 2));
    // 电磁阻尼线圈（跨在摆轮下缘）
    frame.add(mesh(new THREE.BoxGeometry(5, 4, 4), MAT.paint(0x8a2b1f), cx, cy - R - 1, -0.5));
    // 摆轮：铜圆环 + 辐条 + 长缺口
    const wg = (this.wheelG = new THREE.Group()); wg.position.set(cx, cy, 0);
    const copper = new THREE.MeshStandardMaterial({ color: 0xb06a34, metalness: 0.85, roughness: 0.3 });
    wg.add(mesh(new THREE.TorusGeometry(R, 0.9, 12, 80), copper));
    for (let k = 0; k < 4; k++) { const s = mesh(new THREE.BoxGeometry(0.6, 2 * R, 0.5), copper); s.rotation.z = (k * Math.PI) / 4; wg.add(s); }
    wg.add(mesh(new THREE.BoxGeometry(0.6, 2.4, 2.2), MAT.black(), 0, R + 0.4, 0)); // 长缺口标记
    // 蜗卷弹簧
    const pts = []; for (let i = 0; i <= 200; i++) { const t = (i / 200) * 6 * Math.PI, r = 0.8 + 0.27 * t; pts.push(new THREE.Vector3(r * Math.cos(t), r * Math.sin(t), 1.4)); }
    this.spring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x1b1b1b }));
    wg.add(this.spring);
    frame.add(wg);
    // 电机、偏心轮、连杆、有机玻璃相位盘、闪光灯
    const mx = cx + 22;
    frame.add(mesh(new THREE.CylinderGeometry(2.4, 2.4, 6, 24), MAT.paint(0x24303b), mx, cy - 6, -2).rotateX(Math.PI / 2));
    this.crank = new THREE.Group(); this.crank.position.set(mx, cy - 6, 1.6);
    this.crank.add(mesh(new THREE.CylinderGeometry(3, 3, 0.5, 30), MAT.alu()).rotateX(Math.PI / 2), mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 10), MAT.black(), 2.2, 0, 0.6).rotateX(Math.PI / 2));
    const disk = mesh(new THREE.CylinderGeometry(6.5, 6.5, 0.3, 48), MAT.glass(0xdfeeff, 0.35), 0, 0, 1); disk.rotation.x = Math.PI / 2; this.crank.add(disk);
    frame.add(this.crank);
    this.rod = mesh(new THREE.CylinderGeometry(0.25, 0.25, 1, 8), MAT.chrome()); frame.add(this.rod);
    this.lampMat = MAT.emissive(0xffffff, 0);
    frame.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 4, 16), MAT.black(), mx - 8, 4, 4), mesh(new THREE.SphereGeometry(1, 16, 10), this.lampMat, mx - 8, 6.4, 4));
    app.addComponent(new Component({
      key: 'wheel', name: '波尔共振仪（摆轮）', zone: 'none', fixed: true, object: frame, labelY: 38,
      icon: SVG('<circle cx="22" cy="20" r="14"/><path d="M22 6v28M8 20h28"/><circle cx="50" cy="26" r="6"/><path d="M44 24L30 12"/>'),
      desc: '铜质摆轮在蜗卷弹簧作用下绕轴摆动，自由振动周期约 1.6 s。轮缘有一圈缺口，光电门据此计振幅；一个长缺口用来测相位差。电机通过偏心轮和连杆周期性地扭动弹簧外端，产生强迫力矩。',
      controls: () => [
        { type: 'slider', label: '松手前转到', get: () => this.init, set: (v) => (this.init = v), min: 20, max: 175, step: 1, unit: '°' },
        { type: 'button', label: '转到该角度后松手', onClick: () => this.release() },
        { type: 'readout', label: '摆轮转角', get: () => `${(this.wheel.th / DEG).toFixed(0)}°` },
      ],
    }));
    const box = (this.box = meterBox(26, 11, 14, 'BG 型控制箱')); box.group.position.set(34, 0, 6); box.group.rotation.y = -0.35;
    app.addComponent(new Component({
      key: 'box', name: '控制箱（电机、阻尼、闪光灯）', zone: 'none', fixed: true, object: box.group, labelY: 15,
      icon: SVG('<rect x="6" y="8" width="52" height="24" rx="2"/><rect x="11" y="13" width="18" height="8"/><circle cx="42" cy="20" r="4"/><circle cx="52" cy="20" r="2"/>'),
      desc: '显示振幅（1°）和周期（0.001 s；电机开时显示 10 个周期的平均值）。阻尼挡 0 为只有轴承摩擦，1–3 为电磁阻尼依次增大。强迫力周期旋钮是十圈电位器。阻尼振荡功能可以自动记录 10 次振动的振幅和周期。',
      controls: () => [
        { type: 'segment', label: '阻尼挡', get: () => this.damp, set: (v) => this.setDamp(v), options: [0, 1, 2, 3].map((d) => ({ label: String(d), value: d })) },
        { type: 'toggle', label: '电机', get: () => this.motor, set: (v) => this.setMotor(v) },
        { type: 'knob', label: '强迫力周期旋钮', get: () => this.knob, set: (v) => this.setKnob(v), min: 0, max: 9.99, step: 0.01, bigStep: 0.2, perRev: 1, digits: 2, unit: '' },
        { type: 'toggle', label: '闪光灯', get: () => this.strobe, set: (v) => { this.strobe = v; app.changed(); } },
        { type: 'button', label: '阻尼振荡：开始记录 10 次', onClick: () => this.startCapture() },
      ],
    }));
    this.view = app.addView({ id: 'panel', title: '控制箱与相位盘', w: 330, h: 190, res: 1.5 });
  }

  update() {
    const w = this.wheel;
    this.wheelG.rotation.z = w.th;
    this.spring.scale.setScalar(1 + 0.04 * w.th);
    this.crank.rotation.z = -w.ph;
    const R = 11, cx = -6, cy = 22, mx = cx + 22;
    const p1 = new THREE.Vector3(mx + 2.2 * Math.cos(-w.ph), cy - 6 + 2.2 * Math.sin(-w.ph), 2.2), p2 = new THREE.Vector3(cx + 6.2, cy - 4, 1.4);
    this.rod.position.copy(p1).add(p2).multiplyScalar(0.5); this.rod.scale.y = p1.distanceTo(p2);
    this.rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
    const flash = this.strobe && this.motor && w.ph < 0.5;
    this.lampMat.emissiveIntensity = this.strobe ? (flash ? 3 : 0.15) : 0;
    const A = String(this.Ashow), T = isFinite(this.Tshow) ? this.Tshow.toFixed(3) : '----';
    if (A + T !== this._bx) { this._bx = A + T; this.box.setText(A, '°', `周期 ${T} s  阻尼 ${this.damp}`); }

    const v = this.view, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
    const lcd = (x, y, wd, label, val, unit) => {
      g.fillStyle = '#9aa5ab'; g.font = `${H * 0.065}px "Microsoft YaHei"`; g.textAlign = 'left'; g.fillText(label, x, y);
      g.fillStyle = '#0b1410'; g.fillRect(x, y + H * 0.03, wd, H * 0.17);
      g.fillStyle = '#8fe3a5'; g.font = `600 ${H * 0.12}px "IBM Plex Mono", monospace`; g.textAlign = 'right'; g.fillText(val, x + wd - H * 0.12, y + H * 0.165);
      g.fillStyle = '#7d8a90'; g.font = `${H * 0.06}px "IBM Plex Mono", monospace`; g.textAlign = 'left'; g.fillText(unit, x + wd - H * 0.1, y + H * 0.165);
    };
    lcd(W * 0.03, H * 0.08, W * 0.42, '振幅 θ', String(this.Ashow), '°');
    lcd(W * 0.03, H * 0.38, W * 0.42, this.motor ? '周期 10T/10' : '周期 T', T, 's');
    g.fillStyle = '#9aa5ab'; g.font = `${H * 0.06}px "Microsoft YaHei"`; g.textAlign = 'left';
    g.fillText(`阻尼挡 ${this.damp}   电机 ${this.motor ? '开' : '关'}   旋钮 ${this.knob.toFixed(2)}`, W * 0.03, H * 0.72);
    g.fillText(this.cap ? '阻尼振荡记录中……' : this.mem ? `记忆：阻尼 ${this.mem.damp} 的 10 次振动` : '', W * 0.03, H * 0.82);
    // 有机玻璃相位盘：频闪时看到长缺口停在相位刻度上
    const px = W * 0.73, py = H * 0.52, r = H * 0.4;
    g.strokeStyle = '#5c6a73'; g.lineWidth = 1; g.beginPath(); g.arc(px, py, r, Math.PI, 2 * Math.PI); g.stroke();
    g.fillStyle = '#c9d2d8'; g.font = `${H * 0.05}px "IBM Plex Mono", monospace`; g.textAlign = 'center';
    for (let d = 0; d <= 180; d += 10) {
      const a = Math.PI + (d * Math.PI) / 180, L = d % 30 === 0 ? 0.13 : 0.07;
      g.beginPath(); g.moveTo(px + r * Math.cos(a), py + r * Math.sin(a)); g.lineTo(px + r * (1 - L) * Math.cos(a), py + r * (1 - L) * Math.sin(a)); g.stroke();
      if (d % 30 === 0) g.fillText(String(d), px + r * 1.12 * Math.cos(a), py + r * 1.12 * Math.sin(a) + H * 0.02);
    }
    const ph = this.phiShow;
    if (this.strobe && this.motor && isFinite(ph)) {
      const a = Math.PI + (ph * Math.PI) / 180;
      g.strokeStyle = this.steadyNow() ? '#ff6b6b' : 'rgba(255,107,107,.45)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + r * 0.95 * Math.cos(a), py + r * 0.95 * Math.sin(a)); g.stroke();
      g.fillStyle = '#ffd2d2'; g.font = `${H * 0.065}px "Microsoft YaHei"`; g.fillText('闪光下的长缺口', px, py + H * 0.14);
    } else { g.fillStyle = '#7d8a90'; g.font = `${H * 0.06}px "Microsoft YaHei"`; g.fillText(this.motor ? '打开闪光灯读相位差' : '电机未开', px, py + H * 0.14); }
    v.foot(!this.motor ? (this.Ashow > 2 ? '摆轮在自由（阻尼）振动' : '摆轮静止：转到某个角度后松手')
      : this.steadyNow() ? '受迫振动已稳定，可以记录' : '受迫振动尚未稳定：振幅还在变化，等它稳定');
  }
  globalControls() { return [{ type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×5', value: 5 }, { label: '×20', value: 20 }] }]; }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'free', title: '自由振动：振幅与周期', maxRows: 14,
        columns: [{ key: 'A', label: '振幅 θ/°', digits: 0, readTol: 0.6 }, { key: 'T0', label: '周期 T₀/s', digits: 3, readTol: 0.0011 }],
        buttons: [{ label: '记录控制箱的 θ、T', onClick: (t) => this.recFree(t) }],
        note: '阻尼挡置 0、电机关。摆轮转到约 160° 松手，随着振幅慢慢减小，每隔十几度记一组 θ 和 T₀（也可以每次从不同角度松手）。',
      },
      {
        id: 'decay', title: '阻尼振荡（阻尼挡 2）', fixedRows: true,
        initRows: () => Array.from({ length: 10 }, (_, i) => ({ i })),
        columns: [{ key: 'i', label: 'i', digits: 0, readonly: true }, { key: 'A', label: '振幅 θᵢ/°', digits: 0, readTol: 0.6 }, { key: 'T', label: '周期 T/s', digits: 3, readTol: 0.0011 }],
        buttons: [{ label: '读取控制箱记忆', onClick: (t) => this.recDecay(t) }],
        note: '阻尼挡置 2、电机关，摆轮转到约 160° 松手，按控制箱的“阻尼振荡：开始记录”，记完后读取。',
      },
      {
        id: 'forced', title: '受迫振动：幅频与相频', maxRows: 16,
        columns: [{ key: 'T', label: '周期 T/s', digits: 3, readTol: 0.0011 }, { key: 'A', label: '振幅 θ/°', digits: 0, readTol: 0.6 }, { key: 'phi', label: '相位差 φ/°', digits: 0, readTol: 1.1 }],
        buttons: [{ label: '记录 T、θ、φ', onClick: (t) => this.recForced(t) }],
        note: '阻尼挡保持 2，开电机。改变强迫力周期，每次等振幅稳定后，开闪光灯读相位差，并记下周期和振幅。共振附近（φ 在 60°–120° 之间）要多测几点。',
      },
    ];
  }
  recFree(t) {
    const a = this.app;
    if (this.Ashow < 20) a.toast('振幅太小了：把摆轮转到大角度再松手', 'warn');
    if (!isFinite(this.Tshow)) return a.toast('控制箱还没测出完整的一个周期，稍等', 'warn');
    if (t.rows.some((r) => Math.abs(r.A - this.Ashow) < 3)) a.toast('这个振幅附近已经记过了，等振幅再减小一些', 'warn');
    const fl = [];
    if (this.motor) fl.push('电机开着，测到的是强迫力的周期而不是固有周期');
    if (this.damp !== 0) fl.push(`阻尼挡是 ${this.damp}，不是 0`);
    t.flagAll(t.addRow({ A: this.Ashow, T0: this.Tshow }), fl);
  }
  recDecay(t) {
    const a = this.app;
    if (!this.mem) return a.toast(this.cap ? '控制箱还在记录，稍等' : '控制箱里没有记录：先松开摆轮，再按“阻尼振荡：开始记录”', 'warn');
    const fl = [];
    if (this.mem.motor) fl.push('记录时电机开着，不是自由衰减');
    if (this.mem.damp !== 2) fl.push(`这组数据是在阻尼挡 ${this.mem.damp} 下记录的，本实验约定用阻尼挡 2`);
    if (this.mem.A[0] < 100) fl.push('起始振幅偏小，10 次振动的振幅变化不明显');
    this.mem.A.forEach((A, i) => { t.set(i, 'A', A); t.set(i, 'T', this.mem.T[i]); });
    t.rows.forEach((r) => { r._damp = this.mem.damp; delete r._flaw; });
    if (fl.length) { t.flagAll(0, fl); t.rows.forEach((r) => (r._flaw = t.rows[0]._flaw)); t.changed(); }
  }
  recForced(t) {
    const a = this.app;
    if (!this.motor) return a.toast('电机没开，摆轮不是在做受迫振动', 'warn');
    if (!this.strobe) return a.toast('相位差要在闪光灯下读：打开闪光灯', 'warn');
    const dd = this.app.table('decay').rows.find((r) => r._damp != null)?._damp;
    if (!isFinite(this.Tshow) || !isFinite(this.phiShow)) return a.toast('控制箱还没测出周期，稍等', 'warn');
    if (t.rows.some((r) => Math.abs(r.T - this.Tshow) < 0.0015)) a.toast('这个周期已经记过了：改变强迫力周期', 'warn');
    const fl = [];
    if (dd != null && dd !== this.damp) fl.push(`测阻尼系数用的是阻尼挡 ${dd}，现在是 ${this.damp}`);
    if (!this.steadyNow()) fl.push('振幅还没有稳定，这时的振幅和相位差都不是稳态值');
    t.flagAll(t.addRow({ T: this.Tshow, A: this.Ashow, phi: this.phiShow, _damp: this.damp }), fl);
  }

  // ======================= 自动操作 =======================
  /** 由期望的相位差反推旋钮读数 */
  knobFor(phiDeg) {
    const w0 = (2 * Math.PI) / this.T0, b = this.betas[this.damp], p = phiDeg * DEG;
    const w = Math.abs(Math.cos(p)) < 1e-6 ? w0 : (-b / Math.tan(p) + Math.sqrt((b / Math.tan(p)) ** 2 + w0 * w0)); // 2bω/(ω0²−ω²) = tanφ
    const T = (2 * Math.PI) / w / this.pa;
    let lo = 0, hi = 9.99; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; (1.3 + 0.062 * m + 0.0009 * m * m) < T ? (lo = m) : (hi = m); }
    return Math.round(((lo + hi) / 2) * 100) / 100;
  }
  async setup({ damp, motor }) {
    const a = this.app; a.select(a.comp('box'));
    if (this.motor !== motor) this.setMotor(motor);
    if (this.damp !== damp) this.setDamp(damp);
    a.renderInspector(); await a.wait(200);
  }
  steps() {
    const app = this.app;
    const filled = (id, k) => app.table(id).rows.filter((r) => r[k] != null && r[k] !== '' && isFinite(r[k]));
    return [
      {
        title: '测自由振动周期 T₀ 与振幅的关系',
        html: '<p>阻尼挡置 0，关电机。把摆轮转到约 160° 后松手，摆轮几乎无阻尼地振动，振幅缓慢减小。每隔十几度记录一次振幅 $\\theta$ 和对应的周期 $T_0$，到 50° 左右为止。</p>',
        hint: '弹簧的劲度系数随转角略有变化，T₀ 与振幅有关（相差千分之几），后面求相位差理论值时要用对应振幅下的 T₀。',
        status: () => `已记录 ${filled('free', 'T0').length} 组`,
        check: () => { const r = filled('free', 'A'); return r.length >= 6 && Math.max(...r.map((x) => x.A)) - Math.min(...r.map((x) => x.A)) >= 60; },
        diagnose: () => {
          const out = [];
          if (this.motor) out.push({ msg: '电机开着，摆轮做的是受迫振动。', fix: { label: '关电机', run: () => this.setup({ damp: 0, motor: false }) } });
          if (this.damp !== 0) out.push({ msg: `阻尼挡是 ${this.damp}，测固有周期应置 0。`, fix: { label: '阻尼挡置 0', run: () => this.setup({ damp: 0, motor: false }) } });
          if (this.Ashow < 20) out.push({ msg: '摆轮振幅太小。转到约 160° 再松手。', fix: { label: '转到 160° 松手', run: () => { this.init = 160; this.release(); } } });
          return out;
        },
        auto: async () => {
          await this.setup({ damp: 0, motor: false }); app.showTable(0); app.select(app.comp('wheel'));
          for (const A of [160, 145, 130, 115, 100, 85, 70, 55]) {
            if (filled('free', 'A').some((r) => Math.abs(r.A - A) < 6)) continue;
            this.init = A + 1; app.renderInspector(); this.release();
            await app.until(() => this.wheel.ups.length >= 3 && this.wheel.peaks.length >= 2, 20000);
            await app.record('free');
          }
        },
      },
      {
        title: '阻尼振荡：测阻尼系数 β',
        html: '<p>阻尼挡置 2，关电机。摆轮转到约 160° 松手，立即按控制箱的“阻尼振荡：开始记录”，控制箱记下接下来 10 次振动的振幅 $\\theta_0,\\theta_1,\\dots,\\theta_9$ 和周期。读取到表中。</p>',
        hint: '振幅按 θ = θ₀e^{−βt} 衰减，用逐差法 β = ln(θᵢ/θᵢ₊₅)/(5T̄)。',
        check: () => filled('decay', 'A').length >= 10,
        diagnose: () => {
          const out = [];
          if (this.motor) out.push({ msg: '测阻尼振荡要关电机。', fix: { label: '关电机，阻尼挡 2', run: () => this.setup({ damp: 2, motor: false }) } });
          if (this.damp !== 2) out.push({ msg: `阻尼挡是 ${this.damp}，本实验约定用 2。`, fix: { label: '阻尼挡置 2', run: () => this.setup({ damp: 2, motor: false }) } });
          if (this.mem) out.push({ msg: '控制箱里已经有记录了：点数据表的“读取控制箱记忆”。' });
          return out;
        },
        auto: async () => {
          await this.setup({ damp: 2, motor: false }); app.showTable(1);
          app.select(app.comp('wheel')); this.init = 160; app.renderInspector(); this.release(); await app.wait(200);
          app.select(app.comp('box')); this.startCapture();
          await app.until(() => this.mem, 60000);
          await app.record('decay');
        },
      },
      {
        title: '受迫振动：测幅频与相频特性',
        html: '<p>阻尼挡保持 2，打开电机。调节强迫力周期旋钮，每改变一次，等振幅稳定（几十个周期）后，打开闪光灯，在相位盘上读出相位差 $\\varphi$，并记下周期 $T$ 和振幅 $\\theta$。从 φ ≈ 20° 测到 φ ≈ 160°，共振附近多测几点。</p>',
        hint: '共振时 φ = 90°，振幅最大。远离共振时振幅只有十几度。',
        status: () => `已记录 ${filled('forced', 'phi').length} 点`,
        check: () => { const r = filled('forced', 'phi'); return r.length >= 10 && r.some((x) => x.phi < 45) && r.some((x) => x.phi > 135) && r.some((x) => Math.abs(x.phi - 90) < 12); },
        diagnose: () => {
          const out = [];
          if (!this.motor) out.push({ msg: '电机没开。', fix: { label: '开电机（阻尼挡 2）', run: () => this.setup({ damp: 2, motor: true }) } });
          if (this.damp !== 2) out.push({ msg: `阻尼挡是 ${this.damp}，必须与测 β 时（2）相同。`, fix: { label: '阻尼挡置 2', run: () => this.setup({ damp: 2, motor: true }) } });
          if (this.motor && !this.strobe) out.push({ msg: '相位差要开闪光灯读。', fix: { label: '开闪光灯', run: () => { this.strobe = true; app.renderInspector(); } } });
          const r = filled('forced', 'phi');
          if (r.length >= 4 && !r.some((x) => Math.abs(x.phi - 90) < 12)) out.push({ msg: '还没有测到共振附近（φ ≈ 90°）的点。', fix: { label: '把周期调到共振附近', run: () => this.setKnob(this.knobFor(90)) } });
          return out;
        },
        auto: async () => {
          await this.setup({ damp: 2, motor: true }); this.strobe = true; app.renderInspector(); app.showTable(2);
          for (const p of [18, 35, 55, 70, 80, 88, 95, 105, 115, 130, 150, 165]) {
            if (filled('forced', 'phi').some((r) => Math.abs(r.phi - p) < 4)) continue;
            const k = this.knobFor(p);
            app.select(app.comp('box')); await app.tween(() => this.knob, (v) => this.setKnob(v), k, 400); this.setKnob(k);
            await app.until(() => this.steadyNow(), 60000);
            await app.record('forced');
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>由阻尼振荡求 β；作幅频曲线 θ–ω/ω₀ 和相频曲线 φ–ω/ω₀，并与理论值比较。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app;
    const fr = a.table('free').completeRows().filter((r) => r.A > 0 && r.T0 > 0);
    const dr = a.table('decay').rows.filter((r) => r.A > 0 && r.T > 0);
    const fo = a.table('forced').completeRows().filter((r) => r.T > 0 && isFinite(r.phi));
    let html = '', ok = false;
    const answers = [], plots = [];
    let T0of = () => this.T0;
    if (fr.length >= 2) {
      const f = linFit(fr.map((r) => r.A), fr.map((r) => r.T0));
      T0of = (A) => f.k * A + f.b;
      html += `<h3>1. 自由振动周期</h3><p>测得 ${fr.length} 组，$T_0$ 从 ${Math.min(...fr.map((r) => r.T0)).toFixed(3)} s 到 ${Math.max(...fr.map((r) => r.T0)).toFixed(3)} s。按 $T_0=a\\theta+b$ 拟合：$a=${(f.k * 1e5).toFixed(2)}\\times10^{-5}$ s/°，$b=${f.b.toFixed(4)}$ s，用于按振幅查固有周期。</p>`;
    } else html += '<h3>1. 自由振动周期</h3><p>至少测 2 组 θ–T₀。下面按仪器标称 T₀ 计算。</p>';
    let beta = NaN;
    if (dr.length >= 10) {
      const T = mean(dr.map((r) => r.T)), lr = [0, 1, 2, 3, 4].map((i) => Math.log(dr[i].A / dr[i + 5].A));
      beta = mean(lr) / (5 * T); const ub = (stdev(lr) / Math.sqrt(5)) / (5 * T);
      html += `<h3>2. 阻尼系数</h3><table><tr><th>i</th>${[0, 1, 2, 3, 4].map((i) => `<th>${i}</th>`).join('')}</tr><tr><td>θᵢ/°</td>${[0, 1, 2, 3, 4].map((i) => `<td>${dr[i].A}</td>`).join('')}</tr><tr><td>θᵢ₊₅/°</td>${[0, 1, 2, 3, 4].map((i) => `<td>${dr[i + 5].A}</td>`).join('')}</tr><tr><td>ln(θᵢ/θᵢ₊₅)</td>${lr.map((x) => `<td>${x.toFixed(4)}</td>`).join('')}</tr></table>
        <p>$\\bar T=${T.toFixed(4)}$ s，$\\beta=\\dfrac{\\overline{\\ln(\\theta_i/\\theta_{i+5})}}{5\\bar T}$</p>
        <div class="result-box">$\\beta=${fmtU(beta, ub).replace('±', '\\pm')}\\ \\mathrm{s^{-1}}$，品质因数 $Q=\\dfrac{\\omega_0}{2\\beta}=${((2 * Math.PI) / T / (2 * beta)).toFixed(1)}$</div>
        <div class="result-box warn">本台仪器阻尼挡 2 的实际 β = ${this.betas[2].toFixed(4)} s⁻¹，相对误差 ${pct(relErr(beta, this.betas[2]))}（振幅只读到 1°，是主要误差来源）。</div>`;
      answers.push({ label: '$\\beta$', unit: 's⁻¹', value: beta, digits: 4, tolRel: 0.02 });
      ok = true;
    } else html += '<h3>2. 阻尼系数</h3><p>请先读取 10 次阻尼振荡的数据。</p>';
    if (fo.length >= 3) {
      const b = isFinite(beta) ? beta : this.betas[2];
      const rows = fo.map((r) => { const w0 = (2 * Math.PI) / T0of(r.A), w = (2 * Math.PI) / r.T, th = (Math.atan2(2 * b * w, w0 * w0 - w * w)) / DEG; return { ...r, x: w / w0, th }; }).sort((p, q) => p.x - q.x);
      const top = rows.reduce((p, q) => (q.A > p.A ? q : p));
      html += `<h3>3. 幅频与相频特性</h3><table><tr><th>T/s</th><th>θ/°</th><th>T₀(θ)/s</th><th>ω/ω₀</th><th>φ 测/°</th><th>φ 理论/°</th><th>差/°</th></tr>${rows.map((r) => `<tr><td>${r.T.toFixed(3)}</td><td>${r.A}</td><td>${T0of(r.A).toFixed(4)}</td><td>${r.x.toFixed(4)}</td><td>${r.phi}</td><td>${r.th.toFixed(1)}</td><td>${(r.phi - r.th).toFixed(1)}</td></tr>`).join('')}</table>
        <p>理论值 $\\varphi=\\arctan\\dfrac{2\\beta\\omega}{\\omega_0^2-\\omega^2}$（取 0°–180°），$\\omega_0$ 按该振幅对应的 $T_0$ 计算。</p>
        <div class="result-box">共振点：$T$ = ${top.T.toFixed(3)} s，$\\omega/\\omega_0$ = ${top.x.toFixed(4)}，$\\theta_{\\max}$ = ${top.A}°，相位差 ${top.phi}°</div>
        <div class="result-box warn">相位差偏差的主要来源：相位盘读数 ±1°；没等振动完全稳定；T₀ 随振幅变化；阻尼较小时相频曲线在共振附近很陡，周期的微小误差会造成相位差的较大偏差。</div>`;
      const curve = (fn) => Array.from({ length: 81 }, (_, i) => { const x = 0.8 + (0.4 * i) / 80; return [x, fn(x)]; });
      const w0n = (2 * Math.PI) / T0of(top.A), a0 = this.wheel.a0 / DEG;
      plots.push({ title: '幅频特性 θ – ω/ω₀', xLabel: 'ω/ω₀', yLabel: 'θ / °', series: [{ type: 'scatter', data: rows.map((r) => [r.x, r.A]), label: '实验点' }, { type: 'line', data: curve((x) => steady(x * w0n, w0n, b, a0).A).filter((p) => p[1] < 200), label: '理论（线性）' }] });
      plots.push({ title: '相频特性 φ – ω/ω₀', xLabel: 'ω/ω₀', yLabel: 'φ / °', series: [{ type: 'scatter', data: rows.map((r) => [r.x, r.phi]), label: '实验点' }, { type: 'line', data: curve((x) => steady(x * w0n, w0n, b, a0).phi / DEG), label: '理论' }] });
      ok = true;
    } else html += '<h3>3. 幅频与相频特性</h3><p>受迫振动至少测 3 点。</p>';
    return { html, ok, answers, plots };
  }

  principle() {
    return `<h3>1. 受迫振动方程</h3><p>摆轮受三个力矩：蜗卷弹簧的弹性力矩 $-k\\theta$，电磁阻尼力矩 $-b\\,\\mathrm d\\theta/\\mathrm dt$，电机经偏心轮和连杆施加的周期性强迫力矩 $M_0\\cos\\omega t$。转动定律给出</p>$$J\\frac{\\mathrm d^2\\theta}{\\mathrm dt^2}=-k\\theta-b\\frac{\\mathrm d\\theta}{\\mathrm dt}+M_0\\cos\\omega t$$<p>令 $\\omega_0^2=k/J$，$2\\beta=b/J$，$m=M_0/J$，稳态解为 $\\theta=\\theta_2\\cos(\\omega t-\\varphi)$，其中</p>$$\\theta_2=\\frac{m}{\\sqrt{(\\omega_0^2-\\omega^2)^2+4\\beta^2\\omega^2}},\\qquad \\varphi=\\arctan\\frac{2\\beta\\omega}{\\omega_0^2-\\omega^2}$$<p>稳态振动的频率等于强迫力矩的频率，振幅和相位差取决于 $\\omega$、$\\omega_0$ 和 $\\beta$，与初始条件无关。开始时还叠加着按 $e^{-\\beta t}$ 衰减的暂态项，所以每次改变强迫力周期后要等足够长时间。</p>
<h3>2. 共振</h3><p>当 $\\omega_r=\\sqrt{\\omega_0^2-2\\beta^2}$ 时振幅最大，$\\theta_r=\\dfrac{m}{2\\beta\\sqrt{\\omega_0^2-\\beta^2}}$。β 越小，共振峰越高越尖，相频曲线在 $\\omega_0$ 附近越陡。$\\omega=\\omega_0$ 时 $\\varphi=90°$。</p>
<h3>3. 阻尼系数</h3><p>电机关闭时摆轮做阻尼振动 $\\theta=\\theta_0e^{-\\beta t}\\cos(\\omega_d t+\\alpha)$，相隔 $n$ 个周期的振幅之比 $\\ln\\dfrac{\\theta_i}{\\theta_{i+n}}=n\\beta\\bar T$。取 $n=5$ 用逐差法求 β。</p>
<h3>4. 频闪法测相位差</h3><p>电机转轴上装有一块有机玻璃相位盘，电机每转到参考位置，控制箱就让闪光灯闪一下。受迫振动稳定后，每次闪光时摆轮都处在同一位置，人眼看到摆轮上的长缺口“停”在相位盘的某个刻度上，这就是摆轮相对强迫力矩落后的相位 φ。</p>
<h3>5. 本仿真的计算模型</h3><p>按上式用四阶龙格–库塔法实时积分（步长 ≤ 2 ms），弹簧劲度系数随转角有千分之几的变化 $k(\\theta)=k_0(1+c\\theta^2)$，所以 $T_0$ 随振幅略有不同。振幅按光电门计数取整到 1°，周期测到 1 ms，相位盘读数有约 ±1° 的判读误差。</p>`;
  }
}
