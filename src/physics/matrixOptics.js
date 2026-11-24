// 傍轴光线传输矩阵 (ABCD) 计算核心：厚透镜、自由传播、平面镜折返
// 光线向量 [y, θ]，y 单位 cm，θ 单位 rad

export const M = {
  T: (d) => [1, d, 0, 1], // 自由传播 d
  R: (R, n1, n2) => [1, 0, (n1 - n2) / (n2 * R), n1 / n2], // 球面折射，R>0 球心在右
  thin: (f) => [1, 0, -1 / f, 1],
  I: () => [1, 0, 0, 1],
};

export function mul(a, b) {
  // a·b （先作用 b，再作用 a）
  return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];
}
/** 系统矩阵：按光线经过的先后顺序传入 */
export function chain(...ms) {
  return ms.reduce((acc, m) => mul(m, acc), M.I());
}

/** 对称双凸厚透镜：由目标焦距 f、厚度 t、折射率 n 反解曲率半径 R */
export class ThickLens {
  constructor(f, t = 0.6, n = 1.5163) {
    this.t = t; this.n = n;
    // 1/f = (n-1)[2/R - (n-1)t/(nR²)] 求 R
    // 令 u = 1/R: (n-1)²t/n u² - 2(n-1) u + 1/f = 0
    const a = ((n - 1) ** 2 * t) / n, b = -2 * (n - 1), c = 1 / f;
    const u = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    this.R = 1 / u;
    this.f = f;
  }
  /** 从前顶点到后顶点的矩阵 */
  matrix() {
    return chain(M.R(this.R, 1, this.n), M.T(this.t), M.R(-this.R, this.n, 1));
  }
  /** 有效焦距与主面位置（相对透镜中心） */
  cardinal() {
    const [A, , C, D] = this.matrix();
    const f = -1 / C;
    // 以透镜中心为原点：后焦点距后顶点 −A/C，故后主面 H' 距后顶点 (1−A)/C；前主面 H 距前顶点 (D−1)/C
    return { f, hBack: this.t / 2 + (1 - A) / C, hFront: -this.t / 2 + (D - 1) / C };
  }
}

/**
 * 物点经过“透镜中心位于 xL”的系统成像到 xS 平面：
 * 返回 {A, B}，B≈0 表示成像清晰；A 为横向放大率
 */
export function lensImaging(xo, xL, xS, lens) {
  const t = lens.t;
  const d1 = xL - t / 2 - xo;
  const d2 = xS - (xL + t / 2);
  const m = chain(M.T(d1), lens.matrix(), M.T(d2));
  return { A: m[0], B: m[1], C: m[2], D: m[3], d1, d2 };
}

/** 自准直：物 -> 透镜 -> 平面镜(xM) -> 透镜 -> 回到物平面 */
export function autocollimation(xo, xL, xM, lens) {
  const t = lens.t;
  const d1 = xL - t / 2 - xo;
  const a = xM - (xL + t / 2);
  const m = chain(M.T(d1), lens.matrix(), M.T(a), M.T(a), lens.matrix(), M.T(d1));
  return { A: m[0], B: m[1] };
}

/** 给定物位置与透镜，求清晰像位置（B=0），二分/解析 */
export function imagePosition(xo, xL, lens) {
  // B(d2) = B0 + A0*d2 线性：m = T(d2)·L·T(d1) -> B = m1[1] + d2*m1[3]
  const t = lens.t;
  const d1 = xL - t / 2 - xo;
  const m1 = chain(M.T(d1), lens.matrix());
  // m = T(d2)*m1 => B = m1[1] + d2*m1[3]
  const d2 = -m1[1] / m1[3];
  return xL + t / 2 + d2;
}
