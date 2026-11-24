// 实验：自组惠斯通电桥测电阻（平衡条件 · 保护电阻与跃接法 · 交换法消除比例臂误差 · 电桥灵敏度）
import * as THREE from 'three';
import { Circuit, benchTable, analogMeter, dcSupply, rheostat, knifeSwitch, partBoard, resistanceBox, drawDialFace } from '../core/circuit.js';
import { mean, gauss, rand, relErr, pct } from '../core/Stats.js';

const G_PER_DIV = 1.0e-6; // 检流计每格电流 A
const G_DIVS = 60; // ±30 格

export class BridgeExperiment {
  static meta = {
    id: 'bridge',
    title: '惠斯通电桥测电阻',
    subtitle: '电桥平衡 · 保护电阻与跃接法 · 交换法消除比例臂误差 · 电桥灵敏度',
    tags: ['电学', '比较法', '电桥'],
    level: '基础',
    time: '45 min',
    color: '#0f766e',
    formula: String.raw`R_x=\dfrac{R_1}{R_2}R_0,\quad R_x=\sqrt{R_0R_0'}`,
    measure: '两个中值电阻的阻值、电桥灵敏度',
    goals: ['理解惠斯通电桥的平衡原理，学会自组电桥', '掌握检流计的保护方法（保护电阻、跃接）和电桥平衡的调节', '用交换法消除比例臂误差，测量电桥灵敏度并估算其引起的误差'],
    questions: ['电桥平衡时，电源电压的波动对测量结果有没有影响？为什么？', '为什么调平衡时先接入较大的保护电阻？最后为什么要把它减到零？', '交换法为什么能消除比例臂 R₁、R₂ 不相等带来的误差？', '如何提高电桥的灵敏度？'],
  };

  static thumb(ctx, w, h) {
    ctx.fillStyle = '#f1ede2'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1d2832'; ctx.lineWidth = 2;
    const cx = w / 2, cy = h / 2, r = w * 0.32;
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
    ctx.fillStyle = '#f1ede2'; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c41e3a'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.fillText('G', cx, cy + 4);
  }

  constructor(app) {
    this.app = app;
    this.Rx1 = rand(300, 900);
    this.Rx2 = rand(3000, 9000);
    this.R1 = 1000 * (1 + rand(-0.5, 0.5) / 100); // 比例臂（±0.5%）
    this.R2 = 1000 * (1 + rand(-0.5, 0.5) / 100);
    this._warned = {};
  }

