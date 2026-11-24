// 像质分析面板：点列图、光线像差曲线（子午 / 弧矢）、场曲与畸变。
// 物在无穷远，用 lensTrace 的精确三维光线追迹（光线瞄准到光阑），F、d、C 三条谱线。
import { paraxial, trace, toPlane, aimRay, fieldCurves } from '../physics/lensTrace.js';

export const WL = [
  { nm: 486.13, c: '#2f6bff', n: 'F' },
  { nm: 587.56, c: '#1f9a55', n: 'd' },
  { nm: 656.27, c: '#d62f3f', n: 'C' },
];
const FIELDS = [0, 0.7, 1];
const INK = '#1d2832', INK3 = '#85919a', GRID = '#d3e2d7', GRID2 = '#b9d0c0', PAPER = '#fbfcfa';

function ray(L, lam, th, px, py, par) {
  const a = aimRay(L, lam, th, px, py, par);
  if (!a) return null;
  const r = trace(L, lam, a.p, a.d, { clip: false, zv: par.zv });
  return r.ok ? r : null;
}
/** 六角极坐标取样：中心 + 6k 个点的第 k 环 */
function pupil(rings) {
  const P = [[0, 0]];
  for (let k = 1; k <= rings; k++) for (let j = 0, m = 6 * k; j < m; j++) { const a = (2 * Math.PI * j) / m; P.push([(k / rings) * Math.cos(a), (k / rings) * Math.sin(a)]); }
  return P;
}
/** 1、2、5 序列上不小于 v 的“整”数 */
function nice(v) {
  if (!(v > 0)) return 1;
  const e = 10 ** Math.floor(Math.log10(v)), m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
}

