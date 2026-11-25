// 实验：光纤的传输特性
// He-Ne 激光（632.8 nm，光束半径 0.5 mm）经 10× 显微物镜（f = 16 mm，透过率 0.95）会聚，束腰约 6.4 μm；
// 光纤为 50/125 μm 阶跃折射率多模光纤，入射端装在三维微调架上（x、y 分度 0.5 μm，z 分度 5 μm）。
// 耦合份额由光斑与纤芯的交叠积分算出（physics/fiber.js），端面反射与切割质量合计个体随机（0.78–0.90）。
// 光纤盘长 1.000 km，损耗系数个体随机（4.5–7 dB/km，标称值印在盘上）；截断后保留入射端约 2 m。
// 远场：观察屏在小导轨上移动，光纤出射端在导轨上的位置（零点）未知，用光斑直径随距离的变化率求 NA。
import * as THREE from 'three';
import { meta, thumb } from './fiber.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, gauss, clamp, relErr, pct, linFit } from '../core/Stats.js';
import { coupleFraction, farField, spotDiameter, bendLoss } from '../physics/fiber.js';

const SPOT = { w0: 6.4, zR: 203, a: 25 }; // μm
const TOBJ = 0.95, LKM = 1.0, NTURN = 10;
const RS = [3, 4, 5, 6, 8, 10];
const SCR = 25; // 观察屏半宽（mm）

