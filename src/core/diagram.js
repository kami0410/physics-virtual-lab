// 原理页的光路图（SVG）。
// 按教材插图的习惯画：墨线画仪器，红线画激光，琥珀色线画钠灯、汞灯这类光源的光，虚线画虚光线或辅助线。
// 光线走向尽量由几何关系算出（透镜成像公式、斯涅尔定律），而不是凭感觉摆放。
// 颜色写成属性而不是 CSS 变量：同一段 SVG 还要放进单独打开的实验报告窗口。

export const C = {
  ink: '#1d2832', ink2: '#4b5963', ink3: '#8a959c',
  glass: '#dce8ec', glassEdge: '#5d7682',
  laser: '#c41e3a', lamp: '#b8730f', white: '#55606a',
  paper: '#f2f4f0', metal: '#9aa5ab',
};
const SERIF = '"Times New Roman", "Noto Serif SC", "STZhongsong", "SimSun", serif';
const SANS = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

const f2 = (v) => (Math.round(v * 10) / 10).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const D2R = Math.PI / 180;

/** 下标：_{…} */
const sub = (s) => s.replace(/_\{([^}]*)\}/g, '<tspan baseline-shift="sub" font-size="72%">$1</tspan>');
/** 文字：用 *…* 包住的部分排成斜体（物理量），其余为正体；_{…} 为下标 */
function rich(s) {
  return String(s).split('*').map((t, i) => (i % 2 ? `<tspan font-style="italic" font-family='${SERIF}'>${sub(esc(t))}</tspan>` : sub(esc(t)))).join('');
}

export class Fig {
  constructor(w, h) { this.w = w; this.h = h; this.el = []; }
  _(s) { this.el.push(s); return this; }

