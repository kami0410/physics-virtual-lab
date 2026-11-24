// 实验：超声光栅测液体中的声速（声光效应 · 拉曼–奈斯衍射 · 驻波相位光栅）
import * as THREE from 'three';
import { meta, thumb } from './ultrasonic.meta.js';
import { Component } from '../core/Component.js';
import { besselJ } from '../physics/bessel.js';
import { drawMicroReticle, drawMicroDrum } from '../core/Reticle.js';
import { AXIS_Y, MAT, mesh, labTable, opticalRail, carriage, lensMesh, laserMesh, Beam, ICONS, meterBox } from '../core/Models.js';
import { linFit, texU, gauss, rand, relErr, pct, sig } from '../core/Stats.js';
import { lineData } from '../core/Plot.js';
import * as FIG from './figures.js';

const LAMBDA = 632.8e-6; // mm
const EYE_FOV = 10; // 测微目镜圆形视场直径 mm（0–8 mm 固定刻度完整可见）
const BACK = 0.015;
const W0 = 0.75; // 光束半径 mm
const KS = [-3, -2, -1, 0, 1, 2, 3];
const LIQ = {
  water: { name: '水', v: (T) => 1402.39 + 5.0371 * T - 0.058085 * T * T + 3.342e-4 * T ** 3, k: 1 },
  ethanol: { name: '无水乙醇', v: (T) => 1162 - 4.0 * (T - 20), k: 1.25 },
  glycerol: { name: '甘油', v: (T) => 1923 - 1.8 * (T - 20), k: 0.7 },
};


