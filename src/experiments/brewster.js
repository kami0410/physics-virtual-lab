// 实验：布儒斯特角与菲涅耳公式（反射光的偏振 · 用布儒斯特角测玻璃折射率）
import * as THREE from 'three';
import { meta, thumb, D2R } from './brewster.meta.js';
import { fresnelR } from '../physics/polarization.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, labTable, laserMesh, Beam, ICONS, meterBox, rotatorMesh, canvasTexture } from '../core/Models.js';
import { mean, uA, texU, gauss, rand, relErr, pct, sig } from '../core/Stats.js';
import { fnData } from '../core/Plot.js';
import * as FIG from './figures.js';

const YB = 14; // 光束高度 cm
const I0 = 1000 * 0.5 * 0.85; // 随机偏振 1 mW 激光经偏振片后 μW
const L_BACK = 500; // 样品到激光器出光口 mm
const ARM = 300; // 探测臂长 mm
const DET_R = 1.5; // 探头光阑半径 mm
const R_POL = 1.6; // 偏振片通光半径 cm
const S_HALF = 3; // 样品半宽 cm
const dir2 = (deg) => [Math.cos(deg * D2R), -Math.sin(deg * D2R)]; // 方向角（与探测臂读数同一约定）→ (x, z)
const wrap360 = (v) => ((v % 360) + 360) % 360;
const angDiff = (a, b) => { let d = wrap360(a - b); if (d > 180) d -= 360; return d; };