  // ---------- 基本图元 ----------
  line(x1, y1, x2, y2, { c = C.ink, w = 1, dash = '', cap = 'butt' } = {}) {
    return this._(`<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="${cap}"/>`);
  }
  path(d, { c = C.ink, w = 1, fill = 'none', dash = '', op = 1 } = {}) {
    return this._(`<path d="${d}" stroke="${c}" stroke-width="${w}" fill="${fill}"${dash ? ` stroke-dasharray="${dash}"` : ''}${op < 1 ? ` opacity="${op}"` : ''} stroke-linejoin="round"/>`);
  }
  poly(pts, o = {}) { return this.path('M' + pts.map((p) => `${f2(p[0])},${f2(p[1])}`).join('L') + (o.close ? 'Z' : ''), o); }
  rect(x, y, w, h, { c = C.ink, sw = 1, fill = 'none' } = {}) {
    return this._(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" stroke="${c}" stroke-width="${sw}" fill="${fill}"/>`);
  }
  circle(x, y, r, { c = C.ink, w = 1, fill = 'none' } = {}) {
    return this._(`<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}" stroke="${c}" stroke-width="${w}" fill="${fill}"/>`);
  }
  dot(x, y, r = 2, c = C.ink) { return this._(`<circle cx="${f2(x)}" cy="${f2(y)}" r="${r}" fill="${c}"/>`); }

  /** 文字。a：start/middle/end；s：字号；i：整体斜体（物理量）；b：基线偏移 */
  text(x, y, s, { a = 'middle', size = 11, c = C.ink, i = false, w = 400, bg = false } = {}) {
    const fam = i ? SERIF : SANS;
    const body = i ? `<tspan font-style="italic">${sub(esc(s))}</tspan>` : rich(s);
    const halo = bg ? ` paint-order="stroke" stroke="${C.paper}" stroke-width="3" stroke-linejoin="round"` : '';
    return this._(`<text x="${f2(x)}" y="${f2(y)}" text-anchor="${a}" font-size="${size}" font-family='${fam}' font-weight="${w}" fill="${c}"${halo} dominant-baseline="middle">${body}</text>`);
  }

  /** 实心箭头，尖端在 (x, y)，指向角 ang（弧度，屏幕坐标） */
  head(x, y, ang, { c = C.ink, s = 6 } = {}) {
    const a1 = ang + Math.PI - 0.4, a2 = ang + Math.PI + 0.4;
    return this._(`<path d="M${f2(x)},${f2(y)}L${f2(x + s * Math.cos(a1))},${f2(y + s * Math.sin(a1))}L${f2(x + s * Math.cos(a2))},${f2(y + s * Math.sin(a2))}Z" fill="${c}"/>`);
  }
  arrow(x1, y1, x2, y2, o = {}) {
    const ang = Math.atan2(y2 - y1, x2 - x1), s = o.s || 6;
    this.line(x1, y1, x2 - Math.cos(ang) * s * 0.6, y2 - Math.sin(ang) * s * 0.6, o);
    return this.head(x2, y2, ang, { c: o.c || C.ink, s });
  }

  /** 光线：折线，每段中点画方向箭头（段太短时不画）。o.arrows = 'mid' | 'none' | 'end' */
  ray(pts, { c = C.laser, w = 1.15, dash = '', arrows = 'mid', s = 5.5, op = 1 } = {}) {
    this.poly(pts, { c, w, dash, op });
    if (arrows === 'none') return this;
    for (let k = 1; k < pts.length; k++) {
      const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
      const L = Math.hypot(x2 - x1, y2 - y1);
      if (arrows === 'end' && k !== pts.length - 1) continue;
      if (L < 22 && arrows === 'mid') continue;
      const t = arrows === 'end' ? 1 : 0.5 + s / 2 / L;
      this.head(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, Math.atan2(y2 - y1, x2 - x1), { c, s });
    }
    return this;
  }

  /** 光轴（点划线） */
  axis(x1, y, x2, o = {}) { return this.line(x1, y, x2, y, { c: C.ink3, w: 0.7, dash: '9 2.5 1.5 2.5', ...o }); }

  // ---------- 光学元件 ----------
  /** 竖直放置的薄透镜：kind = 'convex' | 'concave'；h 为口径 */
  lens(x, cy, h, { kind = 'convex', label = '', below = false } = {}) {
    const t = h * 0.13, y1 = cy - h / 2, y2 = cy + h / 2;
    if (kind === 'convex') this.path(`M${f2(x)},${f2(y1)}Q${f2(x + 2 * t)},${f2(cy)} ${f2(x)},${f2(y2)}Q${f2(x - 2 * t)},${f2(cy)} ${f2(x)},${f2(y1)}Z`, { c: C.glassEdge, w: 1, fill: C.glass });
    else this.path(`M${f2(x - t)},${f2(y1)}L${f2(x + t)},${f2(y1)}Q${f2(x)},${f2(cy)} ${f2(x + t)},${f2(y2)}L${f2(x - t)},${f2(y2)}Q${f2(x)},${f2(cy)} ${f2(x - t)},${f2(y1)}Z`, { c: C.glassEdge, w: 1, fill: C.glass });
    if (label) this.text(x, below ? y2 + 9 : y1 - 8, label);
    return this;
  }
  /** 平面镜：从 (x1,y1) 到 (x2,y2)，side = ±1 决定背面阴影画在哪一侧 */
  mirror(x1, y1, x2, y2, { side = 1, label = '', lx = 0, ly = 0, hatch = true } = {}) {
    this.line(x1, y1, x2, y2, { c: C.ink, w: 2.2 });
    if (hatch) {
      const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L;
      const nx = -uy * side, ny = ux * side; // 背面法线
      for (let s = 3; s < L; s += 5) {
        const px = x1 + ux * s, py = y1 + uy * s;
        this.line(px, py, px + (nx - ux) * 4, py + (ny - uy) * 4, { c: C.ink2, w: 0.7 });
      }
    }
    if (label) this.text((x1 + x2) / 2 + lx, (y1 + y2) / 2 + ly, label);
    return this;
  }
  /** 玻璃板：中心线从 (x1,y1) 到 (x2,y2)，厚度 t */
  plate(x1, y1, x2, y2, t, { fill = C.glass, c = C.glassEdge, label = '', lx = 0, ly = 0 } = {}) {
    const L = Math.hypot(x2 - x1, y2 - y1), nx = (-(y2 - y1) / L) * t / 2, ny = ((x2 - x1) / L) * t / 2;
    this.poly([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], { close: true, fill, c, w: 0.9 });
    if (label) this.text((x1 + x2) / 2 + lx, (y1 + y2) / 2 + ly, label);
    return this;
  }
  /** 屏：竖直粗线 */
  screen(x, y1, y2, { label = '', below = true } = {}) {
    this.line(x, y1, x, y2, { c: C.ink, w: 2.6 });
    if (label) this.text(x, below ? y2 + 9 : y1 - 8, label);
    return this;
  }
  /** 带缝的挡板（竖直）：slits 为开口 [y1, y2] 列表 */
  slitPlate(x, y1, y2, slits, { label = '', below = true } = {}) {
    let y = y1;
    for (const [a, b] of slits.slice().sort((p, q) => p[0] - q[0])) { if (a > y) this.line(x, y, x, a, { c: C.ink, w: 2.6 }); y = b; }
    if (y < y2) this.line(x, y, x, y2, { c: C.ink, w: 2.6 });
    if (label) this.text(x, below ? y2 + 9 : y1 - 8, label);
    return this;
  }

  // ---------- 标注 ----------
  /** 尺寸线：两端箭头，文字在中点偏移 off（沿法线），t 为文字 */
  dim(x1, y1, x2, y2, t, { off = -7, c = C.ink2, ext = 0, size = 11 } = {}) {
    const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux;
    if (ext) { this.line(x1 - nx * ext, y1 - ny * ext, x1 + nx * 3, y1 + ny * 3, { c, w: 0.6 }); this.line(x2 - nx * ext, y2 - ny * ext, x2 + nx * 3, y2 + ny * 3, { c, w: 0.6 }); }
    this.line(x1 + ux * 3, y1 + uy * 3, x2 - ux * 3, y2 - uy * 3, { c, w: 0.7 });
    this.head(x1, y1, Math.atan2(-uy, -ux), { c, s: 4.5 }); this.head(x2, y2, Math.atan2(uy, ux), { c, s: 4.5 });
    if (t) this.text((x1 + x2) / 2 + nx * off, (y1 + y2) / 2 + ny * off, t, { c: C.ink, size, bg: true });
    return this;
  }
  /** 角度弧：圆心 (cx,cy)，从方向角 a1 到 a2（度，屏幕坐标，顺时针为正），文字放在 r + lr 处 */
  arc(cx, cy, r, a1, a2, t = '', { c = C.ink2, lr = 9, size = 11, w = 0.8 } = {}) {
    const p = (a) => [cx + r * Math.cos(a * D2R), cy + r * Math.sin(a * D2R)];
    const [x1, y1] = p(a1), [x2, y2] = p(a2);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0, sweep = a2 > a1 ? 1 : 0;
    this.path(`M${f2(x1)},${f2(y1)}A${r},${r} 0 ${large} ${sweep} ${f2(x2)},${f2(y2)}`, { c, w });
    if (t) { const am = ((a1 + a2) / 2) * D2R; this.text(cx + (r + lr) * Math.cos(am), cy + (r + lr) * Math.sin(am), t, { size, bg: true }); }
    return this;
  }
  /** 直角记号 */
  rightAngle(x, y, a1, s = 6, c = C.ink2) {
    const u = [Math.cos(a1 * D2R), Math.sin(a1 * D2R)], v = [Math.cos((a1 + 90) * D2R), Math.sin((a1 + 90) * D2R)];
    return this.poly([[x + u[0] * s, y + u[1] * s], [x + (u[0] + v[0]) * s, y + (u[1] + v[1]) * s], [x + v[0] * s, y + v[1] * s]], { c, w: 0.7 });
  }
  /** 引线标注：从 (x1,y1) 引一条细线到文字 (x2,y2) */
  callout(x1, y1, x2, y2, t, { a = 'start', c = C.ink3 } = {}) {
    this.line(x1, y1, x2, y2, { c, w: 0.6 });
    return this.text(x2 + (a === 'start' ? 2 : a === 'end' ? -2 : 0), y2, t, { a });
  }
  /** 物/像箭头（竖直） */
  objArrow(x, y0, y1, { c = C.ink, w = 1.6, dash = '' } = {}) {
    this.line(x, y0, x, y1 + (y1 < y0 ? 4 : -4), { c, w, dash });
    return this.head(x, y1, y1 < y0 ? -Math.PI / 2 : Math.PI / 2, { c, s: 6 });
  }
  /** 偏振记号：p 光（振动在纸面内，与光线垂直的短双箭头）、s 光（点） */
  polMark(x, y, ang, kind, c = C.ink) {
    if (kind === 's') return this.dot(x, y, 1.8, c);
    const a = ang + Math.PI / 2, dx = Math.cos(a) * 5, dy = Math.sin(a) * 5;
    this.line(x - dx, y - dy, x + dx, y + dy, { c, w: 0.9 });
    this.head(x + dx, y + dy, a, { c, s: 3.2 }); return this.head(x - dx, y - dy, a + Math.PI, { c, s: 3.2 });
  }

  /** 输出 <figure>：caption 为图题，max 为最大显示宽度（px） */
  html(caption, { max = Math.round(this.w * 1.5) } = {}) {
    return `<figure class="diag" style="margin:12px auto 14px;max-width:${max}px"><svg viewBox="0 0 ${this.w} ${this.h}" width="100%" style="display:block;width:100%;height:auto;overflow:visible" role="img" aria-label="${esc(caption)}" xmlns="http://www.w3.org/2000/svg">${this.el.join('')}</svg><figcaption style="font-size:12px;color:#6b7780;text-align:center;margin-top:4px;line-height:1.5">${caption}</figcaption></figure>`;
  }
}

// ---------- 二维几何光学 ----------
export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]], sub: (a, b) => [a[0] - b[0], a[1] - b[1]], mul: (a, k) => [a[0] * k, a[1] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1], len: (a) => Math.hypot(a[0], a[1]), unit: (a) => { const l = Math.hypot(a[0], a[1]); return [a[0] / l, a[1] / l]; },
  dir: (deg) => [Math.cos(deg * D2R), Math.sin(deg * D2R)],
};

/** 斯涅尔定律（矢量形式）：入射方向 d、界面法线 n（任意朝向）、折射率 n1 → n2；全反射返回 null */
export function refract(d, n, n1, n2) {
  d = V.unit(d); n = V.unit(n);
  let c = -V.dot(n, d);
  if (c < 0) { n = V.mul(n, -1); c = -c; }
  const r = n1 / n2, k = 1 - r * r * (1 - c * c);
  if (k < 0) return null;
  return V.unit(V.add(V.mul(d, r), V.mul(n, r * c - Math.sqrt(k))));
}
/** 反射 */
export function reflect(d, n) { n = V.unit(n); return V.sub(d, V.mul(n, 2 * V.dot(d, n))); }
/** 射线 p + t·d 与线段 ab 的交点（t > 1e-9），无交点返回 null */
export function hit(p, d, a, b) {
  const e = V.sub(b, a), den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return null;
  const w = V.sub(a, p), t = (w[0] * e[1] - w[1] * e[0]) / den, s = (w[0] * d[1] - w[1] * d[0]) / den;
  return t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 ? V.add(p, V.mul(d, t)) : null;
}
