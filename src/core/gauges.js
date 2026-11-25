// 力学、热学实验通用的长度与时间量具：螺旋测微器、游标卡尺、钢卷尺、电子秒表。
// 每个量具都是一个小状态机：学生转动微分筒/推动尺框夹住被测物，读数窗画出真实的刻度，由学生自己读数。
// 读数分解（主尺部分 + 对齐格数 × 精度）、零点误差、测力装置（棘轮）等做法参考了
// VernierScales（OpenLyceum，AGPL，仅借鉴思路）和 Open Source Physics @ Singapore 的量具模型（CC BY-NC-SA，仅借鉴思路）。
import { clamp, gauss } from './Stats.js';

const FONT = '"IBM Plex Sans", "Microsoft YaHei", Arial';
const MONO = '"IBM Plex Mono", Consolas, monospace';

/** 把读数分解显示在窗口右上角（“读数辅助”打开时） */
function assistBox(g, W, txt, fs) {
  g.font = `${fs}px ${MONO}`;
  const w = g.measureText(txt).width + fs;
  g.fillStyle = 'rgba(18,20,22,.82)'; g.fillRect(W - w - 6, 6, w, fs * 1.6);
  g.fillStyle = '#8fe3a5'; g.textAlign = 'right'; g.fillText(txt, W - 6 - fs / 2, 6 + fs * 1.15);
}

// =============================== 螺旋测微器 ===============================
/**
 * 螺旋测微器（千分尺）：量程 0–25 mm，螺距 0.5 mm，微分筒 50 格，分度值 0.01 mm，估读到 0.001 mm。
 * zero：零点读数（测砧与测杆刚好接触时的示值，mm）。
 * 两个旋钮：微分筒（可以拧过头把工件压扁，示值偏小）；测力装置（棘轮，接触后打滑，示值准确）。
 */
export class Micrometer {
  constructor({ zero = 0, range = 25 } = {}) {
    this.zero = zero; this.range = range;
    this.gap = 5; // 测砧与测杆的间距（mm）
    this.obj = null; // 被测物真实尺寸（mm），null 表示测砧间是空的
    this.squeeze = 0; // 用微分筒硬拧时把工件压缩的量（mm）
    this.locked = false;
  }
  /** 测杆能到达的最小位置：有工件时为工件尺寸（减去压缩量），无工件时为 0 */
  get stop() { return this.obj == null ? 0 : this.obj; }
  get contact() { return this.gap <= this.stop + 1e-9; }
  /** 示值（mm） */
  get reading() { return this.gap - this.squeeze + this.zero; }
  /** 用微分筒直接转：可以越过接触点（把工件压扁，最多约 6 μm），学生会得到偏小的值 */
  turnThimble(v) {
    if (this.locked) return;
    const s = this.stop;
    if (v >= s) { this.gap = Math.min(this.range, v); this.squeeze = 0; return; }
    this.gap = s; this.squeeze = clamp((s - v) * 0.15, 0, this.obj == null ? 0.002 : 0.006);
  }
  /** 用测力装置（棘轮）转：接触后打滑，不会压过头 */
  turnRatchet(v) {
    if (this.locked) return;
    this.gap = clamp(v, this.stop, this.range); this.squeeze = 0;
  }
  /** 放入/取出工件；放入时如果间隙不够，自动退开 */
  setObject(size) {
    this.obj = size; this.squeeze = 0;
    if (size != null && this.gap < size) this.gap = Math.min(this.range, size + 0.5);
  }
  controls(onChange = () => {}) {
    return [
      { type: 'knob', label: '微分筒（粗调）', get: () => this.gap - this.squeeze, set: (v) => { this.turnThimble(v); onChange(); }, min: -0.05, max: this.range, step: 0.01, bigStep: 0.5, perRev: 0.5, digits: 3, unit: 'mm', fmt: () => '转动微分筒', sub: '靠近工件后改用测力装置' },
      { type: 'knob', label: '测力装置（棘轮）', get: () => this.gap, set: (v) => { this.turnRatchet(v); onChange(); }, min: 0, max: this.range, step: 0.002, bigStep: 0.05, perRev: 0.5, digits: 3, unit: 'mm', fmt: () => (this.contact ? '咔咔（已接触）' : '转动测力装置') },
      { type: 'toggle', label: '锁紧装置', get: () => this.locked, set: (v) => { this.locked = v; onChange(); } },
    ];
  }
  /** 状态提示：记录前检查用。返回 null 表示可以读数 */
  problem() {
    if (this.obj == null) return this.gap > 0.003 ? '测砧与测杆没有接触' : null;
    if (!this.contact) return '测砧与测杆还没有夹住工件';
    if (this.squeeze > 0.0015) return '用微分筒直接拧得太紧，把工件压扁了——应在接近时改用测力装置（听到“咔咔”声即停）';
    return null;
  }

