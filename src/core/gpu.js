// GPU 逐像素计算光强分布（WebGL2 片元着色器）。
// 干涉、衍射图样每个像素都要算若干次三角函数，在显卡上并行计算比 JS 快两个数量级，
// 而且可以按观察窗的实际分辨率出图（放大后仍清晰）。没有 WebGL2、只有软件渲染或精度不够时，
// 自动回退到 CPU（实验里原有的逐像素循环）。
//
// 用法：GPU.paint(view, 'newton', GLSL, uniforms, rect)
//   GLSL 中定义 vec3 shade(vec2 L)，L 为观察窗的逻辑坐标（与 CPU 代码里的像素坐标一致），返回 0..1 的 RGB。
const VS = `#version 300 es
in vec2 aP; out vec2 vU;
void main() { vU = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
const HEAD = `#version 300 es
precision highp float;
in vec2 vU; out vec4 oC;
uniform vec4 uRect; // 本次出图覆盖的逻辑矩形 x0, y0, w, h
uniform float uPx;  // 一个输出像素对应的逻辑长度
`;
const TAIL = `
void main() { vec2 L = uRect.xy + vec2(vU.x, 1.0 - vU.y) * uRect.zw; oC = vec4(clamp(shade(L), 0.0, 1.0), 1.0); }`;

class GpuField {
  constructor() { this.st = undefined; this.progs = new Map(); this.stats = { n: 0, ms: 0 }; }

  get mode() { try { return localStorage.getItem('compute') || 'auto'; } catch { return 'auto'; } }
  set mode(v) { try { localStorage.setItem('compute', v); } catch { /* 忽略 */ } this.st = undefined; }

  init() {
    if (this.st !== undefined) return this.st;
    this.st = null;
    this.progs.clear(); // 着色器程序属于旧的 GL 上下文
    if (this.mode === 'cpu') return null;
    try {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl2', { antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl) return null;
      const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!hp || hp.precision < 23) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      // 软件光栅化（SwiftShader、llvmpipe 等）比 JS 还慢，除非手动指定
      if (this.mode !== 'gpu' && /swiftshader|llvmpipe|software|basic render/i.test(name)) return null;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.st = null; this.progs.clear(); });
      this.st = { cv, gl, buf, name, texs: [], maxTex: Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE)) };
    } catch { this.st = null; }
    return this.st;
  }
  get ok() { return !!this.init(); }
  get renderer() { const s = this.init(); return s ? s.name : 'CPU'; }

  program(key, body) {
    const st = this.init();
    let p = this.progs.get(key);
    if (p && p.body === body) return p;
    const gl = st.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('GLSL: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, HEAD + body + TAIL));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('GLSL link: ' + gl.getProgramInfoLog(prog));
    p = { prog, body, loc: new Map(), aP: gl.getAttribLocation(prog, 'aP') };
    this.progs.set(key, p);
    return p;
  }

  /**
   * 一维光强分布的采样位置：按观察窗可见部分、实际像素密度确定采样数，
   * 返回 { n, x0, step }，第 j 个采样点的逻辑横坐标为 x0 + (j + 0.5)·step。
   */
  samples(view, rect = [0, 0, view.W, view.H], perPx = 1, maxN = 4096) {
    const vr = view.visRect ? view.visRect() : [0, 0, view.W, view.H];
    const x0 = Math.max(rect[0], vr[0]), x1 = Math.min(rect[0] + rect[2], vr[0] + vr[2]);
    const w = Math.max(1e-6, x1 - x0);
    const n = Math.max(2, Math.min(maxN, Math.ceil(w * (view.scale || 1) * perPx)));
    return { n, x0, step: w / n };
  }

  /**
   * 计算逻辑矩形 rect=[x,y,w,h] 内的图样，按观察窗当前分辨率（只算可见部分）画到 ctx（逻辑坐标）。
   * 成功返回 true；GPU 不可用或出错返回 false（调用方改用 CPU）。
   */
  paint(view, key, body, uniforms, rect = [0, 0, view.W, view.H], ctx = view.ctx) {
    const st = this.init();
    if (!st) return false;
    try {
      const t0 = performance.now();
      // 可见部分
      const vr = view.visRect ? view.visRect() : [0, 0, view.W, view.H];
      const x0 = Math.max(rect[0], vr[0]), y0 = Math.max(rect[1], vr[1]);
      const x1 = Math.min(rect[0] + rect[2], vr[0] + vr[2]), y1 = Math.min(rect[1] + rect[3], vr[1] + vr[3]);
      if (x1 <= x0 || y1 <= y0) return true;
      let s = view.scale || 1;
      const maxPx = 4e6;
      if ((x1 - x0) * (y1 - y0) * s * s > maxPx) s = Math.sqrt(maxPx / ((x1 - x0) * (y1 - y0)));
      const pw = Math.max(1, Math.ceil((x1 - x0) * s)), ph = Math.max(1, Math.ceil((y1 - y0) * s));
      const { gl, cv } = st;
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      const p = this.program(key, body);
      gl.viewport(0, 0, pw, ph);
      gl.useProgram(p.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, st.buf);
      gl.enableVertexAttribArray(p.aP);
      gl.vertexAttribPointer(p.aP, 2, gl.FLOAT, false, 0, 0);
      let unit = 0;
      const set = (name, v) => {
        if (!p.loc.has(name)) p.loc.set(name, gl.getUniformLocation(p.prog, name));
        const l = p.loc.get(name); if (l == null) return;
        if (v && v.tex) { // 一维查找表（浮点纹理，着色器内用 lut() 线性插值）
          const d = v.tex, n = Math.min(d.length, st.maxTex);
          const t = st.texs[unit] || (st.texs[unit] = gl.createTexture());
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, n, 1, 0, gl.RED, gl.FLOAT, d.length === n ? d : d.subarray(0, n));
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.uniform1i(l, unit++);
          return;
        }
        if (typeof v === 'number' || typeof v === 'boolean') gl.uniform1f(l, +v);
        else if (v instanceof Float32Array) gl.uniform1fv(l, v);
        else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
        else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
        else gl.uniform1fv(l, new Float32Array(v));
      };
      set('uRect', [x0, y0, x1 - x0, y1 - y0]);
      set('uPx', (x1 - x0) / pw);
      for (const k in uniforms) set(k, uniforms[k]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cv, 0, 0, pw, ph, x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
      this.stats.n++; this.stats.ms += performance.now() - t0;
      return true;
    } catch (err) {
      console.warn('GPU 计算失败，改用 CPU：', err.message);
      this.st = null;
      return false;
    }
  }
}

export const GPU = new GpuField();

/** 常用 GLSL 片段 */
export const GLSL = {
  // 一维查找表线性插值，x 以采样序号为单位
  lut: `float lut(sampler2D t, float x) {
  int n = textureSize(t, 0).x; float xc = clamp(x, 0.0, float(n - 1)); int i = int(floor(xc));
  return mix(texelFetch(t, ivec2(i, 0), 0).r, texelFetch(t, ivec2(min(i + 1, n - 1), 0), 0).r, xc - float(i));
}`,
  // 目镜视场中的竖直条纹（杨氏双缝、双棱镜等）：横向分布查表 × 纵向渐暗，颜色与 CPU 版一致
  band: `uniform sampler2D uProf; uniform float uX0, uStep, uGain, uH, uYc;
vec3 shade(vec2 L) {
  float p = lut(uProf, (L.x - uX0) / uStep - 0.5);
  float q = (L.y - uYc) / (uH * 0.62);
  float val = max(0.0, p * (1.0 - q * q)) * uGain;
  return vec3(min(1.0, val * 1.1), 0.7451 * min(1.0, val), 0.1569 * min(1.0, val));
}`,
  // 钠黄光的显示颜色（与 CPU 代码一致）
  sodium: `vec3 sodium(float val) { return vec3(min(1.0, val * 1.15), 0.7686 * min(1.0, val * 1.15), 0.196 * val); }`,
};
if (typeof window !== 'undefined') window.labGPU = GPU;
