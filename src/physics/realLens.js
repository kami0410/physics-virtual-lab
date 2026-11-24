// 真实透镜成像质量：用精确光线追迹（lensTrace.js）算轴上物点在像屏上的弥散斑。
// 包含离焦、球差和色差：每个波长单独追迹，按光瞳面积加权求 RMS 半径。光具座实验用 cm，内部换算成 mm。
import { trace } from './lensTrace.js';
import { planck } from './color.js';

/** 白炽灯（2850 K）照明下，显示用的三个颜色通道取的代表波长与相对权重 */
export const RGB_LAMS = (() => {
  const L = [{ ch: 'r', nm: 615 }, { ch: 'g', nm: 550 }, { ch: 'b', nm: 470 }];
  const w = L.map((c) => planck(c.nm, 2850));
  const s = w.reduce((a, b) => a + b, 0);
  return L.map((c, i) => ({ ...c, w: w[i] / s }));
})();

/**
 * 双凸（或任意两面）透镜：R1、R2、中心厚 t（cm），玻璃牌号 glass，口径 D（cm）。
 * 物点在轴上、距前顶点 d1（cm）；像屏距后顶点 d2（cm）。
 * 返回各波长的 RMS 弥散半径 rms（cm）与等效弥散圆半径 blur = √2·rms（均匀圆斑的边缘半径）。
 */
export function spotOnScreen({ R1, R2, t, glass = 'K9', D }, d1, d2, lams = RGB_LAMS, nRing = 14) {
  const mm = 10;
  const lens = { surfaces: [{ R: R1 * mm, t: t * mm, glass }, { R: R2 * mm, t: d2 * mm, glass: 'air' }] };
  const sd = [(D / 2) * mm, (D / 2) * mm];
  const z0 = -d1 * mm;
  const zs = (t + d2) * mm;
  const out = [];
  for (const L of lams) {
    let sw = 0, sy = 0, syy = 0, n = 0;
    for (let k = 0; k < nRing; k++) {
      // 光瞳上等面积分环：环中心半径 r = R·√((k+½)/N)
      const r = (D / 2) * mm * Math.sqrt((k + 0.5) / nRing);
      const u = Math.hypot(r, -z0);
      const res = trace(lens, L.nm, [0, 0, z0], [0, r / u, -z0 / u], { sd, clip: true });
      if (!res.ok) continue;
      const tt = (zs - res.p[2]) / res.d[2];
      const y = res.p[1] + tt * res.d[1];
      sw += 1; sy += y; syy += y * y; n++;
    }
    // 轴对称：弥散斑中心在轴上，RMS 半径 = √(<y²>)（各环面积相等，权重相同）
    const rms = n ? Math.sqrt(syy / sw) / mm : Infinity;
    out.push({ ...L, rms, blur: Math.SQRT2 * rms });
  }
  return out;
}

/** 三通道合成的等效弥散圆半径（按白光权重） */
export function whiteBlur(spots) {
  let s = 0, w = 0;
  for (const p of spots) { s += p.w * p.blur * p.blur; w += p.w; }
  return Math.sqrt(s / w);
}
