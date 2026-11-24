// 光路追迹与光束显示
// 每束光用“中心光线 + 高斯光束半径 + 发散半角”描述（傍轴近似），在三维空间里与各光学元件求交：
// 反射镜、分束镜、薄透镜、扩束镜（显微物镜）、光阑/挡板、接收面（屏、干板、探头）、漫反射物体（球）。
// 结果给出：每段光束（用于三维显示）和每个元件上的入射记录（位置、光斑半径、功率、入射角、光程）。
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const EPS = 1e-4;

/**
 * 元件描述（世界坐标）：
 *  { id, kind: 'mirror'|'splitter'|'lens'|'expander'|'stop'|'target'|'sphere'|'gate',
 *    c: Vector3 中心, n: Vector3 法线（单位）, R: 通光半径, rect: [半宽, 半高] 可选（矩形，u 轴为水平切向）,
 *    refl: 反射率, R_bs: 分束镜反射比, f: 焦距, div: 扩束后发散半角, open: gate 是否放行, axisTol: 扩束镜允许的入射角 }
 */
export class OptBench {
  constructor() { this.elems = []; this.maxDepth = 14; this.maxLen = 400; this.minP = 1e-6; }
  clear() { this.elems.length = 0; }
  add(e) { this.elems.push(e); return e; }

  /** 由组件根节点的世界变换得到元件位置与法线（局部坐标给出） */
  static pose(root, local = V(), normal = V(1, 0, 0)) {
    root.updateWorldMatrix(true, false);
    const c = local.clone().applyMatrix4(root.matrixWorld);
    const q = new THREE.Quaternion(); root.getWorldQuaternion(q);
    const n = normal.clone().applyQuaternion(q).normalize();
    return { c, n };
  }

  intersect(e, p, u) {
    if (e.kind === 'sphere') {
      const oc = p.clone().sub(e.c), b = oc.dot(u), cc = oc.lengthSq() - e.R * e.R, disc = b * b - cc;
      if (disc < 0) {
        // 未击中球面：返回最近点，用于部分照明
        const t = -b; if (t <= EPS) return null;
        const q = p.clone().addScaledVector(u, t);
        return { t, q, rho: q.distanceTo(e.c), inside: false };
      }
      const t = -b - Math.sqrt(disc);
      if (t <= EPS) return null;
      const q = p.clone().addScaledVector(u, t);
      return { t, q, rho: Math.sqrt(Math.max(0, cc + e.R * e.R - b * b)), inside: true };
    }
    const den = u.dot(e.n);
    if (Math.abs(den) < 1e-6) return null;
    const t = e.c.clone().sub(p).dot(e.n) / den;
    if (t <= EPS) return null;
    const q = p.clone().addScaledVector(u, t);
    const d = q.clone().sub(e.c);
    let rho, inside;
    if (e.rect) {
      const tu = this.tangent(e), tv = e.n.clone().cross(tu).normalize();
      const a = d.dot(tu), b = d.dot(tv);
      inside = Math.abs(a) <= e.rect[0] && Math.abs(b) <= e.rect[1];
      rho = Math.hypot(Math.max(0, Math.abs(a) - e.rect[0] * 0.999), Math.max(0, Math.abs(b) - e.rect[1] * 0.999));
      return { t, q, rho, inside, a, b, den };
    }
    rho = d.length();
    inside = rho <= e.R;
    return { t, q, rho, inside, den };
  }
  tangent(e) {
    const up = V(0, 1, 0);
    const tu = up.clone().cross(e.n);
    if (tu.lengthSq() < 1e-8) tu.set(1, 0, 0);
    return tu.normalize();
  }
  /** 高斯光束被半径 R 的圆孔截取的功率比例（光斑中心偏离孔中心 rho） */
  static frac(w, R, rho) {
    w = Math.max(w, 1e-4);
    return (1 - Math.exp((-2 * R * R) / (w * w))) * Math.exp((-2 * rho * rho) / (w * w + R * R));
  }

