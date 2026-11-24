// 轻量级科学作图（散点 + 拟合直线/曲线），自主实现
// spec: { title, xLabel, yLabel, series:[{type:'scatter'|'line', data:[[x,y]...], color, label, width, dash}], xRange?, yRange?, light? }

function niceStep(range, target = 6) {
  const raw = range / target;
  const e = Math.floor(Math.log10(raw));
  const f = raw / 10 ** e;
  const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  return nf * 10 ** e;
}
function fmtTick(v, step) {
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const s = v.toFixed(Math.min(dec, 8));
  return s === '-0' ? '0' : s;
}

export function drawPlot(canvas, spec) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || canvas.width || 600;
  const H = canvas.clientHeight || canvas.height || 340;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const light = true;
  const C = { bg: '#ffffff', grid: '#dbe6de', grid2: '#eef3ef', axis: '#1d2832', text: '#1d2832', sub: '#4b5963' };
  // 纸面配色：数据点用激光红/墨蓝，拟合线用墨色
  const dotC = ['#c41e3a', '#13306b', '#a86a12', '#2d7a4e'], lineC = ['#1d2832', '#4b5963', '#a86a12', '#2d7a4e'];
  let di = 0, li = 0;
  spec = { ...spec, series: spec.series.map((s) => ({ ...s, color: s.keepColor ? s.color : s.type === 'line' ? lineC[li++ % 4] : dotC[di++ % 4] })) };
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

  const pts = spec.series.flatMap((s) => s.data);
  if (!pts.length) {
    ctx.fillStyle = C.sub; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('暂无数据', W / 2, H / 2); return;
  }
  let [x0, x1] = spec.xRange || [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  let [y0, y1] = spec.yRange || [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  if (!spec.xRange) { const d = (x1 - x0) || Math.abs(x0) || 1; x0 -= d * 0.05; x1 += d * 0.05; }
  if (!spec.yRange) { const d = (y1 - y0) || Math.abs(y0) || 1; y0 -= d * 0.08; y1 += d * 0.08; }
  if (spec.yZero && y0 > 0) y0 = 0;

  const m = { l: 68, r: 18, t: spec.title ? 34 : 16, b: 46 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const X = (x) => m.l + ((x - x0) / (x1 - x0)) * pw;
  const Y = (y) => m.t + ph - ((y - y0) / (y1 - y0)) * ph;

  ctx.font = '12px "IBM Plex Mono", Consolas, monospace';
  const xs = niceStep(x1 - x0), ys = niceStep(y1 - y0);
  // 坐标纸细格
  ctx.strokeStyle = C.grid2; ctx.lineWidth = 1;
  for (let v = Math.ceil(x0 / (xs / 5)) * (xs / 5); v <= x1; v += xs / 5) { ctx.beginPath(); ctx.moveTo(X(v), m.t); ctx.lineTo(X(v), m.t + ph); ctx.stroke(); }
  for (let v = Math.ceil(y0 / (ys / 5)) * (ys / 5); v <= y1; v += ys / 5) { ctx.beginPath(); ctx.moveTo(m.l, Y(v)); ctx.lineTo(m.l + pw, Y(v)); ctx.stroke(); }
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.fillStyle = C.sub;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-12; v += xs) {
    ctx.beginPath(); ctx.moveTo(X(v), m.t); ctx.lineTo(X(v), m.t + ph); ctx.stroke();
    ctx.fillText(fmtTick(v, xs), X(v), m.t + ph + 6);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-12; v += ys) {
    ctx.beginPath(); ctx.moveTo(m.l, Y(v)); ctx.lineTo(m.l + pw, Y(v)); ctx.stroke();
    ctx.fillText(fmtTick(v, ys), m.l - 6, Y(v));
  }
  ctx.strokeStyle = C.axis; ctx.lineWidth = 1.2;
  ctx.strokeRect(m.l, m.t, pw, ph);

  ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if (spec.title) { ctx.font = 'bold 14px "Noto Serif SC", "SimSun", serif'; ctx.fillText(spec.title, W / 2, 22); }
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.fillText(spec.xLabel || '', m.l + pw / 2, H - 8);
  ctx.save(); ctx.translate(16, m.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(spec.yLabel || '', 0, 0); ctx.restore();

  ctx.save();
  ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
  for (const s of spec.series) {
    const col = s.color || '#38bdf8';
    if (s.type === 'line') {
      ctx.strokeStyle = col; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.data.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = col; ctx.strokeStyle = '#ffffff';
      const r = s.radius || 4;
      for (const [x, y] of s.data) {
        ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
  ctx.restore();

  // legend
  const named = spec.series.filter((s) => s.label);
  if (named.length) {
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    let lx = m.l + 10, ly = m.t + 10;
    const w = Math.max(...named.map((s) => ctx.measureText(s.label).width)) + 40;
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillRect(lx - 4, ly - 4, w, named.length * 18 + 6);
    named.forEach((s, i) => {
      const yy = ly + i * 18 + 7;
      ctx.strokeStyle = ctx.fillStyle = s.color || '#38bdf8';
      if (s.type === 'line') { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx, yy); ctx.lineTo(lx + 22, yy); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(lx + 11, yy, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(s.label, lx + 28, yy);
    });
  }
}

/** 生成直线数据点 */
export function lineData(k, b, xa, xb) {
  return [[xa, k * xa + b], [xb, k * xb + b]];
}
export function fnData(f, xa, xb, n = 300) {
  const out = [];
  for (let i = 0; i <= n; i++) { const x = xa + (xb - xa) * i / n; out.push([x, f(x)]); }
  return out;
}
