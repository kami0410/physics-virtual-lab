// 弗兰克-赫兹管（充氩）中的电子输运：一维能量分布逐层推进的确定性模型。
//   第二栅极 G2 与阴极之间的加速区分成 M 层，每层电子获得能量 U/M；能量超过激发阈值 E1 的电子，
//   在这一层内以概率 (Δx/λ)·s(ε) 与氩原子非弹性碰撞而损失 E1（s(ε) 为截面随能量的上升）。
//   电子在两次碰撞之间还要多走一段、多获得一些能量，所以第 n 个峰的位置比 n·E1 稍大，峰间距随 n 增大
//   （见 Rapior, Sengstock, Baev, Am. J. Phys. 74, 423 (2006) 的讨论；这里只借用其物理图像，不含其代码）。
//   到达 G2 的电子要克服 G2-A 间的拒斥电压才能到达板极；电子运动方向分散，用宽约 0.4 eV 的平滑截止近似。
// 能量较高时还会电离（氩 15.76 eV），产生正离子，管流急剧增大——管子可能被击穿。

export const AR = { E1: 11.55, E2: 13.1, Eion: 15.76 };

export class FHTube {
  constructor({ E1 = AR.E1, E2 = AR.E2, kappa = 14, Vc = 2, M = 300, rise = 1.6 } = {}) {
    Object.assign(this, { E1, E2, kappa, Vc, M, rise });
    this.cache = new Map();
  }
  /** 加速电压 VG2（V）时 G2 处的电子能量分布：返回 0–30 eV、0.1 eV 一格的数组（总和为 1） */
  dist(VG2) {
    const key = Math.round(VG2 * 10);
    if (this.cache.has(key)) return this.cache.get(key);
    const U = Math.max(0, VG2 - this.Vc); // 扣除接触电位差后的有效加速电压
    const M = this.M, de = Math.max(U, 1e-6) / M, K = M + 1;
    let f = new Float64Array(K + 1), g = new Float64Array(K + 1);
    f[0] = 1; // 从 0 能量出发（热运动能量在最后的平滑中计入）
    const loss = this.E1 / de, loss2 = this.E2 / de;
    const p0 = this.kappa / M;
    for (let m = 1; m <= M; m++) {
      g.fill(0);
      for (let k = 0; k < K; k++) { if (f[k]) g[k + 1] += f[k]; }
      // 非弹性碰撞：4s 组能级（约 11.55 eV 起）与 4p 组能级（约 13.1 eV 起）
      for (let k = 0; k <= K; k++) {
        const e = k * de;
        if (e < this.E1 || !g[k]) continue;
        const s1 = Math.min(1, (e - this.E1) / this.rise + 0.08), s2 = e < this.E2 ? 0 : 0.6 * Math.min(1, (e - this.E2) / 1.5 + 0.05);
        const p = Math.min(0.9, p0 * (s1 + s2)), q = g[k] * p, w2 = s2 / (s1 + s2);
        g[k] -= q;
        for (const [ls, wt] of [[loss, 1 - w2], [loss2, w2]]) {
          if (!wt) continue;
          const li = Math.floor(ls), lf = ls - li, j = k - li;
          if (j >= 0) g[j] += q * wt * (1 - lf);
          if (j - 1 >= 0) g[j - 1] += q * wt * lf; else if (j >= 0) g[j] += q * wt * lf;
        }
      }
      [f, g] = [g, f];
    }
    // 重采样到 0.1 eV 网格，并作 0.25 eV 的高斯平滑（热运动 + 方向分散）
    const out = new Float64Array(301);
    for (let k = 0; k <= K; k++) { if (!f[k]) continue; const e = k * de, i = Math.min(300, Math.round(e * 10)); out[i] += f[k]; }
    const sm = new Float64Array(301), w = 2.5;
    for (let i = 0; i <= 300; i++) { if (!out[i]) continue; for (let j = Math.max(0, i - 8); j <= Math.min(300, i + 8); j++) sm[j] += out[i] * Math.exp(-0.5 * ((j - i) / w) ** 2) / (w * Math.sqrt(2 * Math.PI)); }
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(key, sm);
    return sm;
  }
  /** 能越过拒斥电压 VG2A 的电子比例 */
  pass(VG2, VG2A) {
    const d = this.dist(VG2);
    let s = 0;
    for (let i = 0; i <= 300; i++) { if (d[i]) s += d[i] / (1 + Math.exp(-((i / 10 - VG2A) / 0.35))); }
    return s;
  }
  /** 电离产生的附加电流（相对），VG2 超过电离阈值较多时迅速增大 */
  ionization(VG2) { const x = VG2 - this.Vc - 84; return x > 0 ? 0.02 * Math.expm1(x / 2.5) : 0; }
}