export class BrewsterExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.n = rand(1.50, 1.72);
    this.T = rand(0, 360); // 载物台读数
    this.T0 = rand(8, 40); // 法线正对激光器时的读数
    this.tilt = rand(0.4, 0.9) * (Math.random() < 0.5 ? -1 : 1); // 样品面俯仰误差 (°)
    this.A = 60; // 探测臂读数（= 方向角）
    this.Pr = 0; this.Poff = rand(2, 5) * (Math.random() < 0.5 ? -1 : 1); // 偏振片读数与真实透振方向偏差
    this.laserOn = false;
    this.assist = !this.app.readSelf; // 自己读数时默认不显示读数辅助
  }

  get thB() { return Math.atan(this.n) / D2R; }
  /** 激光器出射方向的方向角（度）：自动对准时为 0 */
  get delta() { const c = this.app.comp('laser'); return c.placed ? angDiff(c.root.rotation.y / D2R, 0) : 0; }
  get nu() { return angDiff(this.T, this.T0); } // 载物台相对“法线朝向 −x”位置的转角
  get Tz() { return wrap360(this.T0 + this.delta); } // 真实的入射角零点读数（法线与入射光平行）
  get theta() { return this.nu - this.delta; } // 入射角（带符号）：法线方向 180°+ν，入射光方向 δ
  /**
   * 光路几何（台面坐标 cm）：激光出射点 p0、方向 u；偏振片截获比例 fPol；
   * 样品上的入射点 q（样品中心在转轴上）及照到样品上的比例 fS；样品到出光口的距离 L（mm）。
   */
  geo() {
    const app = this.app, c = app.comp('laser');
    if (!c.placed) return null;
    c.root.updateWorldMatrix(true, false);
    const P = new THREE.Vector3(0.7, YB, 0).applyMatrix4(c.root.matrixWorld);
    const p0 = [P.x, P.z], u = dir2(this.delta);
    const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
    // axisOff：光束到载物台转轴的距离 cm
    const o = { p0, u, fPol: 0, tPol: Infinity, fS: 0, q: null, tS: Infinity, L: L_BACK, axisOff: Math.abs(cross(u, [-p0[0], -p0[1]])), tAxis: -(p0[0] * u[0] + p0[1] * u[1]) };
    // 偏振片：中心到光束的距离
    const pc = app.comp('pol');
    if (pc.placed) {
      const w = new THREE.Vector3(0, YB, 0).applyMatrix4(pc.root.matrixWorld), d = [w.x - p0[0], w.z - p0[1]];
      const t = d[0] * u[0] + d[1] * u[1], rho = Math.abs(cross(u, d));
      if (t > 0) { o.tPol = t; o.fPol = Math.min(1, Math.max(0, (R_POL - rho) / 0.1 + 0.5)); }
    }
    // 样品：过转轴、法线方向角 180°+ν 的平面
    if (app.comp('sample').placed) {
      const n = dir2(180 + this.nu), un = u[0] * n[0] + u[1] * n[1];
      if (Math.abs(un) > 1e-6) {
        const t = -(p0[0] * n[0] + p0[1] * n[1]) / un;
        if (t > 0) {
          const q = [p0[0] + u[0] * t, p0[1] + u[1] * t], sOff = Math.hypot(q[0], q[1]);
          o.q = q; o.tS = t; o.L = t * 10;
          o.fS = Math.min(1, Math.max(0, (S_HALF - sOff) / 0.1 + 0.5)) * (un < 0 ? 1 : 0); // 只有前表面反射
        }
      }
    }
    return o;
  }
  /** 探头中心到一条光线的距离（mm） */
  detOff(q, deg) {
    const d = [(ARM / 10) * Math.cos(this.A * D2R) - q[0], -(ARM / 10) * Math.sin(this.A * D2R) - q[1]], v = dir2(deg);
    const along = d[0] * v[0] + d[1] * v[1];
    return along > 0 ? Math.abs(v[0] * d[1] - v[1] * d[0]) * 10 : Infinity;
  }
  get psi() { return (this.Pr - this.Poff) * D2R; } // 透振方向与入射面的夹角
  lit() { return this.laserOn && this.app.comp('laser').placed; }
  /** 到达样品的光强与偏振 */
  incident() {
    if (!this.lit()) return 0;
    return this.app.comp('pol').placed ? I0 : 1000 * 0.92; // 无偏振片时为随机偏振全功率
  }
  reflectedDir() { return 180 + 2 * this.theta + this.delta; }
  /** 探头读数 μW */
  power() {
    const app = this.app;
    let I = this.incident();
    if (!I) return this.noise();
    const sample = app.comp('sample').placed;
    let P = 0;
    const G = this.geo();
    // 光束只有穿过偏振片通光孔的部分是线偏振光，其余仍为自然光
    const Ip = app.comp('pol').placed && G.tPol < G.tS ? I0 * G.fPol : 0, Iu = (app.comp('pol').placed ? 1000 * 0.92 * (1 - (G.tPol < G.tS ? G.fPol : 0)) : I);
    if (sample && G.fS > 0) {
      const th = Math.abs(this.theta) * D2R;
      if (Math.abs(this.theta) >= 89.5) return this.noise();
      const R = fresnelR(th, this.n);
      const c2 = Math.cos(this.psi) ** 2, s2 = 1 - c2;
      const Rt = Ip * (c2 * R.p + s2 * R.s) + Iu * 0.5 * (R.p + R.s);
      const dA = this.detOff(G.q, this.reflectedDir()); // 探头中心到反射光线的横向距离 mm（含入射点不在转轴上的影响）
      const dV = 2 * this.tilt * D2R * ARM; // 竖直偏离 mm
      P = G.fS * Rt * Math.exp(-(dA * dA + dV * dV) / (DET_R * DET_R));
    } else {
      const dA = this.detOff(G.p0, this.delta);
      P = (Ip + Iu) * (1 - (sample ? G.fS : 0)) * Math.exp(-(dA * dA) / (DET_R * DET_R));
    }
    return P + this.noise();
  }
  noise() { return 0.004 + Math.abs(gauss(0.002)); }
  reading() {
    const p = this.power();
    const dig = p >= 1000 ? 0 : p >= 100 ? 1 : p >= 10 ? 2 : 3;
    return { v: +p.toFixed(dig), s: p.toFixed(dig) };
  }

  cameras() {
    return [
      { name: '全景', pos: [-10, 80, 90], target: [-10, 10, 0] },
      { name: '载物台', pos: [14, 36, 34], target: [0, 14, 0] },
      { name: '激光器出口', pos: [-36, 24, 20], target: [-46, 14, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(170, 110); t.position.set(-10, 0, 0); scene.add(t);
    app.addTable({ x0: -93, x1: 73, z0: -53, z1: 53 }); // 激光器、偏振片可放在台面任意位置和方向
    app.stage.setLightTarget(-10, 0, 0);

    // 测角台：底座刻度盘 + 载物台 + 探测臂
    const base = new THREE.Group();
    const scaleTex = (r0) => canvasTexture(1024, 1024, (ctx, W) => {
      ctx.fillStyle = '#d8d4c8'; ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); ctx.fill();
      ctx.translate(W / 2, W / 2); ctx.strokeStyle = '#111'; ctx.fillStyle = '#111';
      for (let a = 0; a < 360; a++) {
        ctx.save(); ctx.rotate(-a * D2R); const L = a % 10 === 0 ? 40 : a % 5 === 0 ? 28 : 16;
        ctx.lineWidth = a % 10 === 0 ? 3 : 1.5; ctx.beginPath(); ctx.moveTo(W / 2 - 4, 0); ctx.lineTo(W / 2 - 4 - L, 0); ctx.stroke();
        if (a % 30 === 0) { ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.translate(W / 2 - 70, 0); ctx.rotate(Math.PI / 2); ctx.fillText(String(a), 0, 12); }
        ctx.restore();
      }
      ctx.fillStyle = '#3b4642'; ctx.beginPath(); ctx.arc(0, 0, r0, 0, Math.PI * 2); ctx.fill();
    });
    const disc = mesh(new THREE.CylinderGeometry(14, 15, 3, 64), [MAT.paint(0x3b4642), new THREE.MeshStandardMaterial({ map: scaleTex(330), roughness: 0.6 }), MAT.paint(0x3b4642)], 0, 1.5, 0);
    base.add(disc);
    this.table = new THREE.Group(); this.table.position.y = 3;
    this.table.add(mesh(new THREE.CylinderGeometry(7, 7, 1.2, 48), MAT.alu(), 0, 0.6, 0));
    this.table.add(mesh(new THREE.BoxGeometry(0.4, 0.6, 3), MAT.emissive(0xff3030, 0.6), 7.1, 0.9, 0)); // 读数指针（随载物台转动）
    this.table.add(mesh(new THREE.CylinderGeometry(1.5, 1.5, YB - 6.5, 16), MAT.metal(), 0, (YB - 6.5) / 2 + 1, 0));
    this.table.add(mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.8, 32), MAT.dark(), 0, YB - 5.2, 0));
    base.add(this.table);
    this.arm = new THREE.Group(); this.arm.position.y = 3.3;
    this.arm.add(mesh(new THREE.BoxGeometry(ARM / 10, 0.8, 2.2), MAT.paint(0x1f3b63), ARM / 20, 0, 0));
    this.arm.add(mesh(new THREE.BoxGeometry(0.4, 0.6, 2.4), MAT.emissive(0xffd166, 0.6), 15.4, 0.5, 0));
    const det = new THREE.Group(); det.position.set(ARM / 10, 0, 0);
    det.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, YB - 4, 16), MAT.metal(), 0, (YB - 4) / 2, 0));
    det.add(mesh(new THREE.CylinderGeometry(1.8, 1.8, 4, 24), MAT.black(), 0, YB - 3.3, 0).rotateZ(Math.PI / 2));
    this.arm.add(det);
    base.add(this.arm);
    const meter = meterBox(14, 8, 9, '光功率计（自动量程）');
    meter.group.position.set(-6, 0, 34); base.add(meter.group);
    this.meter = meter;
    app.addComponent(new Component({
      key: 'gonio', name: '测角台与探测臂', zone: 'none', fixed: true, object: base, labelY: 26,
      desc: '底座刻度盘分度 1°，载物台和探测臂各有游标，读数精确到 0.1°。探测臂末端为带 φ3 mm 光阑的光电探头。',
      controls: () => [
        { type: 'knob', label: '载物台读数（粗调）', get: () => this.T, set: (v) => (this.T = wrap360(v)), wrap: true, step: 0.5, bigStep: 5, perRev: 30, digits: 1, unit: '°' },
        { type: 'knob', label: '载物台微调', get: () => this.T, set: (v) => (this.T = wrap360(v)), wrap: true, step: 0.05, bigStep: 0.5, perRev: 2, digits: 2, unit: '°', sub: '微调螺钉，读数以游标为准' },
        { type: 'knob', label: '载物台调平螺钉', get: () => this.tilt, set: (v) => (this.tilt = v), min: -3, max: 3, step: 0.02, bigStep: 0.2, perRev: 1, digits: 2, unit: '°', fmt: () => '看反射光点的高低', sub: '使样品面竖直，反射光回到同一高度' },
        { type: 'knob', label: '探测臂', get: () => this.A, set: (v) => (this.A = wrap360(v)), wrap: true, step: 0.1, bigStep: 2, perRev: 30, digits: 1, unit: '°', sub: '转到反射光方向，示数最大处' },
        { type: 'readout', label: '光功率计', get: () => `${this.reading().s} μW` },
      ],
    }));

    app.addSlot({ id: 'laser', pos: new THREE.Vector3(-50, 0, 0), accepts: ['laser'] });
    app.addSlot({ id: 'pol', pos: new THREE.Vector3(-30, 0, 0), accepts: ['pol'] });
    app.addSlot({ id: 'stage', pos: new THREE.Vector3(0, YB - 4.4, 0), accepts: ['sample'] });

    const lg = new THREE.Group();
    const lz = laserMesh(24); lz.group.position.y = YB; lg.add(lz.group);
    lg.add(mesh(new THREE.BoxGeometry(18, YB - 2.4, 4), MAT.dark(), -12, (YB - 2.4) / 2, 0));
    this.laserAp = lz.aperture;
    const plate = mesh(new THREE.BoxGeometry(0.2, 7, 7), MAT.white(), 0.6, YB, 0); lg.add(plate);
    app.addComponent(new Component({
      key: 'laser', name: 'He-Ne 激光器（带光阑屏）', icon: ICONS.laser, zone: 'slot', defaultSlot: 'laser', required: true, object: lg, labelY: YB + 8,
      desc: '632.8 nm，1 mW，随机偏振。出光口套有带小孔的白色光阑屏，用于自准直：反射光点回到小孔时，样品面法线与入射光平行。',
      controls: () => [{ type: 'toggle', label: '激光电源', get: () => this.laserOn, set: (v) => (this.laserOn = v) }],
    }));

    const pr = rotatorMesh(0x334155, 'P'); pr.group.position.y = YB; this.polRot = pr.rot;
    const pg = new THREE.Group(); pg.add(pr.group); pg.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, YB - 5, 12), MAT.metal(), 0, (YB - 5) / 2, 0));
    app.addComponent(new Component({
      key: 'pol', name: '偏振片（带刻度转盘）', icon: ICONS.polarizer, zone: 'slot', defaultSlot: 'pol', required: true, object: pg, labelY: YB + 7,
      desc: '转盘 0° 刻线标称为水平透振方向（p 光），但刻线可能有几度误差——需要用布儒斯特角消光来校准。',
      controls: () => [
        { type: 'knob', label: '偏振片转角', get: () => this.Pr, set: (v) => (this.Pr = v), min: -100, max: 100, step: 0.2, bigStep: 2, perRev: 30, digits: 1, unit: '°', sub: '0° ≈ p 光，90° ≈ s 光' },
      ],
    }));

    const sg = new THREE.Group();
    this.sampleMesh = new THREE.Group();
    this.sampleMesh.add(mesh(new THREE.BoxGeometry(0.8, 5, 6), new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, metalness: 0, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.02 }), 0, 2.5 + 1.9, 0));
    this.sampleMesh.add(mesh(new THREE.BoxGeometry(2.4, 0.8, 7), MAT.dark(), 0.6, 1.5, 0));
    sg.add(this.sampleMesh);
    app.addComponent(new Component({
      key: 'sample', name: '黑玻璃样品', icon: ICONS.sample, zone: 'slot', defaultSlot: 'stage', required: true, object: sg, labelY: 10, noFree: true,
      desc: '光学平面，背面磨砂涂黑，只有前表面反射。折射率未知。',
    }));

    this.beamIn = new Beam(0xff2a2a, 0.08, 0.32); this.beamPol = new Beam(0xff2a2a, 0.08, 0.32); this.beamOut = new Beam(0xff2a2a, 0.07, 0.3);
    [this.beamIn, this.beamPol, this.beamOut].forEach((b) => scene.add(b.group));
    this.spotView = app.addView({ id: 'spot', title: '激光器出口光阑屏', w: 200, h: 150, res: 1.5 });
    this.readView = app.addView({ id: 'read', title: '刻度读数', w: 290, h: 118, res: 1.5 });
  }

  update() {
    const app = this.app;
    this.laserAp.material.emissiveIntensity = this.lit() ? 3 : 0.1;
    this.table.rotation.y = (this.T - 0) * D2R;
    this.sampleMesh.rotation.y = 0; // 样品随载物台转
    const sp = app.comp('sample');
    if (sp.placed) { sp.root.rotation.y = (180 + this.nu) * D2R - Math.PI; sp.root.rotation.z = this.tilt * D2R; }
    this.arm.rotation.y = this.A * D2R;
    if (this.polRot) this.polRot.rotation.x = this.Pr * D2R;
    const r = this.reading();
    this.meter.setText(r.s, 'μW', `探测臂 ${this.A.toFixed(1)}°`);
    const V = (x, z = 0, y = YB) => new THREE.Vector3(x, y, z);
    const polOn = app.comp('pol').placed;
    const G = this.lit() ? this.geo() : null;
    if (G) {
      const at = (t) => V(G.p0[0] + G.u[0] * t, G.p0[1] + G.u[1] * t);
      const tEnd = G.fS > 0.5 ? G.tS : 80;
      const hasPol = polOn && G.tPol < tEnd && G.fPol > 0.5;
      if (hasPol) { this.beamIn.set(at(0), at(G.tPol), 0.9); this.beamPol.set(at(G.tPol), at(tEnd), 0.6); }
      else { this.beamIn.set(at(0), at(tEnd), 0.9); this.beamPol.hide(); }
      if (G.fS > 0.5) {
        const a = this.reflectedDir() * D2R, len = 45, el = 2 * this.tilt * D2R, q = G.q;
        this.beamOut.set(V(q[0], q[1]), V(q[0] + Math.cos(a) * len, q[1] - Math.sin(a) * len, YB + Math.tan(el) * len), 0.6 * fresnelR(Math.abs(this.theta) * D2R, this.n)[hasPol && Math.cos(this.psi) ** 2 > 0.9 ? 'p' : 's'] * 6 + 0.05);
      } else this.beamOut.hide();
    } else { this.beamIn.hide(); this.beamPol.hide(); this.beamOut.hide(); }
    this.drawSpot();
    this.drawRead();
  }

  drawSpot() {
    const v = this.spotView, g = v.ctx, W = v.W, H = v.H;
    const s = W / 40; // 40 mm 视场
    g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1;
    for (let k = -20; k <= 20; k += 5) { g.beginPath(); g.moveTo(W / 2 + k * s, H / 2 - 4); g.lineTo(W / 2 + k * s, H / 2 + 4); g.stroke(); }
    g.fillStyle = '#111'; g.beginPath(); g.arc(W / 2, H / 2, 1.2 * s, 0, Math.PI * 2); g.fill();
    let foot = '激光器未打开';
    const G = this.lit() ? this.geo() : null;
    if (G && this.app.comp('sample').placed && G.fS < 0.5) foot = '光束没有照到样品上：移动或转动激光器';
    else if (this.lit() && this.app.comp('sample').placed) {
      const x = G.L * Math.tan(2 * this.theta * D2R), y = G.L * Math.tan(2 * this.tilt * D2R);
      const r0 = Math.hypot(x, y);
      if (Math.abs(this.theta) < 30 && Math.abs(x) < 22 && Math.abs(y) < 16) {
        const px = W / 2 + x * s, py = H / 2 - y * s;
        const gr = g.createRadialGradient(px, py, 0, px, py, 2.2 * s);
        gr.addColorStop(0, 'rgba(255,60,60,1)'); gr.addColorStop(0.4, 'rgba(255,30,30,.6)'); gr.addColorStop(1, 'rgba(255,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(px, py, 2.2 * s, 0, Math.PI * 2); g.fill();
        foot = r0 < 1.2 ? '反射光点回到小孔：法线与入射光平行' : `反射光点偏离小孔 ${r0.toFixed(1)} mm`;
      } else foot = '屏上看不到反射光点（入射角太大）';
    } else if (this.lit()) foot = '未放样品';
    v.foot(foot);
  }

  drawRead() {
    const v = this.readView, g = v.ctx, W = v.W;
    const sc = W / 290; g.save(); g.scale(sc, sc);
    g.fillStyle = '#20262a'; g.fillRect(0, 0, 290, 118);
    const vernier = (x0, val, title) => {
      g.fillStyle = '#ece6d2'; g.fillRect(x0, 8, 130, 56);
      const main = Math.floor(val), frac = val - main;
      g.fillStyle = '#111'; g.font = '10px Arial'; g.textAlign = 'center';
      for (let k = -6; k <= 6; k++) { const deg = main + k, px = x0 + 65 + (k - frac) * 10; if (px < x0 + 2 || px > x0 + 128) continue; const dd = wrap360(Math.round(deg)); g.fillRect(px, 8, 1, dd % 5 === 0 ? 16 : 10); if (dd % 5 === 0) g.fillText(String(dd), px, 34); }
      g.fillStyle = '#c9c3ad'; g.fillRect(x0, 40, 130, 24); g.fillStyle = '#111';
      for (let j = 0; j <= 10; j++) { const px = x0 + 65 + j * 9; g.fillRect(px, 40, 1, j % 5 === 0 ? 12 : 8); if (j % 5 === 0) g.fillText(String(j), px, 62); }
      g.fillStyle = '#cfd6d1'; g.font = '11px "Microsoft YaHei"'; g.fillText(title, x0 + 65, 80);
      if (this.assist) { g.fillStyle = '#8fe3a5'; g.font = '12px "IBM Plex Mono", Consolas'; g.fillText(`${val.toFixed(1)}°`, x0 + 65, 98); }
    };
    vernier(6, wrap360(this.T), '载物台（游标 0.1°）');
    vernier(152, wrap360(this.A), '探测臂（游标 0.1°）');
    if (this.app.comp('pol').placed && this.assist) { g.fillStyle = '#cfd6d1'; g.font = '11px "Microsoft YaHei"'; g.textAlign = 'left'; g.fillText(`偏振片 ${this.Pr.toFixed(1)}°`, 8, 114); }
    g.restore();
  }

  globalControls() {
    return [
      { type: 'readout', label: '光功率计', get: () => `${this.reading().s} μW` },
      { type: 'toggle', label: '显示读数辅助', get: () => this.assist, set: (v) => (this.assist = v) },
    ];
  }

  tables() {
    const T0 = () => { const z = this.app.table('zero').col('T'); return z.length ? z.reduce((s, x) => s + angDiff(x, z[0]), 0) / z.length + z[0] : NaN; };
    this.T0m = T0;
    return [
      {
        id: 'zero', title: '法线零点', fixedRows: true, initRows: () => [{}, {}, {}],
        columns: [{ key: 'T', label: '反射光回到小孔时载物台读数 /°', digits: 1 }],
        buttons: [{ label: '记录载物台读数', onClick: (t) => { const i = t.firstEmpty('T'); if (i < 0) return this.app.toast('已记录 3 次', 'ok'); if (!this.lit() || !this.app.comp('sample').placed) return this.app.toast('没有反射光', 'warn'); const x = L_BACK * Math.tan(2 * this.theta * D2R), y = L_BACK * Math.tan(2 * this.tilt * D2R); if (Math.hypot(x, y) > 1.5) this.app.toast('反射光点没有回到小孔', 'warn'); t.set(i, 'T', this.readT()); } }],
        note: '每次把载物台转开后再转回、使反射光点回到小孔中心，共记录 3 次取平均。',
      },
      {
        id: 'brew', title: '布儒斯特角', fixedRows: true, initRows: () => [{}, {}, {}],
        columns: [
          { key: 'T', label: '消光时载物台读数 /°', digits: 1 },
          { key: 'P', label: '偏振片读数 /°', digits: 1 },
          { key: 'th', label: '入射角 θ_B /°', digits: 1, calc: (r) => Math.abs(angDiff(r.T, T0())) },
        ],
        buttons: [{ label: '记录消光位置', onClick: (t) => this.recBrew(t) }],
        note: 'p 光入射，反复交替微调载物台和偏振片，使反射光最弱。',
      },
      {
        id: 'p0', title: '入射光功率', fixedRows: true, initRows: () => [{ what: 'p 光' }, { what: 's 光' }],
        columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'P', label: '入射光功率 P₀/μW', digits: 1 }],
        buttons: [{ label: '记录直通光功率', onClick: (t) => this.recP0(t) }],
        note: '取下样品，探测臂转到 0°（正对入射光）测入射光功率；p、s 两种偏振各测一次。',
      },
      {
        id: 'curve', title: '反射率 – 入射角',
        columns: [
          { key: 'pol', label: '偏振', type: 'text', readonly: true },
          { key: 'T', label: '载物台读数 /°', digits: 1 },
          { key: 'th', label: '入射角 θ/°', digits: 1, calc: (r) => Math.abs(angDiff(r.T, T0())) },
          { key: 'P', label: '反射光功率/μW', digits: 3 },
          { key: 'R', label: '反射率 R', digits: 4, calc: (r) => r.P / this.p0Of(r.pol) },
        ],
        buttons: [{ label: '记录当前入射角的反射光', onClick: (t) => this.recCurve(t) }],
        maxRows: 40,
        note: '入射角 20°–80°，每 10° 测一点，布儒斯特角附近加密；每个角度都要把探测臂转到反射光示数最大处。',
      },
    ];
  }

  p0Of(pol) { const r = this.app.table('p0').rows; return pol === 's' ? r[1].P : r[0].P; }
  readT() { return Math.round(wrap360(this.T + gauss(0.03)) * 10) / 10; }
  polState() { const c = Math.cos(this.psi) ** 2; return c > 0.97 ? 'p' : c < 0.03 ? 's' : null; }
  aimed() { const G = this.geo(); return !!(G && G.q && G.fS > 0.5) && this.detOff(G.q, this.reflectedDir()) < 0.6; }
  recBrew(t) {
    const i = t.firstEmpty('T');
    if (i < 0) return this.app.toast('已记录 3 次', 'ok');
    if (!this.lit() || !this.app.comp('pol').placed || !this.app.comp('sample').placed) return this.app.toast('需要激光、偏振片和样品', 'warn');
    if (!this.aimed()) this.app.toast('探测臂没有对准反射光方向', 'warn');
    if (Math.abs(Math.abs(this.theta) - this.thB) > 0.8 || Math.abs(this.psi) > 2 * D2R) this.app.toast('反射光还没有调到最弱', 'warn');
    t.set(i, 'T', this.readT()); t.set(i, 'P', Math.round(this.Pr * 10) / 10);
  }
  recP0(t) {
    if (this.app.comp('sample').placed) return this.app.toast('请先取下样品', 'warn');
    if (!this.app.comp('pol').placed) return this.app.toast('请放上偏振片', 'warn');
    const s = this.polState();
    if (!s) return this.app.toast('偏振片不在 p 或 s 方向', 'warn');
    if (Math.abs(angDiff(this.A, 0)) > 0.3) this.app.toast('探测臂没有正对入射光', 'warn');
    t.set(s === 'p' ? 0 : 1, 'P', this.reading().v);
  }
  recCurve(t) {
    if (!this.lit() || !this.app.comp('sample').placed || !this.app.comp('pol').placed) return this.app.toast('需要激光、偏振片和样品', 'warn');
    const s = this.polState();
    if (!s) return this.app.toast('偏振片不在 p 或 s 方向（透振方向与入射面的夹角应接近 0° 或 90°）', 'warn');
    if (!this.aimed()) this.app.toast('探测臂没有对准反射光（示数不是最大）', 'warn');
    t.addRow({ pol: s, T: this.readT(), P: this.reading().v });
  }

  steps() {
    const app = this.app;
    const on = (k) => app.comp(k).placed;
    const toTheta = (th) => wrap360(this.Tz + th);
    const aim = async () => { app.select(app.comp('gonio')); await app.tween(() => this.A, (v) => (this.A = v), this.A + angDiff(this.reflectedDir() + gauss(0.03), this.A), 700); };
    return [
      {
        title: '放置激光器、偏振片和样品',
        html: '<p>把 <b>He-Ne 激光器</b>、<b>偏振片</b>依次放到测角台左侧，<b>黑玻璃样品</b>放到载物台中央。</p>',
        check: () => { if (!(on('laser') && on('pol') && on('sample'))) return false; const G = this.geo(); return G.fPol > 0.9 && G.tPol < G.tAxis && G.axisOff < 1; },
        status: () => {
          if (!(on('laser') && on('pol') && on('sample'))) return '';
          const G = this.geo();
          if (!(G.fPol > 0.9 && G.tPol < G.tAxis)) return '激光没有穿过偏振片中央：移动偏振片到光束上';
          return `光束偏离载物台转轴 <b>${(G.axisOff * 10).toFixed(1)} mm</b>（需 &lt; 10 mm）`;
        },
        auto: async () => { await app.view('全景'); await app.autoPlace('laser'); await app.autoPlace('pol'); await app.autoPlace('sample'); },
      },
      {
        title: '自准直：确定法线零点并调平样品',
        html: '<p>打开激光器。转动载物台，使样品的反射光点回到激光器出口的光阑屏上；调节<b>调平螺钉</b>使光点与小孔等高，再微调载物台使光点回到小孔中心。此时入射角为 0，记录载物台读数。转开再转回，共记录 3 次。</p>',
        check: () => app.table('zero').completeRows().length >= 3 && Math.abs(this.tilt) < 0.1,
        status: () => `样品俯仰误差 <b>${this.tilt.toFixed(2)}°</b>，已记录 ${app.table('zero').completeRows().length} / 3`,
        auto: async () => {
          app.select(app.comp('laser')); this.laserOn = true; app.changed();
          await app.view('载物台'); app.select(app.comp('gonio'));
          await app.tween(() => this.T, (v) => (this.T = v), this.T + angDiff(this.Tz + 1.2, this.T), 1400);
          await app.tween(() => this.tilt, (v) => (this.tilt = v), gauss(0.02), 900);
          await app.view('激光器出口');
          const t = app.table('zero'); app.showTable(app.tables.indexOf(t));
          for (let k = 0; k < 3; k++) {
            await app.tween(() => this.T, (v) => (this.T = v), this.T + angDiff(this.Tz + (k % 2 ? -0.6 : 0.6), this.T), 400);
            await app.tween(() => this.T, (v) => (this.T = v), this.T + angDiff(this.Tz + gauss(0.02), this.T), 500);
            await app.record('zero');
          }
        },
      },
      {
        title: '观察反射光的偏振',
        html: '<p>把载物台转到入射角约 55°，转动探测臂找到反射光（示数最大）。转动偏振片，观察反射光强度的变化：偏振片在 0° 附近时反射光很弱，在 90° 附近时较强。</p>',
        check: () => Math.abs(Math.abs(this.theta) - 55) < 8 && this.aimed() && this.lit(),
        status: () => `入射角 <b>${Math.abs(this.theta).toFixed(1)}°</b>，探测臂${this.aimed() ? '已' : '未'}对准反射光`,
        auto: async () => {
          await app.view('全景'); app.select(app.comp('gonio'));
          await app.tween(() => this.T, (v) => (this.T = v), this.T + angDiff(toTheta(55), this.T), 1200);
          await aim();
          app.select(app.comp('pol'));
          await app.tween(() => this.Pr, (v) => (this.Pr = v), 90, 900);
          await app.tween(() => this.Pr, (v) => (this.Pr = v), 0, 900);
        },
      },
      {
        title: '消光法测布儒斯特角',
        html: '<p>交替进行：①转动偏振片使反射光最弱；②转动载物台（探测臂随之跟踪反射光）使反射光更弱。重复几次直到示数几乎为零，记录载物台读数和偏振片读数。从不同方向逼近，测 3 次。</p>',
        hint: '只调载物台不调偏振片时，由于偏振片刻线不准，反射光中残留的 s 分量使极小值不够低、位置也不够尖锐。消光时偏振片的读数就是它真正的 p 方向。',
        check: () => app.table('brew').completeRows().length >= 3,
        status: () => `入射角 <b>${Math.abs(this.theta).toFixed(1)}°</b>，偏振片读数 <b>${this.Pr.toFixed(1)}°</b>，示数 <b>${this.reading().s} μW</b>；已记录 ${app.table('brew').completeRows().length} / 3`,
        auto: async () => {
          const t = app.table('brew'); app.showTable(app.tables.indexOf(t));
          for (let k = 0; k < 3; k++) {
            app.select(app.comp('pol'));
            await app.tween(() => this.Pr, (v) => (this.Pr = v), this.Poff + gauss(0.3), 600);
            app.select(app.comp('gonio'));
            const sgn = Math.sign(this.theta) || 1;
            await app.tween(() => this.T, (v) => (this.T = v), this.T + angDiff(toTheta(sgn * (this.thB + (k % 2 ? 1.5 : -1.5))), this.T), 500);
            await app.tween(() => this.T, (v) => (this.T = v), this.T + angDiff(toTheta(sgn * (this.thB + gauss(0.08))), this.T), 600);
            await aim();
            await app.record('brew');
          }
        },
      },
      {
        title: '测入射光功率',
        html: '<p>取下样品，探测臂转到直射光方向（约 0°，以示数最大为准），分别在偏振片处于 p 方向（消光时的读数）和 s 方向（再转 90°）时记录入射光功率 $P_0$。</p>',
        check: () => app.table('p0').completeRows().length >= 2,
        auto: async () => {
          app.remove(app.comp('sample'));
          app.select(app.comp('gonio')); await app.tween(() => this.A, (v) => (this.A = v), this.A + angDiff(this.delta + gauss(0.05), this.A), 900); // 激光器没摆正时，直射光不在 0°
          const t = app.table('p0'); app.showTable(app.tables.indexOf(t));
          const pP = mean(app.table('brew').col('P'));
          app.select(app.comp('pol'));
          await app.tween(() => this.Pr, (v) => (this.Pr = v), pP, 500); await app.record('p0');
          await app.tween(() => this.Pr, (v) => (this.Pr = v), pP + 90, 800); await app.record('p0');
        },
      },
      {
        title: '测 p 光、s 光的反射率曲线',
        html: '<p>放回样品。偏振片分别置于 s、p 方向，入射角从 20° 到 80° 每隔 10° 测反射光功率（布儒斯特角附近每 2° 加测）。每个角度都要转动探测臂找到示数最大处。</p>',
        check: () => { const r = app.table('curve').completeRows(); return r.filter((q) => q.pol === 'p').length >= 6 && r.filter((q) => q.pol === 's').length >= 6; },
        status: () => { const r = app.table('curve').completeRows(); return `p 光 <b>${r.filter((q) => q.pol === 'p').length}</b> 点，s 光 <b>${r.filter((q) => q.pol === 's').length}</b> 点`; },
        auto: async () => {
          await app.autoPlace('sample');
          const t = app.table('curve'); app.showTable(app.tables.indexOf(t));
          const pP = mean(app.table('brew').col('P'));
          const tb = Math.round(this.thB);
          for (const [pol, pr] of [['s', pP + 90], ['p', pP]]) {
            app.select(app.comp('pol')); await app.tween(() => this.Pr, (v) => (this.Pr = v), pr, 600);
            const ths = pol === 'p' ? [20, 30, 40, 50, tb - 4, tb - 2, tb, tb + 2, tb + 4, 70, 80] : [20, 30, 40, 50, 60, 70, 80];
            for (const th of ths) {
              app.select(app.comp('gonio'));
              await app.tween(() => this.T, (v) => (this.T = v), this.T + angDiff(toTheta(th), this.T), 350);
              await aim();
              await app.record('curve');
            }
          }
        },
      },
      {
        title: '数据处理：求折射率，与菲涅耳公式比较',
        html: '<p>$\\theta_B$ = 消光读数 − 零点读数，$n=\\tan\\theta_B$。作 $R_p$、$R_s$ 随 $\\theta$ 的曲线，与菲涅耳公式的理论曲线比较。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const z = this.app.table('zero').col('T');
    const b = this.app.table('brew').completeRows();
    if (!z.length) return { html: '<p>请先记录法线零点。</p>', ok: false };
    if (!b.length) return { html: '<p>请先测布儒斯特角。</p>', ok: false };
    const T0 = this.T0m();
    const ths = b.map((r) => Math.abs(angDiff(r.T, T0)));
    const thm = mean(ths), ua = ths.length > 1 ? uA(ths) : 0;
    const uth = Math.hypot(ua, 0.1 / Math.sqrt(3), z.length > 1 ? uA(z.map((x) => angDiff(x, z[0]))) : 0);
    const n = Math.tan(thm * D2R), un = (uth * D2R) / Math.cos(thm * D2R) ** 2;
    const Pp = mean(b.map((r) => r.P));
    let html = `<h3>1. 布儒斯特角</h3><p>法线零点 $T_0=${T0.toFixed(2)}^\\circ$（${z.length} 次平均）。</p>
      <table><tr><th>消光读数 /°</th>${b.map((r) => `<td>${r.T.toFixed(1)}</td>`).join('')}</tr><tr><th>θ_B /°</th>${ths.map((v) => `<td>${v.toFixed(1)}</td>`).join('')}</tr></table>
      <p>$\\bar\\theta_B=${thm.toFixed(2)}^\\circ$，合成不确定度 $u(\\theta_B)≈${uth.toFixed(2)}^\\circ$（含游标 0.1° 的 B 类分量）。</p>
      <div class="result-box">$n=\\tan\\theta_B=${texU(n, un)}$</div>
      <p>消光时偏振片读数平均 ${Pp.toFixed(1)}°，即偏振片的真实 p 方向（刻线误差约 ${Pp.toFixed(1)}°）。</p>`;
    const plots = [];
    const c = this.app.table('curve'), cr = c.completeRows();
    const p0ok = this.app.table('p0').completeRows().length >= 2;
    if (cr.length >= 4 && p0ok) {
      const pts = cr.map((r) => ({ pol: r.pol, th: Math.abs(angDiff(r.T, T0)), R: r.P / this.p0Of(r.pol) }));
      // 一维最小二乘：由整条曲线拟合 n
      const cost = (nn) => pts.reduce((s, q) => s + (q.R - fresnelR(q.th * D2R, nn)[q.pol]) ** 2, 0);
      let lo = 1.3, hi = 2.0;
      for (let k = 0; k < 60; k++) { const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618; if (cost(m1) < cost(m2)) hi = m2; else lo = m1; }
      const nFit = (lo + hi) / 2;
      html += `<h3>2. 反射率曲线</h3><p>用菲涅耳公式对全部 ${pts.length} 个点作最小二乘拟合，得 $n_{fit}=${nFit.toFixed(4)}$，与布儒斯特角法的结果相差 ${pct(relErr(nFit, n))}。p 光反射率在 θ_B 处降为零；s 光反射率随入射角单调增大。</p>
        <div class="plot-wrap"><canvas data-plot="0" style="height:300px"></canvas></div>`;
      plots.push({ title: '反射率 R 随入射角 θ 的变化', xLabel: 'θ / (°)', yLabel: 'R', yZero: true, series: [
        { type: 'scatter', data: pts.filter((q) => q.pol === 's').map((q) => [q.th, q.R]), label: 's 光实测', color: '#3b82f6', radius: 3.5 },
        { type: 'scatter', data: pts.filter((q) => q.pol === 'p').map((q) => [q.th, q.R]), label: 'p 光实测', color: '#ef4444', radius: 3.5 },
        { type: 'line', data: fnData((t) => fresnelR(t * D2R, n).s, 0, 89, 200), label: `R_s 理论（n=${n.toFixed(3)}）`, color: '#3b82f6', width: 1.4 },
        { type: 'line', data: fnData((t) => fresnelR(t * D2R, n).p, 0, 89, 200), label: 'R_p 理论', color: '#ef4444', width: 1.4 },
      ] });
    }
    html += `<div class="result-box warn">本样品折射率参考值 n = ${this.n.toFixed(4)}（布儒斯特角 ${this.thB.toFixed(2)}°），本次测量相对误差 ${pct(relErr(n, this.n))}。偏振片刻线误差 ${this.Poff.toFixed(1)}°。</div>`;
    return {
      html, ok: true, plots,
      answers: [
        { label: '布儒斯特角 $\\theta_B$', unit: '°', value: thm, digits: 2, tolAbs: 0.15 },
        { label: '折射率 $n$', value: n, digits: 4, tolAbs: 0.006 },
      ],
    };
  }

  principle() {
    return `<h3>1. 菲涅耳公式</h3><p>光从空气以入射角 $\\theta$ 射到折射率为 $n$ 的介质表面，折射角 $\\theta_t$ 满足 $\\sin\\theta=n\\sin\\theta_t$。振动方向垂直于入射面（s 光）和平行于入射面（p 光）的反射率分别为</p>
$$R_s=\\frac{\\sin^2(\\theta-\\theta_t)}{\\sin^2(\\theta+\\theta_t)},\\qquad R_p=\\frac{\\tan^2(\\theta-\\theta_t)}{\\tan^2(\\theta+\\theta_t)}$$
<h3>2. 布儒斯特定律</h3><p>当 $\\theta+\\theta_t=90^\\circ$ 时 $R_p=0$，反射光只剩 s 分量，成为线偏振光。此时</p>$$\\tan\\theta_B=n$$
${FIG.brewsterFig()}
<h3>3. 测量方法</h3><p>①自准直法定零点：反射光沿原路返回激光器出口小孔时，入射角为 0。②p 光入射，转动载物台使反射光最弱，读出 $\\theta_B$。偏振片刻线有误差时残留的 s 分量会抬高极小值，因此要交替微调偏振片和入射角，使反射光真正消失。③测 $R_p(\\theta)$、$R_s(\\theta)$ 并与理论曲线比较。</p>
<h3>4. 本仿真的计算模型</h3><p>探头读数 $P=P_0[\\cos^2\\psi\\,R_p+\\sin^2\\psi\\,R_s]\\,g$，$\\psi$ 为偏振片真实透振方向与入射面的夹角，$g$ 为探头光阑对反射光斑的接收效率（由探测臂对准误差和样品俯仰误差决定）；另加约 0.005 μW 的暗噪声。样品折射率每次随机生成。</p>`;
  }
}