  /** 画读数窗：固定套管 + 微分筒（逻辑坐标 W×H） */
  draw(g, W, H, { assist = false } = {}) {
    const r = this.reading;
    g.fillStyle = '#2a2d31'; g.fillRect(0, 0, W, H);
    const fs = Math.round(H * 0.075);
    const yRef = H * 0.5, ppm = W / 7.5; // 每 mm 像素
    const xEdge = W * 0.58; // 微分筒左端固定在窗口中这里，套管随读数平移
    const x0 = xEdge - r * ppm; // 套管上 0 刻线的位置
    // 固定套管
    const sh = H * 0.34;
    const gr = g.createLinearGradient(0, yRef - sh / 2, 0, yRef + sh / 2);
    gr.addColorStop(0, '#9aa2ab'); gr.addColorStop(0.35, '#e9edf0'); gr.addColorStop(1, '#7b838c');
    g.fillStyle = gr; g.fillRect(0, yRef - sh / 2, xEdge, sh);
    g.fillStyle = '#16181a'; g.fillRect(0, yRef - 0.8, xEdge, 1.6);
    g.textAlign = 'center'; g.font = `${fs}px ${FONT}`;
    for (let k = Math.floor((0 - x0) / (ppm / 2)) - 1; ; k++) {
      const x = x0 + (k * ppm) / 2;
      if (x > xEdge - 0.5) break;
      if (x < -2 || k < 0) continue;
      const half = k % 2 === 1, L = half ? sh * 0.2 : k % 10 === 0 ? sh * 0.34 : sh * 0.26;
      g.fillRect(x - 0.7, half ? yRef : yRef - L, 1.4, L);
      if (!half && k % 10 === 0) g.fillText(String(k / 2), x, yRef - sh * 0.36 - 3);
    }
    // 微分筒（圆柱侧面，刻线按投影疏密）
    const tw = W - xEdge, R = H * 0.36;
    const gt = g.createLinearGradient(0, yRef - R, 0, yRef + R);
    gt.addColorStop(0, '#5f666e'); gt.addColorStop(0.3, '#d9dde1'); gt.addColorStop(0.55, '#f4f6f7'); gt.addColorStop(1, '#5a6168');
    g.fillStyle = gt; g.fillRect(xEdge, yRef - R, tw, 2 * R);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(xEdge, yRef - R, 3, 2 * R);
    const t = (((r / 0.01) % 50) + 50) % 50; // 微分筒在基准线处的格数
    g.fillStyle = '#16181a'; g.textAlign = 'left';
    for (let j = Math.floor(t) - 14; j <= Math.ceil(t) + 14; j++) {
      const a = ((j - t) * 2 * Math.PI) / 50;
      if (Math.abs(a) > 1.35) continue;
      const y = yRef - R * Math.sin(a), jj = ((j % 50) + 50) % 50;
      const L = jj % 5 === 0 ? tw * 0.22 : tw * 0.13, th = Math.max(0.5, 1.3 * Math.cos(a));
      g.fillRect(xEdge, y - th / 2, L, th);
      if (jj % 5 === 0 && Math.cos(a) > 0.35) {
        g.save(); g.translate(xEdge + tw * 0.26, y); g.scale(1, Math.cos(a));
        g.font = `${fs}px ${FONT}`; g.fillText(String(jj), 0, fs * 0.36); g.restore();
      }
    }
    if (assist) {
      const main = Math.floor(r / 0.5 + 1e-9) * 0.5, div = (r - main) / 0.01;
      assistBox(g, W, `${main.toFixed(1)} + ${div.toFixed(1)}×0.01 = ${r.toFixed(3)} mm`, fs * 0.95);
    }
    g.fillStyle = '#c9ced3'; g.font = `${fs * 0.9}px ${FONT}`; g.textAlign = 'left';
    g.fillText('固定套管：上方整毫米，下方半毫米', 6, H - 8);
  }
}

