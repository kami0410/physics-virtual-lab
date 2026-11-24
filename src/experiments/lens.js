// 实验一：薄透镜焦距的测定（物距像距法 / 二次成像法(贝塞尔法) / 自准直法）
import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { I } from '../core/App.js';
import { AXIS_Y, MAT, mesh, labTable, opticalRail, carriage, lensMesh, whiteScreen, lampHousing, ICONS, canvasTexture } from '../core/Models.js';
import { ThickLens, lensImaging, autocollimation, imagePosition } from '../physics/matrixOptics.js';
import { linFit, mean, uA, fmtU, texU, sig, gauss, rand, relErr, pct, clamp } from '../core/Stats.js';
import { lineData } from '../core/Plot.js';

const D_LENS = 4.0; // 透镜通光口径 cm
const PX = 30; // 像屏观察窗：每 cm 像素
const SCREEN_CM = 12;

function objectPattern() {
  // 物屏上的透光图案（“F”字 + 箭头），白色透光区域，对应 2.4cm × 2.4cm
  const c = document.createElement('canvas');
  c.width = c.height = 240;
  const g = c.getContext('2d');
  g.fillStyle = '#fff6d8';
  const u = 100 / 1; // 100 px/cm
  // F 字：高 1.6cm
  g.fillRect(70, 40, 22, 160);
  g.fillRect(70, 40, 100, 22);
  g.fillRect(70, 108, 72, 20);
  // 小箭头
  g.beginPath(); g.moveTo(190, 190); g.lineTo(190, 120); g.lineTo(178, 136); g.moveTo(190, 120); g.lineTo(202, 136);
  g.strokeStyle = '#fff6d8'; g.lineWidth = 7; g.stroke();
  return { canvas: c, sizeCm: 2.4, pxPerCm: u };
}

const fmtSigned = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3);

export class LensExperiment {
  static meta = {
    id: 'lens',
    title: '薄透镜焦距的测定',
    subtitle: '物距像距法 · 二次成像法（贝塞尔法） · 自准直法',
    tags: ['几何光学', '光具座', '共轴调节'],
    level: '基础',
    time: '30 min',
    color: '#a86a12',
    formula: String.raw`f=\dfrac{L^2-d^2}{4L}`,
    measure: '凸透镜焦距 f',
    goals: ['学会光学元件的共轴调节方法', '掌握物距像距法、二次成像法与自准直法测量凸透镜焦距', '理解厚透镜主面位置对测量结果的影响，学习误差分析与不确定度评定'],
    questions: ['为什么二次成像法要求物屏与像屏间距 L > 4f？', '共轴调节不好会对测量结果产生什么影响？如何利用“大像小像”判断共轴？', '实际透镜有一定厚度，用透镜中心代替主面会带来怎样的系统误差？哪种方法受影响最小？'],
  };

  static thumb(ctx, w, h) {
    // 像屏上的倒立“F”字像
    ctx.fillStyle = '#3a3c3a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo((i * w) / 8, 0); ctx.lineTo((i * w) / 8, h); ctx.moveTo(0, (i * h) / 8); ctx.lineTo(w, (i * h) / 8); ctx.stroke(); }
    const o = objectPattern();
    ctx.save(); ctx.filter = 'blur(1.2px)'; ctx.translate(w / 2, h / 2); ctx.rotate(Math.PI);
    ctx.drawImage(o.canvas, -w * 0.42, -h * 0.42, w * 0.84, h * 0.84); ctx.restore();
  }

  constructor(app) {
    this.app = app;
    this.fTrue = rand(13.5, 17.5);
    this.lens = new ThickLens(this.fTrue, 0.62);
    this.lampOn = false;
    this.lensOff = { y: rand(0.6, 1.1) * (Math.random() < 0.5 ? -1 : 1), z: rand(0.5, 1.0) * (Math.random() < 0.5 ? -1 : 1) };
    this.mirrorTilt = 0.07;
    this.showRays = false;
    this.obj = objectPattern();
  }

