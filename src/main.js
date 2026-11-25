import 'katex/dist/katex.min.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles.css';
import { tex } from './core/tex.js';
import { CATALOG as EXPERIMENTS } from './experiments/catalog.js';
import { michelsonPattern } from './physics/interference.js';

const root = document.getElementById('app');

// 滑块已划过的一段着色（Chromium 没有 ::range-progress）：用户拖动时立即更新，程序改值（自动演示）由低频巡检补上
const fillRange = (r) => {
  const lo = +r.min || 0, hi = r.max === '' ? 100 : +r.max, f = hi > lo ? ((+r.value - lo) / (hi - lo)) * 100 : 0;
  const s = `${Math.max(0, Math.min(100, f)).toFixed(1)}%`;
  if (r.style.getPropertyValue('--fill') !== s) r.style.setProperty('--fill', s);
};
document.addEventListener('input', (e) => { if (e.target.type === 'range') fillRange(e.target); }, true);
setInterval(() => { if (!document.hidden) document.querySelectorAll('input[type=range]').forEach(fillRange); }, 300);
let current = null;
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

let seq = 0;
async function route() {
  const m = location.hash.match(/^#\/exp\/(\w+)/);
  const my = ++seq;
  if (current) { current.dispose(); current = null; }
  if (/^#\/wave/.test(location.hash)) {
    document.title = '衍射工作台 · 大学物理实验虚拟仿真';
    root.innerHTML = `<div class="boot"><div class="boot-t">衍射工作台</div><div class="boot-s">正在载入衍射计算模块…</div></div>`;
    let WaveLab;
    try { ({ WaveLab } = await import('./wave/WaveLab.js')); } catch (err) { console.error(err); root.innerHTML = `<div class="boot"><div class="boot-t">衍射工作台</div><div class="boot-s">载入失败，请检查网络后<a href="#/">返回目录</a>重试。</div></div>`; return; }
    if (my !== seq) return;
    current = new WaveLab(root, { onExit: () => { current = null; location.hash = '#/'; } });
    window.__wave = current;
    return;
  }
  if (/^#\/bench/.test(location.hash)) {
    document.title = '光路设计台 · 大学物理实验虚拟仿真';
    root.innerHTML = `<div class="boot"><div class="boot-t">光路设计台</div><div class="boot-s">正在载入光线追迹引擎与玻璃库…</div></div>`;
    let Bench;
    try { ({ Bench } = await import('./bench/Bench.js')); } catch (err) { console.error(err); root.innerHTML = `<div class="boot"><div class="boot-t">光路设计台</div><div class="boot-s">载入失败，请检查网络后<a href="#/">返回目录</a>重试。</div></div>`; return; }
    if (my !== seq) return;
    current = new Bench(root, { onExit: () => { current = null; location.hash = '#/'; } });
    window.__bench = current;
    return;
  }
  if (m) {
    const E = EXPERIMENTS.find((e) => e.meta.id === m[1]);
    if (E) {
      document.title = `${E.meta.title} · 大学物理实验虚拟仿真`;
      root.innerHTML = `<div class="boot"><div class="boot-t">${E.meta.title}</div><div class="boot-s">正在载入仪器与物理模型…</div></div>`;
      // 实验本体与三维引擎按需加载：目录页不必下载全部实验
      let App, Exp;
      try {
        [{ App }, Exp] = await Promise.all([import('./core/App.js'), E.load()]);
      } catch (err) {
        // 网站更新后旧页面引用的分块文件已不存在：刷新一次取新版本；仍失败（如断网且未缓存）则提示
        let tried = false;
        try { tried = sessionStorage.getItem('lab-reload') === location.hash; sessionStorage.setItem('lab-reload', location.hash); } catch { /* 无存储时直接提示 */ tried = true; }
        if (!tried) { location.reload(); return; }
        if (my === seq) root.innerHTML = `<div class="boot"><div class="boot-t">${E.meta.title}</div><div class="boot-s">实验文件载入失败，请检查网络后<a href="#/">返回目录</a>重试。</div></div>`;
        console.error(err);
        return;
      }
      try { sessionStorage.removeItem('lab-reload'); } catch { /* 忽略 */ }
      if (my !== seq) return; // 载入期间又切换了页面
      current = new App(root, Exp, { onExit: () => { current = null; location.hash = '#/'; } });
      window.__app = current;
      return;
    }
  }
  document.title = '大学物理实验虚拟仿真';
  renderHome();
}

const PARTS = ['力学', '热学', '电磁学', '光学', '近代物理'];
const partOf = (E) => E.meta.part || (E.meta.tags.includes('近代物理') ? '近代物理' : E.meta.tags.includes('电学') ? '电磁学' : '光学');

function renderHome() {
  const n = EXPERIMENTS.length;
  const ordered = PARTS.flatMap((p) => EXPERIMENTS.filter((E) => partOf(E) === p));
  root.innerHTML = `
  <div class="home"><div class="home-inner">
    <header class="masthead">
      <div>
        <div class="eyebrow">大学物理实验 · 三维仿真</div>
        <h1>大学物理实验<br><em>虚拟仿真</em>实验室</h1>
        <p>从器材柜取出仪器，自己摆放、调节、接线，读数并记录，最后完成数据处理与实验报告。光学实验要共轴、调焦、对准；电学实验要选量程、连电路、注意安全。卡住时可以让某一步自动完成，或者用“一键运行”看完整的规范操作。每次开始实验，待测样品的参数都会重新随机生成。</p>
        <div class="facts"><span><b>${n}</b>个实验项目</span><span><b>25</b>类自研物理计算模型</span><span><b>2</b>个开放工作台</span><span>电脑、手机浏览器直接打开，可离线运行</span></div>
      </div>
      <div class="eyepiece"><canvas id="heroCv" width="272" height="272"></canvas><div class="cap">He-Ne 632.8 nm · 等倾干涉 · 实时计算</div></div>
    </header>

    <div class="features">
    <a class="feature" href="#/bench">
      <div class="feature-fig"><canvas id="benchCv" width="560" height="200"></canvas></div>
      <div class="feature-txt">
        <div class="eyebrow">开放工作台 · 几何光学</div>
        <h2>光路设计台</h2>
        <p>在光学平台上自由摆放激光器、透镜、反射镜、棱镜、光栅和光屏，逐条光线实时追迹。折射率按 Sellmeier 公式随波长变化，界面反射按菲涅耳公式分配能量，自动标出实像与虚像，光屏给出光强分布。</p>
        <div class="chips"><span>20 个典型光路</span><span>431 种光学玻璃</span><span>点列图 · 像差曲线 · 场曲</span><span>偏振 · 双折射 · 波片</span><span>分享链接</span></div>
        <span class="go">打开光路设计台 →</span>
      </div>
    </a>
    <a class="feature" href="#/wave">
      <div class="feature-fig"><canvas id="waveCv" width="560" height="200"></canvas></div>
      <div class="feature-txt">
        <div class="eyebrow">开放工作台 · 波动光学</div>
        <h2>衍射工作台</h2>
        <p>任选衍射屏，改变波长、光源距离与观察距离，在网格上数值计算光场传播。拖动观察距离，可以连续看到菲涅耳衍射过渡到夫琅禾费衍射，并与理论公式对照。</p>
        <div class="chips"><span>圆孔 · 圆屏 · 单缝 · 双缝</span><span>光栅 · 矩孔 · 直边</span><span>白光衍射</span><span>部分相干 · 相干长度</span><span>角谱法 / 菲涅耳变换</span><span>GPU 加速</span></div>
        <span class="go">打开衍射工作台 →</span>
      </div>
    </a>
    </div>

    <div class="toc-head"><h2>目 录</h2><span>单击进入实验</span></div>
    <nav class="toc-nav">${PARTS.filter((p) => EXPERIMENTS.some((E) => partOf(E) === p)).map((p) => `<a href="#part-${PARTS.indexOf(p)}" data-part="${PARTS.indexOf(p)}">${p}<span>${EXPERIMENTS.filter((E) => partOf(E) === p).length}</span></a>`).join('')}
      <label class="toc-find"><svg class="i" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="m10.4 10.4 3.1 3.1"/></svg><input id="tocFind" type="search" placeholder="查找实验：名称、方法或仪器" autocomplete="off"></label></nav>
    <p class="toc-none" hidden>没有找到相关实验，换个关键词试试，比如“干涉”“电桥”“示波器”。</p>
    ${PARTS.filter((p) => EXPERIMENTS.some((E) => partOf(E) === p)).map((p) => `<div class="toc-part" id="part-${PARTS.indexOf(p)}"><h3>${p}</h3><span>${EXPERIMENTS.filter((E) => partOf(E) === p).length} 个实验</span></div>
    <div class="toc">${ordered.map((E, i) => (partOf(E) !== p ? '' : `
      <div class="toc-row" data-id="${E.meta.id}" tabindex="0" role="link">
        <div class="toc-no">实验<b>${String(i + 1).padStart(2, '0')}</b></div>
        <div class="toc-thumb"><canvas data-th="${EXPERIMENTS.indexOf(E)}" width="144" height="144"></canvas></div>
        <div class="toc-title"><h3>${E.meta.title}</h3><p>${E.meta.subtitle}</p><div class="kw">${E.meta.tags.join(' / ')}</div></div>
        <div class="toc-formula">${E.meta.formula ? `<div class="fx">${splitFormula(E.meta.formula).map((f) => `<span>${tex(f)}</span>`).join('')}</div>` : ''}<small>测量：${(E.meta.measure || '').replace(/([A-Za-zμ])_([A-Za-z0-9]+)/g, '$1<sub>$2</sub>')}</small></div>
        <div class="toc-meta">${E.meta.level} · 约 ${E.meta.time}<span class="go">进入实验 →</span></div>
      </div>`)).join('')}
    </div>`).join('')}

    <section class="notes">
      <h2>使用说明</h2>
      <ol>
        <li><span><b>摆放仪器与接线。</b>把右侧器材柜中的仪器拖到导轨或实验台的位置上，也可以单击自动放置。电学实验中点一个接线柱、再点另一个接线柱即连上导线，点导线可拆除。</span></li>
        <li><span><b>调节仪器。</b>单击场景中的仪器，右侧出现它的旋钮、手轮和开关。旋钮可以拖动转盘，也可以点 ‹ › 单步微调或滚动鼠标滚轮。</span></li>
        <li><span><b>观察现象。</b>视野右上角的观察窗显示像屏、目镜视场和读数鼓轮，点 ⤢ 放大。图样都由物理模型实时算出。</span></li>
        <li><span><b>记录数据。</b>点击数据区的记录按钮读取仪器示数，也可以直接在表格里输入。像没调清晰、空程没消除时会给出提示。</span></li>
      </ol>
      <ol start="5">
        <li><span><b>数据处理。</b>最小二乘拟合、逐差法和不确定度评定自动完成，绘出实验图线，并与本次样品的参考值比较。</span></li>
        <li><span><b>一键运行。</b>从当前步骤开始自动完成剩余实验，速度可选 1×–8×，随时可以停止并接手操作。</span></li>
        <li><span><b>实验报告。</b>生成包含原理、装置截图、原始数据、图线和结果的报告，可打印或另存为 PDF。</span></li>
        <li><span><b>运行环境。</b>Chrome / Edge / Firefox 等支持 WebGL 2 的浏览器；集成显卡、4 GB 内存即可流畅运行，推荐 1920×1080 分辨率。</span></li>
      </ol>
    </section>
    <div class="colophon"><span>计算核心：矩阵光学 · 非序列光线追迹 · 角谱法衍射 · 穆勒矩阵 · 电路改进节点法与牛顿迭代</span><span>开源组件：three.js（MIT）· KaTeX（MIT）· IBM Plex Mono（OFL-1.1）· Optica Viva 透镜追迹与玻璃库（MIT）</span><span>数据：CIE 1931 色匹配函数（Wyman 等 2013 解析拟合）· refractiveindex.info 玻璃目录（CC0）</span></div>
  </div></div>`;
  root.querySelectorAll('.toc-row').forEach((c) => {
    const go = () => (location.hash = `#/exp/${c.dataset.id}`);
    c.addEventListener('click', go);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
  fitFormulas();
  bindTocNav();
  root.querySelectorAll('canvas[data-th]').forEach((cv) => {
    const E = EXPERIMENTS[+cv.dataset.th];
    const ctx = cv.getContext('2d');
    try { E.thumb && E.thumb(ctx, cv.width, cv.height); } catch (err) { console.error(`缩略图绘制失败：${E.meta.id}`, err); }
  });
  heroAnim();
  benchThumb();
  waveThumb();
}

/** 目录里的公式按顶层的“,\quad”拆成几段，每段单独成行不折断 */
function splitFormula(f) {
  const out = []; let depth = 0, last = 0;
  for (let i = 0; i < f.length; i++) {
    const c = f[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      const m = /^,\s*\\q?quad\s*/.exec(f.slice(i));
      if (m) { out.push(f.slice(last, i)); last = i + m[0].length; i = last - 1; }
    }
  }
  out.push(f.slice(last));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** 公式比栏宽还宽时整体缩小，而不是折行 */
function fitFormulas() {
  root.querySelectorAll('.toc-formula .fx > span').forEach((sp) => {
    sp.style.fontSize = '';
    const box = sp.parentElement.clientWidth;
    if (box && sp.scrollWidth > box) sp.style.fontSize = `${Math.max(0.62, box / sp.scrollWidth).toFixed(3)}em`;
  });
}

/** 目录导航：分部锚点高亮当前所在部分；查找框按名称、副标题、关键词过滤 */
function bindTocNav() {
  const home = root.querySelector('.home'), nav = root.querySelector('.toc-nav');
  if (!home || !nav) return;
  const links = [...nav.querySelectorAll('[data-part]')];
  links.forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const t = root.querySelector(`#part-${a.dataset.part}`);
    if (t) home.scrollTo({ top: t.offsetTop - nav.offsetHeight - 8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }));
  const parts = links.map((a) => root.querySelector(`#part-${a.dataset.part}`));
  const spy = () => {
    nav.classList.toggle('stuck', nav.getBoundingClientRect().top <= home.getBoundingClientRect().top + 1);
    let cur = -1;
    parts.forEach((p, i) => { if (p && !p.hidden && p.getBoundingClientRect().top - home.getBoundingClientRect().top < nav.offsetHeight + 40) cur = i; });
    links.forEach((a, i) => a.classList.toggle('on', i === cur));
  };
  home.addEventListener('scroll', spy, { passive: true });
  spy();
  const inp = nav.querySelector('#tocFind'), none = root.querySelector('.toc-none');
  const text = new Map([...root.querySelectorAll('.toc-row')].map((r) => {
    const E = EXPERIMENTS.find((x) => x.meta.id === r.dataset.id);
    return [r, `${E.meta.title} ${E.meta.subtitle || ''} ${E.meta.tags.join(' ')} ${E.meta.measure || ''}`.toLowerCase()];
  }));
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    root.querySelectorAll('.toc').forEach((toc) => {
      let n = 0;
      toc.querySelectorAll('.toc-row').forEach((r) => { const ok = q.every((w) => text.get(r).includes(w)); r.hidden = !ok; n += ok; });
      toc.hidden = n === 0; toc.previousElementSibling.hidden = n === 0;
      const sp = toc.previousElementSibling.querySelector('span');
      if (sp) sp.textContent = q.length ? `找到 ${n} 个` : `${toc.querySelectorAll('.toc-row').length} 个实验`;
      shown += n;
    });
    none.hidden = shown > 0;
    links.forEach((a) => { const p = root.querySelector(`#part-${a.dataset.part}`); a.classList.toggle('off', !!p && p.hidden); });
    fitFormulas(); spy();
  });
}
window.addEventListener('resize', () => { if (root.querySelector('.home')) fitFormulas(); });

/** 首页“衍射工作台”插图：单缝从近场到远场（每列一个观察距离，逐列数值计算） */
async function waveThumb() {
  const cv = document.getElementById('waveCv');
  if (!cv) return;
  const W = await import('./physics/wavefield.js');
  if (!document.body.contains(cv)) return;
  const g = cv.getContext('2d'), Wd = cv.width, Hd = cv.height, N = 256, lam = 632.8e-6, a = 0.4;
  const img = g.createImageData(Wd, Hd);
  const cols = 70;
  for (let c = 0; c < cols; c++) {
    const z = Math.pow(10, 0.3 + (c / (cols - 1)) * 3.2);
    const L = Math.max(1.6 * (a + 10 * Math.sqrt(lam * z)), 1.2 * a);
    // 一维计算：只需一行，用 N×N 网格的中间行近似（缝沿竖直方向）
    const F = W.mask(W.begin(N, L, lam), (x) => (Math.abs(x) <= a / 2 ? 1 : 0), 2);
    const out = z <= (L * L) / (N * lam) ? W.angularSpectrum(F, z) : W.fresnelFar(F, z);
    const row = new Float64Array(N); let mx = 0;
    for (let j = 0; j < N; j++) { const k = (N / 2) * N + j; row[j] = out.re[k] ** 2 + out.im[k] ** 2; mx = Math.max(mx, row[j]); }
    const half = 2.2; // 显示 ±2.2 mm
    for (let x = Math.floor((c * Wd) / cols); x < Math.floor(((c + 1) * Wd) / cols); x++) for (let y = 0; y < Hd; y++) {
      const X = ((y / Hd) * 2 - 1) * half, j = Math.round(X / out.dx + N / 2);
      const v = j >= 0 && j < N ? Math.pow(row[j] / mx, 0.6) : 0, p = (y * Wd + x) * 4;
      img.data[p] = 255 * v; img.data[p + 1] = 40 * v; img.data[p + 2] = 30 * v; img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** 首页“光路设计台”插图：真实追迹一次三棱镜色散 */
async function benchThumb() {
  const cv = document.getElementById('benchCv');
  if (!cv) return;
  const [{ traceScene }, { compile, makeElement }, { PRESETS }, { wavelengthToRGB }] = await Promise.all([import('./physics/rays2d.js'), import('./bench/elements.js'), import('./bench/presets.js'), import('./physics/color.js')]);
  if (!document.body.contains(cv)) return;
  const els = PRESETS.find((p) => p.id === 'prism').build().filter((e) => e.type !== 'detector');
  const c = compile(els), r = traceScene({ ...c, opts: { partial: true } });
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, s = 3.2, ox = W * 0.42, oy = H * 0.55;
  g.fillStyle = '#141817'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#0b0d0d';
  for (let x = ox % (25 * s); x < W; x += 25 * s) for (let y = oy % (25 * s); y < H; y += 25 * s) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
  g.setTransform(s, 0, 0, -s, ox, oy);
  for (const sh of c.shapes) if (sh.kind === 'glass') { g.beginPath(); sh.edges.forEach((e, i) => { if (i === 0) g.moveTo(...e.a); g.lineTo(...e.b); }); g.closePath(); g.fillStyle = 'rgba(120,170,215,.2)'; g.fill(); g.strokeStyle = 'rgba(170,205,240,.8)'; g.lineWidth = 1 / s; g.stroke(); }
  g.globalCompositeOperation = 'lighter'; g.lineWidth = 1.6 / s;
  for (const sg of r.segs) { const k = wavelengthToRGB(sg.lam); g.strokeStyle = `rgba(${k[0] * 255 | 0},${k[1] * 255 | 0},${k[2] * 255 | 0},${Math.min(1, 0.9 * Math.pow(sg.rel, 0.5))})`; g.beginPath(); g.moveTo(...sg.a); g.lineTo(...sg.b); g.stroke(); }
}

function heroAnim() {
  const cv = document.getElementById('heroCv');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cv.width, cv.height);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  const loop = () => {
    if (!document.body.contains(cv)) return;
    const t = (performance.now() - t0) / 1000;
    // 动镜匀速移动：圆环从中心不断“冒出”
    const d = 0.62 + (reduce ? 0 : t * 0.00025);
    michelsonPattern(img, { d, lambda: 632.8e-6, halfW: 36, beamW: 40 });
    ctx.putImageData(img, 0, 0);
    if (!reduce) setTimeout(() => requestAnimationFrame(loop), 40);
  };
  loop();
}

window.addEventListener('hashchange', route);
route();

// 网站版：注册离线缓存，访问过一次后断网也能使用，并可“安装到主屏幕/桌面”。单文件版与开发模式不需要。
if (import.meta.env.PROD && import.meta.env.MODE !== 'single' && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
