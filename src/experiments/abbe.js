// 实验：阿贝成像原理与空间滤波（二维 FFT 计算频谱面与像面的相干光场）
import * as THREE from 'three';
import { meta, thumb, cm } from './abbe.meta.js';
import { Component } from '../core/Component.js';
import { AXIS_Y, MAT, mesh, labTable, opticalRail, carriage, laserMesh, lensMesh, whiteScreen, Beam, ICONS } from '../core/Models.js';
import { fft2, fIdx } from '../physics/fourier.js';
import { linFit, gauss, rand, relErr, pct, texU } from '../core/Stats.js';
import { lineData } from '../core/Plot.js';

const N = 256, P = 8; // 采样点数；光栅周期（像素）
const LAM = 632.8e-6; // mm
const F0 = 0.6, F1 = 19, FL = 15; // 扩束镜、准直镜、傅里叶透镜焦距 cm
const TH0 = 0.067; // 扩束后的半发散角 rad
const RAIL = 180;
const OBJS = [
  { key: 'grid', name: '正交光栅（网格）' },
  { key: 'grating', name: '一维光栅' },
  { key: 'gword', name: '网格字“光”' },
  { key: 'word', name: '透明字“光”' },
];
const FILTERS = [
  { key: 'glass', name: '毛玻璃' }, { key: 'slit', name: '狭缝' }, { key: 'iris', name: '可变光阑' }, { key: 'stop', name: '挡光点' }, { key: 'none', name: '空架' },
];
const OBS = ['正交网格', '竖直条纹', '水平条纹', '斜条纹', '条纹周期减半', '均匀亮场', '视场全暗', '网格字', '字（网格消失）', '字', '字的轮廓（边缘增强）'];
const DISK = [[0, 0], ...[0, 1, 2, 3, 4, 5].map((k) => [0.55 * Math.cos((k * Math.PI) / 3), 0.55 * Math.sin((k * Math.PI) / 3)]), ...[0, 1, 2, 3, 4, 5].map((k) => [Math.cos(((k + 0.5) * Math.PI) / 3), Math.sin(((k + 0.5) * Math.PI) / 3)])];

/** 圆锥形光束（两端半径可变） */
class Cone {
  constructor(color = 0xff3030, op = 0.13) {
    const seg = 24, pos = new Float32Array((seg + 1) * 2 * 3), idx = [];
    for (let i = 0; i < seg; i++) { const a = i, b = i + 1, c = i + seg + 1, d = i + seg + 2; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    this.seg = seg; this.g = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.renderOrder = 5; this.mesh.frustumCulled = false;
  }
  set(x1, r1, x2, r2) {
    if (!(x2 > x1)) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const p = this.g.attributes.position.array, s = this.seg;
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i <= s; i++) {
      const a = (i / s) * Math.PI * 2, r = Math.max(0.03, ring ? r2 : r1), k = (ring * (s + 1) + i) * 3;
      p[k] = ring ? x2 : x1; p[k + 1] = AXIS_Y + r * Math.cos(a); p[k + 2] = r * Math.sin(a);
    }
    this.g.attributes.position.needsUpdate = true;
  }
  hide() { this.mesh.visible = false; }
}

