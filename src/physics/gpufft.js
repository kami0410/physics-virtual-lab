// 衍射传播的 GPU 计算：WebGL2 浮点纹理上的二维 FFT（Stockham 自排序基 2 算法，每趟一个片元着色器；
// 算法见 Govindaraju et al., "High Performance Discrete Fourier Transforms on Graphics Processors", SC 2008。本文件为独立实现）。
// 透过率由 CPU 算一次（与波长无关），各波长的二次相位、正反 FFT、角谱传递函数与 |U|² 都在显卡上完成，
// 只把光强读回。单精度下的处理：
//   · 角谱传递函数去掉与频率无关的整体相位 2πz/λ，只保留 −2πzλf²/(1+√(1−λ²f²))（数值小得多，光强不受影响）；
//   · 远场法输出面的二次相位不影响光强，不计算。
// 首次使用时与 CPU 结果对比自检，误差超过 1e-3 即停用（老显卡、移动端低精度 sin/cos 等），回退 CPU。
import { GPU } from '../core/gpu.js';
import { begin, circAperture, angularSpectrum, fresnelFar, intensity } from './wavefield.js';

const VS = `#version 300 es
in vec2 aP; void main() { gl_Position = vec4(aP, 0.0, 1.0); }`;
const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
out vec4 oC;
const float PI = 3.14159265358979;
const float TAU = 6.28318530717959;
`;
const FS = {
  // 光场 = 透过率 × exp(i·uQ·r²)；远场法再乘 (−1)^(i+j)，使 FFT 后零频位于网格中心
  prep: `uniform sampler2D uM; uniform float uN, uDx, uQ, uChk;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = texelFetch(uM, p, 0).r;
  float x = (float(p.x) - uN * 0.5) * uDx, y = (float(p.y) - uN * 0.5) * uDx;
  float ph = mod(uQ * (x * x + y * y), TAU);
  if (uChk > 0.5 && ((p.x + p.y) & 1) == 1) m = -m;
  oC = vec4(m * cos(ph), m * sin(ph), 0.0, 0.0);
}`,
  // Stockham 基 2 的一趟：子变换长度 uNs，沿 x（uDir=0）或 y（uDir=1），uSg = −1 正变换 / +1 逆变换
  fft: `uniform sampler2D uT; uniform int uNs, uN, uDir; uniform float uSg;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int o = uDir == 0 ? p.x : p.y;
  int k = o % uNs, r = (o / uNs) & 1, j = (o / (2 * uNs)) * uNs + k;
  ivec2 pa = p, pb = p;
  if (uDir == 0) { pa.x = j; pb.x = j + uN / 2; } else { pa.y = j; pb.y = j + uN / 2; }
  vec2 a = texelFetch(uT, pa, 0).xy, b = texelFetch(uT, pb, 0).xy;
  float ang = uSg * PI * float(k) / float(uNs);
  vec2 w = vec2(cos(ang), sin(ang));
  vec2 wb = vec2(w.x * b.x - w.y * b.y, w.x * b.y + w.y * b.x);
  oC = vec4(r == 0 ? a + wb : a - wb, 0.0, 0.0);
}`,
  // 带限角谱传递函数（去掉整体相位）
  asm: `uniform sampler2D uT; uniform float uN, uDf, uLam, uZ, uFlim;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float fx = (float(p.x) < uN * 0.5 ? float(p.x) : float(p.x) - uN) * uDf;
  float fy = (float(p.y) < uN * 0.5 ? float(p.y) : float(p.y) - uN) * uDf;
  float f2 = fx * fx + fy * fy, s = uLam * uLam * f2;
  if (s >= 1.0 || abs(fx) > uFlim || abs(fy) > uFlim) { oC = vec4(0.0); return; }
  float ph = mod(-TAU * uZ * uLam * f2 / (1.0 + sqrt(1.0 - s)), TAU);
  vec2 v = texelFetch(uT, p, 0).xy;
  float c = cos(ph), sn = sin(ph);
  oC = vec4(v.x * c - v.y * sn, v.x * sn + v.y * c, 0.0, 0.0);
}`,
  // |U|²·uS，每个输出纹素存 x 方向相邻 4 个像素，读回的数据量减为四分之一
  inten: `uniform sampler2D uT; uniform float uS;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 o;
  for (int q = 0; q < 4; q++) { vec2 v = texelFetch(uT, ivec2(p.x * 4 + q, p.y), 0).xy; o[q] = (v.x * v.x + v.y * v.y) * uS; }
  oC = o;
}`,
};

class GpuWave {
  constructor() { this.st = undefined; this.verified = undefined; this.stats = { n: 0, ms: 0 }; }

  init() {
    if (this.st !== undefined) return this.st;
    this.st = null;
    if (typeof document === 'undefined' || GPU.mode === 'cpu') return null;
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const gl = cv.getContext('webgl2', { antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
      const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!hp || hp.precision < 23) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      if (GPU.mode !== 'gpu' && /swiftshader|llvmpipe|software|basic render/i.test(name)) return null;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const progs = {};
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const vs = sh(gl.VERTEX_SHADER, VS);
      for (const [k, src] of Object.entries(FS)) {
        const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, HEAD + src)); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        progs[k] = { p, loc: {}, aP: gl.getAttribLocation(p, 'aP') };
      }
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.st = null; });
      this.st = { gl, buf, progs, name, N: 0, maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    } catch (err) { console.warn('GPU 衍射计算不可用：', err.message); this.st = null; }
    return this.st;
  }

  /** 是否可以用 GPU 算 N×N 网格（首次调用时自检） */
  ok(N) {
    const st = this.init();
    if (!st || N > st.maxTex || N < 8) return false;
    if (this.verified === undefined) this.verified = this.selfTest();
    return this.verified;
  }
  get renderer() { return this.st ? this.st.name : ''; }

  tex(gl, w, hgt, fmt, type, data = null) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, hgt, 0, fmt === gl.R32F ? gl.RED : gl.RGBA, type, data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  fbo(gl, t) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; }

  /** 为 N×N 网格分配纹理：两块复数乒乓纹理、透过率纹理、打包的光强纹理 */
  ensure(N) {
    const st = this.st, gl = st.gl;
    if (st.N === N) return;
    for (const k of ['A', 'B', 'M', 'I']) if (st[k]) { gl.deleteTexture(st[k].t); if (st[k].f) gl.deleteFramebuffer(st[k].f); }
    const mk = (w, fmt) => { const t = this.tex(gl, w, N, fmt, gl.FLOAT); return { t, f: fmt === gl.R32F ? null : this.fbo(gl, t) }; };
    st.A = mk(N, gl.RGBA32F); st.B = mk(N, gl.RGBA32F); st.M = mk(N, gl.R32F); st.I = mk(N / 4, gl.RGBA32F);
    st.N = N; st.mask = null;
    st.read = new Float32Array(N * N);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('浮点帧缓冲不可用');
  }

  pass(name, out, w, hgt, uniforms, src) {
    const { gl, progs, buf } = this.st, P = progs[name];
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.f);
    gl.viewport(0, 0, w, hgt);
    gl.useProgram(P.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(P.aP);
    gl.vertexAttribPointer(P.aP, 2, gl.FLOAT, false, 0, 0);
    const loc = (k) => (k in P.loc ? P.loc[k] : (P.loc[k] = gl.getUniformLocation(P.p, k)));
    if (src) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform1i(loc(name === 'prep' ? 'uM' : 'uT'), 0); }
    for (const [k, v] of Object.entries(uniforms)) { const l = loc(k); if (l == null) continue; if (k === 'uNs' || k === 'uN' && name === 'fft' || k === 'uDir') gl.uniform1i(l, v); else gl.uniform1f(l, v); }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** 二维 FFT：结果所在的纹理（乒乓后） */
  fft2(src, sg) {
    const st = this.st, N = st.N;
    let a = src, b = a === st.A ? st.B : st.A;
    for (const dir of [0, 1]) for (let Ns = 1; Ns < N; Ns *= 2) { this.pass('fft', b, N, N, { uNs: Ns, uN: N, uDir: dir, uSg: sg }, a); [a, b] = [b, a]; }
    return a;
  }

  /**
   * 计算一个波长的观察面光强。mask：N×N 透过率（Float32Array，行优先，y 为行）；
   * L：网格边长 mm；lam：波长 mm；R：点光源距离（0 为平行光）；z：传播距离；method：'asm' | 'fresnel'。
   * 返回 Float64Array（与 CPU 版 intensity(angularSpectrum / fresnelFar) 同样的归一化）。
   */
  run({ mask, N, L, lam, R, z, method }) {
    const t0 = performance.now();
    this.ensure(N);
    const st = this.st, gl = st.gl;
    if (st.mask !== mask) {
      gl.bindTexture(gl.TEXTURE_2D, st.M.t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RED, gl.FLOAT, mask);
      st.mask = mask;
    }
    const far = method === 'fresnel', dx = L / N;
    const Q = (Math.PI / lam) * ((R > 0 ? 1 / R : 0) + (far ? 1 / z : 0));
    this.pass('prep', st.A, N, N, { uN: N, uDx: dx, uQ: Q, uChk: far ? 1 : 0 }, st.M);
    let cur = this.fft2(st.A, -1), scale;
    if (far) scale = ((dx * dx) / (lam * z)) ** 2;
    else {
      const df = 1 / L, fLim = 1 / (lam * Math.sqrt((2 * df * z) ** 2 + 1));
      const nxt = cur === st.A ? st.B : st.A;
      this.pass('asm', nxt, N, N, { uN: N, uDf: df, uLam: lam, uZ: z, uFlim: fLim }, cur);
      cur = this.fft2(nxt, 1);
      scale = 1 / (N * N) ** 2;
    }
    this.pass('inten', st.I, N / 4, N, { uS: scale }, cur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.I.f);
    gl.readPixels(0, 0, N / 4, N, gl.RGBA, gl.FLOAT, st.read);
    const I = Float64Array.from(st.read);
    this.stats.n++; this.stats.ms += performance.now() - t0;
    return I;
  }

  /** 与 CPU 结果对比：64×64 圆孔，近场角谱法与远场菲涅耳法各一次 */
  selfTest() {
    try {
      const N = 64, L = 4, lam = 6.328e-4;
      for (const [method, z] of [['asm', 20], ['fresnel', 400]]) {
        const F = circAperture(begin(N, L, lam), 1.2);
        const mask = Float32Array.from(F.re);
        const ref = intensity(method === 'asm' ? angularSpectrum(F.clone(), z) : fresnelFar(F, z));
        const got = this.run({ mask, N, L, lam, R: 0, z, method });
        let mx = 0, err = 0;
        for (let k = 0; k < ref.length; k++) { mx = Math.max(mx, ref[k]); err = Math.max(err, Math.abs(ref[k] - got[k])); }
        if (!(err <= 1e-3 * mx)) { console.warn(`GPU 衍射自检未通过（${method}，相对误差 ${(err / mx).toExponential(2)}），改用 CPU`); return false; }
      }
      this.stats = { n: 0, ms: 0 };
      return true;
    } catch (err) { console.warn('GPU 衍射自检出错，改用 CPU：', err.message); return false; }
  }
}

export const GW = new GpuWave();
if (typeof window !== 'undefined') window.labGW = GW;
