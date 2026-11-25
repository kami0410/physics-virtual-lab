// 三线摆的精确动力学（不作小角近似）。
// 下盘绕竖直轴转过 θ 时，悬点水平距离 s² = R² + r² − 2Rr·cosθ，下盘比上盘低 z = √(l² − s²)。
// 拉格朗日函数 L = ½Iθ̇² + ½Mż² + Mgz，ż = z′(θ)θ̇，得
//   (I + Mz′²)θ̈ + Mz′z″θ̇² − Mgz′ + cθ̇ = 0，  z′ = −Rr·sinθ / z，z″ = −(Rr·cosθ + z′²)/z
// 小振幅时 T = 2π√(IH/(MgRr))。另有一个摆动（下盘整体水平摆动）模式，只影响观察，不与转动耦合。

export class Trifilar {
  /** R、r：下、上盘悬点到中心的距离（m）；H：两盘间距（m）；g：重力加速度 */
  constructor({ R, r, H, g = 9.794 }) {
    this.R = R; this.r = r; this.H = H; this.g = g;
    this.l = Math.sqrt(H * H + (R - r) ** 2); // 悬线长
    this.M = 1; this.I = 1; this.c = 0; // 质量、转动惯量、阻尼系数
    this.th = 0; this.w = 0; this.t = 0;
    this.sw = 0; this.swPh = 0; // 摆动模式的振幅（m）与相位
  }
  /** 下盘高度及其对 θ 的一、二阶导数 */
  zz(th) {
    const { R, r, l } = this, s2 = R * R + r * r - 2 * R * r * Math.cos(th);
    const z = Math.sqrt(Math.max(1e-12, l * l - s2));
    const z1 = (-R * r * Math.sin(th)) / z;
    const z2 = -(R * r * Math.cos(th) + z1 * z1) / z;
    return [z, z1, z2];
  }
  acc(th, w) {
    const [, z1, z2] = this.zz(th), M = this.M;
    return (M * this.g * z1 - M * z1 * z2 * w * w - this.c * w) / (this.I + M * z1 * z1);
  }
  /** 小振幅周期 */
  get T0() { return 2 * Math.PI * Math.sqrt((this.I * this.H) / (this.M * this.g * this.R * this.r)); }
  /** 积分 dt 秒；每次 θ 由负变正（向正方向经过平衡位置）时调用 onCross(精确时刻) */
  step(dt, onCross) {
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const th0 = this.th, w0 = this.w;
      const k1t = w0, k1w = this.acc(th0, w0);
      const k2t = w0 + (h / 2) * k1w, k2w = this.acc(th0 + (h / 2) * k1t, w0 + (h / 2) * k1w);
      const k3t = w0 + (h / 2) * k2w, k3w = this.acc(th0 + (h / 2) * k2t, w0 + (h / 2) * k2w);
      const k4t = w0 + h * k3w, k4w = this.acc(th0 + h * k3t, w0 + h * k3w);
      this.th = th0 + (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
      this.w = w0 + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
      if (th0 < 0 && this.th >= 0 && onCross) onCross(this.t + (h * -th0) / (this.th - th0));
      this.t += h;
    }
    // 摆动模式：单摆周期 2π√(H/g)，空气阻尼较大
    if (this.sw > 1e-6) { this.sw *= Math.exp(-dt / 25); this.swPh += (2 * Math.PI * dt) / (2 * Math.PI * Math.sqrt(this.H / this.g)); }
  }
  /** 当前转动振幅（由能量换算，rad） */
  get amp() {
    const [z] = this.zz(this.th), [z0] = this.zz(0);
    const E = 0.5 * this.I * this.w * this.w + this.M * this.g * (z0 - z);
    // 小角：E = ½·MgRr/H·θm²
    return Math.sqrt(Math.max(0, (2 * E * this.H) / (this.M * this.g * this.R * this.r)));
  }
}