// =============================== 游标卡尺 ===============================
/** 50 分度游标卡尺：分度值 0.02 mm，量程 0–150 mm。zero 为零点读数（mm）。 */
export class Caliper {
  constructor({ zero = 0, range = 150, n = 50 } = {}) {
    this.zero = zero; this.range = range; this.n = n; this.lc = 1 / n;
    this.open = 30; this.obj = null;
  }
  get stop() { return this.obj == null ? 0 : this.obj; }
  get contact() { return this.open <= this.stop + 1e-9; }
  get reading() { return this.open + this.zero; }
  push(v) { this.open = clamp(v, this.stop, this.range); }
  setObject(size) { this.obj = size; if (size != null && this.open < size) this.open = Math.min(this.range, size + 5); }
  controls(onChange = () => {}) {
    return [
      { type: 'knob', label: '推动尺框', get: () => this.open, set: (v) => { this.push(v); onChange(); }, min: 0, max: this.range, step: 0.02, bigStep: 1, perRev: 10, digits: 2, unit: 'mm', fmt: () => (this.contact ? '量爪已贴紧' : '推动尺框') },
    ];
  }
  problem() {
    if (this.obj == null) return this.open > 0.01 ? '两量爪没有合拢' : null;
    return this.contact ? null : '量爪还没有贴紧被测物';
  }
  draw(g, W, H, { assist = false } = {}) {
    const r = this.reading, n = this.n;
    g.fillStyle = '#2a2d31'; g.fillRect(0, 0, W, H);
    const fs = Math.round(H * 0.075), ppm = W / 66;
    const xv = W * 0.08; // 游标 0 刻线在窗口中的位置固定，主尺随读数平移
    const xm0 = xv - r * ppm;
    const yb = H * 0.48; // 主尺与游标的分界
    // 主尺
    g.fillStyle = '#d7dbe0'; g.fillRect(0, H * 0.12, W, yb - H * 0.12);
    g.fillStyle = '#16181a'; g.textAlign = 'center'; g.font = `${fs}px ${FONT}`;
    for (let k = Math.max(0, Math.floor(-xm0 / ppm) - 1); ; k++) {
      const x = xm0 + k * ppm;
      if (x > W + 2) break;
      const L = k % 10 === 0 ? H * 0.16 : k % 5 === 0 ? H * 0.12 : H * 0.08;
      g.fillRect(x - 0.6, yb - L, 1.2, L);
      if (k % 10 === 0) g.fillText(String(k / 10), x, yb - H * 0.19);
    }
    g.textAlign = 'left'; g.fillText('cm', 4, H * 0.12 + fs);
    // 游标：n 格对应主尺 n−1 mm
    g.fillStyle = '#b9bfc6'; g.fillRect(0, yb, W, H * 0.3);
    g.fillStyle = '#16181a'; g.textAlign = 'center';
    const dv = ((n - 1) / n) * ppm;
    for (let j = 0; j <= n; j++) {
      const x = xv + j * dv, L = j % 5 === 0 ? H * 0.13 : H * 0.08;
      g.fillRect(x - 0.6, yb, 1.2, L);
      if (j % 5 === 0) g.fillText(String(j / 5), x, yb + H * 0.13 + fs);
    }
    g.fillStyle = '#1b1d20'; g.fillRect(0, yb - 0.5, W, 1);
    if (assist) {
      const main = Math.floor(r + 1e-9), j = Math.round((r - main) / this.lc);
      assistBox(g, W, `${main} + ${j}×${this.lc} = ${(main + j * this.lc).toFixed(2)} mm`, fs * 0.95);
    }
    g.fillStyle = '#c9ced3'; g.font = `${fs * 0.9}px ${FONT}`; g.textAlign = 'left';
    g.fillText(`游标 ${n} 格 = 主尺 ${n - 1} mm，分度值 ${this.lc} mm`, 6, H - 8);
  }
}

// =============================== 钢卷尺 ===============================
/**
 * 钢卷尺/米尺：mm 分度，估读到 0.1 mm（以 cm 记录时到 0.01 cm）。
 * 读数窗画出尺带上被测终点附近的一段，终点处画一条标记线（如夹头下沿、镜面）。
 * 每次“拉尺”时零点对齐有 ±0.3 mm 左右的随机偏差，尺带略有倾斜。
 */
