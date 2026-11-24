// 电学实验公共模块：改进节点法 (MNA) 求解器、接线柱与导线交互、常用仪器（指针式电表、稳压电源、变阻器、电阻箱、开关……）
// 求解器为自主实现：线性元件直接组装矩阵，二极管用牛顿迭代，稳压电源带限流（恒流）切换。
import * as THREE from 'three';
import { dialAngle, drawDialFace } from './dial.js';
export { dialAngle, drawDialFace };
import { Component } from './Component.js';
import { MAT, mesh, canvasTexture } from './Models.js';
import { rand, clamp } from './Stats.js';

const VT = 0.025852; // kT/q at 300 K
const GMIN = 1e-9;
const R_WIRE = 0.01; // 每根导线（含接触）电阻 Ω

// ============================ 求解器 ============================
/** 高斯消元（列主元），原地修改 A、b，返回解 */
function gauss(A, b) {
  const n = b.length;
  for (let k = 0; k < n; k++) {
    let p = k, mx = Math.abs(A[k][k]);
    for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i][k]); if (v > mx) { mx = v; p = i; } }
    if (mx < 1e-30) { A[k][k] = 1e-30; continue; }
    if (p !== k) { [A[k], A[p]] = [A[p], A[k]]; [b[k], b[p]] = [b[p], b[k]]; }
    const Ak = A[k], piv = Ak[k];
    for (let i = k + 1; i < n; i++) {
      const Ai = A[i], f = Ai[k] / piv;
      if (f === 0) continue;
      for (let j = k; j < n; j++) Ai[j] -= f * Ak[j];
      b[i] -= f * b[k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

/**
 * 求解直流工作点。
 * elems: [{type:'R',a,b,R} | {type:'V',a,b,E,r} | {type:'I',a,b,I} | {type:'D',a,b,Is,n} | {type:'C',a,b,C,v0} ]
 *   V：a 为正极，E 为电动势，r 内阻；I：电流 I 在元件内部从 a 流向 b；C 用于暂态（后向欧拉，需 dt）
 * 返回 { v(node), cur(elem) }
 */
export function solveCircuit(elems, { guess = null, dt = 0 } = {}) {
  const idx = new Map();
  const node = (s) => { if (!idx.has(s)) idx.set(s, idx.size + 1); return idx.get(s); };
  for (const e of elems) { e._a = node(e.a); e._b = node(e.b); }
  const N = idx.size; // 节点 1..N，0 为参考地（只经 GMIN 与各节点相连）
  const vs = elems.filter((e) => e.type === 'V');
  vs.forEach((e, k) => (e._k = N + k));
  const M = N + vs.length;
  const diodes = elems.filter((e) => e.type === 'D');
  let x = new Array(M).fill(0);
  if (guess) for (const [s, v] of guess) if (idx.has(s)) x[idx.get(s) - 1] = v;
  const V = (n) => (n ? x[n - 1] : 0);
  let iter = 0;
  for (; iter < 120; iter++) {
    const A = Array.from({ length: M }, () => new Float64Array(M));
    const b = new Float64Array(M);
    const g = (a, c, G) => { if (a) A[a - 1][a - 1] += G; if (c) A[c - 1][c - 1] += G; if (a && c) { A[a - 1][c - 1] -= G; A[c - 1][a - 1] -= G; } };
    const isrc = (a, c, I) => { if (a) b[a - 1] -= I; if (c) b[c - 1] += I; }; // 电流 I 从 a 经元件流到 c
    for (let n = 1; n <= N; n++) A[n - 1][n - 1] += GMIN;
    for (const e of elems) {
      if (e.type === 'R') g(e._a, e._b, 1 / Math.max(e.R, 1e-6));
      else if (e.type === 'I') isrc(e._a, e._b, e.I);
      else if (e.type === 'V') {
        const k = e._k - 1;
        if (e._a) { A[e._a - 1][k] += 1; A[k][e._a - 1] += 1; }
        if (e._b) { A[e._b - 1][k] -= 1; A[k][e._b - 1] -= 1; }
        A[k][k] -= e.r || 0; b[k] = e.E;
      } else if (e.type === 'C') {
        if (dt > 0) { const G = e.C / dt; g(e._a, e._b, G); isrc(e._a, e._b, -G * (e.v0 || 0)); }
      } else if (e.type === 'D') {
        const nVt = (e.n || 1) * VT;
        let vd = V(e._a) - V(e._b);
        // 电压限制，防止指数溢出
        const vcrit = nVt * Math.log(nVt / (Math.SQRT2 * e.Is));
        if (e._vd != null && vd > vcrit && Math.abs(vd - e._vd) > 2 * nVt) {
          vd = e._vd > 0 ? e._vd + nVt * Math.log(1 + (vd - e._vd) / nVt) : nVt * Math.log(vd / nVt);
        }
        vd = Math.max(vd, -5);
        e._vd = vd;
        const ex = Math.exp(vd / nVt), Id = e.Is * (ex - 1), gd = (e.Is / nVt) * ex + 1e-12;
        g(e._a, e._b, gd); isrc(e._a, e._b, Id - gd * vd);
      }
    }
    const xn = gauss(A.map((r) => Array.from(r)), Array.from(b));
    let dmax = 0;
    for (let i = 0; i < M; i++) dmax = Math.max(dmax, Math.abs(xn[i] - x[i]));
    x = xn;
    if (!diodes.length || dmax < 1e-9) break;
  }
  for (const d of diodes) d._vd = null;
  const sol = {
    iter,
    nodes: idx,
    v: (s) => (idx.has(s) ? x[idx.get(s) - 1] : NaN),
    /** 元件中从 a 流向 b 的电流 */
    cur: (e) => {
      const va = V(e._a), vb = V(e._b);
      if (e.type === 'R') return (va - vb) / Math.max(e.R, 1e-6);
      if (e.type === 'V') return x[e._k];
      if (e.type === 'I') return e.I;
      if (e.type === 'C') return dt > 0 ? (e.C / dt) * (va - vb - (e.v0 || 0)) : 0;
      if (e.type === 'D') return e.Is * (Math.exp(Math.min(80, (va - vb) / ((e.n || 1) * VT))) - 1);
      return 0;
    },
  };
  return sol;
}

// ============================ 模型 ============================
export function benchTable(w = 170, d = 90) {
  const g = new THREE.Group();
  const tex = canvasTexture(1024, 512, (ctx, W, H) => {
    ctx.fillStyle = '#7a5a3a'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {
      const y = Math.random() * H;
      ctx.strokeStyle = `rgba(${40 + Math.random() * 40},${25 + Math.random() * 25},10,${0.08 + Math.random() * 0.12})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x <= W; x += 64) ctx.lineTo(x, y + Math.sin(x / 90 + i) * 3); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(20,40,30,.85)'; ctx.fillRect(W * 0.02, H * 0.04, W * 0.96, H * 0.92);
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  });
  g.add(mesh(new THREE.BoxGeometry(w, 4, d), [MAT.paint(0x5b412a), MAT.paint(0x5b412a), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }), MAT.paint(0x5b412a), MAT.paint(0x5b412a), MAT.paint(0x5b412a)], 0, -2, 0));
  const legM = MAT.paint(0x3b3f45);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(4, 72, 4), legM, sx * (w / 2 - 6), -40, sz * (d / 2 - 6)));
  return g;
}

/** 接线柱：返回 group，顶点为导线连接点 */
export function bindingPost(color = 0xb91c1c) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.9, 6), MAT.paint(color), 0, 0.45, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 10), MAT.brass(), 0, 1.4, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 12), MAT.paint(color), 0, 2.0, 0));
  return g;
}

/** 面板贴图（文字标签），在 canvas 上自由绘制 */
export function panelMesh(w, h, draw, pxPerCm = 24) {
  const tex = canvasTexture(Math.round(w * pxPerCm), Math.round(h * pxPerCm), draw);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  m.userData.noHL = true;
  return m;
}

// ============================ 电路与接线 ============================
const WIRE_COLORS = [0xc81e1e, 0x1b1b1b, 0xd4a017, 0x1f4fbf, 0x2f8a4a, 0xe06a1a];

export class Circuit {
  constructor(app) {
    this.app = app;
    this.devices = new Map();
    this.wires = [];
    this.pending = null;
    this.sol = null;
    this.group = new THREE.Group();
    app.stage.scene.add(this.group);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.14, 8, 24), new THREE.MeshBasicMaterial({ color: 0x22d3ee, depthTest: false, transparent: true }));
    this.ring.rotation.x = Math.PI / 2; this.ring.renderOrder = 10; this.ring.visible = false;
    this.pendRing = this.ring.clone(); this.pendRing.material = new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false, transparent: true });
    this.pendRing.renderOrder = 10;
    this.preview = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0xfacc15, dashSize: 1, gapSize: 0.7 }));
    this.preview.visible = false;
    this.group.add(this.ring, this.pendRing, this.preview);
    this.pendRing.visible = false;
  }

  /** 注册仪器：dev = { key, comp, terms: {name: {pos, label}}, elements(t), after?(sol,t), tick?(dt) } */
  add(dev) {
    this.devices.set(dev.key, dev);
    dev.termObjs = {};
    for (const [name, t] of Object.entries(dev.terms)) {
      const post = bindingPost(t.color ?? 0xb91c1c);
      post.position.copy(t.pos);
      const id = `${dev.key}:${name}`;
      post.traverse((o) => (o.userData.term = id));
      dev.comp.root.add(post);
      dev.termObjs[name] = post;
    }
    if (dev.bindCircuit) dev.bindCircuit(this);
    this.app.addComponent(dev.comp);
    return dev;
  }
  dev(key) { return this.devices.get(key); }
  placed(key) { const d = this.devices.get(key); return !!(d && d.comp.placed); }
  termPos(id) {
    const [k, n] = id.split(':');
    const d = this.devices.get(k);
    const o = d.termObjs[n]; o.updateWorldMatrix(true, false);
    return o.localToWorld(new THREE.Vector3(0, 2.2, 0));
  }

  connect(a, b, silent = true) {
    if (a === b) return null;
    if (this.wires.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a))) return null;
    const w = { a, b, id: Math.random().toString(36).slice(2), color: WIRE_COLORS[this.wires.length % WIRE_COLORS.length] };
    this.wires.push(w);
    this.buildWire(w);
    if (!silent) this.app.toast(`已连接 ${this.label(a)} — ${this.label(b)}`, 'ok');
    this.app.changed();
    return w;
  }
  label(id) {
    const [k, n] = id.split(':'); const d = this.devices.get(k);
    return `${d.short || d.comp.name}「${d.terms[n].label || n}」`;
  }
  disconnect(w) {
    const i = this.wires.indexOf(w);
    if (i < 0) return;
    this.wires.splice(i, 1);
    this.group.remove(w.mesh); w.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.app.changed();
  }
  clear() { [...this.wires].forEach((w) => this.disconnect(w)); }
  removeDevice(key) { this.wires.filter((w) => w.a.startsWith(key + ':') || w.b.startsWith(key + ':')).forEach((w) => this.disconnect(w)); }
  wired(id) { return this.wires.some((w) => w.a === id || w.b === id); }

  buildWire(w) {
    const p1 = this.termPos(w.a), p2 = this.termPos(w.b);
    const d = p1.distanceTo(p2);
    const n = this.wires.indexOf(w);
    const side = new THREE.Vector3(-(p2.z - p1.z), 0, p2.x - p1.x).normalize().multiplyScalar(((n % 5) - 2) * 0.6);
    const lift = 2.5 + 0.11 * d;
    const pts = [p1, p1.clone().add(new THREE.Vector3(0, 2.2, 0)), p1.clone().lerp(p2, 0.5).add(new THREE.Vector3(0, lift, 0)).add(side), p2.clone().add(new THREE.Vector3(0, 2.2, 0)), p2];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: w.color, roughness: 0.45, metalness: 0.05 });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.22, 6, false), mat);
    tube.userData.wire = w; tube.castShadow = true;
    g.add(tube);
    for (const p of [p1, p2]) { const plug = mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.6, 10), mat, p.x, p.y + 0.9, p.z); plug.userData.wire = w; g.add(plug); }
    w.mesh = g; w.mat = mat;
    this.group.add(g);
  }

  termTargets() {
    const out = [];
    for (const d of this.devices.values()) if (d.comp.placed) for (const o of Object.values(d.termObjs)) out.push(o);
    return out;
  }
  pick(e) {
    const st = this.app.stage;
    st.setPointer(e);
    const objs = [...this.termTargets(), ...this.wires.map((w) => w.mesh)];
    const hits = st.raycaster.intersectObjects(objs, true);
    for (const h of hits) {
      if (h.object.userData.term) return { term: h.object.userData.term };
      if (h.object.userData.wire) return { wire: h.object.userData.wire };
    }
    return null;
  }
  pointerDown(e) {
    const h = this.pick(e);
    if (!h) { if (this.pending) { this.pending = null; this.pendRing.visible = false; this.preview.visible = false; this.app.changed(); return true; } return false; }
    if (h.term) {
      if (!this.pending) { this.pending = h.term; this.pendRing.position.copy(this.termPos(h.term)); this.pendRing.visible = true; this.app.say(`已选 ${this.label(h.term)}，再点另一个接线柱连线；点空白处取消`); }
      else if (this.pending === h.term) { this.pending = null; this.pendRing.visible = false; this.preview.visible = false; }
      else { this.connect(this.pending, h.term, false); this.pending = null; this.pendRing.visible = false; this.preview.visible = false; }
    } else if (h.wire) {
      this.disconnect(h.wire);
      this.app.toast('已拆除这根导线', 'ok');
    }
    this.app.changed();
    return true;
  }
  pointerMove(e) {
    const h = this.pick(e);
    const st = this.app.stage, dom = st.renderer.domElement;
    if (this._hw && (!h || h.wire !== this._hw)) { this._hw.mat.emissive.setHex(0); this._hw = null; }
    this.ring.visible = false;
    if (h && h.term) { this.ring.position.copy(this.termPos(h.term)); this.ring.visible = true; dom.style.cursor = 'crosshair'; }
    else if (h && h.wire) { h.wire.mat.emissive.setHex(0x7f1d1d); this._hw = h.wire; dom.style.cursor = 'not-allowed'; }
    if (this.pending) {
      const p0 = this.termPos(this.pending);
      const p1 = h && h.term ? this.termPos(h.term) : st.hitPlane(e, p0.y);
      if (p1) { this.preview.geometry.setFromPoints([p0, p1]); this.preview.computeLineDistances(); this.preview.visible = true; }
    }
    st.invalidate();
    if (!h) { if (!this.pending) dom.style.cursor = ''; return !!this.pending; }
    return true;
  }

  /** 由导线连通的“等电位”网络编号（不含元件内部），用于判断接线拓扑 */
  nets() {
    const parent = new Map();
    const f = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const w of this.wires) parent.set(f(w.a), f(w.b));
    return (id) => f(id);
  }

  solve(dt = 0) {
    const elems = [];
    for (const w of this.wires) elems.push({ type: 'R', a: w.a, b: w.b, R: R_WIRE });
    for (const d of this.devices.values()) {
      if (!d.comp.placed) continue;
      const t = (n) => `${d.key}:${n}`;
      for (const e of d.elements(t)) { e.dev = d; elems.push(e); }
      // 让每个接线柱都成为节点
      for (const n of Object.keys(d.terms)) elems.push({ type: 'R', a: t(n), b: t(n), R: 1 });
    }
    const guess = this.sol ? [...this.sol.nodes.keys()].map((s) => [s, this.sol.v(s)]) : null;
    let sol = solveCircuit(elems, { guess, dt });
    // 稳压电源超过限流值时切换为恒流输出
    let again = false;
    for (const e of elems) {
      if (e.type === 'V' && e.ilim != null && !e.cc) {
        const iout = -sol.cur(e);
        if (Math.abs(iout) > e.ilim) { e.type = 'I'; e.I = Math.sign(iout) * e.ilim; [e.a, e.b] = [e.b, e.a]; e.cc = true; again = true; }
      }
    }
    if (again) sol = solveCircuit(elems, { guess, dt });
    sol.elems = elems;
    this.sol = sol;
    for (const d of this.devices.values()) if (d.comp.placed && d.after) d.after(sol, (n) => `${d.key}:${n}`, elems.filter((e) => e.dev === d));
    return sol;
  }
  tick(dt) {
    let moving = false;
    for (const d of this.devices.values()) if (d.comp.placed && d.tick && d.tick(dt)) moving = true;
    if (moving) this.app.changed();
  }
  /** 自动接线：拆掉不需要的导线，补上缺少的（list: [[a,b],...]） */
  async rewire(list) {
    const app = this.app;
    const key = (a, b) => [a, b].sort().join('|');
    const want = new Set(list.map(([a, b]) => key(a, b)));
    for (const w of [...this.wires]) if (!want.has(key(w.a, w.b))) { this.disconnect(w); await app.wait(60); }
    for (const [a, b] of list) if (!this.wires.some((w) => key(w.a, w.b) === key(a, b))) { this.connect(a, b); await app.wait(160); }
  }
  /** 等待指针稳定 */
  async settle(meters, ms = 4000) {
    const ok = () => meters.every((m) => !m.comp.placed || (Math.abs(m.vel) < 0.002 && Math.abs(m.theta - clamp(m.target, m.center ? -0.53 : -0.03, m.center ? 0.53 : 1.07)) < 0.0015));
    const t0 = performance.now();
    while (!ok() && performance.now() - t0 < ms) await this.app.wait(40, true);
  }
  /** 两个接线柱之间的电压 */
  V(a, b) { const s = this.sol; return s ? s.v(a) - s.v(b) : 0; }
}

// ============================ 仪器 ============================
/** 指针式电表（多量程，公共端 + 各量程端） */
export function analogMeter({ key, name, short, kind = 'A', ranges, divs = 150, cls = 0.5, center = false, defaultSlot, ohmPerV = 1000, perDiv = null, Rg = 0, desc = '', nonlin = 0, nonlin2 = 0, unit = null }) {
  const W = 15, D = 12, Hh = 5;
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(W, Hh, D), MAT.paint(0x2a2f2c), 0, Hh / 2, 0));
  // 表盘（倾斜面板）
  const face = new THREE.Group(); face.position.set(0, Hh + 0.02, -1.2); face.rotation.x = -Math.PI / 2;
  const dialTex = canvasTexture(512, 300, (ctx, w, h) => drawDialFace(ctx, 0, 0, w, h, { kind, divs, center, cls, unit: unit || (kind === 'A' ? 'mA' : kind === 'V' ? 'V' : 'G') }));
  const dial = new THREE.Mesh(new THREE.PlaneGeometry(W - 1.2, (W - 1.2) * 300 / 512), new THREE.MeshStandardMaterial({ map: dialTex, roughness: 0.5 }));
  dial.userData.noHL = true; face.add(dial);
  const pivot = new THREE.Group(); pivot.position.set(0, -((W - 1.2) * 300) / 512 / 2 + 0.9, 0.05);
  const needle = mesh(new THREE.BoxGeometry(0.08, 6.0, 0.03), new THREE.MeshBasicMaterial({ color: 0x111111 }), 0, 3.0, 0.02);
  needle.userData.noHL = true; pivot.add(needle); face.add(pivot);
  g.add(face);
  // 接线柱标签
  const names = center ? ['+', '-'] : ['com', ...ranges.map((_, i) => 'r' + i)];
  const n = names.length;
  const xs = names.map((_, i) => -W / 2 + 1.6 + (i * (W - 3.2)) / Math.max(1, n - 1));
  const lab = panelMesh(W, 2.2, (ctx, w, h) => {
    ctx.fillStyle = '#2a2f2c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8e4d8'; ctx.font = `bold ${h * 0.5}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    names.forEach((nm, i) => ctx.fillText(nm === 'com' ? '−' : center ? nm : ranges[i - 1].label, ((xs[i] + W / 2) / W) * w, h / 2));
  });
  lab.rotation.x = -Math.PI / 2; lab.position.set(0, Hh + 0.03, D / 2 - 3.6); g.add(lab);
  const terms = {};
  names.forEach((nm, i) => (terms[nm] = { pos: new THREE.Vector3(xs[i], Hh, D / 2 - 1.7), color: nm === 'com' || nm === '-' ? 0x1b1b1b : 0xb91c1c, label: nm === 'com' ? '−' : center ? nm : ranges[i - 1].label }));
  const gain = 1 + (rand(-1, 1) * cls * 0.6) / 100; // 示值误差（固定）
  const dev = {
    key, short: short || name, kind, ranges, divs, center, cls, gain, terms,
    theta: 0, vel: 0, target: 0, over: false, rev: false, rangeIdx: -1,
    Rof: (k) => (kind === 'V' ? ranges[k].full * ohmPerV : ranges[k].R),
    elements(t) {
      if (center) return [{ type: 'R', a: t('+'), b: t('-'), R: Rg, tag: 'g' }];
      return ranges.map((r, k) => ({ type: 'R', a: t('r' + k), b: t('com'), R: this.Rof(k), tag: k }));
    },
    after(sol, t, els) {
      let defl = 0, best = -1, bi = 0;
      if (center) { const I = sol.cur(els[0]); defl = I / perDiv / divs; this.I = I; }
      else {
        els.filter((e) => e.type === 'R' && e.tag != null && e.a !== e.b).forEach((e) => {
          const I = sol.cur(e), full = kind === 'V' ? ranges[e.tag].full / this.Rof(e.tag) : ranges[e.tag].full;
          defl += I / full;
          if (Math.abs(I) > best) { best = Math.abs(I); bi = e.tag; }
        });
        this.I = defl;
      }
      const wiredRanges = center ? [0] : ranges.map((_, k) => k).filter((k) => app_wired(t('r' + k)));
      this.rangeIdx = center ? 0 : wiredRanges.length === 1 ? wiredRanges[0] : best > 1e-12 ? bi : wiredRanges[0] ?? -1;
      { const x = clamp(defl, 0, 1); this.target = defl * gain + nonlin * Math.sin(Math.PI * x) + nonlin2 * Math.sin(2 * Math.PI * x); }
      this.over = center ? Math.abs(this.target) > 1.05 * 0.5 : this.target > 1.04;
      this.rev = !center && this.target < -0.02;
    },
    tick(dt) {
      const lim = center ? [-0.53, 0.53] : [-0.03, 1.07];
      const tg = clamp(this.target, lim[0], lim[1]);
      const w = 2 * Math.PI * (center ? 0.9 : 2.2), z = center ? 0.35 : 0.75;
      const h = Math.min(dt, 0.05);
      for (let s = 0; s < 4; s++) { const a = w * w * (tg - this.theta) - 2 * z * w * this.vel; this.vel += (a * h) / 4; this.theta += (this.vel * h) / 4; }
      if (this.theta < lim[0]) { this.theta = lim[0]; this.vel = 0; } if (this.theta > lim[1]) { this.theta = lim[1]; this.vel = 0; }
      pivot.rotation.z = -dialAngle(this.theta, center);
      return Math.abs(this.vel) > 1e-4 || Math.abs(tg - this.theta) > 1e-4;
    },
    /** 当前读数：{div 格数, value 物理量(按所接量程), range} */
    read() {
      const div = this.theta * divs;
      if (center) return { div, value: div };
      const r = ranges[this.rangeIdx];
      return { div, value: r ? (div / divs) * r.full : NaN, range: r };
    },
  };
  let app_wired = () => false;
  dev.bindCircuit = (cir) => (app_wired = (id) => cir.wired(id));
  dev.comp = new Component({ key, name, icon: METER_ICON, zone: 'slot', defaultSlot, object: g, labelY: 10, desc });
  return dev;
}
const METER_ICON = '<svg viewBox="0 0 64 40"><rect x="8" y="4" width="48" height="32" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 26a18 18 0 0 1 36 0" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M32 30L40 12" stroke="#c41e3a" stroke-width="1.6"/></svg>';


/** 直流稳压电源（恒压/限流） */
export function dcSupply({ key = 'supply', name = '直流稳压电源', defaultSlot, vmax = 15, imax = 1 }) {
  const W = 20, D = 14, Hh = 9;
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(W, Hh, D), MAT.paint(0xc9c4b8), 0, Hh / 2, 0));
  const cv = document.createElement('canvas'); cv.width = 480; cv.height = 210;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, Hh - 1), new THREE.MeshBasicMaterial({ map: tex }));
  panel.position.set(0, Hh / 2, D / 2 + 0.02); panel.userData.noHL = true; g.add(panel);
  const knobs = [];
  for (const x of [-4, 1]) { const k = mesh(new THREE.CylinderGeometry(1, 1.1, 1.2, 20), MAT.black(), x, 2.0, D / 2 + 0.6); k.rotation.x = Math.PI / 2; g.add(k); knobs.push(k); }
  const dev = {
    key, short: '电源', Vset: 0, Ilim: 0.3, on: false, vout: 0, iout: 0, cc: false,
    terms: { '+': { pos: new THREE.Vector3(6, 0, D / 2 + 0.2), color: 0xb91c1c, label: '+' }, '-': { pos: new THREE.Vector3(8.5, 0, D / 2 + 0.2), color: 0x1b1b1b, label: '−' } },
    elements(t) { return this.on ? [{ type: 'V', a: t('+'), b: t('-'), E: this.Vset, r: 0.005, ilim: this.Ilim, tag: 'v' }] : []; },
    after(sol, t, els) {
      this.vout = this.on ? sol.v(t('+')) - sol.v(t('-')) : 0;
      const e = els.find((x) => x.tag === 'v');
      this.cc = !!(e && e.cc);
      this.iout = e ? (e.cc ? Math.abs(e.I) : -sol.cur(e)) : 0;
      draw();
    },
  };
  const draw = () => {
    const c = cv.getContext('2d');
    c.fillStyle = '#c9c4b8'; c.fillRect(0, 0, 480, 210);
    c.fillStyle = '#1f2937'; c.font = 'bold 20px "Microsoft YaHei"'; c.fillText('直流稳压电源  0–' + vmax + ' V / ' + imax + ' A', 14, 26);
    for (const [i, txt, unit] of [[0, dev.on ? Math.max(0, dev.vout).toFixed(2) : '----', 'V'], [1, dev.on ? Math.max(0, dev.iout).toFixed(3) : '----', 'A']]) {
      const x = 14 + i * 232; c.fillStyle = '#0a1a10'; c.fillRect(x, 40, 214, 70);
      c.fillStyle = '#5eea8c'; c.font = 'bold 48px Consolas, monospace'; c.textAlign = 'right'; c.fillText(txt, x + 176, 94);
      c.font = 'bold 22px Consolas'; c.textAlign = 'left'; c.fillText(unit, x + 182, 94);
    }
    c.fillStyle = dev.cc ? '#ef4444' : '#3f3f3f'; c.beginPath(); c.arc(30, 140, 7, 0, 7); c.fill();
    c.fillStyle = '#1f2937'; c.font = '16px "Microsoft YaHei"'; c.fillText('CC 限流', 44, 146);
    c.fillText('电压', 110, 196); c.fillText('限流', 225, 196);
    c.fillStyle = dev.on ? '#22c55e' : '#3f3f3f'; c.beginPath(); c.arc(330, 140, 7, 0, 7); c.fill();
    c.fillStyle = '#1f2937'; c.fillText('输出', 344, 146);
    tex.needsUpdate = true;
  };
  draw();
  dev.comp = new Component({
    key, name, icon: SUPPLY_ICON, zone: 'slot', defaultSlot, object: g, labelY: 14,
    desc: `输出 0–${vmax} V 连续可调，可设限流值；电流超过限流值时自动转为恒流输出（CC 灯亮），可防止短路烧坏仪器。`,
    controls: () => [
      { type: 'toggle', label: '输出开关', get: () => dev.on, set: (v) => (dev.on = v) },
      { type: 'knob', label: '电压调节', get: () => dev.Vset, set: (v) => { dev.Vset = clamp(v, 0, vmax); knobs[0].rotation.y = -dev.Vset / vmax * 5; }, min: 0, max: vmax, step: 0.01, bigStep: 0.5, perRev: 3, digits: 2, unit: 'V' },
      { type: 'knob', label: '限流调节', get: () => dev.Ilim, set: (v) => { dev.Ilim = clamp(v, 0.005, imax); knobs[1].rotation.y = -dev.Ilim / imax * 5; }, min: 0.005, max: imax, step: 0.005, bigStep: 0.05, perRev: 0.5, digits: 3, unit: 'A' },
      { type: 'readout', label: '面板显示', get: () => (dev.on ? `${dev.vout.toFixed(2)} V  ${dev.iout.toFixed(3)} A${dev.cc ? '  CC' : ''}` : '关') },
    ],
  });
  return dev;
}
const SUPPLY_ICON = '<svg viewBox="0 0 64 40"><rect x="6" y="6" width="52" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="11" y="11" width="20" height="9" fill="none" stroke="currentColor"/><circle cx="16" cy="27" r="3" fill="none" stroke="currentColor"/><circle cx="44" cy="27" r="2" fill="#c41e3a"/><circle cx="51" cy="27" r="2" fill="currentColor"/></svg>';

