// 实验：旋光仪测糖溶液的旋光率与浓度（三分视场 · 双游标读数 · 零点校正）
import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { MAT, mesh, labTable, lampHousing, glowSprite, ICONS, knobMesh, canvasTexture } from '../core/Models.js';
import { linFit, mean, stdev, gauss, rand, relErr, pct, texU } from '../core/Stats.js';
import { lineData } from '../core/Plot.js';

const AY = 20; // 旋光仪光轴高度
const SPEC20 = 66.53; // 蔗糖 20 °C、589.3 nm 的比旋光度 °·mL·g⁻¹·dm⁻¹
const TUBES = [
  { key: 'w', name: '蒸馏水（2 dm）', c: 0, l: 2, short: '水' },
  { key: 's5', name: '蔗糖 0.050 g/mL（2 dm）', c: 0.05, l: 2, short: '0.050' },
  { key: 's10', name: '蔗糖 0.100 g/mL（2 dm）', c: 0.1, l: 2, short: '0.100' },
  { key: 's15', name: '蔗糖 0.150 g/mL（2 dm）', c: 0.15, l: 2, short: '0.150' },
  { key: 's20', name: '蔗糖 0.200 g/mL（2 dm）', c: 0.2, l: 2, short: '0.200' },
  { key: 'sx', name: '蔗糖 浓度未知（2 dm）', c: null, l: 2, short: '未知' },
  { key: 's10s', name: '蔗糖 0.100 g/mL（1 dm）', c: 0.1, l: 1, short: '0.100/1dm' },
];
const ROWS = [['w', 3], ['s5', 2], ['s10', 2], ['s15', 2], ['s20', 2], ['sx', 2], ['s10s', 2]];
const wrap360 = (v) => ((v % 360) + 360) % 360;
const signed = (v) => { v = wrap360(v); return v > 180 ? v - 360 : v; };
const q05 = (v) => Math.round(v * 20) / 20;

export class PolarimeterExperiment {
  static meta = {
    id: 'polarimeter',
    title: '旋光仪测糖溶液浓度',
    subtitle: '半荫法三分视场找“暗度相等” · 零点校正 · 比旋光度与未知浓度',
    tags: ['波动光学', '偏振', '旋光'],
    level: '基础',
    time: '40 min',
    color: '#7a5a12',
    formula: String.raw`\varphi=[\alpha]\,l\,c`,
    measure: '比旋光度 [α]、未知溶液浓度 c',
    goals: ['观察线偏振光通过旋光物质时振动面的旋转', '掌握旋光仪（半荫式）的结构和使用方法，学会用“暗度相等”判断零点', '测定蔗糖溶液的比旋光度，并由旋光角求未知溶液浓度'],
    questions: ['为什么要选“暗度相等”而不是“亮度相等”的视场作为测量位置？', '两个游标读数取平均消除了什么误差？', '试管中有气泡时应如何处理？为什么？', '如何判断一种溶液是右旋还是左旋？'],
  };

