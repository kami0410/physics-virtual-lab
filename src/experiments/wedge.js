// 实验：劈尖干涉测细丝直径（读数显微镜 · 等厚干涉）
// 读数显微镜、钠灯、调焦与空程模型沿用“牛顿环”实验，样品换成两块平板玻璃夹细丝形成的空气劈尖。
import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { MAT, mesh, ICONS } from '../core/Models.js';
import { filmIntensity, GLSL_FILM } from '../physics/interference.js';
import { GPU, GLSL } from '../core/gpu.js';
import { NewtonExperiment } from './newton.js';
import { mean, uA, texU, gauss, rand, relErr, pct, sig } from '../core/Stats.js';
import { lineData } from '../core/Plot.js';

const LINES = [[589.0e-6, 1], [589.6e-6, 0.5]];
const LAMBDA = 589.3e-6;
const FOV = 2.4;
const WEDGE_FS = GLSL_FILM + GLSL.sodium + `
uniform float uPos, uS, uXE, uCp, uSp, uLw, uWh, uTan, uB, uPlaced;
float I1(vec2 L) {
  if (uPlaced < 0.5) return 0.3;
  float x = uPos + (L.x - 150.5) * uS, y = (150.5 - L.y) * uS;
  float u = (x - uXE) * uCp + y * uSp;
  if (u < -0.02) return 0.55;
  if (u < 0.0) return 0.06;
  float t = abs(u - uLw);
  if (t < uWh) return 0.03 + 0.25 * pow(max(0.0, 1.0 - t / uWh), 4.0);
  if (u > uLw) return 0.5;
  return filmI(u * uTan);
}
vec3 shade(vec2 L) {
  float d = 0.25 * uPx;
  float I = 0.25 * (I1(L + vec2(-d, -d)) + I1(L + vec2(d, -d)) + I1(L + vec2(-d, d)) + I1(L + vec2(d, d)));
  return sodium(uB * (0.08 + 0.92 * I));
}`;
const BACK = 0.02;
const NS = [0, 10, 20, 30, 40, 50];

export class WedgeExperiment extends NewtonExperiment {
  static meta = {
    id: 'wedge',
    title: '劈尖干涉测细丝直径',
    subtitle: '等厚干涉 · 条纹取向校正 · 逐差法求条纹间距 · 读数显微镜测劈尖长度',
    tags: ['波动光学', '等厚干涉', '读数显微镜'],
    level: '基础',
    time: '30 min',
    color: '#a86a12',
    formula: String.raw`D=\dfrac{L\lambda}{2l}`,
    measure: '细丝直径 D',
    goals: ['观察劈尖等厚干涉条纹，理解条纹间距与劈尖角的关系', '进一步练习读数显微镜的使用', '用劈尖干涉测量细丝的直径'],
    questions: ['劈尖干涉条纹为什么是平行于棱边的等间距直条纹？', '如果条纹不平行于叉丝，会给条纹间距的测量带来什么误差？', '把细丝向棱边方向移动，条纹间距如何变化？'],
  };