export class AbbeExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.d = rand(0.088, 0.115); // 光栅常数 mm
    this.dx = this.d / P; this.S = N * this.dx; // 物面采样间隔与视场 mm
    this.laserOn = false;
    this.obj = 'grid'; this.rot = rand(-6, 6);
    this.ftype = 'glass';
    this.X0 = 12.5 + rand(-0.6, 0.6); this.Y0 = rand(-0.5, 0.5); // 光轴所对应的测微鼓轮读数、升降读数
    this.drum = 10 + rand(0, 5); this.yk = 0;
    this.slitW = 0.3; this.slitRot = 0; this.iris = 3; this.stopD = 0.6;
    this.see = '';
    this.specCache = new Map();
    this._key = ''; this.I = new Float64Array(N * N);
    this.imgCanvas = document.createElement('canvas'); this.imgCanvas.width = this.imgCanvas.height = N;
    this.specCanvas = document.createElement('canvas'); this.specCanvas.width = this.specCanvas.height = N;
    this.layer = document.createElement('canvas');
    this.letter = null;
  }

  // ---------------- 几何光学：光路与频谱面 ----------------
  P(k) { const c = this.app.comp(k); return c && c.placed ? c.pos : null; }
  chain() {
    const las = this.P('laser'), l0 = this.P('l0'), l1 = this.P('l1'), ob = this.P('obj'), L = this.P('lens'), fl = this.P('filt'), sc = this.P('screen');
    const beam = this.laserOn && las != null && l0 != null && l1 != null && las < l0 && l0 < l1;
    const p0 = l0 != null ? l0 + F0 : 0;
    const V1 = beam ? -1 / (l1 - p0) + 1 / F1 : 0; // 准直镜后的会聚度 1/cm（>0 会聚）
    const R1 = beam ? (l1 - p0) * TH0 : 0; // 准直镜处光束半径 cm
    const objOK = beam && ob != null && ob > l1;
    const lensOK = objOK && L != null && L > ob;
    let zs = null, q = null;
    if (lensOK) {
      const t = L - l1, Vin = V1 / (1 - t * V1), V3 = Vin + 1 / FL;
      if (V3 > 1e-4 && 1 - t * V1 > 0) { q = 1 / V3; zs = L + q; }
    }
    const filtOn = lensOK && fl != null && fl > L && (sc == null || fl < sc);
    const scrOK = lensOK && sc != null && sc > L;
    return { las, l0, l1, ob, L, fl, sc, beam, p0, V1, R1, objOK, lensOK, zs, q, filtOn, scrOK };
  }
  spotAt(dist) { const c = this.chain(); return c.beam ? Math.abs(2 * c.R1 * (1 - dist * c.V1)) * 10 : null; } // mm

  // ---------------- 物与频谱 ----------------
  letterMask() {
    if (this.letter) return this.letter;
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${Math.round(N * 0.78)}px "SimHei","Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Source Han Sans SC",sans-serif`;
    g.fillText('光', N / 2, N / 2 + N * 0.03);
    const d = g.getImageData(0, 0, N, N).data, m = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) m[i] = d[i * 4] > 128 ? 1 : 0;
    return (this.letter = m);
  }
  /** 物的振幅透过率：转动时 3×3 超采样抗混叠；物架通光孔为边缘柔化的圆孔 */
  transmit(type, rot) {
    const t = new Float64Array(N * N), c = Math.cos((rot * Math.PI) / 180), s = Math.sin((rot * Math.PI) / 180);
    const L = type === 'gword' || type === 'word' ? this.letterMask() : null;
    const wrapP = (v) => ((v % P) + P) % P;
    const at = (X, Y) => {
      const xr = c * X + s * Y, yr = -s * X + c * Y; // 物坐标系（物转过 rot）
      if (type === 'grid') return wrapP(xr) < 5 && wrapP(yr) < 5 ? 1 : 0;
      if (type === 'grating') return wrapP(xr) < 4 ? 1 : 0;
      const lx = Math.floor(xr + N / 2), ly = Math.floor(yr + N / 2);
      if (!(lx >= 0 && ly >= 0 && lx < N && ly < N && L[ly * N + lx])) return 0;
      return type === 'word' ? 1 : wrapP(xr) < 5 && wrapP(yr) < 5 ? 1 : 0;
    };
    const R = N * 0.46, edge = N * 0.035;
    const ss = Math.abs(rot) < 1e-6 ? 1 : 3, st = 1 / ss, o0 = -0.5 + st / 2, inv = 1 / (ss * ss); // 未转动时像素与周期对齐，无需超采样
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const X = x - N / 2 + 0.5, Y = y - N / 2 + 0.5, r = Math.hypot(X, Y);
      const ap = L ? 1 : r > R + 2 * edge ? 0 : r < R - 2 * edge ? 1 : 0.5 - 0.5 * Math.tanh((r - R) / edge);
      if (!ap) continue;
      let v = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) v += at(X + o0 + sx * st, Y + o0 + sy * st);
      t[y * N + x] = ap * v * inv;
    }
    return t;
  }
  spectrum() {
    const k = `${this.obj}|${this.rot.toFixed(2)}`;
    let s = this.specCache.get(k);
    if (s) return s;
    const t = this.transmit(this.obj, this.rot), re = t.slice(), im = new Float64Array(N * N);
    fft2(re, im, N);
    let mx = 0; const I = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) { I[i] = re[i] * re[i] + im[i] * im[i]; if (I[i] > mx) mx = I[i]; }
    // 频谱显示图（fftshift，对数亮度）
    const g = this.specCanvas.getContext('2d'), img = g.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = Math.log10(1 + (I[j * N + i] / mx) * 2e4) / 4.3, o = (((j + N / 2) % N) * N + ((i + N / 2) % N)) * 4;
      img.data[o] = 255 * Math.min(1, v * 1.25); img.data[o + 1] = 70 * v * v; img.data[o + 2] = 60 * v * v; img.data[o + 3] = 255;
    }
    s = { re, im, mx, img, t };
    if (this.specCache.size > 24) this.specCache.clear();
    this.specCache.set(k, s);
    return s;
  }

  // ---------------- 滤波器 ----------------
  /** 滤波器中心相对光轴的位置（频谱面坐标，mm；y 向下为正） */
  // 滤波器中心相对频谱中心（mm）；滤波器架与光束不共轴时，频谱整体偏离架子中心
  fc() { const o = this.app.coaxOff('filt'); return { cx: this.drum - this.X0 - o.z * 10, cy: -(this.yk - this.Y0) - o.y * 10 }; }
  passAt(u, v) {
    const t = this.ftype;
    if (u * u + v * v > 144) return 0; // 滤波器架通光孔 Φ24 mm
    if (t === 'slit') { const a = (this.slitRot * Math.PI) / 180; return Math.abs(u * Math.cos(a) + v * Math.sin(a)) < this.slitW / 2 ? 1 : 0; }
    if (t === 'iris') return u * u + v * v < (this.iris / 2) ** 2 ? 1 : 0;
    if (t === 'stop') return u * u + v * v > (this.stopD / 2) ** 2 ? 1 : 0;
    return 1;
  }
  /** 频谱面坐标 (X,Y) 处的衍射斑透过滤波器的比例（滤波器离开频谱面时衍射斑扩大） */
  T(X, Y, c, f) {
    if (!c.filtOn) return 1;
    const { cx, cy } = f || this.fc();
    const rs = this.spotR(c);
    if (rs < 0.012) return this.passAt(X - cx, Y - cy);
    let s = 0; for (const [a, b] of DISK) s += this.passAt(X - cx + a * rs, Y - cy + b * rs);
    return s / DISK.length;
  }
  spotR(c) {
    if (!c.filtOn) return 0;
    if (c.zs == null) return 3;
    return Math.min(3, ((this.S / 2) * Math.abs(c.fl - c.zs) * 10) / (c.q * 10));
  }
  binMM(c) { return (LAM * (c.q ?? FL) * 10) / this.S; } // 频谱面上一个频率单元对应的距离 mm

  // ---------------- 像面 ----------------
  imaging(c) {
    const u = (c.L - c.ob) * 10, s = (c.sc - c.L) * 10, f = FL * 10;
    const v = u > f + 0.01 ? (u * f) / (u - f) : 1e9;
    const M = s / u;
    const dz = (s - v) / ((v / u) ** 2); // 物方等效离焦量 mm
    return { u, s, v, M, dz: Math.max(-60, Math.min(60, dz)) };
  }
  compute() {
    const c = this.chain();
    const glass = c.filtOn && this.ftype === 'glass';
    const key = [this.obj, this.rot.toFixed(2), c.lensOK, c.scrOK, c.filtOn, this.ftype, this.drum.toFixed(3), this.yk.toFixed(3), this.slitW, this.slitRot, this.iris, this.stopD, c.fl, c.sc, c.L, c.ob, c.l1, c.l0, this.laserOn].join('|');
    if (key === this._key) return;
    this._key = key;
    this.imgOK = false;
    if (!c.scrOK || glass) return;
    const sp = this.spectrum(), bx = this.binMM(c), im = this.imaging(c), f = this.fc();
    const re = new Float64Array(N * N), ii = new Float64Array(N * N);
    const k = Math.PI * LAM * im.dz / (this.S * this.S);
    for (let j = 0; j < N; j++) {
      const fj = fIdx(j, N);
      for (let i = 0; i < N; i++) {
        const fi = fIdx(i, N), o = j * N + i;
        const T = this.T(fi * bx, fj * bx, c, f);
        if (!T) continue;
        const ph = k * (fi * fi + fj * fj), cs = Math.cos(ph) * T, sn = Math.sin(ph) * T;
        re[o] = sp.re[o] * cs - sp.im[o] * sn; ii[o] = sp.re[o] * sn + sp.im[o] * cs;
      }
    }
    fft2(re, ii, N, true);
    let mx = 0;
    for (let o = 0; o < N * N; o++) { const v = re[o] * re[o] + ii[o] * ii[o]; this.I[o] = v; if (v > mx) mx = v; }
    this.Imax = mx;
    const g = this.imgCanvas.getContext('2d'), img = g.createImageData(N, N);
    for (let o = 0; o < N * N; o++) {
      const v = Math.min(1, Math.sqrt(this.I[o]) * 1.1);
      img.data[o * 4] = 255 * v; img.data[o * 4 + 1] = 60 * v * v; img.data[o * 4 + 2] = 50 * v * v; img.data[o * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.imgOK = true;
  }

  /** 理论判断：当前滤波器下像应呈现的特征（按通过的衍射级判断） */
  classify() {
    const c = this.chain();
    if (!c.scrOK) return null;
    if (c.filtOn && this.ftype === 'glass') return null;
    const bx = this.binMM(c), r = (this.rot * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r), q = N / P;
    const at = (m, n) => { const X = (m * cs - n * sn) * q * bx, Y = (m * sn + n * cs) * q * bx; return this.T(X, Y, c); };
    const D = at(0, 0) > 0.5;
    if (this.obj === 'grid' || this.obj === 'grating') {
      const a = this.obj === 'grid' ? 5 / 8 : 1 / 2, pass = [];
      for (let m = -3; m <= 3; m++) for (let n = -3; n <= 3; n++) {
        if (this.obj === 'grating' && n) continue;
        if ((m || n) && Math.abs(cm(a, m) * (this.obj === 'grid' ? cm(a, n) : 1)) > 0.02 && at(m, n) > 0.5) pass.push([m, n]);
      }
      if (!pass.length) return D ? '均匀亮场' : '视场全暗';
      const [m0, n0] = pass[0];
      const col = pass.every(([m, n]) => m * n0 - n * m0 === 0);
      if (!col) return '正交网格';
      if (!D && pass.length === 2 && pass.every(([m, n]) => Math.abs(m) + Math.abs(n) <= 2 && Math.max(Math.abs(m), Math.abs(n)) === 1)) return '条纹周期减半';
      return n0 === 0 ? '竖直条纹' : m0 === 0 ? '水平条纹' : '斜条纹';
    }
    let low = 0; for (let k = 0; k < 12; k++) { const a = (k * Math.PI) / 6, rr = 4; low += this.T(rr * Math.cos(a) * bx, rr * Math.sin(a) * bx, c); }
    const Lp = low / 12 > 0.5;
    if (this.obj === 'gword') {
      const G = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([m, n]) => at(m, n) > 0.5);
      if (G) return '网格字';
      if (D && Lp) return '字（网格消失）';
      if (!D && Lp) return '字的轮廓（边缘增强）';
      return D ? '均匀亮场' : '视场全暗';
    }
    if (D) return Lp ? '字' : '均匀亮场';
    return '字的轮廓（边缘增强）';
  }

  cameras() {
    return [
      { name: '全景', pos: [90, 85, 150], target: [90, 16, 0] },
      { name: '光源端', pos: [22, 40, 55], target: [24, 20, 0] },
      { name: '物与透镜', pos: [70, 38, 50], target: [72, 20, 0] },
      { name: '频谱面', pos: [96, 34, 34], target: [93, 21, 0] },
      { name: '像屏', pos: [150, 38, 50], target: [166, 20, 0] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    const t = labTable(300, 80); t.position.set(90, 0, 0); scene.add(t);
    scene.add(opticalRail(RAIL));
    app.addRail({ origin: new THREE.Vector3(0, 0, 0), min: 0, max: RAIL });
    app.stage.setLightTarget(90, 0, 0);

    const lc = carriage(0x9aa3b2, AXIS_Y);
    const lz = laserMesh(24); lz.group.position.set(2, 0, 0); lc.top.add(lz.group);
    this.laserAp = lz.aperture;
    app.addComponent(new Component({
      key: 'laser', name: 'He-Ne 激光器', icon: ICONS.laser, zone: 'rail', defaultPos: 4, required: true, object: lc.group, labelY: 30,
      desc: '632.8 nm 单模激光，相干性好，是空间滤波实验的光源。',
      controls: () => [{ type: 'toggle', label: '激光电源', get: () => this.laserOn, set: (v) => (this.laserOn = v) }],
    }));

    const ec = carriage(0x9aa3b2, AXIS_Y);
    const eg = new THREE.Group();
    const barrel = mesh(new THREE.CylinderGeometry(1.1, 1.4, 3, 24), MAT.black()); barrel.rotation.z = Math.PI / 2; eg.add(barrel);
    eg.add(mesh(new THREE.BoxGeometry(0.8, 3, 1.2), MAT.dark(), 0, -2.2, 0));
    ec.top.add(eg);
    app.addComponent(new Component({
      key: 'l0', name: '扩束镜 L₀（f = 6 mm）', icon: ICONS.expander, zone: 'rail', defaultPos: 14, required: true, object: ec.group, labelY: 28,
      desc: '短焦距显微物镜，把细激光束会聚后发散。',
    }));

    const cc = carriage(0x9aa3b2, AXIS_Y);
    cc.top.add(lensMesh(5, 0.7));
    app.addComponent(new Component({
      key: 'l1', name: '准直透镜 L₁（f = 190 mm）', icon: ICONS.lens, zone: 'rail', defaultPos: 38, required: true, object: cc.group, labelY: 30,
      desc: 'L₀ 的焦点放在 L₁ 的前焦点上，得到扩束后的平行光。可比较近处和远处的光斑大小来判断是否平行。',
      controls: () => [
        { type: 'readout', label: '紧靠 L₁ 后的光斑直径', get: () => { const s = this.spotAt(0); return s == null ? '—' : `${s.toFixed(1)} mm`; } },
        { type: 'readout', label: '距 L₁ 100 cm 处的光斑直径', get: () => { const s = this.spotAt(100); return s == null ? '—' : `${s.toFixed(1)} mm`; } },
      ],
    }));

    const oc = carriage(0x9aa3b2, AXIS_Y);
    const og = new THREE.Group();
    og.add(mesh(new THREE.BoxGeometry(0.6, 8, 8), MAT.dark()));
    this.objTexCanvas = document.createElement('canvas'); this.objTexCanvas.width = this.objTexCanvas.height = 128;
    this.objTex = new THREE.CanvasTexture(this.objTexCanvas); this.objTex.colorSpace = THREE.SRGBColorSpace;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: this.objTex }));
    pl.rotation.y = -Math.PI / 2; pl.position.x = -0.32; og.add(pl);
    const pl2 = pl.clone(); pl2.rotation.y = Math.PI / 2; pl2.position.x = 0.32; og.add(pl2);
    og.add(mesh(new THREE.BoxGeometry(0.8, 4, 1.2), MAT.dark(), 0, -5.6, 0));
    this.objHolder = og; oc.top.add(og);
    app.addComponent(new Component({
      key: 'obj', name: '物（光栅/网格字）', icon: ICONS.grating, zone: 'rail', defaultPos: 60, required: true, object: oc.group, labelY: 31,
      desc: '物架上可换装正交光栅、一维光栅、网格字和透明字，并可绕光轴转动。',
      controls: () => [
        { type: 'segment', label: '物', get: () => this.obj, set: (v) => (this.obj = v), options: OBJS.map((o) => ({ label: o.name, value: o.key })) },
        { type: 'knob', label: '物绕光轴转角', get: () => this.rot, set: (v) => (this.rot = Math.max(-45, Math.min(45, v))), min: -45, max: 45, step: 0.5, bigStep: 5, perRev: 30, digits: 1, unit: '°' },
      ],
    }));

    const Lc = carriage(0x9aa3b2, AXIS_Y);
    Lc.top.add(lensMesh(5, 0.9));
    app.addComponent(new Component({
      key: 'lens', name: '傅里叶透镜 L（f = 150 mm）', icon: ICONS.lens, zone: 'rail', defaultPos: 78, required: true, object: Lc.group, labelY: 30,
      desc: '平行光照明下，物的夫琅禾费衍射图样（频谱）出现在 L 的后焦面上；物经 L 成像在像屏上。',
    }));

    const fc = carriage(0x9aa3b2, AXIS_Y);
    const fg = new THREE.Group();
    fg.add(mesh(new THREE.BoxGeometry(0.5, 7, 7), MAT.dark()));
    this.ftexCanvas = document.createElement('canvas'); this.ftexCanvas.width = this.ftexCanvas.height = 128;
    this.ftex = new THREE.CanvasTexture(this.ftexCanvas); this.ftex.colorSpace = THREE.SRGBColorSpace;
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), new THREE.MeshBasicMaterial({ map: this.ftex }));
    fp.rotation.y = -Math.PI / 2; fp.position.x = -0.27; fg.add(fp);
    this.fplate = fg;
    const drum = mesh(new THREE.CylinderGeometry(0.9, 0.9, 3, 24), MAT.chrome(), 0, -2.6, 5.2); drum.rotation.x = Math.PI / 2; fg.add(drum);
    this.drumMesh = drum;
    fc.top.add(fg);
    app.addComponent(new Component({
      key: 'filt', name: '频谱面滤波器架', icon: ICONS.filter, zone: 'rail', defaultPos: 100, required: true, object: fc.group, labelY: 30,
      desc: '可插入毛玻璃（带十字线，用于观察和测量频谱）、可调狭缝、可变光阑、挡光点。架子横向由测微鼓轮（分度 0.01 mm）移动，纵向可升降。',
      controls: () => [
        { type: 'segment', label: '插入', get: () => this.ftype, set: (v) => (this.ftype = v), options: FILTERS.map((f) => ({ label: f.name, value: f.key })) },
        { type: 'knob', label: '横向测微鼓轮', get: () => this.drum, set: (v) => (this.drum = Math.max(0, Math.min(25, v))), min: 0, max: 25, step: 0.01, bigStep: 0.1, perRev: 0.5, digits: 3, unit: 'mm', sub: '鼓轮转一圈，架子横移 0.5 mm' },
        { type: 'knob', label: '升降', get: () => this.yk, set: (v) => (this.yk = Math.max(-3, Math.min(3, v))), min: -3, max: 3, step: 0.01, bigStep: 0.1, perRev: 0.5, digits: 2, unit: 'mm' },
        { type: 'knob', label: '狭缝宽度', get: () => this.slitW, set: (v) => (this.slitW = Math.round(Math.max(0.05, Math.min(3, v)) * 100) / 100), min: 0.05, max: 3, step: 0.01, bigStep: 0.1, perRev: 0.5, digits: 2, unit: 'mm' },
        { type: 'knob', label: '狭缝转角', get: () => this.slitRot, set: (v) => (this.slitRot = Math.round(((v % 180) + 180) % 180 * 2) / 2), wrap: 180, step: 0.5, bigStep: 15, perRev: 90, digits: 1, unit: '°', sub: '0° 为竖直狭缝' },
        { type: 'knob', label: '可变光阑直径', get: () => this.iris, set: (v) => (this.iris = Math.round(Math.max(0.2, Math.min(8, v)) * 100) / 100), min: 0.2, max: 8, step: 0.05, bigStep: 0.5, perRev: 2, digits: 2, unit: 'mm' },
        { type: 'segment', label: '挡光点直径', get: () => this.stopD, set: (v) => (this.stopD = v), options: [0.3, 0.6, 1.0, 1.5].map((d) => ({ label: `Φ${d} mm`, value: d })) },
      ],
    }));

    const sc = carriage(0x9aa3b2, AXIS_Y);
    const ws = whiteScreen(14, 14); sc.top.add(ws.group);
    this.scrTexCanvas = document.createElement('canvas'); this.scrTexCanvas.width = this.scrTexCanvas.height = 256;
    this.scrTex = new THREE.CanvasTexture(this.scrTexCanvas); this.scrTex.colorSpace = THREE.SRGBColorSpace;
    ws.face.material = new THREE.MeshBasicMaterial({ map: this.scrTex });
    app.addComponent(new Component({
      key: 'screen', name: '像屏', icon: ICONS.screen, zone: 'rail', defaultPos: 150, required: true, object: sc.group, labelY: 32,
      desc: '白屏，上有毫米刻度，接收物经傅里叶透镜所成的放大实像。',
    }));

    this.beam0 = new Beam(0xff2a2a, 0.07, 0.3); scene.add(this.beam0.group);
    this.cones = [0, 1, 2, 3, 4].map(() => { const k = new Cone(); scene.add(k.mesh); return k; });
    this.specView = app.addView({ id: 'spec', title: '频谱面（滤波器架上）', w: 260, h: 260, res: 1.6 });
    this.imgView = app.addView({ id: 'img', title: '像屏', w: 260, h: 260, res: 1.6 });
  }

  update() {
    const c = this.chain();
    this.laserAp.material.emissiveIntensity = this.laserOn ? 2 : 0.2;
    this.compute();
    // 光束
    const las = c.las;
    if (this.laserOn && las != null) {
      const end = c.l0 != null && c.l0 > las ? c.l0 : RAIL;
      this.beam0.set(new THREE.Vector3(las + 2.4, AXIS_Y, 0), new THREE.Vector3(end, AXIS_Y, 0), 1);
    } else this.beam0.hide();
    const [k0, k1, k2, k3, k4] = this.cones;
    if (c.beam) {
      k0.set(c.p0, 0.02, c.l1, c.R1);
      const R = (x) => Math.abs(c.R1 * (1 - (x - c.l1) * c.V1));
      const e1 = c.ob != null && c.ob > c.l1 ? c.ob : RAIL;
      k1.set(c.l1, c.R1, e1, R(e1));
      if (c.objOK) {
        const rw = this.S / 20, e2 = c.L != null && c.L > c.ob ? c.L : RAIL;
        k2.set(c.ob, rw, e2, rw);
        if (c.lensOK) {
          const end = c.sc != null && c.sc > c.L ? c.sc : RAIL;
          const glassStop = c.filtOn && this.ftype === 'glass' ? c.fl : end;
          if (c.zs != null && c.zs < glassStop) {
            k3.set(c.L, rw, c.zs, 0.02);
            const im = c.scrOK ? this.imaging(c) : null;
            k4.set(c.zs, 0.02, glassStop, glassStop === end && im ? Math.min(3, (this.S * Math.abs(im.M)) / 20) : rw * (glassStop - c.zs) / Math.max(1, c.q));
          } else { k3.set(c.L, rw, glassStop, rw * 0.5); k4.hide(); }
        } else { k3.hide(); k4.hide(); }
      } else { k2.hide(); k3.hide(); k4.hide(); }
    } else this.cones.forEach((k) => k.hide());
    this.drumMesh.rotation.y = this.drum * 4 * Math.PI;
    this.fplate.position.y = this.yk * 0.3;
    this.drawSpec(c);
    this.drawImage(c);
    this.drawTextures(c);
  }

  drawSpec(c) {
    const v = this.specView, g = v.ctx, W = v.W, H = v.H, mmW = 8, ppm = W / mmW;
    const has = this.app.comp('filt').placed;
    g.fillStyle = '#0a0909'; g.fillRect(0, 0, W, H);
    if (!has) { v.foot('滤波器架不在导轨上'); return; }
    const t = this.ftype;
    // 底板
    g.fillStyle = t === 'glass' ? '#262222' : t === 'none' ? '#0a0909' : '#33363b'; g.fillRect(0, 0, W, H);
    const lit = c.filtOn && c.zs !== undefined && this.laserOn;
    // 光点层
    const L = this.layer; L.width = W; L.height = H; const lg = L.getContext('2d');
    if (lit) {
      const sp = this.spectrum(), bx = this.binMM(c), f = this.fc();
      const sc = this.specCanvas.getContext('2d'); sc.putImageData(sp.img, 0, 0);
      const rs = this.spotR(c), size = N * bx * ppm;
      lg.imageSmoothingEnabled = true;
      lg.filter = `blur(${Math.max(0.6, rs * ppm * 0.7).toFixed(1)}px)`;
      lg.translate(W / 2 - f.cx * ppm, H / 2 - f.cy * ppm);
      lg.drawImage(this.specCanvas, -size / 2 - bx * ppm / 2, -size / 2 - bx * ppm / 2, size, size);
      lg.setTransform(1, 0, 0, 1, 0, 0); lg.filter = 'none';
      const k = Math.min(1, 0.4 / Math.max(0.02, rs)) ** 0.5;
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < (rs < 0.05 ? 3 : 1); i++) { g.globalAlpha = t === 'none' ? 0 : k; g.drawImage(L, 0, 0); }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    // 滤波器形状
    const cx = W / 2, cy = H / 2;
    g.save();
    if (t === 'slit' || t === 'iris' || t === 'stop') {
      g.beginPath();
      if (t === 'slit') { g.translate(cx, cy); g.rotate((-this.slitRot * Math.PI) / 180); g.rect((-this.slitW / 2) * ppm, -H, this.slitW * ppm, 2 * H); g.setTransform(1, 0, 0, 1, 0, 0); }
      else if (t === 'iris') g.arc(cx, cy, (this.iris / 2) * ppm, 0, Math.PI * 2);
      else { g.rect(0, 0, W, H); g.arc(cx, cy, (this.stopD / 2) * ppm, 0, Math.PI * 2, true); }
      g.fillStyle = 'rgba(0,0,0,.82)'; g.fill('evenodd');
      g.strokeStyle = '#a8adb5'; g.lineWidth = 1.5; g.stroke();
      if (t === 'stop') { g.fillStyle = '#4a4e55'; g.beginPath(); g.arc(cx, cy, (this.stopD / 2) * ppm, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#a8adb5'; g.stroke(); }
    }
    g.restore();
    if (t === 'glass') {
      g.strokeStyle = 'rgba(230,230,230,.75)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H); g.moveTo(0, cy); g.lineTo(W, cy); g.stroke();
      g.fillStyle = 'rgba(230,230,230,.7)';
      for (let m = -4; m <= 4; m++) { const x = cx + m * ppm; g.fillRect(x - 0.5, cy - (m % 2 ? 4 : 7), 1, m % 2 ? 8 : 14); }
    }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `${Math.round(W * 0.04)}px "IBM Plex Mono", Consolas`; g.textAlign = 'left';
    g.fillText('1 mm', 10, H - 10); g.fillRect(10, H - 26, ppm, 3);
    let foot;
    if (!this.laserOn) foot = '激光器未开';
    else if (!c.lensOK) foot = '光路不完整：激光器—扩束镜—准直镜—物—傅里叶透镜';
    else if (!c.filtOn) foot = '滤波器架应放在傅里叶透镜与像屏之间';
    else if (t === 'none') foot = '空架：光直接通过，看不到频谱';
    else foot = `鼓轮 ${this.drum.toFixed(3)} mm · 升降 ${this.yk.toFixed(2)} mm`;
    v.foot(foot);
  }

  drawImage(c) {
    const v = this.imgView, g = v.ctx, W = v.W, H = v.H, mmW = 30, ppm = W / mmW;
    g.fillStyle = '#171313'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
    for (let m = -15; m <= 15; m++) { g.beginPath(); g.moveTo(W / 2 + m * ppm, 0); g.lineTo(W / 2 + m * ppm, H); g.moveTo(0, H / 2 + m * ppm); g.lineTo(W, H / 2 + m * ppm); g.stroke(); }
    let foot = '';
    if (!this.app.comp('screen').placed) foot = '像屏不在导轨上';
    else if (!this.laserOn || !c.lensOK) foot = '像屏上没有光';
    else if (!c.scrOK) foot = '像屏应放在傅里叶透镜之后';
    else if (c.filtOn && this.ftype === 'glass') {
      const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.4);
      gr.addColorStop(0, 'rgba(255,60,50,.35)'); gr.addColorStop(1, 'rgba(255,40,40,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H); foot = '毛玻璃把光散射开，像屏上只有一片模糊的红光';
    } else if (this.imgOK) {
      const im = this.imaging(c), size = this.S * Math.abs(im.M) * ppm;
      const co = this.app.coaxOff('screen'); // 像屏与光轴不共轴时，像偏离屏中心、变暗
      g.save(); g.translate(W / 2 + co.z * 10 * ppm, H / 2 - co.y * 10 * ppm); g.rotate(Math.PI); g.imageSmoothingEnabled = true;
      g.globalAlpha = Math.min(1, this.app.coaxT('screen'));
      g.globalCompositeOperation = 'lighter';
      g.drawImage(this.imgCanvas, -size / 2, -size / 2, size, size);
      g.restore();
      foot = '倒立实像（视场 30 mm × 30 mm）';
    }
    v.foot(foot);
  }

  drawTextures(c) {
    // 物架上的样品
    const og = this.objTexCanvas.getContext('2d'), okey = `${this.obj}|${this.rot.toFixed(1)}`;
    if (this._okey !== okey) {
      this._okey = okey;
      og.fillStyle = '#16181c'; og.fillRect(0, 0, 128, 128);
      const t = this.spectrum().t, img = og.createImageData(128, 128);
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const v = t[(y * 2) * N + x * 2], o = (y * 128 + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 24 + 196 * v; img.data[o + 3] = 255; }
      og.putImageData(img, 0, 0); this.objTex.needsUpdate = true;
    }
    // 滤波器板
    const fg = this.ftexCanvas.getContext('2d'), fkey = `${this.ftype}|${this.slitW}|${this.slitRot}|${this.iris}|${this.stopD}`;
    if (this._fkey !== fkey) {
      this._fkey = fkey;
      const t = this.ftype, s = 128, p = s / 12;
      fg.fillStyle = t === 'glass' ? '#d9d6d0' : t === 'none' ? '#111' : '#2c2f34'; fg.fillRect(0, 0, s, s);
      fg.fillStyle = '#050505';
      if (t === 'slit') { fg.save(); fg.translate(s / 2, s / 2); fg.rotate((-this.slitRot * Math.PI) / 180); fg.fillRect(-Math.max(1, this.slitW * p) / 2, -s, Math.max(1, this.slitW * p), 2 * s); fg.restore(); }
      if (t === 'iris') { fg.beginPath(); fg.arc(s / 2, s / 2, Math.max(1, (this.iris / 2) * p), 0, 7); fg.fill(); }
      if (t === 'stop') { fg.fillStyle = '#050505'; fg.beginPath(); fg.arc(s / 2, s / 2, s * 0.45, 0, 7); fg.fill(); fg.fillStyle = '#2c2f34'; fg.beginPath(); fg.arc(s / 2, s / 2, Math.max(1.5, (this.stopD / 2) * p), 0, 7); fg.fill(); }
      if (t === 'glass') { fg.strokeStyle = '#333'; fg.beginPath(); fg.moveTo(s / 2, 0); fg.lineTo(s / 2, s); fg.moveTo(0, s / 2); fg.lineTo(s, s / 2); fg.stroke(); }
      this.ftex.needsUpdate = true;
    }
    // 像屏
    const sg = this.scrTexCanvas.getContext('2d'), skey = this._key + (this.imgOK ? 1 : 0);
    if (this._skey !== skey) {
      this._skey = skey;
      sg.fillStyle = '#e8e6e1'; sg.fillRect(0, 0, 256, 256);
      sg.strokeStyle = 'rgba(0,0,0,.18)';
      for (let i = 0; i <= 14; i++) { const x = (i / 14) * 256; sg.beginPath(); sg.moveTo(x, 250); sg.lineTo(x, i % 5 ? 244 : 238); sg.stroke(); }
      if (c.scrOK && this.imgOK) {
        const im = this.imaging(c), size = (this.S * Math.abs(im.M)) / 140 * 256;
        sg.save(); sg.translate(128, 128); sg.rotate(Math.PI); sg.globalCompositeOperation = 'multiply';
        sg.fillStyle = '#3a1210'; sg.fillRect(-size / 2, -size / 2, size, size);
        sg.globalCompositeOperation = 'lighter'; sg.drawImage(this.imgCanvas, -size / 2, -size / 2, size, size); sg.restore();
      } else if (c.scrOK && c.filtOn && this.ftype === 'glass') {
        const gr = sg.createRadialGradient(128, 128, 0, 128, 128, 90); gr.addColorStop(0, 'rgba(255,80,70,.5)'); gr.addColorStop(1, 'rgba(255,80,70,0)'); sg.fillStyle = gr; sg.fillRect(0, 0, 256, 256);
      }
      this.scrTex.needsUpdate = true;
    }
  }

  globalControls() {
    return [
      { type: 'select', label: '我在像屏上看到的像', get: () => this.see, set: (v) => (this.see = v), options: [{ label: '（请选择）', value: '' }, ...OBS.map((o) => ({ label: o, value: o }))] },
    ];
  }

  // ---------------- 数据 ----------------
  filterText() {
    const t = this.ftype;
    if (!this.chain().filtOn) return '无滤波器';
    if (t === 'slit') return `狭缝 ${this.slitW.toFixed(2)} mm，转角 ${this.slitRot.toFixed(0)}°`;
    if (t === 'iris') return `可变光阑 Φ${this.iris.toFixed(2)} mm`;
    if (t === 'stop') return `挡光点 Φ${this.stopD} mm`;
    if (t === 'none') return '空架（无滤波）';
    return '毛玻璃';
  }
  tables() {
    return [
      {
        id: 'spec', title: '频谱点位置', fixedRows: true,
        initRows: () => [-2, -1, 0, 1, 2].map((k) => ({ k })),
        columns: [{ key: 'k', label: '衍射级 k', digits: 0, readonly: true }, { key: 'x', label: '鼓轮读数 x/mm', digits: 3 }],
        buttons: [{ label: '记录十字线所对光点的读数', onClick: (t) => this.recSpec(t) }],
        note: '物用一维光栅或正交光栅（不转动），在频谱面插入毛玻璃。转动鼓轮使十字线竖线依次对准水平方向各光点中心后记录。',
      },
      {
        id: 'obs', title: '空间滤波观察',
        columns: [
          { key: 'obj', label: '物', type: 'text', readonly: true },
          { key: 'filt', label: '滤波器', type: 'text', readonly: true },
          { key: 'see', label: '观察到的像', type: 'text', readonly: true },
          { key: 'ok', label: '与理论', type: 'text', calc: (r) => (r.exp == null ? '—' : r.see === r.exp ? '✓ 一致' : `✗ 应为「${r.exp}」`) },
        ],
        buttons: [{ label: '记录当前滤波结果', onClick: (t) => this.recObs(t) }],
        note: '先在右侧“我在像屏上看到的像”中选择观察结果，再记录。“与理论”一栏根据通过滤波器的衍射级给出判断。',
      },
    ];
  }
  orderStep(c) { return (LAM * c.q * 10) / this.d; } // 相邻衍射级间距 mm
  recSpec(t) {
    const c = this.chain();
    if (!c.filtOn || this.ftype !== 'glass' || !this.laserOn) return this.app.toast('请在频谱面插入毛玻璃并打开激光', 'warn');
    if (this.obj !== 'grid' && this.obj !== 'grating') return this.app.toast('请换用一维光栅或正交光栅', 'warn');
    if (c.zs == null) return this.app.toast('频谱面上看不到会聚的光点', 'warn');
    if (Math.abs(this.rot) > 1) this.app.toast('提示：光栅没有转正，光点不在水平线上', 'warn');
    if (this.spotR(c) > 0.08) this.app.toast('提示：毛玻璃不在频谱面上，光点较大、模糊', 'warn');
    const s = this.orderStep(c), r = (this.rot * Math.PI) / 180;
    const X = this.drum - this.X0, k = Math.round(X / (s * Math.cos(r)));
    if (Math.abs(k) > 2) return this.app.toast('只需测 −2 ～ +2 级', 'warn');
    if (Math.abs(X - k * s * Math.cos(r)) > Math.max(0.03, this.spotR(c))) return this.app.toast('十字线没有对准光点中心', 'warn');
    const i = t.rows.findIndex((q) => q.k === k);
    t.set(i, 'x', Math.round((this.drum + gauss(0.003)) * 1000) / 1000);
  }
  recObs(t) {
    const c = this.chain();
    if (!c.scrOK || !this.laserOn) return this.app.toast('像屏上没有像', 'warn');
    if (c.filtOn && this.ftype === 'glass') return this.app.toast('毛玻璃挡住了像，请换上滤波器', 'warn');
    if (!this.see) return this.app.toast('请先在右侧选择“我在像屏上看到的像”', 'warn');
    t.addRow({ obj: OBJS.find((o) => o.key === this.obj).name + (Math.abs(this.rot) > 1 ? `（转 ${this.rot.toFixed(0)}°）` : ''), filt: this.filterText(), see: this.see, exp: this.classify(), okey: this.obj, fkey: c.filtOn ? this.ftype : 'none' });
  }

  /** 等高共轴调节：光路顺序、光束、透镜焦距与各元件通光孔（cm） */
  coaxSpec() {
    return {
      keys: ['laser', 'l0', 'l1', 'obj', 'lens', 'filt', 'screen'],
      after: 2,
      beam: { laser: { w: 0.05, div: 0.0006 }, l0: { w: 0.05, div: TH0 }, l1: { w: TH0 * F1, div: 0 }, lens: { w: TH0 * F1, div: -(TH0 * F1) / FL } },
      f: { l0: F0, l1: F1, lens: FL },
      ap: { l0: { y: 0.4, z: 0.4 }, l1: { y: 2, z: 2 }, obj: { y: 1.5, z: 1.5 }, lens: { y: 2, z: 2 }, filt: { y: 1.2, z: 1.2 }, screen: { y: 6, z: 6 } },
      axes: { laser: 'ya', l0: 'yz', l1: 'yz', obj: 'yz', lens: 'yz', filt: 'yz', screen: 'yz' },
    };
  }

  steps() {
    const app = this.app, c = () => this.chain();
    const obs = () => app.table('obs').completeRows();
    const center = async () => {
      app.select(app.comp('filt'));
      await app.tween(() => this.drum, (v) => (this.drum = v), this.X0, 500);
      await app.tween(() => this.yk, (v) => (this.yk = v), this.Y0, 300);
    };
    const look = async (see) => { this.see = see ?? this.classify(); app.changed(); await app.wait(200); await app.record('obs'); };
    return [
      {
        title: '获得扩束的平行光',
        html: '<p>依次放置 <b>激光器</b>、<b>扩束镜 L₀</b>、<b>准直透镜 L₁</b>，打开激光。前后移动 L₁，使 L₀ 的焦点落在 L₁ 的前焦点上：紧靠 L₁ 处和 100 cm 外的光斑直径相同，即为平行光。</p>',
        hint: 'L₁ 离 L₀ 太近，出射光发散；太远则会聚。看准直透镜面板中的两个光斑直径。',
        check: () => c().beam && Math.abs(c().V1) < 0.0015,
        status: () => { const a = this.spotAt(0), b = this.spotAt(100); return a == null ? '' : `光斑直径：L₁ 后 <b>${a.toFixed(1)}</b> mm，100 cm 处 <b>${b.toFixed(1)}</b> mm`; },
        auto: async () => {
          await app.view('全景');
          await app.autoPlace('laser', { pos: 4 }); await app.autoPlace('l0', { pos: 14 }); await app.autoPlace('l1', { pos: 38 });
          app.select(app.comp('laser')); this.laserOn = true; app.changed(); await app.wait(300);
          await app.view('光源端');
          await app.moveTo('l1', c().l0 + F0 + F1 + gauss(0.05), 1200);
        },
      },
      {
        title: '放置物和傅里叶透镜，在像屏上成清晰的像',
        html: '<p>在平行光中放入<b>物</b>（先用正交光栅），其后放<b>傅里叶透镜 L</b>（物距略大于 f），在远处放<b>像屏</b>。移动像屏，使屏上得到清晰的放大倒立像。</p>',
        hint: '物距取 17～20 cm，像距约 80～100 cm，放大约 5 倍。',
        check: () => { const k = c(); if (!k.scrOK || (k.filtOn && this.ftype === 'glass')) return false; const im = this.imaging(k); return Math.abs(im.s - im.v) < 15 && Math.abs(im.M) > 2.5; },
        status: () => { const k = c(); if (!k.lensOK) return ''; return `物距 <b>${((k.L - k.ob)).toFixed(1)} cm</b>`; },
        auto: async () => {
          await app.view('物与透镜');
          app.select(null); this.obj = 'grid'; this.rot = 0;
          await app.autoPlace('obj', { pos: 60 }); await app.autoPlace('lens', { pos: 78 });
          this.ftype = 'none';
          await app.autoPlace('screen', { pos: 150 });
          await app.view('全景');
          const k = c(), u = (k.L - k.ob) * 10, v = (u * FL * 10) / (u - FL * 10);
          await app.moveTo('screen', Math.min(RAIL, k.L + v / 10 + gauss(0.2)), 1400);
        },
      },
      {
        title: '在频谱面上观察频谱',
        html: '<p>把<b>滤波器架</b>放到 L 的后焦面附近，插入<b>毛玻璃</b>，前后移动架子，使毛玻璃上的衍射光点最小最清晰——这就是物的频谱面。转动物，观察频谱如何随之转动。</p>',
        check: () => { const k = c(); return k.filtOn && this.ftype === 'glass' && k.zs != null && Math.abs(k.fl - k.zs) < 0.4; },
        status: () => { const k = c(); return k.filtOn ? `光点半径约 <b>${Math.max(0.01, this.spotR(k)).toFixed(2)} mm</b>` : ''; },
        auto: async () => {
          this.ftype = 'glass';
          await app.autoPlace('filt', { pos: 100 }); await app.view('频谱面');
          app.select(app.comp('filt')); this.ftype = 'glass'; app.changed();
          await app.moveTo('filt', c().zs + gauss(0.05), 1200);
          await center();
        },
      },
      {
        title: '测量频谱点间距，求光栅常数',
        html: '<p>物换成<b>一维光栅</b>（转角 0°）。转动横向鼓轮，使十字线依次对准 −2、−1、0、+1、+2 级光点中心，记录读数。</p>',
        check: () => app.table('spec').completeRows().length >= 5,
        status: () => `已测 <b>${app.table('spec').completeRows().length}</b> / 5`,
        auto: async () => {
          const t = app.table('spec'); app.showTable(app.tables.indexOf(t));
          app.select(app.comp('obj')); this.obj = 'grating'; app.changed();
          await app.tween(() => this.rot, (v) => (this.rot = v), 0, 300);
          app.select(app.comp('filt'));
          const s = this.orderStep(c());
          for (const k of [-2, -1, 0, 1, 2]) {
            await app.tween(() => this.drum, (v) => (this.drum = v), this.X0 + k * s + gauss(0.004), 500);
            await app.record('spec');
          }
        },
      },
      {
        title: '方向滤波',
        html: '<p>物换回<b>正交光栅</b>，十字线对准 0 级后把毛玻璃换成<b>狭缝</b>（宽约 0.3 mm）。狭缝依次取竖直（0°）、水平（90°）、45° 方向，观察像的变化，在右侧选择看到的像并记录。</p>',
        hint: '竖直狭缝只让频谱面中间一列光点通过——它们对应物在竖直方向上的周期结构。',
        check: () => obs().filter((r) => r.okey === 'grid' && r.fkey === 'slit').length >= 3,
        status: () => `已记录 <b>${obs().filter((r) => r.okey === 'grid' && r.fkey === 'slit').length}</b> / 3`,
        auto: async () => {
          const t = app.table('obs'); app.showTable(app.tables.indexOf(t));
          app.select(app.comp('obj')); this.obj = 'grid'; this.rot = 0; app.changed();
          await center();
          this.ftype = 'none'; app.changed(); await look('正交网格');
          this.ftype = 'slit'; this.slitW = 0.3; app.changed(); await app.view('频谱面');
          for (const a of [0, 90, 45]) {
            await app.tween(() => this.slitRot, (v) => (this.slitRot = v), a, 500);
            await app.view('像屏'); await look();
          }
        },
      },
      {
        title: '低通滤波：去掉网格字上的网格',
        html: '<p>物换成<b>网格字</b>，在频谱面放<b>可变光阑</b>并对准 0 级。逐渐缩小光阑，直到只让 0 级附近的低频成分通过：像上的网格消失，只剩“光”字。再继续缩小，看看字会怎样。</p>',
        check: () => obs().some((r) => r.okey === 'gword' && r.fkey === 'iris'),
        auto: async () => {
          app.select(app.comp('obj')); this.obj = 'gword'; app.changed();
          app.select(app.comp('filt')); this.ftype = 'iris'; this.iris = 4; app.changed(); await app.view('频谱面');
          await look();
          await app.tween(() => this.iris, (v) => (this.iris = v), (this.orderStep(c()) * 1.1), 900);
          await app.view('像屏'); await look();
        },
      },
      {
        title: '高通滤波：边缘增强（选做）',
        optional: true,
        html: '<p>物换成<b>透明字</b>，在频谱面放<b>挡光点</b>挡住 0 级及其附近的低频成分，像屏上只剩字的轮廓。</p>',
        check: () => obs().some((r) => r.fkey === 'stop'),
        auto: async () => {
          app.select(app.comp('obj')); this.obj = 'word'; app.changed();
          app.select(app.comp('filt')); this.ftype = 'none'; app.changed(); await look();
          this.ftype = 'stop'; this.stopD = 0.6; app.changed(); await app.view('像屏'); await look();
        },
      },
      {
        title: '数据处理',
        html: '<p>由相邻频谱点间距 $\\Delta x$ 求光栅常数 $d=\\lambda f/\\Delta x$；整理滤波结果。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const sp = this.app.table('spec').completeRows();
    let html = '', plots = [], ok = false; const answers = [];
    if (sp.length >= 3) {
      const f = linFit(sp.map((r) => r.k), sp.map((r) => r.x));
      const dx = Math.abs(f.k), d = (LAM * FL * 10) / dx, ud = (d * f.uk) / dx;
      html += `<h3>1. 光栅常数</h3><table><tr><th>k</th>${sp.map((r) => `<td>${r.k}</td>`).join('')}</tr><tr><th>x/mm</th>${sp.map((r) => `<td>${r.x.toFixed(3)}</td>`).join('')}</tr></table>
        <p>$x$–$k$ 直线拟合：相邻级间距 $\\Delta x=${dx.toFixed(4)}$ mm，$r=${f.r.toFixed(6)}$。</p>
        <div class="result-box">$d=\\dfrac{\\lambda f}{\\Delta x}=${texU(d * 1000, ud * 1000, '\\mu m')}$，空间频率 $1/d=${(1 / d).toFixed(2)}$ 线/mm；本光栅参考值 $d_0=${(this.d * 1000).toFixed(2)}$ μm，相对误差 ${pct(relErr(d, this.d))}</div>
        <div class="plot-wrap"><canvas data-plot="0" style="height:240px"></canvas></div>`;
      plots.push({ title: '频谱点位置 x – 衍射级 k', xLabel: 'k', yLabel: 'x / mm', series: [{ type: 'scatter', data: sp.map((r) => [r.k, r.x]) , label: '测量值' }, { type: 'line', data: lineData(f.k, f.b, -2.3, 2.3), label: `Δx = ${dx.toFixed(4)} mm` }] });
      answers.push({ label: '光栅常数 $d$', unit: 'μm', value: d * 1000, digits: 2, tolRel: 0.01 });
      ok = true;
    }
    const ob = this.app.table('obs').completeRows();
    if (ob.length) {
      const right = ob.filter((r) => r.exp && r.see === r.exp).length;
      html += `<h3>2. 空间滤波</h3><table><tr><th>物</th><th>滤波器</th><th>观察到的像</th><th>理论</th></tr>${ob.map((r) => `<tr><td>${r.obj}</td><td>${r.filt}</td><td>${r.see}</td><td>${r.exp ?? '—'}</td></tr>`).join('')}</table>
        <p>${ob.length} 次观察中 ${right} 次与理论一致。像的结构只由通过频谱面的衍射级决定：只让一列（一行）光点通过，像就只剩一个方向的周期结构；只让 0 级附近的低频通过，细节（网格）消失；挡掉 0 级，均匀的背景消失，只留下变化剧烈的边缘。</p>`;
      ok = true;
    }
    if (!ok) html = '<p>请先测量频谱点位置或记录滤波结果。</p>';
    return { html, ok, plots, answers };
  }

  principle() {
    return `<h3>1. 阿贝成像原理</h3><p>相干光照明下，透镜成像分两步：物的衍射光在透镜后焦面上形成夫琅禾费衍射图样——物的<b>空间频谱</b>；频谱面上各衍射级作为新的次波源，在像面上相干叠加成像。频谱面坐标与空间频率的关系为</p>$$x=\\lambda f\\,\\nu_x,\\qquad y=\\lambda f\\,\\nu_y$$<p>周期为 $d$ 的光栅只有离散频率 $\\nu=k/d$，频谱为一排等间距光点，间距 $\\Delta x=\\lambda f/d$。</p>
<h3>2. 空间滤波</h3><p>在频谱面放置光阑（滤波器）改变频谱，像随之改变。狭缝：方向滤波；小孔：低通滤波，去除细节和噪声；挡光点：高通滤波，突出边缘。</p>
<h3>3. 本仿真的计算方法</h3><p>物的复振幅透过率在 256×256 网格上采样，用自编的二维 FFT 得到频谱 $T(\\nu_x,\\nu_y)$；乘以滤波器函数 $H$ 和像屏离焦引起的二次相位因子 $\\exp[i\\pi\\lambda\\delta(\\nu_x^2+\\nu_y^2)]$（$\\delta$ 为物方等效离焦量），再做逆 FFT 得到像面复振幅，强度 $|g|^2$ 按放大率 $s/u$ 倒立显示。入射光不严格平行时，频谱面移到光源经 L₁、L 所成的像处；滤波器偏离频谱面时，每个衍射斑扩展为圆斑，按圆斑透过滤波器的比例计算其透过率（几何近似）。</p>`;
  }
}
