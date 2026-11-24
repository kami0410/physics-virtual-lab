// 实验：分光计测三棱镜顶角与折射率（自准法测顶角 · 最小偏向角法 · 色散曲线）
// 复用分光计的全部调节过程（望远镜调焦、各半调节、平行光管），在其基础上换用三棱镜。
import * as THREE from 'three';
import { meta, thumb } from './prism.meta.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, ICONS } from '../core/Models.js';
import { rgbCss } from '../physics/color.js';
import { GLASSES, sellmeier } from '../physics/glass.js';
import { SpectrometerExperiment } from './spectrometer.js';
import { linFit, gauss, rand, relErr, pct, dms, texU } from '../core/Stats.js';
import { fnData } from '../core/Plot.js';

const YA = 24;
const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const HG = [[404.66, 0.4], [435.83, 0.75], [491.6, 0.12], [546.07, 1.0], [576.96, 0.55], [579.07, 0.55]];
const LINES = [{ name: '紫', nm: 404.66 }, { name: '蓝紫', nm: 435.83 }, { name: '绿', nm: 546.07 }, { name: '黄₁', nm: 576.96 }];

/** 二维折射：入射单位矢量 d，界面法线 n（指向入射一侧的反方向无关，内部统一处理），折射率比 eta = n1/n2 */
function refract(d, n, eta) {
  let c = -(d[0] * n[0] + d[1] * n[1]);
  let N = n;
  if (c < 0) { N = [-n[0], -n[1]]; c = -c; }
  const k = 1 - eta * eta * (1 - c * c);
  if (k < 0) return null; // 全反射
  const t = eta * c - Math.sqrt(k);
  return [eta * d[0] + t * N[0], eta * d[1] + t * N[1]];
}
const vec = (az) => [Math.cos(az * D2R), Math.sin(az * D2R)];

