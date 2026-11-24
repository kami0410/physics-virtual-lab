// 光谱 -> 显示颜色（sRGB）
// 色匹配函数：CIE 1931 2° 标准观察者，用 Wyman, Sloan & Shirley (2013) 的多峰分段高斯解析拟合
// （"Simple Analytic Approximations to the CIE XYZ Color Matching Functions", JCGT 2(2)），
// 与 CIE 表值的最大偏差约为峰值的 1%，对显示用途足够。
// XYZ -> 线性 sRGB 用 IEC 61966-2-1 的 D65 矩阵。

const g = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };

/** CIE 1931 色匹配函数 x̄, ȳ, z̄（λ 单位 nm） */
export function cmf(nm) {
  return [
    1.056 * g(nm, 599.8, 37.9, 31.0) + 0.362 * g(nm, 442.0, 16.0, 26.7) - 0.065 * g(nm, 501.1, 20.4, 26.2),
    0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1),
    1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8),
  ];
}

/** XYZ -> 线性 sRGB（D65） */
export function xyzToLinear([X, Y, Z]) {
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.2040 * Y + 1.0570 * Z,
  ];
}

/**
 * 线性 sRGB 超出色域（有负分量）时，保持亮度 Y 与色相，向同亮度的灰色降低饱和度，直到落入色域。
 * 比直接把负值截为 0 更接近人眼所见：高级次干涉色会自然变淡，而不是被裁成过饱和的纯色。
 */
export function toGamut(r, g, b) {
  const m = Math.min(r, g, b);
  if (m >= 0) return [r, g, b];
  const Y = Math.max(0, 0.2126 * r + 0.7152 * g + 0.0722 * b);
  const t = Y / (Y - m);
  return [Y + t * (r - Y), Y + t * (g - Y), Y + t * (b - Y)];
}

/** 线性值 -> sRGB 编码值（0..1） */
export const encode = (c) => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };

// 1 nm 间隔预计算单色光的显示颜色
// 解析拟合在 400 nm 以下、680 nm 以上相对误差变大（数值很小），而真实光谱轨迹在两端色品基本不变，
// 所以色相取 clamp(λ, 400, 680) 处的值，亮度仍按 λ 本身计算。超出色域的负分量直接截为 0（保持色相，饱和度最高）。
const L0 = 360, L1 = 830, TABLE = new Float32Array((L1 - L0 + 1) * 3);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
for (let nm = L0; nm <= L1; nm++) {
  const lin = xyzToLinear(cmf(Math.min(680, Math.max(400, nm))));
  let r = Math.max(0, lin[0]), gg = Math.max(0, lin[1]), b = Math.max(0, lin[2]);
  const mx = Math.max(r, gg, b, 1e-9); r /= mx; gg /= mx; b /= mx;
  // 亮度：谱线以“最亮的同色”显示，两端按视见函数减弱（明度近似 ∝ Y^(1/3)）；
  // 400–700 nm 内保留下限以便看得见，到 380 nm / 780 nm 逐渐变为不可见
  const floor = 0.3 * clamp01((nm - 380) / 20) * clamp01((780 - nm) / 80);
  const fade = clamp01((nm - 370) / 30) * clamp01((830 - nm) / 50); // 紫外、红外端趋于不可见
  const f = fade * Math.min(1, Math.max(floor, 1.25 * Math.cbrt(Math.max(0, cmf(nm)[1]))));
  const i = (nm - L0) * 3;
  TABLE[i] = encode(r * f); TABLE[i + 1] = encode(gg * f); TABLE[i + 2] = encode(b * f);
}

/** 单色光的显示颜色（sRGB 编码值，0..1）；380 nm 以下与 780 nm 以外近乎不可见 */
export function wavelengthToRGB(nm) {
  if (!(nm >= L0 && nm <= L1)) return [0, 0, 0];
  const x = nm - L0, i = Math.min(L1 - L0 - 1, Math.floor(x)), t = x - i, a = i * 3, b = a + 3;
  return [TABLE[a] + (TABLE[b] - TABLE[a]) * t, TABLE[a + 1] + (TABLE[b + 1] - TABLE[a + 1]) * t, TABLE[a + 2] + (TABLE[b + 2] - TABLE[a + 2]) * t];
}
export function rgbCss(nm, a = 1) {
  const [r, g2, b] = wavelengthToRGB(nm);
  return `rgba(${Math.round(r * 255)},${Math.round(g2 * 255)},${Math.round(b * 255)},${a})`;
}
export function rgbHex(nm) {
  const [r, g2, b] = wavelengthToRGB(nm);
  return (Math.round(r * 255) << 16) | (Math.round(g2 * 255) << 8) | Math.round(b * 255);
}

/** 白光光源的相对光谱功率：普朗克黑体（色温 T，开尔文），钨丝灯约 2850 K */
export function planck(nm, T = 2850) {
  const l = nm * 1e-9, c2 = 1.4388e-2;
  return 1 / (l ** 5 * (Math.exp(c2 / (l * T)) - 1));
}

/**
 * 白光干涉/色散的显示颜色计算器。
 * source(nm)：光源相对光谱功率；返回 { lambdas, weights, toRGB(transmission(nm)) }：
 * toRGB 对透射（或干涉）谱 S(λ)·T(λ) 积分得 XYZ，再按光源白点逐通道归一（等同于眼睛/相机的白平衡），
 * 使“全部透过”显示为白色。step：积分步长 nm。
 */
export function spectralRenderer(source = (nm) => planck(nm), step = 5) {
  const lambdas = [], W = [];
  for (let nm = 380; nm <= 780; nm += step) {
    const s = source(nm), c = cmf(nm);
    lambdas.push(nm); W.push(xyzToLinear([c[0] * s, c[1] * s, c[2] * s]));
  }
  const white = [0, 0, 0];
  for (const w of W) { white[0] += w[0]; white[1] += w[1]; white[2] += w[2]; }
  // 每个波长对 r、g、b 的权重（已按白点归一）：rgb = Σ w(λ)·T(λ)
  const weights = W.map((w) => [w[0] / white[0], w[1] / white[1], w[2] / white[2]]);
  return {
    lambdas, weights,
    /** 线性 rgb（可能略有负值或 >1）→ 编码后的显示值 */
    toRGB(T, gain = 1) {
      let r = 0, gg = 0, b = 0;
      for (let k = 0; k < lambdas.length; k++) { const t = T(lambdas[k]), w = weights[k]; r += w[0] * t; gg += w[1] * t; b += w[2] * t; }
      [r, gg, b] = toGamut(r, gg, b);
      return [encode(r * gain), encode(gg * gain), encode(b * gain)];
    },
  };
}