export class Tape {
  constructor({ label = '' } = {}) { this.label = label; this.value = 50; this.offset = 0; }
  /** 设置新的被测长度（cm），重新拉一次尺 */
  measure(trueCm, { sigma = 0.03 } = {}) { this.value = trueCm; this.offset = gauss(sigma); }
  get reading() { return this.value + this.offset; }
  draw(g, W, H, { assist = false, mark = '终点' } = {}) {
    const r = this.reading;
    g.fillStyle = '#2a2d31'; g.fillRect(0, 0, W, H);
    const fs = Math.round(H * 0.08), ppc = W / 5.2; // 每 cm 像素
    const xc = W / 2, x0 = xc - r * ppc;
    const y1 = H * 0.22, y2 = H * 0.7;
    g.fillStyle = '#e9c63b'; g.fillRect(0, y1, W, y2 - y1);
    g.fillStyle = '#16181a'; g.textAlign = 'center';
    for (let k = Math.floor((r - 3) * 10); k <= Math.ceil((r + 3) * 10); k++) {
      const x = x0 + (k / 10) * ppc;
      const L = k % 10 === 0 ? (y2 - y1) * 0.48 : k % 5 === 0 ? (y2 - y1) * 0.32 : (y2 - y1) * 0.2;
      g.fillRect(x - 0.6, y1, 1.2, L);
      if (k % 10 === 0) {
        g.fillStyle = k % 100 === 0 ? '#b91c1c' : '#16181a'; g.font = `bold ${fs * 1.1}px ${FONT}`;
        g.fillText(String(k / 10), x + (k % 100 === 0 ? 0 : 0), y1 + (y2 - y1) * 0.78);
        g.fillStyle = '#16181a';
      }
    }
    // 被测终点标记
    g.fillStyle = '#1d4ed8'; g.fillRect(xc - 1, H * 0.08, 2, H * 0.74);
    g.font = `${fs}px ${FONT}`; g.fillStyle = '#9db8ff'; g.fillText(mark, xc, H * 0.08 - 2 + fs * 0.2);
    if (assist) assistBox(g, W, `${r.toFixed(2)} cm`, fs);
    g.fillStyle = '#c9ced3'; g.font = `${fs * 0.85}px ${FONT}`; g.textAlign = 'left';
    g.fillText(`${this.label}  尺带最小分度 1 mm，估读到 0.1 mm`, 6, H - 8);
  }
}

// =============================== 电子秒表 ===============================
/**
 * 电子秒表：显示到 0.01 s。按键时刻由学生决定（人的反应时间带来 ±0.05–0.1 s 的随机误差，
 * 由调用者在 start/stop 时传入 react）。时间按仿真时钟累加（实验可加速时间流逝）。
 */
export class Stopwatch {
  constructor() { this.t = 0; this.run = false; }
  tick(dt) { if (this.run) this.t += dt; }
  start(react = 0) { if (!this.run) { this.run = true; this.t = Math.max(0, this.t - react); } }
  stop(react = 0) { if (this.run) { this.run = false; this.t = Math.max(0, this.t + react); } }
  reset() { this.run = false; this.t = 0; }
  get shown() { const t = Math.floor(this.t * 100 + 1e-6) / 100; const m = Math.floor(t / 60); return `${String(m).padStart(2, '0')}:${(t - m * 60).toFixed(2).padStart(5, '0')}`; }
  get value() { return Math.floor(this.t * 100 + 1e-6) / 100; }
  draw(g, x, y, w, h) {
    g.fillStyle = '#1c1f22'; g.fillRect(x, y, w, h);
    g.fillStyle = '#9fb59a'; g.fillRect(x + w * 0.06, y + h * 0.16, w * 0.88, h * 0.68);
    g.fillStyle = '#16200f'; g.font = `bold ${h * 0.5}px ${MONO}`; g.textAlign = 'center';
    g.fillText(this.shown, x + w / 2, y + h * 0.68);
    if (this.run) { g.fillStyle = '#16200f'; g.beginPath(); g.arc(x + w * 0.12, y + h * 0.3, h * 0.05, 0, 7); g.fill(); }
  }
}
