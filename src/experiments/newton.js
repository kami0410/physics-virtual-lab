// 实验三：牛顿环测平凸透镜曲率半径（读数显微镜）
import * as THREE from 'three';
import { meta, thumb, LINES } from './newton.meta.js';
import { Component } from '../core/Component.js';
import { drawDrum } from '../core/Reticle.js';
import { MAT, mesh, labTable, lampHousing, ICONS, canvasTexture, knobMesh, glowSprite } from '../core/Models.js';
import { newtonIntensity, GLSL_FILM } from '../physics/interference.js';
import { GPU, GLSL } from '../core/gpu.js';
import { linFit, mean, uA, fmtU, texU, sig, gauss, rand, relErr, pct, clamp, successiveDiff } from '../core/Stats.js';
import { lineData } from '../core/Plot.js';

const LAMBDA = 589.3e-6;
const FOV = 2.4; // 显微镜视场直径 (mm，物方)
const NEWTON_FS = GLSL_FILM + GLSL.sodium + `
uniform float uPos, uS, uR, uE0, uCx, uCy, uB, uPlaced;
float I1(vec2 L) {
  if (uPlaced < 0.5) return 0.35;
  float x = uPos + (L.x - 150.5) * uS, y = (150.5 - L.y) * uS;
  float r2 = (x - uCx) * (x - uCx) + (y - uCy) * (y - uCy);
  return r2 < 100.0 ? newtonI(r2, uR, uE0) : 0.5;
}
vec3 shade(vec2 L) {
  float d = 0.25 * uPx; // 每个输出像素 2×2 超采样
  float I = 0.25 * (I1(L + vec2(-d, -d)) + I1(L + vec2(d, -d)) + I1(L + vec2(-d, d)) + I1(L + vec2(d, d)));
  return sodium(uB * (0.08 + 0.92 * I));
}`;
const BACK = 0.02; // 鼓轮空程 mm
const MS = [25, 24, 23, 22, 21, 20, 19, 18, 17, 16];