export class PrismExperiment extends SpectrometerExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    super(app);
    this.Aap = 60 + rand(-0.35, 0.35); // 顶角 (°)
    // 棱镜玻璃：从几种常用火石/重火石玻璃中随机取一种（色散按 Sellmeier 公式），并带熔炼批次偏差
    this.glass = ['F2', 'SF2', 'SF5'][Math.floor(Math.random() * 3)];
    this.dn = rand(-3e-4, 3e-4);
    // 两个光学面外法线在台面上的方位（棱镜大致放正：顶角指向台面 +x 方向）
    const tw = rand(-4, 4);
    this.m1 = 90 - this.Aap / 2 + tw;
    this.m2 = -(90 - this.Aap / 2) + tw;
    this.g1 = rand(-0.6, 0.6); this.g2 = rand(-0.6, 0.6); // 光学面与底面不垂直量 (′)
  }
  n(nm) { return sellmeier(this.glass, nm, this.dn); }

  build() {
    super.build();
    const app = this.app;
    app.comps.delete('grating');
    const z = app.zones.find((zz) => zz.id === 'plat');
    z.accepts = ['mirror', 'prism'];
    // 载物台：三个螺钉都可调，不再有“b₃ 调光栅”的特殊说明
    const plat = app.comp('plat');
    const base = plat.controls;
    plat.controls = () => base().filter((c) => !/b₃/.test(c.label || ''));

    const pg = new THREE.Group();
    const s = 5.4, hgt = 4.4;
    const shape = new THREE.Shape();
    // 台面坐标：顶点 A 指向 +x（两光学面外法线 ±(90°−A/2) 的角平分方向），底面朝 −x
    const half = (this.Aap / 2) * D2R;
    const Lside = s;
    shape.moveTo(Lside * Math.cos(half) * 0.66, 0);
    shape.lineTo(-Lside * Math.cos(half) * 0.34, Lside * Math.sin(half));
    shape.lineTo(-Lside * Math.cos(half) * 0.34, -Lside * Math.sin(half));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: hgt, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const prismMesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0xdfeaf5, metalness: 0, roughness: 0.02, transmission: 0.85, thickness: 2, ior: 1.65, transparent: true, opacity: 0.55 }));
    prismMesh.position.y = 0.05;
    pg.add(prismMesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xbfd6ea, transparent: true, opacity: 0.8 }));
    edges.position.y = 0.05; pg.add(edges);
    this.prismG = pg;
    app.addComponent(new Component({
      key: 'prism', name: '三棱镜', icon: ICONS.prism, zone: 'slot', defaultSlot: 'plat', object: pg, labelY: 8,
      desc: '火石玻璃等边三棱镜（牌号未知，待测），两个光学面已抛光，底面磨砂。放置时使两光学面分别大致垂直于两对螺钉的连线。',
    }));
  }

  canPlace(comp) {
    if ((comp.key === 'mirror' || comp.key === 'prism') && this.onPlat) return `载物台上已有${this.app.comp(this.onPlat).name}，请先取下`;
    return null;
  }

  tilt(m) { return this.bx * Math.cos(m * D2R) + this.bz * Math.sin(m * D2R); }
  /** 两个光学面（外法线方位、仰角） */
  prismFaces() {
    return [
      { name: 'AB', az: this.plat + this.m1, el: this.g1 + this.tilt(this.m1) },
      { name: 'AC', az: this.plat + this.m2, el: this.g2 + this.tilt(this.m2) },
    ];
  }
  face() {
    if (this.onPlat !== 'prism') return super.face();
    const f = this.prismFaces()[0];
    return { key: 'prism', az: f.az, elA: f.el, elB: f.el };
  }
  crossImage() {
    if (this.onPlat !== 'prism') return super.crossImage();
    for (const f of this.prismFaces()) {
      const dh = 2 * wrap180(f.az - this.tel);
      if (Math.abs(dh) < 1.6 * 1.4) return { x: dh, y: (2 * (f.el - this.tau)) / 60, face: f.name };
    }
    return null;
  }

  /** 光线追迹：返回某波长经棱镜两次折射后的出射方位 (°)，以及经入射面反射的方位 */
  trace(nm) {
    const d = [1, 0];
    const [f1, f2] = this.prismFaces();
    const n1 = vec(f1.az), n2 = vec(f2.az);
    const dot1 = d[0] * n1[0] + d[1] * n1[1], dot2 = d[0] * n2[0] + d[1] * n2[1];
    const [fin, nin, nout] = dot1 < dot2 ? [f1, n1, n2] : [f2, n2, n1];
    if (Math.min(dot1, dot2) >= -0.02) return null; // 光照不到光学面
    const refl = (() => { const c = d[0] * nin[0] + d[1] * nin[1]; return [d[0] - 2 * c * nin[0], d[1] - 2 * c * nin[1]]; })();
    const n = this.n(nm);
    const t1 = refract(d, nin, 1 / n);
    let out = null;
    if (t1 && t1[0] * nout[0] + t1[1] * nout[1] > 0) out = refract(t1, nout, n);
    return { face: fin.name, refl: Math.atan2(refl[1], refl[0]) * R2D, out: out ? Math.atan2(out[1], out[0]) * R2D : null };
  }
  /** 某谱线在当前载物台转角下的偏向角 (°) */
  deviation(nm, plat = this.plat) {
    const p0 = this.plat; this.plat = plat;
    const r = this.trace(nm);
    this.plat = p0;
    return r && r.out != null ? Math.abs(wrap180(r.out)) : null;
  }
  /** 数值求最小偏向角及对应载物台转角 */
  minDev(nm, near = this.plat) {
    // 整周扫描找出各个局部极小（光从 AB 或 AC 面入射各有一个），取离当前转角最近的
    const pts = [];
    for (let p = -180; p < 180; p += 0.5) pts.push([p, this.deviation(nm, p)]);
    let best = null;
    for (let i = 1; i < pts.length - 1; i++) {
      const [p, v] = pts[i], a = pts[i - 1][1], b = pts[i + 1][1];
      if (v == null || a == null || b == null || v > a || v > b) continue;
      const dist = Math.abs(wrap180(p - near));
      if (!best || dist < best.dist) best = { p, dv: v, dist };
    }
    if (!best) return null;
    let a = best.p - 0.5, b = best.p + 0.5;
    for (let i = 0; i < 40; i++) { const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618; const v1 = this.deviation(nm, m1) ?? 1e9, v2 = this.deviation(nm, m2) ?? 1e9; if (v1 < v2) b = m2; else a = m1; }
    const p = (a + b) / 2;
    return { plat: p, dev: this.deviation(nm, p) };
  }

  spectrum() {
    if (this.onPlat !== 'prism') return super.spectrum().filter((s) => s.k === 0 || this.onPlat !== 'grating');
    const out = [];
    if (!this.lampOn || !this.app.comp('lamp').placed) return out;
    let reflDone = false;
    for (const [nm, a] of HG) {
      const r = this.trace(nm);
      if (!r) break;
      if (!reflDone) { out.push({ nm: 0, k: 0, az: r.refl, I: 0.3 }); reflDone = true; }
      if (r.out != null) out.push({ nm, k: 1, az: r.out, I: a });
    }
    return out;
  }

  update() {
    super.update();
    const c = this.app.comp('prism');
    if (c.placed && c.slot === 'plat') {
      c.root.position.set(0, YA - 5.1, 0);
      // 顶角方向即两法线的角平分方向 (m1+m2)/2
      c.root.rotation.set(0, (this.plat + (this.m1 + this.m2) / 2) * D2R, 0);
    }
  }

  tables() {
    return [
      {
        id: 'apex', title: '自准法测顶角', fixedRows: true,
        initRows: () => [{ f: '光学面 AB' }, { f: '光学面 AC' }],
        columns: [{ key: 'f', label: '', type: 'text', readonly: true }, { key: 'A', label: '游标 A', type: 'dms' }, { key: 'B', label: '游标 B', type: 'dms' }],
        buttons: [{ label: '记录当前光学面的法线方位', onClick: (t) => this.recApex(t) }],
        note: '望远镜对准某一光学面，使绿十字反射像与上叉丝交点重合后记录。φ = ½(|A₁−A₂|+|B₁−B₂|)，顶角 A = 180° − φ。',
      },
      {
        id: 'dev', title: '最小偏向角', fixedRows: true,
        initRows: () => [...LINES.map((l) => ({ line: `${l.name} ${l.nm.toFixed(2)} nm` })), { line: '入射光方向（取下棱镜）' }],
        columns: [
          { key: 'line', label: '', type: 'text', readonly: true },
          { key: 'A', label: '游标 A', type: 'dms' }, { key: 'B', label: '游标 B', type: 'dms' },
          { key: 'dm', label: 'δ_min', type: 'dms', calc: (r, i, rows) => (i < LINES.length ? devOf(r, rows[LINES.length]) : NaN) },
        ],
        buttons: [{ label: '记录当前读数', onClick: (t) => this.recDev(t) }],
        note: '转动载物台，同时用望远镜跟踪谱线：谱线先向偏向角减小的方向移动，到某一位置后反向——这个转折点就是最小偏向角位置。锁紧望远镜，微调对准后记录。最后取下棱镜，记录入射光（狭缝直接像）的方向。',
      },
    ];
  }

  q(x) { return Math.round((x + gauss(0.25 / 60)) * 60) / 60; }
  recApex(t) {
    if (this.onPlat !== 'prism') { this.app.toast('载物台上没有三棱镜', 'warn'); return; }
    if (!this.illum) { this.app.toast('请打开目镜照明，用绿十字自准', 'warn'); return; }
    const ci = this.crossImage();
    if (!ci) { this.app.toast('视场中没有十字反射像', 'warn'); return; }
    if (Math.abs(ci.x * 60) > 1.5) this.app.toast(`十字像没有对准竖叉丝（偏差 ${(ci.x * 60).toFixed(1)}′）`, 'warn');
    if (Math.abs(ci.y * 60) > 3) this.app.toast('十字像不在上叉丝高度：棱镜光学面尚未调到与望远镜光轴垂直', 'warn');
    if (!this.telLock) this.app.toast('提示：读数前应锁紧望远镜', 'warn');
    const i = ci.face === 'AB' ? 0 : 1, r = this.readings();
    t.set(i, 'A', this.q(r.A)); t.set(i, 'B', this.q(r.B));
  }
  recDev(t) {
    const r = this.readings();
    if (!this.lampOn || !this.app.comp('lamp').placed) { this.app.toast('汞灯没有打开', 'warn'); return; }
    if (this.onPlat !== 'prism') {
      if (Math.abs(wrap180(this.tel)) > 0.25) { this.app.toast('竖叉丝没有对准狭缝的直接像', 'warn'); return; }
      t.set(LINES.length, 'A', this.q(r.A)); t.set(LINES.length, 'B', this.q(r.B)); return;
    }
    const sp = this.spectrum().filter((s) => s.k === 1 && LINES.some((l) => l.nm === s.nm));
    let best = null;
    for (const s of sp) { const dx = Math.abs(wrap180(s.az - this.tel)); if (!best || dx < best.dx) best = { ...s, dx }; }
    if (!best || best.dx > 0.25) { this.app.toast('视场中央没有需要测量的谱线（紫、蓝紫、绿、黄₁）', 'warn'); return; }
    if (best.dx * 60 > 1.5) this.app.toast(`竖叉丝没有对准谱线（偏差 ${(best.dx * 60).toFixed(1)}′）`, 'warn');
    const md = this.minDev(best.nm);
    const ex = (this.deviation(best.nm) - md.dev) * 60;
    if (ex > 1) this.app.toast(`载物台不在最小偏向角位置：偏向角比最小值大 ${ex.toFixed(1)}′`, 'warn');
    const i = LINES.findIndex((l) => l.nm === best.nm);
    t.set(i, 'A', this.q(r.A)); t.set(i, 'B', this.q(r.B));
  }

  steps() {
    const app = this.app;
    const base = super.steps().slice(0, 5); // 目镜、放平面镜、自准直、各半调节、平行光管
    const facesOk = () => this.onPlat === 'prism' && this.prismFaces().every((f) => Math.abs(f.el - this.tau) < 1.2);
    const rotTel = async (to, ms = 900) => { this.telLock = false; app.changed(); await app.tween(() => this.tel, (v) => (this.tel = v), to, ms); this.telLock = true; app.changed(); };
    return [
      ...base,
      {
        title: '放上三棱镜，调光学面垂直于望远镜光轴',
        html: '<p>把<b>三棱镜</b>放到载物台中央，顶角大致指向望远镜。转动望远镜对准光学面 AB，看到绿十字反射像，只调<b>载物台螺钉</b>使十字像回到上叉丝高度；再对准光学面 AC 重复。两个面都调好后，<b>不要再动望远镜俯仰</b>。</p>',
        hint: '每个光学面最好垂直于两个螺钉的连线，这样调第三个螺钉时另一个面几乎不受影响；本仿真中两个螺钉 b₁、b₂ 对两个面都有影响，需要来回调几次。',
        check: facesOk,
        status: () => { if (this.onPlat !== 'prism') return '载物台上还没有三棱镜'; const [a, b] = this.prismFaces(); return `AB 面偏差 <b>${(2 * (a.el - this.tau)).toFixed(1)}′</b>，AC 面偏差 <b>${(2 * (b.el - this.tau)).toFixed(1)}′</b>`; },
        auto: async () => {
          this.lampOn = false; this.illum = true; app.changed();
          await app.autoPlace('prism');
          await app.view('载物台');
          app.select(app.comp('plat'));
          await app.tween(() => this.plat, (v) => (this.plat = v), wrap180(-(this.m1 + this.m2) / 2 + gauss(1)), 900);
          for (const f of this.prismFaces()) { app.select(app.comp('tel')); await rotTel(f.az + gauss(0.1), 900); await app.wait(300); }
          // 由两面的偏差解出 b₁、b₂ 的改正量
          const [a, b] = this.prismFaces();
          const c1 = Math.cos(this.m1 * D2R), s1 = Math.sin(this.m1 * D2R), c2 = Math.cos(this.m2 * D2R), s2 = Math.sin(this.m2 * D2R);
          const r1 = this.tau - a.el, r2 = this.tau - b.el, det = c1 * s2 - c2 * s1;
          const dx = (r1 * s2 - r2 * s1) / det, dz = (c1 * r2 - c2 * r1) / det;
          app.select(app.comp('plat'));
          await app.tween(() => this.bx, (v) => (this.bx = v), this.bx + dx + gauss(0.15), 800);
          await app.tween(() => this.bz, (v) => (this.bz = v), this.bz + dz + gauss(0.15), 800);
        },
      },
      {
        title: '自准法测三棱镜顶角',
        html: '<p>固定载物台。转动望远镜对准光学面 AB，锁紧后用微调螺钉使十字反射像与上叉丝交点重合，记下两个游标读数；再对准 AC 面同样测量。两面法线的夹角为 $\\varphi$，顶角 $A=180^\\circ-\\varphi$。</p>',
        check: () => app.table('apex').completeRows().length >= 2,
        status: () => `已测 <b>${app.table('apex').completeRows().length}</b> / 2 个光学面`,
        auto: async () => {
          const t = app.table('apex'); app.showTable(app.tables.indexOf(t));
          app.select(app.comp('tel'));
          for (const f of this.prismFaces()) { await rotTel(f.az + gauss(0.15 / 60), 1100); await app.record('apex'); }
        },
      },
      {
        title: '寻找最小偏向角，测各谱线位置',
        html: '<p>打开汞灯，转动载物台使平行光从 AB 面入射，用眼睛先在 AC 面一侧找到彩色谱线，再用望远镜对准。<b>慢慢转动载物台</b>，谱线随之移动，望远镜跟踪；当谱线移到某一位置开始反向时，即为该谱线的最小偏向角位置。锁紧望远镜，微调对准谱线后记录读数。依次测紫、蓝紫、绿、黄₁。</p>',
        hint: '不同谱线的最小偏向角位置略有不同，每条谱线都要重新找转折点。',
        check: () => app.table('dev').rows.slice(0, LINES.length).every((r) => r.A != null && r.B != null),
        status: () => `已测 <b>${app.table('dev').rows.slice(0, LINES.length).filter((r) => r.A != null).length}</b> / ${LINES.length} 条谱线`,
        auto: async () => {
          const t = app.table('dev'); app.showTable(app.tables.indexOf(t));
          this.lampOn = true; app.changed();
          await app.view('全景');
          for (const l of LINES) {
            const md = this.minDev(l.nm, this.plat);
            app.select(app.comp('plat'));
            await app.tween(() => this.plat, (v) => (this.plat = v), md.plat + 6, 700);
            app.say(`${l.name}光：转动载物台，谱线移到转折点`);
            await app.tween(() => this.plat, (v) => (this.plat = v), md.plat + gauss(0.15), 900);
            const s = this.spectrum().find((x) => x.k === 1 && x.nm === l.nm);
            app.select(app.comp('tel'));
            await rotTel(s.az + gauss(0.2 / 60), 800);
            await app.record('dev');
          }
        },
      },
      {
        title: '取下棱镜，测入射光方向',
        html: '<p>取下三棱镜，转动望远镜对准狭缝的直接像（白色），记录两个游标读数。各谱线读数与它之差即为最小偏向角 $\\delta_{min}$。</p>',
        check: () => { const r = app.table('dev').rows[LINES.length]; return r.A != null && r.B != null; },
        auto: async () => {
          app.remove(app.comp('prism')); await app.wait(300);
          app.select(app.comp('tel'));
          await rotTel(gauss(0.2 / 60), 1300);
          await app.record('dev');
        },
      },
      {
        title: '数据处理：折射率与色散曲线',
        html: '<p>由 $n=\\sin\\frac{A+\\delta_{min}}{2}\\big/\\sin\\frac A2$ 求各谱线折射率，作 $n$–$\\lambda$ 色散曲线，并用柯西公式 $n=a+b/\\lambda^2$ 拟合。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const at = this.app.table('apex').rows;
    if (at.some((r) => r.A == null || r.B == null)) return { html: '<p>请先测出两个光学面的法线方位（顶角）。</p>', ok: false };
    const phi = (Math.abs(wrap180(at[0].A - at[1].A)) + Math.abs(wrap180(at[0].B - at[1].B))) / 2;
    const A = 180 - phi;
    const dt = this.app.table('dev');
    const rows = LINES.map((l, i) => ({ ...l, dm: devOf(dt.rows[i], dt.rows[LINES.length]) })).filter((r) => isFinite(r.dm));
    let html = `<h3>1. 顶角</h3><p>两光学面法线夹角 $\\varphi=\\tfrac12(|A_1-A_2|+|B_1-B_2|)=${dms(phi)}$，</p><div class="result-box">顶角 $A=180^\\circ-\\varphi=${dms(A).replace(/°/, '^\\circ ').replace(/′/, "'")}$（参考值 ${dms(this.Aap)}）</div>`;
    if (rows.length < 2) return { html: html + '<p>最小偏向角数据不足（至少两条谱线及入射光方向）。</p>', ok: false };
    const nOf = (dm) => Math.sin(((A + dm) / 2) * D2R) / Math.sin((A / 2) * D2R);
    const uTh = (1 / 60) * D2R / Math.sqrt(3) / Math.sqrt(2);
    for (const r of rows) {
      r.n = nOf(r.dm);
      const a = (A / 2) * D2R, s = ((A + r.dm) / 2) * D2R;
      const dndd = Math.cos(s) / (2 * Math.sin(a)), dndA = (Math.sin(a) * Math.cos(s) - Math.sin(s) * Math.cos(a)) / (2 * Math.sin(a) ** 2);
      // δ、φ 都是 4 个读数（各 1′/√3）的 ½(|ΔA|+|ΔB|)，u = 1′/√3 = √2·uTh
      r.u = Math.hypot(dndd * uTh * Math.SQRT2, dndA * uTh * Math.SQRT2);
    }
    html += `<h3>2. 折射率</h3><table><tr><th>谱线</th><th>λ/nm</th><th>δ_min</th><th>n</th><th>参考值</th><th>相对误差</th></tr>${rows.map((r) => `<tr><td>${r.name}</td><td>${r.nm.toFixed(2)}</td><td>${dms(r.dm)}</td><td>${r.n.toFixed(5)}</td><td>${this.n(r.nm).toFixed(5)}</td><td>${pct(relErr(r.n, this.n(r.nm)))}</td></tr>`).join('')}</table>`;
    const g = rows.find((r) => r.nm === 546.07) || rows[0];
    html += `<div class="result-box">$n_{${g.nm.toFixed(0)}} = ${texU(g.n, g.u)}$</div>`;
    const fit = linFit(rows.map((r) => 1 / (r.nm / 1000) ** 2), rows.map((r) => r.n));
    html += `<h3>3. 色散</h3><p>以 $1/\\lambda^2$ 为横坐标线性拟合，得柯西公式 $n=a+b/\\lambda^2$：$a=${fit.b.toFixed(4)}$，$b=${(fit.k * 1e3).toFixed(2)}\\times10^{-3}\\ \\mu m^2$，$r=${fit.r.toFixed(5)}$。$n$ 随 $\\lambda$ 增大而减小，属于正常色散。</p>
      <div class="plot-wrap"><canvas data-plot="0" style="height:280px"></canvas></div>
      <div class="result-box warn">本次棱镜参考值：顶角 ${dms(this.Aap)}；玻璃为 ${this.glass}（${GLASSES[this.glass].kind}），本批次 n_d = ${this.n(587.56).toFixed(5)}（目录值 ${GLASSES[this.glass].nd.toFixed(5)}），表中“参考值”按 Sellmeier 公式计算。</div>`;
    return {
      html, ok: true,
      answers: [
        { label: '棱镜顶角 $A$', type: 'dms', value: A, tolAbs: 1.5 / 60 },
        { label: `折射率 $n_{${g.nm.toFixed(0)}}$`, value: g.n, digits: 4, tolAbs: 0.0005 },
      ],
      plots: [{ title: '色散曲线 n(λ)', xLabel: 'λ / nm', yLabel: 'n', series: [
        { type: 'scatter', data: rows.map((r) => [r.nm, r.n]), label: '实验值', radius: 4 },
        { type: 'line', data: fnData((x) => fit.b + fit.k / (x / 1000) ** 2, 395, 600, 200), label: '柯西公式拟合' },
        { type: 'line', data: fnData((x) => this.n(x), 395, 600, 200), label: `Sellmeier 公式（${this.glass}）`, color: '#94a3b8', width: 1 },
      ] }],
    };
  }

  principle() {
    return `<h3>1. 自准法测顶角</h3><p>望远镜已调到聚焦无穷远且光轴垂直于仪器转轴。分别使望远镜光轴垂直于三棱镜的两个光学面（十字反射像与上叉丝交点重合），两次望远镜方位之差 $\\varphi$ 就是两面法线的夹角，顶角 $A=180^\\circ-\\varphi$。</p>
<h3>2. 最小偏向角法测折射率</h3><p>单色平行光经棱镜两次折射，出射光与入射光的夹角称为偏向角 $\\delta$。当光线在棱镜内平行于底面（入射角等于出射角）时 $\\delta$ 取最小值 $\\delta_{min}$，此时</p>$$n=\\frac{\\sin\\frac{A+\\delta_{min}}{2}}{\\sin\\frac A2}$$<p>在最小偏向角附近，$\\delta$ 对入射角的变化最不敏感（一阶导数为零），因此测量结果最稳定。</p>
<h3>3. 色散</h3><p>透明介质的折射率随波长变化。可见光区的正常色散可用柯西公式近似：$n=a+\\dfrac{b}{\\lambda^2}$。更精确的是 Sellmeier 公式 $n^2=1+\\sum_i\\dfrac{B_i\\lambda^2}{\\lambda^2-C_i}$，它来自介质中束缚电子（紫外吸收）与晶格振动（红外吸收）的共振模型，玻璃厂的数据表都用它给出折射率。</p>
<h3>4. 本仿真的计算模型</h3><p>程序对汞灯每条谱线作二维矢量折射光线追迹（斯涅尔定律，含全反射判断），出射方向随载物台转角连续变化，最小偏向角由光线追迹自然产生，而不是直接代公式。棱镜玻璃取 F2、SF2、SF5 三种火石玻璃之一，色散按 SCHOTT 数据表的 Sellmeier 系数计算（另加 ±3×10⁻⁴ 以内的批次偏差），顶角、光学面与底面的垂直度都带有随机加工误差。望远镜、载物台和刻度盘的调节模型与“分光计”实验相同。</p>`;
  }
}

function devOf(r, z) {
  if (!r || !z || [r.A, r.B, z.A, z.B].some((v) => v == null || !isFinite(v))) return NaN;
  return (Math.abs(wrap180(r.A - z.A)) + Math.abs(wrap180(r.B - z.B))) / 2;
}