/** 滑线变阻器 */
export function rheostat({ key = 'rheo', name, R = 100, Imax = 1.5, defaultSlot }) {
  const L = 26;
  const g = new THREE.Group();
  for (const x of [-L / 2 - 1, L / 2 + 1]) g.add(mesh(new THREE.BoxGeometry(1.2, 7, 5), MAT.paint(0x2c3e50), x, 3.5, 0));
  const coil = mesh(new THREE.CylinderGeometry(2.2, 2.2, L, 32), new THREE.MeshStandardMaterial({ map: canvasTexture(64, 512, (c, w, h) => { c.fillStyle = '#d9c9a0'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7a5a2a'; for (let y = 0; y < h; y += 3) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y + 1.5); c.stroke(); } }), roughness: 0.5, metalness: 0.4 }), 0, 3.8, 0);
  coil.rotation.z = Math.PI / 2; g.add(coil);
  const bar = mesh(new THREE.BoxGeometry(L + 2, 0.5, 0.6), MAT.alu(), 0, 7.4, 0); g.add(bar);
  const slider = new THREE.Group(); slider.add(mesh(new THREE.BoxGeometry(2, 1.4, 2), MAT.black(), 0, 7.4, 0)); slider.add(mesh(new THREE.BoxGeometry(0.4, 2.4, 0.4), MAT.brass(), 0, 5.6, 0));
  g.add(slider);
  const dev = {
    key, short: name || '变阻器', R, s: 0.5,
    terms: { A: { pos: new THREE.Vector3(-L / 2 - 1, 0.5, 3.6), label: 'A' }, B: { pos: new THREE.Vector3(L / 2 + 1, 0.5, 3.6), label: 'B' }, C: { pos: new THREE.Vector3(L / 2 + 1, 7.6, 0), label: 'C（滑动端）', color: 0xd4a017 } },
    elements(t) { return [{ type: 'R', a: t('A'), b: t('_s'), R: Math.max(0.05, this.s * R), tag: 'ac' }, { type: 'R', a: t('_s'), b: t('B'), R: Math.max(0.05, (1 - this.s) * R), tag: 'cb' }, { type: 'R', a: t('_s'), b: t('C'), R: 0.05 + 0.05 * this.s, tag: 'c' }]; },
    after(sol, t, els) {
      slider.position.x = -L / 2 + this.s * L;
      const I = Math.max(...els.filter((e) => e.tag === 'ac' || e.tag === 'cb').map((e) => Math.abs(sol.cur(e))));
      this.hot = I > Imax;
    },
  };
  dev.comp = new Component({
    key, name: name || `滑线变阻器 ${R} Ω / ${Imax} A`, icon: RHEO_ICON, zone: 'slot', defaultSlot, object: g, labelY: 12,
    desc: `全电阻 ${R} Ω，额定电流 ${Imax} A。A、B 为两端，C 为滑动端。可接成限流电路或分压电路。`,
    controls: () => [{ type: 'slider', label: '滑动端位置（A → B）', get: () => dev.s, set: (v) => (dev.s = clamp(v, 0, 1)), min: 0, max: 1, step: 0.001, digits: 3, unit: '' }],
  });
  return dev;
}
const RHEO_ICON = '<svg viewBox="0 0 64 40"><rect x="8" y="16" width="48" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 10h52M30 10v6" stroke="currentColor" stroke-width="1.6"/><rect x="26" y="6" width="8" height="6" fill="currentColor"/></svg>';

/** 旋转式电阻箱（ZX21 型，六个十进盘） */
export function resistanceBox({ key = 'rbox', name = '电阻箱', defaultSlot, cls = 0.1 }) {
  const W = 22, D = 14, Hh = 6;
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(W, Hh, D), MAT.paint(0x1f2a24), 0, Hh / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(W + 0.4, 0.6, D + 0.4), MAT.paint(0x3a2a1a), 0, Hh + 0.3, 0));
  const mult = [10000, 1000, 100, 10, 1, 0.1];
  const dials = [];
  const dialTex = canvasTexture(128, 128, (c, w) => {
    c.fillStyle = '#1a1a1a'; c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, 7); c.fill();
    c.fillStyle = '#eee'; c.font = 'bold 15px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; c.fillText(String(i), w / 2 + Math.cos(a) * w * 0.38, w / 2 + Math.sin(a) * w * 0.38); }
    c.fillStyle = '#c41e3a'; c.fillRect(w / 2 - 2, w * 0.06, 4, w * 0.16);
  });
  mult.forEach((m, i) => {
    const x = -W / 2 + 3.2 + (i % 3) * 7.8, z = -D / 2 + 3.6 + Math.floor(i / 3) * 6.2;
    const d = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.7, 32), [MAT.black(), new THREE.MeshStandardMaterial({ map: dialTex, roughness: 0.5 }), MAT.black()]);
    d.position.set(x, Hh + 0.95, z); g.add(d); dials.push(d);
    const lab = panelMesh(4, 1, (c, w, h) => { c.fillStyle = '#3a2a1a'; c.fillRect(0, 0, w, h); c.fillStyle = '#f0e6c8'; c.font = `bold ${h * 0.7}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('×' + m, w / 2, h / 2); });
    lab.rotation.x = -Math.PI / 2; lab.position.set(x, Hh + 0.62, z + 2.9); g.add(lab);
  });
  const err = 1 + (rand(-1, 1) * cls * 0.5) / 100;
  const dev = {
    key, short: name, d: [0, 0, 0, 0, 0, 0], residual: 0.02,
    terms: { a: { pos: new THREE.Vector3(W / 2 - 5, Hh + 0.6, D / 2 - 1.6), label: '0', color: 0x1b1b1b }, b: { pos: new THREE.Vector3(W / 2 - 1.8, Hh + 0.6, D / 2 - 1.6), label: '99999.9 Ω' } },
    nominal() { return this.d.reduce((s, v, i) => s + v * mult[i], 0); },
    value() { return this.nominal() * err + this.residual; },
    set(R) { let r = Math.round(R * 10); for (let i = 5; i >= 0; i--) { this.d[i] = r % 10; r = Math.floor(r / 10); } this.d[0] += r * 10; this.d[0] = Math.min(9, this.d[0]); },
    elements(t) { return [{ type: 'R', a: t('a'), b: t('b'), R: this.value() }]; },
    after() { dials.forEach((m, i) => (m.rotation.y = -(this.d[i] / 10) * Math.PI * 2)); },
  };
  dev.comp = new Component({
    key, name, icon: RBOX_ICON, zone: 'slot', defaultSlot, object: g, labelY: 12,
    desc: `六个十进盘，0–99999.9 Ω，准确度 ${cls} 级，零电阻（残余电阻）约 0.02 Ω。`,
    controls: () => [
      { type: 'readout', label: '示值', get: () => `${dev.nominal().toFixed(1)} Ω` },
      ...mult.map((m, i) => ({ type: 'knob', label: `×${m}`, get: () => dev.d[i], set: (v) => (dev.d[i] = ((Math.round(v) % 10) + 10) % 10), min: 0, max: 9, step: 1, bigStep: 1, perRev: 10, digits: 0, wrap: true, unit: '' })),
    ],
  });
  return dev;
}
const RBOX_ICON = '<svg viewBox="0 0 64 40"><rect x="6" y="6" width="52" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="15" r="5" fill="none" stroke="currentColor"/><circle cx="32" cy="15" r="5" fill="none" stroke="currentColor"/><circle cx="46" cy="15" r="5" fill="none" stroke="currentColor"/><circle cx="18" cy="27" r="4" fill="none" stroke="currentColor"/><circle cx="32" cy="27" r="4" fill="none" stroke="currentColor"/><circle cx="46" cy="27" r="4" fill="none" stroke="currentColor"/></svg>';

/** 单刀开关 */
export function knifeSwitch({ key = 'sw', name = '开关', defaultSlot }) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(10, 1.2, 5), MAT.paint(0x8b5a2b), 0, 0.6, 0));
  const blade = new THREE.Group(); blade.position.set(-3, 2.2, 0);
  blade.add(mesh(new THREE.BoxGeometry(6.4, 0.25, 0.7), MAT.brass(), 3.2, 0, 0));
  blade.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 2, 10), MAT.black(), 6.2, 1, 0));
  g.add(blade);
  for (const x of [-3, 3.3]) g.add(mesh(new THREE.BoxGeometry(0.8, 1.6, 1), MAT.brass(), x, 1.6, 0));
  const dev = {
    key, short: name, closed: false,
    terms: { a: { pos: new THREE.Vector3(-4, 1.2, 1.4), label: 'a', color: 0x1b1b1b }, b: { pos: new THREE.Vector3(4, 1.2, 1.4), label: 'b', color: 0x1b1b1b } },
    elements(t) { return this.closed ? [{ type: 'R', a: t('a'), b: t('b'), R: 0.003 }] : []; },
    after() { blade.rotation.z = this.closed ? 0 : 1.05; },
  };
  dev.comp = new Component({ key, name, icon: SW_ICON, zone: 'slot', defaultSlot, object: g, labelY: 8, desc: '单刀单掷闸刀开关。', controls: () => [{ type: 'toggle', label: '合上开关', get: () => dev.closed, set: (v) => (dev.closed = v) }] });
  return dev;
}
const SW_ICON = '<svg viewBox="0 0 64 40"><circle cx="12" cy="28" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="52" cy="28" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 27L46 12" stroke="currentColor" stroke-width="2"/></svg>';

/** 两端元件板（电阻、二极管等），元件由 elements 自定义 */
export function partBoard({ key, name, short, defaultSlot, label, symbol = 'R', terms = { a: '1', b: '2' }, elements, desc = '', pol = false }) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(10, 1, 6), MAT.paint(0x1d3b2a), 0, 0.5, 0));
  const lab = panelMesh(10, 6, (c, w, h) => {
    c.fillStyle = '#1d3b2a'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e8e4d8'; c.fillStyle = '#e8e4d8'; c.lineWidth = h * 0.03;
    c.beginPath(); c.moveTo(w * 0.12, h * 0.68); c.lineTo(w * 0.33, h * 0.68); c.moveTo(w * 0.67, h * 0.68); c.lineTo(w * 0.88, h * 0.68); c.stroke();
    if (symbol === 'D') { c.beginPath(); c.moveTo(w * 0.36, h * 0.52); c.lineTo(w * 0.36, h * 0.84); c.lineTo(w * 0.62, h * 0.68); c.closePath(); c.fill(); c.fillRect(w * 0.62, h * 0.52, w * 0.025, h * 0.32); c.beginPath(); c.moveTo(w * 0.33, h * 0.68); c.lineTo(w * 0.67, h * 0.68); c.stroke(); }
    else c.strokeRect(w * 0.33, h * 0.6, w * 0.34, h * 0.16);
    c.font = `bold ${h * 0.2}px "Microsoft YaHei", Arial`; c.textAlign = 'center'; c.fillText(label, w / 2, h * 0.3);
    if (pol) { c.font = `bold ${h * 0.2}px Arial`; c.fillText('+', w * 0.12, h * 0.4); c.fillText('−', w * 0.88, h * 0.4); }
  });
  lab.rotation.x = -Math.PI / 2; lab.position.y = 1.02; g.add(lab);
  const dev = {
    key, short: short || name,
    terms: { a: { pos: new THREE.Vector3(-3.8, 1, 1.6), label: terms.a, color: pol ? 0xb91c1c : 0x1b1b1b }, b: { pos: new THREE.Vector3(3.8, 1, 1.6), label: terms.b, color: 0x1b1b1b } },
    elements,
  };
  dev.comp = new Component({ key, name, icon: SW_ICON.replace('M14 27L46 12', 'M15 28h10M39 28h10M25 23h14v10H25z'), zone: 'slot', defaultSlot, object: g, labelY: 7, desc });
  return dev;
}
