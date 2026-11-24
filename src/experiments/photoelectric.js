// 实验：光电效应测普朗克常数（截止电压法 · 伏安特性 · 饱和光电流与光强）
import * as THREE from 'three';
import { meta, thumb, H, E, C, FILTERS, SPEC } from './photoelectric.meta.js';
import { Component } from '../core/Component.js';
import { AXIS_Y, MAT, mesh, labTable, opticalRail, carriage, lampHousing, glowSprite, ICONS, Beam, meterBox, knobMesh } from '../core/Models.js';
import { rgbCss, rgbHex } from '../physics/color.js';
import { linFit, gauss, rand, relErr, pct, texU, sig } from '../core/Stats.js';
import { lineData } from '../core/Plot.js';

const APS = [2, 4, 8]; // 光阑直径 mm
const RANGES = [1e-8, 1e-9, 1e-10, 1e-11, 1e-12, 1e-13]; // 电流量程 A
const rngLabel = (r) => `10⁻${String(-Math.log10(r)).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])} A`;

export class PhotoelectricExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.W = rand(1.50, 1.66); // 有效逸出功（含接触电势差）eV
    this.Is = rand(1.6, 2.4) * 1e-10; // 365 nm、φ4 mm、L=40 cm 时的饱和电流
    this.anode = rand(0.00006, 0.00018); // 阳极反向电流比例
    this.eta = 0.25; this.Uk = rand(6, 9);
    this.zero = rand(-3, 3); // 微电流计零点漂移（以 10⁻¹³ A 为单位）
    this.lampOn = false; this.warm = 0;
    this.cover = true; this.filter = 0; this.ap = 1;
    this.mode = 'stop'; // 'stop': −2~0 V；'iv': −1~50 V
    this.U = -1.5; this.range = 2;
    this.ampOn = false;
  }

  get L() { const l = this.app.comp('lamp'), p = this.app.comp('cell'); return l.placed && p.placed && p.pos > l.pos ? p.pos - l.pos : null; }
  get lambda() { return FILTERS[this.filter]; }
  get nu() { return C / (this.lambda * 1e-9); }
  get U0() { return (H * this.nu) / E - this.W; }
  /** 阴极受照时的饱和光电流 A */
  get Isat() {
    if (!this.lampOn || this.cover || !this.L) return 0;
    return this.Is * this.warm * SPEC[this.lambda] * (APS[this.ap] / 4) ** 2 * (40 / this.L) ** 2 * this.app.coaxT('cell');
  }
  /** 光电管电流（含阴极光电流、阳极反向电流、暗电流）A */
  current(U = this.U) {
    const Is = this.Isat, U0 = this.U0, x = U + U0;
    let F = 0;
    if (x > 0) F = U <= 0 ? this.eta * (x / U0) ** 2 : this.eta + (1 - this.eta) * (1 - Math.exp(-U / this.Uk));
    const Ia = U < 0 ? -this.anode * Is * (1 - Math.exp(U / 0.4)) : 0;
    const Id = U * 2e-15; // 漏电（暗电流）
    return Is * F + Ia + Id;
  }
  display() {
    if (!this.ampOn) return { str: '', v: null };
    const r = RANGES[this.range];
    const raw = this.current() + this.zero * 1e-13 + gauss(0.02e-13);
    const v = raw / r;
    if (Math.abs(v) > 1999) return { str: (v < 0 ? '−' : '') + '1   ', over: true, v: null };
    return { str: v.toFixed(1).replace('-', '−'), v: +v.toFixed(1), raw };
  }
  Umin() { return this.mode === 'stop' ? -2 : -1; }
  Umax() { return this.mode === 'stop' ? 0 : 50; }

  cameras() {
    return [
      { name: '全景', pos: [30, 66, 100], target: [30, 12, -6] },
      { name: '光电管', pos: [50, 36, 40], target: [45, 20, 0] },
      { name: '实验仪', pos: [30, 40, 22], target: [30, 8, -24] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(180, 90); t.position.set(30, 0, -8); scene.add(t);
    scene.add(opticalRail(60));
    app.addRail({ origin: new THREE.Vector3(0, 0, 0), min: 0, max: 60 });
    app.stage.setLightTarget(30, 0, -8);

    const lc = carriage(0x9aa3b2, AXIS_Y - 6);
    const lh = lampHousing(0xc7c9ff, 10, 13); lh.group.position.y = 6; lc.top.add(lh.group);
    this.lampGlow = lh.glowMat;
    this.lampSprite = glowSprite(0xb9b5ff, 10); this.lampSprite.position.set(8, 6, 0); this.lampSprite.visible = false; lc.top.add(this.lampSprite);
    app.addComponent(new Component({
      key: 'lamp', name: '高压汞灯', icon: ICONS.mercury, zone: 'rail', defaultPos: 4, required: true, object: lc.group, labelY: 34,
      desc: '汞灯在紫外到可见光区有 365.0、404.7、435.8、546.1、577.0 nm 等强谱线，需预热后再测量。',
      controls: () => [{ type: 'toggle', label: '电源开关', get: () => this.lampOn, set: (v) => (this.lampOn = v) }, { type: 'readout', label: '预热', get: () => (this.lampOn ? `${Math.round(this.warm * 100)}%` : '未开灯') }],
    }));

    const pc = carriage(0x9aa3b2, AXIS_Y - 6);
    const pg = new THREE.Group();
    pg.add(mesh(new THREE.BoxGeometry(9, 11, 10), MAT.paint(0x2d3748), 0, 6, 0));
    this.turret = new THREE.Group();
    const tur = mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.8, 36), MAT.dark()); tur.rotation.z = Math.PI / 2; this.turret.add(tur);
    this.filterGlass = mesh(new THREE.CircleGeometry(1.2, 24), new THREE.MeshStandardMaterial({ color: 0x8866ff, emissive: 0x000000, transparent: true, opacity: 0.8 }), -0.45, 0, 0); this.filterGlass.rotation.y = -Math.PI / 2; this.turret.add(this.filterGlass);
    this.turret.position.set(-4.9, 6, 0); pg.add(this.turret);
    this.coverMesh = mesh(new THREE.CylinderGeometry(2, 2, 1, 24), MAT.black(), -5.8, 6, 0); this.coverMesh.rotation.z = Math.PI / 2; pg.add(this.coverMesh);
    pc.top.add(pg);
    app.addComponent(new Component({
      key: 'cell', name: '光电管暗盒', icon: ICONS.photocell, zone: 'rail', defaultPos: 44, required: true, object: pc.group, labelY: 36,
      desc: '光电管装在暗盒内，入光口前的转盘上有 5 块滤色片和 2、4、8 mm 三种光阑，入光口另有遮光盖。',
      controls: () => [
        { type: 'toggle', label: '遮光盖', get: () => this.cover, set: (v) => (this.cover = v) },
        { type: 'segment', label: '滤色片', get: () => this.filter, set: (v) => (this.filter = v), options: FILTERS.map((nm, i) => ({ label: `${nm.toFixed(0)}`, value: i })) },
        { type: 'segment', label: '光阑直径', get: () => this.ap, set: (v) => (this.ap = v), options: APS.map((d, i) => ({ label: `φ${d} mm`, value: i })) },
      ],
    }));

    // 实验仪（固定在桌面上）
    const box = new THREE.Group();
    box.add(mesh(new THREE.BoxGeometry(34, 12, 18), MAT.paint(0xd6d3cb), 0, 6, 0));
    this.mI = meterBox(14, 7, 0.5, '电流');
    this.mI.group.position.set(-8, 3.5, 9); box.add(this.mI.group);
    this.mU = meterBox(14, 7, 0.5, '电压');
    this.mU.group.position.set(8, 3.5, 9); box.add(this.mU.group);
    for (let i = 0; i < 4; i++) { const k = knobMesh(1.1, 1.4); k.rotation.x = Math.PI / 2; k.position.set(-12 + i * 8, 2.2, 9.6); box.add(k); }
    box.position.set(30, 0, -30);
    app.addComponent(new Component({
      key: 'amp', name: '光电效应实验仪', zone: 'none', fixed: true, object: box, labelY: 16, showLabel: false,
      desc: '内含微电流放大器（量程 10⁻⁸～10⁻¹³ A）和光电管工作电源（截止电压挡 −2～0 V，伏安特性挡 −1～+50 V）。',
      controls: () => [
        { type: 'toggle', label: '仪器电源', get: () => this.ampOn, set: (v) => (this.ampOn = v) },
        { type: 'segment', label: '电压挡', get: () => this.mode, set: (v) => { this.mode = v; this.U = Math.min(this.Umax(), Math.max(this.Umin(), this.U)); }, options: [{ label: '截止电压 −2~0 V', value: 'stop' }, { label: '伏安特性 −1~50 V', value: 'iv' }] },
        { type: 'knob', label: '电压调节（粗）', get: () => this.U, set: (v) => (this.U = Math.min(this.Umax(), Math.max(this.Umin(), v))), min: -2, max: 50, step: 0.02, bigStep: 0.5, perRev: 4, digits: 3, unit: 'V' },
        { type: 'knob', label: '电压调节（细）', get: () => this.U, set: (v) => (this.U = Math.min(this.Umax(), Math.max(this.Umin(), v))), min: -2, max: 50, step: 0.001, bigStep: 0.01, perRev: 0.05, digits: 3, unit: 'V' },
        { type: 'segment', label: '电流量程', get: () => this.range, set: (v) => (this.range = v), options: RANGES.map((r, i) => ({ label: rngLabel(r).replace(' A', ''), value: i })) },
        { type: 'knob', label: '调零旋钮', get: () => this.zero, set: (v) => (this.zero = v), min: -10, max: 10, step: 0.01, bigStep: 0.2, perRev: 2, fmt: () => '盖上遮光盖后看电流表', sub: '盖上遮光盖、选 10⁻¹³ A 量程，把电流调到 0.0（调零不准会使弱谱线的截止电压明显偏离）' },
      ],
    }));

    this.beam = new Beam(0xb9b5ff, 0.25, 0.9); scene.add(this.beam.group);
    this.curve = app.addView({ id: 'iv', title: '电流–电压（已记录的数据点）', w: 280, h: 170, res: 1.5 });
  }

  tick(dt) {
    if (this.lampOn && this.warm < 1) { this.warm = Math.min(1, this.warm + dt / 4); this.app.changed(); }
    if (!this.lampOn && this.warm > 0) { this.warm = 0; this.app.changed(); }
  }

  update() {
    const app = this.app;
    const on = this.lampOn && app.comp('lamp').placed;
    this.lampGlow.emissiveIntensity = on ? 2.5 * this.warm : 0;
    this.lampSprite.visible = on;
    this.coverMesh.visible = this.cover;
    this.turret.rotation.x = this.filter * 0.9 + this.ap * 0.3;
    this.filterGlass.material.color.set(rgbHex(this.lambda < 400 ? 400 : this.lambda));
    const V3 = (x) => this.app.coaxV(x, AXIS_Y); // 光束沿实际光路
    const l = app.comp('lamp'), c = app.comp('cell');
    if (on && c.placed && c.pos > l.pos) { this.beam.setColor(0xc9c6ff); this.beam.set(V3(l.pos + 7.5), V3(c.pos - 5.5), 0.5 * this.warm); } else this.beam.hide();
    const d = this.display();
    this.mI.setText(this.ampOn ? d.str : '', this.ampOn ? '' : '', this.ampOn ? `× ${rngLabel(RANGES[this.range])}` : '');
    this.mU.setText(this.ampOn ? this.U.toFixed(this.mode === 'stop' ? 3 : 1) : '', this.ampOn ? 'V' : '', this.ampOn ? (this.mode === 'stop' ? '−2～0 V' : '−1～50 V') : '');
    this.drawCurve();
  }

  drawCurve() {
    const v = this.curve, g = v.ctx, W = v.W, Hh = v.H;
    g.fillStyle = '#101513'; g.fillRect(0, 0, W, Hh);
    const t = this.app.table('iv');
    const pts = t ? t.completeRows() : [];
    const x0 = W * 0.1, y0 = Hh * 0.85;
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.moveTo(x0, 6); g.lineTo(x0, Hh - 6); g.moveTo(6, y0); g.lineTo(W - 6, y0); g.stroke();
    if (pts.length) {
      const maxI = Math.max(...pts.map((p) => Math.abs(p.I)), 1e-9);
      const X = (U) => x0 + ((U + 1) / 51) * (W - x0 - 10), Y = (I) => y0 - (I / maxI) * (y0 - 12);
      g.fillStyle = '#8fe3a5'; for (const p of pts) g.fillRect(X(p.U) - 2, Y(p.I) - 2, 4, 4);
    }
    const d = this.display();
    v.foot(this.ampOn ? `U = ${this.U.toFixed(3)} V · I = ${d.str} × ${rngLabel(RANGES[this.range])} · λ = ${this.lambda} nm · φ${APS[this.ap]} mm` : '实验仪电源未打开');
  }

  globalControls() {
    return [
      { type: 'readout', label: '电流显示', get: () => { const d = this.display(); return this.ampOn ? `${d.str} × ${rngLabel(RANGES[this.range])}` : '—'; } },
      { type: 'readout', label: '电压显示', get: () => (this.ampOn ? `${this.U.toFixed(3)} V` : '—') },
    ];
  }

  tables() {
    return [
      {
        id: 'ua', title: '截止电压', fixedRows: true,
        initRows: () => FILTERS.map((nm) => ({ nm })),
        columns: [
          { key: 'nm', label: 'λ/nm', digits: 1, readonly: true },
          { key: 'nu', label: 'ν/10¹⁴ Hz', digits: 3, calc: (r) => C / (r.nm * 1e-9) / 1e14 },
          { key: 'ua', label: '截止电压 Uₐ/V', digits: 3 },
        ],
        buttons: [{ label: '记录当前滤色片的截止电压', onClick: (t) => this.recUa(t) }],
        note: '零电流法：选 10⁻¹³ A 量程，调节电压使电流显示为 0，此时电压的绝对值即为截止电压。',
      },
      {
        id: 'iv', title: '伏安特性',
        columns: [{ key: 'U', label: 'U/V', digits: 2 }, { key: 'I', label: 'I/10⁻¹⁰ A', digits: 3 }],
        buttons: [{ label: '记录 (U, I)', onClick: (t) => this.recIV(t) }],
        note: '伏安特性挡，435.8 nm 滤色片，φ4 mm 光阑，10⁻¹¹ A 量程。从 −1 V 到 50 V 记录 15 个以上的点，低电压区取密一些。',
      },
      {
        id: 'sat', title: '饱和电流与光强', fixedRows: true,
        initRows: () => APS.map((d) => ({ d })),
        columns: [{ key: 'd', label: '光阑直径/mm', digits: 0, readonly: true }, { key: 'area', label: '面积相对值', digits: 2, calc: (r) => (r.d / 2) ** 2 }, { key: 'I', label: 'I_M(50 V)/10⁻¹⁰ A', digits: 3 }],
        buttons: [{ label: '记录当前光阑下的电流', onClick: (t) => this.recSat(t) }],
        note: '保持 U = 50 V、滤色片不变，依次换用三种光阑。',
      },
    ];
  }

  readCur(rangeIdx) {
    if (!this.ampOn) { this.app.toast('实验仪电源没有打开', 'warn'); return null; }
    const d = this.display();
    if (d.over) { this.app.toast('电流超量程，请换大一挡量程', 'warn'); return null; }
    return (d.v * RANGES[rangeIdx ?? this.range]);
  }
  recUa(t) {
    if (this.mode !== 'stop') return this.app.toast('请切换到截止电压挡', 'warn');
    if (this.cover || !this.lampOn) return this.app.toast('光电管没有受到光照', 'warn');
    if (this.readCur() == null) return;
    if (this.range !== 5) this.app.toast('提示：零电流法应使用 10⁻¹³ A 量程，否则判断“零”不准', 'warn');
    const d = this.display();
    if (Math.abs(d.v) > 0.3) this.app.toast(`电流还不为零（${d.str}），继续调节电压`, 'warn');
    if (Math.abs(this.zero) > 0.05) this.app.toast('注意：微电流计没有调零', 'warn');
    t.set(this.filter, 'ua', Math.round(Math.abs(this.U) * 1000) / 1000);
  }
  recIV(t) {
    if (this.mode !== 'iv') return this.app.toast('请切换到伏安特性挡', 'warn');
    const I = this.readCur(); if (I == null) return;
    t.addRow({ U: Math.round(this.U * 100) / 100, I: +(I / 1e-10).toFixed(3) });
  }
  recSat(t) {
    if (this.mode !== 'iv' || this.U < 49) this.app.toast('提示：应在伏安特性挡、U = 50 V 下测饱和电流', 'warn');
    const I = this.readCur(); if (I == null) return;
    t.set(this.ap, 'I', +(I / 1e-10).toFixed(3));
  }

  /** 零电流法：数值求显示电流为零的电压（用于自动演示） */
  zeroU() {
    const f = (U) => this.current(U) + this.zero * 1e-13;
    let a = -2, b = 0;
    if (f(a) * f(b) > 0) return -this.U0;
    for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (f(a) * f(m) <= 0) b = m; else a = m; }
    return (a + b) / 2;
  }

  /** 等高共轴调节：光路顺序、光束与各元件通光孔（cm） */
  coaxSpec() {
    return {
      keys: ['lamp', 'cell'],
      beam: { lamp: { w: 0.6, div: 0.008 } },
      ap: { cell: { y: 0.4, z: 0.4 } }, // 暗盒入光孔
      axes: { lamp: 'ya', cell: 'yz' },
    };
  }

  steps() {
    const app = this.app;
    const on = (k) => app.comp(k).placed;
    return [
      {
        title: '放置汞灯与光电管暗盒',
        html: '<p>把<b>汞灯</b>和<b>光电管暗盒</b>放在导轨上，使两者相距约 40 cm，入光口对准灯的出光口。保持光电管的<b>遮光盖</b>盖上。</p>',
        check: () => on('lamp') && on('cell') && this.L > 30 && this.L < 50 && (this.cover || this.zeroed),
        status: () => (this.L ? `灯–光电管距离 <b>${this.L.toFixed(1)} cm</b>` : ''),
        auto: async () => { await app.view('全景'); await app.autoPlace('lamp', { pos: 4 }); await app.autoPlace('cell', { pos: 44 }); },
      },
      {
        title: '开机预热，微电流计调零',
        html: '<p>打开汞灯和实验仪电源，预热。盖着遮光盖时，选择 <b>10⁻¹³ A</b> 量程，转动<b>调零旋钮</b>使电流显示为 0。</p>',
        check: () => this.zeroed || (this.zeroed = this.lampOn && this.warm > 0.95 && this.ampOn && this.cover && this.range === 5 && Math.abs(this.zero) < 0.05),
        status: () => (this.ampOn ? `电流显示 <b>${this.display().str}</b> × ${rngLabel(RANGES[this.range])}${this.cover ? '' : '（遮光盖未盖）'}` : '实验仪电源未开'),
        auto: async () => {
          app.select(app.comp('lamp')); this.lampOn = true; app.changed();
          await app.view('实验仪'); app.select(app.comp('amp')); this.ampOn = true; this.mode = 'stop'; this.U = 0; this.range = 5; app.changed(); await app.wait(400);
          await app.tween(() => this.zero, (v) => (this.zero = v), gauss(0.008), 1200);
          while (this.warm < 0.97) await app.wait(200, true);
        },
      },
      {
        title: '零电流法测各谱线的截止电压',
        html: '<p>取下遮光盖，选 <b>φ4 mm</b> 光阑。依次换用 365.0、404.7、435.8、546.1、577.0 nm 滤色片，在截止电压挡、10⁻¹³ A 量程下调节电压，使电流显示为 <b>0</b>，记录电压。</p>',
        hint: '电压从 −2 V 往 0 V 方向慢慢调：电流由负值（阳极反向电流）变为 0 再迅速增大。零点附近用细调旋钮。',
        check: () => app.table('ua').completeRows().length >= 5,
        status: () => `已测 <b>${app.table('ua').completeRows().length}</b> / 5`,
        auto: async () => {
          const t = app.table('ua'); app.showTable(app.tables.indexOf(t));
          app.select(app.comp('cell')); this.cover = false; this.ap = 1; app.changed(); await app.wait(300);
          for (let i = 0; i < FILTERS.length; i++) {
            app.select(app.comp('cell')); this.filter = i; app.changed(); await app.wait(300);
            app.select(app.comp('amp'));
            const z = this.zeroU();
            await app.tween(() => this.U, (v) => (this.U = v), z - 0.15, 700);
            await app.tween(() => this.U, (v) => (this.U = v), z + gauss(0.002), 700);
            await app.record('ua');
          }
        },
      },
      {
        title: '测光电管的伏安特性曲线',
        html: '<p>换到<b>伏安特性挡</b>，选 435.8 nm 滤色片、φ4 mm 光阑、10⁻¹¹ A 量程。电压从 −1 V 起逐渐增大到 50 V，记录 15 个以上的 $(U, I)$ 点。</p>',
        check: () => { const r = app.table('iv').completeRows(); return r.length >= 15 && Math.max(...r.map((q) => q.U)) >= 40; },
        status: () => `已记录 <b>${app.table('iv').completeRows().length}</b> 点`,
        auto: async () => {
          const t = app.table('iv'); app.showTable(app.tables.indexOf(t));
          app.select(app.comp('cell')); this.filter = 2; this.ap = 1; app.changed();
          app.select(app.comp('amp')); this.mode = 'iv'; this.range = 3; this.U = -1; app.changed(); await app.wait(300);
          for (const U of [-1, -0.5, 0, 0.5, 1, 2, 3, 4, 6, 8, 10, 15, 20, 25, 30, 35, 40, 45, 50]) {
            await app.tween(() => this.U, (v) => (this.U = v), U, 250);
            await app.record('iv');
          }
        },
      },
      {
        title: '饱和光电流与光强的关系（选做）',
        optional: true,
        html: '<p>保持 $U=50$ V 和滤色片不变，依次换用 φ2、φ4、φ8 mm 光阑，记录饱和光电流。光通量与光阑面积成正比。</p>',
        check: () => app.table('sat').completeRows().length >= 3,
        auto: async () => {
          const t = app.table('sat'); app.showTable(app.tables.indexOf(t));
          this.U = 50;
          for (let i = 0; i < 3; i++) {
            app.select(app.comp('cell')); this.ap = i; app.changed();
            app.select(app.comp('amp')); this.range = this.Isat * 1.05 > 1999e-11 ? 2 : 3; app.changed(); await app.wait(300);
            await app.record('sat');
          }
        },
      },
      {
        title: '数据处理：求普朗克常数',
        html: '<p>由 $eU_a=h\\nu-W$，作 $U_a$–$\\nu$ 直线，斜率 $k=h/e$，故 $h=ek$；截距给出逸出功。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const ua = this.app.table('ua').completeRows();
    if (ua.length < 3) return { html: '<p>至少需要 3 个滤色片的截止电压。</p>', ok: false };
    const nu = ua.map((r) => C / (r.nm * 1e-9)), U = ua.map((r) => r.ua);
    const f = linFit(nu.map((x) => x / 1e14), U);
    const h = (f.k / 1e14) * E, uh = (f.uk / 1e14) * E;
    const W0 = -f.b, nu0 = -f.b / f.k;
    let html = `<h3>1. 截止电压与频率</h3><table><tr><th>λ/nm</th>${ua.map((r) => `<td>${r.nm.toFixed(1)}</td>`).join('')}</tr><tr><th>ν/10¹⁴ Hz</th>${nu.map((x) => `<td>${(x / 1e14).toFixed(3)}</td>`).join('')}</tr><tr><th>Uₐ/V</th>${U.map((x) => `<td>${x.toFixed(3)}</td>`).join('')}</tr></table>
      <p>线性拟合 $U_a=k\\nu+b$：$k=${(f.k).toFixed(4)}\\times10^{-14}$ V·s，$b=${f.b.toFixed(3)}$ V，$r=${f.r.toFixed(5)}$。</p>
      <div class="result-box">$h=ek=${texU(h * 1e34, uh * 1e34)}\\times10^{-34}\\ \\mathrm{J\\cdot s}$，与公认值 $6.626\\times10^{-34}$ J·s 的相对误差 ${pct(relErr(h, H))}</div>
      <p>截止频率 $\\nu_0=${nu0.toFixed(3)}\\times10^{14}$ Hz，逸出功（含接触电势差）$W=${W0.toFixed(2)}$ eV。</p>
      <div class="plot-wrap"><canvas data-plot="0" style="height:280px"></canvas></div>`;
    const plots = [{ title: 'Uₐ – ν', xLabel: 'ν / 10¹⁴ Hz', yLabel: 'Uₐ / V', series: [
      { type: 'scatter', data: nu.map((x, i) => [x / 1e14, U[i]]), label: '实验数据', radius: 4 },
      { type: 'line', data: lineData(f.k, f.b, Math.min(...nu) / 1e14 - 0.2, Math.max(...nu) / 1e14 + 0.2), label: `拟合 k = ${f.k.toFixed(4)}×10⁻¹⁴ V·s` },
    ] }];
    const iv = this.app.table('iv').completeRows().slice().sort((a, b) => a.U - b.U);
    if (iv.length >= 5) {
      html += `<h3>2. 伏安特性</h3><p>反向电压较大时电流为很小的负值（阳极反向电流）；电压升高后光电流迅速增大并逐渐趋于饱和。</p><div class="plot-wrap"><canvas data-plot="${plots.length}" style="height:260px"></canvas></div>`;
      plots.push({ title: '光电管伏安特性（435.8 nm，φ4 mm）', xLabel: 'U / V', yLabel: 'I / 10⁻¹⁰ A', series: [{ type: 'line', data: iv.map((r) => [r.U, r.I]), label: '实验曲线', width: 1.5 }, { type: 'scatter', data: iv.map((r) => [r.U, r.I]), label: '数据点', radius: 3 }] });
    }
    const sat = this.app.table('sat').completeRows();
    if (sat.length >= 2) {
      const fs = linFit(sat.map((r) => (r.d / 2) ** 2), sat.map((r) => r.I));
      html += `<h3>3. 饱和光电流与光强</h3><p>$I_M$ 对光阑面积作直线拟合，相关系数 $r=${fs.r.toFixed(4)}$：饱和光电流与入射光强成正比。</p>`;
    }
    html += `<div class="result-box warn">本仿真光电管的参考值：有效逸出功 ${this.W.toFixed(3)} eV；阳极反向电流约为阴极电流的 ${(this.anode * 100).toFixed(3)}%。阳极反向电流使零电流点偏离真实截止电压，这是零电流法的主要系统误差。</div>`;
    return { html, ok: true, plots, answers: [{ label: '普朗克常量 $h$', unit: '×10⁻³⁴ J·s', hint: '如 6.63', value: h * 1e34, digits: 3, tolRel: 0.01 }] };
  }

  principle() {
    return `<h3>1. 光电效应方程</h3><p>频率为 $\\nu$ 的光子能量 $h\\nu$ 被阴极中的电子吸收，电子逸出时的最大初动能</p>$$\\tfrac12mv_{max}^2=h\\nu-W$$<p>在光电管两极加反向电压 $U$，当 $eU_a=\\tfrac12mv_{max}^2$ 时光电流为零，$U_a$ 称为截止电压：</p>$$U_a=\\frac he\\nu-\\frac We$$<p>$U_a$–$\\nu$ 为直线，斜率 $h/e$，与光强无关。</p>
<h3>2. 实际光电管的电流</h3><p>测得的电流是阴极光电流、阳极反向电流（阳极受杂散光照射发射的电子）和暗电流之和。零电流点处阴极光电流并不为零，而是与阳极反向电流相抵，因此零电流法测得的 $U_a$ 略小于真实值；由于这一偏差与 $U_a$ 近似成比例，会使斜率略偏小。阳极反向电流很小时，零电流法简便而有效。</p>
<h3>3. 本仿真的计算模型</h3><p>阴极光电流在反向电压区按 $(U+U_a)^2$ 增长，正向电压区按指数规律趋于饱和；饱和电流与谱线强度、量子效率、光阑面积成正比，与灯–管距离平方成反比。另加阳极反向电流、漏电流和微电流计的零点漂移与读数噪声。</p>`;
  }
}
