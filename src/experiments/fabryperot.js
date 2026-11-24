// 实验：法布里–珀罗干涉仪（多光束干涉 · 平行度调节 · 测钠 D 双线波长差）
import * as THREE from 'three';
import { meta, thumb } from './fabryperot.meta.js';
import { GPU, GLSL } from '../core/gpu.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, labTable, lampHousing, glowSprite, ICONS, knobMesh } from '../core/Models.js';
import { BeamDraw } from '../core/beams.js';
import { mean, uA, texU, gauss, rand, relErr, pct, sig } from '../core/Stats.js';
import * as FIG from './figures.js';

const L1 = 588.995e-6, L2 = 589.592e-6; // mm
const LBAR = (L1 + L2) / 2;
const DLAM = L2 - L1;
const W2 = 0.6; // D1 线相对强度
const FOV = 3.2 * Math.PI / 180; // 望远镜视场半角
const YB = 16; // 光轴高度 cm
const D2R = Math.PI / 180;
const NCO = 6;

/** Airy 函数在相位区间 [d-h/2, d+h/2] 上的平均值（解析积分，防止细密条纹混叠） */
function airyAvg(d, h, F) {
  if (h < 1e-3) { const s = Math.sin(d / 2); return 1 / (1 + F * s * s); }
  const q = Math.sqrt(1 + F);
  const G = (x) => (2 / q) * (Math.atan(q * Math.tan(x / 2)) + Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI)));
  return (G(d + h / 2) - G(d - h / 2)) / h;
}

const RINGS_FS = GLSL.lut + `
uniform sampler2D uProf; uniform float uSub, uCx, uCy, uFov, uPix, uW, uH, uMode, uMx, uMy, uHx, uHy, uSoft;
float fieldMask(float vx, float vy) {
  if (uMode < 0.5) { float a = (vx - uMx) / uHx, b = (vy - uMy) / uHy; return exp(-(a * a + b * b)); }
  return clamp((uHx - abs(vx - uMx)) / uSoft + 0.5, 0.0, 1.0) * clamp((uHy - abs(vy - uMy)) / uSoft + 0.5, 0.0, 1.0);
}
vec3 shade(vec2 L) {
  float vx = (L.x - 0.5 * uW) * uPix, vy = (0.5 * uH - L.y) * uPix;
  float tv = length(vec2(vx, vy));
  if (tv > uFov) return vec3(0.0);
  float v = min(1.0, lut(uProf, length(vec2(vx - uCx, vy - uCy)) / uSub) * 1.7 * fieldMask(vx, vy));
  float edge = tv > uFov * 0.97 ? 0.4 : 1.0;
  return vec3(v, 0.7686 * v * v, 0.196 * v * v * v) * edge;
}`;