  /**
   * 追迹。sources: [{ p, u, P, w, th, color, tag }]
   * 返回 { segs: [{a,b,w0,w1,P,color}], hits: Map(id → [{q, rho, w, P, cos, L, u, beam}]) }
   */
  trace(sources) {
    const segs = [], hits = new Map();
    const rec = (id, h) => { if (!hits.has(id)) hits.set(id, []); hits.get(id).push(h); };
    const stack = sources.map((s) => ({ p: s.p.clone(), u: s.u.clone().normalize(), P: s.P, w: s.w ?? 0.05, th: s.th ?? 0.0005, L: 0, color: s.color ?? 0xff2020, tag: s.tag || '', depth: 0, skip: null }));
    let guard = 0;
    while (stack.length && guard++ < 400) {
      const b = stack.pop();
      if (b.P < this.minP || b.depth > this.maxDepth) continue;
      // 最近交点
      let best = null;
      for (const e of this.elems) {
        if (e === b.skip || e.disabled) continue;
        const x = this.intersect(e, b.p, b.u);
        if (!x || x.t > this.maxLen) continue;
        const w = b.w + b.th * x.t;
        // 远离通光口径（大于 3 倍光斑）的元件不影响光束
        const R = e.rect ? Math.hypot(e.rect[0], e.rect[1]) : e.R;
        if (x.rho > R + 2.5 * w && !x.inside) continue;
        if (!best || x.t < best.x.t) best = { e, x };
      }
      const L = best ? best.x.t : this.maxLen;
      const w1 = Math.max(0, b.w + b.th * L);
      segs.push({ a: b.p.clone(), b: b.p.clone().addScaledVector(b.u, L), w0: b.w, w1, P: b.P, color: b.color, tag: b.tag });
      if (!best) continue;
      const { e, x } = best;
      const R = e.rect ? Math.min(e.rect[0], e.rect[1]) : e.R;
      let f = e.rect ? (x.inside ? 1 - Math.exp((-2 * Math.min(e.rect[0] - Math.abs(x.a), e.rect[1] - Math.abs(x.b)) ** 2) / (w1 * w1 + 1e-9)) : 0) : OptBench.frac(w1, R, x.rho);
      if (e.kind === 'sphere') f = OptBench.frac(w1, e.R, x.rho);
      f = Math.max(0, Math.min(1, f));
      const Lh = b.L + x.t;
      const cos = e.kind === 'sphere' ? 1 : Math.abs(b.u.dot(e.n));
      // 未被截取的部分继续前进（越过元件边缘）
      if (f < 0.999) stack.push({ ...b, p: x.q.clone(), P: b.P * (1 - f), w: w1, L: Lh, depth: b.depth + 1, skip: e });
      const Pin = b.P * f;
      if (Pin < this.minP) continue;
      const hit = { q: x.q, rho: x.rho, w: w1, P: Pin, cos, L: Lh, u: b.u.clone(), tag: b.tag, a: x.a, b: x.b, e };
      rec(e.id, hit);
      const next = (u, P, extra = {}) => stack.push({ ...b, p: x.q.clone(), u: u.clone().normalize(), P, w: w1, L: Lh, depth: b.depth + 1, skip: e, ...extra });
      const reflect = () => b.u.clone().addScaledVector(e.n, -2 * b.u.dot(e.n));
      switch (e.kind) {
        case 'mirror': next(reflect(), Pin * (e.refl ?? 0.95)); break;
        case 'splitter': {
          const r = e.R_bs ?? 0.5, loss = e.loss ?? 0.04;
          next(reflect(), Pin * r * (1 - loss), { tag: b.tag + 'r' });
          next(b.u, Pin * (1 - r) * (1 - loss), { tag: b.tag + 't' });
          break;
        }
        case 'lens': {
          // 薄透镜：偏离中心 h 处的光线偏折 −h/f；发散角 θ' = θ − w/f
          const h = x.q.clone().sub(e.c); h.addScaledVector(e.n, -h.dot(e.n));
          const u2 = b.u.clone().addScaledVector(h, -1 / e.f);
          next(u2, Pin * (e.T ?? 0.96), { th: b.th - w1 / e.f });
          break;
        }
        case 'expander': {
          // 显微物镜：入射方向须接近光轴；出射为以焦点为顶点的发散光锥
          const axis = e.n.clone().multiplyScalar(Math.sign(b.u.dot(e.n)) || 1);
          const ang = Math.acos(Math.min(1, Math.abs(b.u.dot(e.n))));
          const tol = e.axisTol ?? 0.06;
          const k = Math.exp(-((ang / tol) ** 2)) * Math.exp((-2 * x.rho * x.rho) / (e.R * e.R));
          hit.aim = { ang, k };
          const out = b.u.clone().lerp(axis, 0.85).normalize();
          const focus = x.q.clone().addScaledVector(out, e.fe ?? 0.4);
          if (k > 1e-4) stack.push({ ...b, p: focus, u: out, P: Pin * k * (e.T ?? 0.9), w: 0.02, th: e.div ?? 0.06, L: Lh + (e.fe ?? 0.4), depth: b.depth + 1, skip: e });
          break;
        }
        case 'gate': if (e.open) next(b.u, Pin); break;
        case 'filter': next(b.u, Pin * (e.T ?? 1)); break;
        case 'target': if (e.pass) next(b.u, Pin * e.pass); break;
        default: break; // stop / sphere：吸收（漫反射由实验自行计算）
      }
    }
    return { segs, hits };
  }
}

