// 克拉尼图形：中心固定的方形薄板的弯曲振动
// 1. 振型：Kirchhoff 薄板，瑞利–里茨法。基函数取勒让德多项式之积 P_i(ξ)P_j(η)（ξ = 2x/Lx，η = 2y/Ly），
//    势能 U = D/2 ∬[w_xx² + w_yy² + 2ν w_xx w_yy + 2(1−ν) w_xy²] dxdy，动能 ρh/2 ∬ ẇ² dxdy。
//    板中心用螺钉（带垫圈）固定在振动器上：垫圈下的一小块板挠度为零（不平移、不转动），用罚函数施加。
//    板四周自由，所以不需要基函数满足任何边界条件（自由边条件是里茨法的自然边界条件）。
//    关于 x、y 的奇偶性把问题分成 4 个互不耦合的块，每块是一个对称矩阵的特征值问题（雅可比旋转法）。
// 2. 受迫振动：中心随振动器作简谐运动（基础激励），各模式的激励正比于 ∬φ dA，另加很小的随机项代表板的不完善
//    （螺孔不在正中、板厚不均匀等），使理想对称下激不起的模式也能看到。
// 3. 沙粒：在当地加速度幅值 ω²|W| 超过 g 处被抛起，落点随机，统计上向振幅小的地方（节线）漂移。

/** 勒让德多项式及其一、二阶导数在点 x 处的值（0…n−1 阶） */
function legendre(x, n) {
  const P = new Float64Array(n), D1 = new Float64Array(n), D2 = new Float64Array(n);
  P[0] = 1; if (n > 1) P[1] = x;
  for (let k = 2; k < n; k++) P[k] = ((2 * k - 1) * x * P[k - 1] - (k - 1) * P[k - 2]) / k;
  // P'_k = k P_{k−1} + x P'_{k−1}；P''_k = (k+1) P'_{k−1} + x P''_{k−1}
  for (let k = 1; k < n; k++) { D1[k] = k * P[k - 1] + x * D1[k - 1]; D2[k] = (k + 1) * D1[k - 1] + x * D2[k - 1]; }
  return { P, D1, D2 };
}

/** n 点高斯–勒让德求积的节点与权 */
function gauss(n) {
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5)), pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / pp; z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = z; w[i] = 2 / ((1 - z * z) * pp * pp);
  }
  return { x, w };
}

/** 对称矩阵（行优先 Float64Array，n×n）的雅可比特征分解，返回 {val, vec(列为特征向量)} */
export function jacobiEigen(A0, n) {
  const A = Float64Array.from(A0), V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, tot = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const a = A[i * n + j] ** 2; tot += a; if (i !== j) off += a; }
    if (off <= 1e-26 * tot) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p * n + q];
      if (Math.abs(apq) < 1e-300) continue;
      const app = A[p * n + p], aqq = A[q * n + q], th = (aqq - app) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = A[k * n + p], akq = A[k * n + q];
        A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = A[p * n + k], aqk = A[q * n + k];
        A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k * n + p], vkq = V[k * n + q];
        V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq;
      }
    }
  }
  const val = Array.from({ length: n }, (_, i) => A[i * n + i]);
  return { val, vec: V };
}

/**
 * 矩形自由板（可选中心固定）的振动模式。
 * @param {{Lx:number, Ly:number, nu:number, N?:number, clamp?:boolean}} o  Lx、Ly 只用比值（结果的 λ 以 L = √(LxLy) 为特征长度）
 * @returns {{modes: {lam:number, cls:number, c:Float64Array, part:number}[], N:number, Lx:number, Ly:number}}
 *   lam = ωL²√(ρh/D)；c 为 N×N 系数（c[i*N+j] 对应 P_i(ξ)P_j(η)），按 ∬w² dξdη = 4 归一（均方 = 1）；part = ∬w dξdη /4（平均挠度）
 */