export class NewtonExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.R = rand(850, 1150); // mm
    this.e0 = rand(0.02, 0.28) * LAMBDA;
    this.lampOn = false; this.warm = 0;
    this.plate = rand(0, 1) < 0.5 ? rand(28, 36) : rand(54, 62);
    this.dioptZero = rand(-1.2, 1.2); this.diopt = 0;
    this.focusZero = rand(-0.4, 0.4); this.focus = this.focusZero - rand(2.5, 3.5); // 镜筒高度（mm）
    this.rot = rand(4, 8) * (Math.random() < 0.5 ? -1 : 1);
    this.dev = { x: rand(1.5, 3) * (Math.random() < 0.5 ? -1 : 1), y: rand(0.8, 1.6) * (Math.random() < 0.5 ? -1 : 1) };
    this.drive = 25.0 + rand(-0.4, 0.4); this.pos = this.drive; this.lastDir = 0; this.travel = 0;
    this.assist = !this.app.readSelf; // 自己读数时默认不显示读数辅助
    this.off = document.createElement('canvas');
    this.off.width = this.off.height = 300;
  }

  get cx() { return 25 + this.dev.x; }
  get cy() { return this.dev.y; }
  /** 叉丝处对应的干涉级次（暗环序号） */
  orderAt(x) { const r2 = (x - this.cx) ** 2 + this.cy ** 2; return r2 / (this.R * LAMBDA) + (2 * this.e0) / LAMBDA; }
  ringX(m, side) { const r = Math.sqrt(Math.max(0, (m - (2 * this.e0) / LAMBDA) * this.R * LAMBDA - this.cy ** 2)); return this.cx + side * r; }
  get bright() { return (this.lampOn ? this.warm : 0) * Math.exp(-(((this.plate - 45) / 6) ** 2)) * (this.app.comp('newton').placed ? 1 : 0.6); }

  cameras() {
    return [
      { name: '全景', pos: [20, 70, 95], target: [0, 18, 0] },
      { name: '显微镜', pos: [22, 34, 40], target: [0, 18, 0] },
      { name: '鼓轮', pos: [42, 22, 34], target: [16, 10, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const table = labTable(150, 100); scene.add(table);
    app.stage.setLightTarget(0, 0, 0);

    // ---------- 读数显微镜 ----------
    const mic = new THREE.Group();
    const green = MAT.paint(0x4b5a53);
    mic.add(mesh(new THREE.BoxGeometry(34, 4, 22), green, 0, 2, 0));
    mic.add(mesh(new THREE.BoxGeometry(14, 0.4, 12), MAT.glass(0xe8f4ff, 0.4), 0, 4.2, 2));
    // 立柱与水平导轨
    mic.add(mesh(new THREE.BoxGeometry(4, 30, 4), green, 0, 17, -8));
    mic.add(mesh(new THREE.BoxGeometry(30, 3, 3), MAT.alu(), 0, 30, -6.5));
    // 主尺
    const scaleTex = canvasTexture(1024, 64, (g, W, H) => {
      g.fillStyle = '#ece6d2'; g.fillRect(0, 0, W, H); g.fillStyle = '#111';
      for (let i = 0; i <= 50; i++) { const x = 12 + (i / 50) * (W - 24); g.fillRect(x, 0, 2, i % 10 === 0 ? 34 : i % 5 === 0 ? 24 : 14); if (i % 10 === 0) { g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.fillText(String(i), x, 58); } }
    });
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(26, 1.6), new THREE.MeshStandardMaterial({ map: scaleTex }));
    sc.position.set(0, 30, -4.98); mic.add(sc);
    // 鼓轮
    this.drum = new THREE.Group();
    const dtex = canvasTexture(1024, 64, (g, W, H) => { g.fillStyle = '#d4d4d8'; g.fillRect(0, 0, W, H); g.fillStyle = '#111'; for (let i = 0; i < 100; i++) { const x = (i / 100) * W; g.fillRect(x, 0, 2, i % 10 === 0 ? 40 : i % 5 === 0 ? 28 : 18); } });
    const dr = mesh(new THREE.CylinderGeometry(2.6, 2.6, 3, 48), [new THREE.MeshStandardMaterial({ map: dtex, metalness: 0.6, roughness: 0.35 }), MAT.chrome(), MAT.chrome()]);
    dr.rotation.z = Math.PI / 2; this.drum.add(dr);
    const dk = mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.5, 24), MAT.black(), 2.6, 0, 0); dk.rotation.z = Math.PI / 2; this.drum.add(dk);
    this.drum.position.set(17.5, 30, -6.5); mic.add(this.drum);
    // 镜筒（随鼓轮水平移动）
    this.tube = new THREE.Group();
    this.tube.add(mesh(new THREE.BoxGeometry(4, 5, 4), green, 0, 30, -4));
    this.tubeBody = new THREE.Group();
    this.tubeBody.add(mesh(new THREE.CylinderGeometry(1.3, 1.3, 20, 24), MAT.black(), 0, 22, 0));
    this.tubeBody.add(mesh(new THREE.CylinderGeometry(1.6, 1.4, 4, 24), MAT.black(), 0, 33.5, 0));
    this.tubeBody.add(mesh(new THREE.CylinderGeometry(0.9, 0.7, 2.5, 20), MAT.chrome(), 0, 11, 0));
    // 45° 反射玻片
    this.plateMesh = mesh(new THREE.BoxGeometry(3.2, 0.15, 3.2), MAT.glass(0xdff3ff, 0.5), 0, 8.2, 0);
    this.tubeBody.add(this.plateMesh);
    this.tube.add(this.tubeBody);
    // 调焦手轮
    const fk = knobMesh(1.6, 1.4); fk.rotation.x = Math.PI / 2; fk.position.set(0, 26, -3); this.tube.add(fk);
    mic.add(this.tube);
    app.addComponent(new Component({
      key: 'mic', name: '读数显微镜', zone: 'none', fixed: true, object: mic, labelY: 40,
      desc: '测微鼓轮转一圈镜筒平移 1 mm，鼓轮 100 分格，分度值 0.01 mm，估读到 0.001 mm。镜筒下方的 45° 玻片把钠光反射到待测样品上。',
      controls: () => [
        { type: 'group', label: '照明与调焦' },
        { type: 'knob', label: '45° 反射玻片角度', get: () => this.plate, set: (v) => (this.plate = v), min: 20, max: 70, step: 0.5, bigStep: 5, perRev: 30, digits: 1, unit: '°' },
        { type: 'knob', label: '目镜视度（看清叉丝）', get: () => this.diopt, set: (v) => (this.diopt = v), min: -3, max: 3, step: 0.05, bigStep: 0.5, perRev: 2, digits: 2, unit: 'D' },
        { type: 'knob', label: '调焦手轮（镜筒升降）', get: () => this.focus, set: (v) => (this.focus = v), min: -6, max: 6, step: 0.01, bigStep: 0.2, perRev: 2, digits: 2, unit: 'mm', sub: '应自下而上缓慢升起镜筒，避免压碎样品' },
        { type: 'knob', label: '目镜转角（叉丝取向）', get: () => this.rot, set: (v) => (this.rot = v), min: -15, max: 15, step: 0.2, bigStep: 2, perRev: 30, digits: 1, unit: '°' },
        { type: 'group', label: '测微鼓轮' },
        { type: 'knob', label: '测微鼓轮', get: () => this.drive, set: (v) => this.moveDrive(v), min: 0, max: 50, step: 0.002, bigStep: 0.05, perRev: 1, digits: 3, unit: 'mm', sub: '测量时始终沿同一方向转动' },
        { type: 'slider', label: '快速移动镜筒（粗）', get: () => this.drive, set: (v) => this.moveDrive(v), min: 15, max: 35, step: 0.01, digits: 2, unit: 'mm' },
      ],
    }));

    // ---------- 可放置器材 ----------
    app.addSlot({ id: 'stage', pos: new THREE.Vector3(0, 4.4, 2), accepts: ['newton'] });
    app.addSlot({ id: 'lamp', pos: new THREE.Vector3(-30, 0, 2), accepts: ['lamp'] });

    const ng = new THREE.Group();
    ng.add(mesh(new THREE.CylinderGeometry(4.2, 4.2, 1.2, 48), MAT.paint(0x3b3f45), 0, 0.6, 0));
    const ringTex = canvasTexture(256, 256, (g, W, H) => { g.fillStyle = '#20252b'; g.fillRect(0, 0, W, H); for (let k = 30; k > 0; k--) { g.beginPath(); g.arc(W / 2, H / 2, Math.sqrt(k) * 18, 0, Math.PI * 2); g.fillStyle = k % 2 ? 'rgba(230,180,60,.18)' : 'rgba(20,20,20,.5)'; g.fill(); } });
    const glassTop = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.MeshStandardMaterial({ map: ringTex, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 }));
    glassTop.rotation.x = -Math.PI / 2; glassTop.position.y = 1.22; glassTop.userData.noHL = true; ng.add(glassTop);
    for (let i = 0; i < 3; i++) { const a = (i * 2 * Math.PI) / 3; const s = mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 10), MAT.chrome(), Math.cos(a) * 3.7, 1.5, Math.sin(a) * 3.7); ng.add(s); }
    this.newtonGroup = ng;
    app.addComponent(new Component({
      key: 'newton', name: '牛顿环仪', icon: ICONS.newton, zone: 'slot', defaultSlot: 'stage', required: true, object: ng, labelY: 9,
      desc: '曲率半径较大的平凸透镜放在平板玻璃上，两者之间形成以接触点为中心的空气薄层。三个螺钉不宜拧得过紧，以免透镜变形。',
      controls: () => [
        { type: 'knob', label: '在载物台上左右移动', get: () => this.dev.x, set: (v) => (this.dev.x = v), min: -5, max: 5, step: 0.02, bigStep: 0.2, perRev: 2, digits: 2, unit: 'mm' },
        { type: 'knob', label: '在载物台上前后移动', get: () => this.dev.y, set: (v) => (this.dev.y = v), min: -5, max: 5, step: 0.01, bigStep: 0.2, perRev: 2, digits: 2, unit: 'mm', sub: '使环心与叉丝交点重合，叉丝移动时应通过环心' },
      ],
    }));

    const lg = new THREE.Group();
    const lh = lampHousing(0xffc21a, 10, 13);
    lh.group.position.y = 9.5; lg.add(lh.group);
    lg.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 4, 12), MAT.alu(), 0, 1.5, 0));
    lg.add(mesh(new THREE.BoxGeometry(12, 1, 10), MAT.dark(), 0, 0.5, 0));
    this.lampGlow = lh.glowMat;
    this.lampSprite = glowSprite(0xffb800, 14); this.lampSprite.position.set(8.5, 9.5, 0); this.lampSprite.visible = false; lg.add(this.lampSprite);
    this.lampLight = new THREE.PointLight(0xffb020, 0, 80, 1.6); this.lampLight.position.set(10, 9.5, 0); lg.add(this.lampLight);
    app.addComponent(new Component({
      key: 'lamp', name: '钠光灯', icon: ICONS.sodium, zone: 'slot', defaultSlot: 'lamp', required: true, object: lg, labelY: 20,
      desc: '低压钠灯，主要发出 589.0 nm 与 589.6 nm 两条谱线（平均 589.3 nm），开灯后需预热数分钟才能达到稳定亮度。',
      controls: () => [{ type: 'toggle', label: '电源开关', get: () => this.lampOn, set: (v) => (this.lampOn = v) }, { type: 'readout', label: '预热状态', get: () => (this.lampOn ? `${Math.round(this.warm * 100)}%` : '未开灯') }],
    }));

    this.view = app.addView({ id: 'eye', title: '显微镜目镜视场', w: 280, h: 280, res: 300 / 280 });
    this.readView = app.addView({ id: 'read', title: '主尺与测微鼓轮', w: 280, h: 110, res: 1.5 });
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

  tick(dt) {
    if (this.lampOn && this.warm < 1) { this.warm = Math.min(1, this.warm + dt / 4); this.app.changed(); }
    if (!this.lampOn && this.warm > 0) { this.warm = 0; this.app.changed(); }
  }

  update() {
    // 3D
    this.tube.position.x = (this.drive - 25) * 0.5;
    this.tubeBody.position.y = this.focus * 0.4;
    this.drum.rotation.x = this.drive * Math.PI * 2;
    this.plateMesh.rotation.z = ((this.plate - 45) * Math.PI) / 180 + Math.PI / 4;
    const on = this.lampOn && this.app.comp('lamp').placed;
    this.lampGlow.emissiveIntensity = on ? 3 * this.warm : 0;
    this.lampSprite.visible = on; this.lampSprite.material.opacity = this.warm;
    this.lampLight.intensity = on ? 500 * this.warm : 0;
    this.newtonGroup.position.set(this.dev.x * 0.4, 0, this.dev.y * 0.4);
    this.drawEye();
    this.drawReading();
  }

  /** CPU 逐像素计算（无 GPU 时使用） */
  cpuEye() {
    const W = 300;
    const placed = this.app.comp('newton').placed;
    const B = this.bright;
    const o = this.off.getContext('2d');
    const img = o.createImageData(W, W);
    const s = FOV / W;
    const R = this.R, e0 = this.e0, cx = this.cx, cy = this.cy;
    for (let py = 0; py < W; py++) {
      const y = (W / 2 - py) * s;
      for (let px = 0; px < W; px++) {
        const x = this.pos + (px - W / 2) * s;
        let I = 0.35;
        if (placed) {
          const r2 = (x - cx) ** 2 + (y - cy) ** 2;
          I = r2 < 100 ? newtonIntensity(r2, R, e0, LINES) : 0.5;
        }
        const val = B * (0.08 + 0.92 * I);
        const i = (py * W + px) * 4;
        img.data[i] = 255 * Math.min(1, val * 1.15); img.data[i + 1] = 196 * Math.min(1, val * 1.15); img.data[i + 2] = 50 * val; img.data[i + 3] = 255;
      }
    }
    o.putImageData(img, 0, 0);
  }

  drawEye() {
    const v = this.view, g = v.ctx, W = 300;
    const placed = this.app.comp('newton').placed;
    const B = this.bright;
    const gpuU = { uPos: this.pos, uS: FOV / W, uR: this.R, uE0: this.e0, uCx: this.cx, uCy: this.cy, uB: B, uPlaced: placed ? 1 : 0, uL1: LINES[0], uL2: LINES[1] };
    g.save();
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 6, 0, Math.PI * 2); g.clip();
    const blur = Math.abs(this.focus - this.focusZero) * 9;
    g.filter = blur > 0.3 ? `blur(${Math.min(30, blur).toFixed(1)}px)` : 'none';
    if (!GPU.paint(v, 'newton', NEWTON_FS, gpuU, [0, 0, W, W], g)) { this.cpuEye(); g.drawImage(this.off, 0, 0); }
    g.filter = 'none';
    // 叉丝
    const cb = Math.abs(this.diopt - this.dioptZero) * 3.2;
    g.translate(W / 2, W / 2); g.rotate((this.rot * Math.PI) / 180);
    g.filter = cb > 0.3 ? `blur(${Math.min(8, cb).toFixed(1)}px)` : 'none';
    g.strokeStyle = 'rgba(10,10,10,.9)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, -W / 2); g.lineTo(0, W / 2); g.moveTo(-W / 2, 0); g.lineTo(W / 2, 0); g.stroke();
    g.restore();
    // 视场边缘暗角
    const gr = g.createRadialGradient(W / 2, W / 2, W * 0.35, W / 2, W / 2, W / 2 - 4);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.75)');
    g.fillStyle = gr; g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 5, 0, Math.PI * 2); g.fill();
    let foot = '';
    if (!this.lampOn) foot = '视场黑暗：钠光灯未打开';
    else if (B < 0.4) foot = '视场较暗：调节 45° 玻片角度';
    else if (!placed) foot = '载物台上没有样品';
    else if (this.assist) { const k = this.orderAt(this.pos); foot = `叉丝位置约在第 ${k.toFixed(1)} 级  (${this.pos < this.cx ? '左' : '右'}侧)`; }
    v.foot(foot);
  }

  drawReading() {
    const v = this.readView, g = v.ctx, W = v.W;
    const sc = W / 280; g.save(); g.scale(sc, sc);
    g.fillStyle = '#20262a'; g.fillRect(0, 0, 280, 110);
    const x = this.drive, mm = Math.floor(x);
    // 主尺
    g.fillStyle = '#ece6d2'; g.fillRect(10, 12, 120, 56);
    g.fillStyle = '#111'; g.font = '10px Arial'; g.textAlign = 'center';
    for (let k = -5; k <= 5; k++) { const px = 70 + (k - (x - mm)) * 11; if (px < 12 || px > 128) continue; g.fillRect(px, 12, 1, (mm + k) % 5 === 0 ? 18 : 10); if ((mm + k) % 5 === 0) g.fillText(String(mm + k), px, 44); }
    g.fillStyle = '#c41e3a'; g.fillRect(69.5, 12, 1.5, 36);
    g.fillStyle = '#cfd6d1'; g.font = '11px "Microsoft YaHei"'; g.fillText('主尺 / mm', 70, 84);
    // 鼓轮
    const d = (x - mm) * 100;
    drawDrum(g, 152, 12, 114, 56, d);
    g.fillStyle = '#111';
    g.fillStyle = '#cfd6d1'; g.textAlign = 'center'; g.fillText('鼓轮 × 0.01 mm', 206, 84);
    if (this.assist) { g.fillStyle = '#8fe3a5'; g.font = '12px "IBM Plex Mono", Consolas'; g.textAlign = 'left'; g.fillText(`${mm} + ${(d / 100).toFixed(3)} = ${x.toFixed(3)} mm`, 10, 102); }
    g.restore();
  }

  globalControls() {
    return [
      { type: 'toggle', label: '显示读数与级次辅助', get: () => this.assist, set: (v) => (this.assist = v) },
      { type: 'note', html: '关闭辅助后，需要自己数环并读取主尺与鼓轮。' },
    ];
  }

  tables() {
    return [{
      id: 'n', title: '暗环位置',
      fixedRows: true,
      initRows: () => MS.map((m) => ({ m })),
      columns: [
        { key: 'm', label: '环序 m', digits: 0, readonly: true },
        { key: 'xl', label: '左侧位置 x<sub>左</sub>/mm', digits: 3 },
        { key: 'xr', label: '右侧位置 x<sub>右</sub>/mm', digits: 3 },
        { key: 'D', label: '直径 D/mm', digits: 3, calc: (r) => Math.abs(r.xr - r.xl) },
        { key: 'D2', label: 'D² /mm²', digits: 4, calc: (r) => (r.xr - r.xl) ** 2 },
      ],
      buttons: [{ label: '记录读数到下一格', onClick: (t) => this.recordNext(t) }],
      note: '顺序：先把叉丝移到第 30 环以外的左侧，再反向依次对准左侧 25→16 环记录，越过环心后继续记录右侧 16→25 环。全程鼓轮只沿一个方向转动。',
    }];
  }

  nextCell(t) {
    for (let i = 0; i < MS.length; i++) if (t.rows[i].xl == null) return { i, key: 'xl', side: -1 };
    for (let i = MS.length - 1; i >= 0; i--) if (t.rows[i].xr == null) return { i, key: 'xr', side: 1 };
    return null;
  }

  recordNext(t) {
    const c = this.nextCell(t);
    if (!c) { this.app.toast('表格已记录完整', 'ok'); return; }
    if (this.bright < 0.3 || !this.app.comp('newton').placed) { this.app.toast('视场中看不到干涉环', 'warn'); return; }
    const m = MS[c.i];
    const k = this.orderAt(this.pos);
    const side = this.pos < this.cx ? -1 : 1;
    if (side !== c.side) this.app.toast(`下一格应记录${c.side < 0 ? '左' : '右'}侧第 ${m} 环，但叉丝在${side < 0 ? '左' : '右'}侧`, 'warn');
    else if (Math.abs(k - m) > 0.25) this.app.toast(`叉丝没有对准第 ${m} 环暗纹中央（当前约第 ${k.toFixed(1)} 级）`, 'warn');
    if (this.lastDir < 0 || this.travel < BACK) this.app.toast('注意：鼓轮刚换向或反向转动，读数含空程误差', 'warn');
    const read = Math.round((this.drive + gauss(0.0015)) * 1000) / 1000;
    t.set(c.i, c.key, read);
  }

  steps() {
    const app = this.app;
    const sharp = () => Math.abs(this.focus - this.focusZero) < 0.06;
    return [
      {
        title: '放置钠光灯与牛顿环仪',
        html: '<p>把<b>牛顿环仪</b>放在读数显微镜的载物台上（物镜正下方），把<b>钠光灯</b>放在显微镜左侧，使灯光对准镜筒下方的 45° 玻片。</p>',
        check: () => app.comp('newton').placed && app.comp('lamp').placed,
        auto: async () => { await app.view('全景'); await app.autoPlace('newton'); await app.autoPlace('lamp'); },
      },
      {
        title: '打开钠光灯并预热',
        html: '<p>打开钠光灯电源。钠灯启动后先发红光，几分钟后才转为稳定的黄光，等待预热完成。</p>',
        check: () => this.lampOn && this.warm > 0.95,
        status: () => `预热：<b>${Math.round(this.warm * 100)}%</b>`,
        auto: async () => { app.select(app.comp('lamp')); this.lampOn = true; app.changed(); while (this.warm < 0.97) await app.wait(200, true); },
      },
      {
        title: '调节 45° 玻片，使视场明亮',
        html: '<p>选中读数显微镜，调节镜筒下方 <b>45° 反射玻片</b>的角度，使钠光垂直照射到牛顿环仪上，目镜视场最亮且亮度均匀。</p>',
        check: () => this.bright > 0.9,
        status: () => `视场亮度：<b>${Math.round(this.bright * 100)}%</b>（需 &gt; 90%）`,
        auto: async () => { await app.view('显微镜'); app.select(app.comp('mic')); await app.tween(() => this.plate, (v) => (this.plate = v), 45 + gauss(0.8), 1200); },
      },
      {
        title: '调节目镜，看清叉丝',
        html: '<p>转动目镜，调节视度，直到视场中的<b>十字叉丝最清晰</b>。</p>',
        check: () => Math.abs(this.diopt - this.dioptZero) < 0.12,
        auto: async () => { app.select(app.comp('mic')); await app.tween(() => this.diopt, (v) => (this.diopt = v), this.dioptZero + gauss(0.03), 1000); },
      },
      {
        title: '调焦，看清干涉环',
        html: '<p>转动调焦手轮，使镜筒<b>由下向上</b>缓慢升起，直到看清黄黑相间的干涉圆环，且圆环与叉丝之间无视差。</p>',
        hint: '先从侧面观察，把镜筒降到接近样品（但不接触），然后边看目镜边向上调焦。',
        check: sharp,
        status: () => sharp() ? '' : '圆环仍然模糊',
        auto: async () => { app.select(app.comp('mic')); await app.tween(() => this.focus, (v) => (this.focus = v), this.focusZero + 0.8, 1400); await app.tween(() => this.focus, (v) => (this.focus = v), this.focusZero + gauss(0.01), 900); },
      },
      {
        title: '对准环心，校正叉丝取向',
        html: '<p>轻轻移动牛顿环仪，使<b>环心</b>位于视场中央的叉丝交点附近；转动目镜使竖叉丝与镜筒移动方向垂直（叉丝横线随鼓轮移动时应始终通过环心）。</p>',
        check: () => Math.abs(this.cy) < 0.12 && Math.abs(this.cx - this.pos) < 0.4 && Math.abs(this.rot) < 1,
        status: () => `环心偏离：横向 <b>${(this.cx - this.pos).toFixed(2)}</b> mm，纵向 <b>${this.cy.toFixed(2)}</b> mm；叉丝转角 <b>${this.rot.toFixed(1)}°</b>`,
        auto: async () => {
          app.select(app.comp('newton'));
          await app.tween(() => this.dev.y, (v) => (this.dev.y = v), gauss(0.02), 1000);
          await app.tween(() => this.dev.x, (v) => (this.dev.x = v), this.pos - 25 + gauss(0.05), 1000);
          app.select(app.comp('mic'));
          await app.tween(() => this.rot, (v) => (this.rot = v), gauss(0.2), 800);
        },
      },
      {
        title: '测量左右两侧各暗环的位置',
        html: '<p>转动测微鼓轮，使叉丝从环心向左移过第 30 环，再<b>反向</b>转动，依次对准左侧第 25、24、…、16 环暗纹中央并记录；继续同向转动越过环心，依次记录右侧第 16、17、…、25 环。</p>',
        hint: '读数 = 主尺整毫米数 + 鼓轮读数（0.01 mm 分度，再估读一位）。数环时可以每 5 环停下核对。',
        check: () => app.table('n').completeRows().length >= 10,
        status: () => { const t = app.table('n'); const n = t.rows.filter((r) => r.xl != null).length + t.rows.filter((r) => r.xr != null).length; return `已记录 <b>${n}</b> / 20 个位置`; },
        auto: async () => {
          await app.view('显微镜');
          app.select(app.comp('mic'));
          await app.tween(() => this.drive, (v) => this.moveDrive(v), this.ringX(30, -1) - 0.05, 1500);
          const t = app.table('n');
          for (;;) {
            const c = this.nextCell(t);
            if (!c) break;
            const target = this.ringX(MS[c.i], c.side) + BACK / 2 + gauss(0.0012);
            await app.tween(() => this.drive, (v) => this.moveDrive(v), target, 450);
            await app.record('n');
          }
        },
      },
      {
        title: '数据处理：逐差法与图线法',
        html: '<p>第 m 级暗环直径满足 $D_m^2=4mR\\lambda+C$（C 与接触处的形变、灰尘有关）。用逐差法</p>$$R=\\frac{D_m^2-D_{m-5}^2}{4\\times5\\,\\lambda}$$<p>或作 $D^2$–$m$ 图，斜率 $k=4R\\lambda$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const t = this.app.table('n');
    const rows = t.completeRows();
    if (rows.length < 4) return { html: '<p>至少需要 4 个完整的环（左右位置都已记录）。</p>', ok: false };
    const ms = rows.map((r) => r.m), D2 = rows.map((r) => (r.xr - r.xl) ** 2);
    const fit = linFit(ms, D2);
    const Rfit = fit.k / (4 * LAMBDA), uRfit = fit.uk / (4 * LAMBDA);
    let html = '';
    const byM = new Map(rows.map((r) => [r.m, (r.xr - r.xl) ** 2]));
    const pairs = [];
    for (const m of [25, 24, 23, 22, 21]) if (byM.has(m) && byM.has(m - 5)) pairs.push({ m, n: m - 5, v: (byM.get(m) - byM.get(m - 5)) / (4 * 5 * LAMBDA) });
    if (pairs.length >= 2) {
      const Rs = pairs.map((p) => p.v);
      const Rm = mean(Rs), ua = uA(Rs);
      // u(D) = √2·Δ/√3（两次读数，Δ = 0.005 mm），u(D²) = 2D·u(D)；D_m²−D_n² 的两项方和根
      const uD = (Math.SQRT2 * 0.005) / Math.sqrt(3), p0 = pairs[0];
      const ub = Math.hypot(2 * Math.sqrt(byM.get(p0.m)) * uD, 2 * Math.sqrt(byM.get(p0.n)) * uD) / (4 * 5 * LAMBDA);
      const u = Math.hypot(ua, ub);
      html += `<h3>逐差法</h3><table><tr><th>m</th><th>n</th><th>D<sub>m</sub>²−D<sub>n</sub>² /mm²</th><th>R /mm</th></tr>${pairs.map((p) => `<tr><td>${p.m}</td><td>${p.n}</td><td>${(byM.get(p.m) - byM.get(p.n)).toFixed(4)}</td><td>${p.v.toFixed(1)}</td></tr>`).join('')}</table>
      <p>$\\bar R=${Rm.toFixed(1)}$ mm，$u_A=${sig(ua, 2)}$ mm，$u_B≈${sig(ub, 2)}$ mm（读数显微镜仪器误差 0.005 mm）</p>
      <div class="result-box">$R = ${texU(Rm / 1000, u / 1000, 'm')}$</div>`;
      this._R = Rm;
    }
    html += `<h3>图线法</h3><p>直线拟合 $D^2 = k\\,m + C$：$k=${fit.k.toFixed(5)}$ mm²，$C=${fit.b.toFixed(4)}$ mm²，$r=${fit.r.toFixed(6)}$，得 $R=k/4\\lambda=${texU(Rfit / 1000, uRfit / 1000, 'm')}$。</p>
      <p>截距 $C\\neq0$ 说明接触处存在附加厚度（灰尘或形变），用 $D_m^2-D_n^2$ 计算正好消去了它的影响。</p>
      <div class="plot-wrap"><canvas data-plot="0" style="height:300px"></canvas></div>`;
    const best = this._R ?? Rfit;
    html += `<div class="result-box warn">本次样品曲率半径参考值 R₀ = ${(this.R / 1000).toFixed(4)} m（接触处附加空气层厚度 e₀ = ${(this.e0 * 1e6).toFixed(0)} nm），相对误差 ${pct(relErr(best, this.R))}。</div>`;
    return {
      html, ok: true,
      answers: [{ label: '平凸透镜曲率半径 $R$', unit: 'm', value: best / 1000, alts: [Rfit / 1000], digits: 4, tolRel: 0.008 }],
      plots: [{ title: 'D² – m 关系', xLabel: '暗环级次 m', yLabel: 'D² / mm²', series: [
        { type: 'scatter', data: ms.map((m, i) => [m, D2[i]]), label: '实验数据' },
        { type: 'line', data: lineData(fit.k, fit.b, Math.min(...ms) - 1, Math.max(...ms) + 1), label: `拟合 D² = ${fit.k.toFixed(4)}m ${fit.b >= 0 ? '+' : '−'} ${Math.abs(fit.b).toFixed(3)}` },
      ] }],
    };
  }

  principle() {
    return `<h3>1. 等厚干涉</h3><p>平凸透镜的凸面与平板玻璃接触，二者之间形成从中心向外逐渐变厚的空气薄层。单色光垂直入射时，空气层上、下表面的反射光发生干涉，光程差</p>
$$\\delta=2e+\\frac{\\lambda}{2}$$<p>其中 $\\lambda/2$ 来自光在空气–玻璃界面反射时的半波损失。厚度相同处干涉情况相同，因此条纹是以接触点为中心的同心圆环。</p>
<h3>2. 暗环半径</h3><p>由几何关系 $r^2=2Re-e^2\\approx 2Re$，暗纹条件 $\\delta=(2k+1)\\lambda/2$ 给出</p>$$r_k^2=kR\\lambda,\\qquad D_k^2=4kR\\lambda$$
<p>实际接触处常有灰尘或弹性形变，存在附加厚度 $e_0$，环心难以确定，因此测量两环直径并取差值：</p>$$R=\\frac{D_m^2-D_n^2}{4(m-n)\\lambda}$$
<h3>3. 本仿真的计算模型</h3><p>程序对显微镜视场内每一点计算空气层厚度 $e=r^2/2R+e_0$，按双光束干涉叠加强度</p>$$I=a_1^2+a_2^2-2a_1a_2\\cos\\frac{4\\pi e}{\\lambda}$$
<p>并对钠 D 双线（589.0 nm、589.6 nm，强度 2:1）作非相干叠加。显微镜离焦用模糊处理表示，鼓轮丝杠含 ${(BACK * 100).toFixed(0)} 格空程，叉丝取向和环心位置均可调。</p>`;
  }
}
