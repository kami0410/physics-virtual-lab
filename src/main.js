import 'katex/dist/katex.min.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles.css';
import { App, renderMath, tex } from './core/App.js';
import { EXPERIMENTS } from './experiments/index.js';
import { michelsonPattern } from './physics/interference.js';

const root = document.getElementById('app');
let current = null;
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function route() {
  const m = location.hash.match(/^#\/exp\/(\w+)/);
  if (current) { current.dispose(); current = null; }
  if (m) {
    const E = EXPERIMENTS.find((e) => e.meta.id === m[1]);
    if (E) {
      document.title = `${E.meta.title} · 大学物理实验虚拟仿真`;
      current = new App(root, E, { onExit: () => { current = null; location.hash = '#/'; } });
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
        <div class="facts"><span><b>${n}</b>个实验项目</span><span><b>15</b>类自研物理计算模型</span><span>电脑、手机浏览器直接打开，可离线运行</span></div>
      </div>
      <div class="eyepiece"><canvas id="heroCv" width="272" height="272"></canvas><div class="cap">He-Ne 632.8 nm · 等倾干涉 · 实时计算</div></div>
    </header>

    <div class="toc-head"><h2>目 录</h2><span>单击进入实验</span></div>
    ${PARTS.filter((p) => EXPERIMENTS.some((E) => partOf(E) === p)).map((p) => `<div class="toc-part"><h3>${p}</h3><span>${EXPERIMENTS.filter((E) => partOf(E) === p).length} 个实验</span></div>
    <div class="toc">${ordered.map((E, i) => (partOf(E) !== p ? '' : `
      <div class="toc-row" data-id="${E.meta.id}" tabindex="0" role="link">
        <div class="toc-no">实验<b>${String(i + 1).padStart(2, '0')}</b></div>
        <div class="toc-thumb"><canvas data-th="${EXPERIMENTS.indexOf(E)}" width="144" height="144"></canvas></div>
        <div class="toc-title"><h3>${E.meta.title}</h3><p>${E.meta.subtitle}</p><div class="kw">${E.meta.tags.join(' / ')}</div></div>
        <div class="toc-formula">${E.meta.formula ? tex(E.meta.formula) : ''}<small>测量：${E.meta.measure || ''}</small></div>
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
    <div class="colophon"><span>计算核心：矩阵光学 · 干涉与衍射数值计算 · 穆勒矩阵 · 电路改进节点法与牛顿迭代</span><span>Three.js 程序化建模与渲染</span></div>
  </div></div>`;
  root.querySelectorAll('.toc-row').forEach((c) => {
    const go = () => (location.hash = `#/exp/${c.dataset.id}`);
    c.addEventListener('click', go);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
  root.querySelectorAll('canvas[data-th]').forEach((cv) => {
    const E = EXPERIMENTS[+cv.dataset.th];
    const ctx = cv.getContext('2d');
    E.thumb && E.thumb(ctx, cv.width, cv.height);
  });
  heroAnim();
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
export { renderMath };
