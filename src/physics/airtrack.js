// 气垫导轨：滑块运动、碰撞与光电门计时
//   滑块浮在约 0.1 mm 厚的气膜上，阻力主要来自气膜的黏性剪切，近似与速度成正比：F = −b·v，
//     b ≈ η·A/δ（η 空气黏度 1.8×10⁻⁵ Pa·s，A 滑块与导轨相对的面积约 0.015 m²，δ 气膜厚度）≈ 2.5×10⁻³ kg/s。
//   导轨倾斜 θ 时多一项 −g·sinθ（x 轴沿导轨，θ > 0 表示右端偏高）。
//   一维碰撞按恢复系数 e 处理（弹簧圈 e ≈ 0.97，尼龙搭扣 e = 0）：
//     v1' = v̄ − e·m2(v1 − v2)/(m1 + m2)，v2' = v̄ + e·m1(v1 − v2)/(m1 + m2)，v̄ 为质心速度。动量严格守恒。
//   滑块撞到导轨两端的缓冲器后被按住（held），不再运动，直到重新放回导轨。
//   光电门：U 形挡光片两齿前沿相距 Δx。计时器（S2 挡）在挡光片第一次挡光时开始、第二次挡光时停止，
//     记下 Δt；速度 v = Δx/Δt。挡光时刻由子步内线性插值求得，不受步长影响。
export const G = 9.794;

export class Glider {
  constructor({ m = 0.18, x = 0, len = 0.2, flagW = 0.014, flagP = 0.004 } = {}) {
    Object.assign(this, { m, x, v: 0, len, flagW, flagP });
  }
  /** 挡光片两齿的区间（相对导轨坐标） */
  prongs() { const a = this.x - this.flagW / 2, b = this.x + this.flagW / 2; return [[a, a + this.flagP], [b - this.flagP, b]]; }
  get dx() { return this.flagW - this.flagP; }
}

export class AirTrack {
  constructor({ L = 1.5, theta = 0, b = 2.5e-3, gates = [0.5, 1.0] } = {}) {
    this.L = L; this.theta = theta; this.b = b; this.air = true; this.e = 0.97;
    this.gliders = []; this.t = 0; this.cols = []; // cols：每次碰撞时两滑块的编号与碰前速度
    this.gates = gates.map((x) => ({ x, start: null, log: [] })); // log: {dt, glider, dir, t}
  }
  /** 一个滑块的加速度 */
  acc(g) { return this.air ? -((this.b + (g.bx || 0)) / g.m) * g.v - G * Math.sin(this.theta) : 0; }
  /** 推进 dt 秒，内部步长 h */
  step(dt, h = 5e-4) {
    const n = Math.max(1, Math.ceil(dt / h)), hh = dt / n;
    for (let k = 0; k < n; k++) this.sub(hh);
  }
  sub(h) {
    const gs = this.gliders;
    if (!this.air) { for (const g of gs) g.v = 0; this.t += h; return; }
    const before = gs.map((g) => g.prongs());
    // 速度按指数衰减 + 重力分量精确积分（线性阻力的解析解）
    for (const g of gs) {
      if (g.held) continue;
      const k = (this.b + (g.bx || 0)) / g.m, a = -G * Math.sin(this.theta), ek = Math.exp(-k * h); // bx：滑块自身附加的阻力（配重不对称时一侧擦着导轨）
      const v0 = g.v;
      if (k * h < 1e-9) { g.v = v0 + a * h; g.x += v0 * h + (a * h * h) / 2; continue; }
      const vInf = a / k;
      g.v = vInf + (v0 - vInf) * ek;
      g.x += vInf * h + ((v0 - vInf) * (1 - ek)) / k;
    }
    // 碰撞（按位置排序后相邻两块）
    const ord = [...gs].sort((p, q) => p.x - q.x);
    for (let i = 0; i + 1 < ord.length; i++) {
      const p = ord[i], q = ord[i + 1], gap = q.x - p.x - (p.len + q.len) / 2;
      const stuck = this.e === 0 && gap < 1e-6 && (p.v >= q.v || p.joined === q); // 尼龙搭扣粘住后一起运动
      if (p.held || q.held) { if (gap < 0) { p.v = q.v = 0; p.held = q.held = true; } continue; } // 撞上被按住的滑块：一并按住
      if (gap < 0 && p.v > q.v && p.joined !== q) this.cols.push({ t: this.t, a: gs.indexOf(p), b: gs.indexOf(q), va: p.v, vb: q.v });
      if ((gap < 0 && p.v > q.v) || stuck) {
        const M = p.m + q.m, vc = (p.m * p.v + q.m * q.v) / M, dv = p.v - q.v, e = this.e;
        p.v = vc - (e * q.m * dv) / M; q.v = vc + (e * p.m * dv) / M;
        if (e === 0) p.joined = q;
      }
      if (gap < 0) { const fix = -gap / 2; p.x -= fix; q.x += fix; }
    }
    // 导轨两端的缓冲：滑块撞上后被按住
    for (const g of gs) {
      if (g.held) { g.v = 0; continue; }
      if (g.x - g.len / 2 < 0) { g.x = g.len / 2; g.v = 0; g.held = true; }
      if (g.x + g.len / 2 > this.L) { g.x = this.L - g.len / 2; g.v = 0; g.held = true; }
    }
    // 光电门：挡光状态由“不挡”变“挡”时插值求时刻
    gs.forEach((g, gi) => {
      const after = g.prongs();
      for (const gate of this.gates) {
        for (let j = 0; j < 2; j++) {
          const [a0, b0] = before[gi][j], [a1, b1] = after[j];
          const in0 = gate.x >= a0 && gate.x <= b0, in1 = gate.x >= a1 && gate.x <= b1;
          if (in0 || !in1) continue;
          const moved = (a1 - a0) || 1e-18, edge0 = g.v >= 0 ? b0 : a0; // 向右运动时右边沿先挡光
          const frac = Math.min(1, Math.max(0, (gate.x - edge0) / moved));
          const tc = this.t + frac * h;
          if (!gate.start || gate.start.glider !== gi || tc - gate.start.t > 5) gate.start = { t: tc, glider: gi };
          else { gate.log.push({ dt: tc - gate.start.t, glider: gi, dir: Math.sign(g.v) || 1, t: tc }); gate.start = null; }
        }
      }
    });
    this.t += h;
  }
  resetTimer() { for (const g of this.gates) { g.log = []; g.start = null; } }
}

/** 理论：一维碰撞后的速度 */
export function collide(m1, v1, m2, v2, e) {
  const M = m1 + m2, vc = (m1 * v1 + m2 * v2) / M, dv = v1 - v2;
  return [vc - (e * m2 * dv) / M, vc + (e * m1 * dv) / M];
}