  cameras() {
    return [
      { name: '全景', pos: [0, 100, 92], target: [0, 0, -2] },
      { name: '检流计', pos: [4, 44, 18], target: [4, 2, -24] },
      { name: '电阻箱', pos: [34, 48, 30], target: [34, 2, -6] },
    ];
  }

  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(170, 90));
    app.stage.setLightTarget(0, 0, 0);
    const slot = (id, x, z, accepts) => app.addSlot({ id, pos: new THREE.Vector3(x, 0, z), accepts });
    slot('supply', -62, -22, ['supply']); slot('K', -40, 14, ['K']); slot('g', 4, -26, ['g']); slot('gp', -22, -26, ['gp']); slot('kg', 4, -6, ['kg']);
    slot('rb', 40, -18, ['rb']); slot('r1', -22, 6, ['r1']); slot('r2', -22, 22, ['r2']);
    slot('p1', 14, 20, ['rx1', 'rx2']); slot('p2', 32, 26, ['rx1', 'rx2']);
    const cir = (this.cir = new Circuit(app));
    this.sup = cir.add(dcSupply({ defaultSlot: 'supply', vmax: 15, imax: 1 }));
    cir.add(knifeSwitch({ key: 'K', name: '电源开关 K', defaultSlot: 'K' }));
    this.g = cir.add(analogMeter({ key: 'g', name: '指针式检流计', short: '检流计', kind: 'G', center: true, divs: G_DIVS, perDiv: G_PER_DIV, Rg: 100, defaultSlot: 'g', desc: '零点在中央，左右各 30 格，每格约 1 μA，内阻约 100 Ω。过载会损坏，调平衡时要串联保护电阻并跃接。' }));
    this.gp = cir.add(rheostat({ key: 'gp', name: '保护电阻（0–10 kΩ 电位器）', R: 10000, Imax: 0.05, defaultSlot: 'gp' }));
    cir.add(knifeSwitch({ key: 'kg', name: '检流计按键 G', defaultSlot: 'kg' }));
    this.rb = cir.add(resistanceBox({ key: 'rb', name: '电阻箱 R₀（比较臂）', defaultSlot: 'rb' }));
    cir.add(partBoard({ key: 'r1', name: '比例臂 R₁（1000 Ω）', short: 'R₁', label: 'R₁ 1000Ω', defaultSlot: 'r1', elements: (t) => [{ type: 'R', a: t('a'), b: t('b'), R: this.R1 }], desc: '标称 1000 Ω，允许误差 ±0.5%。' }));
    cir.add(partBoard({ key: 'r2', name: '比例臂 R₂（1000 Ω）', short: 'R₂', label: 'R₂ 1000Ω', defaultSlot: 'r2', elements: (t) => [{ type: 'R', a: t('a'), b: t('b'), R: this.R2 }], desc: '标称 1000 Ω，允许误差 ±0.5%。' }));
    cir.add(partBoard({ key: 'rx1', name: '待测电阻 Rx1（几百欧）', short: 'Rx1', label: 'Rx1', defaultSlot: 'p1', elements: (t) => [{ type: 'R', a: t('a'), b: t('b'), R: this.Rx1 }] }));
    cir.add(partBoard({ key: 'rx2', name: '待测电阻 Rx2（几千欧）', short: 'Rx2', label: 'Rx2', defaultSlot: 'p2', elements: (t) => [{ type: 'R', a: t('a'), b: t('b'), R: this.Rx2 }] }));
    this.view = app.addView({ id: 'g', title: '检流计', w: 260, h: 150, res: 1 });
  }

  pointerDown(e) { return this.cir.pointerDown(e); }
  pointerMove(e) { return this.cir.pointerMove(e); }
  onRemove(c) { this.cir.removeDevice(c.key); }
  tick(dt) { this.cir.tick(dt); }

  update() {
    this.cir.solve();
    const v = this.view;
    drawDialFace(v.ctx, 0, 0, v.W, v.H, { kind: 'G', divs: G_DIVS, center: true, cls: '', unit: 'G', theta: this.g.comp.placed ? this.g.theta : 0 });
    const b = this.bridge();
    v.foot(b ? `电桥：${b.part === 'rx1' ? 'Rx1' : 'Rx2'}，${b.cfg} · R₀ = ${this.rb.nominal().toFixed(1)} Ω` : '');
    const over = this.g.comp.placed && Math.abs(this.g.target) > 0.52;
    if (over && !this._warned.g) this.app.toast('检流计过载！应断开按键，加大保护电阻', 'warn');
    this._warned.g = over;
  }

  /** 识别电桥结构：四个臂、两个对角 */
  bridge() {
    const c = this.cir;
    const P = ['rx1', 'rx2'].filter((k) => c.placed(k));
    if (!['r1', 'r2', 'rb', 'g'].every((k) => c.placed(k)) || !P.length) return null;
    const n = c.nets();
    const nn = (k) => [n(`${k}:a`), n(`${k}:b`)];
    const shared = (x, y) => x.filter((v) => y.includes(v));
    const r1 = nn('r1'), r2 = nn('r2'), rb = nn('rb');
    const C = shared(r1, r2); if (C.length !== 1) return null;
    const A = r1.find((v) => v !== C[0]), B = r2.find((v) => v !== C[0]);
    for (const p of P) {
      const x = nn(p), D = shared(x, rb);
      if (D.length !== 1 || D[0] === C[0]) continue;
      const xo = x.find((v) => v !== D[0]), bo = rb.find((v) => v !== D[0]);
      if (!((xo === A && bo === B) || (xo === B && bo === A))) continue;
      const g = [n('g:+'), n('g:-')];
      if (!g.some((v) => v === C[0] || v === D[0])) continue;
      return { part: p, cfg: xo === A ? '正接' : '交换', A, B, C: C[0], D: D[0] };
    }
    return null;
  }
  gDiv() { return this.g.theta * G_DIVS; }

  tables() {
    return [
      {
        id: 'bal', title: '电桥平衡', maxRows: 10,
        columns: [{ key: 'obj', label: '待测', type: 'text' }, { key: 'cfg', label: '接法', type: 'text' }, { key: 'R0', label: '平衡时 R₀/Ω', digits: 1 }],
        buttons: [{ label: '记录平衡时的 R₀', onClick: (t) => this.recBal(t) }],
        note: '正接：R₀ 与 Rx 在同一侧；交换：把 Rx 与 R₀ 的位置互换后重新调平衡。',
      },
      {
        id: 'sens', title: '电桥灵敏度', maxRows: 8,
        columns: [{ key: 'obj', label: '待测', type: 'text' }, { key: 'R0', label: '平衡 R₀/Ω', digits: 1 }, { key: 'dR', label: 'ΔR₀/Ω', digits: 1 }, { key: 'dn', label: 'Δn/格', digits: 1 }, { key: 'S', label: 'S = Δn/(ΔR₀/R₀)', digits: 0, calc: (r) => Math.abs(r.dn / (r.dR / r.R0)) }],
        buttons: [{ label: '记录 ΔR₀ 和检流计偏转 Δn', onClick: (t) => this.recSens(t) }],
        note: '平衡后把 R₀ 改变 ΔR₀，使检流计偏转约 5 格，记录。',
      },
    ];
  }
  recBal(t) {
    const b = this.bridge();
    if (!b) return this.app.toast('电桥没有接好', 'warn');
    if (!this.cir.dev('K').closed || !this.sup.on) return this.app.toast('电源没有接通', 'warn');
    if (!this.cir.dev('kg').closed) return this.app.toast('按下检流计按键才能判断是否平衡', 'warn');
    if (this.gp.s * 10000 > 50) this.app.toast('保护电阻没有减到零，平衡判断不够灵敏', 'warn');
    if (Math.abs(this.gDiv()) > 0.5) this.app.toast('检流计还没有指零', 'warn');
    t.addRow({ obj: b.part === 'rx1' ? 'Rx1' : 'Rx2', cfg: b.cfg, R0: Math.round(this.rb.nominal() * 10) / 10 });
  }
  recSens(t) {
    const b = this.bridge();
    if (!b) return this.app.toast('电桥没有接好', 'warn');
    const obj = b.part === 'rx1' ? 'Rx1' : 'Rx2';
    const bal = this.app.table('bal').completeRows().filter((r) => r.obj === obj && r.cfg === b.cfg).pop();
    if (!bal) return this.app.toast('请先记录平衡时的 R₀', 'warn');
    const dR = Math.round((this.rb.nominal() - bal.R0) * 10) / 10;
    if (!dR) return this.app.toast('先把 R₀ 改变一点（ΔR₀），再记录', 'warn');
    const dn = Math.round(this.gDiv() * 2) / 2;
    if (!dn) return this.app.toast('检流计没有偏转，ΔR₀ 太小或指针还没稳定', 'warn');
    t.addRow({ obj, R0: bal.R0, dR, dn });
  }

  // ---------------- 自动操作 ----------------
  wiring(p, cfg) {
    const base = [['supply:+', 'K:a'], ['K:b', 'r1:a'], ['r1:b', 'r2:a'], ['r2:b', 'supply:-'], ['r1:b', 'gp:A'], ['gp:C', 'kg:a'], ['kg:b', 'g:+']];
    if (cfg === '正接') return [...base, ['r1:a', `${p}:a`], [`${p}:b`, 'rb:a'], ['rb:b', 'r2:b'], ['g:-', `${p}:b`]];
    return [...base, ['r1:a', 'rb:a'], ['rb:b', `${p}:a`], [`${p}:b`, 'r2:b'], ['g:-', 'rb:b']];
  }
  /** 平衡时 R₀ 的理论值（按当前接线） */
  async balance() {
    const app = this.app, rb = this.rb, gp = this.gp, kg = this.cir.dev('kg');
    const gAt = (R) => { const d = rb.d.slice(); rb.set(R); this.cir.solve(); const v = this.g.target; rb.d = d; return v; };
    kg.closed = true;
    let lo = 1, hi = 99999, s = Math.sign(gAt(lo));
    for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (Math.sign(gAt(m)) === s) lo = m; else hi = m; }
    kg.closed = false;
    const R = Math.sqrt(lo * hi);
    // 预置 R₀ 为估计值（按标称比例臂和待测电阻的大致阻值）
    app.select(rb.comp);
    await app.tween(() => rb.nominal(), (v) => rb.set(v), R * (1 + gauss(0.03)), 700);
    // 粗调：保护电阻最大，跃接
    app.select(gp.comp); await app.tween(() => gp.s, (v) => (gp.s = v), 1, 400);
    app.select(kg.comp); kg.closed = true; app.changed(); await app.wait(300);
    app.select(rb.comp);
    await app.tween(() => rb.nominal(), (v) => rb.set(v), R * (1 + gauss(0.003)), 700);
    await this.cir.settle([this.g], 1500);
    // 细调：保护电阻减到零
    app.select(gp.comp); await app.tween(() => gp.s, (v) => (gp.s = v), 0, 500);
    app.select(rb.comp);
    const q = (x) => Math.round(x * 10) / 10;
    const cand = [q(R) - 0.1, q(R), q(R) + 0.1];
    const best = cand.reduce((a, c) => (Math.abs(gAt(c)) < Math.abs(gAt(a)) ? c : a));
    await app.tween(() => rb.nominal(), (v) => rb.set(v), best, 600); rb.set(best); app.changed();
    await this.cir.settle([this.g], 5000);
    return best;
  }
  async measure(p, cfg, sens) {
    const app = this.app, K = this.cir.dev('K'), kg = this.cir.dev('kg');
    kg.closed = false; K.closed = false; app.changed();
    if (!this.cir.placed(p)) await app.autoPlace(p);
    await this.cir.rewire(this.wiring(p, cfg));
    app.select(K.comp); K.closed = true; app.changed(); await app.wait(200);
    const R = await this.balance();
    app.showTable(0); await app.record('bal');
    if (sens) {
      const S0 = 5;
      // 估计使偏转 5 格的 ΔR₀
      const gAt = (x) => { const d = this.rb.d.slice(); this.rb.set(x); this.cir.solve(); const v = this.g.target * G_DIVS; this.rb.d = d; return v; };
      const k = (gAt(R + 10) - gAt(R)) / 10;
      let dR = Math.round((S0 / Math.abs(k)) * 10) / 10 || 0.1;
      for (let tr = 0; tr < 4; tr++) {
        app.select(this.rb.comp); await app.tween(() => this.rb.nominal(), (v) => this.rb.set(v), R + dR, 500); this.rb.set(R + dR); app.changed();
        await this.cir.settle([this.g], 6000);
        if (Math.abs(this.gDiv()) >= 2) break;
        dR = Math.round(dR * 20) / 10;
      }
      app.showTable(1); await app.record('sens');
      this.rb.set(R); app.changed();
    }
    kg.closed = false; app.changed();
  }

  steps() {
    const app = this.app, cir = this.cir;
    const bal = (obj, cfg) => app.table('bal').completeRows().some((r) => r.obj === obj && r.cfg === cfg);
    return [
      {
        title: '摆放仪器',
        html: '<p>把电源、开关 K、比例臂 R₁ 和 R₂、电阻箱 R₀、待测电阻 Rx1、检流计、保护电阻和检流计按键放到桌上。</p>',
        check: () => ['supply', 'K', 'r1', 'r2', 'rb', 'rx1', 'g', 'gp', 'kg'].every((k) => cir.placed(k)),
        auto: async () => { await app.view('全景'); for (const k of ['supply', 'K', 'r1', 'r2', 'rb', 'rx1', 'g', 'gp', 'kg']) await app.autoPlace(k); },
      },
      {
        title: '连接电桥',
        html: '<p>按电桥电路接线：R₁、R₂ 串联成一边，Rx1 与 R₀ 串联成另一边，两边并联后经开关 K 接电源。检流计经保护电阻（电位器的 A、C 端）和按键 G 接在两边的中点之间。</p>',
        hint: '平衡条件 $R_1R_0=R_2R_x$。',
        check: () => { const b = this.bridge(); return b && b.part === 'rx1' && b.cfg === '正接'; },
        status: () => { const b = this.bridge(); return b ? `识别到电桥：${b.part}，${b.cfg}` : '尚未接成电桥'; },
        auto: async () => { await cir.rewire(this.wiring('rx1', '正接')); },
      },
      {
        title: '调平衡（正接）',
        html: '<p>电源调到 3 V 左右。R₀ 先预置一个估计值，保护电阻调到最大，合上 K，<b>跃接</b>（短暂按下）检流计按键，看偏转方向调 R₀。偏转变小后逐步减小保护电阻，最后减到零，把 R₀ 调到检流计指零，记录。</p>',
        check: () => bal('Rx1', '正接'),
        auto: async () => {
          const sp = this.sup; app.select(sp.comp); sp.on = true; await app.tween(() => sp.Vset, (v) => (sp.Vset = v), 3, 500);
          this.rb.set(500); app.changed();
          await app.view('检流计');
          await this.measure('rx1', '正接', true);
        },
      },
      {
        title: '测电桥灵敏度',
        html: '<p>平衡后，把 R₀ 改变 ΔR₀，使检流计偏转约 5 格，记录 ΔR₀ 和偏转格数 Δn。$S=\\Delta n/(\\Delta R_0/R_0)$。</p>',
        check: () => app.table('sens').completeRows().some((r) => r.obj === 'Rx1'),
        auto: async () => { if (!app.table('sens').completeRows().some((r) => r.obj === 'Rx1')) await this.measure('rx1', '正接', true); },
      },
      {
        title: '交换法：互换 Rx1 与 R₀',
        html: '<p>断开 K，把 Rx1 与 R₀ 的位置互换（比例臂不动），重新调平衡，记录此时的 R₀′。$R_x=\\sqrt{R_0R_0\'}$ 与比例臂的误差无关。</p>',
        check: () => bal('Rx1', '交换'),
        auto: async () => { await app.view('全景'); await this.measure('rx1', '交换', false); },
      },
      {
        title: '测 Rx2',
        html: '<p>换上 Rx2，正接和交换各调一次平衡，并测一次灵敏度。电压可适当提高到 6 V。</p>',
        check: () => bal('Rx2', '正接') && bal('Rx2', '交换'),
        auto: async () => {
          const sp = this.sup; app.select(sp.comp); await app.tween(() => sp.Vset, (v) => (sp.Vset = v), 6, 500);
          await this.measure('rx2', '正接', true);
          await this.measure('rx2', '交换', false);
          this.cir.dev('K').closed = false; app.changed();
        },
      },
      {
        title: '数据处理',
        html: '<p>用交换法求 Rx，估算电阻箱准确度和电桥灵敏度引起的不确定度。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  analyze() {
    const bal = this.app.table('bal').completeRows(), sens = this.app.table('sens').completeRows();
    if (!bal.length) return { html: '<p>请先调平衡并记录。</p>', ok: false };
    let html = '';
    const answers = [], tail = [];
    for (const [obj, Rt] of [['Rx1', this.Rx1], ['Rx2', this.Rx2]]) {
      const a = bal.filter((r) => r.obj === obj && r.cfg === '正接').map((r) => r.R0), b = bal.filter((r) => r.obj === obj && r.cfg === '交换').map((r) => r.R0);
      if (!a.length) continue;
      const R0 = mean(a), sub = obj.replace('x', '_{x');
      html += `<h3>${obj}</h3><p>正接平衡 $R_0=${R0.toFixed(1)}$ Ω`;
      let Rx = R0;
      if (b.length) { const R0p = mean(b); Rx = Math.sqrt(R0 * R0p); html += `，交换后 $R_0'=${R0p.toFixed(1)}$ Ω。两者不相等，说明比例臂 $R_1\\neq R_2$：$R_1/R_2\\approx ${Math.sqrt(R0p / R0).toFixed(4)}$。</p>`; }
      else html += '（未做交换法，比例臂误差未消除）。</p>';
      const S = sens.filter((r) => r.obj === obj).map((r) => Math.abs(r.dn / (r.dR / r.R0))).filter((v) => isFinite(v) && v > 0);
      const uBox = 0.001 / Math.sqrt(3), uS = S.length ? 0.2 / mean(S) / Math.sqrt(3) : 0;
      const u = Rx * Math.sqrt(uBox ** 2 + uS ** 2);
      if (S.length) html += `<p>电桥灵敏度 $S=${mean(S).toFixed(0)}$ 格。检流计能分辨 0.2 格，由灵敏度引起的相对误差约 $0.2/S=${pct(0.2 / mean(S), 3)}$。</p>`;
      html += `<p>电阻箱 0.1 级，相对误差限 0.1%。合成标准不确定度 $u=${u.toFixed(obj === 'Rx1' ? 2 : 1)}$ Ω。</p><div class="result-box">$${sub}}=(${Rx.toFixed(obj === 'Rx1' ? 2 : 1)}\\pm ${u.toFixed(obj === 'Rx1' ? 2 : 1)})\\ \\Omega$</div>`;
      answers.push({ label: `$${sub}}$`, unit: 'Ω', value: Rx, digits: obj === 'Rx1' ? 2 : 1, tolRel: 0.0015 });
      tail.push(`${obj} 实际 ${Rt.toFixed(2)} Ω，${b.length ? '交换法' : '正接'}结果相对误差 ${pct(relErr(Rx, Rt), 3)}${b.length ? `，只用正接时偏离 ${pct(relErr(R0, Rt), 2)}` : ''}`);
    }
    html += `<div class="result-box warn">${tail.join('；')}。比例臂实际值：R₁ = ${this.R1.toFixed(2)} Ω，R₂ = ${this.R2.toFixed(2)} Ω。</div>`;
    return { html, ok: true, answers, plots: [] };
  }

  principle() {
    return `<h3>1. 电桥平衡</h3><p>四个电阻 $R_1$、$R_2$、$R_x$、$R_0$ 接成四边形，一条对角线接电源，另一条接检流计。调 $R_0$ 使检流计中无电流（电桥平衡），此时两个中点等电位：</p>$$R_1R_0=R_2R_x\\quad\\Rightarrow\\quad R_x=\\frac{R_1}{R_2}R_0$$<p>平衡与电源电压无关，检流计只作“零”指示，所以电桥的准确度主要取决于 $R_0$ 和比例臂。</p>
<h3>2. 交换法</h3><p>交换 $R_x$ 与 $R_0$ 再调平衡，得 $R_x=\\dfrac{R_2}{R_1}R_0'$。两式相乘：$R_x=\\sqrt{R_0R_0'}$，比例臂的误差被消除。</p>
<h3>3. 灵敏度</h3><p>$S=\\dfrac{\\Delta n}{\\Delta R_0/R_0}$。检流计能分辨的最小偏转约 0.2 格，由此引起的相对误差约 $0.2/S$。提高电源电压、选用灵敏的检流计、使各臂阻值相近都可以提高灵敏度。</p>
<h3>4. 检流计的保护</h3><p>远离平衡时检流计可能过载。先串联大的保护电阻、用跃接法短暂接通，接近平衡后再逐步减小保护电阻。</p>
<h3>5. 本仿真的计算模型</h3><p>整个电桥（含导线和接触电阻、检流计内阻、保护电阻）用改进节点法求解；检流计指针按欠阻尼二阶系统运动，跃接时会摆动。比例臂的实际值有 ±0.5% 的随机偏差，电阻箱有 0.1 级以内的固定误差。</p>`;
  }
}