  cameras() {
    return [
      { name: '全景', pos: [50, 75, 135], target: [50, 18, 0] },
      { name: '侧视光路', pos: [50, 26, 95], target: [50, 22, 0] },
      { name: '像屏', pos: [55, 30, 30], target: [85, 22, 0] },
    ];
  }
  toolButtons() {
    return [{ label: I.rays + '光路示意', get: () => this.showRays, onClick: () => (this.showRays = !this.showRays) }];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const table = labTable(210, 80); table.position.set(50, 0, 0); scene.add(table);
    scene.add(opticalRail(100));
    app.addRail({ origin: new THREE.Vector3(0, 0, 0), min: 0, max: 100 });
    app.stage.setLightTarget(50, 0, 0);

    // ---- 光源 ----
    const lampC = carriage(0x9aa3b2, AXIS_Y);
    const lh = lampHousing(0xfff1c1);
    lh.group.position.set(-6.2, 0, 0); lampC.top.add(lh.group);
    const lampLight = new THREE.PointLight(0xfff1c1, 0, 60, 1.5); lampLight.position.set(2, 0, 0); lampC.top.add(lampLight);
    this.lampParts = { glow: lh.glowMat, light: lampLight };
    app.addComponent(new Component({
      key: 'lamp', name: '白光光源', icon: ICONS.lamp, zone: 'rail', defaultPos: 7, required: true,
      desc: '带聚光镜的白炽灯光源，照亮物屏。', object: lampC.group, labelY: 36,
      controls: () => [{ type: 'toggle', label: '电源开关', get: () => this.lampOn, set: (v) => (this.lampOn = v) }],
    }));

    // ---- 物屏 ----
    const objC = carriage(0x9aa3b2, AXIS_Y);
    const plate = mesh(new THREE.BoxGeometry(0.3, 8, 8), MAT.dark(), 0, 0, 0);
    objC.top.add(plate);
    const objTex = canvasTexture(240, 240, (g) => { g.fillStyle = '#111'; g.fillRect(0, 0, 240, 240); g.drawImage(this.obj.canvas, 0, 0); });
    this.objFaceMat = new THREE.MeshStandardMaterial({ map: objTex, emissiveMap: objTex, emissive: 0xffffff, emissiveIntensity: 0 });
    const objFace = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), this.objFaceMat);
    objFace.rotation.y = Math.PI / 2; objFace.position.x = 0.17; objFace.scale.x = -1; objFace.userData.noHL = true;
    objC.top.add(objFace);
    const objFace2 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), this.objFaceMat);
    objFace2.rotation.y = -Math.PI / 2; objFace2.position.x = -0.17; objFace2.userData.noHL = true;
    objC.top.add(objFace2);
    plate.add(mesh(new THREE.BoxGeometry(0.6, 3, 1), MAT.dark(), 0, -5, 0));
    app.addComponent(new Component({
      key: 'object', name: '物屏（F 字透光屏）', icon: ICONS.object, zone: 'rail', defaultPos: 17, required: true,
      desc: '带有“F”字形透光图案的物屏，被光源照亮后作为物。', object: objC.group, labelY: 32,
    }));

    // ---- 凸透镜 ----
    const lensC = carriage(0x9aa3b2, AXIS_Y);
    const lm = lensMesh(D_LENS, 0.62); lensC.top.add(lm);
    this.lensMeshObj = lm;
    app.addComponent(new Component({
      key: 'lens', name: '凸透镜 L', icon: ICONS.lens, zone: 'rail', defaultPos: 45, required: true,
      desc: `待测凸透镜，口径 ${D_LENS} cm。透镜架可上下升降、左右平移，用于共轴调节。`, object: lensC.group, labelY: 30,
      controls: () => [
        { type: 'knob', label: '透镜高度（升降）', get: () => this.lensOff.y, set: (v) => (this.lensOff.y = v), min: -2, max: 2, step: 0.02, bigStep: 0.2, perRev: 0.5, digits: 2, unit: 'cm' },
        { type: 'knob', label: '透镜横向位置', get: () => this.lensOff.z, set: (v) => (this.lensOff.z = v), min: -2, max: 2, step: 0.02, bigStep: 0.2, perRev: 0.5, digits: 2, unit: 'cm' },
        { type: 'note', html: '共轴细调：把像屏放在 L&gt;4f 处，移动透镜得到大像和小像，调节透镜高度/横向位置使大像中心与小像中心重合。' },
      ],
    }));

    // ---- 像屏 ----
    const scrC = carriage(0x9aa3b2, AXIS_Y);
    const ws = whiteScreen(SCREEN_CM, SCREEN_CM); scrC.top.add(ws.group);
    this.screenView = app.addView({ id: 'screen', title: '像屏观察（白屏正面）', w: 260, h: 260, res: 1.4 });
    this.screenTex = new THREE.CanvasTexture(this.screenView.canvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    ws.face.material = new THREE.MeshBasicMaterial({ map: this.screenTex });
    ws.face.userData.noHL = true;
    app.addComponent(new Component({
      key: 'screen', name: '像屏（白屏）', icon: ICONS.screen, zone: 'rail', defaultPos: 80, required: true,
      desc: '白色像屏，屏上有十字刻线便于判断像的中心。', object: scrC.group, labelY: 33,
    }));

    // ---- 平面镜 ----
    const mC = carriage(0x9aa3b2, AXIS_Y);
    const mg = new THREE.Group();
    mg.add(mesh(new THREE.BoxGeometry(0.5, 7, 7), MAT.chrome()));
    mg.add(mesh(new THREE.BoxGeometry(0.4, 7.4, 7.4), MAT.dark(), 0.35, 0, 0));
    mg.add(mesh(new THREE.BoxGeometry(0.6, 3, 1), MAT.dark(), 0.2, -5, 0));
    mC.top.add(mg);
    this.mirrorGroup = mg;
    app.addComponent(new Component({
      key: 'mirror', name: '平面反射镜', icon: ICONS.mirror, zone: 'rail', defaultPos: 60,
      desc: '自准直法使用的平面镜，放在透镜后方，将平行光反射回透镜。', object: mC.group, labelY: 30,
      controls: () => [{ type: 'knob', label: '镜面俯仰微调', get: () => this.mirrorTilt * 1000, set: (v) => (this.mirrorTilt = v / 1000), min: -150, max: 150, step: 1, bigStep: 10, perRev: 40, digits: 0, unit: 'mrad', sub: '使反射像落在物屏图案旁边便于观察' }],
    }));

    // 物屏观察窗（自准直）
    this.objView = app.addView({ id: 'objscreen', title: '物屏观察（自准直像）', w: 220, h: 220, res: 1.4 });
    this.objView.show(false);

    // 光锥与光路线
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c1, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.cone.visible = false; scene.add(this.cone);
    this.beamA = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), this.cone.material.clone());
    this.beamB = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), this.cone.material.clone());
    scene.add(this.beamA, this.beamB);
    this.rays = new THREE.Group(); scene.add(this.rays);
  }

  // ---------- 物理核心 ----------
  pos(key) { const c = this.app.comp(key); return c.placed ? c.pos : null; }

  /** 当前成像状态：屏上像的放大率、模糊斑半径、中心偏移 */
  imaging(xs = this.pos('screen'), xL = this.pos('lens')) {
    const xo = this.pos('object');
    if (xo == null || xL == null || xs == null) return null;
    if (!(xo < xL - 0.5 && xL + 0.5 < xs)) return null;
    const { A, B, d1 } = lensImaging(xo, xL, xs, this.lens);
    const thMax = D_LENS / 2 / d1;
    const blur = Math.hypot(Math.abs(B) * thMax, 0.006);
    const mag = A - B / d1; // 光束中心线放大率
    const cy = this.lensOff.y * (1 - mag), cz = this.lensOff.z * (1 - mag);
    const bright = clamp(225 * thMax * thMax / Math.max(0.05, mag * mag), 0, 3);
    return { A, B, blur, mag, cy, cz, bright, d1 };
  }

  /** 求物屏与像屏之间能成清晰像的透镜位置（B=0 的根） */
  focusPositions(xo, xs) {
    const f = (xL) => lensImaging(xo, xL, xs, this.lens).B;
    const out = [];
    const N = 400;
    let x0 = xo + 1, f0 = f(x0);
    for (let i = 1; i <= N; i++) {
      const x1 = xo + 1 + ((xs - xo - 2) * i) / N, f1 = f(x1);
      if (f0 * f1 < 0) {
        let a = x0, b = x1;
        for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (f(a) * f(m) <= 0) b = m; else a = m; }
        out.push((a + b) / 2);
      }
      x0 = x1; f0 = f1;
    }
    return out;
  }

  update() {
    const app = this.app;
    const lit = this.lampOn && this.app.comp('lamp').placed;
    this.lampParts.glow.emissiveIntensity = lit ? 3 : 0;
    this.lampParts.light.intensity = lit ? 400 : 0;
    const xo = this.pos('object'), xl = this.pos('lamp');
    const objLit = lit && xo != null && xl != null && xl < xo;
    this.objFaceMat.emissiveIntensity = objLit ? 1.6 : 0;
    this.lensMeshObj.position.set(0, this.lensOff.y, this.lensOff.z);
    this.mirrorGroup.rotation.z = this.mirrorTilt;
    this.drawScreen(objLit);
    this.drawObjView(objLit);
    this.drawBeams(objLit);
    this.drawRays(objLit);
  }

  drawScreen(objLit) {
    const v = this.screenView, g = v.ctx, W = v.W, H = v.H;
    const s = W / SCREEN_CM; // px per cm
    const placed = this.app.comp('screen').placed;
    const amb = 0.14;
    g.save();
    g.fillStyle = `rgb(${amb * 255 + 20},${amb * 255 + 20},${amb * 255 + 22})`;
    g.fillRect(0, 0, W, H);
    // 坐标刻线
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1;
    for (let i = 1; i < SCREEN_CM; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, H); g.moveTo(0, i * s); g.lineTo(W, i * s); g.stroke(); }
    g.strokeStyle = 'rgba(180,20,20,.6)'; g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    let foot = '';
    if (placed && objLit) {
      const im = this.imaging();
      g.globalCompositeOperation = 'lighter';
      const xs = this.pos('screen'), xo = this.pos('object'), xL = this.pos('lens');
      if (im) {
        const mag = im.mag;
        const sz = this.obj.sizeCm * Math.abs(mag) * s;
        const blurPx = im.blur * s * 0.55;
        g.filter = blurPx > 0.4 ? `blur(${blurPx.toFixed(1)}px)` : 'none';
        g.globalAlpha = clamp(im.bright * 0.9, 0, 1);
        g.translate(W / 2 + im.cz * s, H / 2 - im.cy * s);
        g.scale(Math.sign(mag) || 1, Math.sign(mag) || 1);
        for (let k = 0; k < (im.bright > 1.2 ? 2 : 1); k++) g.drawImage(this.obj.canvas, -sz / 2, -sz / 2, sz, sz);
        foot = `放大率 β≈${mag.toFixed(2)}  弥散斑≈${(im.blur * 20).toFixed(2)} mm`;
      } else if (xs != null && xo != null && xs > xo) {
        // 无透镜或透镜不在物、屏之间：屏上只有一片模糊亮斑
        const d = xs - xo;
        g.filter = `blur(${Math.min(40, d * 0.8).toFixed(0)}px)`;
        g.globalAlpha = clamp(18 / d, 0, 0.7);
        g.fillStyle = '#fff3c4';
        g.beginPath(); g.arc(W / 2, H / 2, Math.min(W, 3 * s + d * 0.15 * s), 0, Math.PI * 2); g.fill();
        foot = xL == null ? '未放置透镜' : '透镜不在物屏与像屏之间';
      }
    } else foot = placed ? (this.lampOn ? '物屏未被照亮' : '光源未打开') : '未放置像屏';
    g.restore();
    v.foot(foot);
    this.screenTex.needsUpdate = true;
  }

  drawObjView(objLit) {
    const mirror = this.app.comp('mirror');
    const show = mirror.placed;
    this.objView.show(show);
    if (!show) return;
    const v = this.objView, g = v.ctx, W = v.W, H = v.H;
    const s = W / 6; // 物屏 6cm 视野
    g.save();
    g.fillStyle = '#2a2e36'; g.fillRect(0, 0, W, H);
    const xo = this.pos('object'), xL = this.pos('lens'), xM = mirror.pos, xs = this.pos('screen');
    let foot = '物屏背面被照亮，正面可见透光的 F 字';
    if (objLit) {
      g.globalAlpha = 0.85;
      const sz = this.obj.sizeCm * s;
      g.drawImage(this.obj.canvas, W / 2 - sz / 2, H / 2 - sz / 2, sz, sz);
      const blocked = xs != null && xs > xL && xs < xM;
      if (xL != null && xo < xL && xL < xM && !blocked) {
        const { A, B } = autocollimation(xo, xL, xM, this.lens);
        const d1 = xL - xo;
        const blur = Math.hypot(Math.abs(B) * (D_LENS / 2 / d1), 0.006);
        const f = this.lens.cardinal().f;
        const off = 2 * this.mirrorTilt * f;
        const bright = clamp(0.8 / Math.max(0.3, A * A) * Math.exp(-blur * 2), 0, 1);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = bright;
        const bp = blur * s * 0.55;
        g.filter = bp > 0.4 ? `blur(${Math.min(60, bp).toFixed(1)}px)` : 'none';
        g.translate(W / 2, H / 2 - off * s);
        g.scale(Math.sign(A) || 1, Math.sign(A) || 1);
        const sz2 = this.obj.sizeCm * Math.abs(A) * s;
        g.drawImage(this.obj.canvas, -sz2 / 2, -sz2 / 2, sz2, sz2);
        foot = `反射像：放大率≈${A.toFixed(2)}  弥散斑≈${(blur * 20).toFixed(2)} mm`;
      }
    }
    g.restore();
    v.foot(foot);
  }

  drawBeams(objLit) {
    // 光源到物屏的照明光锥 + 物屏到透镜、透镜到像点的光锥（示意）
    const xl = this.pos('lamp'), xo = this.pos('object'), xL = this.pos('lens');
    const setCone = (m, x0, x1, r0, r1, op) => {
      if (x1 - x0 < 0.5) { m.visible = false; return; }
      m.visible = true;
      // 用 CylinderGeometry 的替代：缩放圆锥(底面在 -y)
      m.geometry.dispose();
      m.geometry = new THREE.CylinderGeometry(r1, r0, x1 - x0, 32, 1, true);
      m.rotation.z = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, AXIS_Y, 0);
      m.material.opacity = op;
    };
    if (objLit) setCone(this.cone, xl + 3.5, xo, 1.9, 2.5, 0.07); else this.cone.visible = false;
    const im = this.imaging();
    if (objLit && xL != null && xo < xL) {
      setCone(this.beamA, xo, xL, 0.6, D_LENS / 2, 0.05);
      const xs = this.pos('screen');
      if (im) {
        const xi = imagePosition(xo, xL, this.lens);
        const end = Math.min(xs, xi > xL ? xi : xs);
        setCone(this.beamB, xL, end, D_LENS / 2, Math.max(0.05, Math.abs(im.blur) * (end === xs ? 1 : 0) + 0.05), 0.06);
      } else {
        const xm = this.app.comp('mirror');
        const end = xm.placed && xm.pos > xL ? xm.pos : xL + 30;
        setCone(this.beamB, xL, end, D_LENS / 2, D_LENS / 2, 0.04);
      }
    } else { this.beamA.visible = false; this.beamB.visible = false; }
  }

  drawRays(objLit) {
    this.rays.clear();
    const xo = this.pos('object'), xL = this.pos('lens');
    if (!this.showRays || xo == null || xL == null || xL <= xo) return;
    const f = this.lens.cardinal().f;
    const ly = this.lensOff.y;
    const h0 = 1.0; // 物高（F 字顶端约 +1cm）
    const xs = this.pos('screen');
    const xEnd = xs != null && xs > xL ? xs : xL + 60;
    const P = [xo, h0];
    const mat = new THREE.LineBasicMaterial({ color: 0xfacc15 });
    const mat2 = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5 });
    const add = (pts, m = mat) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, AXIS_Y + y, 0.02)));
      this.rays.add(new THREE.Line(g, m));
    };
    // 1. 平行于光轴 -> 过像方焦点
    const y1 = h0; const k1 = (ly - y1) / f;
    add([P, [xL, y1], [xEnd, y1 + k1 * (xEnd - xL)]]);
    // 2. 过光心
    const k2 = (ly - h0) / (xL - xo);
    add([P, [xL, ly], [xEnd, ly + k2 * (xEnd - xL)]]);
    // 3. 过物方焦点 -> 平行
    const xF = xL - f;
    if (Math.abs(xF - xo) > 0.3) {
      const k3 = (ly - h0) / (xF - xo);
      const y3 = h0 + k3 * (xL - xo);
      if (Math.abs(y3 - ly) < 6) add([P, [xL, y3], [xEnd, y3]]);
    }
    // 焦点标记与光轴
    add([[xL - 70, ly], [xL + 70, ly]], mat2);
    for (const xf of [xL - f, xL + f]) add([[xf, ly - 0.6], [xf, ly + 0.6]], new THREE.LineBasicMaterial({ color: 0xf472b6 }));
  }

  canPlace(comp) {
    if (comp.key === 'mirror' && this.app.comp('screen').placed) return null;
    return null;
  }

  // ---------- 记录 ----------
  readPos(key) { return Math.round((this.pos(key) + gauss(0.015)) * 100) / 100; }
  sharpWarn(blur) {
    if (blur > 0.05) this.app.toast(`提示：当前像不够清晰（弥散斑约 ${(blur * 20).toFixed(1)} mm），读数误差会较大`, 'warn');
  }

  tables() {
    return [
      {
        id: 'uv', title: '① 物距像距法',
        columns: [
          { key: 'xo', label: '物屏位置 x₀/cm', digits: 2 },
          { key: 'xL', label: '透镜位置 x_L/cm', digits: 2 },
          { key: 'xs', label: '像屏位置 x_s/cm', digits: 2 },
          { key: 'u', label: '物距 u/cm', digits: 2, calc: (r) => r.xL - r.xo },
          { key: 'v', label: '像距 v/cm', digits: 2, calc: (r) => r.xs - r.xL },
          { key: 'f', label: 'f=uv/(u+v) /cm', digits: 2, calc: (r) => ((r.xL - r.xo) * (r.xs - r.xL)) / (r.xs - r.xo) },
        ],
        buttons: [{
          label: '记录三者位置', onClick: (t) => {
            const im = this.imaging();
            if (!im) { this.app.toast('请先在导轨上依次放置物屏、透镜、像屏并使屏上成像', 'warn'); return; }
            this.sharpWarn(im.blur);
            t.addRow({ xo: this.readPos('object'), xL: this.readPos('lens'), xs: this.readPos('screen') });
          },
        }],
        note: '每改变一次透镜位置（物距），移动像屏使像最清晰后记录。建议测 4~6 组，物距在 1.3f~3f 之间变化。',
      },
      {
        id: 'bessel', title: '② 二次成像法',
        columns: [
          { key: 'xo', label: '物屏 x₀/cm', digits: 2 },
          { key: 'xs', label: '像屏 x_s/cm', digits: 2 },
          { key: 'x1', label: '大像时透镜 x₁/cm', digits: 2 },
          { key: 'x2', label: '小像时透镜 x₂/cm', digits: 2 },
          { key: 'L', label: 'L/cm', digits: 2, calc: (r) => r.xs - r.xo },
          { key: 'd', label: 'd=|x₂-x₁| /cm', digits: 2, calc: (r) => Math.abs(r.x2 - r.x1) },
          { key: 'f', label: 'f=(L²-d²)/4L /cm', digits: 2, calc: (r) => { const L = r.xs - r.xo, d = Math.abs(r.x2 - r.x1); return (L * L - d * d) / (4 * L); } },
        ],
        buttons: [
          { label: '记录“大像”透镜位置', onClick: (t) => this.recBessel(t, 'x1') },
          { label: '记录“小像”透镜位置', onClick: (t) => this.recBessel(t, 'x2') },
        ],
        note: '固定物屏与像屏，使 $L>4f$。移动透镜，分别得到清晰的放大像和缩小像并记录透镜位置。改变 L 重复 3 次以上。',
      },
      {
        id: 'auto', title: '③ 自准直法',
        columns: [
          { key: 'xo', label: '物屏位置 x₀/cm', digits: 2 },
          { key: 'xL', label: '透镜位置 x_L/cm', digits: 2 },
          { key: 'f', label: 'f=x_L-x₀ /cm', digits: 2, calc: (r) => r.xL - r.xo },
        ],
        buttons: [{
          label: '记录（物屏上像清晰时）', onClick: (t) => {
            const m = this.app.comp('mirror'), xo = this.pos('object'), xL = this.pos('lens');
            if (!m.placed || xo == null || xL == null || !(xo < xL && xL < m.pos)) { this.app.toast('请按 光源—物屏—透镜—平面镜 的顺序放置', 'warn'); return; }
            const { B } = autocollimation(xo, xL, m.pos, this.lens);
            this.sharpWarn(Math.abs(B) * (D_LENS / 2 / (xL - xo)));
            t.addRow({ xo: this.readPos('object'), xL: this.readPos('lens') });
          },
        }],
        note: '取下像屏，在透镜后放平面镜。移动透镜，直到物屏上出现与物等大、倒立的清晰像。',
      },
    ];
  }

  recBessel(t, key) {
    const im = this.imaging();
    if (!im) { this.app.toast('请先放置物屏、透镜、像屏并成像', 'warn'); return; }
    this.sharpWarn(im.blur);
    if (key === 'x1' && Math.abs(im.mag) < 1) this.app.toast('注意：当前是缩小像，应记录到“小像”一栏', 'warn');
    if (key === 'x2' && Math.abs(im.mag) > 1) this.app.toast('注意：当前是放大像，应记录到“大像”一栏', 'warn');
    const xo = this.readPos('object'), xs = this.readPos('screen');
    let i = t.rows.findIndex((r) => (r[key] == null) && Math.abs(r.xo - xo) < 0.2 && Math.abs(r.xs - xs) < 0.2);
    if (i < 0) i = t.addRow({ xo, xs });
    t.set(i, key, this.readPos('lens'));
  }

  // ---------- 步骤 ----------
  steps() {
    const app = this.app;
    const P = (k) => app.comp(k).placed;
    const ordered = () => P('lamp') && P('object') && P('lens') && P('screen') && this.pos('lamp') < this.pos('object') && this.pos('object') < this.pos('lens') && this.pos('lens') < this.pos('screen');
    return [
      {
        title: '在光具座上摆放器材',
        html: '<p>从右侧器材架中把 <b>白光光源、物屏、凸透镜、像屏</b> 依次放到导轨上（从左到右）。</p><p>可以拖动器材到导轨上，也可以单击器材自动放置。</p>',
        hint: '物屏应紧靠光源；透镜放在中间；像屏放在离物屏 60~80 cm 处。',
        check: ordered,
        status: () => ordered() ? '' : '<b>需要顺序：光源 → 物屏 → 透镜 → 像屏</b>',
        auto: async () => {
          await app.view('全景');
          await app.autoPlace('lamp', { pos: 7 });
          await app.autoPlace('object', { pos: 17 });
          await app.autoPlace('lens', { pos: 45 });
          await app.autoPlace('screen', { pos: 85 });
        },
      },
      {
        title: '打开光源，观察像屏',
        html: '<p>选中光源，打开电源开关。物屏上的“F”字被照亮，像屏上出现光斑或像。</p>',
        check: () => this.lampOn,
        auto: async () => { app.select(app.comp('lamp')); await app.wait(300); this.lampOn = true; app.changed(); await app.wait(500); },
      },
      {
        title: '共轴调节（大像小像法）',
        html: '<p><b>粗调</b>：目测使各元件中心大致等高、在一条直线上。</p><p><b>细调</b>：保持物屏与像屏距离大于 4f，移动透镜分别得到清晰的大像和小像。若两次像的中心不重合，说明透镜光心偏离光轴：<b>“大像追小像”</b>——调节透镜高度与横向位置，直到大像与小像中心都落在像屏十字线中心。</p>',
        hint: '大像中心偏离量 = (1−β)×透镜偏心量，β 为放大率。调节方向应使大像中心向小像中心靠拢，且略微“超过”。',
        check: () => Math.abs(this.lensOff.y) < 0.08 && Math.abs(this.lensOff.z) < 0.08,
        status: () => `透镜光心偏离光轴约：<b>${(Math.hypot(this.lensOff.y, this.lensOff.z) * 10).toFixed(1)} mm</b>（需 &lt; 0.8 mm）`,
        auto: async () => {
          const xo = this.pos('object');
          await app.moveTo('screen', Math.min(99, xo + Math.max(72, 4.4 * this.fTrue)));
          const [p1, p2] = this.focusPositions(xo, this.pos('screen'));
          await app.view('侧视光路');
          app.say('移动透镜得到放大像，观察像中心的位置');
          await app.moveTo('lens', p1);
          await app.wait(600);
          app.say('再移动透镜得到缩小像，两次像中心不重合——透镜偏心');
          await app.moveTo('lens', p2);
          await app.wait(600);
          app.select(app.comp('lens'));
          app.say('调节透镜高度与横向位置，使大像、小像中心重合');
          await app.moveTo('lens', p1);
          await app.tween(() => this.lensOff.y, (v) => (this.lensOff.y = v), 0.01, 900);
          await app.tween(() => this.lensOff.z, (v) => (this.lensOff.z = v), -0.01, 900);
          await app.moveTo('lens', p2);
          await app.wait(400);
        },
      },
      {
        title: '物距像距法测焦距',
        html: '<p>固定物屏，把透镜放在距物屏 $u$（$f<u<3f$）处，移动像屏直到像最清晰，记录物屏、透镜、像屏的位置。</p><p>改变物距，重复测量至少 <b>4 组</b>。由 $\\frac1u+\\frac1v=\\frac1f$ 计算焦距。</p>',
        hint: '判断“最清晰”时可采用左右逼近法：从两侧向清晰位置移动像屏，取两次清晰位置的平均。',
        check: () => { const t = app.table('uv'); const rows = t.completeRows(); if (rows.length < 4) return false; const us = rows.map((r) => r.xL - r.xo); return Math.max(...us) - Math.min(...us) > 4; },
        status: () => `已记录 <b>${app.table('uv').completeRows().length}</b> 组（需 ≥4 组，且物距有明显变化）`,
        auto: async () => {
          await app.view('全景');
          const xo = this.pos('object');
          // 按本透镜的焦距选物距：像必须落在导轨（≤ 99 cm）上，取可行范围内均匀分布的 4 个物距
          const ok = [];
          for (let u = this.fTrue * 1.05; u < this.fTrue * 3.6; u += 0.25) { const xi = imagePosition(xo, xo + u, this.lens); if (xi > xo + u + 2 && xi < 97) ok.push(u); }
          const us = ok.length ? [0.05, 0.35, 0.65, 0.95].map((q) => Math.round(ok[Math.floor(q * (ok.length - 1))])) : [21, 25, 30, 40];
          for (const u of us) {
            const xL = xo + u;
            await app.moveTo('lens', xL, 700);
            const xi = imagePosition(xo, xL, this.lens);
            if (xi > 99) continue;
            await app.moveTo('screen', Math.min(100, xi + 4), 600);
            await app.moveTo('screen', xi - 2.5, 600);
            await app.moveTo('screen', xi, 500);
            await app.record('uv');
          }
        },
      },
      {
        title: '二次成像法（贝塞尔法）测焦距',
        html: '<p>固定物屏与像屏，间距 $L>4f$。移动透镜，在两个位置 $x_1$、$x_2$ 分别得到清晰的放大像与缩小像，$d=|x_2-x_1|$，则</p>$$f=\\frac{L^2-d^2}{4L}$$<p>改变 $L$ 重复 <b>3 次</b>以上。此法不需测量透镜光心位置，可避免厚透镜主面位置不确定带来的误差。</p>',
        hint: '若 L 太小（L<4f）将找不到两个成像位置；L 太大则缩小像太小、不易判断清晰。',
        check: () => app.table('bessel').completeRows().length >= 3,
        status: () => `已完成 <b>${app.table('bessel').completeRows().length}</b> 组（需 ≥3 组）`,
        auto: async () => {
          const xo = this.pos('object');
          // L 必须大于 4f（否则没有两个成像位置），又不能超出导轨：在 4.3f ~ min(导轨, 5.6f) 内取 3 个
          const L0 = 4.3 * this.fTrue, L1 = Math.max(L0 + 2, Math.min(99 - xo, 5.6 * this.fTrue));
          for (const L of [L0, (L0 + L1) / 2, L1].map((v) => Math.round(v * 2) / 2)) {
            await app.moveTo('screen', xo + L, 700);
            const [p1, p2] = this.focusPositions(xo, xo + L);
            await app.moveTo('lens', p1 - 2, 600); await app.moveTo('lens', p1, 400);
            await app.record('bessel', 0);
            await app.moveTo('lens', p2 + 2, 700); await app.moveTo('lens', p2, 400);
            await app.record('bessel', 1);
          }
        },
      },
      {
        title: '自准直法测焦距（选做）',
        optional: true,
        html: '<p>取下像屏，在透镜后放置<b>平面反射镜</b>。当物屏位于透镜焦平面上时，物上各点发出的光经透镜成平行光，被平面镜反射后再经透镜会聚在物屏上，形成与物等大的倒立实像。</p><p>移动透镜使物屏上的反射像最清晰，此时 $f=x_L-x_0$。重复测量 3 次。</p>',
        hint: '反射像出现在物屏“F”字的旁边（平面镜略有倾斜）。观察右侧“物屏观察”窗口。',
        check: () => app.table('auto').completeRows().length >= 3,
        status: () => `已记录 <b>${app.table('auto').completeRows().length}</b> 次（需 ≥3 次）`,
        auto: async () => {
          app.remove(app.comp('screen'));
          const xo = this.pos('object');
          await app.moveTo('lens', xo + this.fTrue + 6, 600);
          await app.autoPlace('mirror', { pos: Math.min(100, xo + this.fTrue + 14) });
          await app.view('侧视光路');
          // 求自准直清晰位置
          const xM = app.comp('mirror').pos;
          const F = (x) => autocollimation(xo, x, xM, this.lens).B;
          let a = xo + 5, b = xM - 1;
          for (let k = 0; k < 60; k++) { const m = (a + b) / 2; if (F(a) * F(m) <= 0) b = m; else a = m; }
          const x0 = (a + b) / 2;
          for (const dx of [2.5, -2.5, 2]) {
            await app.moveTo('lens', x0 + dx, 500);
            await app.moveTo('lens', x0, 500);
            await app.record('auto');
          }
        },
      },
      {
        title: '数据处理与误差分析',
        html: '<p>点击“数据处理”，计算三种方法得到的焦距、平均值及不确定度，并用 $1/u$–$1/v$ 图线法作直线拟合。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(800); },
      },
    ];
  }

  analyze() {
    const app = this.app;
    const out = []; const plots = []; const answers = [];
    let ok = false;
    const fRef = this.lens.cardinal().f;
    const uB = 0.10 / Math.sqrt(3); // 成像清晰位置判断引入的 B 类不确定度(cm)
    const uR = 0.05 / Math.sqrt(3); // 导轨标尺读数（分度 1 mm，取半格）
    const t1 = app.table('uv'); const r1 = t1.completeRows();
    if (r1.length >= 2) {
      ok = true;
      const fs = r1.map((r) => ((r.xL - r.xo) * (r.xs - r.xL)) / (r.xs - r.xo));
      const fm = mean(fs), ua = uA(fs);
      // f = uv/(u+v)：∂f/∂x₀ = −v²/(u+v)²，∂f/∂x_L = (v²−u²)/(u+v)²，∂f/∂x_s = u²/(u+v)²；像屏位置另含清晰判断误差
      const ubs = r1.map((r) => { const a = r.xL - r.xo, b = r.xs - r.xL, s2 = (a + b) ** 2; return Math.hypot((b * b / s2) * uR, ((b * b - a * a) / s2) * uR, (a * a / s2) * Math.hypot(uR, uB)); });
      const ubF = mean(ubs);
      const u = Math.hypot(ua, ubF);
      const iu = r1.map((r) => 1 / (r.xL - r.xo)), iv = r1.map((r) => 1 / (r.xs - r.xL));
      const fit = linFit(iu, iv);
      const fFit = 1 / fit.b;
      const ufFit = fit.ub / (fit.b * fit.b);
      out.push(`<h3>① 物距像距法</h3><p>各组焦距：${fs.map((f) => f.toFixed(2)).join('，')} cm</p>
        <p>平均值 $\\bar f = ${fm.toFixed(3)}$ cm，A 类不确定度 $u_A=${sig(ua, 2)}$ cm，B 类（导轨读数与清晰位置判断，按误差传递）$u_B≈${sig(ubF, 2)}$ cm</p>
        <div class="result-box">$f_1 = ${texU(fm, u, 'cm')}$ </div>
        <p><b>图线法：</b>以 $1/u$ 为横轴、$1/v$ 为纵轴作图，直线 $\\frac1v=-\\frac1u+\\frac1f$ 的截距为 $1/f$。拟合得斜率 $k=${fit.k.toFixed(3)}$（理论 −1），截距 $b=${fit.b.toFixed(5)}$ cm⁻¹，相关系数 $r=${fit.r.toFixed(5)}$，由截距得 $f=${texU(fFit, ufFit, 'cm')}$。</p>
        <div class="plot-wrap"><canvas data-plot="${plots.length}" style="height:300px"></canvas></div>`);
      const xa = Math.min(...iu) * 0.9, xb = Math.max(...iu) * 1.1;
      plots.push({ title: '1/v – 1/u 图线', xLabel: '1/u (cm⁻¹)', yLabel: '1/v (cm⁻¹)', series: [
        { type: 'scatter', data: iu.map((x, i) => [x, iv[i]]), color: '#fbbf24', label: '实验数据' },
        { type: 'line', data: lineData(fit.k, fit.b, xa, xb), color: '#38bdf8', label: `拟合: 1/v = ${fit.k.toFixed(3)}·(1/u) + ${fit.b.toFixed(4)}` },
      ] });
      this._f1 = fm;
      answers.push({ label: '物距像距法 $f_1$（各组平均）', unit: 'cm', value: fm, digits: 2 });
    }
    const t2 = app.table('bessel'); const r2 = t2.completeRows();
    if (r2.length >= 1) {
      ok = true;
      const fs = r2.map((r) => { const L = r.xs - r.xo, d = Math.abs(r.x2 - r.x1); return (L * L - d * d) / (4 * L); });
      const fm = mean(fs), ua = uA(fs);
      // f = (L²−d²)/4L：∂f/∂L = (1+d²/L²)/4，∂f/∂d = −d/2L；u(L) = √2·u_R，u(d) = √2·u_B（两次清晰位置判断）
      const ubF = mean(r2.map((r) => { const L = r.xs - r.xo, d = Math.abs(r.x2 - r.x1); return Math.hypot(((1 + (d * d) / (L * L)) / 4) * Math.SQRT2 * uR, (d / (2 * L)) * Math.SQRT2 * Math.hypot(uB, uR)); }));
      const u = Math.hypot(ua, ubF);
      out.push(`<h3>② 二次成像法</h3><p>各组：${r2.map((r, i) => `L=${(r.xs - r.xo).toFixed(2)}，d=${Math.abs(r.x2 - r.x1).toFixed(2)}，f=${fs[i].toFixed(3)}`).join('；')}（cm）</p>
        <div class="result-box">$f_2 = ${texU(fm, u, 'cm')}$</div>`);
      answers.push({ label: '二次成像法 $f_2$', unit: 'cm', value: fm, digits: 2 });
    }
    const t3 = app.table('auto'); const r3 = t3.completeRows();
    if (r3.length >= 1) {
      ok = true;
      const fs = r3.map((r) => r.xL - r.xo);
      const fm = mean(fs), ua = uA(fs);
      out.push(`<h3>③ 自准直法</h3><p>各次：${fs.map((f) => f.toFixed(2)).join('，')} cm</p><div class="result-box">$f_3 = ${texU(fm, Math.hypot(ua, uB, Math.SQRT2 * uR), 'cm')}$</div>`);
      answers.push({ label: '自准直法 $f_3$', unit: 'cm', value: fm, digits: 2 });
    }
    if (!ok) return { html: '<p>请先在数据表中记录至少两组数据。</p>', ok: false };
    const c = this.lens.cardinal();
    out.push(`<h3>与参考值比较</h3><div class="result-box warn">本次实验中待测透镜（K9 玻璃双凸透镜，厚度 ${this.lens.t.toFixed(2)} cm，曲率半径 R=${this.lens.R.toFixed(2)} cm）的有效焦距参考值为 <b>f = ${fRef.toFixed(3)} cm</b>。
      ${this._f1 ? `物距像距法相对误差 ${pct(relErr(this._f1, fRef))}。` : ''}<br>
      厚透镜的前、后主面 H、H′ 分别位于透镜中心 ${fmtSigned(c.hFront)} cm 与 ${fmtSigned(c.hBack)} cm 处（主面间距 Δ = ${Math.abs(c.hBack - c.hFront).toFixed(3)} cm）。以透镜中心代替主面量物距、像距，焦距的系统误差约为 Δ 量级；自准直法量的是物屏到透镜中心的距离，偏差约为 ${Math.abs(c.hFront).toFixed(2)} cm。二次成像法不需要知道主面的位置，但 L 中包含了主面间距，残余误差约 $\tfrac{\Delta}{4}(1+d^2/L^2)$，比前两种方法小得多。</div>`);
    return { html: out.join(''), plots, ok, answers };
  }

  principle() {
    return `<h3>1. 透镜成像公式</h3><p>在近轴条件下，薄透镜的物距 $u$、像距 $v$ 与焦距 $f$ 满足高斯公式</p>
$$\\frac{1}{u}+\\frac{1}{v}=\\frac{1}{f}\\quad\\Rightarrow\\quad f=\\frac{uv}{u+v}$$
<p>横向放大率 $\\beta=-v/u$，像为倒立实像。</p>
<h3>2. 二次成像法（贝塞尔法）</h3><p>物屏与像屏相距 $L$（$L>4f$），透镜在两位置 $x_1,x_2$ 都能成清晰像，由成像公式对称性得</p>
$$f=\\frac{L^2-d^2}{4L},\\quad d=|x_2-x_1|$$
<p>该方法只需测量透镜的移动距离，避免了确定透镜光心（主面）位置的误差。</p>
<h3>3. 自准直法</h3><p>物位于透镜焦平面时，出射光为平行光，经平面镜反射后在物平面上成等大倒立实像，此时物到透镜的距离即为焦距。</p>
<h3>4. 本仿真的计算模型</h3><p>程序把待测透镜建模为 K9 玻璃（$n=1.5163$）双凸<b>厚透镜</b>，用光线传输矩阵（ABCD 矩阵）计算从物平面到像屏的系统矩阵：</p>
$$\\begin{pmatrix}y'\\\\\\theta'\\end{pmatrix}=T(d_2)\\,R_2\\,T(t)\\,R_1\\,T(d_1)\\begin{pmatrix}y\\\\\\theta\\end{pmatrix}=\\begin{pmatrix}A&B\\\\C&D\\end{pmatrix}\\begin{pmatrix}y\\\\\\theta\\end{pmatrix}$$
<p>其中 $R_i=\\begin{pmatrix}1&0\\\\\\frac{n_1-n_2}{n_2R}&\\frac{n_1}{n_2}\\end{pmatrix}$ 为球面折射矩阵。成像清晰的条件为 $B=0$，放大率为 $A$；物点发出的、充满透镜口径 $D$ 的光束在屏上的弥散斑半径 $r=|B|\\cdot\\frac{D}{2d_1}$，程序据此对像作模糊处理，从而再现“前后移动像屏寻找最清晰位置”的真实体验。透镜光心偏离光轴时，像中心位置 $y_c=\\delta(1-\\beta)$，用于共轴调节。</p>`;
  }

  dispose() {}
}