export class FabryPerotExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.R = rand(0.83, 0.88);
    this.F = (4 * this.R) / (1 - this.R) ** 2;
    this.d = rand(0.4, 0.9); // 测微读数 mm
    this.e0 = rand(0.35, 0.6); // 读数为 0 时的实际间距
    this.tx = rand(6, 14) * (Math.random() < 0.5 ? -1 : 1); // 镜面倾角 μrad
    this.ty = rand(6, 14) * (Math.random() < 0.5 ? -1 : 1);
    this.ex = 0; this.ey = 0; // 眼睛在通光口径上的位置 mm
    this.focus0 = rand(-1.5, 1.5); this.focus = 0;
    this.lampOn = false; this.warm = 0;
    this.assist = !this.app.readSelf; // 自己读数时默认不显示读数辅助
    this.dMin = this.d; this.dMax = this.d;
  }

  get e() { return this.d + this.e0; }
  lit() { return this.lampOn && this.app.comp('lamp').placed ? this.warm : 0; }
  /**
   * 照明几何：从 F-P 中心向光源方向看，视场里哪些方向有光。
   * mode 'diff'：毛玻璃在灯与 F-P 之间，有光方向为毛玻璃所张的角范围（中心 mx, my，半宽 hx, hy，rad）；
   * mode 'lamp'：没有毛玻璃（或毛玻璃不在光路上），只看到灯出光窗所在的一小块。
   * S：视场亮度（灯是否对准毛玻璃、距离远近）。
   */
  field() {
    const app = this.app, C = new THREE.Vector3(0, YB, 0), q = new THREE.Quaternion();
    const o = { mode: 'lamp', mx: 0, my: 0, hx: 0.5 * D2R, hy: 0.5 * D2R, S: 0, L: null, P: null };
    const S0 = this.lit();
    const lamp = app.comp('lamp');
    if (!lamp.placed) return o;
    lamp.root.updateWorldMatrix(true, false);
    const L = new THREE.Vector3(7.5, YB, 0).applyMatrix4(lamp.root.matrixWorld); o.L = L;
    const lax = new THREE.Vector3(1, 0, 0).applyQuaternion(lamp.root.getWorldQuaternion(q));
    const ang = (P) => { const d = P.clone().sub(C); return [Math.atan2(-d.z, -d.x), Math.atan2(d.y, -d.x)]; };
    const aim = (P) => { const d = P.clone().sub(L).normalize(); return Math.exp(-((Math.acos(Math.min(1, Math.max(-1, d.dot(lax)))) / (25 * D2R)) ** 2)); };
    const df = app.comp('diff');
    if (df.placed) {
      df.root.updateWorldMatrix(true, false);
      const P = new THREE.Vector3(0, YB, 0).applyMatrix4(df.root.matrixWorld), dist = P.distanceTo(C);
      if (P.x < C.x && dist < L.distanceTo(C) && L.distanceTo(P) > 1) {
        const nrm = new THREE.Vector3(1, 0, 0).applyQuaternion(df.root.getWorldQuaternion(q)), toC = C.clone().sub(P).normalize();
        const [mx, my] = ang(P);
        // 毛玻璃亮度 ∝ 灯照到它上面的照度（以灯距 20 cm 为基准）
        const k = aim(P) * Math.min(1, (20 / P.distanceTo(L)) ** 2);
        return { ...o, mode: 'diff', mx, my, hx: Math.atan((4 * Math.abs(nrm.dot(toC))) / dist), hy: Math.atan(4 / dist), S: S0 * k, P };
      }
    }
    const [mx, my] = ang(L);
    return { ...o, mx, my, S: S0 * aim(C) };
  }
  /** 视场中心方向有毛玻璃照明（能看到完整圆环） */
  diffOK() { const f = this.field(); return f.mode === 'diff' && Math.abs(f.mx) < f.hx - FOV * 0.5 && Math.abs(f.my) < f.hy - FOV * 0.5; }
  /** 两套圆环在中心的级次差的小数部分：0 = 重合，0.5 = 错开最均匀 */
  get frac() { const x = 2 * this.e * (1 / L1 - 1 / L2); return x - Math.floor(x); }
  state() { const f = this.frac, c = Math.min(f, 1 - f); return c < 0.1 ? 'co' : Math.abs(f - 0.5) < 0.1 ? 'alt' : null; }

  cameras() {
    return [
      { name: '全景', pos: [-6, 60, 80], target: [-6, 14, 0] },
      { name: '干涉仪', pos: [10, 34, 30], target: [2, 16, 0] },
      { name: '测微机构', pos: [6, 30, -28], target: [4, 14, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(150, 90); t.position.set(-8, 0, 0); scene.add(t);
    app.addTable({ x0: -81, x1: 65, z0: -43, z1: 43 }); // 钠灯、毛玻璃可放在台面任意位置和方向
    this.beamDraw = new BeamDraw(scene, { max: 4 });
    app.stage.setLightTarget(-8, 0, 0);

    // 干涉仪本体：导轨 + 固定镜 G2（带两颗倾角螺钉）+ 动镜 G1（测微丝杆）
    const body = new THREE.Group();
    body.add(mesh(new THREE.BoxGeometry(34, 2.4, 12), MAT.paint(0x3b4642), 4, 1.2, 0));
    body.add(mesh(new THREE.BoxGeometry(30, 1.2, 4), MAT.alu(), 4, 3, 0));
    const mount = (x) => { const g = new THREE.Group(); g.position.set(x, 0, 0); g.add(mesh(new THREE.BoxGeometry(2, YB - 2, 8), MAT.paint(0x4b5a53), 0, (YB - 2) / 2 + 2.4, 0)); g.add(mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.4, 40), MAT.dark(), 0, YB, 0).rotateZ(Math.PI / 2)); g.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.5, 40), MAT.glass(0xfff3c4, 0.5), 0, YB, 0).rotateZ(Math.PI / 2)); return g; };
    this.g1 = mount(-2); this.g2 = mount(2.2);
    body.add(this.g1, this.g2);
    for (const [y, z] of [[YB + 3, 0], [YB, 3.6]]) { const k = knobMesh(0.7, 1.4, 0x9ca3af); k.position.set(3.2, y, z); k.rotation.z = Math.PI / 2; body.add(k); }
    this.wheel = mesh(new THREE.CylinderGeometry(3, 3, 1.2, 40), MAT.chrome(), -4, YB - 7, -7); this.wheel.rotation.x = Math.PI / 2; body.add(this.wheel);
    this.drum = mesh(new THREE.CylinderGeometry(1.4, 1.4, 2, 32), MAT.brass(), 10, 6, -7); this.drum.rotation.x = Math.PI / 2; body.add(this.drum);
    body.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 14, 12), MAT.chrome(), 3, 6, -5).rotateZ(Math.PI / 2));
    // 观察望远镜
    const tel = new THREE.Group(); tel.position.set(16, YB, 0);
    tel.add(mesh(new THREE.CylinderGeometry(1.5, 1.8, 14, 28), MAT.black(), 7, 0, 0).rotateZ(Math.PI / 2));
    tel.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 3, 20), MAT.black(), 15.5, 0, 0).rotateZ(Math.PI / 2));
    tel.add(mesh(new THREE.BoxGeometry(2, YB - 2.4, 2), MAT.dark(), 6, -(YB - 2.4) / 2, 0));
    body.add(tel);
    app.addComponent(new Component({
      key: 'fp', name: 'F-P 干涉仪', zone: 'none', fixed: true, object: body, labelY: YB + 8,
      desc: `两块平面玻璃内表面镀高反射膜（反射率约 ${Math.round(this.R * 100)}%）。G₂ 固定，背后两颗螺钉调倾角；G₁ 由测微丝杆移动：粗动手轮分度 0.01 mm，微动鼓轮分度 0.0001 mm。`,
      controls: () => [
        { type: 'knob', label: '粗动手轮', get: () => this.d, set: (v) => this.setD(v), min: 0, max: 8, step: 0.002, bigStep: 0.05, perRev: 0.5, digits: 4, unit: 'mm' },
        { type: 'knob', label: '微动鼓轮', get: () => this.d, set: (v) => this.setD(v), min: 0, max: 8, step: 0.00002, bigStep: 0.0005, perRev: 0.01, digits: 4, unit: 'mm' },
        { type: 'knob', label: 'G₂ 水平倾角螺钉', get: () => this.tx, set: (v) => (this.tx = v), min: -60, max: 60, step: 0.05, bigStep: 1, perRev: 10, digits: 2, unit: 'μrad', fmt: () => '移动眼睛观察圆环' },
        { type: 'knob', label: 'G₂ 竖直倾角螺钉', get: () => this.ty, set: (v) => (this.ty = v), min: -60, max: 60, step: 0.05, bigStep: 1, perRev: 10, digits: 2, unit: 'μrad', fmt: () => '移动眼睛观察圆环' },
      ],
    }));
    app.addComponent(new Component({
      key: 'tel', name: '观察望远镜', zone: 'none', fixed: true, object: new THREE.Group(), showLabel: false,
      desc: '调焦到无穷远观察等倾圆环。可以把望远镜（眼睛）在通光口径内上下左右平移。',
      controls: () => [
        { type: 'knob', label: '望远镜调焦', get: () => this.focus, set: (v) => (this.focus = v), min: -4, max: 4, step: 0.05, bigStep: 0.5, perRev: 2, digits: 2, unit: 'D', fmt: () => '使圆环最清晰' },
        { type: 'slider', label: '眼睛左右移动', get: () => this.ex, set: (v) => (this.ex = v), min: -12, max: 12, step: 0.1, digits: 1, unit: 'mm' },
        { type: 'slider', label: '眼睛上下移动', get: () => this.ey, set: (v) => (this.ey = v), min: -12, max: 12, step: 0.1, digits: 1, unit: 'mm' },
      ],
    }));

    app.addSlot({ id: 'lamp', pos: new THREE.Vector3(-42, 0, 0), accepts: ['lamp'] });
    app.addSlot({ id: 'diff', pos: new THREE.Vector3(-22, 0, 0), accepts: ['diff'] });
    const lg = new THREE.Group();
    const lh = lampHousing(0xffc21a, 9, 12); lh.group.position.y = YB; lg.add(lh.group);
    lg.add(mesh(new THREE.BoxGeometry(6, YB - 6, 6), MAT.dark(), 0, (YB - 6) / 2, 0));
    this.lampGlow = lh.glowMat;
    this.lampSprite = glowSprite(0xffb800, 12); this.lampSprite.position.set(7.5, YB, 0); this.lampSprite.visible = false; lg.add(this.lampSprite);
    app.addComponent(new Component({
      key: 'lamp', name: '钠光灯', icon: ICONS.sodium, zone: 'slot', defaultSlot: 'lamp', required: true, object: lg, labelY: YB + 10,
      desc: '低压钠灯，D₂ 线 588.995 nm、D₁ 线 589.592 nm，强度约 1 : 0.6。',
      controls: () => [{ type: 'toggle', label: '电源开关', get: () => this.lampOn, set: (v) => (this.lampOn = v) }, { type: 'readout', label: '预热', get: () => (this.lampOn ? `${Math.round(this.warm * 100)}%` : '未开灯') }],
    }));
    const dg = new THREE.Group();
    dg.add(mesh(new THREE.BoxGeometry(0.3, 8, 8), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 1, transparent: true, opacity: 0.85 }), 0, YB, 0));
    dg.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, YB - 4, 12), MAT.metal(), 0, (YB - 4) / 2, 0));
    app.addComponent(new Component({
      key: 'diff', name: '毛玻璃', icon: ICONS.screen, zone: 'slot', defaultSlot: 'diff', required: true, object: dg, labelY: YB + 7,
      desc: '使钠灯成为均匀的扩展光源，各个方向都有光入射，才能看到完整的等倾圆环。',
    }));

    this.ringView = app.addView({ id: 'ring', title: '望远镜视场（等倾圆环）', w: 240, h: 240, res: 1.1 });
    this.readView = app.addView({ id: 'read', title: '测微读数', w: 290, h: 92, res: 1.5 });
  }

  /** 三维：灯 → 毛玻璃 → F-P 的淡黄色光锥 */
  drawLight() {
    const F = this.field(), bd = this.beamDraw;
    bd.visibility = 0.35;
    if (!F.L || !this.lit()) { bd.hide(); return; }
    const C = new THREE.Vector3(-2, YB, 0), segs = [];
    if (F.mode === 'diff') {
      segs.push({ a: F.L, b: F.P, w0: 2.4, w1: 2.4 + 0.45 * F.L.distanceTo(F.P), P: this.lit(), color: 0xffc23a });
      segs.push({ a: F.P, b: C, w0: 3.6, w1: 2.2, P: F.S, color: 0xffd25a });
    } else segs.push({ a: F.L, b: C, w0: 2.4, w1: 2.4 + 0.45 * F.L.distanceTo(C), P: F.S, color: 0xffc23a });
    bd.draw({ segs, hits: new Map() }, 1);
  }

  setD(v) { this.d = Math.max(0, Math.min(8, v)); this.dMin = Math.min(this.dMin, this.d); this.dMax = Math.max(this.dMax, this.d); }

  tick(dt) {
    if (this.lampOn && this.warm < 1) { this.warm = Math.min(1, this.warm + dt / 4); this.app.changed(); }
    if (!this.lampOn && this.warm > 0) { this.warm = 0; this.app.changed(); }
  }

  update() {
    const on = this.lit();
    this.lampGlow.emissiveIntensity = on ? 3 * this.warm : 0;
    this.lampSprite.visible = !!on; this.lampSprite.material.opacity = this.warm;
    this.g1.position.x = -2 - this.d * 0.3;
    this.g2.rotation.y = this.tx * 0.004; this.g2.rotation.z = this.ty * 0.004;
    this.wheel.rotation.y = this.d * Math.PI * 4;
    this.drum.rotation.y = this.d * Math.PI * 200;
    this.drawLight();
    this.drawRings();
    this.drawRead();
  }

  /** 圆环径向光强分布（pix 为每像素对应的视场角，rad），返回 { prof, sub, cx, cy } */
  ringProfile(pix, S, diff) {
    // 眼瞳（约 4 mm）内不同位置的间距不同：沿倾斜方向取 3 个采样点平均
    const tl = Math.hypot(this.tx, this.ty) * 1e-6, ux = tl ? (this.tx * 1e-6) / tl : 1, uy = tl ? (this.ty * 1e-6) / tl : 0;
    const e0 = this.e + (this.tx * this.ex + this.ty * this.ey) * 1e-6;
    const es = tl * 1.6 > 2e-6 ? [-1.6, 0, 1.6].map((s) => e0 + tl * s) : [e0];
    // 圆环中心方向：两镜面法线方向（倾角很小，中心几乎不动）
    const cx = this.tx * 1e-6 * 40, cy = this.ty * 1e-6 * 40;
    // 圆环关于 (cx, cy) 轴对称：先算径向光强分布（每像素 4 个采样），再逐像素查表
    const thMax = FOV + Math.hypot(cx, cy) + pix * 2, sub = Math.max(pix / 4, thMax / 8000), nR = Math.ceil(thMax / sub) + 2;
    const prof = new Float32Array(nR);
    for (let i = 0; i < nR; i++) {
      const th = i * sub, ct = 1 - (th * th) / 2;
      let I = 0;
      for (const ee of es) {
        for (const [lam, wt] of [[L1, 1], [L2, W2]]) {
          const d = (4 * Math.PI * ee * ct) / lam;
          const hh = ((4 * Math.PI * ee * th) / lam) * pix * 1.2;
          I += wt * airyAvg(d, hh, this.F);
        }
      }
      prof[i] = (I / es.length / (1 + W2)) * S * (diff ? 1 : Math.exp(-(th * th) / (0.5 * Math.PI / 180) ** 2));
    }
    return { prof, sub, cx, cy };
  }

  drawRings() {
    const v = this.ringView, g = v.ctx, W = v.W, H = v.H;
    const F = this.field(), S = F.S, diff = true; // 有光方向由 fieldMask 决定，径向分布按满视场计算
    const fm = [F.mode === 'diff' ? 1 : 0, F.mx, F.my, F.hx, F.hy];
    const mask = (vx, vy) => (fm[0] ? Math.min(1, Math.max(0, (fm[3] - Math.abs(vx - fm[1])) / (0.03 * D2R) + 0.5)) * Math.min(1, Math.max(0, (fm[4] - Math.abs(vy - fm[2])) / (0.03 * D2R) + 0.5))
      : Math.exp(-(((vx - fm[1]) / fm[3]) ** 2 + ((vy - fm[2]) / fm[4]) ** 2)));
    const key = `${S.toFixed(3)}|${fm.map((x) => x.toFixed(5))}|${this.e.toFixed(7)}|${this.tx.toFixed(3)}|${this.ty.toFixed(3)}|${this.ex}|${this.ey}`;
    // GPU：径向分布按实际像素密度计算（放大后圆环依旧清晰），显卡逐像素查表
    if (GPU.ok) {
      const pixL = (2 * FOV) / W, sc = Math.max(1, v.scale);
      const gk = key + '|' + sc.toFixed(2);
      if (gk !== this._gk) {
        this._gk = gk;
        this._gp = S ? this.ringProfile(pixL / sc, S, diff) : null;
      }
      const gp = this._gp;
      if (gp && GPU.paint(v, 'rings', RINGS_FS, { uProf: { tex: gp.prof }, uSub: gp.sub, uCx: gp.cx, uCy: gp.cy, uFov: FOV, uPix: pixL, uW: W, uH: H, uMode: fm[0], uMx: fm[1], uMy: fm[2], uHx: fm[3], uHy: fm[4], uSoft: 0.03 * D2R })) { this._rk = null; this.ringsPost(v); return; }
      if (!gp) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); this._rk = null; this.ringsPost(v); return; }
    }
    if (key !== this._rk) {
      this._rk = key;
      const img = g.createImageData(W, H);
      if (S) {
        const pix = (2 * FOV) / W;
        const { prof, sub, cx, cy } = this.ringProfile(pix, S, diff);
        for (let py = 0; py < H; py++) {
          for (let px = 0; px < W; px++) {
            const vx = (px - W / 2 + 0.5) * pix, vy = (H / 2 - py - 0.5) * pix;
            const k = (py * W + px) * 4;
            const tv = Math.hypot(vx, vy);
            if (tv > FOV) { img.data[k + 3] = 255; continue; }
            const r = Math.hypot(vx - cx, vy - cy) / sub, i0 = Math.floor(r), f = r - i0;
            const I = (prof[i0] * (1 - f) + prof[i0 + 1] * f) * mask(vx, vy);
            const vv = Math.min(1, I * 1.7), edge = tv > FOV * 0.97 ? 0.4 : 1;
            img.data[k] = 255 * vv * edge; img.data[k + 1] = 196 * vv * vv * edge; img.data[k + 2] = 50 * vv * vv * vv * edge; img.data[k + 3] = 255;
          }
        }
      }
      this._img = img;
    }
    g.putImageData(this._img, 0, 0);
    this.ringsPost(v);
  }

  ringsPost(v) {
    const S = this.field().S;
    const blur = Math.abs(this.focus - this.focus0);
    if (blur > 0.08) v.filterSelf(`blur(${Math.min(8, blur * 3.5).toFixed(1)}px)`);
    let foot;
    if (!S) foot = this.lampOn ? '视场较暗：钠灯预热中' : '视场黑暗：钠灯未打开';
    else if (!this.diffOK()) foot = this.field().mode === 'diff' ? '毛玻璃没有正对视场：只有一部分方向有光' : '没有毛玻璃（或不在灯与干涉仪之间）：只看到灯所在的一小块';
    else if (this.assist) {
      const st = this.state();
      foot = `间距 ${this.e.toFixed(3)} mm · 两套圆环${st === 'co' ? '重合' : st === 'alt' ? '错开最均匀' : '部分错开'}（级次差小数 ${this.frac.toFixed(2)}） · 平行度 ${Math.hypot(this.tx, this.ty).toFixed(1)} μrad`;
    } else foot = '';
    v.foot(foot);
  }

  drawRead() {
    const v = this.readView, g = v.ctx, W = v.W;
    const sc = W / 290; g.save(); g.scale(sc, sc);
    g.fillStyle = '#20262a'; g.fillRect(0, 0, 290, 92);
    const d = this.d, mm = Math.floor(d), c = Math.floor((d - mm) * 100), f = (d - mm - c / 100) * 10000;
    const box = (x, w, title, val, sub) => {
      g.fillStyle = '#ece6d2'; g.fillRect(x, 8, w, 40);
      g.fillStyle = '#111'; g.font = 'bold 20px "IBM Plex Mono", Consolas'; g.textAlign = 'center'; g.fillText(val, x + w / 2, 36);
      g.fillStyle = '#cfd6d1'; g.font = '11px "Microsoft YaHei"'; g.fillText(title, x + w / 2, 64); g.fillText(sub, x + w / 2, 78);
    };
    box(8, 74, '主尺', `${mm}`, 'mm');
    box(98, 84, '粗动手轮', `${String(c).padStart(2, '0')}`, '× 0.01 mm');
    box(198, 84, '微动鼓轮', f.toFixed(1), '× 0.0001 mm');
    if (this.assist) { g.fillStyle = '#8fe3a5'; g.font = '11px "IBM Plex Mono", Consolas'; g.textAlign = 'left'; g.fillText(`d = ${d.toFixed(5)}`, 8, 90); }
    g.restore();
  }

  globalControls() {
    return [{ type: 'toggle', label: '显示读数与状态辅助', get: () => this.assist, set: (v) => (this.assist = v) }];
  }

  tables() {
    return [{
      id: 'co', title: '两套圆环的重合位置', fixedRows: true,
      initRows: () => Array.from({ length: NCO }, (_, i) => ({ k: i })),
      columns: [
        { key: 'k', label: '序号 k', digits: 0, readonly: true },
        { key: 'd', label: '测微读数 d/mm', digits: 4 },
        { key: 'st', label: '状态', type: 'text', readonly: true, optional: true },
      ],
      buttons: [{ label: '记录读数到下一格', onClick: (t) => this.rec(t) }],
      note: '沿同一方向转动手轮，每当两套圆环重合（或错开最均匀，只能选一种）时记录一次，共 6 次。',
    }];
  }

  rec(t) {
    const i = t.firstEmpty('d');
    if (i < 0) return this.app.toast('表格已记录完整', 'ok');
    if (this.field().S < 0.2 || !this.diffOK()) return this.app.toast('看不到完整的等倾圆环', 'warn');
    if (Math.hypot(this.tx, this.ty) > 3) this.app.toast('圆环不够细锐：两镜面还不够平行', 'warn');
    const st = this.state();
    if (!st) this.app.toast('现在两套圆环既不重合也不是均匀错开', 'warn');
    const first = t.rows.find((r) => r.st);
    if (first && st && first.st !== (st === 'co' ? '重合' : '错开')) this.app.toast('与前面记录的状态不同（重合 / 错开要统一）', 'warn');
    t.set(i, 'd', Math.round((this.d + gauss(0.00003)) * 10000) / 10000);
    t.set(i, 'st', st === 'co' ? '重合' : st === 'alt' ? '错开' : '—');
  }

  /** 把读数调到下一次 frac = target 的位置（沿 +d 方向） */
  nextAt(target) {
    const per = 1 / (2 * (1 / L1 - 1 / L2)); // 重合周期 (mm)
    let f = this.frac - target; f -= Math.floor(f);
    let dd = (1 - f) * per;
    if (dd < per / 2) dd += per; // 不要停在刚记录过的那一次重合上
    return this.d + dd;
  }

  steps() {
    const app = this.app;
    const on = (k) => app.comp(k).placed;
    return [
      {
        title: '放置钠灯和毛玻璃，打开钠灯',
        html: '<p>把<b>钠光灯</b>和<b>毛玻璃</b>放到干涉仪前方，打开钠灯预热。</p>',
        check: () => on('lamp') && on('diff') && this.lampOn && this.warm > 0.95 && this.diffOK() && this.field().S > 0.6,
        status: () => { if (!(on('lamp') && on('diff'))) return ''; const f = this.field(); return !this.diffOK() ? '毛玻璃应在灯与干涉仪之间，正对干涉仪' : `视场亮度 <b>${Math.round(f.S * 100)}%</b>${f.S < 0.6 ? '：把钠灯对准毛玻璃、靠近一些' : ''}`; },
        auto: async () => {
          await app.view('全景'); await app.autoPlace('lamp'); await app.autoPlace('diff');
          app.select(app.comp('lamp')); this.lampOn = true; app.changed();
          while (this.warm < 0.97) await app.wait(200, true);
        },
      },
      {
        title: '望远镜调焦到无穷远',
        html: '<p>F-P 的等倾圆环定域在无穷远。调节望远镜调焦，使视场中的圆环最清晰。此时圆环可能较宽、较模糊，这是因为两镜面还不平行。</p>',
        check: () => Math.abs(this.focus - this.focus0) < 0.1,
        auto: async () => { await app.view('干涉仪'); app.select(app.comp('tel')); await app.tween(() => this.focus, (v) => (this.focus = v), this.focus0 + gauss(0.02), 1100); },
      },
      {
        title: '调节两镜面平行',
        html: '<p>把眼睛（望远镜）在通光口径内<b>左右移动</b>，若圆环从中心冒出或向中心缩进，说明该方向两镜间距不等；调节 G₂ 的<b>水平倾角螺钉</b>直到左右移动时圆环不再涨缩。再<b>上下移动</b>，调<b>竖直倾角螺钉</b>。反复几次，圆环会变得非常细锐。</p>',
        hint: '眼睛移向间距较大的一侧时，中心处的级次增加，圆环从中心冒出。两镜面越平行，圆环越细锐，越接近由反射率决定的理想精细度。',
        check: () => Math.abs(this.tx) < 0.8 && Math.abs(this.ty) < 0.8,
        status: () => (this.assist ? `平行度：水平 <b>${this.tx.toFixed(2)}</b> μrad，竖直 <b>${this.ty.toFixed(2)}</b> μrad（各需 &lt; 0.8）` : '移动眼睛观察圆环是否涨缩'),
        auto: async () => {
          app.select(app.comp('tel'));
          await app.tween(() => this.ex, (v) => (this.ex = v), 10, 600); await app.tween(() => this.ex, (v) => (this.ex = v), -10, 900);
          app.select(app.comp('fp')); await app.tween(() => this.tx, (v) => (this.tx = v), gauss(0.15), 1200);
          app.select(app.comp('tel')); await app.tween(() => this.ex, (v) => (this.ex = v), 0, 500);
          await app.tween(() => this.ey, (v) => (this.ey = v), 10, 600); await app.tween(() => this.ey, (v) => (this.ey = v), -10, 900);
          app.select(app.comp('fp')); await app.tween(() => this.ty, (v) => (this.ty = v), gauss(0.15), 1200);
          app.select(app.comp('tel')); await app.tween(() => this.ey, (v) => (this.ey = v), 0, 500);
        },
      },
      {
        title: '观察钠双线的两套圆环',
        html: '<p>慢慢转动粗动手轮改变间距 d，观察：视场中有<b>亮、暗两套</b>细圆环（D₂、D₁ 线），随着 d 增大，两套圆环逐渐错开，错开最均匀后又逐渐靠拢、重合，周而复始。转过至少一个周期（约 0.3 mm）。</p>',
        check: () => this.dMax - this.dMin > 0.3,
        status: () => `已改变 d <b>${(this.dMax - this.dMin).toFixed(3)} mm</b>`,
        auto: async () => {
          app.select(app.comp('fp'));
          await app.tween(() => this.d, (v) => this.setD(v), this.d + 0.32, 3000);
        },
      },
      {
        title: '测量 6 次相继重合的位置',
        html: '<p>沿同一方向转动手轮（接近时改用微动鼓轮），每当两套圆环<b>重合</b>时记录测微读数，连续记录 6 次。</p>',
        hint: '也可以统一记录“错开最均匀”的位置。两种状态的周期相同。',
        check: () => app.table('co').completeRows().length >= NCO,
        status: () => `已记录 <b>${app.table('co').completeRows().length}</b> / ${NCO}`,
        auto: async () => {
          const t = app.table('co'); app.showTable(app.tables.indexOf(t));
          app.select(app.comp('fp'));
          for (let k = 0; k < NCO; k++) {
            const to = this.nextAt(gauss(0.015));
            await app.tween(() => this.d, (v) => this.setD(v), to - 0.004, 1100);
            await app.tween(() => this.d, (v) => this.setD(v), to, 500);
            await app.record('co');
          }
        },
      },
      {
        title: '数据处理：求钠 D 双线波长差',
        html: '<p>相邻两次重合，两波长的级次差改变 1：$$\\Delta d=\\frac{\\lambda_1\\lambda_2}{2(\\lambda_2-\\lambda_1)}\\approx\\frac{\\bar\\lambda^2}{2\\Delta\\lambda}$$用逐差法求 $\\Delta d$，得 $\\Delta\\lambda=\\bar\\lambda^2/(2\\Delta d)$，$\\bar\\lambda=589.3$ nm。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const rows = this.app.table('co').rows;
    const ds = rows.map((r) => r.d).filter((x) => x != null && isFinite(x));
    if (ds.length < 4) return { html: '<p>至少需要 4 次重合位置（建议 6 次）。</p>', ok: false };
    const m = Math.floor(ds.length / 2);
    const diffs = []; for (let i = 0; i < m; i++) diffs.push(Math.abs(ds[i + m] - ds[i]) / m);
    const Dd = mean(diffs), ua = diffs.length > 1 ? uA(diffs) : 0;
    const ub = (0.0001 * Math.SQRT2) / Math.sqrt(3) / m;
    const u = Math.hypot(ua, ub, 0.01 * Dd / m);
    const lam = 589.3e-6;
    const dl = (lam * lam) / (2 * Dd), udl = dl * (u / Dd);
    const html = `<h3>重合位置（逐差法）</h3><table><tr><th>k</th>${ds.map((_, i) => `<td>${i}</td>`).join('')}</tr><tr><th>d/mm</th>${ds.map((x) => `<td>${x.toFixed(4)}</td>`).join('')}</tr></table>
      <table><tr><th>i</th>${diffs.map((_, i) => `<td>${i}</td>`).join('')}</tr><tr><th>(d<sub>i+${m}</sub>−d<sub>i</sub>)/${m} /mm</th>${diffs.map((x) => `<td>${x.toFixed(4)}</td>`).join('')}</tr></table>
      <p>$\\overline{\\Delta d}=${Dd.toFixed(4)}$ mm，$u(\\Delta d)≈${sig(u, 2)}$ mm（含判断重合位置的误差）。</p>
      <div class="result-box">$\\Delta\\lambda=\\dfrac{\\bar\\lambda^2}{2\\Delta d}=${texU(dl * 1e6, udl * 1e6, 'nm')}$</div>
      <p>F-P 干涉仪的反射率 R≈${this.R.toFixed(2)}，精细度 $\\mathcal F=\\pi\\sqrt R/(1-R)≈${(Math.PI * Math.sqrt(this.R) / (1 - this.R)).toFixed(0)}$；间距 d≈${this.e.toFixed(2)} mm 时可分辨的最小波长差约 $\\lambda^2/(2d\\mathcal F)≈${((lam * lam) / (2 * this.e * (Math.PI * Math.sqrt(this.R) / (1 - this.R))) * 1e6).toFixed(4)}$ nm，远小于钠双线的间隔，所以两套圆环能清楚分开。</p>
      <div class="result-box warn">钠 D 双线波长差标准值 0.597 nm，本次测量相对误差 ${pct(relErr(dl, DLAM))}。</div>`;
    return { html, ok: true, plots: [], answers: [{ label: '钠双线波长差 $\\Delta\\lambda$', unit: 'nm', value: dl * 1e6, digits: 4, tolRel: 0.008 }] };
  }

  principle() {
    return `<h3>1. 多光束干涉</h3><p>F-P 干涉仪由两块内表面镀高反射膜（反射率 $R$）、严格平行的平面镜组成，间距为 $d$。光在两镜间多次反射，透射光的光强为</p>
$$I=\\frac{I_0}{1+F\\sin^2(\\delta/2)},\\qquad \\delta=\\frac{4\\pi d\\cos\\theta}{\\lambda},\\quad F=\\frac{4R}{(1-R)^2}$$
<p>$R$ 越大，亮纹越细锐。扩展光源照明时形成定域在无穷远的等倾圆环；精细度 $\\mathcal F=\\pi\\sqrt R/(1-R)$ 为相邻亮纹间距与亮纹半宽度之比。</p>
${FIG.fabryPerotFig()}
<h3>2. 平行度的调节</h3><p>两镜不平行时，通光口径内不同位置的 $d$ 不同。眼睛移向间距大的一侧，中心级次 $2d/\\lambda$ 增大，圆环从中心冒出；眼睛移动时圆环不涨缩，说明两镜面已平行。眼瞳内的间距差会使圆环变宽。</p>
<h3>3. 测钠双线波长差</h3><p>钠光含 $\\lambda_1$、$\\lambda_2$ 两条谱线，形成两套圆环。中心处两者的级次差为 $2d(1/\\lambda_1-1/\\lambda_2)$，每当它变化 1，两套圆环由重合到再次重合：</p>
$$\\Delta d=\\frac{\\lambda_1\\lambda_2}{2(\\lambda_2-\\lambda_1)}\\ \\Rightarrow\\ \\Delta\\lambda\\approx\\frac{\\bar\\lambda^2}{2\\Delta d}$$
<h3>4. 本仿真的计算模型</h3><p>望远镜视场中每个像素对应一个倾角 $\\theta$，按 Airy 公式计算两条谱线（强度 1 : 0.6）的透射光强。像素内相位变化较大时，对 Airy 函数作解析积分求平均，避免外圈细密圆环产生混叠假象；眼瞳内间距的差异用三个采样点平均。镜面反射率和初始倾角每次随机生成。</p>`;
  }
}