export class FiberExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.P0 = rand(0.9, 1.1); // mW
    this.Q = rand(0.78, 0.9); this.alpha = rand(4.5, 7); this.Lt = LKM * (1 + gauss(0.002));
    this.NA = rand(0.2, 0.22); this.s0 = rand(2, 5); this.A = rand(6, 10); this.R0 = rand(1.8, 2.2);
    const sg = () => (Math.random() < 0.5 ? -1 : 1);
    this.x = Math.round(sg() * rand(12, 20) * 2) / 2; this.y = Math.round(sg() * rand(12, 20) * 2) / 2; this.z = Math.round(rand(400, 700) / 5) * 5;
    this.probe = 'in'; this.out = 'meter'; this.cut = false; this.R = 0; this.s = 30;
    this._fk = ''; this._f = 0;
  }
  frac() { const k = `${this.x},${this.y},${this.z}`; if (k !== this._fk) { this._fk = k; this._f = coupleFraction(this.x, this.y, this.z, SPOT); } return this._f; }
  /** 光纤输出端的功率（mW），不管探头在哪 */
  Pout() {
    const L = this.cut ? 0.002 : this.Lt, tb = this.R ? 10 ** (-(NTURN * bendLoss(this.R, this.A, this.R0)) / 10) : 1;
    return this.P0 * TOBJ * this.Q * this.frac() * 10 ** (-(this.alpha * L) / 10) * tb;
  }
  /** 功率计读数（μW），null 表示探头没有接收光 */
  meter() { if (this.probe === 'in') return this.P0 * 1000; return this.out === 'meter' ? this.Pout() * 1000 : null; }
  fmtP(p) { return p >= 100 ? p.toFixed(1) : p >= 10 ? p.toFixed(2) : p >= 1 ? p.toFixed(3) : p.toFixed(4); }
  readP() { const p = this.meter(); return p == null ? null : +this.fmtP(p); }
  D() { return spotDiameter(this.s - this.s0, this.NA, 0.05); }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 56, 84], target: [0, 8, -4] }, { name: '耦合', pos: [-32, 24, 26], target: [-32, 10, 0] }, { name: '输出端', pos: [36, 26, 30], target: [36, 8, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 86));
    app.stage.setLightTarget(0, 6, 0);
    const Y = 10;
    // 激光器、物镜、微调架
    const laser = mesh(new THREE.CylinderGeometry(2, 2, 24, 24), MAT.paint(0x8b1e1e), -58, Y, 0); laser.rotation.z = Math.PI / 2; scene.add(laser);
    scene.add(mesh(new THREE.BoxGeometry(4, Y - 2, 4), MAT.paint(0x3a3f44), -58, (Y - 2) / 2, 0));
    const beam = mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 6), MAT.emissive(0xff2a2a, 1.6), -40, Y, 0); beam.rotation.z = Math.PI / 2; scene.add(beam);
    const obj = mesh(new THREE.CylinderGeometry(1.4, 1.8, 5, 24), MAT.chrome(), -32, Y, 0); obj.rotation.z = Math.PI / 2; scene.add(obj);
    scene.add(mesh(new THREE.BoxGeometry(5, Y - 2, 5), MAT.paint(0x3a3f44), -32, (Y - 2) / 2, 0));
    this.stage = new THREE.Group(); scene.add(this.stage);
    this.stage.add(mesh(new THREE.BoxGeometry(8, 6, 8), MAT.paint(0x2b3440), 0, 3, 0));
    for (const [x, z] of [[4.2, 0], [0, 4.2]]) this.stage.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 16), MAT.chrome(), x, 4, z).rotateZ(x ? Math.PI / 2 : 0).rotateX(z ? Math.PI / 2 : 0));
    this.stage.add(mesh(new THREE.BoxGeometry(3, 2.4, 2), MAT.paint(0x56606c), 0, Y - 0.6, 0));
    this.stage.position.set(-25, 0, 0);
    this.glowIn = mesh(new THREE.SphereGeometry(0.5, 12, 8), MAT.emissive(0xff3030, 0), -26.5, Y, 0); scene.add(this.glowIn);
    // 光纤盘与光纤
    this.reel = new THREE.Group(); this.reel.position.set(0, 0, -12); scene.add(this.reel);
    this.reel.add(mesh(new THREE.CylinderGeometry(9, 9, 5, 40), MAT.paint(0xd9d4c5), 0, 2.5, 0));
    this.reel.add(mesh(new THREE.CylinderGeometry(9.6, 9.6, 0.4, 40), MAT.paint(0x2f4f5f), 0, 5.2, 0));
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const c = cv.getContext('2d'); c.fillStyle = '#2f4f5f'; c.fillRect(0, 0, 256, 64); c.fillStyle = '#e8e2d0'; c.font = 'bold 22px "Microsoft YaHei"'; c.fillText(`50/125 多模  1.00 km`, 10, 26); c.fillText(`标称 ${this.alpha.toFixed(2)} dB/km  NA ${this.NA.toFixed(3)}`, 10, 54);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: tex })); lab.rotation.x = -Math.PI / 2; lab.position.y = 5.45; this.reel.add(lab);
    const jacket = MAT.paint(0xe0a526);
    const tube = (pts) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 48, 0.22, 6), jacket);
    this.fibIn = tube([[-24, Y, 0], [-18, Y, 0], [-10, 5, -4], [-8, 3, -10]]); scene.add(this.fibIn);
    this.fibOut = tube([[8, 3, -10], [14, 5, -4], [22, Y, 0], [28, Y, 0]]); scene.add(this.fibOut);
    this.fibShort = tube([[-24, Y, 0], [-14, Y, 0], [0, 6, 6], [16, 6, 6], [22, Y, 0], [28, Y, 0]]); this.fibShort.visible = false; scene.add(this.fibShort);
    this.mandrel = mesh(new THREE.CylinderGeometry(1, 1, 4, 24), MAT.alu(), 8, 3, 6); scene.add(this.mandrel);
    this.coil = mesh(new THREE.TorusGeometry(1.2, 0.25, 8, 32), jacket, 8, 3.5, 6); this.coil.rotation.x = Math.PI / 2; scene.add(this.coil);
    app.addComponent(new Component({
      key: 'couple', name: '物镜与光纤微调架', zone: 'none', fixed: true, required: true, object: this.stage, labelY: 14,
      icon: '<svg viewBox="0 0 64 40"><path d="M4 20h18" stroke="#c0392b" stroke-width="2"/><path d="M22 12v16l10-8z" fill="currentColor"/><path d="M34 20h26" stroke="currentColor" stroke-width="3"/></svg>',
      desc: '10× 显微物镜把激光会聚到光纤入射端面上。光纤端面装在三维微调架上：x、y（垂直光轴）千分尺分度 0.5 μm，z（沿光轴）分度 5 μm。先粗调使出射端有红光，再交替微调 x、y、z 使输出功率最大。',
      controls: () => [
        { type: 'knob', label: 'x 方向', get: () => this.x, set: (v) => { this.x = Math.round(clamp(v, -60, 60) * 2) / 2; app.changed(); }, min: -60, max: 60, step: 0.5, bigStep: 5, perRev: 10, digits: 1, unit: 'μm' },
        { type: 'knob', label: 'y 方向', get: () => this.y, set: (v) => { this.y = Math.round(clamp(v, -60, 60) * 2) / 2; app.changed(); }, min: -60, max: 60, step: 0.5, bigStep: 5, perRev: 10, digits: 1, unit: 'μm' },
        { type: 'knob', label: 'z 方向（离焦）', get: () => this.z, set: (v) => { this.z = Math.round(clamp(v, -1500, 1500) / 5) * 5; app.changed(); }, min: -1500, max: 1500, step: 5, bigStep: 50, perRev: 250, digits: 0, unit: 'μm' },
      ],
    }));
    app.addComponent(new Component({
      key: 'reel', name: '光纤盘', zone: 'none', fixed: true, object: this.reel, labelY: 10,
      desc: `50/125 μm 阶跃折射率多模光纤，长 ${LKM.toFixed(3)} km。盘上印有出厂标称的损耗系数和数值孔径。截断法测损耗时，在入射端约 2 m 处剪断光纤（剪断后光纤盘就不能再用了），重新切平端面后放到功率计上。绕棒：把剩下的短光纤在半径 R 的金属棒上绕 ${NTURN} 圈，观察弯曲损耗。`,
      controls: () => [
        { type: 'button', label: this.cut ? '已截断（保留 2 m）' : '在入射端 2 m 处截断', onClick: () => { if (this.cut) return; this.cut = true; app.renderInspector(); app.changed(); } },
        { type: 'segment', label: `绕棒（${NTURN} 圈）`, options: [{ value: 0, label: '不绕' }, ...RS.map((r) => ({ value: r, label: `R ${r}` }))], get: () => this.R, set: (v) => { if (v && !this.cut) { app.toast('先截断光纤，在短光纤上做弯曲实验', 'warn'); app.renderInspector(); return; } this.R = v; app.changed(); } },
      ],
    }));
    // 输出端：功率计 / 观察屏
    this.outG = new THREE.Group(); this.outG.position.set(28, 0, 0); scene.add(this.outG);
    this.outG.add(mesh(new THREE.BoxGeometry(3, Y - 2, 3), MAT.paint(0x3a3f44), 0, (Y - 2) / 2, 0));
    this.outG.add(mesh(new THREE.BoxGeometry(60, 1, 5), MAT.alu(), 24, 0.5, 0));
    this.probeM = mesh(new THREE.CylinderGeometry(2, 2, 3, 24), MAT.paint(0x1f2937), 6, Y, 0); this.probeM.rotation.z = Math.PI / 2; this.outG.add(this.probeM);
    this.screen = new THREE.Group(); this.outG.add(this.screen);
    this.screen.add(mesh(new THREE.BoxGeometry(0.4, 16, 16), MAT.white(), 0, Y, 0));
    this.screen.add(mesh(new THREE.BoxGeometry(2, Y - 8, 3), MAT.paint(0x3a3f44), 0, 1, 0));
    this.cone = mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }), 0, Y, 0); this.cone.rotation.z = Math.PI / 2; this.outG.add(this.cone);
    const pm = (this.pBox = meterBox(18, 9, 10, '光功率计')); pm.group.position.set(44, 0, -18); scene.add(pm.group);
    app.addComponent(new Component({
      key: 'meter', name: '光功率计与观察屏', zone: 'none', fixed: true, object: pm.group, labelY: 12,
      desc: '光功率计（632.8 nm 定标，自动量程，4 位有效数字）。探头可以放在物镜前测入射光功率，也可以放在光纤出射端。出射端也可以换成带毫米坐标的观察屏，观察屏在小导轨上移动，读数为屏在导轨上的位置。',
      controls: () => [
        { type: 'segment', label: '功率计探头', options: [{ value: 'in', label: '物镜前（测入射光）' }, { value: 'out', label: '光纤出射端' }], get: () => this.probe, set: (v) => { this.probe = v; app.changed(); } },
        { type: 'segment', label: '出射端放', options: [{ value: 'meter', label: '功率计探头' }, { value: 'screen', label: '观察屏' }], get: () => this.out, set: (v) => { this.out = v; app.changed(); } },
        { type: 'knob', label: '观察屏位置', get: () => this.s, set: (v) => { this.s = Math.round(clamp(v, 15, 90) * 2) / 2; app.changed(); }, min: 15, max: 90, step: 0.5, bigStep: 5, perRev: 20, digits: 1, unit: 'mm' },
        { type: 'readout', label: '功率计', get: () => { const p = this.readP(); return p == null ? '探头没有接收到光' : `${this.fmtP(p)} μW`; } },
      ],
    }));
    this.view = app.addView({ id: 'scr', title: '观察屏（毫米坐标）', w: 240, h: 240, res: 1.6 });
  }
  update() {
    const p = this.readP(), sP = p == null ? '----' : this.fmtP(p);
    if (sP !== this._sP) { this._sP = sP; this.pBox.setText(sP, p == null ? '' : 'μW', '632.8 nm'); }
    const cut = this.cut;
    this.fibIn.visible = this.fibOut.visible = !cut; this.fibShort.visible = cut; this.reel.visible = !cut;
    this.mandrel.visible = cut; this.coil.visible = cut && this.R > 0; if (this.R) this.coil.scale.setScalar(this.R / 5);
    this.glowIn.material.emissiveIntensity = 2.5 * this.frac();
    this.stage.position.set(-25 + this.z / 2000, 0, this.x / 50);
    const scr = this.out === 'screen';
    this.probeM.position.set(this.probe === 'out' && !scr ? 2 : -1000, 10, 0); this.screen.visible = scr; this.screen.position.x = scr ? (this.s - this.s0) * 0.4 + 2 : 0;
    const r = this.D() / 2;
    this.cone.visible = scr && this.Pout() > 1e-5; this.cone.scale.set(r * 0.4 * 2, (this.s - this.s0) * 0.4, r * 0.4 * 2); this.cone.position.x = ((this.s - this.s0) * 0.4) / 2 + 0.2; this.cone.rotation.z = Math.PI / 2;
    this.draw();
  }
  draw() {
    const v = this.view, g = v.ctx, W = v.W, H = v.H, cx = W / 2, cy = H / 2, k = (W * 0.47) / SCR;
    g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, W, H);
    if (this.out === 'screen') {
      const P = this.Pout(), z = this.s - this.s0, R = (SCR + 2) * k, img = g.createImageData ? null : null;
      if (P > 1e-6) {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R), b = Math.min(1, P * 6);
        for (let i = 0; i <= 24; i++) { const rr = (i / 24) * (SCR + 2), th = Math.atan(rr / z), I = farField(th, this.NA) * b; gr.addColorStop(i / 24, `rgba(225,30,30,${(I * 0.95).toFixed(3)})`); }
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
      }
    }
    g.strokeStyle = 'rgba(40,50,60,.35)'; g.lineWidth = 1;
    for (let m = -SCR; m <= SCR; m += 5) { g.beginPath(); g.moveTo(cx + m * k, cy - SCR * k); g.lineTo(cx + m * k, cy + SCR * k); g.moveTo(cx - SCR * k, cy + m * k); g.lineTo(cx + SCR * k, cy + m * k); g.stroke(); }
    g.strokeStyle = 'rgba(40,50,60,.7)';
    for (let m = -SCR; m <= SCR; m++) { const t = m % 5 === 0 ? 5 : 2.5; g.beginPath(); g.moveTo(cx + m * k, cy - t); g.lineTo(cx + m * k, cy + t); g.moveTo(cx - t, cy + m * k); g.lineTo(cx + t, cy + m * k); g.stroke(); }
    g.fillStyle = '#3a4550'; g.font = `${H * 0.045}px Consolas, monospace`; g.textAlign = 'center';
    for (let m = -20; m <= 20; m += 10) if (m) g.fillText(String(m), cx + m * k, cy + H * 0.06);
    v.foot(this.out === 'screen' ? `屏在导轨 ${this.s.toFixed(1)} mm 处` : '出射端放的是功率计探头，屏上没有光');
  }

  // ======================= 数据表 =======================
  tables() {
    const pt = (r) => 0.003 * r + 0.001;
    return [
      {
        id: 'pw', title: '耦合效率与截断法', fixedRows: true,
        initRows: () => [{ what: '入射光功率 P₀（物镜前）' }, { what: '1 km 光纤输出 P₂' }, { what: '截断后 2 m 光纤输出 P₁' }],
        columns: [{ key: 'what', label: '测量', type: 'text', readonly: true }, { key: 'P', label: 'P/μW', readTol: pt }],
        buttons: [{ label: '记录功率计读数', onClick: (t) => this.recP(t) }],
        note: '先测物镜前的入射光功率；耦合调好后测 1 km 光纤的输出；保持入射端不动，截断光纤，测 2 m 短光纤的输出。',
      },
      {
        id: 'na', title: '远场光斑直径', maxRows: 10,
        columns: [{ key: 's', label: '屏位置 s/mm', digits: 1, auto: true }, { key: 'D', label: '光斑直径 D/mm', digits: 1, readTol: 0.8 }],
        buttons: [{ label: '记录', onClick: (t) => this.recNA(t) }],
        note: '出射端换上观察屏，屏在导轨上取几个位置，读出红色光斑的直径（以光斑边缘刚能看到红光处为准）。',
      },
      {
        id: 'bend', title: `弯曲损耗（绕 ${NTURN} 圈）`, maxRows: 8,
        columns: [{ key: 'R', label: '绕棒半径 R/mm', type: 'text', auto: true }, { key: 'P', label: 'P/μW', readTol: pt }],
        buttons: [{ label: '记录', onClick: (t) => this.recB(t) }],
        note: '在截断后的短光纤上做：先记不绕时的输出功率，再依次在不同半径的棒上绕 10 圈。',
      },
    ];
  }
  recP(t) {
    const a = this.app, p = this.readP();
    if (p == null) return a.toast('功率计探头没有接收到光（出射端放的是观察屏）', 'warn');
    if (this.R) return a.toast('光纤还绕在棒上，先取下', 'warn');
    let i;
    if (this.probe === 'in') i = 0;
    else if (!this.cut) {
      i = 1;
      if (this.frac() < 0.9) return a.toast('耦合还没有调好：继续微调 x、y、z 使输出功率最大', 'warn');
      this._key = this._fk;
    } else {
      i = 2;
      if (this._key && this._key !== this._fk) return a.toast('截断前后入射端的耦合状态必须保持不变：微调架已经动过了', 'warn');
    }
    t.set(i, 'P', p);
  }
  recNA(t) {
    const a = this.app;
    if (this.out !== 'screen') return a.toast('出射端放的不是观察屏', 'warn');
    if (this.Pout() < 1e-4) return a.toast('屏上光太弱，先把耦合调好', 'warn');
    if (this.D() > 2 * SCR) return a.toast('光斑超出了屏的坐标范围，把屏移近一些', 'warn');
    if (t.rows.some((r) => Math.abs(r.s - this.s) < 0.25)) return a.toast('这个位置已经测过了', 'warn');
    t.addRow({ s: this.s, D: Math.round(this.D() * 2) / 2 });
  }
  recB(t) {
    const a = this.app, p = this.readP();
    if (!this.cut) return a.toast('先截断光纤，在短光纤上做弯曲实验', 'warn');
    if (p == null || this.probe !== 'out') return a.toast('功率计探头要放在光纤出射端', 'warn');
    const R = this.R ? this.R.toFixed(1) : '不绕';
    if (t.rows.some((r) => r.R === R)) return a.toast('这个半径已经测过了', 'warn');
    if (t.rows.length && t.rows[0]._key !== this._fk) return a.toast('入射端耦合和第一行时不同：弯曲损耗要在耦合不变的条件下比较', 'warn');
    t.addRow({ R, P: p, _R: this.R, _key: this._fk });
  }

  // ======================= 自动操作 =======================
  async seg(comp, key, v) { const a = this.app; a.select(a.comp(comp)); this[key] = v; a.renderInspector(); a.changed(); await a.wait(150); }
  async adj(comp, key, to, ms = 300) { const a = this.app; a.select(a.comp(comp)); await a.tween(() => this[key], (v) => (this[key] = v), to, ms); this[key] = to; a.changed(); await a.wait(80); }
  steps() {
    const app = this.app, pw = () => app.table('pw').rows, has = (i) => typeof pw()[i]?.P === 'number' && !(pw()[i]._pend && pw()[i]._pend.P);
    const rows = (id) => app.table(id).completeRows();
    return [
      {
        title: '测入射光功率',
        html: '<p>把光功率计探头放在物镜前，测入射激光的功率 $P_0$。</p>',
        check: () => has(0),
        auto: async () => { app.showTable(0); await app.view('全景'); await this.seg('meter', 'probe', 'in'); await app.record('pw', 0); },
      },
      {
        title: '调节耦合',
        html: '<p>探头移到光纤出射端。交替调节微调架的 x、y、z，使输出功率最大，记下 1 km 光纤的输出功率 $P_2$。</p>',
        hint: '离焦（z）太大时光斑比纤芯（直径 50 μm）还大，x、y 怎么调都上不去；先把 z 调到焦点附近，再细调 x、y。',
        status: () => `当前输出 ${this.fmtP(this.Pout() * 1000)} μW`,
        check: () => has(1),
        auto: async () => {
          app.showTable(0); await app.view('耦合');
          await this.seg('meter', 'probe', 'out'); await this.seg('meter', 'out', 'meter'); if (this.R) await this.seg('reel', 'R', 0);
          await this.adj('couple', 'z', 0, 500); await this.adj('couple', 'x', 0, 400); await this.adj('couple', 'y', 0, 400);
          if (!this.cut) await app.record('pw', 0);
        },
      },
      {
        title: '截断法测损耗',
        html: '<p>保持入射端不动，在入射端约 2 m 处剪断光纤，把短光纤的出射端放到功率计上，测输出功率 $P_1$。</p>',
        hint: '截断前后入射端的耦合不能变，否则两次输出的差别里就混进了耦合效率的变化。',
        check: () => has(2),
        diagnose: () => (!has(1) ? [{ msg: '截断前还没有记录 1 km 光纤的输出功率 P₂。截断后就测不了了。' }] : []),
        auto: async () => {
          app.showTable(0); await app.view('全景');
          if (!this.cut) { app.select(app.comp('reel')); this.cut = true; app.renderInspector(); app.changed(); await app.wait(300); }
          await this.seg('meter', 'probe', 'out'); await this.seg('meter', 'out', 'meter'); if (this.R) await this.seg('reel', 'R', 0);
          if (this._key && this._key !== this._fk) { const [x, y, z] = this._key.split(',').map(Number); await this.adj('couple', 'x', x); await this.adj('couple', 'y', y); await this.adj('couple', 'z', z); }
          await app.record('pw', 0);
        },
      },
      {
        title: '远场法测数值孔径',
        html: '<p>出射端换上观察屏。屏在导轨上依次放在 30、40 … 80 mm 处，读出光斑直径 $D$。</p>',
        status: () => `已测 ${rows('na').length} 个位置`,
        check: () => rows('na').length >= 4,
        auto: async () => {
          app.showTable(1); await app.view('输出端');
          await this.seg('meter', 'out', 'screen');
          for (let s = 30; s <= 80; s += 10) { if (rows('na').some((r) => Math.abs(r.s - s) < 0.25)) continue; await this.adj('meter', 's', s, 250); await app.record('na', 0); }
          await this.seg('meter', 'out', 'meter');
        },
      },
      {
        title: '弯曲损耗',
        html: `<p>在短光纤上，先记不绕时的输出功率，再依次在 R = 10、8、6、5、4、3 mm 的棒上绕 ${NTURN} 圈，记下输出功率。</p>`,
        hint: '弯曲使一部分光线在纤芯–包层界面上的入射角小于临界角，从纤芯漏出去。弯曲半径越小，漏出的越多。',
        status: () => `已测 ${rows('bend').length} 个条件`,
        check: () => rows('bend').length >= 4 && rows('bend').some((r) => r.R === '不绕'),
        diagnose: () => (!this.cut ? [{ msg: '光纤还没有截断：弯曲实验在短光纤上做。' }] : []),
        auto: async () => {
          app.showTable(2); await app.view('全景');
          if (!this.cut) { app.select(app.comp('reel')); this.cut = true; app.renderInspector(); app.changed(); }
          await this.seg('meter', 'probe', 'out'); await this.seg('meter', 'out', 'meter');
          const k0 = rows('bend')[0]?._key; if (k0 && k0 !== this._fk) { const [x, y, z] = k0.split(',').map(Number); await this.adj('couple', 'x', x); await this.adj('couple', 'y', y); await this.adj('couple', 'z', z); }
          for (const R of [0, 10, 8, 6, 5, 4, 3]) { const lab = R ? R.toFixed(1) : '不绕'; if (rows('bend').some((r) => r.R === lab)) continue; await this.seg('reel', 'R', R); await app.record('bend', 0); }
          await this.seg('reel', 'R', 0);
        },
      },
      {
        title: '数据处理',
        html: '<p>计算耦合效率和损耗系数；由 $D$–$s$ 直线的斜率求数值孔径；作每圈弯曲损耗随半径变化的图。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, t = a.table('pw'), v = (i) => t.value(t.rows[i], 'P', i), P0 = v(0), P2 = v(1), P1 = v(2);
    const N = a.table('na').completeRows(), B = a.table('bend').completeRows();
    if (!(P0 > 0) && N.length < 2 && B.length < 2) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    let html = ''; const answers = [], plots = [];
    if (P0 > 0 && P1 > 0) {
      const eta = P1 / P0;
      html += `<h3>1. 耦合效率</h3><p>短光纤的损耗可以忽略，$P_1$ 就是耦合进光纤的功率：</p><div class="result-box">$\\eta=\\dfrac{P_1}{P_0}=\\dfrac{${P1}}{${P0}}=${pct(eta, 1)}$</div><p>达不到 100% 的原因：物镜的吸收和反射（约 5%）、两个端面各约 4% 的菲涅耳反射、端面切割不平整、光斑没有完全落在纤芯里。</p>`;
      answers.push({ label: '耦合效率 $\\eta$', unit: '%', value: eta * 100, digits: 1, tolAbs: 0.3 });
    }
    if (P1 > 0 && P2 > 0) {
      const al = (10 / LKM) * Math.log10(P1 / P2);
      html += `<h3>2. 截断法测损耗</h3><p>截断前后入射端耦合不变，$P_1$、$P_2$ 之比只反映 1 km 光纤本身的损耗（截掉部分长 $L$ = ${LKM.toFixed(3)} km，2 m 短光纤的损耗可以忽略）：</p>
        <div class="result-box">$\\alpha=\\dfrac{10}{L}\\lg\\dfrac{P_1}{P_2}=${al.toFixed(2)}$ dB/km</div><p>光纤盘上的标称值 ${this.alpha.toFixed(2)} dB/km，相对误差 ${pct(relErr(al, this.alpha))}。多模石英光纤在 633 nm 的损耗主要来自瑞利散射（∝ λ⁻⁴），比 1310 nm、1550 nm 通信窗口大得多。</p>`;
      answers.push({ label: '损耗系数 $\\alpha$', unit: 'dB/km', value: al, digits: 2, tolRel: 0.01 });
    }
    if (N.length >= 2) {
      const f = linFit(N.map((r) => r.s), N.map((r) => r.D)), NA = Math.sin(Math.atan(f.k / 2));
      html += `<h3>3. 数值孔径</h3><p>光斑直径 $D=d_c+2(s-s_0)\\tan\\theta_{\\max}$，$s_0$ 为出射端面在导轨上的位置（不必知道）。$D$–$s$ 直线斜率 ${f.k.toFixed(4)}（r = ${f.r.toFixed(5)}），外推到 $D=0$ 得端面位置约 ${(-f.b / f.k).toFixed(1)} mm。</p>
        <div class="result-box">$NA=\\sin\\left(\\arctan\\dfrac{\\text{斜率}}{2}\\right)=${NA.toFixed(4)}$</div><p>标称值 ${this.NA.toFixed(3)}，相对误差 ${pct(relErr(NA, this.NA))}。光斑边缘的亮度是逐渐变暗的，判断边缘有主观性；在几个距离上测、用斜率计算可以减小这一影响。</p>`;
      answers.push({ label: '数值孔径 $NA$', unit: '', value: NA, digits: 4, tolRel: 0.02 });
      plots.push({ title: '光斑直径 D – 屏位置 s', xLabel: 's / mm', yLabel: 'D / mm', series: [{ type: 'scatter', data: N.map((r) => [r.s, r.D]), label: '实验点' }, { type: 'line', data: [0, 90].map((x) => [x, f.k * x + f.b]).filter((p) => p[1] >= 0), label: '拟合' }] });
    }
    const ref = B.find((r) => r.R === '不绕'), Bs = B.filter((r) => r._R > 0);
    if (ref && Bs.length >= 2) {
      const L = Bs.map((r) => ({ R: r._R, dB: (10 * Math.log10(ref.P / r.P)) / NTURN })).sort((x, y) => x.R - y.R);
      const use = L.filter((x) => x.dB > 0.002), f = use.length >= 2 ? linFit(use.map((x) => x.R), use.map((x) => Math.log(x.dB))) : null;
      html += `<h3>4. 弯曲损耗</h3><table><tr><th>R/mm</th>${L.map((x) => `<td>${x.R}</td>`).join('')}</tr><tr><th>每圈损耗/dB</th>${L.map((x) => `<td>${x.dB.toFixed(3)}</td>`).join('')}</tr></table>
        <p>弯曲半径减小，每圈损耗迅速增大。${f ? `$\\ln\\Delta$–$R$ 近似直线（r = ${f.r.toFixed(4)}），即 $\\Delta\\propto e^{-R/R_0}$，$R_0$ ≈ ${(-1 / f.k).toFixed(2)} mm。` : ''}光纤布线时弯曲半径一般不小于光纤外径的几百倍（多模光纤约 15–30 mm）。</p>`;
      plots.push({ title: '每圈弯曲损耗 – 弯曲半径', xLabel: 'R / mm', yLabel: 'Δ / (dB/圈)', series: [{ type: 'scatter', data: L.map((x) => [x.R, x.dB]), label: '实验点' }, { type: 'line', data: L.map((x) => [x.R, x.dB]), label: '' }] });
    }
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 光纤导光原理</h3><p>阶跃折射率光纤由折射率 $n_1$ 的纤芯和折射率略低的包层 $n_2$ 构成。光线在纤芯–包层界面上的入射角大于临界角时发生全反射，沿光纤传播。能被全反射传输的光线，在入射端面上的入射角有一个最大值 $\\theta_{\\max}$：</p>$$NA=n_0\\sin\\theta_{\\max}=\\sqrt{n_1^2-n_2^2}$$<p>$NA$ 叫数值孔径，表示光纤接收光的能力。由于光路可逆，出射光的发散角也由 $NA$ 决定，所以可以由远场光斑的大小测数值孔径。</p>
<h3>2. 耦合</h3><p>用显微物镜把激光会聚成很小的光斑，使光斑落在纤芯端面上，会聚角小于光纤的接收角。耦合效率 $\\eta=P_1/P_0$。</p>
<h3>3. 截断法测损耗</h3><p>光功率沿光纤按指数衰减。先测长度 $L$ 的光纤的输出功率 $P_2$，保持入射条件不变，在入射端附近截断，测短光纤的输出功率 $P_1$（它近似等于进入光纤的功率），则损耗系数</p>$$\\alpha=\\frac{10}{L}\\lg\\frac{P_1}{P_2}\\quad(\\text{dB/km})$$
<h3>4. 弯曲损耗</h3><p>光纤弯曲时，外侧光线在界面上的入射角变小，一部分不再满足全反射条件而漏到包层中损失掉。弯曲半径越小，损耗越大，近似按指数规律变化。</p>
<h3>5. 本仿真的计算模型</h3><p>耦合份额按高斯光斑与纤芯圆的交叠积分计算，离焦时光斑按高斯光束规律变大；远场光强分布取 $(1-(\\sin\\theta/NA_0)^2)^{0.7}$，以 5% 强度点为光斑边缘；弯曲损耗取 $\\Delta=Ae^{-R/R_0}$。端面质量、损耗系数、数值孔径、出射端面在导轨上的位置都个体随机。</p>`;
  }
}
