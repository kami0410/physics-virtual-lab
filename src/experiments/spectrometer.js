// 实验四：分光计的调节与光栅衍射（测光栅常数与汞灯谱线波长）
import * as THREE from 'three';
import { meta, thumb, HG } from './spectrometer.meta.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, labTable, lampHousing, ICONS, canvasTexture, knobMesh, Beam, glowSprite } from '../core/Models.js';
import { rgbCss, rgbHex } from '../physics/color.js';
import { gratingEnvelope } from '../physics/diffraction.js';
import { mean, uA, fmtU, texU, sig, gauss, rand, relErr, pct, clamp, dms } from '../core/Stats.js';
import * as FIG from './figures.js';

const YA = 24; // 光轴高度 cm
const FIELD = 1.6; // 望远镜视场半角 (°)
const F_COLL = 170; // 平行光管焦距 mm
const LINES = [
  { name: '紫', nm: 435.83 }, { name: '绿', nm: 546.07 }, { name: '黄₁', nm: 576.96 }, { name: '黄₂', nm: 579.07 },
];
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const R2D = 180 / Math.PI, D2R = Math.PI / 180;

export class SpectrometerExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.lines = 600 * rand(0.985, 1.015); // 条/mm
    this.d = 1 / this.lines; // mm
    this.tel = 32; this.telLock = false; // 望远镜方位 (°)
    this.plat = 0; // 载物台转角 (°)
    this.tau = rand(25, 45) * (Math.random() < 0.5 ? -1 : 1); // 望远镜俯仰 (′)
    this.bx = rand(20, 40) * (Math.random() < 0.5 ? -1 : 1); // 载物台倾斜 (′)
    this.bz = rand(-15, 15);
    this.gamM = rand(-10, 10); this.gamG = rand(-8, 8); // 镜面/光栅面与台面不垂直量 (′)
    this.mountM = rand(10, 20) * (Math.random() < 0.5 ? -1 : 1); // 放置时法线方位偏离 (°)
    this.mountG = rand(6, 14) * (Math.random() < 0.5 ? -1 : 1);
    this.fErr = rand(1.5, 3) * (Math.random() < 0.5 ? -1 : 1); // 望远镜分划板离焦 (mm)
    this.cErr = rand(1.5, 3) * (Math.random() < 0.5 ? -1 : 1); // 狭缝离焦 (mm)
    this.dioptZero = rand(-1.2, 1.2); this.diopt = 0;
    this.slitW = 1.2; // mm
    this.illum = false; this.lampOn = false;
    this.dial0 = rand(0, 360); this.ecc = 2.2 / 60; this.eccPh = rand(0, 360);
    this.assist = !this.app.readSelf; // 自己读数时默认不显示读数辅助
  }

  // ---------- 状态 ----------
  get onPlat() { const z = this.app.zones.find((z) => z.id === 'plat'); return z && z.occupant ? z.occupant.key : null; }
  /** 当前台上元件的(前表面)法线方位与仰角 (°, ′) */
  /** 当前光栅 → 光路设计台：汞灯四条谱线的平行光经光栅衍射，望远镜物镜（f = 170 mm）把一级谱线会聚到焦面上。光栅常数是待测量，做完实验才公开 */
  toBench({ done }) {
    const lines = [435.83, 546.07, 576.96, 579.07], els = [];
    for (const nm of lines) els.push({ type: 'beam', x: -70, y: 0, rot: 0, lam: nm, w: 6, n: 4 });
    els.push({ type: 'grating', x: 0, y: 0, rot: 0, L: 30, lpm: +this.lines.toFixed(3), duty: 0.3, maxOrder: 2, eff: 0.8, secret: !done });
    const th = Math.asin(546.07e-6 * this.lines), c = Math.cos(th), s = Math.sin(th), f = 170, l = 70;
    els.push({ type: 'ideal', x: l * c, y: l * s, rot: (th * 180) / Math.PI, f, D: 40 });
    els.push({ type: 'detector', x: (l + f) * c, y: (l + f) * s, rot: (th * 180) / Math.PI, L: 40 });
    return {
      els, opts: { partial: false, images: false },
      note: `来自“分光计调节与光栅衍射”：汞灯平行光正入射光栅，各谱线按 d·sinθ = kλ 分开。望远镜物镜放在绿线一级方向上，焦面探测器上能分辨出黄双线 576.96 / 579.07 nm。把光栅刻线密度加倍，看谱线怎样散开、二级谱怎样移出视场。`,
    };
  }

  face() {
    const k = this.onPlat;
    if (!k) return null;
    const az = this.plat + (k === 'mirror' ? this.mountM : this.mountG);
    const mount = k === 'mirror' ? this.mountM : this.mountG;
    const gam = k === 'mirror' ? this.gamM : this.gamG;
    // 螺钉 b₁、b₂ 随载物台一起转动：台面倾斜对镜面法线仰角的贡献只取决于元件在台面上的安放方位
    const tilt = this.bx * Math.cos(mount * D2R) + this.bz * Math.sin(mount * D2R);
    return { key: k, az, elA: gam + tilt, elB: -(gam + tilt) };
  }
  /** 望远镜中看到的绿十字反射像（相对分划板上叉丝的偏移，单位：°） */
  crossImage() {
    const f = this.face();
    if (!f) return null;
    const faces = [[f.az, f.elA, 'A']];
    if (f.key === 'mirror') faces.push([f.az + 180, f.elB, 'B']);
    for (const [az, el, name] of faces) {
      const dh = 2 * wrap180(az - this.tel);
      if (Math.abs(dh) < FIELD * 1.4) return { x: dh, y: (2 * (el - this.tau)) / 60, face: name };
    }
    return null;
  }
  readings() {
    const e = this.ecc * Math.sin((this.tel + this.eccPh) * D2R);
    const A = (((this.tel + this.dial0 + e) % 360) + 360) % 360;
    const B = (((this.tel + this.dial0 + 180 - e) % 360) + 360) % 360;
    return { A, B };
  }
  /** 光栅衍射：返回各谱线各级的出射方位 (°) */
  spectrum() {
    const out = [];
    const k = this.onPlat;
    if (!this.lampOn || !this.app.comp('lamp').placed) return out;
    if (!k) { out.push({ nm: 0, k: 0, az: 0, I: 1 }); return out; }
    if (k === 'mirror') return out;
    const psi = this.plat + this.mountG;
    const inc = -psi * D2R; // 入射角（相对法线）
    for (const [nm, a] of HG) {
      for (let m = -3; m <= 3; m++) {
        const s = Math.sin(inc) + (m * nm * 1e-6) / this.d;
        if (Math.abs(s) >= 1) continue;
        const beta = Math.asin(s);
        const env = gratingEnvelope(this.d, this.d * 0.42, nm * 1e-6, s, Math.sin(inc));
        out.push({ nm, k: m, az: psi + beta * R2D, I: a * env * (m === 0 ? 0.25 : 1) });
      }
    }
    return out;
  }
  telBlur() { return Math.abs(this.fErr) * 2.2; }

  cameras() {
    return [
      { name: '全景', pos: [12, 78, 92], target: [0, 18, 0] },
      { name: '俯视', pos: [0, 120, 8], target: [0, 18, 0] },
      { name: '载物台', pos: [20, 38, 34], target: [0, 21, 0] },
      { name: '游标', pos: [0, 30, 34], target: [0, 14, 8] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const table = labTable(170, 110); scene.add(table);
    app.stage.setLightTarget(0, 0, 0);
    const green = MAT.paint(0x4b5a53), dark = MAT.dark();

    // ---------- 底座与刻度盘 ----------
    const base = new THREE.Group();
    base.add(mesh(new THREE.CylinderGeometry(9, 12, 4, 48), green, 0, 2, 0));
    for (let i = 0; i < 3; i++) { const a = (i * 2 * Math.PI) / 3 + 0.5; base.add(mesh(new THREE.BoxGeometry(18, 2.5, 4), green, Math.cos(a) * 12, 1.25, -Math.sin(a) * 12).rotateY(a)); }
    base.add(mesh(new THREE.CylinderGeometry(2.6, 2.6, 10, 24), MAT.alu(), 0, 9, 0));
    const dialTex = canvasTexture(1024, 1024, (g, W, H) => {
      g.fillStyle = '#d9d6c8'; g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); g.fill();
      g.translate(W / 2, H / 2); g.fillStyle = '#111'; g.strokeStyle = '#111';
      for (let i = 0; i < 720; i++) { const a = (i / 720) * Math.PI * 2; const L = i % 20 === 0 ? 40 : i % 2 === 0 ? 24 : 14; g.save(); g.rotate(a); g.fillRect(-0.8, -W / 2 + 4, 1.6, L); if (i % 20 === 0) { g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.fillText(String(i / 2), 0, -W / 2 + 74); } g.restore(); }
      g.fillStyle = '#4b5a53'; g.beginPath(); g.arc(0, 0, W / 2 - 100, 0, Math.PI * 2); g.fill();
    });
    this.dial = mesh(new THREE.CylinderGeometry(11, 11, 0.8, 72), [MAT.alu(), new THREE.MeshStandardMaterial({ map: dialTex, roughness: 0.5 }), MAT.alu()], 0, 14.5, 0);
    base.add(this.dial);
    app.addComponent(new Component({ key: 'base', name: '分光计底座', zone: 'none', fixed: true, object: base, showLabel: false }));

    // ---------- 平行光管（固定） ----------
    const coll = new THREE.Group();
    const ct = mesh(new THREE.CylinderGeometry(1.8, 1.8, 26, 32), MAT.black(), -22, YA, 0); ct.rotation.z = Math.PI / 2; coll.add(ct);
    const slitBox = mesh(new THREE.CylinderGeometry(2.2, 2.2, 4, 32), MAT.chrome(), -36.5, YA, 0); slitBox.rotation.z = Math.PI / 2; coll.add(slitBox);
    this.slitGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 2.2), new THREE.MeshBasicMaterial({ color: 0xe6e6ff, transparent: true, opacity: 0 }));
    this.slitGlow.position.set(-38.6, YA, 0); this.slitGlow.rotation.y = -Math.PI / 2; coll.add(this.slitGlow);
    const sk = knobMesh(0.9, 1.6); sk.position.set(-36.5, YA + 2.8, 0); coll.add(sk);
    coll.add(mesh(new THREE.BoxGeometry(3, YA - 14, 3), green, -16, 14 + (YA - 14) / 2 - 1.5, 0));
    coll.add(mesh(new THREE.BoxGeometry(14, 2, 3), green, -9, 14.5, 0));
    app.addComponent(new Component({
      key: 'coll', name: '平行光管', zone: 'none', fixed: true, object: coll, labelY: YA + 6 - 0,
      labelText: () => '平行光管',
      desc: '狭缝位于平行光管物镜的焦平面上时，出射平行光。狭缝宽度可调。',
      controls: () => [
        { type: 'knob', label: '狭缝套筒（前后伸缩）', get: () => this.cErr, set: (v) => (this.cErr = v), min: -6, max: 6, step: 0.02, bigStep: 0.2, perRev: 2, digits: 2, unit: 'mm', sub: '使从望远镜中看到的狭缝像最清晰' },
        { type: 'knob', label: '狭缝宽度', get: () => this.slitW, set: (v) => (this.slitW = v), min: 0.02, max: 2, step: 0.01, bigStep: 0.1, perRev: 0.5, digits: 2, unit: 'mm', sub: '宜窄而亮：谱线细锐又能看清' },
      ],
    }));

    // ---------- 载物台（可转动、可调平） ----------
    this.platG = new THREE.Group();
    this.platG.position.set(0, YA - 5.5, 0);
    this.platTop = new THREE.Group();
    this.platTop.add(mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.8, 48), MAT.alu(), 0, 0, 0));
    for (let i = 0; i < 3; i++) { const a = (i * 2 * Math.PI) / 3; const s = knobMesh(0.7, 2.2, 0x1c2029); s.position.set(Math.cos(a) * 4.6, -1.4, Math.sin(a) * 4.6); this.platTop.add(s); }
    this.platG.add(this.platTop);
    this.platG.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 5, 16), MAT.alu(), 0, -3, 0));
    app.addComponent(new Component({
      key: 'plat', name: '载物台', zone: 'none', fixed: true, object: this.platG, labelY: 9,
      desc: '载物台可绕仪器主轴转动，下方三个调平螺钉（b₁、b₂、b₃）可调节台面倾斜。',
      controls: () => [
        { type: 'knob', label: '转动载物台（粗）', get: () => this.plat, set: (v) => (this.plat = v), min: -200, max: 200, step: 0.5, bigStep: 5, perRev: 45, digits: 1, unit: '°' },
        { type: 'knob', label: '载物台微调', get: () => this.plat, set: (v) => (this.plat = v), min: -200, max: 200, step: 1 / 60, bigStep: 0.2, perRev: 1, fmt: (v) => dms(v) },
        { type: 'group', label: '调平螺钉（1 圈 = 30′）' },
        { type: 'knob', label: '螺钉 b₁', get: () => this.bx, set: (v) => (this.bx = v), min: -90, max: 90, step: 0.25, bigStep: 3, perRev: 30, digits: 1, unit: '′' },
        { type: 'knob', label: '螺钉 b₂', get: () => this.bz, set: (v) => (this.bz = v), min: -90, max: 90, step: 0.25, bigStep: 3, perRev: 30, digits: 1, unit: '′' },
        { type: 'knob', label: '螺钉 b₃（调光栅面俯仰）', get: () => this.gamG, set: (v) => (this.gamG = v), min: -60, max: 60, step: 0.25, bigStep: 3, perRev: 30, digits: 1, unit: '′', sub: '光栅放在 b₁b₂ 连线上时，只调 b₃ 不会破坏已调好的望远镜' },
      ],
    }));
    app.addSlot({ id: 'plat', pos: new THREE.Vector3(0, YA - 5.1, 0), accepts: ['mirror', 'grating'] });
    app.addSlot({ id: 'lamp', pos: new THREE.Vector3(-47, 0, 0), accepts: ['lamp'] });

    // ---------- 望远镜（绕主轴转动） ----------
    this.telG = new THREE.Group();
    this.telTilt = new THREE.Group(); this.telTilt.position.set(9, YA, 0);
    const tt = mesh(new THREE.CylinderGeometry(1.8, 1.8, 22, 32), MAT.black(), 11, 0, 0); tt.rotation.z = Math.PI / 2; this.telTilt.add(tt);
    const ep = mesh(new THREE.CylinderGeometry(1.2, 1.2, 5, 24), MAT.chrome(), 24.5, 0, 0); ep.rotation.z = Math.PI / 2; this.telTilt.add(ep);
    const abbe = mesh(new THREE.BoxGeometry(2, 2, 2.6), MAT.black(), 21.5, 0, 0); this.telTilt.add(abbe);
    this.abbeLamp = mesh(new THREE.BoxGeometry(1, 1, 1), MAT.emissive(0x6bff6b, 0), 21.5, 0, -1.8); this.telTilt.add(this.abbeLamp);
    this.telG.add(this.telTilt);
    this.telG.add(mesh(new THREE.BoxGeometry(3, YA - 16, 3), green, 16, 16 + (YA - 16) / 2 - 1.5, 0));
    this.telG.add(mesh(new THREE.BoxGeometry(18, 2, 3), green, 8, 15.5, 0));
    const tk = knobMesh(0.9, 1.6); tk.position.set(16, 17, 2.2); tk.rotation.x = Math.PI / 2; this.telG.add(tk);
    // 两个游标窗（随望远镜转动，相隔 180°）
    for (const s of [1, -1]) { const vv = mesh(new THREE.BoxGeometry(2.6, 1.2, 1.6), MAT.black(), s * 10.4, 15.2, 0); this.telG.add(vv); }
    app.addComponent(new Component({
      key: 'tel', name: '望远镜（阿贝目镜）', zone: 'none', fixed: true, object: this.telG, labelY: YA + 6,
      labelText: () => `望远镜 ${this.telLock ? '· 已锁紧' : ''}`,
      desc: '阿贝式自准直目镜：分划板下方有被小灯照亮的绿色十字，经平面镜反射回来后成像在分划板上方的叉丝处。',
      controls: () => [
        { type: 'knob', label: '目镜视度（看清叉丝）', get: () => this.diopt, set: (v) => (this.diopt = v), min: -3, max: 3, step: 0.05, bigStep: 0.5, perRev: 2, digits: 2, unit: 'D' },
        { type: 'knob', label: '目镜筒伸缩（望远镜调焦）', get: () => this.fErr, set: (v) => (this.fErr = v), min: -6, max: 6, step: 0.02, bigStep: 0.2, perRev: 2, digits: 2, unit: 'mm' },
        { type: 'toggle', label: '目镜照明（绿十字）', get: () => this.illum, set: (v) => (this.illum = v) },
        { type: 'knob', label: '望远镜俯仰螺钉', get: () => this.tau, set: (v) => (this.tau = v), min: -90, max: 90, step: 0.25, bigStep: 3, perRev: 20, digits: 1, unit: '′' },
        { type: 'group', label: '望远镜方位' },
        { type: 'toggle', label: '止动螺钉（锁紧后才能微调）', get: () => this.telLock, set: (v) => (this.telLock = v) },
        { type: 'knob', label: '转动望远镜（粗）', get: () => this.tel, set: (v) => { if (this.telLock) { this.app.toast('望远镜已锁紧，请用微调螺钉或先松开止动螺钉', 'warn'); return; } this.tel = v; }, min: -110, max: 110, step: 0.5, bigStep: 5, perRev: 45, digits: 1, unit: '°' },
        { type: 'knob', label: '望远镜微调螺钉', get: () => this.tel, set: (v) => { if (!this.telLock) { this.app.toast('微调前请先锁紧止动螺钉', 'warn'); return; } this.tel = v; }, min: -110, max: 110, step: 0.5 / 60, bigStep: 5 / 60, perRev: 0.5, fmt: (v) => `${(v >= 0 ? '+' : '−')}${dms(Math.abs(v))}` },
      ],
    }));

    // ---------- 可放置器材 ----------
    const lg = new THREE.Group();
    const lh = lampHousing(0xc7c9ff, 9, 16);
    lh.group.position.y = YA; lg.add(lh.group);
    lg.add(mesh(new THREE.BoxGeometry(4, YA - 8, 4), MAT.dark(), 0, (YA - 8) / 2, 0));
    lg.add(mesh(new THREE.BoxGeometry(14, 1.2, 12), MAT.dark(), 0, 0.6, 0));
    this.lampGlow = lh.glowMat;
    this.lampSprite = glowSprite(0xb9b5ff, 10); this.lampSprite.position.set(8, YA, 0); this.lampSprite.visible = false; lg.add(this.lampSprite);
    app.addComponent(new Component({
      key: 'lamp', name: '低压汞灯', icon: ICONS.mercury, zone: 'slot', defaultSlot: 'lamp', object: lg, labelY: YA + 12,
      desc: '汞灯在可见光区有 404.7、435.8、546.1、577.0、579.1 nm 等谱线。放在狭缝正前方。',
      controls: () => [{ type: 'toggle', label: '电源开关', get: () => this.lampOn, set: (v) => (this.lampOn = v) }],
    }));

    const mg = new THREE.Group();
    mg.add(mesh(new THREE.BoxGeometry(0.6, 4.6, 4.2), MAT.chrome(), 0, 2.6, 0));
    mg.add(mesh(new THREE.BoxGeometry(1.4, 0.8, 4.6), MAT.dark(), 0, 0.4, 0));
    app.addComponent(new Component({
      key: 'mirror', name: '双面平面镜', icon: ICONS.dmirror, zone: 'slot', defaultSlot: 'plat', object: mg, labelY: 8,
      desc: '两面均镀反射膜的平面镜，用于自准直调节。放在载物台上，镜面大致垂直于 b₁、b₂ 螺钉连线方向。',
    }));
    const gg = new THREE.Group();
    gg.add(mesh(new THREE.BoxGeometry(0.4, 4.4, 4.4), MAT.glass(0xa8d8ff, 0.55), 0, 2.8, 0));
    gg.add(mesh(new THREE.BoxGeometry(1.4, 0.8, 4.8), MAT.dark(), 0, 0.4, 0));
    app.addComponent(new Component({
      key: 'grating', name: '透射光栅', icon: ICONS.grating, zone: 'slot', defaultSlot: 'plat', object: gg, labelY: 8,
      desc: '标称 600 条/mm 的平面透射光栅（实际光栅常数待测）。',
    }));

    this.telView = app.addView({ id: 'tel', title: '望远镜视场', w: 270, h: 270, res: 1.2 });
    this.verView = app.addView({ id: 'ver', title: '游标读数（A / B）', w: 360, h: 156, res: 2 });

    // 光线
    this.beamIn = new Beam(0xdcdcff, 0.25, 1.0); scene.add(this.beamIn.group);
    this.orders = []; for (let i = 0; i < 16; i++) { const b = new Beam(0xffffff, 0.08, 0.3); scene.add(b.group); this.orders.push(b); }
  }

  canPlace(comp) {
    if ((comp.key === 'mirror' || comp.key === 'grating') && this.onPlat) return `载物台上已有${this.app.comp(this.onPlat).name}，请先取下`;
    return null;
  }

  update() {
    const app = this.app;
    this.telG.rotation.y = this.tel * D2R;
    this.telTilt.rotation.z = (this.tau / 60) * D2R * 3;
    this.platTop.rotation.set((this.bz / 60) * D2R * 3, 0, (-this.bx / 60) * D2R * 3);
    this.platG.rotation.y = this.plat * D2R;
    this.dial.rotation.y = this.tel * D2R;
    this.abbeLamp.material.emissiveIntensity = this.illum ? 2.5 : 0;
    const lampOn = this.lampOn && app.comp('lamp').placed;
    this.lampGlow.emissiveIntensity = lampOn ? 2.5 : 0;
    this.lampSprite.visible = lampOn;
    this.slitGlow.material.opacity = lampOn ? 0.9 : 0;
    // 台上元件跟随载物台
    for (const k of ['mirror', 'grating']) {
      const c = app.comp(k);
      if (c && c.placed && c.slot === 'plat') {
        c.root.position.set(0, YA - 5.1, 0);
        c.root.rotation.set(0, (this.plat + (k === 'mirror' ? this.mountM : this.mountG)) * D2R, 0);
      }
    }
    // 光线
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    if (lampOn) this.beamIn.set(P(-38, YA, 0), P(0, YA, 0), 0.5); else this.beamIn.hide();
    const sp = this.spectrum().filter((s) => s.k !== 0 && s.I > 0.02);
    this.orders.forEach((b, i) => {
      const s = sp[i];
      if (!s || !lampOn) return b.hide();
      b.setColor(rgbHex(s.nm));
      const a = s.az * D2R;
      b.set(P(0, YA, 0), P(30 * Math.cos(a), YA, -30 * Math.sin(a)), Math.min(1, s.I) * 0.6);
    });
    this.drawTelescope();
    this.drawVernier();
  }

  drawTelescope() {
    const v = this.telView, g = v.ctx, W = v.W;
    const ppd = W / 2 / FIELD; // 像素/度
    g.save();
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 4, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#07090b'; g.fillRect(0, 0, W, W);
    // 谱线（狭缝像）
    const blurBase = Math.abs(this.cErr) * 2.4 + this.telBlur();
    g.globalCompositeOperation = 'lighter';
    const slitDeg = (this.slitW / F_COLL) * R2D;
    for (const s of this.spectrum()) {
      const dx = wrap180(s.az - this.tel);
      if (Math.abs(dx) > FIELD * 1.3) continue;
      const x = W / 2 + dx * ppd;
      const w = Math.max(1.2, slitDeg * ppd);
      const I = Math.min(1, s.I * (0.4 + 0.6 * Math.min(1, this.slitW / 0.25)));
      g.filter = blurBase > 0.4 ? `blur(${Math.min(25, blurBase).toFixed(1)}px)` : 'none';
      g.fillStyle = s.nm ? rgbCss(s.nm, I) : `rgba(255,255,255,${I})`;
      g.fillRect(x - w / 2, W * 0.18, w, W * 0.64);
    }
    g.filter = 'none';
    // 绿十字反射像
    const ci = this.illum ? this.crossImage() : null;
    const h0 = W * 0.17; // 分划板上、下叉丝相对中心的距离
    if (ci) {
      const cx = W / 2 + ci.x * ppd, cy = W / 2 - h0 - ci.y * ppd;
      const b = this.telBlur() * 2;
      g.filter = b > 0.4 ? `blur(${Math.min(30, b).toFixed(1)}px)` : 'none';
      g.strokeStyle = 'rgba(110,255,120,.95)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(cx - 12, cy); g.lineTo(cx + 12, cy); g.moveTo(cx, cy - 12); g.lineTo(cx, cy + 12); g.stroke();
      g.filter = 'none';
    }
    g.globalCompositeOperation = 'source-over';
    // 分划板（含绿十字照明窗）
    const rb = Math.abs(this.diopt - this.dioptZero) * 3;
    g.filter = rb > 0.3 ? `blur(${Math.min(8, rb).toFixed(1)}px)` : 'none';
    if (this.illum) {
      g.fillStyle = 'rgba(40,140,50,.55)'; g.fillRect(W / 2 - 20, W / 2 + h0 - 18, 40, W / 2);
      g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2 - 9, W / 2 + h0); g.lineTo(W / 2 + 9, W / 2 + h0); g.moveTo(W / 2, W / 2 + h0 - 9); g.lineTo(W / 2, W / 2 + h0 + 9); g.stroke();
    }
    g.strokeStyle = this.illum || this.lampOn ? 'rgba(200,210,200,.75)' : 'rgba(120,120,120,.5)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(W / 2, 0); g.lineTo(W / 2, W);
    g.moveTo(0, W / 2); g.lineTo(W, W / 2);
    g.moveTo(W * 0.22, W / 2 - h0); g.lineTo(W * 0.78, W / 2 - h0);
    g.stroke();
    g.restore();
    let foot = '';
    if (this.assist) {
      const f = this.face();
      if (ci) foot = `${f && f.key === 'mirror' ? '镜面 ' + ci.face + '：' : ''}十字像偏离 水平 ${(ci.x * 60).toFixed(1)}′  竖直 ${(ci.y * 60).toFixed(1)}′`;
      else if (this.illum && f) foot = '看不到十字反射像：转动载物台寻找';
      else foot = `望远镜方位 ${this.tel >= 0 ? '+' : '−'}${dms(Math.abs(this.tel))}`;
    }
    v.foot(foot);
  }

  drawVernier() {
    const v = this.verView, g = v.ctx, W = v.W, H = v.H;
    const { A, B } = this.readings();
    g.fillStyle = '#20262a'; g.fillRect(0, 0, W, H);
    const drawOne = (val, y0, name) => {
      // 游标 30 格（14.5°）必须完整落在窗口内，才能读出 0′–30′
      const x0 = W * 0.1;
      const ppd = (W - 12 - x0) / 15.2;
      const hh = H / 2 - 18;
      g.fillStyle = '#ddd8c6'; g.fillRect(8, y0 + 6, W - 16, hh);
      g.save(); g.beginPath(); g.rect(8, y0 + 6, W - 16, hh); g.clip();
      g.fillStyle = '#111'; g.textAlign = 'center'; g.font = `${Math.min(H * 0.068, ppd * 0.44).toFixed(1)}px "IBM Plex Mono", Consolas, monospace`;
      // 主尺：0.5° 分度
      const start = Math.floor((val - (x0 - 8) / ppd) * 2) / 2;
      for (let a = start; a < val + (W - x0) / ppd; a += 0.5) {
        const x = x0 + (a - val) * ppd;
        const full = Math.abs(a - Math.round(a)) < 1e-6;
        const ai = ((Math.round(a * 2) / 2) % 360 + 360) % 360;
        const L = ai % 10 === 0 ? hh * 0.5 : full ? hh * 0.38 : hh * 0.25;
        g.fillRect(x - 0.45, y0 + 6, 0.9, L);
        if (full) g.fillText(String(Math.round(ai)), x, y0 + 6 + hh * 0.5 + H * 0.045);
      }
      // 游标：30 格对应主尺 29 格（14.5°）
      g.fillStyle = '#c8c2ad'; g.fillRect(8, y0 + 6 + hh * 0.6, W - 16, hh * 0.4);
      g.fillStyle = '#111';
      for (let j = 0; j <= 30; j++) {
        const x = x0 + (j * 29) / 60 * ppd;
        const L = j % 5 === 0 ? hh * 0.3 : hh * 0.18;
        g.fillRect(x - 0.45, y0 + 6 + hh - L, 0.9, L);
        if (j % 10 === 0) g.fillText(String(j), x, y0 + 6 + hh - L - 2);
      }
      g.fillStyle = '#c41e3a'; g.fillRect(x0 - 0.9, y0 + 6 + hh * 0.55, 1.8, hh * 0.45);
      g.restore();
      g.fillStyle = '#cfd6d1'; g.textAlign = 'left'; g.font = `${Math.round(H * 0.075)}px "Microsoft YaHei"`;
      g.fillText(name, 12, y0 + 6 + hh + H * 0.075);
      if (this.assist) { g.fillStyle = '#8fe3a5'; g.textAlign = 'right'; g.font = `${Math.round(H * 0.075)}px "IBM Plex Mono", Consolas`; g.fillText(dms(val), W - 12, y0 + 6 + hh + H * 0.075); }
    };
    drawOne(A, 0, '游标 A');
    drawOne(B, H / 2, '游标 B');
    v.foot('');
  }

  globalControls() {
    return [
      { type: 'readout', label: '游标 A / 游标 B', get: () => { const r = this.readings(); return this.assist ? `${dms(r.A)}  ${dms(r.B)}` : '（读数辅助已关闭）'; } },
      { type: 'toggle', label: '显示读数辅助', get: () => this.assist, set: (v) => (this.assist = v) },
    ];
  }

  tables() {
    return [{
      id: 's', title: '±1 级谱线衍射角', fixedRows: true,
      initRows: () => LINES.map((l) => ({ line: `${l.name} ${l.nm.toFixed(2)} nm` })),
      columns: [
        { key: 'line', label: '谱线（标准波长）', type: 'text', readonly: true },
        { key: 'Ap', label: '+1 级 游标A', type: 'dms' },
        { key: 'Bp', label: '+1 级 游标B', type: 'dms' },
        { key: 'Am', label: '−1 级 游标A', type: 'dms' },
        { key: 'Bm', label: '−1 级 游标B', type: 'dms' },
        { key: 'th', label: '衍射角 θ', type: 'dms', calc: (r) => thetaOf(r) },
      ],
      buttons: [{ label: '记录当前谱线的两游标读数', onClick: (t) => this.recordLine(t) }],
      note: '用望远镜微调螺钉使竖叉丝对准谱线中央后记录。读数格式如 112°35′。θ = ¼(|A₊−A₋| + |B₊−B₋|)。',
    }];
  }

  recordLine(t) {
    const sp = this.spectrum().filter((s) => Math.abs(s.k) === 1 && LINES.some((l) => l.nm === s.nm));
    let best = null;
    for (const s of sp) { const dx = Math.abs(wrap180(s.az - this.tel)); if (!best || dx < best.dx) best = { ...s, dx }; }
    if (!best || best.dx > 0.25) { this.app.toast('视场中央没有需要测量的 ±1 级谱线（紫、绿、黄₁、黄₂）', 'warn'); return; }
    if (best.dx * 60 > 1.5) this.app.toast(`竖叉丝没有对准谱线中央（偏差约 ${(best.dx * 60).toFixed(1)}′）`, 'warn');
    if (!this.telLock) this.app.toast('提示：读数前应锁紧望远镜止动螺钉', 'warn');
    const i = LINES.findIndex((l) => l.nm === best.nm);
    const r = this.readings();
    const q = (x) => Math.round((x + gauss(0.25 / 60)) * 60) / 60;
    const sfx = best.k > 0 ? 'p' : 'm';
    t.set(i, 'A' + sfx, q(r.A));
    t.set(i, 'B' + sfx, q(r.B));
  }

  steps() {
    const app = this.app;
    const telSharp = () => Math.abs(this.fErr) < 0.08;
    const level = () => { const f = this.face(); if (!f || f.key !== 'mirror') return false; return Math.abs(f.elA - this.tau) < 1.2 && Math.abs(f.elB - this.tau) < 1.2; };
    const gratingOk = () => { const f = this.face(); return f && f.key === 'grating' && Math.abs(wrap180(this.plat + this.mountG)) < 0.1 && Math.abs(f.elA - this.tau) < 2; };
    return [
      {
        title: '目镜调焦：看清分划板叉丝',
        html: '<p>选中<b>望远镜</b>，打开目镜照明，转动目镜视度，直到分划板上的叉丝和下方的绿色十字窗最清晰。</p>',
        check: () => Math.abs(this.diopt - this.dioptZero) < 0.12 && this.illum,
        status: () => (this.illum ? '' : '<b>先打开目镜照明</b>'),
        auto: async () => { await app.view('全景'); app.select(app.comp('tel')); this.illum = true; app.changed(); await app.tween(() => this.diopt, (v) => (this.diopt = v), this.dioptZero + gauss(0.03), 1000); },
      },
      {
        title: '把双面平面镜放上载物台',
        html: '<p>把<b>双面平面镜</b>放在载物台中央，使镜面大致垂直于载物台螺钉 b₁、b₂ 的连线。</p>',
        check: () => this.onPlat === 'mirror',
        auto: async () => { await app.autoPlace('mirror'); },
      },
      {
        title: '自准直法：望远镜聚焦于无穷远',
        html: '<p>转动载物台，使平面镜一面正对望远镜，在视场中找到<b>绿十字的反射像</b>（可能很模糊）。调节目镜筒伸缩，使绿十字像最清晰——此时分划板位于物镜焦平面，望远镜已聚焦于无穷远。</p>',
        hint: '先从望远镜外侧目测，使镜面法线大致对着望远镜，再在视场里找。看不到时也可能是十字像偏到视场上方或下方，可先略调俯仰。',
        check: () => telSharp() && !!this.crossImage(),
        status: () => (this.crossImage() ? (telSharp() ? '' : '十字像<b>仍模糊</b>') : '视场中<b>还没有</b>绿十字反射像'),
        auto: async () => {
          await app.view('载物台');
          app.select(app.comp('plat'));
          const target = this.tel - this.mountM + gauss(0.15);
          await app.tween(() => this.plat, (v) => (this.plat = v), target, 1400);
          const ci = this.crossImage();
          if (ci && Math.abs(ci.y) > FIELD * 0.6) { app.say('十字像偏出视场，先略调望远镜俯仰把它找回来'); await app.tween(() => this.tau, (v) => (this.tau = v), this.tau + (this.face().elA - this.tau) * 0.6, 800); }
          app.select(app.comp('tel'));
          await app.tween(() => this.fErr, (v) => (this.fErr = v), gauss(0.02), 1200);
        },
      },
      {
        title: '各半调节：望远镜光轴垂直于仪器转轴',
        html: '<p>观察镜面 A 的十字像与<b>上叉丝</b>的竖直距离 $h$：调<b>望远镜俯仰螺钉</b>消除 $h/2$，再调<b>载物台螺钉 b₁</b> 消除另一半。把载物台转过 180°，对镜面 B 重复。反复几次，直到两面的十字像都与上叉丝重合。</p>',
        hint: '若一面的十字像在上叉丝之上、另一面在下，说明主要是载物台不平；若两面都偏同一侧，说明主要是望远镜俯仰不对。',
        check: level,
        status: () => { const f = this.face(); if (!f || f.key !== 'mirror') return '需要双面镜在载物台上'; return `A 面偏差 <b>${(2 * (f.elA - this.tau)).toFixed(1)}′</b>，B 面偏差 <b>${(2 * (f.elB - this.tau)).toFixed(1)}′</b>（均需 &lt; 2.4′）`; },
        auto: async () => {
          await app.view('载物台');
          for (let it = 0; it < 3; it++) {
            for (const side of [0, 180]) {
              app.select(app.comp('plat'));
              const target = this.tel - this.mountM + side + gauss(0.1);
              await app.tween(() => this.plat, (v) => (this.plat = v), target, 900);
              const f = this.face();
              const el = side ? f.elB : f.elA;
              const h = el - this.tau;
              app.select(app.comp('tel'));
              app.say(`镜面 ${side ? 'B' : 'A'}：偏差 ${(2 * h).toFixed(1)}′，调望远镜消除一半，再调载物台消除另一半`);
              await app.tween(() => this.tau, (v) => (this.tau = v), this.tau + h / 2, 700);
              app.select(app.comp('plat'));
              // 镜面 A 仰角对 b₁ 的灵敏度为 cos(镜面在台面上的方位)，B 面与之相反
              const deriv = (side ? -1 : 1) * Math.cos(this.mountM * D2R);
              await app.tween(() => this.bx, (v) => (this.bx = v), this.bx - h / 2 / (Math.abs(deriv) > 0.2 ? deriv : Math.sign(deriv || 1) * 0.2), 700);
            }
          }
        },
      },
      {
        title: '调节平行光管：出射平行光',
        html: '<p>取下平面镜，把<b>汞灯</b>放在狭缝前并打开。转动望远镜对准平行光管，看到狭缝像。调节<b>狭缝套筒</b>使狭缝像最清晰（狭缝位于平行光管焦平面），再把<b>狭缝宽度</b>调到约 0.1–0.3 mm。</p>',
        check: () => this.lampOn && app.comp('lamp').placed && !this.onPlat && Math.abs(this.cErr) < 0.08 && this.slitW > 0.06 && this.slitW < 0.35 && Math.abs(this.tel) < 1.2,
        status: () => `狭缝宽度 <b>${this.slitW.toFixed(2)} mm</b>，望远镜方位 <b>${this.tel.toFixed(1)}°</b>`,
        auto: async () => {
          app.remove(app.comp('mirror'));
          await app.view('全景');
          await app.autoPlace('lamp'); this.lampOn = true; app.changed();
          app.select(app.comp('tel'));
          this.telLock = false;
          await app.tween(() => this.tel, (v) => (this.tel = v), gauss(0.2), 1200);
          app.select(app.comp('coll'));
          await app.tween(() => this.cErr, (v) => (this.cErr = v), gauss(0.02), 1100);
          await app.tween(() => this.slitW, (v) => (this.slitW = v), 0.18, 900);
        },
      },
      {
        title: '放置光栅，使光栅面垂直于入射光',
        html: '<p>使望远镜的竖叉丝对准狭缝像（零级），<b>锁紧望远镜</b>。把<b>光栅</b>放到载物台上，转动载物台，使光栅面反射回来的绿十字像与上叉丝的交点重合（必要时调载物台螺钉 b₃ 使其竖直方向重合，不要再动望远镜俯仰）。此时光栅平面垂直于平行光管光轴。</p>',
        check: gratingOk,
        status: () => { const f = this.face(); if (!f || f.key !== 'grating') return '载物台上还没有光栅'; return `入射角 <b>${(wrap180(this.plat + this.mountG) * 60).toFixed(1)}′</b>（需 &lt; 6′），竖直偏差 <b>${(2 * (f.elA - this.tau)).toFixed(1)}′</b>`; },
        auto: async () => {
          app.select(app.comp('tel')); this.telLock = true; app.changed();
          await app.tween(() => this.tel, (v) => (this.tel = v), 0, 600);
          this.illum = true;
          await app.autoPlace('grating');
          await app.view('载物台');
          app.select(app.comp('plat'));
          await app.tween(() => this.plat, (v) => (this.plat = v), -this.mountG + gauss(0.02), 1400);
          const f = this.face();
          const h = f.elA - this.tau;
          if (Math.abs(h) > 0.8) await app.tween(() => this.gamG, (v) => (this.gamG = v), this.gamG - h + gauss(0.2), 800);
        },
      },
      {
        title: '测量 ±1 级谱线的衍射角',
        html: '<p>松开止动螺钉，向一侧转动望远镜找到 +1 级光谱，锁紧后用<b>微调螺钉</b>使竖叉丝依次对准紫、绿、黄₁、黄₂ 谱线中央，记录游标 A、B 的读数；再到另一侧测 −1 级。</p>',
        hint: '游标读数：先读游标零线左边主尺读数（0.5° 分度），再找游标上与主尺刻线对齐的那一条，第 n 条即为 n′。',
        check: () => app.table('s').completeRows().length >= 4,
        status: () => { const t = app.table('s'); const n = t.rows.reduce((s, r) => s + ['Ap', 'Am'].filter((k) => r[k] != null).length, 0); return `已测 <b>${n}</b> / 8 条谱线位置`; },
        auto: async () => {
          await app.view('全景');
          app.select(app.comp('tel'));
          for (const sign of [1, -1]) {
            this.telLock = false; app.changed();
            const sp = this.spectrum();
            const g1 = sp.find((s) => s.k === sign && s.nm === 546.07);
            await app.tween(() => this.tel, (v) => (this.tel = v), g1.az + sign * 1.5, 1500);
            this.telLock = true; app.changed();
            const order = sign > 0 ? [435.83, 546.07, 576.96, 579.07] : [435.83, 546.07, 576.96, 579.07];
            for (const nm of order) {
              const s = this.spectrum().find((x) => x.k === sign && x.nm === nm);
              await app.tween(() => this.tel, (v) => (this.tel = v), s.az + gauss(0.2 / 60), 700);
              await app.record('s');
            }
          }
        },
      },
      {
        title: '数据处理：光栅常数与谱线波长',
        html: '<p>由光栅方程 $d\\sin\\theta=k\\lambda$，用汞绿线（546.07 nm）求光栅常数 $d$，再由 $\\lambda=d\\sin\\theta$ 求其他谱线波长。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const t = this.app.table('s');
    const rows = t.rows.map((r, i) => ({ ...r, nm: LINES[i].nm, name: LINES[i].name, th: thetaOf(r) }));
    const g = rows[1];
    if (!isFinite(g.th)) return { html: '<p>需要先测出汞绿线（546.07 nm）的 ±1 级衍射角。</p>', ok: false };
    const uTh = (1 / 60) * D2R / Math.sqrt(3) / 2; // 游标分度 1′，θ = (|ΔA|+|ΔB|)/4：u = √4·(1′/√3)/4
    const d = (546.07e-6) / Math.sin(g.th * D2R);
    const ud = d * (uTh / Math.tan(g.th * D2R));
    let html = `<h3>衍射角</h3><table><tr><th>谱线</th><th>θ</th><th>sin θ</th><th>λ = d·sinθ /nm</th><th>标准值 /nm</th><th>相对误差</th></tr>`;
    for (const r of rows) {
      if (!isFinite(r.th)) { html += `<tr><td>${r.name}</td><td colspan="5">未测</td></tr>`; continue; }
      const lam = d * Math.sin(r.th * D2R) * 1e6;
      html += `<tr><td>${r.name}</td><td>${dms(r.th)}</td><td>${Math.sin(r.th * D2R).toFixed(5)}</td><td>${r === g ? '（定标）' : lam.toFixed(1)}</td><td>${r.nm.toFixed(2)}</td><td>${r === g ? '—' : pct(relErr(lam, r.nm))}</td></tr>`;
    }
    html += `</table>
      <h3>光栅常数</h3><p>$d=\\dfrac{\\lambda_{绿}}{\\sin\\theta_{绿}}=${(d * 1e3).toFixed(4)}\\ \\mu m$，$u(d)=d\\cot\\theta\\,u(\\theta)$，取 $u(\\theta)≈${(uTh * R2D * 60).toFixed(2)}'$</p>
      <div class="result-box">$d = ${texU(d * 1e3, ud * 1e3, '\\mu m')}$，即 ${(1 / d).toFixed(1)} 条/mm</div>
      <div class="result-box warn">本次光栅的光栅常数参考值 d₀ = ${(this.d * 1e3).toFixed(4)} μm（${this.lines.toFixed(1)} 条/mm），相对误差 ${pct(relErr(d, this.d))}。双游标读数消除了刻度盘偏心差（本仪器偏心约 ${(this.ecc * 60).toFixed(1)}′）。</div>`;
    return { html, ok: true, plots: [], answers: [{ label: '光栅常数 $d$', unit: 'μm', value: d * 1e3, digits: 4, tolRel: 0.003 }] };
  }

  principle() {
    return `<h3>1. 分光计的三个调节要求</h3><p>① 望远镜聚焦于无穷远（接收平行光）；② 望远镜光轴与平行光管光轴都垂直于仪器转轴；③ 平行光管出射平行光。</p>
<h3>2. 自准直法与各半调节法</h3><p>阿贝目镜下方的绿十字经物镜成平行光，被平面镜反射后再会聚在分划板上。十字像清晰说明分划板位于物镜焦面上；十字像与上叉丝重合，说明望远镜光轴垂直于镜面。双面镜正反两面都满足时，望远镜光轴才垂直于仪器转轴。若某面十字像偏离上叉丝 $h$，由于偏差同时来自望远镜俯仰 $\\tau$ 与镜面法线倾角 $\\varepsilon$：</p>$$h_A=2(\\varepsilon-\\tau),\\qquad h_B=2(-\\varepsilon-\\tau)$$<p>所以每次各调一半最快收敛。</p>
<h3>3. 光栅方程</h3><p>平行光垂直入射到光栅常数为 $d$ 的透射光栅上，第 $k$ 级主极大满足</p>$$d\\sin\\theta_k=k\\lambda$$<p>斜入射（入射角 $i$）时为 $d(\\sin\\theta-\\sin i)=k\\lambda$。取 ±1 级的平均可以减小入射角误差的影响。</p>
${FIG.gratingFig()}
<h3>4. 双游标读数</h3><p>刻度盘中心与转轴不重合时，单个游标读数含偏心差 $e\\sin\\varphi$，两个相隔 180° 的游标误差大小相等、符号相反，取平均即可消除：</p>$$\\theta=\\tfrac14\\left(|A_+-A_-|+|B_+-B_-|\\right)$$
<h3>5. 本仿真的计算模型</h3><p>程序按光栅方程计算汞灯各谱线各级的出射方向，强度由单缝衍射因子 $\\left(\\frac{\\sin u}{u}\\right)^2$ 调制（缝宽取 0.42d）；十字反射像的位置由镜面法线方位、仰角和望远镜俯仰按反射定律计算；刻度盘带有约 2′ 的偏心误差。</p>`;
  }
}

function thetaOf(r) {
  const vals = [r.Ap, r.Bp, r.Am, r.Bm];
  if (vals.some((v) => v == null || !isFinite(v))) return NaN;
  const dA = Math.abs(wrap180(r.Ap - r.Am)), dB = Math.abs(wrap180(r.Bp - r.Bm));
  return (dA + dB) / 4;
}