export class UltrasonicExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.laserOn = false; this.genOn = false;
    this.liq = 'water';
    this.T = rand(17, 26);
    this.f0 = rand(10.2, 11.4); // 换能器谐振频率 MHz
    this.Q = rand(45, 70);
    this.nu = 9.6 + rand(0, 0.3); // 信号源频率 MHz
    this.amp = 4; // 输出电压 V
    this.alpha = rand(0.4, 0.9) * (Math.random() < 0.5 ? -1 : 1); // 超声池倾角 (°)
    this.fL = rand(168, 172); // 透镜焦距 mm（标定）
    this.eyeOff = rand(-0.4, 0.4);
    this.drive = 4 + rand(-1, 1); this.pos = this.drive; this.lastDir = 0; this.travel = 0;
    this.dioptZero = rand(-1.2, 1.2); this.diopt = 0;
    this.assist = !this.app.readSelf; // 自己读数时默认不显示读数辅助
  }

  get vs() { return LIQ[this.liq].v(this.T) * 1000; } // mm/s
  get Lam() { return this.vs / (this.nu * 1e6); } // 声波波长 mm
  P(k) { const c = this.app.comp(k); return c.placed ? c.pos * 10 : null; }
  lit() { const l = this.app.comp('laser'); return this.laserOn && l.placed; }
  /** 换能器的谐振响应 */
  get resp() { const x = (2 * this.Q * (this.nu - this.f0)) / this.f0; return 1 / Math.sqrt(1 + x * x); }
  /** 拉曼–奈斯参数（相位调制深度） */
  get vRN() { return this.genOn && this.app.comp('cell').placed ? 0.62 * this.amp * this.resp * LIQ[this.liq].k : 0; }
  /** 各级相对光强 */
  orders() {
    const v = this.vRN, out = [];
    let sum = 0;
    for (let k = -6; k <= 6; k++) {
      // 倾斜入射：偏离垂直时一侧级次增强、另一侧减弱，高级次衰减更多
      const asym = Math.exp(-(((k * this.alpha) / 3) ** 2)) * (1 + 0.85 * Math.tanh((k * this.alpha) / 0.5));
      const I = besselJ(k, v) ** 2 * (k === 0 ? 1 : asym);
      out.push({ k, I }); sum += I;
    }
    out.forEach((o) => (o.I /= sum));
    return out;
  }
  get lensOk() { const L = this.P('lens'), c = this.P('cell'), e = this.P('eye'); return L != null && c != null && e != null && c < L && L < e; }
  get s() { return this.lensOk ? this.P('eye') - this.P('lens') : null; }
  /** 光点在目镜分划板处的位置（相对光轴）与大小 */
  spots() {
    if (!this.lit() || !this.app.comp('eye').placed) return [];
    const os = this.vRN ? this.orders() : [{ k: 0, I: 1 }];
    if (!this.lensOk) return [{ k: 0, x: 0, r: 2.5, I: 0.05 }];
    const s = this.s, f = this.fL;
    const r = Math.hypot(W0 * Math.abs(s - f) / f, (LAMBDA * f) / (Math.PI * W0));
    const h0 = this.P('lens') - this.P('cell');
    // 第 k 级平行光以 θ 入射透镜（高度 h），在距透镜 s 处的位置 x = s·tanθ + h(1 − s/f)；s = f 时 x = f·tanθ
    return os.map((o) => { const tt = Math.tan(Math.asin(Math.min(0.99, (o.k * LAMBDA) / this.Lam))); return { k: o.k, x: s * tt + h0 * tt * (1 - s / f), r, I: o.I }; });
  }
  eyeX(drive = this.pos) { return drive - 4 + this.eyeOff; }
  visibleOrders() { return this.vRN ? this.orders().filter((o) => o.I > 0.01).length : 1; }

  cameras() {
    return [
      { name: '全景', pos: [55, 70, 120], target: [55, 18, 0] },
      { name: '超声池', pos: [30, 36, 40], target: [32, 22, 0] },
      { name: '测微目镜', pos: [60, 36, 40], target: [72, 20, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(220, 90); t.position.set(55, 0, 0); scene.add(t);
    scene.add(opticalRail(110));
    app.addRail({ origin: new THREE.Vector3(0, 0, 0), min: 0, max: 110 });
    app.stage.setLightTarget(55, 0, 0);

    const lc = carriage(0x9aa3b2, AXIS_Y);
    const lz = laserMesh(26); lz.group.position.set(2, 0, 0); lc.top.add(lz.group);
    this.laserAp = lz.aperture;
    app.addComponent(new Component({
      key: 'laser', name: 'He-Ne 激光器', icon: ICONS.laser, zone: 'rail', defaultPos: 28, required: true, object: lc.group, labelY: 30,
      desc: '632.8 nm，光束直径约 1.5 mm。',
      controls: () => [{ type: 'toggle', label: '激光电源', get: () => this.laserOn, set: (v) => (this.laserOn = v) }],
    }));

    const cc = carriage(0x9aa3b2, AXIS_Y);
    const cg = new THREE.Group();
    this.cellG = new THREE.Group();
    this.cellG.add(mesh(new THREE.BoxGeometry(4, 6, 6), MAT.glass(0xdbeafe, 0.35)));
    this.liquid = mesh(new THREE.BoxGeometry(3.6, 4.6, 5.6), new THREE.MeshPhysicalMaterial({ color: 0x9ad1f5, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false }), 0, -0.6, 0);
    this.cellG.add(this.liquid);
    this.cellG.add(mesh(new THREE.BoxGeometry(3, 0.5, 5), MAT.brass(), 0, 3.2, 0)); // 压电晶片
    this.cellG.add(mesh(new THREE.BoxGeometry(4.4, 0.6, 6.4), MAT.dark(), 0, -3.3, 0));
    cg.add(this.cellG);
    const gen = meterBox(14, 8, 9, '超声信号源');
    gen.group.position.set(0, -AXIS_Y, 18); gen.group.rotation.y = -0.2;
    cc.group.add(gen.group);
    this.gen = gen;
    cc.top.add(cg);
    app.addComponent(new Component({
      key: 'cell', name: '超声池与信号源', icon: ICONS.cell, zone: 'rail', defaultPos: 36, required: true, object: cc.group, labelY: 30,
      desc: '玻璃液槽，顶部的压电陶瓷晶片由高频信号源驱动，在液体中形成超声驻波。液槽可绕竖直轴微转。附有温度计。',
      controls: () => [
        { type: 'segment', label: '液体', get: () => this.liq, set: (v) => (this.liq = v), options: Object.entries(LIQ).map(([k, o]) => ({ label: o.name, value: k })) },
        { type: 'toggle', label: '信号源输出', get: () => this.genOn, set: (v) => (this.genOn = v) },
        { type: 'knob', label: '频率（粗调）', get: () => this.nu, set: (v) => (this.nu = v), min: 8, max: 13, step: 0.01, bigStep: 0.1, perRev: 0.5, digits: 3, unit: 'MHz' },
        { type: 'knob', label: '频率（细调）', get: () => this.nu, set: (v) => (this.nu = v), min: 8, max: 13, step: 0.001, bigStep: 0.01, perRev: 0.05, digits: 3, unit: 'MHz' },
        { type: 'knob', label: '输出电压', get: () => this.amp, set: (v) => (this.amp = v), min: 0, max: 12, step: 0.1, bigStep: 1, perRev: 4, digits: 1, unit: 'V' },
        { type: 'knob', label: '液槽转角', get: () => this.alpha, set: (v) => (this.alpha = v), min: -5, max: 5, step: 0.02, bigStep: 0.2, perRev: 2, digits: 2, unit: '°', fmt: () => '看衍射光点是否对称', sub: '使激光垂直入射超声波面' },
        { type: 'readout', label: '频率计', get: () => (this.genOn ? `${this.nu.toFixed(3)} MHz` : '----') },
        { type: 'readout', label: '温度计', get: () => `${this.T.toFixed(1)} °C` },
      ],
    }));

    const fc = carriage(0x9aa3b2, AXIS_Y);
    fc.top.add(lensMesh(4, 0.5));
    app.addComponent(new Component({
      key: 'lens', name: `会聚透镜 f=${this.fL.toFixed(1)} mm`, icon: ICONS.lens, zone: 'rail', defaultPos: 50, required: true, object: fc.group, labelY: 30,
      desc: `焦距标定值 f = ${this.fL.toFixed(1)} mm。衍射光经透镜会聚，在其后焦面上形成一排光点。`,
    }));

    const ec = carriage(0x9aa3b2, AXIS_Y);
    const eg = new THREE.Group();
    eg.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 7, 28), MAT.black(), 2.2, 0, 0).rotateZ(Math.PI / 2));
    eg.add(mesh(new THREE.BoxGeometry(3, 4.4, 4.4), MAT.paint(0x4b5a53), -1.2, 0, 0));
    this.eyeDrum = mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.6, 36), MAT.chrome(), -1.2, 0, 3.2); this.eyeDrum.rotation.x = Math.PI / 2; eg.add(this.eyeDrum);
    ec.top.add(eg);
    app.addComponent(new Component({
      key: 'eye', name: '测微目镜', icon: ICONS.detector, zone: 'rail', defaultPos: 75, required: true, object: ec.group, labelY: 30,
      desc: '分划板 0–8 mm 固定刻度；鼓轮 1 圈 1 mm、100 分格。目镜前加有减光片，可直接观察激光光点。',
      controls: () => [
        { type: 'knob', label: '目镜视度（看清叉丝）', get: () => this.diopt, set: (v) => (this.diopt = v), min: -3, max: 3, step: 0.05, bigStep: 0.5, perRev: 2, digits: 2, unit: 'D' },
        { type: 'knob', label: '测微鼓轮', get: () => this.drive, set: (v) => this.moveDrive(v), min: 0, max: 8, step: 0.002, bigStep: 0.05, perRev: 1, digits: 3, unit: 'mm', sub: '测量时始终沿同一方向转动' },
      ],
    }));

    this.beamA = new Beam(0xff2a2a, 0.07, 0.3); this.beamB = new Beam(0xff2a2a, 0.07, 0.3); scene.add(this.beamA.group, this.beamB.group);
    this.fan = []; for (let i = 0; i < 8; i++) { const b = new Beam(0xff3030, 0.04, 0.15); scene.add(b.group); this.fan.push(b); }
    this.eyeView = app.addView({ id: 'eye', title: '测微目镜视场', w: 250, h: 250, res: 1.4 });
    this.readView = app.addView({ id: 'read', title: '固定刻度与鼓轮', w: 290, h: 100, res: 1.5 });
  }

  moveDrive(v) {
    const dv = v - this.drive;
    if (Math.abs(dv) < 1e-12) return;
    const dir = Math.sign(dv);
    if (dir !== this.lastDir) { this.travel = 0; this.lastDir = dir; }
    this.travel += Math.abs(dv);
    this.drive = v;
    const half = BACK / 2;
    if (this.drive - this.pos > half) this.pos = this.drive - half;
    if (this.pos - this.drive > half) this.pos = this.drive + half;
  }

  update() {
    const app = this.app;
    this.laserAp.material.emissiveIntensity = this.lit() ? 3 : 0.1;
    this.cellG.rotation.y = (this.alpha * Math.PI) / 180 * 4;
    this.liquid.material.color.set(this.liq === 'water' ? 0x9ad1f5 : this.liq === 'ethanol' ? 0xd7f0ff : 0xf3e7b0);
    this.eyeDrum.rotation.y = this.drive * Math.PI * 2;
    this.gen.setText(this.genOn ? this.nu.toFixed(3) : '----', 'MHz', `输出 ${this.amp.toFixed(1)} V   T = ${this.T.toFixed(1)} °C`);
    const V3 = (x, z = 0) => this.app.coaxV(x, AXIS_Y, z); // 光束沿实际光路
    const L = app.comp('laser'), C = app.comp('cell'), F = app.comp('lens'), E = app.comp('eye');
    this.fan.forEach((b) => b.hide());
    if (this.lit()) {
      const cellIn = C.placed && C.pos > L.pos;
      const end1 = cellIn ? C.pos : F.placed && F.pos > L.pos ? F.pos : E.placed ? E.pos : 110;
      this.beamA.set(V3(L.pos + 2.4), V3(end1), 1);
      if (cellIn) {
        const end2 = F.placed && F.pos > C.pos ? F.pos : E.placed && E.pos > C.pos ? E.pos : 110;
        this.beamB.set(V3(C.pos), V3(end2), 0.8);
        if (this.vRN > 0.2) {
          let i = 0;
          for (const o of this.orders()) {
            if (o.k === 0 || o.I < 0.02 || i >= this.fan.length) continue;
            const ang = ((o.k * LAMBDA) / this.Lam) * 12; // 视觉放大
            const z2 = (end2 - C.pos) * ang;
            if (this.lensOk) { this.fan[i].set(V3(C.pos), V3(F.pos, z2 * 0.6), o.I * 2); }
            else this.fan[i].set(V3(C.pos), V3(end2, z2), o.I * 2);
            i++;
          }
        }
        if (this.lensOk) this.beamB.set(V3(C.pos), V3(E.pos), 0.8);
      } else this.beamB.hide();
    } else { this.beamA.hide(); this.beamB.hide(); }
    this.drawEye();
    this.drawRead();
  }

  drawEye() {
    const v = this.eyeView, g = v.ctx, W = v.W, H = v.H;
    const pxmm = W / EYE_FOV;
    g.fillStyle = '#050607'; g.fillRect(0, 0, W, H);
    const sp = this.spots();
    g.globalCompositeOperation = 'lighter';
    const co = this.app.coaxOff('eye'), cT = this.app.coaxT('eye'); // 目镜与光点不等高/横向偏移时，光点在视场中偏移、变暗
    for (const o0 of sp) {
      const o = { ...o0, I: o0.I * cT };
      const x = W / 2 + (o.x + co.z * 10 - this.eyeOff) * pxmm, y = H * 0.5 - co.y * 10 * pxmm; // 光点与叉丝横线同高
      const r = Math.max(1.2, o.r * pxmm * 2.2) + 3 * Math.pow(o.I, 0.5);
      const a = Math.min(1, Math.pow(o.I, 0.45) * 1.6);
      if (a < 0.02 || x < -r || x > W + r) continue;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,${120 + 100 * a},${90 + 90 * a},${a})`); gr.addColorStop(0.35, `rgba(255,40,30,${a * 0.75})`); gr.addColorStop(1, 'rgba(255,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    const blurEye = Math.abs(this.diopt - this.dioptZero);
    // 分划板：0–8 mm 固定刻度，十字叉丝与竖直双线随鼓轮移动；视度不对时分划板模糊
    drawMicroReticle(g, W, H, { pxmm, pos: this.pos, blur: blurEye, dark: true });
    let foot = '';
    if (!this.lit()) foot = '激光器未打开';
    else if (!this.lensOk) foot = '光点很大：需要在超声池与目镜之间放透镜';
    else if (!this.vRN) foot = this.genOn ? '只有一个光点：超声池未放入或电压为 0' : '只有零级光点：信号源未开';
    else if (this.assist) foot = `可见 ${this.visibleOrders()} 个光点 · 目镜距焦面 ${(this.s - this.fL).toFixed(1)} mm · 谐振响应 ${(this.resp * 100).toFixed(0)}%`;
    v.foot(foot);
  }

  drawRead() {
    const v = this.readView, g = v.ctx, W = v.W;
    const sc = W / 290; g.save(); g.scale(sc, sc);
    drawMicroDrum(g, this.drive, this.assist);
    g.restore();
  }

  globalControls() {
    return [{ type: 'toggle', label: '显示读数与状态辅助', get: () => this.assist, set: (v) => (this.assist = v) }];
  }

  tables() {
    return [
      {
        id: 'pos', title: '衍射光点位置', fixedRows: true,
        initRows: () => KS.map((k) => ({ k })),
        columns: [{ key: 'k', label: '级次 k', digits: 0, readonly: true }, { key: 'x', label: '光点位置 x/mm', digits: 3 }],
        buttons: [{ label: '记录读数到下一格', onClick: (t) => this.recSpot(t) }],
        note: '叉丝从 −3 级开始沿同一方向移动，依次对准各光点中心。',
      },
      {
        id: 'cond', title: '频率与温度', fixedRows: true,
        initRows: () => [{}],
        columns: [{ key: 'liq', label: '液体', type: 'text', readonly: true }, { key: 'nu', label: '频率 ν/MHz', digits: 3 }, { key: 'T', label: '温度 T/°C', digits: 1 }],
        buttons: [{ label: '读取频率计和温度计', onClick: (t) => { if (!this.genOn) return this.app.toast('信号源未开', 'warn'); t.set(0, 'liq', LIQ[this.liq].name); t.set(0, 'nu', Math.round(this.nu * 1000) / 1000); t.set(0, 'T', Math.round(this.T * 10) / 10); } }],
        note: '在测光点位置的同时读取，频率和液体不要改变。',
      },
    ];
  }

  readNow() { return Math.round((this.drive + gauss(0.0015)) * 1000) / 1000; }
  recSpot(t) {
    const i = t.firstEmpty('x');
    if (i < 0) return this.app.toast('表格已记录完整', 'ok');
    const sp = this.spots();
    if (!this.lensOk || !this.vRN) return this.app.toast('看不到衍射光点', 'warn');
    const k = t.rows[i].k, o = sp.find((q) => q.k === k);
    if (!o || o.I < 0.004) this.app.toast(`看不到第 ${k} 级光点`, 'warn');
    else if (Math.abs(o.x - this.eyeX()) > Math.max(0.02, o.r)) this.app.toast(`叉丝没有对准第 ${k} 级光点中心`, 'warn');
    if (Math.abs(this.s - this.fL) > 4) this.app.toast('光点不够细：目镜不在透镜焦面上', 'warn');
    if (i > 0 && this.lastDir <= 0) this.app.toast('注意：鼓轮应沿同一方向转动', 'warn');
    t.set(i, 'x', this.readNow());
  }

  /** 等高共轴调节：光路顺序、光束与各元件通光孔（cm） */
  coaxSpec() {
    return {
      keys: ['laser', 'cell', 'lens', 'eye'],
      // 会聚透镜：偏心时光束被偏折，焦面上光点位于透镜光轴处
      beam: { laser: { w: 0.075, div: 0.0006 }, lens: { w: 0.075, div: -0.075 / (this.fL / 10) } },
      f: { lens: this.fL / 10 },
      ap: { cell: { y: 1.0, z: 1.0 }, lens: { y: 1.2, z: 1.2 }, eye: { y: 0.22, z: Infinity } },
      axes: { laser: 'y', cell: 'yz', lens: 'yz', eye: 'yz' },
    };
  }

  steps() {
    const app = this.app;
    const on = (k) => app.comp(k).placed;
    const toX = (X) => X + 4 - this.eyeOff;
    return [
      {
        title: '在光具座上放置器材',
        html: '<p>按 <b>激光器 → 超声池 → 会聚透镜 → 测微目镜</b> 放置。目镜分划板到透镜的距离约等于透镜焦距。</p>',
        check: () => ['laser', 'cell', 'lens', 'eye'].every(on) && this.lensOk && this.P('laser') < this.P('cell'),
        auto: async () => { await app.view('全景'); for (const [k, x] of [['laser', 28], ['cell', 36], ['lens', 50], ['eye', 50 + this.fL / 10 + 1.5]]) await app.autoPlace(k, { pos: x }); },
      },
      {
        title: '打开激光器，调节目镜看清叉丝',
        html: '<p>打开激光器，调节目镜视度看清分划板。此时视场中只有一个光点（零级）。</p>',
        check: () => this.lit() && Math.abs(this.diopt - this.dioptZero) < 0.12,
        auto: async () => { app.select(app.comp('laser')); this.laserOn = true; app.changed(); app.select(app.comp('eye')); await app.tween(() => this.diopt, (v) => (this.diopt = v), this.dioptZero + gauss(0.03), 1000); },
      },
      {
        title: '调节信号源频率，使换能器谐振',
        html: '<p>打开信号源，输出电压调到 5 V 左右。缓慢调节频率（先粗后细），当压电晶片谐振时液体中的超声驻波最强，视场中出现的衍射光点<b>最多、最亮</b>。</p>',
        hint: '谐振范围很窄（品质因数约 50），粗调时要慢。',
        check: () => this.genOn && this.resp > 0.97 && this.vRN > 2,
        status: () => (this.genOn ? `频率 <b>${this.nu.toFixed(3)} MHz</b>，可见 <b>${this.visibleOrders()}</b> 个光点` : '信号源未开'),
        auto: async () => {
          await app.view('超声池'); app.select(app.comp('cell'));
          this.genOn = true; await app.tween(() => this.amp, (v) => (this.amp = v), 5.5, 500);
          await app.tween(() => this.nu, (v) => (this.nu = v), this.f0 + 0.15, 1400);
          await app.tween(() => this.nu, (v) => (this.nu = v), this.f0 - 0.05, 900);
          await app.tween(() => this.nu, (v) => (this.nu = v), this.f0 + gauss(0.008), 700);
        },
      },
      {
        title: '转动液槽，使衍射光点左右对称',
        html: '<p>微转液槽，使激光垂直入射超声波面：此时 ±k 级光点亮度相同、左右对称。</p>',
        check: () => Math.abs(this.alpha) < 0.1,
        status: () => { const o = this.orders(); const a = o.find((q) => q.k === 2).I, b = o.find((q) => q.k === -2).I; return `±2 级亮度比 <b>${(a / Math.max(1e-6, b)).toFixed(2)}</b>`; },
        auto: async () => { app.select(app.comp('cell')); await app.tween(() => this.alpha, (v) => (this.alpha = v), gauss(0.03), 1200); },
      },
      {
        title: '移动目镜到透镜焦面',
        html: '<p>前后移动测微目镜，使光点最小最亮——此时分划板在透镜的后焦面上，衍射角 θ 对应的光点位置 $x=f\\tan\\theta$。</p>',
        check: () => this.lensOk && Math.abs(this.s - this.fL) < 3,
        status: () => (this.lensOk ? `透镜–目镜距离 <b>${(this.s / 10).toFixed(2)} cm</b>` : ''),
        auto: async () => { await app.view('测微目镜'); await app.moveTo('eye', (this.P('lens') + this.fL + gauss(0.5)) / 10, 900); },
      },
      {
        title: '测量 −3 ~ +3 级光点位置',
        html: '<p>转动鼓轮，叉丝从 −3 级开始<b>沿同一方向</b>依次对准各级光点中心，记录 7 个读数。同时读取频率计和温度计。</p>',
        check: () => app.table('pos').completeRows().length >= 7 && app.table('cond').completeRows().length >= 1,
        status: () => `已记录 <b>${app.table('pos').completeRows().length}</b> / 7 个光点`,
        auto: async () => {
          app.select(app.comp('eye'));
          const t = app.table('pos'); app.showTable(app.tables.indexOf(t));
          const sp = this.spots();
          const xs = KS.map((k) => sp.find((q) => q.k === k).x);
          await app.tween(() => this.drive, (v) => this.moveDrive(v), toX(xs[0]) - 0.1, 700);
          for (const X of xs) { await app.tween(() => this.drive, (v) => this.moveDrive(v), toX(X) + BACK / 2 + gauss(0.002), 400); await app.record('pos'); }
          const c = app.table('cond'); app.showTable(app.tables.indexOf(c)); await app.record('cond');
        },
      },
      {
        title: '数据处理：求声速',
        html: '<p>$x_k$ 对 $k$ 作直线拟合得相邻光点间距 $\\Delta x$。超声波长 $\\Lambda=\\lambda f/\\Delta x$，声速 $v=\\Lambda\\nu$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const rows = this.app.table('pos').completeRows();
    const c = this.app.table('cond').rows[0];
    if (rows.length < 3) return { html: '<p>至少需要 3 个光点的位置（建议 7 个）。</p>', ok: false };
    if (c.nu == null) return { html: '<p>请读取频率计和温度计。</p>', ok: false };
    const fit = linFit(rows.map((r) => r.k), rows.map((r) => r.x));
    const dx = Math.abs(fit.k), udx = fit.uk;
    const Lam = (LAMBDA * this.fL) / dx;
    const v = (Lam * c.nu * 1e6) / 1000, uv = v * Math.hypot(udx / dx, 0.002);
    const key = Object.keys(LIQ).find((k) => LIQ[k].name === c.liq) || this.liq;
    const ref = LIQ[key].v(c.T);
    const html = `<h3>衍射光点位置</h3><table><tr><th>k</th>${rows.map((r) => `<td>${r.k}</td>`).join('')}</tr><tr><th>x/mm</th>${rows.map((r) => `<td>${r.x.toFixed(3)}</td>`).join('')}</tr></table>
      <p>直线拟合 $x=\\Delta x\\cdot k+b$：$\\Delta x=${dx.toFixed(4)}$ mm，$u(\\Delta x)=${sig(udx, 2)}$ mm，$r=${fit.r.toFixed(6)}$。</p>
      <p>透镜焦距 $f=${this.fL.toFixed(1)}$ mm，激光波长 $\\lambda=632.8$ nm，信号频率 $\\nu=${c.nu.toFixed(3)}$ MHz，液体${c.liq}，温度 ${c.T.toFixed(1)} °C。</p>
      <p>超声波长 $\\Lambda=\\lambda f/\\Delta x=${(Lam * 1000).toFixed(2)}$ μm</p>
      <div class="result-box">$v=\\Lambda\\nu=${texU(v, uv, 'm/s')}$</div>
      <div class="plot-wrap"><canvas data-plot="0" style="height:240px"></canvas></div>
      <div class="result-box warn">${c.liq}在 ${c.T.toFixed(1)} °C 时声速的参考值 ${ref.toFixed(1)} m/s，本次测量相对误差 ${pct(relErr(v, ref))}。</div>`;
    return {
      html, ok: true,
      answers: [{ label: `${c.liq}中的声速 $v$`, unit: 'm/s', value: v, digits: 1, tolRel: 0.006 }],
      plots: [{ title: '光点位置 x – 级次 k', xLabel: 'k', yLabel: 'x / mm', series: [
        { type: 'scatter', data: rows.map((r) => [r.k, r.x]), label: '测量值', radius: 4 },
        { type: 'line', data: lineData(fit.k, fit.b, -3.3, 3.3), label: `Δx = ${dx.toFixed(4)} mm` },
      ] }],
    };
  }

  principle() {
    return `<h3>1. 超声光栅</h3><p>压电陶瓷晶片在高频电压驱动下振动，在液体中激发超声波，经槽底反射形成驻波。液体密度、从而折射率随空间周期性变化，周期等于超声波长 $\\Lambda$。光垂直穿过液槽时，波面受到周期性的相位调制，液体相当于一块<b>相位光栅</b>，光栅常数 $\\Lambda=v/\\nu$。</p>
<h3>2. 拉曼–奈斯衍射</h3><p>相位调制深度为 $v_{RN}$ 时，第 $k$ 级衍射光强 $I_k=J_k^2(v_{RN})$（$J_k$ 为 $k$ 阶贝塞尔函数），衍射角满足 $\\Lambda\\sin\\theta_k=k\\lambda$。在会聚透镜后焦面上，相邻光点间距</p>$$\\Delta x=\\frac{\\lambda f}{\\Lambda}\\quad\\Rightarrow\\quad v=\\Lambda\\nu=\\frac{\\lambda f\\nu}{\\Delta x}$$
${FIG.ultrasonicFig()}
<h3>3. 谐振与垂直入射</h3><p>只有信号频率接近晶片的固有频率时，振幅才足够大，看到多级衍射；光不垂直入射时，各级光点不再对称。</p>
<h3>4. 本仿真的计算模型</h3><p>换能器按品质因数 $Q≈50$ 的谐振曲线响应；各级光强用自编的贝塞尔函数级数计算；光点大小由高斯光束的焦斑和目镜离焦量决定。声速随温度变化：水采用 Marczak 经验公式，乙醇、甘油采用线性近似。温度、谐振频率每次随机生成。</p>`;
  }
}
