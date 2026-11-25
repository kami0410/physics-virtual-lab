// 温度传感器的物理模型：硅 PN 结（三极管 b-c 短接作二极管）与 NTC 热敏电阻
//
// PN 结正向电流（扩散 + 势垒区复合两部分）：
//   I = Is(T)·[exp(eU/(n·kT)) − 1] + Ir(T)·[exp(eU/(2kT)) − 1]
//   Is(T) = C·T^r·exp(−Eg(T)/(n·kT))，Eg(T) 用 Varshni 式：Eg = Eg0 − aT²/(T + b)（硅：1.170 eV、4.73e-4 eV/K、636 K）
//   恒流时 U_F 随 T 近似线性下降（约 −2 mV/K）；把 U_F–T 直线外推到 0 K，截距 U(0) 近似为 Eg(0)/e。
// NTC 热敏电阻：R(T) = R25·exp[B(1/T − 1/T25) + γ(1/T − 1/T25)²]，γ 很小，使 ln R–1/T 略微弯曲（真实器件的 B 值随温度略变）。

export const QE = 1.602176634e-19, KB = 1.380649e-23, T25 = 298.15;
export const EG = { e0: 1.17, a: 4.73e-4, b: 636 };
/** 硅的禁带宽度（eV） */
export const egSi = (T) => EG.e0 - (EG.a * T * T) / (T + EG.b);

/** 一只 PN 结：Is300 为 300 K 时的反向饱和电流（A），n 为理想因子，r 为 Is 的温度指数 */
export function makeJunction({ Is300 = 4e-15, n = 1.008, r = 3, Ir300 = 2e-13 } = {}) {
  const kT = (T) => (KB * T) / QE; // eV
  const Is = (T) => Is300 * (T / 300) ** r * Math.exp(-(egSi(T) / (n * kT(T)) - egSi(300) / (n * kT(300))));
  const Ir = (T) => Ir300 * (T / 300) ** 1.5 * Math.exp(-(egSi(T) / (2 * kT(T)) - egSi(300) / (2 * kT(300))));
  const current = (U, T) => Is(T) * Math.expm1(U / (n * kT(T))) + Ir(T) * Math.expm1(U / (2 * kT(T)));
  /** 恒流 I（A）时的正向压降（V）：牛顿迭代 */
  const voltage = (I, T) => {
    let U = n * kT(T) * Math.log(I / Is(T) + 1);
    for (let i = 0; i < 40; i++) {
      const f = current(U, T) - I, d = (Is(T) / (n * kT(T))) * Math.exp(U / (n * kT(T))) + (Ir(T) / (2 * kT(T))) * Math.exp(U / (2 * kT(T)));
      const dU = f / d; U -= dU;
      if (Math.abs(dU) < 1e-12) break;
    }
    return U;
  };
  return { n, r, Is, Ir, current, voltage };
}

/** NTC 热敏电阻（Ω） */
export function makeNTC({ R25 = 10e3, B = 3435, g = 2.5e4 } = {}) {
  const R = (T) => { const x = 1 / T - 1 / T25; return R25 * Math.exp(B * x + g * x * x); };
  return { R25, B, g, R };
}