  static thumb(ctx, w, h) {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const I = filmIntensity(((x + 0.15 * y) / w) * 2.6e-3, LINES);
      const i = (y * w + x) * 4;
      img.data[i] = 255 * Math.min(1, I * 1.1); img.data[i + 1] = 200 * Math.min(1, I * 1.1); img.data[i + 2] = 40 * I; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  constructor(app) {
    super(app);
    this.Dw = rand(0.06, 0.11); // 细丝直径 mm
    this.Lw = rand(30, 37); // 棱边到细丝中心 mm
    this.xE = rand(7, 10); // 棱边在载物台上的位置（显微镜读数坐标）
    this.phi = rand(3, 7) * (Math.random() < 0.5 ? -1 : 1); // 样品转角：条纹与竖叉丝的夹角 (°)
    this.yOff = 0;
    this.drive = 20 + rand(-1, 1); this.pos = this.drive;
  }
  get tanT() { return this.Dw / this.Lw; }
  get spacing() { return LAMBDA / (2 * this.tanT); }
  get bright() { return (this.lampOn ? this.warm : 0) * Math.exp(-(((this.plate - 45) / 6) ** 2)) * (this.app.comp('wedge').placed ? 1 : 0.6); }
  /** 样品坐标中沿劈尖方向的距离（相对棱边） */
  u(x, y) { const p = (this.phi * Math.PI) / 180; return (x - this.xE) * Math.cos(p) + y * Math.sin(p); }
  thickness(u) { return u < 0 ? null : u * this.tanT; }
  orderAt(x) { return this.u(x, 0) / this.spacing; }
  darkX(k) { return this.xE + k * this.spacing; }

  build() {
    super.build();
    const app = this.app;
    app.comps.delete('newton');
    const z = app.zones.find((zz) => zz.id === 'stage');
    z.accepts = ['wedge'];
    const g = new THREE.Group();
    const glass = MAT.glass(0xe6f3ff, 0.45);
    g.add(mesh(new THREE.BoxGeometry(7.6, 0.25, 2.6), glass, 0, 0.13, 0));
    this.topPlate = mesh(new THREE.BoxGeometry(7.6, 0.25, 2.6), glass, 0, 0.42, 0);
    g.add(this.topPlate);
    const wire = mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 10), MAT.dark(), 3.3, 0.3, 0); wire.rotation.x = Math.PI / 2; g.add(wire);
    this.wedgeGroup = g;
    app.addComponent(new Component({
      key: 'wedge', name: '劈尖（夹细丝的两块平板玻璃）', icon: ICONS.wedge, zone: 'slot', defaultSlot: 'stage', required: true, object: g, labelY: 6,
      desc: '两块光学平板玻璃一端相接（棱边），另一端夹一根待测细丝，形成很薄的空气劈尖。',
      controls: () => [
        { type: 'knob', label: '在载物台上转动样品', get: () => this.phi, set: (v) => (this.phi = v), min: -15, max: 15, step: 0.1, bigStep: 1, perRev: 10, digits: 1, unit: '°', sub: '使干涉条纹与镜筒移动方向垂直' },
        { type: 'knob', label: '在载物台上前后移动', get: () => this.yOff, set: (v) => (this.yOff = v), min: -8, max: 8, step: 0.05, bigStep: 0.5, perRev: 4, digits: 2, unit: 'mm' },
      ],
    }));
  }

  update() {
    super.update();
    this.wedgeGroup.rotation.y = (-this.phi * Math.PI) / 180;
    this.wedgeGroup.position.z = this.yOff * 0.2;
    this.topPlate.rotation.z = -0.03;
  }

  /** CPU 逐像素计算（无 GPU 时使用） */
  cpuEye() {
    const W = 300;
    const placed = this.app.comp('wedge').placed;
    const B = this.bright;
    const o = this.off.getContext('2d');
    const img = o.createImageData(W, W);
    const s = FOV / W;
    const p = (this.phi * Math.PI) / 180, cp = Math.cos(p), sp = Math.sin(p);
    const wHalf = this.Dw / 2;
    for (let py = 0; py < W; py++) {
      const y = (W / 2 - py) * s + this.yOff * 0;
      for (let px = 0; px < W; px++) {
        const x = this.pos + (px - W / 2) * s;
        let I = 0.3;
        if (placed) {
          const u = (x - this.xE) * cp + y * sp;
          if (u < -0.02) I = 0.55; // 棱边以外：只有单块玻璃，均匀反光
          else if (u < 0) I = 0.06; // 棱边（磨砂边缘）
          else if (Math.abs(u - this.Lw) < wHalf) I = 0.03 + 0.25 * Math.max(0, 1 - Math.abs((u - this.Lw) / wHalf)) ** 4; // 细丝
          else if (u > this.Lw) I = 0.5;
          else I = filmIntensity(u * this.tanT, LINES);
        }
        const val = B * (0.08 + 0.92 * I);
        const i = (py * W + px) * 4;
        img.data[i] = 255 * Math.min(1, val * 1.15); img.data[i + 1] = 196 * Math.min(1, val * 1.15); img.data[i + 2] = 50 * val; img.data[i + 3] = 255;
      }
    }
    o.putImageData(img, 0, 0);
  }

  drawEye() {
    const v = this.view, g = v.ctx, W = 300;
    const placed = this.app.comp('wedge').placed;
    const B = this.bright;
    const gpuU = { uPos: this.pos, uS: FOV / W, uXE: this.xE, uCp: Math.cos((this.phi * Math.PI) / 180), uSp: Math.sin((this.phi * Math.PI) / 180), uLw: this.Lw, uWh: this.Dw / 2, uTan: this.tanT, uB: B, uPlaced: placed ? 1 : 0, uL1: LINES[0], uL2: LINES[1] };
    g.save();
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 6, 0, Math.PI * 2); g.clip();
    const blur = Math.abs(this.focus - this.focusZero) * 9;
    g.filter = blur > 0.3 ? `blur(${Math.min(30, blur).toFixed(1)}px)` : 'none';
    if (!GPU.paint(v, 'wedge', WEDGE_FS, gpuU, [0, 0, W, W], g)) { this.cpuEye(); g.drawImage(this.off, 0, 0); }
    g.filter = 'none';
    const cb = Math.abs(this.diopt - this.dioptZero) * 3.2;
    g.translate(W / 2, W / 2); g.rotate((this.rot * Math.PI) / 180);
    g.filter = cb > 0.3 ? `blur(${Math.min(8, cb).toFixed(1)}px)` : 'none';
    g.strokeStyle = 'rgba(10,10,10,.9)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, -W / 2); g.lineTo(0, W / 2); g.moveTo(-W / 2, 0); g.lineTo(W / 2, 0); g.stroke();
    g.restore();
    const gr = g.createRadialGradient(W / 2, W / 2, W * 0.35, W / 2, W / 2, W / 2 - 4);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.75)');
    g.fillStyle = gr; g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 5, 0, Math.PI * 2); g.fill();
    let foot = '';
    if (!this.lampOn) foot = '视场黑暗：钠光灯未打开';
    else if (B < 0.4) foot = '视场较暗：调节 45° 玻片角度';
    else if (!placed) foot = '载物台上没有样品';
    else if (this.assist) {
      const u = this.u(this.pos, 0);
      foot = u < 0 ? '叉丝在棱边以外' : u > this.Lw ? '叉丝在细丝以外' : `叉丝处约为第 ${(u / this.spacing).toFixed(1)} 级暗纹（从棱边数起）· 条纹倾斜 ${this.phi.toFixed(1)}°`;
    }
    v.foot(foot);
  }

  tables() {
    return [
      {
        id: 'f', title: '条纹位置', fixedRows: true,
        initRows: () => NS.map((n) => ({ n })),
        columns: [{ key: 'n', label: '条纹序号 N', digits: 0, readonly: true }, { key: 'x', label: '位置 x/mm', digits: 3 }],
        buttons: [{ label: '记录读数到下一格', onClick: (t) => this.recFringe(t) }],
        note: '任选一条暗纹记为 N = 0，鼓轮沿同一方向转动，每移过 10 条暗纹记录一次位置。',
      },
      {
        id: 'len', title: '劈尖长度', fixedRows: true,
        initRows: () => [{ what: '棱边' }, { what: '细丝（中心）' }],
        columns: [{ key: 'what', label: '', type: 'text', readonly: true }, { key: 'x', label: '位置 x/mm', digits: 3 }],
        buttons: [{ label: '记录读数到下一格', onClick: (t) => this.recLen(t) }],
        note: '叉丝依次对准棱边和细丝中心，L = |x细丝 − x棱边|。',
      },
    ];
  }

  readNow() { return Math.round((this.drive + gauss(0.0015)) * 1000) / 1000; }
  checkCommon() {
    if (this.bright < 0.3 || !this.app.comp('wedge').placed) { this.app.toast('视场中看不到干涉条纹', 'warn'); return false; }
    if (this.lastDir < 0 || this.travel < BACK) this.app.toast('注意：鼓轮刚换向或反向转动，读数含空程误差', 'warn');
    return true;
  }
  recFringe(t) {
    const i = t.rows.findIndex((r) => r.x == null);
    if (i < 0) { this.app.toast('表格已记录完整', 'ok'); return; }
    if (!this.checkCommon()) return;
    const k = this.orderAt(this.pos);
    if (Math.abs(k - Math.round(k)) > 0.15) this.app.toast(`叉丝没有对准暗纹中央（偏离 ${(Math.abs(k - Math.round(k))).toFixed(2)} 条）`, 'warn');
    if (i > 0) {
      const k0 = this.orderAt(t.rows[0].x - BACK / 2);
      const dn = Math.round(k) - Math.round(k0);
      if (Math.abs(Math.abs(dn) - NS[i]) > 0) this.app.toast(`从 N = 0 起已移过约 ${Math.abs(dn)} 条暗纹，而这一格应为 ${NS[i]} 条`, 'warn');
    }
    if (Math.abs(this.phi) > 1) this.app.toast('提示：条纹与叉丝不平行，测得的间距偏大', 'warn');
    t.set(i, 'x', this.readNow());
  }
  recLen(t) {
    const i = t.rows.findIndex((r) => r.x == null);
    if (i < 0) { this.app.toast('表格已记录完整', 'ok'); return; }
    if (!this.checkCommon()) return;
    const u = this.u(this.pos, 0);
    if (i === 0 && Math.abs(u) > 0.03) this.app.toast('叉丝没有对准棱边', 'warn');
    if (i === 1 && Math.abs(u - this.Lw) > 0.04) this.app.toast('叉丝没有对准细丝中心', 'warn');
    t.set(i, 'x', this.readNow());
  }

  steps() {
    const app = this.app;
    const base = super.steps();
    const sharp = () => Math.abs(this.focus - this.focusZero) < 0.06;
    return [
      {
        title: '放置钠光灯与劈尖',
        html: '<p>把<b>劈尖</b>放在读数显微镜的载物台上，棱边朝左；把<b>钠光灯</b>放在显微镜左侧，对准 45° 玻片。</p>',
        check: () => app.comp('wedge').placed && app.comp('lamp').placed,
        auto: async () => { await app.view('全景'); await app.autoPlace('wedge'); await app.autoPlace('lamp'); },
      },
      base[1], base[2], base[3],
      { ...base[4], html: '<p>转动调焦手轮，使镜筒<b>由下向上</b>缓慢升起，直到看清黄黑相间的直条纹。</p>', check: sharp },
      {
        title: '校正条纹取向',
        html: '<p>转动<b>样品</b>，使干涉条纹与镜筒的移动方向垂直；再转动目镜使竖叉丝与条纹平行。判断方法：移动镜筒时，竖叉丝应始终与同一条暗纹重合。</p>',
        check: () => Math.abs(this.phi) < 0.5 && Math.abs(this.rot) < 1,
        status: () => `条纹倾斜 <b>${this.phi.toFixed(1)}°</b>，叉丝转角 <b>${this.rot.toFixed(1)}°</b>`,
        auto: async () => {
          app.select(app.comp('wedge'));
          await app.tween(() => this.phi, (v) => (this.phi = v), gauss(0.1), 1200);
          app.select(app.comp('mic'));
          await app.tween(() => this.rot, (v) => (this.rot = v), gauss(0.2), 800);
        },
      },
      {
        title: '测量条纹间距',
        html: '<p>在劈尖中部选一条暗纹作为 N = 0，鼓轮沿一个方向转动（先多转一点再回来，消除空程），每移过 <b>10 条</b>暗纹记录一次位置，共记录 6 个。</p>',
        hint: '条纹较密，可借助“级次辅助”核对条纹数；关闭辅助后需要自己数。',
        check: () => app.table('f').completeRows().length >= 6,
        status: () => `已记录 <b>${app.table('f').completeRows().length}</b> / 6`,
        auto: async () => {
          await app.view('显微镜'); app.select(app.comp('mic'));
          const t = app.table('f'); app.showTable(app.tables.indexOf(t));
          const k0 = Math.round(this.Lw / this.spacing * 0.35);
          await app.tween(() => this.drive, (v) => this.moveDrive(v), this.darkX(k0) - 0.1, 1200);
          for (let i = 0; i < NS.length; i++) {
            await app.tween(() => this.drive, (v) => this.moveDrive(v), this.darkX(k0 + NS[i]) + BACK / 2 + gauss(0.002), 500);
            await app.record('f');
          }
        },
      },
      {
        title: '测量劈尖长度 L',
        html: '<p>把镜筒移到劈尖<b>棱边</b>左侧，再沿同一方向转动鼓轮，依次使竖叉丝对准<b>棱边</b>和<b>细丝中心</b>，记录读数。</p>',
        check: () => app.table('len').completeRows().length >= 2,
        auto: async () => {
          const t = app.table('len'); app.showTable(app.tables.indexOf(t));
          await app.tween(() => this.drive, (v) => this.moveDrive(v), this.xE - 0.5, 1500);
          await app.tween(() => this.drive, (v) => this.moveDrive(v), this.xE + BACK / 2 + gauss(0.004), 500);
          await app.record('len');
          await app.tween(() => this.drive, (v) => this.moveDrive(v), this.xE + this.Lw + BACK / 2 + gauss(0.005), 2400);
          await app.record('len');
        },
      },
      {
        title: '数据处理：求细丝直径',
        html: '<p>相邻暗纹间距 $l=\\dfrac{\\lambda}{2\\theta}$，劈尖角 $\\theta\\approx D/L$，所以</p>$$D=\\frac{L\\lambda}{2l}$$<p>用逐差法由 6 个位置求 $l$。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const f = this.app.table('f').rows, len = this.app.table('len').rows;
    if (f.some((r) => r.x == null)) return { html: '<p>条纹位置还没有记录完整。</p>', ok: false };
    if (len.some((r) => r.x == null)) return { html: '<p>请记录棱边和细丝的位置。</p>', ok: false };
    const x = f.map((r) => r.x);
    const ds = [0, 1, 2].map((i) => Math.abs(x[i + 3] - x[i]) / 30);
    const l = mean(ds), ul = Math.hypot(uA(ds), (0.005 * Math.SQRT2) / Math.sqrt(3) / 30);
    const L = Math.abs(len[1].x - len[0].x), uL = Math.hypot((0.005 * Math.SQRT2) / Math.sqrt(3), 0.01); // 读数 + 判断棱边、细丝位置
    const D = (L * LAMBDA) / (2 * l), uD = D * Math.hypot(ul / l, uL / L);
    const html = `<h3>条纹间距（逐差法）</h3><table><tr><th>i</th><th>x<sub>i+3</sub> − x<sub>i</sub> /mm</th><th>l = Δx/30 /mm</th></tr>${ds.map((d, i) => `<tr><td>${i + 1}</td><td>${(d * 30).toFixed(3)}</td><td>${d.toFixed(5)}</td></tr>`).join('')}</table>
      <p>$\\bar l=${l.toFixed(5)}$ mm，$u(l)=${sig(ul, 2)}$ mm</p>
      <h3>劈尖长度</h3><p>$L=|x_{细丝}-x_{棱边}|=${L.toFixed(3)}$ mm</p>
      <div class="result-box">$D=\\dfrac{L\\lambda}{2l}=${texU(D * 1000, uD * 1000, '\\mu m')}$</div>
      <div class="plot-wrap"><canvas data-plot="0" style="height:260px"></canvas></div>
      <div class="result-box warn">细丝直径参考值 D₀ = ${(this.Dw * 1000).toFixed(1)} μm（L₀ = ${this.Lw.toFixed(3)} mm），相对误差 ${pct(relErr(D, this.Dw))}。</div>`;
    const ns = NS, k = (x[5] - x[0]) / 50;
    return { html, ok: true, answers: [{ label: '细丝直径 $D$', unit: 'μm', value: D * 1000, digits: 2 }], plots: [{ title: '暗纹位置 x – 条纹序号 N', xLabel: 'N', yLabel: 'x / mm', series: [
      { type: 'scatter', data: ns.map((n, i) => [n, x[i]]), label: '实验数据', radius: 4 },
      { type: 'line', data: lineData(k, x[0], 0, 50), label: `斜率 ≈ ${Math.abs(k).toFixed(4)} mm/条` },
    ] }] };
  }

  principle() {
    return `<h3>1. 劈尖干涉</h3><p>两块平板玻璃一端相接、另一端夹一细丝，形成夹角很小的空气劈尖。单色光垂直入射时，空气层上下表面的反射光干涉，暗纹条件</p>$$2e+\\frac\\lambda2=(2k+1)\\frac\\lambda2\\ \\Rightarrow\\ e_k=\\frac{k\\lambda}{2}$$<p>厚度相同处干涉情况相同，条纹是平行于棱边的等间距直条纹。相邻暗纹对应的厚度差为 $\\lambda/2$，间距 $l=\\dfrac{\\lambda}{2\\theta}$。</p>
<h3>2. 细丝直径</h3><p>$\\theta\\approx\\tan\\theta=D/L$，所以 $D=\\dfrac{L\\lambda}{2l}$。条纹总数 $N=L/l$ 很大，逐条数不现实，因此先测条纹间距，再测劈尖长度。</p>
<h3>3. 本仿真的计算模型</h3><p>程序对视场中每一点按样品转角求出到棱边的距离 $u$、空气层厚度 $e=u\\,D/L$，对钠 D 双线作双光束干涉叠加。由于双线的“拍”，条纹衬比度沿劈尖缓慢变化。样品转角使条纹与镜筒移动方向不垂直时，测得的间距会偏大 $1/\\cos\\varphi$ 倍。</p>`;
  }
}
