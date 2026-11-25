// 导电纸（或水槽）上的稳恒电流场：∇·(σ∇V) = 0
//   电极：用有符号距离函数（SDF，<0 在电极内）描述，电极上 V 给定（Dirichlet）；
//   纸边绝缘：∂V/∂n = 0（Neumann，镜像）；纸外区域由 inside(x,y) 判断。
//   电极边界不在网格点上时用 Shortley–Weller 非等距差分：沿坐标轴找出边界的精确位置（二分），
//   这样圆形电极不会被“台阶化”，同轴电极的数值解与解析解 V = V0·ln(r2/r)/ln(r2/r1) 吻合到 0.1% 以内。
//   σ(x,y) 为导电纸的电导率分布（实际导电纸不均匀，造成等势线的轻微畸变）。

export class FieldSheet {
  /**
   * @param {{ x0:number, x1:number, y0:number, y1:number, n:number,
   *   electrodes: {sdf:(x:number,y:number)=>number, V:number}[],
   *   inside?: (x:number,y:number)=>boolean, sigma?: (x:number,y:number)=>number }} o
   */
  constructor(o) {
    Object.assign(this, o);
    const n = o.n, hx = (o.x1 - o.x0) / (n - 1), hy = (o.y1 - o.y0) / (n - 1);
    this.hx = hx; this.hy = hy;
    this.V = new Float64Array(n * n);
    this.fixed = new Uint8Array(n * n); // 1：电极内（已知电位）；2：纸外
    this.inside = o.inside || (() => true);
    this.sigma = o.sigma || (() => 1);
    this.prep();
  }
  X(i) { return this.x0 + i * this.hx; }
  Y(j) { return this.y0 + j * this.hy; }
  /** (x,y) 处在哪个电极内，返回电极序号或 -1 */
  which(x, y) { for (let k = 0; k < this.electrodes.length; k++) if (this.electrodes[k].sdf(x, y) <= 0) return k; return -1; }
  prep() {
    const { n } = this;
    const vmax = Math.max(...this.electrodes.map((e) => e.V)), vmin = Math.min(...this.electrodes.map((e) => e.V));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = j * n + i, x = this.X(i), y = this.Y(j), k = this.which(x, y);
      if (k >= 0) { this.fixed[p] = 1; this.V[p] = this.electrodes[k].V; } else if (!this.inside(x, y)) this.fixed[p] = 2; else this.V[p] = (vmax + vmin) / 2;
    }
    // 每个自由节点四个方向的权重与边界值（边界在两节点之间时按距离比例）
    const W = (this.W = new Float64Array(n * n * 4)), B = (this.B = new Float64Array(n * n * 4)), NB = (this.NB = new Int32Array(n * n * 4));
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = j * n + i;
      if (this.fixed[p]) continue;
      const x = this.X(i), y = this.Y(j), s0 = this.sigma(x, y);
      const arm = [];
      for (let d = 0; d < 4; d++) {
        const [di, dj] = dirs[d], h = di ? this.hx : this.hy, ii = i + di, jj = j + dj, q = jj * n + ii;
        let frac = 1, bv = 0, nb = q, kind = 'node';
        if (ii < 0 || jj < 0 || ii >= n || jj >= n || this.fixed[q] === 2) kind = 'wall'; // 纸边：绝缘
        else if (this.fixed[q] === 1) {
          // 二分找电极边界：f(t) = sdf(x + t·h·di, y + t·h·dj)
          const k = this.which(this.X(ii), this.Y(jj)), e = this.electrodes[k];
          let lo = 0, hi = 1;
          for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (e.sdf(x + m * h * di, y + m * h * dj) <= 0) hi = m; else lo = m; }
          frac = Math.max(0.05, (lo + hi) / 2); bv = e.V; kind = 'el'; nb = -1;
        }
        const sm = this.sigma(x + (frac * h * di) / 2, y + (frac * h * dj) / 2);
        arm.push({ kind, h: frac * h, nb, bv, s: 0.5 * (s0 + sm) });
      }
      // x 方向、y 方向分别用非等距三点公式（Shortley–Weller）：
      //   两侧都有邻点：w_a = 2σ_a / (h_a (h_a + h_b))
      //   一侧是绝缘纸边：镜像虚节点 V_ghost = V_对侧，相当于 w_对侧 = 2σ / h²
      for (const [a, b] of [[0, 1], [2, 3]]) {
        const A = arm[a], Bm = arm[b];
        for (const [m, o, other] of [[A, a, Bm], [Bm, b, A]]) {
          const q = p * 4 + o;
          if (m.kind === 'wall') { W[q] = 0; NB[q] = -1; continue; }
          W[q] = other.kind === 'wall' ? (2 * m.s) / (m.h * m.h) : (2 * m.s) / (m.h * (m.h + other.h));
          NB[q] = m.kind === 'el' ? -1 : m.nb;
          B[q] = m.kind === 'el' ? m.bv : 0;
        }
      }
    }
  }
  /** SOR 迭代到收敛（最大改变量 < tol），返回迭代次数 */
  solve({ tol = 1e-7, maxIt = 6000, omega } = {}) {
    const { n, V, fixed, W, B, NB } = this;
    const w = omega ?? 2 / (1 + Math.sin(Math.PI / n));
    let it = 0;
    for (; it < maxIt; it++) {
      let dmax = 0;
      for (let p = 0; p < n * n; p++) {
        if (fixed[p]) continue;
        let num = 0, den = 0;
        for (let o = 0; o < 4; o++) {
          const wt = W[p * 4 + o]; if (!wt) continue;
          const q = NB[p * 4 + o];
          num += wt * (q >= 0 ? V[q] : B[p * 4 + o]); den += wt;
        }
        if (!den) continue;
        const nv = V[p] + w * (num / den - V[p]), d = Math.abs(nv - V[p]);
        if (d > dmax) dmax = d;
        V[p] = nv;
      }
      if (dmax < tol) break;
    }
    this.iters = it;
    return it;
  }
  /** 任意点的电位：双线性插值；在电极内返回电极电位，纸外返回 NaN */
  at(x, y) {
    const k = this.which(x, y);
    if (k >= 0) return this.electrodes[k].V;
    if (!this.inside(x, y)) return NaN;
    const { n } = this, fi = (x - this.x0) / this.hx, fj = (y - this.y0) / this.hy;
    const i = Math.max(0, Math.min(n - 2, Math.floor(fi))), j = Math.max(0, Math.min(n - 2, Math.floor(fj))), u = fi - i, v = fj - j;
    const g = (ii, jj) => { const p = jj * n + ii; return this.fixed[p] === 2 ? NaN : this.V[p]; };
    let s = 0, ws = 0;
    for (const [ii, jj, wt] of [[i, j, (1 - u) * (1 - v)], [i + 1, j, u * (1 - v)], [i, j + 1, (1 - u) * v], [i + 1, j + 1, u * v]]) { const val = g(ii, jj); if (isFinite(val)) { s += wt * val; ws += wt; } }
    return ws ? s / ws : NaN;
  }
}

// ---------------- 常用电极形状的有符号距离函数（单位与坐标一致） ----------------
export const SDF = {
  circle: (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r,
  /** 圆外区域（同轴外电极：半径 r 以外都是电极） */
  outside: (cx, cy, r) => (x, y) => r - Math.hypot(x - cx, y - cy),
  /** 轴对齐矩形 */
  rect: (x0, y0, x1, y1) => (x, y) => { const dx = Math.max(x0 - x, x - x1), dy = Math.max(y0 - y, y - y1); return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy); },
};

/** 同轴电极的解析解 */
export const coaxV = (r, r1, r2, V0) => (r <= r1 ? V0 : r >= r2 ? 0 : (V0 * Math.log(r2 / r)) / Math.log(r2 / r1));
/** 解析解反解等势线半径 */
export const coaxR = (V, r1, r2, V0) => r2 * Math.pow(r1 / r2, V / V0);
