// 干涉计算核心：迈克尔逊（两虚点光源干涉）、牛顿环（空气薄膜等厚干涉，含钠双线）
import { wavelengthToRGB } from './color.js';

/**
 * 迈克尔逊干涉仪：扩束后的点光源 S 经 M1、M2 形成两个虚光源 S1、S2。
 * S2 位于屏前 R0 处，S1 位于 R0+2d 处，M2 倾斜 ε 使 S2 横向偏移 δ=(δx,δy)。
 * 屏上任一点的光程差 Δ = r1 − r2，用 (r1²−r2²)/(r1+r2) 计算以保证数值精度。
 * @param img ImageData，halfW 屏幕视场半宽(mm)
 * ox, oy：光束中心相对屏中心的偏移(mm)，整个图样随之平移；
 * va：两臂光强不等时的条纹可见度 2√(I₁I₂)/(I₁+I₂)
 */
export function michelsonPattern(img, { d, lambda, R0 = 500, dx = 0, dy = 0, halfW = 40, beamW = 46, coh = 150, gain = 1, ox = 0, oy = 0, va = 1 }) {
  const W = img.width, H = img.height, data = img.data;
  const R2 = R0, R1 = R0 + 2 * d;
  const k = (2 * Math.PI) / lambda;
  const pix = (2 * halfW) / W;
  const Vc = Math.exp(-(((2 * d) / coh) ** 2));
  const dd = dx * dx + dy * dy;
  const R12 = R1 * R1 - R2 * R2;
  const [cr, cg, cb] = wavelengthToRGB(lambda * 1e6);
  let i = 0;
  for (let py = 0; py < H; py++) {
    const Y = (H / 2 - py - 0.5) * pix - oy;
    for (let px = 0; px < W; px++, i += 4) {
      const X = (px - W / 2 + 0.5) * pix - ox;
      const rho2 = X * X + Y * Y;
      const r1 = Math.sqrt(rho2 + R1 * R1);
      const r2 = Math.sqrt((X - dx) ** 2 + (Y - dy) ** 2 + R2 * R2);
      const diff = (2 * X * dx + 2 * Y * dy - dd + R12) / (r1 + r2);
      // 局部条纹空间频率（防止欠采样产生假条纹：人眼/屏分辨不了的密条纹表现为均匀亮度）
      const gx = X / r1 - (X - dx) / r2, gy = Y / r1 - (Y - dy) / r2;
      const spacing = lambda / (Math.hypot(gx, gy) + 1e-12);
      const Vs = Math.min(1, Math.max(0, (spacing / pix - 2.2) / 2));
      const env = Math.exp(-rho2 / (beamW * beamW));
      const I = env * (1 + 0.96 * va * Vc * Vs * Math.cos(k * diff)) * 0.5 * gain;
      const v = Math.min(1, I);
      const vv = Math.pow(v, 0.8);
      data[i] = 16 + 239 * vv * cr; data[i + 1] = 16 + 239 * vv * cg * 0.9 + 18 * vv; data[i + 2] = 18 + 237 * vv * cb + 12 * vv; data[i + 3] = 255;
    }
  }
  return img;
}

/** 未扩束时：屏上的激光光点（每路含两个较弱的次级反射点） */
export function michelsonSpots(img, { spots, halfW = 40 }) {
  const W = img.width, H = img.height, data = img.data;
  const pix = (2 * halfW) / W;
  let i = 0;
  for (let py = 0; py < H; py++) {
    const Y = (H / 2 - py - 0.5) * pix;
    for (let px = 0; px < W; px++, i += 4) {
      const X = (px - W / 2 + 0.5) * pix;
      let I = 0;
      for (const s of spots) I += s.a * Math.exp(-((X - s.x) ** 2 + (Y - s.y) ** 2) / (s.r * s.r));
      const v = Math.min(1, I);
      data[i] = 24 + 231 * v; data[i + 1] = 22 + 60 * v * v + 20 * v; data[i + 2] = 26 + 50 * v * v; data[i + 3] = 255;
    }
  }
  return img;
}

/**
 * 牛顿环（反射光）：空气层厚度 e(r) = r²/2R + e0，光程差 2e + λ/2（半波损失）。
 * 钠光含 589.0/589.6 nm 双线，按强度 1:0.5 非相干叠加；玻璃界面反射率 r≈0.2 计入多光束近似。
 * 返回指定视场（中心 cx, cy，半宽 half，单位 mm）的强度。
 */
export function newtonIntensity(r2, R, e0, lines) {
  const e = r2 / (2 * R) + e0;
  let I = 0, S = 0;
  for (const [lam, w] of lines) {
    const delta = (4 * Math.PI * e) / lam; // 2e 的相位
    // 两束反射光：上表面(玻璃→空气)与下表面(空气→玻璃，有半波损失)
    const a1 = 0.2, a2 = 0.2 * (1 - 0.04);
    I += w * (a1 * a1 + a2 * a2 - 2 * a1 * a2 * Math.cos(delta));
    S += w * (a1 + a2) ** 2;
  }
  return I / S; // 0..1
}

