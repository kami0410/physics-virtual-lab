// 实验：伏安法测电阻（电流表内接与外接 · 系统误差修正）与二极管正向伏安特性
import * as THREE from 'three';
import { meta, thumb } from './voltamp.meta.js';
import { Circuit, benchTable, analogMeter, dcSupply, rheostat, knifeSwitch, partBoard, drawDialFace } from '../core/circuit.js';
import { mean, gauss, rand, relErr, pct, clamp } from '../core/Stats.js';
import { fnData } from '../core/Plot.js';
import { voltampFig } from './circuitFigs.js';

const AM_RANGES = [1.5, 3, 15, 75, 150].map((m) => ({ label: `${m}mA`, full: m / 1000, R: 0.075 / (m / 1000) }));
const VM_RANGES = [1.5, 3, 7.5, 15].map((v) => ({ label: `${v}V`, full: v }));
const OHM_PER_V = 1000;
const PARTS = ['rx1', 'rx2', 'diode'];

export class VoltAmpExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.R1 = rand(18, 30);
    this.R2 = rand(2400, 3600);
    this.Is = 5e-9 * rand(0.6, 1.6); this.nD = rand(1.8, 2.0);
    this.R0 = 100 * rand(0.99, 1.01);
    this._warned = {};
  }

  cameras() {
    return [
      { name: '全景', pos: [0, 95, 95], target: [0, 0, -2] },
      { name: '电表', pos: [22, 46, 22], target: [22, 2, -22] },
      { name: '元件', pos: [20, 40, 52], target: [20, 0, 12] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    const slot = (id, x, z, accepts) => app.addSlot({ id, pos: new THREE.Vector3(x, 0, z), accepts });
    slot('supply', -60, -22, ['supply']); slot('sw', -40, 12, ['sw']); slot('rheo', -22, -24, ['rheo']);
    slot('am', 6, -24, ['am']); slot('vm', 30, -24, ['vm']);
    ['p1', 'p2', 'p3', 'p4'].forEach((id, i) => slot(id, -6 + i * 16, 16, ['rx1', 'rx2', 'diode', 'r0']));
    const cir = (this.cir = new Circuit(app));
    cir.add(dcSupply({ defaultSlot: 'supply', vmax: 15, imax: 1 }));
    cir.add(knifeSwitch({ defaultSlot: 'sw' }));
    cir.add(rheostat({ R: 100, Imax: 1.5, defaultSlot: 'rheo' }));
    this.am = cir.add(analogMeter({ key: 'am', name: '毫安表（0.5 级）', short: '毫安表', kind: 'A', ranges: AM_RANGES, defaultSlot: 'am', desc: '多量程直流毫安表，0.5 级，150 格。各量程满偏时表两端电压约 75 mV，内阻 R_A = 75 mV / 量程：1.5 mA 档 50 Ω，3 mA 档 25 Ω，15 mA 档 5 Ω，75 mA 档 1 Ω，150 mA 档 0.5 Ω。“−”为公共端。' }));
    this.vm = cir.add(analogMeter({ key: 'vm', name: '电压表（0.5 级）', short: '电压表', kind: 'V', ranges: VM_RANGES, ohmPerV: OHM_PER_V, defaultSlot: 'vm', desc: `多量程直流电压表，0.5 级，150 格，内阻 ${OHM_PER_V} Ω/V（3 V 档内阻 3 kΩ，7.5 V 档 7.5 kΩ……）。“−”为公共端。` }));
    cir.add(partBoard({ key: 'rx1', name: '待测电阻 Rx1（约 20 Ω）', short: 'Rx1', label: 'Rx1', defaultSlot: 'p1', elements: (t) => [{ type: 'R', a: t('a'), b: t('b'), R: this.R1, tag: 'x' }], desc: '阻值约几十欧，额定功率 1 W。' }));
    cir.add(partBoard({ key: 'rx2', name: '待测电阻 Rx2（约 3 kΩ）', short: 'Rx2', label: 'Rx2', defaultSlot: 'p2', elements: (t) => [{ type: 'R', a: t('a'), b: t('b'), R: this.R2, tag: 'x' }], desc: '阻值约几千欧。' }));
    cir.add(partBoard({ key: 'r0', name: '限流电阻 R₀（100 Ω）', short: 'R₀', label: 'R₀ 100Ω', defaultSlot: 'p3', elements: (t) => [{ type: 'R', a: t('a'), b: t('b'), R: this.R0, tag: 'x' }], desc: '100 Ω，2 W，用于限制二极管电流。' }));
    cir.add(partBoard({ key: 'diode', name: '硅二极管', short: '二极管', label: '1N4007', symbol: 'D', pol: true, terms: { a: '+', b: '−' }, defaultSlot: 'p4', elements: (t) => [{ type: 'D', a: t('a'), b: t('_j'), Is: this.Is, n: this.nD, tag: 'x' }, { type: 'R', a: t('_j'), b: t('b'), R: 0.3 }], desc: '硅整流二极管，“+”为正极（阳极）。正向电流不要超过 50 mA。' }));
    this.view = app.addView({ id: 'meters', title: '毫安表（左） · 电压表（右）', w: 320, h: 150, res: 1 });
  }

  pointerDown(e) { return this.cir.pointerDown(e); }
  pointerMove(e) { return this.cir.pointerMove(e); }
  onRemove(c) { this.cir.removeDevice(c.key); }
  tick(dt) { this.cir.tick(dt); }

  update() {
    this.cir.solve();
    this.drawMeters();
    // 安全提示
    const warn = (k, cond, msg) => { if (cond && !this._warned[k]) this.app.toast(msg, 'warn'); this._warned[k] = cond; };
    warn('amOver', this.cir.placed('am') && this.am.over, '毫安表超量程（打表）！应立即断开开关，换大量程或减小电压');
    warn('vmOver', this.cir.placed('vm') && this.vm.over, '电压表超量程！');
    warn('amRev', this.cir.placed('am') && this.am.rev, '毫安表指针反偏：正负极接反了');
    warn('vmRev', this.cir.placed('vm') && this.vm.rev, '电压表指针反偏：正负极接反了');
    warn('hot', this.cir.placed('rheo') && this.cir.dev('rheo').hot, '变阻器电流超过额定值，发热严重');
    const sw = this.cir.dev('sw');
    if (sw.comp.placed && sw.closed && !this._swWas && this.loadVoltage() > 1 && !this.app.running) {
      this.app.toast('合上开关前，应先把分压输出调到最小（滑动端移到接负极的一端）', 'warn');
    }
    this._swWas = sw.comp.placed && sw.closed;
  }
  /** 待测元件两端的电压（判断接通瞬间是否过大） */
  loadVoltage() {
    const m = this.measureInfo();
    if (!m) return 0;
    return Math.abs(this.cir.V(`${m.part}:a`, `${m.part}:b`));
  }

  drawMeters() {
    const v = this.view, g = v.ctx, W = v.W, H = v.H;
    g.fillStyle = '#20262a'; g.fillRect(0, 0, W, H);
    const one = (m, x, unit) => {
      if (!m.comp.placed) { g.fillStyle = '#2b3236'; g.fillRect(x, 0, W / 2 - 2, H); return; }
      const r = m.read();
      drawDialFace(g, x, 0, W / 2 - 2, H, { kind: m.kind, divs: m.divs, cls: m.cls, unit, theta: m.theta, range: r.range ? `量程 ${r.range.label}` : '未接量程端' });
    };
    one(this.am, 0, 'mA'); one(this.vm, W / 2 + 2, 'V');
    const info = this.measureInfo();
    v.foot(info ? `测量对象：${this.cir.dev(info.part).short} · 电流表${info.mode}` : '');
  }

  /** 由接线判断：哪个元件被测、电流表内接还是外接 */
  measureInfo() {
    const cir = this.cir;
    if (!cir.placed('am') || !cir.placed('vm') || this.am.rangeIdx < 0 || this.vm.rangeIdx < 0) return null;
    const n = cir.nets();
    const A = ['am:com', `am:r${this.am.rangeIdx}`], Vt = ['vm:com', `vm:r${this.vm.rangeIdx}`];
    for (const p of PARTS) {
      if (!cir.placed(p)) continue;
      const P = [`${p}:a`, `${p}:b`];
      for (const [ia, ip] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        if (n(A[ia]) !== n(P[ip])) continue;
        const pOther = P[1 - ip], aOther = A[1 - ia];
        if (n(aOther) === n(pOther)) continue; // 电流表被短接
        const vs = new Set([n(Vt[0]), n(Vt[1])]);
        if (vs.size === 2 && vs.has(n(P[0])) && vs.has(n(P[1]))) return { part: p, mode: '外接' };
        if (vs.size === 2 && vs.has(n(pOther)) && vs.has(n(aOther))) return { part: p, mode: '内接' };
      }
    }
    return null;
  }

  tables() {
    const cols = [
      { key: 'mode', label: '接法', type: 'text' }, { key: 'rng', label: '量程', type: 'text' },
      { key: 'U', label: 'U/V', digits: 3 }, { key: 'I', label: 'I/mA', digits: 3 },
      { key: 'Rm', label: 'U/I /Ω', digits: 1, calc: (r) => (r.U / r.I) * 1000 },
    ];
    return [
      { id: 'rx1', title: '电阻 Rx1', columns: cols, maxRows: 14, buttons: [{ label: '读取两表示数（记录一组）', onClick: (t) => this.rec(t, 'rx1') }], note: '外接、内接各测几组。读数估读到 1/10 格。' },
      { id: 'rx2', title: '电阻 Rx2', columns: cols, maxRows: 14, buttons: [{ label: '读取两表示数（记录一组）', onClick: (t) => this.rec(t, 'rx2') }], note: '外接、内接各测几组。' },
      { id: 'd', title: '二极管正向特性', columns: cols.slice(0, 4), maxRows: 16, buttons: [{ label: '读取两表示数（记录一组）', onClick: (t) => this.rec(t, 'diode') }], note: '二极管与限流电阻串联。电流小时用小量程。' },
    ];
  }
  rec(t, part) {
    // 接错了也照样能读两个表：读数不再是元件的 U、I，算出的电阻就是错的
    const info = this.measureInfo() || (this.app.toast('电路连接不正确：电流表应与待测元件串联，电压表并联在元件（或元件与电流表）两端', 'warn'), { mode: '接线有误', part });
    if (info.part !== part) this.app.toast(`现在测的是 ${this.cir.dev(info.part).short}，不是这张表的元件`, 'warn');
    if (!this.cir.dev('sw').closed || !this.cir.dev('supply').on) return this.app.toast('电路没有接通', 'warn');
    const a = this.am.read(), v = this.vm.read();
    if (this.am.over || this.vm.over) return this.app.toast('有电表超量程，不能读数', 'warn');
    if (Math.abs(this.am.vel) > 0.02 || Math.abs(this.vm.vel) > 0.02) this.app.toast('指针还在摆动，等稳定后再读', 'warn');
    if (this.am.theta < 1 / 3 || this.vm.theta < 1 / 3) this.app.toast('有电表偏转不到满偏的 1/3，读数误差大，可换小量程', 'warn');
    const q = (m, r) => (Math.round(m.theta * m.divs * 10) / 10 / m.divs) * r.range.full;
    t.addRow({
      mode: info.mode, rng: `${a.range.label}/${v.range.label}`,
      U: +q(this.vm, v).toFixed(4), I: +(q(this.am, a) * 1000).toFixed(4),
      ra: AM_RANGES[this.am.rangeIdx].R, rv: VM_RANGES[this.vm.rangeIdx].full * OHM_PER_V,
    });
  }

  // ---------------- 自动操作 ----------------
  async rewire(list) {
    const app = this.app, cir = this.cir;
    const key = (a, b) => [a, b].sort().join('|');
    const want = new Set(list.map(([a, b]) => key(a, b)));
    for (const w of [...cir.wires]) if (!want.has(key(w.a, w.b))) { cir.disconnect(w); await app.wait(60); }
    for (const [a, b] of list) if (!cir.wires.some((w) => key(w.a, w.b) === key(a, b))) { cir.connect(a, b); await app.wait(160); }
  }
  settled() { return [this.am, this.vm].every((m) => !m.comp.placed || (Math.abs(m.vel) < 0.002 && Math.abs(clamp(m.target, -0.03, 1.07) - m.theta) < 0.0015)); }
  async settle() { const t0 = performance.now(); while (!this.settled() && performance.now() - t0 < 3000) await this.app.wait(40, true); }
  /** 调滑动端，使电压表示数接近目标 */
  async slideTo(Ut, byCurrent = false) {
    const rh = this.cir.dev('rheo'), s0 = rh.s;
    const U = (s) => { rh.s = s; this.cir.solve(); return byCurrent ? this.am.target * AM_RANGES[this.am.rangeIdx].full * 1000 : this.vm.target * VM_RANGES[this.vm.rangeIdx].full; };
    let lo = 0, hi = 1; // s=0 输出最大
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (U(m) > Ut) lo = m; else hi = m; }
    const s1 = (lo + hi) / 2 + gauss(0.002);
    rh.s = s0; this.cir.solve();
    this.app.select(rh.comp);
    await this.app.tween(() => rh.s, (v) => (rh.s = v), clamp(s1, 0, 1), 500);
    await this.settle();
  }
  async power(on) { const sw = this.cir.dev('sw'); this.app.select(sw.comp); sw.closed = on; this.app.changed(); await this.app.wait(250); }
  circuit(part, mode, ai, vi) {
    const am = `am:r${ai}`, vm = `vm:r${vi}`;
    const base = [['supply:+', 'sw:a'], ['sw:b', 'rheo:A'], ['rheo:B', 'supply:-']];
    if (part === 'diode') return [...base, ['rheo:C', 'r0:a'], ['r0:b', am], ['am:com', 'diode:a'], ['diode:b', 'rheo:B'], [vm, 'diode:a'], ['vm:com', 'diode:b']];
    return [...base, ['rheo:C', am], ['am:com', `${part}:a`], [`${part}:b`, 'rheo:B'], ...(mode === '外接' ? [[vm, `${part}:a`]] : [[vm, am]]), ['vm:com', `${part}:b`]];
  }
  async measure(id, part, mode, ai, vi, Us, byCurrent = false) {
    const app = this.app;
    await this.power(false);
    const rh = this.cir.dev('rheo'); app.select(rh.comp); await app.tween(() => rh.s, (v) => (rh.s = v), 1, 400);
    await this.rewire(this.circuit(part, mode, ai, vi));
    await this.power(true);
    app.showTable(app.tables.findIndex((t) => t.id === id));
    for (const U of Us) { await this.slideTo(U, byCurrent); await app.record(id); }
  }

  steps() {
    const app = this.app, cir = this.cir;
    const rows = (id, mode) => app.table(id).completeRows().filter((r) => !mode || r.mode === mode).length;
    const divider = () => { const n = cir.nets(); const A = n('rheo:A'), B = n('rheo:B'), S = [n('supply:+'), n('supply:-'), n('sw:a'), n('sw:b')]; return cir.placed('rheo') && A !== B && S.includes(A) && S.includes(B) && n('rheo:C') !== A && n('rheo:C') !== B; };
    return [
      {
        title: '摆放仪器',
        html: '<p>把稳压电源、开关、滑线变阻器、毫安表、电压表和待测电阻 Rx1 放到实验桌上。</p>',
        check: () => ['supply', 'sw', 'rheo', 'am', 'vm', 'rx1'].every((k) => cir.placed(k)),
        auto: async () => { await app.view('全景'); for (const k of ['supply', 'sw', 'rheo', 'am', 'vm', 'rx1']) await app.autoPlace(k); },
      },
      {
        title: '连接分压电路（电流表外接）',
        html: '<p><b>点一个接线柱，再点另一个接线柱</b>即连上一根导线；点导线可拆除。<br>电源经开关接到变阻器两端 A、B；从滑动端 C 与 B 之间取出电压，接毫安表“+”（量程端）→ 毫安表“−” → Rx1 → B。电压表直接并在 Rx1 两端（外接）。</p><p>接线时开关断开；合上开关前把滑动端移到使输出电压为零的一端。</p>',
        hint: '量程先估算：电源 3 V 左右，Rx1 约 20 Ω，电流约 100 mA，可选 150 mA 档；电压表选 3 V 档。',
        check: () => { const m = this.measureInfo(); return divider() && m && m.part === 'rx1' && m.mode === '外接'; },
        status: () => { const m = this.measureInfo(); return m ? `识别到：测 ${cir.dev(m.part).short}，电流表${m.mode}` : '尚未形成测量电路'; },
        auto: async () => { await this.power(false); await this.rewire(this.circuit('rx1', '外接', 4, 1)); },
      },
      {
        title: '外接法测 Rx1',
        html: '<p>打开电源，电压调到约 3 V。合上开关，移动滑动端改变电压，记录 5 组以上 U、I。</p>',
        check: () => rows('rx1', '外接') >= 5,
        status: () => `已记录 ${rows('rx1', '外接')} 组`,
        auto: async () => {
          const sp = cir.dev('supply'); app.select(sp.comp); sp.on = true; await app.tween(() => sp.Vset, (v) => (sp.Vset = v), 3.2, 600);
          await this.measure('rx1', 'rx1', '外接', 4, 1, [1.4, 1.75, 2.1, 2.45, 2.8]);
        },
      },
      {
        title: '改为内接法再测 Rx1',
        html: '<p>断开开关，把电压表的“+”端从 Rx1 改接到毫安表“+”端（内接）。再测 3 组以上，比较两种接法的 U/I。</p>',
        check: () => rows('rx1', '内接') >= 3,
        status: () => `已记录 ${rows('rx1', '内接')} 组`,
        auto: async () => { await this.measure('rx1', 'rx1', '内接', 4, 1, [1.6, 2.2, 2.8]); },
      },
      {
        title: '换 Rx2，两种接法各测几组',
        html: '<p>用 Rx2 换下 Rx1，电源调到约 6 V，毫安表换 3 mA 档、电压表换 7.5 V 档。内接、外接各测 3 组以上。</p>',
        hint: '判断依据：$R_x \\gg \\sqrt{R_A R_V}$ 用内接，$R_x \\ll \\sqrt{R_A R_V}$ 用外接。',
        check: () => rows('rx2', '内接') >= 3 && rows('rx2', '外接') >= 3,
        status: () => `内接 ${rows('rx2', '内接')} 组，外接 ${rows('rx2', '外接')} 组`,
        auto: async () => {
          await this.power(false);
          const sp = cir.dev('supply'); app.select(sp.comp); await app.tween(() => sp.Vset, (v) => (sp.Vset = v), 6, 500);
          if (!cir.placed('rx2')) await app.autoPlace('rx2');
          await this.measure('rx2', 'rx2', '内接', 1, 2, [3, 4, 5]);
          await this.measure('rx2', 'rx2', '外接', 1, 2, [3, 4, 5]);
        },
      },
      {
        title: '二极管正向伏安特性',
        html: '<p>换成“限流电阻 R₀ + 二极管”串联，电压表并在二极管两端，选 1.5 V 档。从零开始逐渐升高电压，电流小时用 1.5 mA 档，增大后换 15 mA、75 mA 档（换档前先断开开关）。记录 8 组以上，电流不超过 40 mA。</p>',
        check: () => rows('d') >= 8,
        status: () => `已记录 ${rows('d')} 组`,
        auto: async () => {
          await this.power(false);
          const sp = cir.dev('supply'); app.select(sp.comp); await app.tween(() => sp.Vset, (v) => (sp.Vset = v), 5, 500);
          for (const k of ['r0', 'diode']) if (!cir.placed(k)) await app.autoPlace(k);
          await this.measure('d', 'diode', '外接', 0, 0, [0.25, 0.6, 1.2], true);
          await this.measure('d', 'diode', '外接', 2, 0, [3, 6, 11], true);
          await this.measure('d', 'diode', '外接', 3, 0, [20, 32], true);
          await this.power(false);
        },
      },
      {
        title: '数据处理',
        html: '<p>用 U–I 数据求出 U/I，按接法修正电表内阻带来的系统误差；作二极管的 I–U 曲线，求导通电压。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const app = this.app;
    const res = {};
    let html = '';
    const answers = [];
    const fit = (rs) => { const sx = rs.reduce((s, r) => s + r.U * (r.I / 1000), 0), sxx = rs.reduce((s, r) => s + (r.I / 1000) ** 2, 0); return sx / sxx; };
    const plots = [];
    for (const [id, nm, best, Rt] of [['rx1', 'Rx1', '外接', this.R1], ['rx2', 'Rx2', '内接', this.R2]]) {
      const rs = app.table(id).completeRows().filter((r) => r.I > 0);
      if (!rs.length) continue;
      html += `<h3>${nm}</h3><table><tr><th>接法</th><th>组数</th><th>$U/I$ 拟合/Ω</th><th>电表内阻</th><th>修正后 $R_x$/Ω</th></tr>`;
      for (const mode of ['外接', '内接']) {
        const m = rs.filter((r) => r.mode === mode);
        if (m.length < 2) continue;
        const Rm = fit(m);
        const RV = mean(m.map((r) => r.rv)), RA = mean(m.map((r) => r.ra));
        const Rc = mode === '外接' ? (Rm * RV) / (RV - Rm) : Rm - RA;
        res[id + mode] = Rc;
        html += `<tr><td>${mode}</td><td>${m.length}</td><td>${Rm.toFixed(id === 'rx1' ? 2 : 0)}</td><td>${mode === '外接' ? `R_V = ${RV.toFixed(0)} Ω` : `R_A = ${RA.toFixed(1)} Ω`}</td><td>${Rc.toFixed(id === 'rx1' ? 2 : 0)}</td></tr>`;
        plots.push({ title: `${nm} 的 U–I（${mode}）`, xLabel: 'I / mA', yLabel: 'U / V', series: [{ type: 'scatter', data: m.map((r) => [r.I, r.U]) }, { type: 'line', data: fnData((x) => (Rm * x) / 1000, 0, Math.max(...m.map((r) => r.I)) * 1.05) }] });
      }
      html += '</table>';
      const v = res[id + best] ?? res[id + (best === '外接' ? '内接' : '外接')];
      if (v != null) {
        html += `<div class="result-box">$${nm.replace('x', '_{x')}}=${v.toFixed(id === 'rx1' ? 2 : 0)}\\ \\Omega$（${res[id + best] != null ? best : '另一种接法'}，已修正）</div>`;
        answers.push({ label: `修正后的 $${nm.replace('x', '_{x')}}$`, unit: 'Ω', value: v, digits: id === 'rx1' ? 2 : 0, tolRel: 0.008 });
        res[id] = [v, Rt];
      }
      const e = res[id + '外接'], i = res[id + '内接'];
      if (e != null && i != null) {
        const unc = (mode) => { const m = rs.filter((r) => r.mode === mode); return fit(m); };
        html += `<p>未修正时，外接法的 U/I 比实际值偏${unc('外接') < Rt ? '小' : '大'} ${pct(Math.abs(unc('外接') - Rt) / Rt, 1)}，内接法偏大 ${pct(Math.abs(unc('内接') - Rt) / Rt, 1)}。$\\sqrt{R_AR_V}$ 约 ${Math.sqrt(mean(rs.map((r) => r.ra)) * mean(rs.map((r) => r.rv))).toFixed(0)} Ω，${nm} ${Rt > Math.sqrt(mean(rs.map((r) => r.ra)) * mean(rs.map((r) => r.rv))) ? '大于它，宜用内接法' : '小于它，宜用外接法'}。</p>`;
      }
    }
    const ds = app.table('d').completeRows().filter((r) => r.I > 0).sort((a, b) => a.U - b.U);
    if (ds.length >= 4) {
      const top = ds.slice(-3);
      const n = top.length, mx = mean(top.map((r) => r.U)), my = mean(top.map((r) => r.I));
      const k = top.reduce((s, r) => s + (r.U - mx) * (r.I - my), 0) / top.reduce((s, r) => s + (r.U - mx) ** 2, 0);
      const U0 = mx - my / k;
      html += `<h3>二极管正向特性</h3><p>电流随电压近似按指数增长。把电流较大的 ${n} 个点的切线延长到 $I=0$，得导通电压</p><div class="result-box">$U_{on}\\approx ${U0.toFixed(2)}$ V</div>`;
      plots.push({ title: '二极管正向伏安特性', xLabel: 'U / V', yLabel: 'I / mA', series: [{ type: 'scatter', data: ds.map((r) => [r.U, r.I]) }, { type: 'line', data: ds.map((r) => [r.U, r.I]) }, { type: 'line', data: [[U0, 0], [top[2].U, my + k * (top[2].U - mx)]], dash: [5, 4] }] });
    }
    if (!answers.length && ds.length < 4) return { html: '<p>请先测量并记录数据。</p>', ok: false };
    const tail = [];
    if (res.rx1) tail.push(`Rx1 = ${res.rx1[1].toFixed(2)} Ω（修正后相对误差 ${pct(relErr(res.rx1[0], res.rx1[1]))}）`);
    if (res.rx2) tail.push(`Rx2 = ${res.rx2[1].toFixed(0)} Ω（修正后相对误差 ${pct(relErr(res.rx2[0], res.rx2[1]))}）`);
    if (tail.length) html += `<div class="result-box warn">电阻的实际值：${tail.join('；')}。剩余误差来自电表的准确度等级（0.5 级）和读数。</div>`;
    return { html, ok: true, answers, plots };
  }

  principle() {
    return `<h3>1. 伏安法</h3><p>测出电阻两端电压 $U$ 和通过的电流 $I$，$R=U/I$。电表有内阻，接法不同会带来系统误差。</p>
${voltampFig()}
<h3>2. 电流表外接</h3><p>电压表直接并在 $R_x$ 两端，电流表测得的是 $R_x$ 与电压表电流之和，$U/I$ 是 $R_x$ 与 $R_V$ 的并联值，偏小。修正：</p>$$R_x=\\frac{U}{I-U/R_V}$$
<h3>3. 电流表内接</h3><p>电压表并在 $R_x$ 与电流表串联的两端，测得的电压多了电流表上的压降，$U/I=R_x+R_A$，偏大。修正：$R_x=U/I-R_A$。</p>
<p>$R_x\\ll\\sqrt{R_AR_V}$ 时外接误差小，$R_x\\gg\\sqrt{R_AR_V}$ 时内接误差小。</p>
<h3>4. 分压电路</h3><p>电源接在变阻器两端，从滑动端与一端之间取出电压，可从 0 连续调节。接通前应使输出为零。</p>
<h3>5. 二极管</h3><p>正向电流 $I=I_s\\left(e^{U/nU_T}-1\\right)$，$U_T=kT/e\\approx 26$ mV。硅管电流在零点几伏后迅速增大。</p>
<h3>6. 本仿真的计算模型</h3><p>按实际接线（每根导线约 0.01 Ω）列出节点方程，用改进节点法求解整个电路，二极管用牛顿迭代。电表按所接量程端的内阻接入电路，指针按二阶阻尼运动，示值含 0.5 级以内的固定误差。稳压电源超过限流值时自动转为恒流。</p>`;
  }
}
