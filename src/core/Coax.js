// 光具座上的“等高共轴”调节。
// “自己摆”模式下，放到导轨上的每个光学元件，光心相对光轴都有高度、横向偏差和绕竖直轴的转角，
// 需要学生用升降杆、横向平移台和转盘调到共轴；“自动对准”或一键运行时偏差为零。
//
// 物理效果：沿导轨追踪光束中心线。光束是高斯光束（半径 w，发散角 div），
// 每个元件的通光孔按矩形处理（半宽 ay、az），透过率按高斯光束被矩形孔截取的比例计算：
//   T = Ty·Tz，Tu = ½[erf(√2(a−u)/w) + erf(√2(a+u)/w)]，u 为光束中心相对孔中心的偏离。
// 透过率都以“完全共轴时”为 1 归一（元件本身在共轴时的损耗已含在各实验的光强公式里）。
// 光源（以及作为次级光源的狭缝等）的转角使出射光束偏离导轨方向：横向斜率 tan(转角)。
// 实验代码用 T(key) 取得到达某元件（含其自身孔径）后的相对光强，用 off(key) 取光斑相对元件中心的偏离。
import * as THREE from 'three';

function erf(x) { // Abramowitz–Stegun 7.1.26，误差 < 1.5e-7
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
/** 高斯光束（1/e² 半径 w）中心偏离 u 时通过半宽 a 的狭带的比例 */
export function bandFrac(a, u, w) {
  if (!isFinite(a)) return 1;
  const k = Math.SQRT2 / Math.max(1e-6, w);
  return Math.max(0, 0.5 * (erf(k * (a - u)) + erf(k * (a + u))));
}
/** 相对共轴时的透过率 */
const relFrac = (a, u, w) => (isFinite(a) ? bandFrac(a, u, w) / Math.max(1e-12, bandFrac(a, 0, w)) : 1);

const TOL = { y: 0.08, z: 0.08, yaw: 0.8 }; // cm, cm, 度

export class Coax {
  /**
   * spec = { keys: [...沿光路顺序], beam: { key: { w, div } }（光束从该元件出发或重新出发），
   *          ap: { key: { y, z } }（通光孔半宽 cm）, f: { key: 焦距 cm }（薄透镜）, axes: { key: 含 y/z/a 的字符串 }（有偏差的自由度：高度、横向、转角，默认 'yza'） }
   */
  constructor(app, spec) {
    this.app = app; this.spec = spec;
    this._k = null; this._r = new Map();
  }
  get on() { return this.app.placeFree; }
  has(c) { return !!c && this.spec.keys.includes(c.key); }
  axes(c) { return this.spec.axes?.[c.key] ?? 'yza'; }
  mis(c) { return c.mis || (c.mis = { y: 0, z: 0, yaw: 0 }); }

  /** 单击/拖动放到导轨上时给出随机偏差 */
  randomize(c) {
    const r = (a, b) => (Math.random() < 0.5 ? -1 : 1) * (a + Math.random() * (b - a));
    const ax = this.axes(c), m = this.mis(c);
    m.y = ax.includes('y') ? r(0.25, 0.8) : 0;
    m.z = ax.includes('z') ? r(0.25, 0.8) : 0;
    m.yaw = ax.includes('a') ? r(1.2, 4) : 0;
  }
  zero(c) { const m = this.mis(c); m.y = 0; m.z = 0; m.yaw = 0; }

  /**
   * 把偏差体现在三维模型上（setRailPos 之后调用）。
   * 滑座留在导轨上，只有立杆以上的部分（镜架、元件）升降和横移；转角作用于整个元件。
   * 做法：把高于滑座的部件移入一个“升降组”，平移这个组（部件自身的局部坐标不变，实验代码照常驱动它们）。
   */
  lifts(c) {
    if (c._lifts) return c._lifts;
    const root = c.root, baseH = this.spec.baseH ?? 10; // 滑座（含套管）顶部约 12.8 cm，立杆中心以上的部件随升降杆移动
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const pick = [];
    const walk = (o) => {
      if (o.isSprite || o.userData.label) return;
      const bb = new THREE.Box3().setFromObject(o);
      if (bb.isEmpty()) return;
      bb.applyMatrix4(inv);
      const hi = o.isMesh ? (bb.min.y + bb.max.y) / 2 > baseH : bb.min.y > baseH;
      if (hi && o !== root) { pick.push(o); return; }
      for (const ch of [...o.children]) walk(ch);
    };
    walk(root);
    const groups = new Map();
    for (const o of pick) {
      const P = o.parent;
      let g = groups.get(P);
      if (!g) { g = new THREE.Group(); g.name = 'coax-lift'; P.add(g); groups.set(P, g); }
      P.remove(o); g.add(o);
    }
    return (c._lifts = [...groups.values()]);
  }
  pose(c) {
    if (!this.has(c) || !c.placed) return;
    const m = this.mis(c), z = this.app.zones.find((q) => q.type === 'rail' && q.id === (c.rail || 'rail'));
    if (!z) return;
    if (c._yaw0 === undefined) c._yaw0 = c.root.rotation.y;
    c.root.position.copy(z.origin).addScaledVector(z.dir, c.pos);
    c.root.rotation.y = c._yaw0 + (m.yaw * Math.PI) / 180;
    const lat = new THREE.Vector3().crossVectors(z.dir, new THREE.Vector3(0, 1, 0)).normalize();
    const dW = lat.multiplyScalar(m.z).add(new THREE.Vector3(0, m.y, 0));
    c.root.updateMatrixWorld(true);
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), tp = new THREE.Vector3();
    for (const g of this.lifts(c)) {
      g.parent.matrixWorld.decompose(tp, q, sc);
      const d = dW.clone().applyQuaternion(q.invert());
      g.position.set(d.x / sc.x, d.y / sc.y, d.z / sc.z);
    }
  }

  /** 沿光路追踪：返回 Map(key → { T, oy, oz, w }) */
  trace() {
    const sp = this.spec, list = sp.keys.map((k) => this.app.comp(k)).filter((c) => c && c.placed).sort((a, b) => a.pos - b.pos);
    const key = list.map((c) => { const m = this.mis(c); return `${c.key}:${c.pos.toFixed(2)},${m.y.toFixed(3)},${m.z.toFixed(3)},${m.yaw.toFixed(2)}`; }).join('|');
    if (key === this._k) return this._r;
    this._k = key;
    const out = new Map(), segs = [];
    const rad = (d) => (d * Math.PI) / 180;
    let b = null; // 当前光束段 { x0, y, z, sy, sz, w, div, T }：中心线 y + sy·(x−x0)，z + sz·(x−x0)
    for (const c of list) {
      const m = this.mis(c), bs = sp.beam?.[c.key], ap = sp.ap?.[c.key] || { y: Infinity, z: Infinity }, f = sp.f?.[c.key];
      if (!b) {
        if (!bs) continue; // 光源之前的元件不受光
        b = { x0: c.pos, y: m.y, z: m.z, sy: 0, sz: Math.tan(rad(m.yaw)), w: bs.w, div: bs.div, T: 1 };
        segs.push(b);
        out.set(c.key, { T: 1, oy: 0, oz: 0, w: bs.w });
        continue;
      }
      const D = c.pos - b.x0;
      const by = b.y + b.sy * D, bz = b.z + b.sz * D, w = Math.max(0.005, Math.abs(b.w + b.div * D)); // div < 0：会聚光束，过焦点后再发散
      const oy = by - m.y, oz = bz - m.z;
      // 元件转角使通光孔在横向的投影变窄
      const cz = Math.cos(rad(m.yaw));
      const T = b.T * relFrac(ap.y, oy, w) * relFrac(ap.z * cz, oz, w);
      out.set(c.key, { T, oy, oz, w });
      if (f) {
        // 薄透镜：光束偏离光心 (oy, oz) 时被偏折 −o/f（近轴），焦面上光点位于“透镜光轴 + f·入射角”处
        b = { x0: c.pos, y: by, z: bz, sy: b.sy - oy / f, sz: b.sz - oz / f, w: bs ? bs.w : w, div: bs ? bs.div : b.div, T };
        segs.push(b);
      } else if (bs) {
        // 次级光源（被照亮的狭缝等）：从元件处重新出发，方向沿原光束并叠加元件转角
        b = { x0: c.pos, y: m.y, z: m.z, sy: b.sy, sz: b.sz + Math.tan(rad(m.yaw)), w: bs.w, div: bs.div, T };
        segs.push(b);
      } else b.T = T;
    }
    this._r = out; this._segs = segs;
    return out;
  }
  /** 导轨坐标 x 处光束中心相对导轨光轴的偏离 { y, z }（cm），用于绘制三维光束 */
  at(x) {
    this.trace();
    const sg = this._segs || [];
    let b = sg[0];
    for (const q of sg) if (q.x0 <= x) b = q;
    return b ? { y: b.y + b.sy * (x - b.x0), z: b.z + b.sz * (x - b.x0) } : { y: 0, z: 0 };
  }
  /** 到达并通过元件 key 的相对光强（未放置或不在光路中为 0；未受偏差影响为 1） */
  T(key) { const r = this.trace().get(key); return r ? r.T : 0; }
  /** 光斑中心相对元件 key 中心的偏离 { y, z }（cm） */
  off(key) { const r = this.trace().get(key); return r ? { y: r.oy, z: r.oz } : { y: 0, z: 0 }; }

  /** 已放置元件中偏差最大的一项（用于步骤提示） */
  worst() {
    let best = null;
    for (const k of this.spec.keys) {
      const c = this.app.comp(k);
      if (!c || !c.placed) continue;
      const m = this.mis(c), r = this.trace().get(k);
      const e = Math.max(Math.abs(r ? r.oy : 0) / TOL.y, Math.abs(r ? r.oz : 0) / TOL.z, Math.abs(m.yaw) / TOL.yaw);
      if (!best || e > best.e) best = { c, e, oy: r ? r.oy : 0, oz: r ? r.oz : 0, yaw: m.yaw };
    }
    return best;
  }
  ok() {
    const n = this.spec.keys.filter((k) => this.app.comp(k)?.placed).length;
    if (n < 2) return false;
    const w = this.worst();
    return !w || w.e <= 1;
  }
  status() {
    const w = this.worst();
    if (!w) return '先把器材放到导轨上';
    if (w.e <= 1) return '各元件光心已等高共轴';
    const p = [];
    if (Math.abs(w.oy) > TOL.y) p.push(`高度差 ${(w.oy * 10).toFixed(1)} mm`);
    if (Math.abs(w.oz) > TOL.z) p.push(`横向偏 ${(w.oz * 10).toFixed(1)} mm`);
    if (Math.abs(w.yaw) > TOL.yaw) p.push(`转角 ${w.yaw.toFixed(1)}°`);
    return `偏差最大：<b>${w.c.name}</b>（${p.join('，')}）`;
  }

  /** 检视面板里的三个调节旋钮 */
  controls(c) {
    if (!this.on || !this.has(c) || !c.placed) return [];
    const m = this.mis(c), ax = this.axes(c), set = () => { this.pose(c); this.app.changed(); };
    const d = [];
    if (ax.includes('y')) d.push({ type: 'knob', label: '光心高度（升降杆）', get: () => m.y, set: (v) => { m.y = v; set(); }, min: -2, max: 2, step: 0.01, bigStep: 0.1, perRev: 0.5, digits: 2, unit: 'cm', sub: '等高共轴：各元件光心与光束等高、光束通过各元件中心' });
    if (ax.includes('z')) d.push({ type: 'knob', label: '横向位置（平移台）', get: () => m.z, set: (v) => { m.z = v; set(); }, min: -2, max: 2, step: 0.01, bigStep: 0.1, perRev: 0.5, digits: 2, unit: 'cm' });
    if (ax.includes('a')) d.push({ type: 'knob', label: '转角（绕竖直轴）', get: () => m.yaw, set: (v) => { m.yaw = v; set(); }, min: -10, max: 10, step: 0.05, bigStep: 0.5, perRev: 5, digits: 2, unit: '°' });
    return d;
  }

  /** 一键运行：把所有已放置元件调到共轴 */
  async alignAll(ms = 700) {
    for (const k of this.spec.keys) {
      const c = this.app.comp(k);
      if (!c || !c.placed) continue;
      const m = this.mis(c);
      if (!m.y && !m.z && !m.yaw) continue;
      this.app.select(c);
      const y0 = m.y, z0 = m.z, a0 = m.yaw;
      await this.app.tween(() => 1, (v) => { m.y = y0 * v; m.z = z0 * v; m.yaw = a0 * v; this.pose(c); }, 0, ms);
      m.y = 0; m.z = 0; m.yaw = 0; this.pose(c);
    }
  }

  /** 自动插入到实验步骤中的“等高共轴”步骤 */
  step() {
    return {
      title: '调节等高共轴',
      html: '<p>选中导轨上的每个元件，用<b>升降杆、横向平移台和转盘</b>调节，使各元件的光心与光束等高，光束沿导轨通过各元件中心。'
        + '可以先把元件移近光源对准光斑中心，再移远检查光斑是否偏移（“近调元件、远调光束”）。</p>',
      check: () => this.ok(),
      status: () => this.status(),
      auto: async () => { await this.alignAll(); },
    };
  }
}
