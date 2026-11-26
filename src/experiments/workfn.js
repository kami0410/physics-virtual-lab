// 实验：金属电子逸出功的测定（理查森直线法）
// 理想二极管：直热式纯钨丝阴极（直径 0.05 mm，有效长度 16 mm）装在半径 4.2 mm 的圆筒阳极中心，阳极两端有保护环，管内高真空。
// 发射电流按理查森–杜什曼公式加肖特基效应计算（physics/thermionic.js）。钨的逸出功、有效发射面积个体随机；
// 灯丝温度由灯丝电流按说明书的标定关系 T = 920 + 1600·I_f 给出，实际温度与它有约 0.3% 的出入。
// 灯丝有热惯性：改变灯丝电流后温度按约 2.5 s 的时间常数趋于平衡，读数稳定后才能记录。
import * as THREE from 'three';
import { meta, thumb } from './workfn.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, gauss, clamp, relErr, pct, linFit } from '../core/Stats.js';
import { anodeCurrent, tempOfIf, richardsonLine, K_EV } from '../physics/thermionic.js';

const IFS = [0.55, 0.6, 0.65, 0.7, 0.75];
const UAS = [16, 25, 36, 49, 64, 81, 100, 121, 144];
const PHI_W = 4.54; // 钨的逸出功公认值（eV）
const TAU = 2.5; // 灯丝热时间常数（s）
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class WorkFunctionExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.tube = { phi: rand(4.5, 4.58), AS: 1.5 * rand(0.8, 1.2), r1: 0.0025, r2: 0.42, kc: 5.6e-5 };
    this.dT = gauss(0.003);
    this.power = false; this.If = 0; this.Ua = 0; this.T = 300;
  }
  /** 灯丝电流 If 下的平衡温度（真实值） */
  Teq(If = this.If) { return this.power && If > 0.2 ? tempOfIf(If) * (1 + this.dT) : 300; }
  Ia(T = this.T) { return this.power && T > 1000 ? anodeCurrent(this.Ua, T, this.tube) : 0; }
  /** 阳极电流表显示（μA，4 位有效数字） */
  fmtIa(I) { const u = I * 1e6; return u < 10 ? u.toFixed(3) : u < 100 ? u.toFixed(2) : u.toFixed(1); }
  /** 读数是否已经稳定（与平衡时的读数相差不到末位的两个字） */
  stable() {
    if (!this.power) return false;
    const a = this.Ia(this.T), b = this.Ia(this.Teq());
    return Math.abs(a - b) <= 0.0012 * b + 1e-12;
  }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 62, 86], target: [0, 8, -6] }, { name: '仪表', pos: [14, 30, 30], target: [14, 6, -18] }, { name: '二极管', pos: [-26, 26, 28], target: [-26, 14, -4] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(150, 90));
    app.stage.setLightTarget(0, 6, 0);
    // 理想二极管（竖直放在管座上）
    const tg = new THREE.Group(); tg.position.set(-26, 0, -4);
    tg.add(mesh(new THREE.BoxGeometry(14, 3, 14), MAT.paint(0x2b3440), 0, 1.5, 0));
    tg.add(mesh(new THREE.CylinderGeometry(3.2, 3.6, 2, 24), MAT.black(), 0, 4, 0));
    tg.add(mesh(new THREE.CylinderGeometry(3.4, 3.4, 18, 32, 1, true), MAT.glass(0xdfeff7, 0.22), 0, 14, 0));
    tg.add(mesh(new THREE.SphereGeometry(3.4, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.glass(0xdfeff7, 0.22), 0, 23, 0));
    const anode = mesh(new THREE.CylinderGeometry(1.6, 1.6, 8, 28, 1, true), MAT.metal(), 0, 14, 0); anode.material.side = THREE.DoubleSide; tg.add(anode);
    for (const y of [8.6, 19.4]) tg.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 28, 1, true), MAT.alu(), 0, y, 0));
    this.fil = mesh(new THREE.CylinderGeometry(0.07, 0.07, 15, 6), MAT.emissive(0xffb347, 0), 0, 14, 0); tg.add(this.fil);
    this.glow = new THREE.PointLight(0xffb060, 0, 30); this.glow.position.set(0, 14, 0); tg.add(this.glow);
    for (const x of [-1.2, 0, 1.2]) tg.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 6), MAT.chrome(), x, 6, 0.6));
    app.addComponent(new Component({
      key: 'tube', name: '理想二极管', zone: 'none', fixed: true, object: tg, labelY: 30,
      icon: SVG('<rect x="22" y="4" width="20" height="32" rx="10"/><path d="M32 8v24" stroke-width="2"/><rect x="26" y="12" width="12" height="16"/>'),
      desc: '直热式纯钨丝阴极，装在圆筒形阳极的轴线上，阳极两端有保护环（只收集中间一段灯丝发射的电子，避开灯丝两端温度较低的部分）。灯丝直径 0.05 mm，阳极半径 4.2 mm。<br>灯丝温度标定（说明书）：T = 920 + 1600·I<sub>f</sub>（K，I<sub>f</sub> 以 A 为单位），如 0.55 A → 1800 K，0.75 A → 2120 K。',
    }));
    // 逸出功测定仪
    const box = new THREE.Group(); box.position.set(14, 0, -18);
    box.add(mesh(new THREE.BoxGeometry(64, 12, 16), MAT.paint(0xd6d3cb), 0, 6, 0));
    const mf = (this.fBox = meterBox(18, 9, 1, '灯丝电流')); mf.group.position.set(-20, 1.6, 7.6); box.add(mf.group);
    const mu = (this.uBox = meterBox(18, 9, 1, '阳极电压')); mu.group.position.set(0, 1.6, 7.6); box.add(mu.group);
    const mi = (this.iBox = meterBox(18, 9, 1, '阳极电流')); mi.group.position.set(20, 1.6, 7.6); box.add(mi.group);
    this.led = mesh(new THREE.SphereGeometry(0.5, 12, 8), MAT.emissive(0x22c55e, 0), -29, 10, 8.2); box.add(this.led);
    app.addComponent(new Component({
      key: 'supply', name: '逸出功测定仪', zone: 'none', fixed: true, required: true, object: box, labelY: 16,
      desc: '内含灯丝恒流电源（0–0.800 A，分辨 1 mA）、阳极直流电源（0–200 V）和三块数字表。阳极电流表自动换档，显示 4 位有效数字（μA）。改变灯丝电流后灯丝温度要过几秒才稳定，等阳极电流示数不再变化再读。',
      controls: () => [
        { type: 'toggle', label: '电源', get: () => this.power, set: (v) => { this.power = v; app.changed(); } },
        { type: 'knob', label: '灯丝电流', get: () => this.If, set: (v) => { this.If = Math.round(clamp(v, 0, 0.8) * 1000) / 1000; app.changed(); }, min: 0, max: 0.8, step: 0.001, bigStep: 0.01, perRev: 0.05, digits: 3, unit: 'A' },
        { type: 'knob', label: '阳极电压', get: () => this.Ua, set: (v) => { this.Ua = Math.round(clamp(v, 0, 200)); app.changed(); }, min: 0, max: 200, step: 1, bigStep: 10, perRev: 20, digits: 0, unit: 'V' },
        { type: 'readout', label: '阳极电流', get: () => (this.power ? `${this.fmtIa(this.Ia())} μA${this.stable() ? '' : '（示数在变）'}` : '电源未开') },
      ],
    }));
  }
  tick(dt) {
    const a = this.app, sdt = Math.min(5, dt * (a.running ? a.speed * 3 : 1));
    const Te = this.Teq();
    this.T = Te + (this.T - Te) * Math.exp(-sdt / TAU);
    this.show();
  }
  show() {
    const on = this.power, sI = on ? this.fmtIa(this.Ia()) : '', sF = on ? this.If.toFixed(3) : '', sU = on ? this.Ua.toFixed(0) : '';
    if (sI !== this._sI) { this._sI = sI; this.iBox.setText(sI, on ? 'μA' : '', on ? '自动量程' : ''); }
    if (sF !== this._sF) { this._sF = sF; this.fBox.setText(sF, on ? 'A' : '', on ? '恒流' : ''); }
    if (sU !== this._sU) { this._sU = sU; this.uBox.setText(sU, on ? 'V' : '', on ? '直流' : ''); }
    const g = clamp((this.T - 900) / 1300, 0, 1);
    this.fil.material.emissiveIntensity = 3 * g * g; this.fil.material.emissive.setHSL(0.08 + 0.05 * g, 1, 0.5);
    this.glow.intensity = 6 * g * g * g;
    this.led.material.emissiveIntensity = on ? 1.6 : 0;
  }
  update() { this.show(); }

  // ======================= 数据表 =======================
  tables() {
    const cols = UAS.map((u) => ({ key: `u${u}`, label: `${u} V`, readTol: (ref) => 0.004 * ref + 0.002 }));
    return [
      {
        id: 'ia', title: '阳极电流 I_a/μA（行：灯丝电流；列：阳极电压）', fixedRows: true,
        initRows: () => IFS.map((If) => ({ If })),
        columns: [{ key: 'If', label: 'I_f/A', digits: 3, readonly: true }, ...cols],
        buttons: [{ label: '记录当前阳极电流', onClick: (t) => this.rec(t) }],
        note: '灯丝电流依次调到表中各值，等示数稳定后，阳极电压依次取 16、25、36 … 144 V，每次记下阳极电流。',
      },
    ];
  }
  rec(t) {
    const a = this.app;
    if (!this.power) return a.toast('电源没有打开', 'warn');
    const i = t.rows.findIndex((r) => Math.abs(r.If - this.If) < 0.0005);
    if (i < 0) return a.toast(`灯丝电流 ${this.If.toFixed(3)} A 不在表中，调到 ${IFS.map((x) => x.toFixed(2)).join('、')} A 之一`, 'warn');
    if (!UAS.includes(this.Ua)) return a.toast(`阳极电压 ${this.Ua} V 不在表中，调到 ${UAS.join('、')} V 之一`, 'warn');
    if (!this.stable()) a.toast('阳极电流还在变：灯丝温度没有稳定，等示数不变再记录', 'warn');
    t.set(i, `u${this.Ua}`, +this.fmtIa(this.Ia()));
  }

  // ======================= 自动操作 =======================
  async adj(key, to, ms = 300) { const a = this.app; a.select(a.comp('supply')); await a.tween(() => this[key], (v) => (this[key] = v), to, ms); this[key] = to; a.changed(); await a.wait(80); }
  steps() {
    const app = this.app, rows = () => app.table('ia').rows;
    const filled = (r) => UAS.filter((u) => typeof r[`u${u}`] === 'number' && !(r._pend && r._pend[`u${u}`])).length;
    return [
      {
        title: '打开电源，加热灯丝',
        html: '<p>打开逸出功测定仪的电源，阳极电压先调到 16 V，灯丝电流慢慢调到 0.550 A。观察管内灯丝发光，阳极电流示数逐渐增大并稳定下来。</p>',
        hint: '灯丝电流不要超过 0.80 A，以免灯丝过热烧断或蒸发变细。',
        check: () => this.power && this.If >= 0.5 && this.stable(),
        status: () => (!this.power ? '电源未开' : this.If < 0.5 ? `灯丝电流 ${this.If.toFixed(3)} A，还没加到 0.55 A` : this.stable() ? '灯丝温度已稳定' : '灯丝正在升温'),
        auto: async () => {
          await app.view('仪表'); app.select(app.comp('supply'));
          this.power = true; app.renderInspector(); app.changed(); await app.wait(150);
          await this.adj('Ua', 16); await this.adj('If', 0.55, 600);
          await app.until(() => this.stable(), 30000);
        },
      },
      {
        title: '测各温度下的阳极电流',
        html: '<p>灯丝电流依次取 0.550、0.600、0.650、0.700、0.750 A。每改变一次灯丝电流，等阳极电流稳定后，阳极电压依次取 16、25、36、49、64、81、100、121、144 V，记下阳极电流 $I_a$。</p>',
        hint: '阳极电压取平方数，√U_a 就是整数 4、5、6…12，作 lg I_a–√U_a 图时很方便。',
        status: () => `已完成 ${rows().filter((r) => filled(r) === UAS.length).length} 个灯丝电流，共 ${rows().reduce((s, r) => s + filled(r), 0)} 个读数`,
        check: () => rows().filter((r) => filled(r) >= 6).length >= 4,
        diagnose: () => (!this.power ? [{ msg: '电源没有打开。', fix: { label: '打开', run: async () => { this.power = true; } } }] : []),
        auto: async () => {
          app.showTable(0); await app.view('仪表');
          if (!this.power) { app.select(app.comp('supply')); this.power = true; app.renderInspector(); app.changed(); }
          for (const If of IFS) {
            const r = rows().find((x) => Math.abs(x.If - If) < 1e-6);
            if (filled(r) === UAS.length) continue;
            await this.adj('If', If, 400);
            await app.until(() => this.stable(), 30000);
            for (const u of UAS) {
              if (typeof r[`u${u}`] === 'number') continue;
              await this.adj('Ua', u, 200);
              await app.until(() => this.stable(), 30000);
              await app.record('ia', 0);
            }
          }
          await this.adj('If', 0, 400);
        },
      },
      {
        title: '数据处理',
        html: '<p>对每个灯丝温度作 $\\lg I_a$–$\\sqrt{U_a}$ 直线，外延到 $U_a=0$ 得零场电流 $I$；再作 $\\lg(I/T^2)$–$1/T$ 直线，由斜率求逸出功。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, t = a.table('ia');
    const R = t.rows.map((r) => {
      const pts = UAS.map((u) => [u, t.value(r, `u${u}`)]).filter(([, v]) => typeof v === 'number' && v > 0);
      return { If: r.If, T: tempOfIf(r.If), pts };
    }).filter((r) => r.pts.length >= 3);
    if (R.length < 2) return { html: '<p>请先测量并记录至少两个灯丝电流下的阳极电流（每个至少 3 个阳极电压）。</p>', ok: false };
    for (const r of R) { r.fit = linFit(r.pts.map(([u]) => Math.sqrt(u)), r.pts.map(([, v]) => Math.log10(v * 1e-6))); r.I = 10 ** r.fit.b; }
    const L = richardsonLine(R.map((r) => ({ T: r.T, I: r.I }))), fitR = linFit(R.map((r) => 1 / r.T), R.map((r) => Math.log10(r.I / r.T ** 2)));
    const phi = L.phi, err = relErr(phi, PHI_W);
    const tbl = `<table><tr><th>I<sub>f</sub>/A</th><th>T/K</th><th>lg I<sub>a</sub>–√U<sub>a</sub> 斜率</th><th>lg I</th><th>I/A</th><th>lg(I/T²)</th><th>(1/T)/10⁻⁴ K⁻¹</th></tr>${R.map((r) => `<tr><td>${r.If.toFixed(3)}</td><td>${r.T.toFixed(0)}</td><td>${r.fit.k.toFixed(4)}</td><td>${r.fit.b.toFixed(3)}</td><td>${r.I.toExponential(3)}</td><td>${Math.log10(r.I / r.T ** 2).toFixed(3)}</td><td>${(1e4 / r.T).toFixed(4)}</td></tr>`).join('')}</table>`;
    const sk = R.map((r) => r.fit.k * r.T), skm = sk.reduce((s, v) => s + v, 0) / sk.length;
    const html = `<h3>1. 外延求零场电流</h3><p>阳极电场使阴极表面势垒降低（肖特基效应）：$\\lg I_a=\\lg I+\\dfrac{0.439}{2.303\\,T}\\sqrt{E_c}$，而阴极表面场强 $E_c=\\dfrac{U_a}{r_1\\ln(r_2/r_1)}\\propto\\sqrt{U_a}$ 中的比例系数与温度无关，所以每个温度下 $\\lg I_a$ 与 $\\sqrt{U_a}$ 成直线。外延到 $U_a=0$，截距就是零场发射电流的 $\\lg I$。</p>${tbl}
      <p>各温度直线的斜率乘以 $T$ 应当相同（肖特基效应的系数与温度无关）：本次为 ${sk.map((v) => v.toFixed(1)).join('、')} K（平均 ${skm.toFixed(1)} K），可作为数据质量的检查。</p>
      <h3>2. 理查森直线</h3><p>$\\lg\\dfrac{I}{T^2}=\\lg AS-\\dfrac{e\\varphi}{2.303\\,kT}=\\lg AS-5.040\\times10^3\\,\\dfrac{\\varphi}{T}$（$\\varphi$ 以伏特为单位）。作 $\\lg(I/T^2)$–$1/T$ 直线，斜率 $m=${L.k.toFixed(1)}$ K（r = ${fitR.r.toFixed(5)}），$AS$ 只影响截距，不必知道。</p>
      <div class="result-box">逸出电位 $\\varphi=-\\dfrac{m}{5.040\\times10^3}=${phi.toFixed(3)}$ V，逸出功 $e\\varphi=${phi.toFixed(3)}$ eV</div>
      <p>钨的公认值 4.54 eV，相对误差 ${pct(err)}。截距 $\\lg AS=${L.b.toFixed(3)}$，即 $AS$ ≈ ${(10 ** L.b).toFixed(2)} A/K²。</p>
      <p>误差主要来自灯丝温度：温度由灯丝电流按标定式换算，若实际温度系统偏高 1%，$1/T$ 整体缩小 1%，斜率变大约 1%，$\\varphi$ 也就偏大约 1%。灯丝两端温度较低（热量被引线带走），保护环挡掉两端的电子可以减小这一影响。</p>`;
    const answers = [{ label: '钨的逸出功 $e\\varphi$', unit: 'eV', value: phi, digits: 3, tolRel: 0.01 }];
    const plots = [
      { title: 'lg I_a – √U_a', xLabel: '√U_a / √V', yLabel: 'lg(I_a / A)', series: R.flatMap((r) => [{ type: 'scatter', data: r.pts.map(([u, v]) => [Math.sqrt(u), Math.log10(v * 1e-6)]), label: `${r.If.toFixed(2)} A` }, { type: 'line', data: [0, 12].map((x) => [x, r.fit.k * x + r.fit.b]), label: '' }]) },
      { title: '理查森直线 lg(I/T²) – 1/T', xLabel: '1/T / 10⁻⁴ K⁻¹', yLabel: 'lg(I/T²)', series: [{ type: 'scatter', data: R.map((r) => [1e4 / r.T, Math.log10(r.I / r.T ** 2)]), label: '实验点' }, { type: 'line', data: [Math.min(...R.map((r) => 1 / r.T)), Math.max(...R.map((r) => 1 / r.T))].map((x) => [1e4 * x, L.k * x + L.b]), label: '拟合' }] },
    ];
    return { html, ok: true, answers, plots };
  }

  principle() {
    const k5040 = (1 / (K_EV * Math.LN10)).toFixed(0);
    return `<h3>1. 热电子发射</h3><p>金属中的自由电子要逸出表面，必须克服表面势垒做功 $e\\varphi$，$e\\varphi$ 叫逸出功（$\\varphi$ 叫逸出电位）。把金属加热到足够高的温度，一部分电子的热运动能量超过势垒而逸出，这就是热电子发射。按费米–狄拉克统计，发射电流（理查森–杜什曼公式）为</p>$$I=AST^2\\exp\\left(-\\frac{e\\varphi}{kT}\\right)$$<p>$A$ 为与材料表面状态有关的常数（理论值 120 A·cm⁻²·K⁻²），$S$ 为阴极的有效发射面积。</p>
<h3>2. 理查森直线法</h3><p>$A$ 和 $S$ 都很难测准。两边除以 $T^2$ 取常用对数：</p>$$\\lg\\frac{I}{T^2}=\\lg AS-\\frac{e\\varphi}{2.303\\,kT}=\\lg AS-${k5040}\\,\\frac{\\varphi}{T}$$<p>$\\lg(I/T^2)$ 与 $1/T$ 成直线，由斜率即可求出 $\\varphi$，$A$、$S$ 只影响截距。</p>
<h3>3. 零场电流与肖特基效应</h3><p>要把发射的电子全部收集到阳极，阳极必须加正电压。但加速电场会使表面势垒降低，发射电流随阳极电压增大而缓慢增大（肖特基效应）：</p>$$I_a=I\\exp\\left(\\frac{0.439\\sqrt{E_c}}{T}\\right),\\qquad \\lg I_a=\\lg I+\\frac{0.439}{2.303\\,T}\\cdot\\frac{\\sqrt{U_a}}{\\sqrt{r_1\\ln(r_2/r_1)}}$$<p>$E_c$ 为阴极表面场强（V/m），$r_1$、$r_2$ 为阴极、阳极半径。在一定温度下 $\\lg I_a$ 与 $\\sqrt{U_a}$ 成直线，外延到 $U_a=0$ 得到零场电流 $I$。阳极电压太低时，阴极附近的电子云（空间电荷）会阻碍发射，$I_a$ 按 $U_a^{3/2}$ 增大，不在这一直线上，所以阳极电压从十几伏取起。</p>
<h3>4. 灯丝温度</h3><p>温度用灯丝电流间接确定：仪器给出了 $T$–$I_f$ 标定关系 $T=920+1600\\,I_f$（K）。</p>
<h3>5. 本仿真的计算模型</h3><p>阳极电流按上面的理查森公式加肖特基因子计算，低电压处与圆筒二极管的空间电荷限制电流平滑取小。钨丝的逸出功（4.50–4.58 eV）、有效发射面积、实际温度与标定式的偏差（约 0.3%）个体随机；灯丝温度按 ${TAU} s 的时间常数趋于平衡。</p>`;
  }
}