/** 空气薄膜（厚度 e，mm）的反射光相对强度，对多条谱线非相干叠加；0 为暗纹 */
export function filmIntensity(e, lines) {
  return newtonIntensity(2 * e, 1, 0, lines);
}

// ---------- 以上公式的 GPU（GLSL）版本，逐像素并行计算；与 CPU 版逐项对应 ----------
/** 双谱线空气薄膜反射强度：uL1 = (λ1, w1)，uL2 = (λ2, w2)，单位 mm */
export const GLSL_FILM = `
uniform vec2 uL1; uniform vec2 uL2;
float filmPair(float e, vec2 L) {
  float delta = 12.566370614 * e / L.x;
  float a1 = 0.2, a2 = 0.192;
  return L.y * (a1 * a1 + a2 * a2 - 2.0 * a1 * a2 * cos(delta));
}
float newtonI(float r2, float R, float e0) {
  float e = r2 / (2.0 * R) + e0;
  float S = (uL1.y + uL2.y) * 0.1536; // (a1 + a2)^2
  return (filmPair(e, uL1) + filmPair(e, uL2)) / S;
}
float filmI(float e) { return newtonI(2.0 * e, 1.0, 0.0); }
`;

/**
 * 迈克尔逊等倾条纹。大数 R1²−R2² 在 CPU 上以双精度算好再传入（uR12），
 * 着色器内只做 float32 量级安全的运算；欠采样可见度按实际输出像素大小计算，放大观察窗时条纹更细也能分辨。
 */
export const GLSL_MICHELSON = `
uniform float uR1, uR2, uR12, uK, uLam, uVc, uDx, uDy, uBeamW, uGain, uHalf, uW, uOx, uOy, uVa;
uniform vec3 uCol;
vec3 shade(vec2 L) {
  float pix = 2.0 * uHalf / uW;
  float X = (L.x - 0.5 * uW) * pix - uOx, Y = (0.5 * uW - L.y) * pix - uOy;
  float rho2 = X * X + Y * Y;
  float r1 = sqrt(rho2 + uR1 * uR1);
  float r2 = sqrt((X - uDx) * (X - uDx) + (Y - uDy) * (Y - uDy) + uR2 * uR2);
  float diff = (2.0 * X * uDx + 2.0 * Y * uDy - (uDx * uDx + uDy * uDy) + uR12) / (r1 + r2);
  vec2 gr = vec2(X / r1 - (X - uDx) / r2, Y / r1 - (Y - uDy) / r2);
  float spacing = uLam / (length(gr) + 1e-12);
  float Vs = clamp((spacing / (uPx * pix) - 2.2) / 2.0, 0.0, 1.0);
  float env = exp(-rho2 / (uBeamW * uBeamW));
  float I = env * (1.0 + 0.96 * uVa * uVc * Vs * cos(uK * diff)) * 0.5 * uGain;
  float vv = pow(min(1.0, I), 0.8);
  return vec3(16.0 + 239.0 * vv * uCol.r, 16.0 + 239.0 * vv * uCol.g * 0.9 + 18.0 * vv, 18.0 + 237.0 * vv * uCol.b + 12.0 * vv) / 255.0;
}
`;

/** michelsonPattern 的 GPU 参数（与 CPU 版同一套输入） */
export function michelsonUniforms({ d, lambda, R0 = 500, dx = 0, dy = 0, halfW = 40, beamW = 46, coh = 150, gain = 1, ox = 0, oy = 0, va = 1 }, W) {
  const R2 = R0, R1 = R0 + 2 * d;
  return {
    uR1: R1, uR2: R2, uR12: 4 * d * R0 + 4 * d * d, uK: (2 * Math.PI) / lambda, uLam: lambda,
    uVc: Math.exp(-(((2 * d) / coh) ** 2)), uDx: dx, uDy: dy, uBeamW: beamW, uGain: gain, uHalf: halfW, uW: W, uOx: ox, uOy: oy, uVa: va,
    uCol: wavelengthToRGB(lambda * 1e6),
  };
}

/** 未扩束光点（最多 8 个高斯斑：uSp[i] = (x, y, r, a)） */
export const GLSL_SPOTS = `
uniform vec4 uSp[8]; uniform float uN, uHalf, uW;
vec3 shade(vec2 L) {
  float pix = 2.0 * uHalf / uW;
  float X = (L.x - 0.5 * uW) * pix, Y = (0.5 * uW - L.y) * pix;
  float I = 0.0;
  for (int i = 0; i < 8; i++) { if (float(i) >= uN) break; vec4 s = uSp[i]; I += s.w * exp(-((X - s.x) * (X - s.x) + (Y - s.y) * (Y - s.y)) / (s.z * s.z)); }
  float v = min(1.0, I);
  return vec3(24.0 + 231.0 * v, 22.0 + 60.0 * v * v + 20.0 * v, 26.0 + 50.0 * v * v) / 255.0;
}
`;
export function spotsUniforms(spots, halfW, W) {
  const a = new Float32Array(32);
  spots.slice(0, 8).forEach((s, i) => a.set([s.x, s.y, s.r, s.a], i * 4));
  return { uSp: a, uN: Math.min(8, spots.length), uHalf: halfW, uW: W };
}