export function plateModes({ Lx = 1, Ly = 1, nu = 0.3, N = 18, clamp = true, r0 = 0.08 } = {}) {
  const G = gauss(N + 6), Q = G.x.length;
  const tab = Array.from(G.x, (x) => legendre(x, N));
  const I = (f) => { const M = new Float64Array(N * N); for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) { let s = 0; for (let q = 0; q < Q; q++) s += G.w[q] * f(tab[q], a, b); M[a * N + b] = s; } return M; };
  const A0 = I((t, a, b) => t.P[a] * t.P[b]), A1 = I((t, a, b) => t.D1[a] * t.D1[b]), A2 = I((t, a, b) => t.D2[a] * t.D2[b]), B = I((t, a, b) => t.D2[a] * t.P[b]);
  const L = Math.sqrt(Lx * Ly), sx = (2 * L) / Lx, sy = (2 * L) / Ly; // 以 L 为长度单位：∂x = sx ∂ξ / L
  // 夹紧：中心螺钉加垫圈（半径 r0，以半边长为单位）。约束三项：中心挠度为零；垫圈范围内的平均转角
  // ∂w/∂x、∂w/∂y 为零。只约束“中心一点的转角”在薄板理论里是不适定的（点转角不是能量有界的量）：
  // 基函数越多约束越松，最低的“摇摆”模式频率会一直往 0 掉（N = 10→26 时 λ 从 10.6 降到 8.0）。
  // 改为垫圈面积上的平均转角后，结果随 N 收敛。
  const c0 = legendre(0, N);
  const gq = gauss(6), disc = [];
  for (let a = 0; a < gq.x.length; a++) {
    const r = (r0 * (gq.x[a] + 1)) / 2, wr = (r0 / 2) * gq.w[a] * r;
    for (let q = 0; q < 16; q++) { const t = (2 * Math.PI * (q + 0.5)) / 16; disc.push({ u: legendre(r * Math.cos(t), N), v: legendre(r * Math.sin(t), N), w: (wr * 2 * Math.PI) / 16 }); }
  }
  const avg = (f) => (i, j) => disc.reduce((s, p) => s + p.w * f(p, i, j), 0);
  const cons = [(i, j) => c0.P[i] * c0.P[j], avg((p, i, j) => p.u.D1[i] * p.v.P[j]), avg((p, i, j) => p.u.P[i] * p.v.D1[j])];
  const modes = [];
  for (const [px, py] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const idx = [];
    for (let i = px; i < N; i += 2) for (let j = py; j < N; j += 2) idx.push([i, j]);
    const n = idx.length, K = new Float64Array(n * n), m = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      const [i, j] = idx[r];
      m[r] = A0[i * N + i] * A0[j * N + j];
      for (let s = 0; s < n; s++) {
        const [k, l] = idx[s];
        K[r * n + s] = sx ** 4 * A2[i * N + k] * A0[j * N + l] + sy ** 4 * A0[i * N + k] * A2[j * N + l]
          + nu * sx * sx * sy * sy * (B[i * N + k] * B[l * N + j] + B[k * N + i] * B[j * N + l])
          + 2 * (1 - nu) * sx * sx * sy * sy * A1[i * N + k] * A1[j * N + l];
      }
    }
    if (clamp) {
      let kmax = 0; for (let r = 0; r < n; r++) kmax = Math.max(kmax, K[r * n + r] / m[r]);
      for (const g of cons) {
        const v = idx.map(([i, j]) => g(i, j));
        const vv = v.reduce((a, x, r) => a + (x * x) / m[r], 0);
        if (vv < 1e-12) continue;
        const pen = (1e3 * kmax) / vv; // 约束方向上的特征值约为最大特征值的 1000 倍
        for (let r = 0; r < n; r++) for (let s = 0; s < n; s++) K[r * n + s] += pen * v[r] * v[s];
      }
    }
    // M 对角：S = M^{-1/2} K M^{-1/2}
    const S = new Float64Array(n * n);
    for (let r = 0; r < n; r++) for (let s = 0; s < n; s++) S[r * n + s] = K[r * n + s] / Math.sqrt(m[r] * m[s]);
    const { val, vec } = jacobiEigen(S, n);
    for (let e = 0; e < n; e++) {
      const mu = val[e];
      if (!(mu > 1e-6)) continue; // 刚体模式（不固定时）
      const c = new Float64Array(N * N);
      let nn = 0;
      for (let r = 0; r < n; r++) { const [i, j] = idx[r], v = vec[r * n + e] / Math.sqrt(m[r]); c[i * N + j] = v; nn += v * v * m[r]; }
      const k = Math.sqrt(4 / nn); for (let r = 0; r < c.length; r++) c[r] *= k;
      modes.push({ lam: Math.sqrt(mu), cls: px + 2 * py, c, part: px || py ? 0 : c[0] });
    }
  }
  modes.sort((a, b) => a.lam - b.lam);
  return { modes: modes.filter((md) => md.lam < 2500), N, Lx, Ly };
}

/** 在 G×G 网格（ξ、η 从 −1 到 1）上求模式形状，返回 Float32Array（行优先，行为 η） */
export function modeField(c, N, G) {
  const P = Array.from({ length: G }, (_, a) => legendre(-1 + (2 * a) / (G - 1), N).P);
  const out = new Float32Array(G * G), tmp = new Float64Array(N);
  for (let b = 0; b < G; b++) {
    const Py = P[b];
    for (let i = 0; i < N; i++) { let s = 0; for (let j = 0; j < N; j++) s += c[i * N + j] * Py[j]; tmp[i] = s; }
    for (let a = 0; a < G; a++) { const Px = P[a]; let s = 0; for (let i = 0; i < N; i++) s += tmp[i] * Px[i]; out[b * G + a] = s; }
  }
  return out;
}

/** 钢板参数：D = Eh³/12(1−ν²)，由 λ 换算频率 */
export function plateFreq(lam, { L, h, E, rho, nu }) {
  const D = (E * h ** 3) / (12 * (1 - nu * nu));
  return (lam / (2 * Math.PI * L * L)) * Math.sqrt(D / (rho * h));
}