/** 光束绘制：截头光锥 + 落在元件表面的光斑 */
export class BeamDraw {
  constructor(scene, { max = 40 } = {}) {
    this.scene = scene; this.pool = []; this.spots = []; this.max = max;
    this.group = new THREE.Group(); this.group.renderOrder = 5; scene.add(this.group);
    const geo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); geo.translate(0, 0.5, 0);
    this.geo0 = geo;
    this.spotTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); return t;
    })();
    this.visibility = 1; // 室内灯光暗时光束更显眼
  }
  cone(i) {
    if (!this.pool[i]) {
      const geo = this.geo0.clone(); const base = Float32Array.from(geo.attributes.position.array);
      const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      halo.scale.set(1, 1, 1);
      const g = new THREE.Group(); g.add(core);
      core.renderOrder = 5;
      this.group.add(g);
      this.pool[i] = { g, core, geo, base, halo };
    }
    return this.pool[i];
  }
  spot(i) {
    if (!this.spots[i]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.spotTex, color: 0xff3030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 6; this.group.add(m); this.spots[i] = m;
    }
    return this.spots[i];
  }
  /** P0：光源功率，用于把光强归一化成亮度 */
  draw(res, P0 = 1) {
    let n = 0, ns = 0;
    const segs = res ? res.segs : [];
    for (const s of segs) {
      if (n >= this.max) break;
      const d = s.b.clone().sub(s.a), L = d.length();
      if (L < 1e-3 || s.P < P0 * 1e-4) continue;
      const c = this.cone(n++);
      // 细光束：保证最小可见半径；扩束后的光锥：半径随距离变化，亮度随面积下降
      const r0 = Math.max(0.06, s.w0), r1 = Math.max(0.06, s.w1);
      const p = c.geo.attributes.position.array, base = c.base;
      for (let i = 0; i < p.length; i += 3) { const r = base[i + 1] > 0.5 ? r1 : r0; p[i] = base[i] * r; p[i + 1] = base[i + 1] * L; p[i + 2] = base[i + 2] * r; }
      c.geo.attributes.position.needsUpdate = true; c.geo.computeBoundingSphere();
      c.g.position.copy(s.a); c.g.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
      const rm = Math.max(0.15, (r0 + r1) / 2);
      const k = Math.min(1, Math.sqrt(s.P / P0)) * Math.min(1, 0.25 / rm + 0.08);
      c.core.material.color.set(s.color);
      c.core.material.opacity = Math.min(0.85, 0.85 * k * this.visibility + 0.02);
      c.g.visible = true;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].g.visible = false;
    // 光斑
    if (res) for (const [, hs] of res.hits) for (const h of hs) {
      if (ns >= 60 || h.P < P0 * 2e-4 || !h.e || h.e.kind === 'sphere' || h.e.noSpot) continue;
      const m = this.spot(ns++);
      const r = Math.max(0.35, h.w * 2.2);
      m.scale.set(r, r, 1);
      m.position.copy(h.q).addScaledVector(h.e.n, -0.05 * Math.sign(h.u.dot(h.e.n)));
      m.quaternion.setFromUnitVectors(V(0, 0, 1), h.e.n);
      m.material.opacity = Math.min(1, 0.25 + 0.9 * Math.sqrt(h.P / P0) * Math.min(1, 0.6 / Math.max(0.3, h.w)));
      m.visible = true;
    }
    for (let i = ns; i < this.spots.length; i++) this.spots[i].visible = false;
  }
  hide() { this.draw(null); }
}
