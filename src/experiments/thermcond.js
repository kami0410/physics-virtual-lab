// 实验：稳态平板法测不良导体的导热系数
// 传热按 physics/conduction.js 计算：样品沿厚度分层（有热容，所以升温要几十分钟才稳定），发热盘带 PI 温控，
// 铜盘之间有接触热阻，散热盘向空气的散热按自然对流 + 辐射，上、下、侧面的对流系数不同。
import * as THREE from 'three';
import { meta, thumb } from './thermcond.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh } from '../core/Models.js';
import { mean, stdev, rand, relErr, pct, clamp, gauss, fmtU } from '../core/Stats.js';
import { Caliper } from '../core/gauges.js';
import { LeeDisc, leeLambda } from '../physics/conduction.js';
import { leeFig } from './mechFigs.js';

const C_CU = 385; // 铜的比热 J/(kg·K)
const YP = 13; // 散热盘下表面高度 cm
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;
const GEO = [['hB1', '样品厚度 h_B（位置 1）/mm', 'hB'], ['hB2', '样品厚度 h_B（位置 2）/mm', 'hB'], ['hB3', '样品厚度 h_B（位置 3）/mm', 'hB'], ['DB', '样品直径 D_B/mm', 'DB'], ['DP', '散热盘直径 D_P/mm', 'DP'], ['hP', '散热盘厚度 h_P/mm', 'hP'], ['m', '散热盘质量 m/g', 'm']];
const MODES = { stack: 'A-B-P 叠放加热', AP: '移去样品，A 直接加热 P', P: '抬起 A，P 在空气中冷却' };
/** 两个等半径圆盘错开 e 时的重叠面积比例 */
const overlap = (e, R) => { const u = Math.min(1, Math.abs(e) / (2 * R)); return (2 / Math.PI) * (Math.acos(u) - u * Math.sqrt(1 - u * u)); };
const clock = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export class ThermCondExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    const Ta = Math.round(rand(17, 26) * 10) / 10;
    this.geo = { hB: rand(7.6, 8.4) / 1000, RB: rand(64.6, 65.4) / 1000, RP: rand(64.6, 65.4) / 1000, hP: rand(6.9, 7.6) / 1000 };
    this.geo.mP = 8930 * Math.PI * this.geo.RP ** 2 * this.geo.hP * (1 + rand(-0.01, 0.01));
    this.hBvar = [0, 1, 2].map(() => rand(-0.03, 0.03)); // 样品各处厚度略有差别 mm
    this.lam = rand(0.14, 0.26);
    this.sim = new LeeDisc({
      lam: this.lam, rc: rand(1.5, 1.8) * 1e6, hB: this.geo.hB, RB: this.geo.RB, mP: this.geo.mP, cP: C_CU, RP: this.geo.RP, hP: this.geo.hP,
      CA: rand(340, 380), Ta, eps: rand(0.12, 0.3), Gc: rand(3000, 6000),
    });
    this.sim.set = 60;
    this.sensErr = [gauss(0.08), gauss(0.08)];
    this.cal = new Caliper({ range: 150 }); this.tool = 'hB'; this.hpos = 0; this.setTool('hB');
    // 样品 B 叠放时不一定放正：随机错开几毫米，要学生自己推正
    this.Bon = true; this.Adown = true; this.eB = (Math.random() < 0.5 ? -1 : 1) * rand(3, 8); this.syncMode();
    this.timeScale = 10; this.hist = []; this.coolT0 = null; this.peakP = -Infinity; this.assist = false; this.cap = 120;
  }

  get T1() { return Math.round((this.sim.TA + this.sensErr[0]) * 10) / 10; }
  get T2() { return Math.round((this.sim.TP + this.sensErr[1]) * 10) / 10; }

  // ======================= 时间推进 =======================
  tick(dt) {
    const a = this.app;
    const sdt = Math.min(this.cap, dt * (a.running ? a.speed * 120 : this.timeScale));
    if (!(sdt > 0)) return;
    const s = this.sim, t0 = s.t;
    s.advance(sdt);
    if (s.mode === 'AP') this.peakP = Math.max(this.peakP, s.TP);
    if (Math.floor(s.t / 30) !== Math.floor(t0 / 30)) { this.hist.push([s.t, s.TA, s.TP]); if (this.hist.length > 900) this.hist.shift(); }
    a.changed();
  }
  async waitSim(sec) { const T = this.sim.t + sec; while (this.sim.t < T) await this.app.wait(40); }

  /** 由“样品在不在两盘之间”“发热盘放没放下”得出装置状态 */
  syncMode() {
    const s = this.sim;
    s.fc = this.Bon ? overlap(this.eB / 1000, this.geo.RB) : 1;
    const m = !this.Adown ? 'P' : this.Bon ? 'stack' : 'AP';
    if (m !== s.mode) this.setMode(m, true);
  }
  setB(on) {
    if (on === this.Bon) return;
    this.Bon = on;
    if (on) this.eB = (Math.random() < 0.5 ? -1 : 1) * rand(2, 7); // 重新放上去，又不一定放正
    this.syncMode(); this.app.renderInspector(); this.app.changed();
  }
  setA(down) { if (down === this.Adown) return; this.Adown = down; this.syncMode(); this.app.renderInspector(); this.app.changed(); }
  pushB(e) { this.eB = clamp(e, -15, 15); this.syncMode(); }
  get alignText() { const e = Math.abs(this.eB); return !this.Bon ? '样品不在散热盘上' : e < 0.8 ? '三个盘的边缘对齐' : `样品一侧比铜盘边缘多出约 ${e.toFixed(0)} mm`; }
  setMode(m, fromParts = false) {
    const a = this.app, s = this.sim;
    if (!fromParts) { this.Adown = m !== 'P'; if (m !== 'P') this.Bon = m === 'stack'; s.fc = this.Bon ? overlap(this.eB / 1000, this.geo.RB) : 1; }
    if (m === s.mode) return;
    if (m === 'P') { this.coolT0 = s.t; }
    if (m === 'AP') this.peakP = s.TP;
    if (m === 'stack' && s.mode !== 'stack') a.toast('重新叠放后要重新等待稳态', 'warn');
    s.mode = m; a.renderInspector(); a.changed();
  }

  // ======================= 场景 =======================
  cameras() {
    return [
      { name: '全景', pos: [8, 52, 78], target: [-4, 10, 0] },
      { name: '加热装置', pos: [10, 26, 38], target: [0, 14, 0] },
      { name: '温控仪', pos: [-28, 22, 24], target: [-30, 6, -8] },
    ];
  }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 80));
    app.stage.setLightTarget(0, 10, 0);
    const g = new THREE.Group();
    const cu = () => new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.85, roughness: 0.35 });
    const R = this.geo.RP * 100, hp = this.geo.hP * 100, hb = this.geo.hB * 100;
    g.add(mesh(new THREE.BoxGeometry(30, 1.6, 26), MAT.paint(0x3b4652), 0, 0.8, 0));
    for (let k = 0; k < 3; k++) { const a = (k * 2 * Math.PI) / 3 + 0.5; g.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, YP - 1.6, 10), MAT.chrome(), 4.6 * Math.cos(a), 1.6 + (YP - 1.6) / 2, 4.6 * Math.sin(a))); }
    this.P = mesh(new THREE.CylinderGeometry(R, R, hp, 48), cu(), 0, YP + hp / 2, 0); g.add(this.P);
    this.B = mesh(new THREE.CylinderGeometry(R, R, hb, 48), new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.9 }), 0, 0, 0); g.add(this.B);
    const A = (this.A = new THREE.Group());
    A.add(mesh(new THREE.CylinderGeometry(R, R, 1.0, 48), cu(), 0, 0.5, 0));
    A.add(mesh(new THREE.CylinderGeometry(R * 0.92, R, 3.6, 48), MAT.paint(0x9aa3ad), 0, 2.8, 0));
    A.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 14, 10), MAT.chrome(), 0, 11, 0));
    g.add(A);
    // 支架：立柱 + 横臂（A 的拉杆穿过横臂）
    g.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 34, 12), MAT.chrome(), -12, 18.6, -9));
    this.arm = mesh(new THREE.BoxGeometry(13, 1.4, 2), MAT.paint(0x2b333c), -6, 0, -4.5); this.arm.rotation.y = -0.64; g.add(this.arm);
    // 传感器引线
    const wireMat = MAT.paint(0x8b1d1d);
    this.wA = mesh(new THREE.CylinderGeometry(0.18, 0.18, 6, 6), wireMat, R + 2.4, 0, 0); this.wA.rotation.z = Math.PI / 2; g.add(this.wA);
    this.wP = mesh(new THREE.CylinderGeometry(0.18, 0.18, 6, 6), MAT.paint(0x1e3a8a), R + 2.4, YP + hp / 2, 0); this.wP.rotation.z = Math.PI / 2; g.add(this.wP);
    // 温控仪（面板贴图动态更新）
    const cv = (this.pcv = document.createElement('canvas')); cv.width = 512; cv.height = 256;
    this.ptex = new THREE.CanvasTexture(cv); this.ptex.colorSpace = THREE.SRGBColorSpace;
    const box = new THREE.Group();
    box.add(mesh(new THREE.BoxGeometry(24, 11, 16), MAT.paint(0xd4d0c6), 0, 5.5, 0));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(23, 10), new THREE.MeshBasicMaterial({ map: this.ptex })); face.position.set(0, 5.5, 8.02); face.userData.noHL = true; box.add(face);
    box.position.set(-32, 0, -8); box.rotation.y = 0.35; g.add(box);
    // 电子天平
    const bal = new THREE.Group();
    bal.add(mesh(new THREE.BoxGeometry(16, 3, 20), MAT.paint(0xe5e7eb), 0, 1.5, 0));
    bal.add(mesh(new THREE.CylinderGeometry(6, 6, 0.4, 32), MAT.chrome(), 0, 3.2, -2));
    const bc = document.createElement('canvas'); bc.width = 256; bc.height = 64; const b2 = bc.getContext('2d');
    b2.fillStyle = '#0b1410'; b2.fillRect(0, 0, 256, 64); b2.fillStyle = '#7dff9e'; b2.font = 'bold 40px Consolas, monospace'; b2.textAlign = 'right'; b2.fillText(`${(this.geo.mP * 1000).toFixed(2)} g`, 244, 46);
    const bt = new THREE.CanvasTexture(bc); bt.colorSpace = THREE.SRGBColorSpace;
    const bf = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshBasicMaterial({ map: bt })); bf.position.set(0, 1.6, 10.02); bf.userData.noHL = true; bal.add(bf);
    bal.position.set(32, 0, -6); g.add(bal);
    app.addComponent(new Component({
      key: 'rig', name: '导热系数测定仪', zone: 'none', fixed: true, required: true, object: g, labelY: 34,
      icon: SVG('<rect x="16" y="8" width="32" height="6" fill="currentColor"/><rect x="12" y="16" width="40" height="4" fill="none" stroke="currentColor" stroke-width="2"/><rect x="12" y="22" width="40" height="5" fill="currentColor"/><path d="M20 27v9M32 27v9M44 27v9" stroke="currentColor" stroke-width="2"/>'),
      desc: '自上而下：发热盘 A（铜盘，内装电热丝，由温控仪控温）、样品 B（橡胶圆盘）、散热盘 P（紫铜盘，由三根支柱支撑）。A、P 中各埋有铂电阻温度传感器，温度由温控仪显示（分辨率 0.1 °C）。散热盘的质量可用电子天平称出，铜的比热 c = 385 J/(kg·K)。',
      controls: () => [
        { type: 'toggle', label: '加热电源', get: () => this.sim.on, set: (v) => { this.sim.on = v; } },
        { type: 'knob', label: '温控设定', get: () => this.sim.set, set: (v) => (this.sim.set = clamp(v, 30, 95)), min: 30, max: 95, step: 0.1, bigStep: 1, perRev: 10, digits: 1, unit: '°C' },
        { type: 'toggle', label: '样品 B 放在散热盘 P 上', get: () => this.Bon, set: (v) => this.setB(v) },
        ...(this.Bon ? [{ type: 'knob', label: '推动样品 B（左右）', get: () => this.eB, set: (v) => this.pushB(v), step: 0.1, bigStep: 1, perRev: 5, fmt: () => '用手推' }] : []),
        { type: 'readout', label: '侧面看', get: () => this.alignText },
        { type: 'toggle', label: '发热盘 A 放下（压紧）', get: () => this.Adown, set: (v) => this.setA(v) },
        { type: 'readout', label: '电子天平（散热盘 P）', get: () => `${(this.geo.mP * 1000).toFixed(2)} g` },
      ],
    }));
    this.pv = app.addView({ id: 'panel', title: '温控仪与温度记录', w: 330, h: 230, res: 1.6 });
    this.tv = app.addView({ id: 'tool', title: '游标卡尺', w: 330, h: 150, res: 1.8 });
  }

  update() {
    const s = this.sim, hp = this.geo.hP * 100, hb = this.geo.hB * 100, R = this.geo.RP * 100;
    const yTop = YP + hp;
    this.B.position.set(this.Bon ? this.eB / 10 : 24, this.Bon ? yTop + hb / 2 : hb / 2, this.Bon ? 0 : 12);
    const yA = !this.Adown ? yTop + (this.Bon ? hb : 0) + 9 : this.Bon ? yTop + hb : yTop;
    this.A.position.y = yA; this.arm.position.y = yA + 15;
    this.wA.position.y = yA + 0.5;
    this.drawPanel(); this.drawTool();
    const now = performance.now();
    if (!(now - (this._lastFace || 0) < 300)) { this._lastFace = now; this.drawFace(); }
  }
  /** 温控仪前面板（三维模型上的贴图） */
  drawFace() {
    const c = this.pcv.getContext('2d'), s = this.sim;
    c.fillStyle = '#d4d0c6'; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#1f2937'; c.font = 'bold 22px "Microsoft YaHei"'; c.fillText('导热系数测定仪  温控与测温', 18, 34);
    const box = (x, label, val, col) => {
      c.fillStyle = '#0b1410'; c.fillRect(x, 60, 150, 70);
      c.fillStyle = col; c.font = 'bold 44px Consolas, monospace'; c.textAlign = 'right'; c.fillText(val, x + 140, 112); c.textAlign = 'left';
      c.fillStyle = '#374151'; c.font = '18px "Microsoft YaHei"'; c.fillText(label, x + 4, 156);
    };
    box(18, 'T1 发热盘 °C', this.T1.toFixed(1), '#ff7b6b'); box(182, 'T2 散热盘 °C', this.T2.toFixed(1), '#7dd3fc'); box(346, '设定 °C', s.set.toFixed(1), '#fbbf24');
    c.fillStyle = s.on && s.power > 1 ? '#ef4444' : '#52525b'; c.beginPath(); c.arc(40, 208, 10, 0, 7); c.fill();
    c.fillStyle = '#374151'; c.font = '18px "Microsoft YaHei"'; c.fillText(s.on ? '加热' : '加热关', 58, 214);
    this.ptex.needsUpdate = true;
  }
  drawPanel() {
    const v = this.pv, g = v.ctx, W = v.W, H = v.H, s = this.sim;
    g.fillStyle = '#23272b'; g.fillRect(0, 0, W, H);
    const seg = (x, y, w, label, val, col) => {
      g.fillStyle = '#0b1410'; g.fillRect(x, y, w, 40);
      g.fillStyle = col; g.font = 'bold 26px Consolas, monospace'; g.textAlign = 'right'; g.fillText(val, x + w - 30, y + 30);
      g.font = '12px Consolas'; g.fillText('°C', x + w - 6, y + 30);
      g.fillStyle = '#aab2ba'; g.font = '11px "Microsoft YaHei"'; g.textAlign = 'left'; g.fillText(label, x + 2, y - 4);
    };
    seg(10, 18, 100, 'T₁ 发热盘', this.T1.toFixed(1), '#ff7b6b');
    seg(120, 18, 100, 'T₂ 散热盘', this.T2.toFixed(1), '#7dd3fc');
    seg(230, 18, 90, '设定', s.set.toFixed(1), '#fbbf24');
    g.fillStyle = s.on && s.power > 1 ? '#ef4444' : '#3f3f46'; g.beginPath(); g.arc(18, 76, 5, 0, 7); g.fill();
    g.fillStyle = '#aab2ba'; g.font = '11px "Microsoft YaHei"'; g.textAlign = 'left';
    g.fillText(s.on ? `加热 ${Math.round((s.power / s.Pmax) * 100)}%` : '加热关', 28, 80);
    g.fillText(`时钟 ${clock(s.t)}`, 110, 80);
    if (s.mode === 'P' && this.coolT0 != null) { g.fillStyle = '#fbbf24'; g.fillText(`冷却计时 ${clock(s.t - this.coolT0)}`, 216, 80); }
    // 温度记录曲线
    const x0 = 34, y0 = 94, w = W - 44, h = H - 116;
    g.strokeStyle = '#3b4148'; g.lineWidth = 1; g.strokeRect(x0, y0, w, h);
    const span = 7200, tEnd = Math.max(span, s.t), tB = tEnd - span;
    const Tmin = Math.floor(s.Ta / 10) * 10, Tmax = Math.max(Tmin + 40, Math.ceil((Math.max(s.set, ...this.hist.map((p) => p[1])) + 5) / 10) * 10);
    const X = (t) => x0 + ((t - tB) / span) * w, Y = (T) => y0 + h - ((T - Tmin) / (Tmax - Tmin)) * h;
    g.fillStyle = '#7b848d'; g.font = '10px Consolas'; g.textAlign = 'right';
    for (let T = Tmin; T <= Tmax; T += 10) { g.fillText(String(T), x0 - 3, Y(T) + 3); g.strokeStyle = '#2f353b'; g.beginPath(); g.moveTo(x0, Y(T)); g.lineTo(x0 + w, Y(T)); g.stroke(); }
    g.textAlign = 'center';
    for (let m = Math.ceil(tB / 1800) * 30; m * 60 <= tEnd; m += 30) g.fillText(`${m}′`, X(m * 60), y0 + h + 12);
    for (const [k, col] of [[1, '#ff7b6b'], [2, '#7dd3fc']]) {
      g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath(); let st = false;
      for (const p of this.hist) { if (p[0] < tB) continue; const xx = X(p[0]), yy = Y(p[k]); st ? g.lineTo(xx, yy) : g.moveTo(xx, yy); st = true; }
      g.stroke();
    }
    let foot = MODES[s.mode];
    if (s.mode === 'stack' && s.on) { const r = this.rate2(); foot += isFinite(r) ? ` · 散热盘温度变化 ${r >= 0 ? '+' : ''}${r.toFixed(2)} °C/10 min` : ''; }
    v.foot(foot);
  }
  /** 近 10 分钟 T₂ 的变化（按记录曲线） */
  rate2() {
    const h = this.hist, n = h.length;
    if (n < 21) return NaN;
    return h[n - 1][2] - h[n - 21][2];
  }

  setTool(t) {
    this.tool = t;
    const sz = { hB: this.geo.hB * 1000 + this.hBvar[this.hpos], DB: this.geo.RB * 2000, DP: this.geo.RP * 2000, hP: this.geo.hP * 1000 }[t];
    this.cal.setObject(sz);
  }
  drawTool() {
    const v = this.tv;
    this.cal.draw(v.ctx, v.W, v.H, { assist: this.assist });
    const nm = { hB: `样品 B 的厚度（位置 ${this.hpos + 1}）`, DB: '样品 B 的直径', DP: '散热盘 P 的直径', hP: '散热盘 P 的厚度' }[this.tool];
    const p = this.cal.problem();
    v.foot(p ? `${nm} —— ${p}` : nm);
  }
  globalControls() {
    const a = this.app, rer = () => { a.renderInspector(); a.changed(); };
    const out = [
      { type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×10', value: 10 }, { label: '×60', value: 60 }, { label: '×120', value: 120 }] },
      { type: 'segment', label: '卡尺测量', get: () => this.tool, set: (v) => { this.setTool(v); rer(); }, options: [{ label: '样品厚', value: 'hB' }, { label: '样品径', value: 'DB' }, { label: '铜盘径', value: 'DP' }, { label: '铜盘厚', value: 'hP' }] },
    ];
    if (this.tool === 'hB') out.push({ type: 'segment', label: '测量位置', get: () => this.hpos, set: (v) => { this.hpos = v; this.setTool('hB'); rer(); }, options: [0, 1, 2].map((i) => ({ label: `位置 ${i + 1}`, value: i })) });
    out.push(...this.cal.controls(() => a.changed()), { type: 'toggle', label: '读数辅助（卡尺显示读数）', get: () => this.assist, set: (v) => (this.assist = v) });
    return out;
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'geo', title: '样品与散热盘', fixedRows: true,
        initRows: () => GEO.map(([k, what]) => ({ k, what })),
        columns: [{ key: 'what', label: '待测量', type: 'text', readonly: true }, { key: 'v', label: '测量值', digits: 2, readTol: 0.021 }],
        buttons: [{ label: '记录卡尺读数', onClick: (t) => this.recGeo(t) }, { label: '记录天平示数', onClick: (t) => t.set(t.rows.findIndex((r) => r.k === 'm'), 'v', Math.round(this.geo.mP * 1e5) / 100) }],
        note: '样品厚度在不同位置测 3 次取平均。铜的比热 c = 385 J/(kg·K)。',
      },
      {
        id: 'heat', title: '加热过程（判断稳态）',
        columns: [{ key: 't', label: '时间/min', digits: 1, auto: true }, { key: 'T1', label: 'T₁/°C', digits: 1, readTol: 0.06 }, { key: 'T2', label: 'T₂/°C', digits: 1, readTol: 0.06 }],
        buttons: [{ label: '记录 T₁、T₂', onClick: (t) => this.recHeat(t) }],
        note: '每隔约 10 分钟记一次。连续 3 次（20 分钟内）T₁、T₂ 都不变（变化不超过 0.1 °C），即达到稳态，最后一组即为稳态温度。',
      },
      {
        id: 'cool', title: '散热盘的冷却过程',
        columns: [{ key: 't', label: '冷却时间/s', digits: 0, auto: true }, { key: 'T', label: 'T/°C', digits: 1, readTol: 0.06 }],
        buttons: [{ label: '记录散热盘温度', onClick: (t) => this.recCool(t) }],
        note: '移去发热盘后开始计时，每 30 s 记一次散热盘温度，从比 T₂ 高约 8 °C 记到比 T₂ 低约 8 °C。',
      },
    ];
  }
  recGeo(t) {
    const a = this.app, p = this.cal.problem();
    if (p) a.toast(p, 'warn');
    const k = this.tool === 'hB' ? `hB${this.hpos + 1}` : this.tool;
    t.set(t.rows.findIndex((r) => r.k === k), 'v', Math.round(this.cal.reading / 0.02) * 0.02);
  }
  recHeat(t) {
    const a = this.app, s = this.sim;
    if (!s.on) a.toast('加热电源没有打开', 'warn');
    if (s.mode !== 'stack') a.toast('现在不是 A-B-P 叠放的状态，这一组不是稳态加热的数据', 'warn');
    else if (Math.abs(this.eB) > 1.5) a.toast(`样品 B 没有和铜盘对正（错开约 ${Math.abs(this.eB).toFixed(0)} mm），接触面积变小`, 'warn');
    t.addRow({ t: Math.round(s.t / 6) / 10, T1: this.T1, T2: this.T2 });
  }
  recCool(t) {
    const a = this.app, s = this.sim;
    if (s.mode !== 'P') return a.toast('先抬起发热盘 A，让散热盘在空气中自然冷却，再开始记录', 'warn');
    if (this.Bon) a.toast('样品 B 还压在散热盘上，散热盘上表面被盖住，冷却比稳态时慢', 'warn');
    t.addRow({ t: Math.round(s.t - this.coolT0), T: this.T2 });
  }

  /** 加热表中最后 3 组是否已稳定 */
  steady() {
    const r = this.app.table('heat').rows.filter((x) => isFinite(x.T1) && isFinite(x.T2) && x.T1 !== '' && x.T2 !== '');
    if (r.length < 3) return null;
    const L = r.slice(-3), sp = (k) => Math.max(...L.map((x) => +x[k])) - Math.min(...L.map((x) => +x[k]));
    return { ok: sp('T2') <= 0.1 + 1e-9 && sp('T1') <= 0.2 + 1e-9 && L[2].t - L[0].t >= 15, T1: mean(L.map((x) => +x.T1)), T2: mean(L.map((x) => +x.T2)), span: L[2].t - L[0].t };
  }

  // ======================= 自动操作 =======================
  async knob(get, set, to, ms = 400) { await this.app.tween(get, set, to, ms); set(to); this.app.changed(); }
  steps() {
    const app = this.app, s = this.sim;
    const filled = (id, k) => app.table(id).rows.filter((r) => r[k] != null && r[k] !== '' && isFinite(r[k])).length;
    return [
      {
        title: '测量样品和散热盘',
        html: '<p>用游标卡尺测样品 B 的厚度（不同位置测 3 次）和直径，散热盘 P 的直径和厚度；用电子天平称散热盘的质量。</p>',
        check: () => filled('geo', 'v') >= GEO.length,
        auto: async () => {
          app.showTable(0); app.select(app.comp('rig'));
          for (const [k, , tool] of GEO) {
            if (tool === 'm') { await app.record('geo', 1); continue; }
            if (tool === 'hB') this.hpos = +k[2] - 1;
            this.setTool(tool); app.renderInspector();
            const sz = this.cal.obj; this.cal.open = sz + 4;
            await this.knob(() => this.cal.open, (v) => this.cal.push(v), sz - 0.5, 300);
            await app.record('geo', 0);
          }
        },
      },
      {
        title: '加热，等待稳态',
        html: '<p>样品夹在发热盘和散热盘之间，三者要贴紧、边缘对齐（放偏了接触面积变小，测出的导热系数偏小）。打开加热电源，温控设定 70–80 °C。发热盘很快升到设定温度，散热盘则要几十分钟才稳定（可加快时间流速）。每隔约 10 分钟记一次 T₁、T₂，直到连续 3 次不变。</p>',
        hint: '稳态时，样品传给散热盘的热量恰好等于散热盘向空气散失的热量。',
        check: () => { const st = this.steady(); return !!(st && st.ok); },
        auto: async () => {
          await app.view('温控仪'); app.showTable(1); app.select(app.comp('rig'));
          this.setMode('stack'); await this.knob(() => this.eB, (v) => this.pushB(v), 0, 400); s.on = true; await this.knob(() => s.set, (v) => (s.set = v), 75, 500);
          this.cap = 120;
          for (let i = 0; i < 30; i++) {
            await this.waitSim(600); await app.record('heat', 0);
            const st = this.steady(); if (st && st.ok) break;
          }
        },
      },
      {
        title: '移去样品，加热散热盘',
        html: '<p>记下稳态温度 T₁、T₂ 后，抽出样品 B，让发热盘 A 直接压在散热盘 P 上加热，使 P 的温度升到比 T₂ 高 8–10 °C。</p>',
        check: () => s.mode !== 'stack' && this.steady() && this.peakP >= this.steady().T2 + 6,
        auto: async () => {
          await app.view('加热装置'); this.setMode('AP');
          const T2 = this.steady().T2;
          while (s.TP < T2 + 9) await app.wait(40);
        },
      },
      {
        title: '散热盘自然冷却，记录冷却曲线',
        html: '<p>抬起发热盘 A（关掉加热），让散热盘在空气中自然冷却，同时开始计时。每隔 30 s 记一次散热盘温度，直到比 T₂ 低约 8 °C。</p>',
        hint: '冷却过程中不要让风吹到散热盘，也不要用手碰它。',
        check: () => { const st = this.steady(), r = app.table('cool').rows.map((x) => +x.T).filter(isFinite); return !!st && r.length >= 8 && Math.max(...r) >= st.T2 + 3 && Math.min(...r) <= st.T2 - 3; },
        auto: async () => {
          app.showTable(2); s.on = false; this.setMode('P'); this.cap = 5;
          const T2 = this.steady().T2;
          await app.record('cool', 0);
          for (let i = 0; i < 80 && s.TP > T2 - 8; i++) { await this.waitSim(30 - ((s.t - this.coolT0) % 30)); await app.record('cool', 0); }
          this.cap = 120;
        },
      },
      {
        title: '数据处理',
        html: '<p>作冷却曲线，求 T = T₂ 处的冷却速率，代入公式算出导热系数。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, gv = Object.fromEntries(a.table('geo').rows.map((r) => [r.k, r.v === '' || r.v == null ? NaN : +r.v]));
    const st = this.steady();
    if (!GEO.every(([k]) => gv[k] > 0)) return { html: '<p>请先测量样品和散热盘的尺寸、质量。</p>', ok: false };
    if (!st) return { html: '<p>请先记录加热过程，直到稳态。</p>', ok: false };
    const cool = a.table('cool').rows.filter((r) => isFinite(r.t) && isFinite(r.T) && r.T !== '' && r.T != null).map((r) => [+r.t, +r.T]);
    const near = cool.filter(([, T]) => Math.abs(T - st.T2) <= 5);
    if (near.length < 5 || !cool.some(([, T]) => T > st.T2) || !cool.some(([, T]) => T < st.T2)) return { html: '<p>冷却数据不够：要有 T₂ 上下各几个温度点。</p>', ok: false };
    // 二次多项式拟合 T(t)，求 T = T₂ 时的斜率
    const tm = mean(near.map((p) => p[0]));
    const X = near.map((p) => p[0] - tm), Yv = near.map((p) => p[1]);
    const S = (f) => X.reduce((s, x, i) => s + f(x, Yv[i]), 0);
    const M = [[near.length, S((x) => x), S((x) => x * x)], [S((x) => x), S((x) => x * x), S((x) => x ** 3)], [S((x) => x * x), S((x) => x ** 3), S((x) => x ** 4)]];
    const bv = [S((x, y) => y), S((x, y) => x * y), S((x, y) => x * x * y)];
    const [c0, c1, c2] = solve3(M, bv);
    let tx = 0; for (let i = 0; i < 30; i++) tx -= (c0 + c1 * tx + c2 * tx * tx - st.T2) / (c1 + 2 * c2 * tx);
    const rate = -(c1 + 2 * c2 * tx); // K/s
    const res = Math.sqrt(S((x, y) => (y - c0 - c1 * x - c2 * x * x) ** 2) / Math.max(1, near.length - 3));
    const hB = mean([gv.hB1, gv.hB2, gv.hB3]) / 1000, RB = gv.DB / 2000, RP = gv.DP / 2000, hP = gv.hP / 1000, m = gv.m / 1000;
    const lam = leeLambda({ m, c: C_CU, rate, RP, hP, hB, RB, T1: st.T1, T2: st.T2 });
    const sx = Math.sqrt(S((x) => x * x) / near.length) * Math.sqrt(near.length);
    const uRate = res / sx; // 斜率的标准误差（近似）
    const rel = Math.hypot(uRate / rate, stdev([gv.hB1, gv.hB2, gv.hB3]) / Math.sqrt(3) / (hB * 1000) + 0.02 / Math.sqrt(3) / (hB * 1000), (2 * 0.02) / Math.sqrt(3) / (RB * 2000), Math.SQRT2 * 0.06 / (st.T1 - st.T2));
    const f4 = (x) => x.toFixed(4);
    let html = `<h3>1. 稳态温度</h3><p>加热表最后 3 组（${st.span.toFixed(0)} min 内）的平均：$T_1=${st.T1.toFixed(2)}$ °C，$T_2=${st.T2.toFixed(2)}$ °C，$T_1-T_2=${(st.T1 - st.T2).toFixed(2)}$ °C。${st.ok ? '' : '<b>这 3 组还在变化，可能没有达到稳态。</b>'}</p>
      <h3>2. 冷却速率</h3><p>取 T₂ ± 5 °C 内的 ${near.length} 个点，拟合 $T=a+b\\tau+c\\tau^2$（$\\tau$ 从 ${tm.toFixed(0)} s 起算）：$b=${(c1 * 60).toFixed(4)}$ °C/min，$c=${(c2 * 3600).toFixed(5)}$ °C/min²。T = T₂ 时 $\\tau=${tx.toFixed(0)}$ s，冷却速率</p>
      $$\\left.\\frac{\\mathrm dT}{\\mathrm dt}\\right|_{T_2}=${(rate * 60).toFixed(4)}\\ ^\\circ\\mathrm C/\\mathrm{min}=${(rate * 100).toFixed(3)}\\times10^{-2}\\ \\mathrm K/\\mathrm s$$
      <h3>3. 导热系数</h3><p>$h_B=${(hB * 1000).toFixed(3)}$ mm，$R_B=${(RB * 1000).toFixed(2)}$ mm，$R_P=${(RP * 1000).toFixed(2)}$ mm，$h_P=${(hP * 1000).toFixed(2)}$ mm，$m=${(m * 1000).toFixed(2)}$ g；散热面积修正因子 $\\dfrac{R_P+2h_P}{2R_P+2h_P}=${((RP + 2 * hP) / (2 * RP + 2 * hP)).toFixed(4)}$。</p>
      $$\\lambda=mc\\left.\\frac{\\mathrm dT}{\\mathrm dt}\\right|_{T_2}\\frac{R_P+2h_P}{2R_P+2h_P}\\cdot\\frac{h_B}{\\pi R_B^2(T_1-T_2)}=${f4(lam)}\\ \\mathrm{W/(m\\cdot K)}$$
      <div class="result-box">$\\lambda=${fmtU(lam, lam * rel)}$ W/(m·K)（相对不确定度约 ${pct(rel, 1)}）</div>
      <div class="result-box warn">样品导热系数的参考值 ${f4(this.lam)} W/(m·K)，相对误差 ${pct(relErr(lam, this.lam), 2)}。</div>
      <p>主要系统误差：① 散热盘上、下表面和侧面的散热系数并不相同（热面朝上时对流更强），面积比修正只是近似；② 样品与铜盘之间的接触热阻使测得的 T₁ − T₂ 偏大、λ 偏小；③ 温度传感器埋在铜盘内，测的不是样品表面温度。</p>`;
    const plots = [
      { title: '加热过程', xLabel: 't / min', yLabel: 'T / °C', series: [{ type: 'line', data: a.table('heat').rows.map((r) => [+r.t, +r.T1]), label: 'T₁' }, { type: 'line', data: a.table('heat').rows.map((r) => [+r.t, +r.T2]), label: 'T₂' }] },
      { title: '冷却曲线与 T₂ 处的切线', xLabel: 't / s', yLabel: 'T / °C', series: [{ type: 'scatter', data: cool }, { type: 'line', data: [[tm + tx - 150, st.T2 + rate * 150], [tm + tx + 150, st.T2 - rate * 150]], dash: [5, 4] }] },
    ];
    return { html, ok: true, answers: [{ label: '$\\lambda$', unit: 'W/(m·K)', value: lam, digits: 4, tolRel: 0.01 }], plots };
  }

  principle() {
    return `<h3>1. 傅里叶定律</h3>${leeFig()}<p>热量沿 $x$ 方向通过面积 $S$ 的传导速率 $\\dfrac{\\mathrm dQ}{\\mathrm dt}=-\\lambda S\\dfrac{\\mathrm dT}{\\mathrm dx}$，比例系数 $\\lambda$ 即导热系数。对厚 $h_B$、半径 $R_B$ 的圆盘样品，两面温度分别为 $T_1$、$T_2$ 时 $\\dfrac{\\mathrm dQ}{\\mathrm dt}=\\lambda\\dfrac{T_1-T_2}{h_B}\\pi R_B^2$。</p>
<h3>2. 稳态法</h3><p>发热盘 A 维持恒温，热量经样品 B 传给散热盘 P，P 向周围空气散热。达到稳态时，样品传入 P 的热流等于 P 在温度 $T_2$ 下的散热速率。后者用比较法测：移去样品，把 P 加热到 $T_2$ 以上，让它自然冷却，测出 $T_2$ 处的冷却速率 $\\left.\\dfrac{\\mathrm dT}{\\mathrm dt}\\right|_{T_2}$，散热速率为 $mc\\left.\\dfrac{\\mathrm dT}{\\mathrm dt}\\right|_{T_2}$。</p>
<h3>3. 散热面积修正</h3><p>稳态时 P 的上表面被样品盖住，只有下表面和侧面散热（面积 $\\pi R_P^2+2\\pi R_Ph_P$）；冷却时上表面也暴露（面积 $2\\pi R_P^2+2\\pi R_Ph_P$）。设散热速率与面积成正比，于是</p>$$\\lambda=mc\\left.\\frac{\\mathrm dT}{\\mathrm dt}\\right|_{T_2}\\frac{R_P+2h_P}{2R_P+2h_P}\\cdot\\frac{h_B}{\\pi R_B^2(T_1-T_2)}$$
<h3>4. 本仿真的计算模型</h3><p>样品沿厚度分成 8 层，按一维热传导方程逐层计算（计入样品热容，所以散热盘要几十分钟才稳定）；发热盘由 PI 温控器控温；铜盘与样品之间有接触热阻；散热盘的散热按自然对流（热面朝上、朝下和侧面的系数不同）加辐射计算，散热系数随温差变化。所以冷却曲线不是严格的指数曲线，也不是直线。</p>`;
  }
}

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < 3; r++) { if (r === i) continue; const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((r, i) => r[3] / r[i]);
}