  static thumb(ctx, w, h) {
    ctx.fillStyle = '#0e0c08'; ctx.fillRect(0, 0, w, h);
    const r = Math.min(w, h) * 0.36, cx = w / 2, cy = h / 2;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#6b4d10'; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.fillStyle = '#2a1e06'; ctx.fillRect(cx - r * 0.22, cy - r, r * 0.44, 2 * r);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,220,150,.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }

  constructor(app) {
    this.app = app;
    this.lampOn = false; this.warm = 0;
    this.R = rand(20, 340); // 检偏器刻度盘读数（度）
    this.off = rand(-0.6, 0.6); // 刻度盘零点误差
    this.phi = rand(2.2, 3.2); // 半荫角的一半
    this.ecc = rand(0.04, 0.09); this.eccPh = rand(0, 360); // 刻度盘偏心
    this.dio = 0; this.dioNeed = rand(-3, 3);
    this.temp = Math.round(rand(17, 26) * 10) / 10;
    this.cover = true;
    this.cx = rand(0.07, 0.18); // 未知浓度
    this.cErr = Object.fromEntries(TUBES.map((t) => [t.key, 1 + gauss(0.003)]));
    this.bubble = Object.fromEntries(TUBES.map((t) => [t.key, Math.random() < 0.6]));
    this.assist = false;
  }

  /** 当前试管 */
  tube() { const z = this.app.zones.find((z) => z.id === 'chamber'); return z && z.occupant ? TUBES.find((t) => t.key === z.occupant.key) : null; }
  conc(t) { return (t.c ?? this.cx) * this.cErr[t.key]; }
  specific() { return SPEC20 * (1 - 3.7e-4 * (this.temp - 20)); }
  /** 样品的旋光角（右旋为正） */
  alpha() { const t = this.tube(); return t ? this.specific() * t.l * this.conc(t) : 0; }
  readings() {
    const d = this.ecc * Math.sin(((this.R + this.eccPh) * Math.PI) / 180);
    return { A: wrap360(this.R + d), B: wrap360(this.R - d) };
  }
  /** 三分视场两侧/中间的亮度 */
  field() {
    if (!this.lampOn || !this.app.comp('lamp').placed) return { out: 0, mid: 0 };
    const D = ((this.R + this.off - this.alpha()) * Math.PI) / 180, p = (this.phi * Math.PI) / 180;
    const t = this.tube(), T = t ? (t.c === 0 ? 0.96 : 0.9) : 1;
    const eps = 2.5e-4, stray = this.cover ? 0 : 0.04;
    const f = (x) => this.warm * (T * ((1 - eps) * Math.sin(x) ** 2 + eps) + stray);
    return { out: f(D + p), mid: f(D - p) };
  }

  cameras() {
    return [
      { name: '全景', pos: [10, 62, 100], target: [0, 14, 0] },
      { name: '样品室', pos: [2, 48, 58], target: [0, AY - 2, 0] },
      { name: '目镜端', pos: [58, 34, 34], target: [34, AY, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(170, 80); t.position.set(0, 0, 0); scene.add(t);
    app.stage.setLightTarget(0, 0, 0);

    // 旋光仪主体：底座、立柱、镜筒、样品室、刻度盘与目镜
    const body = new THREE.Group();
    body.add(mesh(new THREE.BoxGeometry(56, 2.4, 16), MAT.paint(0x3a3f47), 4, 1.2, 0));
    body.add(mesh(new THREE.BoxGeometry(5, AY - 4, 6), MAT.paint(0x3a3f47), 4, (AY - 4) / 2 + 2.4, 0));
    const cyl = (r, len, x, mat) => { const m = mesh(new THREE.CylinderGeometry(r, r, len, 36), mat, x, AY, 0); m.rotation.z = Math.PI / 2; body.add(m); return m; };
    cyl(3.2, 14, -21, MAT.paint(0xe4e0d6)); // 起偏镜筒
    cyl(3.2, 10, 21, MAT.paint(0xe4e0d6)); // 检偏镜筒
    // 样品室（槽 + 可开合的盖）
    body.add(mesh(new THREE.BoxGeometry(28, 1, 7.4), MAT.paint(0xe4e0d6), 0, AY - 3.7, 0));
    body.add(mesh(new THREE.BoxGeometry(28, 6.4, 0.6), MAT.paint(0xe4e0d6), 0, AY - 0.4, -3.4));
    this.lid = new THREE.Group();
    const lidM = mesh(new THREE.CylinderGeometry(3.8, 3.8, 28, 36, 1, true, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0xe4e0d6, metalness: 0.2, roughness: 0.5, side: THREE.DoubleSide }));
    lidM.rotation.z = Math.PI / 2; lidM.rotation.y = Math.PI; lidM.position.set(0, 0, 3.6); this.lid.add(lidM);
    this.lid.position.set(0, AY, -3.6); body.add(this.lid);
    // 刻度盘
    const dialTex = canvasTexture(1024, 1024, (ctx, W) => {
      ctx.fillStyle = '#e9e4d6'; ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2, 0, 7); ctx.fill();
      ctx.translate(W / 2, W / 2); ctx.fillStyle = '#1b1b1b'; ctx.strokeStyle = '#1b1b1b';
      for (let a = 0; a < 360; a++) {
        ctx.save(); ctx.rotate((a * Math.PI) / 180);
        const L = a % 10 === 0 ? 46 : a % 5 === 0 ? 32 : 20; ctx.lineWidth = a % 10 === 0 ? 3 : 1.6;
        ctx.beginPath(); ctx.moveTo(0, -W / 2 + 8); ctx.lineTo(0, -W / 2 + 8 + L); ctx.stroke();
        if (a % 10 === 0) { ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.fillText(String(a > 180 ? a - 360 : a), 0, -W / 2 + 92); }
        ctx.restore();
      }
      ctx.fillStyle = '#b8ab88'; ctx.beginPath(); ctx.arc(0, 0, W / 2 - 120, 0, 7); ctx.fill();
    });
    this.dial = new THREE.Group();
    const dm = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 1.2, 72), [MAT.brass(), new THREE.MeshStandardMaterial({ map: dialTex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: dialTex, roughness: 0.6 })]);
    dm.rotation.z = Math.PI / 2; this.dial.add(dm);
    this.dial.position.set(27, AY, 0); body.add(this.dial);
    // 游标窗（两侧）
    for (const s of [-1, 1]) {
      const w = mesh(new THREE.BoxGeometry(2.4, 2.6, 3.2), MAT.dark(), 28.6, AY + s * 7.2, 0); body.add(w);
      const lens = mesh(new THREE.CylinderGeometry(1, 1, 0.4, 20), MAT.glass(0xdde8ff, 0.5), 30, AY + s * 7.2, 0); lens.rotation.z = Math.PI / 2; body.add(lens);
    }
    cyl(2, 8, 33, MAT.dark()); // 目镜筒
    this.eyeRing = cyl(2.4, 1.6, 36.5, MAT.paint(0x111317)); // 视度调节圈
    cyl(1.6, 2, 38.2, MAT.black());
    // 手轮（粗/细）
    this.wheel = knobMesh(2.6, 1.6, 0x23262b); this.wheel.position.set(24, AY - 9.5, 6); this.wheel.rotation.x = Math.PI / 2; body.add(this.wheel);
    this.wheelF = knobMesh(1.3, 1.8, 0x23262b); this.wheelF.position.set(24, AY - 9.5, 8.2); this.wheelF.rotation.x = Math.PI / 2; body.add(this.wheelF);
    app.addSlot({ id: 'lamp', pos: new THREE.Vector3(-40, 0, 0), accepts: ['lamp'] });
    app.addSlot({ id: 'chamber', pos: new THREE.Vector3(0, AY, 0), accepts: TUBES.map((t) => t.key) });

    app.addComponent(new Component({
      key: 'body', name: '圆盘旋光仪', zone: 'none', fixed: true, object: body, labelY: 34,
      desc: '起偏镜后装有半荫片（石英条），把视场分为左、中、右三部分。转动手轮带动检偏镜和刻度盘，从两侧游标窗读数，分度值 1°，游标精度 0.05°。',
      controls: () => [
        { type: 'knob', label: '手轮（粗调）', get: () => this.R, set: (v) => (this.R = v), wrap: 360, step: 0.5, bigStep: 5, perRev: 30, digits: 2, unit: '°', fmt: () => '转动检偏器' },
        { type: 'knob', label: '手轮（微调）', get: () => this.R, set: (v) => (this.R = v), wrap: 360, step: 0.01, bigStep: 0.1, perRev: 1, fmt: () => '转动检偏器' },
        { type: 'knob', label: '目镜视度调节', get: () => this.dio, set: (v) => (this.dio = v), min: -5, max: 5, step: 0.1, bigStep: 1, perRev: 4, digits: 1, unit: 'D', sub: '使三分视场的分界线最清晰' },
        { type: 'toggle', label: '样品室盖', get: () => this.cover, set: (v) => (this.cover = v) },
      ],
    }));

    const lg = new THREE.Group();
    lg.add(mesh(new THREE.BoxGeometry(10, 2, 10), MAT.paint(0x2d3748), 0, 1, 0));
    const lh = lampHousing(0xffb300, 9, 14); lh.group.position.set(0, AY - 2, 0); lg.add(lh.group);
    lg.add(mesh(new THREE.BoxGeometry(2, AY - 9, 2), MAT.metal(), 0, (AY - 9) / 2 + 2, 0));
    this.lampGlow = lh.glowMat;
    this.lampSprite = glowSprite(0xffb800, 10); this.lampSprite.position.set(8, AY - 2, 0); this.lampSprite.visible = false; lg.add(this.lampSprite);
    app.addComponent(new Component({
      key: 'lamp', name: '钠光灯', icon: ICONS.sodium, zone: 'slot', defaultSlot: 'lamp', required: true, object: lg, labelY: 34,
      desc: '低压钠灯，D 双线平均波长 589.3 nm。开灯后需预热，亮度稳定后再测量。',
      controls: () => [{ type: 'toggle', label: '电源开关', get: () => this.lampOn, set: (v) => (this.lampOn = v) }, { type: 'readout', label: '预热', get: () => (this.lampOn ? `${Math.round(this.warm * 100)}%` : '未开灯') }],
    }));

    for (const tb of TUBES) {
      const g = new THREE.Group(), L = tb.l * 10;
      const glass = mesh(new THREE.CylinderGeometry(1.15, 1.15, L, 28, 1, true), MAT.glass(tb.c === 0 ? 0xd8ecff : 0xf6efd2, 0.32)); glass.rotation.z = Math.PI / 2; g.add(glass);
      const liq = mesh(new THREE.CylinderGeometry(1.0, 1.0, L - 0.4, 24), new THREE.MeshStandardMaterial({ color: tb.c === 0 ? 0xcfe6ff : 0xf2e3a6, transparent: true, opacity: 0.35 + (tb.c ?? 0.12) * 1.2, roughness: 0.1, depthWrite: false })); liq.rotation.z = Math.PI / 2; g.add(liq);
      const neck = mesh(new THREE.SphereGeometry(1.5, 20, 12), MAT.glass(0xffffff, 0.3), L / 2 - 2.5, 0.4, 0); neck.scale.set(1.3, 1, 1); g.add(neck);
      for (const s of [-1, 1]) { const cap = mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.4, 24), MAT.brass(), (s * L) / 2, 0, 0); cap.rotation.z = Math.PI / 2; g.add(cap); }
      const bub = mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, roughness: 0.05, metalness: 0.2 }), -L / 6, 0.6, 0);
      g.add(bub); tb.bub = bub; tb.L = L;
      app.addComponent(new Component({
        key: tb.key, name: `试管：${tb.name}`, icon: ICONS.tube, zone: 'slot', defaultSlot: 'chamber', required: tb.key === 'w', object: g, labelY: 6,
        desc: tb.c === 0 ? '装满蒸馏水的 2 dm 试管，用于零点校正。管上有一个凸颈，可把气泡赶进去。' : `${tb.name}。试管凸颈用于容纳气泡，测量前应把气泡赶到凸颈处，以免挡住光路。`,
        controls: () => [{ type: 'segment', label: '管内气泡', get: () => this.bubble[tb.key], set: (v) => (this.bubble[tb.key] = v), options: [{ label: '在通光区', value: true }, { label: '已赶到凸颈处', value: false }] }],
      }));
    }

    this.fv = app.addView({ id: 'field', title: '目镜视场（三分视场）', w: 250, h: 250, res: 1.6 });
    this.vv = app.addView({ id: 'ver', title: '游标读数窗（左 A / 右 B）', w: 320, h: 170, res: 1.8 });
  }

  canPlace(comp) {
    if (TUBES.some((t) => t.key === comp.key)) {
      if (this.cover) return '请先打开样品室盖';
      const z = this.app.zones.find((z) => z.id === 'chamber');
      if (z && z.occupant) return `样品室中已有「${z.occupant.name}」，请先取出`;
    }
    return null;
  }

  tick(dt) {
    if (this.lampOn && this.warm < 1) { this.warm = Math.min(1, this.warm + dt / 4); this.app.changed(); }
    if (!this.lampOn && this.warm > 0) { this.warm = 0; this.app.changed(); }
  }

  update() {
    const on = this.lampOn && this.app.comp('lamp').placed;
    this.lampGlow.emissiveIntensity = on ? 2.4 * this.warm : 0;
    this.lampSprite.visible = on;
    this.dial.rotation.x = (this.R * Math.PI) / 180;
    this.wheel.rotation.y = (this.R * Math.PI) / 18;
    this.wheelF.rotation.y = (this.R * Math.PI) / 1.8;
    this.eyeRing.rotation.x = this.dio;
    this.lid.rotation.x = this.cover ? 0 : -1.9;
    for (const tb of TUBES) tb.bub.position.set(this.bubble[tb.key] ? -tb.L / 6 : tb.L / 2 - 2.5, this.bubble[tb.key] ? 0.6 : 1.1, 0);
    this.drawField();
    this.drawVernier();
  }

  drawField() {
    const v = this.fv, g = v.ctx, W = v.W, Hh = v.H, cx = W / 2, cy = Hh / 2, r = W * 0.44;
    g.fillStyle = '#050403'; g.fillRect(0, 0, W, Hh);
    const { out, mid } = this.field();
    const lum = (I) => (I <= 0 ? 0 : Math.max(0, (Math.log10(I + 1e-4) + 4) / 4)); // 人眼近似对数响应
    const m = (lum(out) + lum(mid)) / 2; // 人眼对相邻区域亮度差的对比增强（侧抑制）
    const col = (I) => { const b = Math.min(1, Math.max(0, m + (lum(I) - m) * 2.5)); return `rgb(${Math.round(255 * b)},${Math.round(196 * b ** 1.15)},${Math.round(70 * b ** 1.6)})`; };
    const blur = Math.min(10, Math.abs(this.dio - this.dioNeed) * 2.4) * (W / 250);
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    g.filter = blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : 'none';
    g.fillStyle = col(out); g.fillRect(cx - r - 12, cy - r - 12, 2 * r + 24, 2 * r + 24);
    g.fillStyle = col(mid); g.fillRect(cx - r * 0.2, cy - r - 12, r * 0.4, 2 * r + 24);
    const t = this.tube();
    if (t && this.bubble[t.key] && out + mid > 0) { // 气泡：边缘发暗的圆斑
      const gr = g.createRadialGradient(cx + r * 0.35, cy - r * 0.2, 2, cx + r * 0.35, cy - r * 0.2, r * 0.36);
      gr.addColorStop(0, 'rgba(255,240,200,.25)'); gr.addColorStop(0.75, 'rgba(0,0,0,.65)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx + r * 0.35, cy - r * 0.2, r * 0.36, 0, 7); g.fill();
    }
    g.restore(); g.filter = 'none';
    g.strokeStyle = '#2a2620'; g.lineWidth = W * 0.02; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    let foot;
    if (!this.lampOn) foot = '钠光灯未开';
    else if (this.warm < 0.95) foot = `钠灯预热中 ${Math.round(this.warm * 100)}%`;
    else if (this.assist) foot = `两侧 ${(lum(out) * 100).toFixed(1)}  中间 ${(lum(mid) * 100).toFixed(1)}（相对亮度）`;
    else foot = blur > 2 ? '视场模糊：调节目镜视度' : '找两侧与中间“暗度相等”且整体较暗的位置';
    v.foot(foot);
  }

  drawVernier() {
    const v = this.vv, g = v.ctx, W = v.W, Hh = v.H;
    const { A, B } = this.readings();
    g.fillStyle = '#1f2224'; g.fillRect(0, 0, W, Hh);
    const fs = Math.round(Hh * 0.085);
    const one = (val, y0, name) => {
      const x0 = 8, ww = W - 16, hh = Hh / 2 - 8, ppd = ww / 23, xc = x0 + ww * 0.1;
      g.save(); g.beginPath(); g.rect(x0, y0 + 4, ww, hh); g.clip();
      g.fillStyle = '#ddd6c0'; g.fillRect(x0, y0 + 4, ww, hh);
      g.fillStyle = '#121212'; g.textAlign = 'center'; g.font = `${fs}px Arial`;
      const s = signed(val), top = y0 + 4;
      for (let a = Math.floor(s - 4); a <= s + 22; a++) {
        const x = xc + (a - s) * ppd, L = a % 5 === 0 ? hh * 0.34 : hh * 0.22;
        g.fillRect(x - 0.7, top, 1.4, L);
        if (a % 5 === 0) g.fillText(String(a), x, top + hh * 0.34 + fs);
      }
      // 游标：20 格对应主尺 19 格，精度 0.05°
      g.fillStyle = '#c9c0a4'; g.fillRect(x0, top + hh * 0.6, ww, hh * 0.4);
      g.fillStyle = '#121212'; g.font = `${Math.round(fs * 0.85)}px Arial`;
      for (let j = 0; j <= 20; j++) {
        const x = xc + ((j * 19) / 20) * ppd, L = j % 5 === 0 ? hh * 0.2 : hh * 0.12;
        g.fillRect(x - 0.6, top + hh - L, 1.2, L);
        if (j % 5 === 0) g.fillText(String(j), x, top + hh - L - 3);
      }
      g.fillStyle = '#c41e3a'; g.fillRect(xc - 1, top + hh * 0.6, 2, hh * 0.4);
      g.restore();
      g.fillStyle = '#5b5446'; g.textAlign = 'left'; g.font = `bold ${fs}px "Microsoft YaHei"`;
      g.fillText(name, x0 + 4, top + hh * 0.6 + fs * 1.15);
      if (this.assist) { g.fillStyle = 'rgba(20,22,24,.8)'; g.fillRect(x0 + ww - fs * 4.4, top, fs * 4.4, fs * 1.5); g.fillStyle = '#8fe3a5'; g.textAlign = 'right'; g.font = `${fs}px "IBM Plex Mono", Consolas`; g.fillText(signed(q05(val)).toFixed(2) + '°', x0 + ww - 4, top + fs * 1.1); }
    };
    one(A, 0, 'A'); one(B, Hh / 2, 'B');
    v.foot('主尺分度 1°；游标 20 格 = 主尺 19 格，第 n 格对齐即加 0.05n°');
  }

  globalControls() {
    return [
      { type: 'readout', label: '室温', get: () => `${this.temp.toFixed(1)} °C` },
      { type: 'readout', label: '当前试管', get: () => { const t = this.tube(); return t ? t.name : '样品室为空'; } },
      { type: 'toggle', label: '读数辅助（视场亮度与游标数值）', get: () => this.assist, set: (v) => (this.assist = v) },
    ];
  }

  // ---------------- 数据 ----------------
  zeroMean() {
    const t = this.app.table('rot'); if (!t) return NaN;
    const z = t.rows.filter((r) => r.k === 'w' && r.A != null && r.B != null && r.A !== '' && r.B !== '');
    return z.length ? mean(z.map((r) => (signed(r.A) + signed(r.B)) / 2)) : NaN;
  }
  tables() {
    const rows = [];
    for (const [k, n] of ROWS) for (let i = 0; i < n; i++) rows.push({ k, what: `${TUBES.find((t) => t.key === k).short}  #${i + 1}` });
    return [{
      id: 'rot', title: '旋光角测量', fixedRows: true,
      initRows: () => rows.map((r) => ({ ...r })),
      columns: [
        { key: 'what', label: '样品（浓度 g/mL）', type: 'text', readonly: true },
        { key: 'A', label: '游标 A /°', digits: 2 },
        { key: 'B', label: '游标 B /°', digits: 2 },
        { key: 'th', label: '平均 θ /°', digits: 3, calc: (r) => (signed(r.A) + signed(r.B)) / 2 },
        { key: 'al', label: '旋光角 φ=θ−θ₀ /°', digits: 3, calc: (r) => (r.k === 'w' ? NaN : (signed(r.A) + signed(r.B)) / 2 - this.zeroMean()) },
      ],
      buttons: [{ label: '记录当前两游标读数', onClick: (t) => this.rec(t) }],
      note: '找到“暗度相等”的视场后记录。读数精确到 0.05°；左旋读数为负。每次记录前把视场转离再重新对准。',
    }];
  }
  rec(t) {
    const tb = this.tube();
    if (!tb) return this.app.toast('样品室中没有试管', 'warn');
    if (!this.lampOn || this.warm < 0.9) return this.app.toast('钠光灯未开或尚未预热好', 'warn');
    const i = t.rows.findIndex((r) => r.k === tb.key && (r.A == null || r.A === ''));
    if (i < 0) return this.app.toast(`「${tb.short}」的测量次数已满`, 'warn');
    if (this.bubble[tb.key]) this.app.toast('提示：试管中的气泡在通光区，视场被挡住，判断不准', 'warn');
    if (!this.cover) this.app.toast('提示：样品室盖没有盖上，杂散光使视场变亮', 'warn');
    const D = signed(this.R + this.off - this.alpha());
    if (Math.abs(D) > 45 && Math.abs(D) < 135) this.app.toast('注意：这是“亮度相等”的位置，灵敏度低，应改用“暗度相等”的位置', 'warn');
    else if (Math.abs(D) > 0.35 && Math.abs(Math.abs(D) - 180) > 0.35) this.app.toast('两侧与中间的亮暗还不相等', 'warn');
    const { A, B } = this.readings();
    t.set(i, 'A', +signed(q05(A)).toFixed(2)); t.set(i, 'B', +signed(q05(B)).toFixed(2));
  }

  steps() {
    const app = this.app;
    const tb = () => app.table('rot');
    const done = (k) => tb().rows.filter((r) => r.k === k && r.A != null && r.A !== '' && r.B != null && r.B !== '').length;
    const need = (k) => ROWS.find((r) => r[0] === k)[1];
    const target = () => { const t0 = signed(this.alpha() - this.off) + gauss(0.02); return this.R + signed(t0 - this.R); };
    const swap = async (k) => {
      const cur = this.tube();
      if (cur && cur.key !== k) { app.select(app.comp('body')); this.cover = false; app.changed(); await app.wait(250); app.remove(app.comp(cur.key)); }
      if (!app.comp(k).placed) { this.cover = false; await app.autoPlace(k, { slot: 'chamber' }); }
      app.select(app.comp(k)); this.bubble[k] = false; app.changed(); await app.wait(250);
      app.select(app.comp('body')); this.cover = true; app.changed(); await app.wait(200);
    };
    const measure = async (k) => {
      await swap(k);
      const tbl = tb(); app.showTable(app.tables.indexOf(tbl));
      while (done(k) < need(k)) {
        const to = target();
        const near = to + (this.R > to ? 1.5 : -1.5);
        await app.tween(() => this.R, (v) => (this.R = v), near, 600);
        await app.tween(() => this.R, (v) => (this.R = v), to, 700);
        await app.record('rot');
        await app.tween(() => this.R, (v) => (this.R = v), to + rand(-3, 3), 300);
      }
    };
    return [
      {
        title: '放置钠光灯并开灯预热',
        html: '<p>把<b>钠光灯</b>放到旋光仪起偏端，打开电源。钠灯需预热，待亮度稳定后再测量。</p>',
        check: () => app.comp('lamp').placed && this.lampOn && this.warm > 0.95,
        auto: async () => { await app.view('全景'); await app.autoPlace('lamp', { slot: 'lamp' }); app.select(app.comp('lamp')); this.lampOn = true; app.changed(); while (this.warm < 0.97) await app.wait(200, true); },
      },
      {
        title: '调节目镜视度，看清三分视场',
        html: '<p>转动<b>目镜视度调节</b>，使视场中左、中、右三部分的分界线最清晰。转动手轮观察：三部分的亮暗交替变化。</p>',
        check: () => Math.abs(this.dio - this.dioNeed) < 0.3,
        status: () => `视度 <b>${this.dio.toFixed(1)} D</b>`,
        auto: async () => { await app.view('目镜端'); app.select(app.comp('body')); await app.tween(() => this.dio, (v) => (this.dio = v), this.dioNeed + gauss(0.05), 1000); },
      },
      {
        title: '零点校正（蒸馏水管）',
        html: '<p>放入<b>蒸馏水试管</b>，把气泡赶到凸颈处，盖上样品室盖。转动手轮找到两侧与中间<b>暗度相等</b>（整体较暗、分界线消失）的位置，读左右两游标。重复 3 次，平均值即零点 $\\theta_0$。</p>',
        hint: '暗度相等位置附近，手轮稍一转动，三部分就出现明显的亮暗差；亮度相等位置附近则不灵敏。从两个方向逼近可减小判断误差。',
        check: () => done('w') >= 3,
        status: () => `已测 <b>${done('w')}</b> / 3`,
        auto: async () => { await app.view('样品室'); await measure('w'); },
      },
      {
        title: '测已知浓度蔗糖溶液的旋光角',
        html: '<p>依次放入 0.050、0.100、0.150、0.200 g/mL 的蔗糖溶液试管（长 2 dm），每种测 2 次。旋光角 $\\varphi=\\theta-\\theta_0$，顺时针（右旋）为正。</p>',
        check: () => ['s5', 's10', 's15', 's20'].every((k) => done(k) >= 2),
        status: () => ['s5', 's10', 's15', 's20'].map((k) => `${TUBES.find((t) => t.key === k).short}: ${done(k)}/2`).join(' · '),
        auto: async () => { for (const k of ['s5', 's10', 's15', 's20']) await measure(k); },
      },
      {
        title: '测未知浓度溶液',
        html: '<p>放入浓度未知的蔗糖溶液试管（2 dm），测 2 次旋光角。</p>',
        check: () => done('sx') >= 2,
        auto: async () => { await measure('sx'); },
      },
      {
        title: '旋光角与管长的关系（选做）',
        optional: true,
        html: '<p>放入 1 dm 长、0.100 g/mL 的试管，与 2 dm 管的结果比较，验证 $\\varphi\\propto l$。</p>',
        check: () => done('s10s') >= 2,
        auto: async () => { await measure('s10s'); },
      },
      {
        title: '数据处理',
        html: '<p>作 $\\varphi$–$c$ 直线，由斜率 $k=[\\alpha]l$ 求比旋光度，再由未知溶液的旋光角求其浓度。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const t = this.app.table('rot');
    const th0 = this.zeroMean();
    if (!isFinite(th0)) return { html: '<p>请先完成零点校正。</p>', ok: false };
    const full = (r) => r.A != null && r.A !== '' && r.B != null && r.B !== '';
    const phiOf = (k) => { const z = t.rows.filter((r) => r.k === k && full(r)).map((r) => (signed(r.A) + signed(r.B)) / 2 - th0); return z.length ? mean(z) : NaN; };
    const zs = t.rows.filter((r) => r.k === 'w' && full(r)).map((r) => (signed(r.A) + signed(r.B)) / 2);
    const known = ['s5', 's10', 's15', 's20'].map((k) => ({ k, c: TUBES.find((x) => x.key === k).c, phi: phiOf(k) })).filter((p) => isFinite(p.phi));
    if (known.length < 3) return { html: '<p>至少需要 3 种已知浓度溶液的旋光角。</p>', ok: false };
    const f = linFit(known.map((p) => p.c), known.map((p) => p.phi));
    const l = 2, spec = f.k / l, us = f.uk / l;
    const spec20 = spec / (1 - 3.7e-4 * (this.temp - 20));
    const u0 = zs.length > 1 ? stdev(zs) / Math.sqrt(zs.length) : 0;
    let html = `<h3>1. 零点</h3><p>$\\theta_0=${th0.toFixed(3)}^\\circ$（${zs.length} 次平均，标准偏差 ${zs.length > 1 ? stdev(zs).toFixed(3) : '—'}°，平均值的 A 类不确定度 ${u0.toFixed(3)}°）。</p>
      <h3>2. 旋光角与浓度</h3><table><tr><th>c/(g·mL⁻¹)</th>${known.map((p) => `<td>${p.c.toFixed(3)}</td>`).join('')}</tr><tr><th>φ/°</th>${known.map((p) => `<td>${p.phi.toFixed(3)}</td>`).join('')}</tr></table>
      <p>线性拟合 $\\varphi=kc+b$：$k=${f.k.toFixed(2)}$ °·mL/g，$b=${f.b.toFixed(3)}^\\circ$，$r=${f.r.toFixed(5)}$。</p>
      <div class="result-box">室温 ${this.temp.toFixed(1)} °C 下 $[\\alpha]=k/l=${texU(spec, us, '^\\circ\\cdot mL\\cdot g^{-1}\\cdot dm^{-1}')}$；换算到 20 °C：$[\\alpha]_{20}=${spec20.toFixed(2)}$，与文献值 66.5 的相对误差 ${pct(relErr(spec20, SPEC20))}</div>
      <div class="plot-wrap"><canvas data-plot="0" style="height:280px"></canvas></div>`;
    const plots = [{ title: '旋光角 φ – 浓度 c（l = 2 dm）', xLabel: 'c / (g·mL⁻¹)', yLabel: 'φ / °', series: [
      { type: 'scatter', data: known.map((p) => [p.c, p.phi]), label: '实验数据' },
      { type: 'line', data: lineData(f.k, f.b, 0, 0.22), label: `拟合 k = ${f.k.toFixed(2)}` },
    ] }];
    const answers = [{ label: `室温比旋光度 $[\alpha]$（l = 2 dm）`, unit: '°·mL·g⁻¹·dm⁻¹', value: spec, digits: 2, tolRel: 0.008 }];
    const px = phiOf('sx');
    if (isFinite(px)) {
      const cx = (px - f.b) / f.k;
      const ucx = Math.abs(cx) * Math.hypot(f.uk / f.k, 0.03 / Math.max(0.1, Math.abs(px)));
      answers.push({ label: '未知溶液浓度 $c_x$', unit: 'g/mL', value: cx, digits: 4, tolRel: 0.01 });
      html += `<h3>3. 未知溶液浓度</h3><p>$\\varphi_x=${px.toFixed(3)}^\\circ$，由定标直线得</p><div class="result-box">$c_x=(\\varphi_x-b)/k=${texU(cx, ucx, 'g/mL')}$（配制值 ${this.cx.toFixed(3)} g/mL，相对偏差 ${pct(relErr(cx, this.cx))}）</div>`;
    }
    const p1 = phiOf('s10s'), p2 = phiOf('s10');
    if (isFinite(p1) && isFinite(p2)) html += `<h3>4. 旋光角与管长</h3><p>同为 0.100 g/mL：$l=1$ dm 时 $\\varphi=${p1.toFixed(3)}^\\circ$，$l=2$ dm 时 $\\varphi=${p2.toFixed(3)}^\\circ$，比值 ${(p2 / p1).toFixed(3)}，与 $\\varphi\\propto l$ 相符。</p>`;
    return { html, ok: true, plots, answers };
  }

  principle() {
    return `<h3>1. 旋光现象</h3><p>线偏振光通过某些物质（石英、糖溶液等）后振动面转过一个角度 $\\varphi$。对溶液</p>$$\\varphi=[\\alpha]\\,l\\,c$$<p>$l$ 为光程长（dm），$c$ 为浓度（g/mL），$[\\alpha]$ 为比旋光度，与波长和温度有关。蔗糖为右旋物质，589.3 nm、20 °C 时 $[\\alpha]\\approx66.5^\\circ\\cdot\\mathrm{mL\\cdot g^{-1}\\cdot dm^{-1}}$。</p>
<h3>2. 半荫法与三分视场</h3><p>人眼难以准确判断“完全消光”。旋光仪在起偏镜后放一条石英片（半荫片），使视场中间部分的振动面与两侧相差一个小角度 $2\\theta$。转动检偏器，当它的透振方向与两振动面夹角的平分线垂直时，三部分<b>同样暗</b>；稍有偏离，一侧变亮、一侧变暗，对比非常灵敏。以此“暗度相等”位置为测量位置，放入样品前后读数之差即旋光角。</p>
<h3>3. 双游标</h3><p>刻度盘转轴与盘心不重合时，单个游标的读数有周期性偏心误差。两个游标相隔 180°，偏心误差大小相等、符号相反，取平均即可消除。</p>
<h3>4. 本仿真的计算模型</h3><p>两部分视场的光强 $I_{1,2}=I_0\\left[\\sin^2(\\theta_A-\\varphi\\pm\\theta)+\\varepsilon\\right]$，显示亮度按人眼的近似对数响应映射；比旋光度含温度修正 $[\\alpha]_t=[\\alpha]_{20}[1-3.7\\times10^{-4}(t-20)]$；另有零点误差、刻度盘偏心、配液误差和目镜视度。</p>`;
  }
}