/** 追迹全部光线（与像面无关），返回可在任意像面上取点的数据 */
export function analyse(L) {
  const pars = WL.map((w) => paraxial(L, w.nm)), pd = pars[1];
  const P = pupil(6);
  const fields = FIELDS.map((f) => f * L.field);
  const chief = fields.map((th) => ray(L, 587.56, th, 0, 0, pd));
  const bundles = fields.map((th) => WL.map((w, i) => P.map(([px, py]) => ray(L, w.nm, th, px, py, pars[i])).filter(Boolean)));
  // 近轴像面与最佳焦面（轴上三色合成弥散的均方根最小）
  const zp = pd.zImage;
  const rmsAt = (fi, z) => {
    const c = chief[fi]; if (!c) return NaN;
    const c0 = toPlane(c, z); let n = 0, sx = 0, sy = 0, s2 = 0;
    for (const b of bundles[fi]) for (const r of b) { const q = toPlane(r, z), x = q[0] - c0[0], y = q[1] - c0[1]; n++; sx += x; sy += y; s2 += x * x + y * y; }
    return n ? Math.sqrt(Math.max(0, s2 / n - (sx / n) ** 2 - (sy / n) ** 2)) : NaN;
  };
  let span = 0.01;
  for (const b of bundles[0]) for (const r of b) if (Math.abs(r.d[1]) > 1e-9) span = Math.max(span, Math.abs(r.p[2] - (r.p[1] * r.d[2]) / r.d[1] - zp));
  let a = zp - 1.3 * span, bnd = zp + 1.3 * span;
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = bnd - g * (bnd - a), x2 = a + g * (bnd - a), f1 = rmsAt(0, x1), f2 = rmsAt(0, x2);
  for (let k = 0; k < 50; k++) {
    if (f1 < f2) { bnd = x2; x2 = x1; f2 = f1; x1 = bnd - g * (bnd - a); f1 = rmsAt(0, x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = a + g * (bnd - a); f2 = rmsAt(0, x2); }
  }
  const zb = (a + bnd) / 2;
  return { L, pars, pd, fields, chief, bundles, zp, zb, rmsAt, airy: 1.22 * 587.56e-6 * Math.abs(pd.efl / L.epd) };
}

/** 像面 z 上第 fi 个视场的点列（相对 d 光主光线，mm） */
function spots(A, fi, z) {
  const c = A.chief[fi]; if (!c) return null;
  const c0 = toPlane(c, z);
  return A.bundles[fi].map((b) => b.map((r) => { const q = toPlane(r, z); return [q[0] - c0[0], q[1] - c0[1]]; }));
}
/** 光线像差：子午 e_y(p_y)、弧矢 e_x(p_x)，三色，相对 d 光主光线（mm） */
function fans(A, fi, z, n = 41) {
  const th = A.fields[fi], c = A.chief[fi]; if (!c) return null;
  const c0 = toPlane(c, z);
  return WL.map((w, i) => {
    const T = [], S = [];
    for (let k = 0; k < n; k++) {
      const p = -1 + (2 * k) / (n - 1);
      const rt = ray(A.L, w.nm, th, 0, p, A.pars[i]); if (rt) T.push([p, toPlane(rt, z)[1] - c0[1]]);
      const rs = ray(A.L, w.nm, th, p, 0, A.pars[i]); if (rs) S.push([p, toPlane(rs, z)[0] - c0[0]]);
    }
    return { T, S };
  });
}

function canvas(w, hgt) {
  const cv = document.createElement('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); cv.style.width = w + 'px'; cv.style.height = hgt + 'px';
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.font = '10px "IBM Plex Mono", Consolas, monospace'; ctx.textBaseline = 'middle';
  return [cv, ctx];
}
/** 坐标纸方框：外框 + 4×4 细格 + 中心十字 */
function frame(ctx, x, y, w, hgt, cross = true) {
  ctx.fillStyle = PAPER; ctx.fillRect(x, y, w, hgt);
  ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.beginPath();
  for (let k = 1; k < 4; k++) { ctx.moveTo(x + (w * k) / 4 + 0.5, y); ctx.lineTo(x + (w * k) / 4 + 0.5, y + hgt); ctx.moveTo(x, y + (hgt * k) / 4 + 0.5); ctx.lineTo(x + w, y + (hgt * k) / 4 + 0.5); }
  ctx.stroke();
  if (cross) { ctx.strokeStyle = GRID2; ctx.beginPath(); ctx.moveTo(x + w / 2 + 0.5, y); ctx.lineTo(x + w / 2 + 0.5, y + hgt); ctx.moveTo(x, y + hgt / 2 + 0.5); ctx.lineTo(x + w, y + hgt / 2 + 0.5); ctx.stroke(); }
  ctx.strokeStyle = '#a9b3ab'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, hgt - 1);
}
const um = (mm, d = 1) => (mm * 1000).toFixed(d);

/**
 * 面板 DOM。L：lensTrace 格式的镜头（epd、field、surfaces）；st：跨次刷新保留的界面状态
 * {tab:'spot'|'fan'|'field', fi, plane:'par'|'best'}；onField(v)：改视场角（单透镜可调）时回调。
 */
export function qualityPanel(L, st, { fieldOptions = null, onField = null } = {}) {
  const root = document.createElement('div'); root.className = 'iq';
  let A;
  try { A = analyse(L); } catch { root.innerHTML = '<p class="bi-empty">光线追迹失败（曲率与口径不协调）。</p>'; return root; }
  if (!A.chief[0]) { root.innerHTML = '<p class="bi-empty">轴上光线追迹失败。</p>'; return root; }
  st.tab ||= 'spot'; st.fi ??= 2; st.plane ||= 'par';

  const head = document.createElement('div'); head.className = 'iq-head';
  const tabs = document.createElement('div'); tabs.className = 'iq-tabs';
  for (const [k, t] of [['spot', '点列图'], ['fan', '光线像差'], ['field', '场曲 · 畸变']]) {
    const b = document.createElement('button'); b.className = 'iq-tab' + (st.tab === k ? ' on' : ''); b.textContent = t; b.type = 'button';
    b.onclick = () => { st.tab = k; draw(); tabs.querySelectorAll('.iq-tab').forEach((x) => x.classList.toggle('on', x === b)); };
    tabs.append(b);
  }
  head.append(tabs);
  const ctl = document.createElement('div'); ctl.className = 'iq-ctl';
  const plane = document.createElement('select');
  plane.innerHTML = '<option value="par">近轴像面</option><option value="best">最佳焦面</option>'; plane.value = st.plane;
  plane.onchange = () => { st.plane = plane.value; draw(); };
  ctl.append(plane);
  if (fieldOptions) {
    const fs = document.createElement('select');
    fs.innerHTML = fieldOptions.map((v) => `<option value="${v}">视场 ±${v}°</option>`).join(''); fs.value = String(L.field);
    fs.onchange = () => onField && onField(+fs.value);
    ctl.append(fs);
  }
  head.append(ctl);
  const body = document.createElement('div'); body.className = 'iq-body';
  const foot = document.createElement('div'); foot.className = 'iq-foot';
  root.append(head, body, foot);
  const W = 268;

  function draw() {
    body.innerHTML = '';
    const z = st.plane === 'best' ? A.zb : A.zp;
    const dz = A.zb - A.zp;
    if (st.tab === 'spot') {
      const S = FIELDS.map((_, fi) => spots(A, fi, z));
      let ext = A.airy;
      for (const s of S) if (s) for (const b of s) for (const [x, y] of b) ext = Math.max(ext, Math.abs(x), Math.abs(y));
      const half = nice(ext * 1.08);
      const [cv, ctx] = canvas(W, 118), bw = 82, gap = (W - 3 * bw) / 2;
      FIELDS.forEach((f, fi) => {
        const x0 = fi * (bw + gap), y0 = 2, cx = x0 + bw / 2, cy = y0 + bw / 2, k = bw / 2 / half;
        frame(ctx, x0, y0, bw, bw, false);
        ctx.strokeStyle = INK3; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.6, A.airy * k), 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
        const s = S[fi];
        if (s) s.forEach((b, wi) => { ctx.fillStyle = WL[wi].c; for (const [x, y] of b) ctx.fillRect(cx + x * k - 0.9, cy - y * k - 0.9, 1.8, 1.8); });
        ctx.fillStyle = INK; ctx.textAlign = 'center';
        ctx.fillText(`${A.fields[fi].toFixed(1)}°`, cx, y0 + bw + 10);
        const r = A.rmsAt(fi, z);
        ctx.fillStyle = INK3; ctx.fillText(isFinite(r) ? `RMS ${um(r)} µm` : '—', cx, y0 + bw + 24);
      });
      body.append(cv);
      const r0 = A.rmsAt(0, z);
      foot.innerHTML = `方框边长 ${um(2 * half, half < 0.005 ? 1 : 0)} µm · 虚线圆为艾里斑 r = ${um(A.airy, 2)} µm<br>`
        + (r0 < A.airy ? '轴上几何弥散小于艾里斑：接近衍射受限' : r0 < 2 * A.airy ? `轴上几何弥散是艾里斑的 ${(r0 / A.airy).toFixed(1)} 倍：与衍射斑同量级` : `轴上几何弥散是艾里斑的 ${(r0 / A.airy).toFixed(1)} 倍：像差受限`)
        + ` · 最佳焦面在近轴像面${dz >= 0 ? '后' : '前'} ${Math.abs(dz).toFixed(3)} mm`;
    } else if (st.tab === 'fan') {
      const seg = document.createElement('div'); seg.className = 'iq-seg';
      FIELDS.forEach((f, fi) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'iq-tab' + (st.fi === fi ? ' on' : ''); b.textContent = `${A.fields[fi].toFixed(1)}°`;
        b.onclick = () => { st.fi = fi; draw(); };
        seg.append(b);
      });
      body.append(seg);
      const F = fans(A, st.fi, z);
      if (!F) { body.append('此视场光线追迹失败'); return; }
      let ext = 1e-4;
      for (const w of F) for (const [, e] of [...w.T, ...w.S]) ext = Math.max(ext, Math.abs(e));
      const half = nice(ext * 1.05);
      const [cv, ctx] = canvas(W, 132), pw = 128, ph = 112, y0 = 2;
      [['T', '子午 e_y – p_y'], ['S', '弧矢 e_x – p_x']].forEach(([key, title], j) => {
        const x0 = j * (W - pw);
        frame(ctx, x0, y0, pw, ph);
        F.forEach((w, wi) => {
          ctx.strokeStyle = WL[wi].c; ctx.lineWidth = 1.4; ctx.beginPath();
          w[key].forEach(([p, e], k) => { const X = x0 + pw / 2 + (p * pw) / 2 * 0.94, Y = y0 + ph / 2 - (e / half) * (ph / 2); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
          ctx.stroke();
        });
        ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText(title, x0 + pw / 2, y0 + ph + 10);
      });
      body.append(cv);
      foot.innerHTML = `纵轴满量程 ±${um(half, half < 0.005 ? 1 : 0)} µm，横轴为归一化光瞳坐标。曲线的斜率 = 离焦，三次方 = 球差，子午曲线的 U 形 = 彗差，三色曲线分开 = 色差。`;
    } else {
      const C = fieldCurves(L, 587.56, 13);
      if (C.length < 2) { body.append('视场为 0 或追迹失败'); return; }
      let ez = 1e-3, ed = 1e-3;
      for (const r of C) { ez = Math.max(ez, Math.abs(r.zt), Math.abs(r.zs), st.plane === 'best' ? Math.abs(dz) : 0); ed = Math.max(ed, Math.abs(r.dist)); }
      const hz = nice(ez * 1.05), hd = nice(ed * 1.05), thm = L.field;
      const [cv, ctx] = canvas(W, 132), pw = 128, ph = 112, y0 = 2;
      // 左：像散场曲（横轴：焦点相对近轴像面 mm；纵轴：视场角）
      frame(ctx, 0, y0, pw, ph);
      const PX = (v, half, x0) => x0 + pw / 2 + (v / half) * (pw / 2), PY = (th) => y0 + ph - (th / thm) * ph;
      for (const [key, dash] of [['zt', []], ['zs', [4, 3]]]) {
        ctx.strokeStyle = WL[1].c; ctx.lineWidth = 1.4; ctx.setLineDash(dash); ctx.beginPath();
        C.forEach((r, k) => { const X = PX(r[key], hz, 0), Y = PY(r.theta); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (st.plane === 'best') { ctx.strokeStyle = INK3; ctx.setLineDash([1, 2]); ctx.beginPath(); ctx.moveTo(PX(dz, hz, 0), y0); ctx.lineTo(PX(dz, hz, 0), y0 + ph); ctx.stroke(); ctx.setLineDash([]); }
      // 右：畸变 %
      frame(ctx, W - pw, y0, pw, ph);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.beginPath();
      C.forEach((r, k) => { const X = PX(r.dist, hd, W - pw), Y = PY(r.theta); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke();
      ctx.fillStyle = INK; ctx.textAlign = 'center';
      ctx.fillText('场曲（实线 T，虚线 S）', pw / 2, y0 + ph + 10);
      ctx.fillText('畸变', W - pw / 2, y0 + ph + 10);
      body.append(cv);
      const last = C[C.length - 1];
      foot.innerHTML = `横轴满量程：场曲 ±${hz < 0.01 ? hz.toFixed(3) : hz.toPrecision(2)} mm，畸变 ±${hd < 0.01 ? hd.toFixed(3) : hd.toPrecision(2)} %；纵轴 0 → ${thm}°。<br>`
        + `全视场：子午 ${last.zt.toFixed(3)} mm，弧矢 ${last.zs.toFixed(3)} mm，像散 ${(last.zt - last.zs).toFixed(3)} mm，畸变 ${last.dist.toFixed(3)} %`;
    }
  }
  draw();
  const legend = document.createElement('div'); legend.className = 'iq-legend';
  legend.innerHTML = WL.map((w) => `<span><i style="background:${w.c}"></i>${w.n} ${w.nm}</span>`).join('');
  root.append(legend);
  return root;
}
