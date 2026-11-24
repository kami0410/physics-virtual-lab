// 程序化三维模型库（单位：cm）。所有器材均由 Three.js 基本几何体构建，无需外部模型文件。
import * as THREE from 'three';

export const AXIS_Y = 22; // 光具座光轴高度

export const MAT = {
  metal: () => new THREE.MeshStandardMaterial({ color: 0x3a4150, metalness: 0.7, roughness: 0.38 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x1c2029, metalness: 0.5, roughness: 0.5 }),
  black: () => new THREE.MeshStandardMaterial({ color: 0x111317, metalness: 0.2, roughness: 0.6 }),
  alu: () => new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.85, roughness: 0.28 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xe5e9f0, metalness: 1, roughness: 0.12 }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: 0.9, roughness: 0.3 }),
  white: () => new THREE.MeshStandardMaterial({ color: 0xf1f3f6, metalness: 0, roughness: 0.85 }),
  paint: (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.25, roughness: 0.5 }),
  glass: (c = 0xbfe6ff, o = 0.28) => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.05, transparent: true, opacity: o, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
  emissive: (c, i = 2) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i }),
};

export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** 文字/刻度贴图 */
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 实验台面：黑色阳极氧化光学面包板（25 mm 孔距 M6 螺孔阵列） */
export function labTable(w = 260, d = 120) {
  const g = new THREE.Group();
  const pxPerCm = 8;
  const tex = canvasTexture(Math.min(2048, w * pxPerCm), Math.min(2048, d * pxPerCm), (ctx, W, H) => {
    ctx.fillStyle = '#1c201f'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.018})`;
      ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    }
    const sx = W / w, sy = H / d;
    for (let x = 2.5; x < w; x += 2.5) for (let y = 2.5; y < d; y += 2.5) {
      ctx.beginPath(); ctx.arc(x * sx, y * sy, 0.32 * sx, 0, Math.PI * 2);
      ctx.fillStyle = '#060707'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; ctx.stroke();
    }
  });
  const top = mesh(new THREE.BoxGeometry(w, 4, d), [MAT.dark(), MAT.dark(), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.35 }), MAT.dark(), MAT.dark(), MAT.dark()], 0, -2, 0);
  top.castShadow = false;
  g.add(top);
  // 隔振台腿
  const legM = new THREE.MeshStandardMaterial({ color: 0x4b5a53, metalness: 0.3, roughness: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(mesh(new THREE.CylinderGeometry(4, 4.5, 76, 20), legM, sx * (w / 2 - 12), -42, sz * (d / 2 - 12)));
  }
  return g;
}

/** 光具座导轨，沿 +x，长度 L (cm)，起点 x=0。返回 group 与刻度坐标映射 */
export function opticalRail(L = 100) {
  const g = new THREE.Group();
  const base = mesh(new THREE.BoxGeometry(L + 6, 2.2, 9), MAT.metal(), L / 2, 1.1, 0);
  g.add(base);
  const top = mesh(new THREE.BoxGeometry(L + 6, 1.2, 5.2), MAT.alu(), L / 2, 2.8, 0);
  g.add(top);
  // 刻度尺贴在导轨前侧
  const pxPerCm = 40;
  const tex = canvasTexture(Math.min(8192, (L + 6) * pxPerCm), 96, (ctx, W, H) => {
    ctx.fillStyle = '#e9e4d2'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#111'; ctx.strokeStyle = '#111';
    const s = W / (L + 6);
    for (let mm = 0; mm <= L * 10; mm++) {
      const x = (3 + mm / 10) * s;
      const len = mm % 10 === 0 ? 46 : mm % 5 === 0 ? 32 : 20;
      ctx.lineWidth = mm % 10 === 0 ? 2.4 : 1.4;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, len); ctx.stroke();
      if (mm % 10 === 0) {
        ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center';
        ctx.fillText(String(mm / 10), x, 86);
      }
    }
  });
  const scale = mesh(new THREE.PlaneGeometry(L + 6, 2.6), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), L / 2, 1.3, 4.52);
  g.add(scale);
  // 端盖与脚
  for (const x of [-3.5, L + 3.5]) g.add(mesh(new THREE.BoxGeometry(1, 4, 10), MAT.dark(), x, 2, 0));
  for (const x of [5, L - 5]) g.add(mesh(new THREE.BoxGeometry(6, 0.8, 16), MAT.dark(), x, 0.4, 0));
  return g;
}

/** 滑座 + 支杆（含读数指示线），返回 {group, top} top 为光轴高度挂载点 */
export function carriage(postColor = 0x9aa3b2, height = AXIS_Y) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(5, 2.4, 8), MAT.paint(0x1f3b63), 0, 4.6, 0));
  // 读数指针（红色刻线），位于滑座中心
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.9, 0.3), MAT.emissive(0xff3030, 0.6), 0, 2.2, 4.75));
  g.add(mesh(new THREE.BoxGeometry(0.8, 2.6, 0.3), MAT.paint(0x1f3b63), 0, 3.3, 4.2));
  // 锁紧螺钉
  const knob = mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 16), MAT.black(), 0, 4.6, -4.6);
  knob.rotation.x = Math.PI / 2; g.add(knob);
  // 套管 + 支杆
  g.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 7, 20), MAT.metal(), 0, 9.3, 0));
  const post = mesh(new THREE.CylinderGeometry(0.6, 0.6, height - 12, 16), new THREE.MeshStandardMaterial({ color: postColor, metalness: 0.9, roughness: 0.25 }), 0, 12 + (height - 12) / 2 - 3, 0);
  g.add(post);
  const top = new THREE.Group(); top.position.y = height; g.add(top);
  return { group: g, top, post };
}

/** 透镜（双凸）及镜框 */
export function lensMesh(diam = 4, thick = 0.6, ringColor = 0x1c2029) {
  const g = new THREE.Group();
  const r = diam / 2;
  const pts = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const y = (r * i) / n;
    const x = (thick / 2) * (1 - (y / r) ** 2) + 0.05;
    pts.push(new THREE.Vector2(y, x));
  }
  for (let i = n; i >= 0; i--) pts.push(new THREE.Vector2((r * i) / n, -((thick / 2) * (1 - ((r * i) / n / r) ** 2) + 0.05)));
  const lg = new THREE.LatheGeometry(pts, 40);
  lg.rotateZ(Math.PI / 2);
  const glass = new THREE.Mesh(lg, MAT.glass());
  glass.renderOrder = 2;
  g.add(glass);
  const ring = mesh(new THREE.TorusGeometry(r + 0.25, 0.35, 12, 40), new THREE.MeshStandardMaterial({ color: ringColor, metalness: 0.6, roughness: 0.4 }));
  ring.rotation.y = Math.PI / 2;
  g.add(ring);
  g.add(mesh(new THREE.BoxGeometry(0.8, r + 0.6, 1.2), MAT.dark(), 0, -(r + 0.6) / 2 - r * 0.5, 0));
  return g;
}

/** 白屏 */
export function whiteScreen(w = 14, hgt = 14) {
  const g = new THREE.Group();
  const frame = mesh(new THREE.BoxGeometry(0.6, hgt + 1, w + 1), MAT.dark(), 0, 0, 0);
  g.add(frame);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.9 }));
  face.rotation.y = -Math.PI / 2; face.position.x = -0.32;
  g.add(face);
  g.add(mesh(new THREE.BoxGeometry(0.8, 3, 1.2), MAT.dark(), 0, -hgt / 2 - 1.5, 0));
  return { group: g, face };
}

/** 激光器（He-Ne 管），沿 +x 发射 */
export function laserMesh(len = 26, color = 0xb91c1c) {
  const g = new THREE.Group();
  const tube = mesh(new THREE.CylinderGeometry(2.0, 2.0, len, 32), MAT.paint(color));
  tube.rotation.z = Math.PI / 2; tube.position.x = -len / 2;
  g.add(tube);
  const cap = mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.2, 32), MAT.black(), -0.3, 0, 0);
  cap.rotation.z = Math.PI / 2; g.add(cap);
  const cap2 = mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.2, 32), MAT.black(), -len + 0.3, 0, 0);
  cap2.rotation.z = Math.PI / 2; g.add(cap2);
  const ap = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 16), MAT.emissive(0xff2222, 0.2), 0.35, 0, 0);
  ap.rotation.z = Math.PI / 2; g.add(ap);
  for (const x of [-5, -len + 5]) {
    g.add(mesh(new THREE.BoxGeometry(1.5, 2.2, 4.6), MAT.dark(), x, -2.6, 0));
  }
  // 标签贴纸
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.8), new THREE.MeshBasicMaterial({
    map: canvasTexture(512, 92, (ctx, W, H) => {
      ctx.fillStyle = '#fde047'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#111'; ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚠ LASER  632.8 nm', W / 2, H / 2 + 2);
    }),
  }));
  lab.position.set(-len / 2, 0, 2.02);
  g.add(lab);
  return { group: g, aperture: ap };
}

/** 光束：发光细圆柱，可设置端点 */
export class Beam {
  constructor(color = 0xff2020, radius = 0.09, glow = 0.35) {
    this.group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    geo.translate(0, 0.5, 0);
    this.core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.radius = radius; this.glow = glow;
    this.group.add(this.core, this.halo);
    this.group.renderOrder = 5;
  }
  set(a, b, intensity = 1) {
    const d = new THREE.Vector3().subVectors(b, a);
    const L = d.length();
    this.group.visible = L > 1e-3 && intensity > 0.002;
    if (!this.group.visible) return;
    this.group.position.copy(a);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.core.scale.set(this.radius, L, this.radius);
    this.halo.scale.set(this.glow, L, this.glow);
    const s = Math.min(1, Math.pow(intensity, 0.5));
    this.core.material.opacity = 0.95 * s;
    this.halo.material.opacity = 0.14 * s;
  }
  setColor(c) { this.core.material.color.set(c); this.halo.material.color.set(c); }
  hide() { this.group.visible = false; }
}

/** 灯箱光源（白光/钠灯/汞灯） */
export function lampHousing(glowColor = 0xfff1c1, w = 9, hgt = 11) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, hgt, 9), MAT.paint(0x2d3748), 0, 0, 0));
  // 散热栅
  for (let i = -3; i <= 3; i++) g.add(mesh(new THREE.BoxGeometry(w * 0.7, 0.3, 0.2), MAT.black(), 0, i * 1.1, 4.55));
  const tube = mesh(new THREE.CylinderGeometry(2.2, 2.2, 3, 24), MAT.dark(), w / 2 + 1.4, 0, 0);
  tube.rotation.z = Math.PI / 2; g.add(tube);
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: glowColor, emissiveIntensity: 0 });
  const win = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), glowMat);
  win.rotation.y = Math.PI / 2; win.position.x = w / 2 + 2.95;
  g.add(win);
  const sw = mesh(new THREE.BoxGeometry(1.4, 0.8, 0.4), MAT.paint(0xdc2626), -w / 4, -hgt / 2 + 1.6, 4.6);
  g.add(sw);
  return { group: g, glowMat, window: win };
}

/** 发光点光晕 Sprite */
export function glowSprite(color = 0xffffff, size = 6) {
  const tex = canvasTexture(128, 128, (ctx, W, H) => {
    const gr = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1);
  return s;
}

/** 偏振片/波片转盘（带角度刻度） */
export function rotatorMesh(tint = 0x334155, label = 'P') {
  const g = new THREE.Group();
  const dialTex = canvasTexture(512, 512, (ctx, W, H) => {
    ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); ctx.fill();
    ctx.translate(W / 2, H / 2);
    ctx.strokeStyle = '#e2e8f0'; ctx.fillStyle = '#e2e8f0';
    for (let a = 0; a < 360; a += 2) {
      const L = a % 10 === 0 ? 34 : 18;
      ctx.lineWidth = a % 10 === 0 ? 3 : 1.5;
      ctx.save(); ctx.rotate((a * Math.PI) / 180);
      ctx.beginPath(); ctx.moveTo(0, -W / 2 + 6); ctx.lineTo(0, -W / 2 + 6 + L); ctx.stroke();
      if (a % 30 === 0) { ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center'; ctx.fillText(String(a), 0, -W / 2 + 74); }
      ctx.restore();
    }
    ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.arc(0, 0, W / 2 - 92, 0, Math.PI * 2); ctx.fill();
  });
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.8, 48), [
    MAT.dark(), new THREE.MeshStandardMaterial({ map: dialTex, roughness: 0.5 }), new THREE.MeshStandardMaterial({ map: dialTex, roughness: 0.5 }),
  ]);
  dial.rotation.z = Math.PI / 2;
  dial.castShadow = true;
  const rot = new THREE.Group(); // 可转动部分
  rot.add(dial);
  const film = new THREE.Mesh(new THREE.CircleGeometry(2.3, 40), new THREE.MeshPhysicalMaterial({ color: tint, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  film.rotation.y = Math.PI / 2; film.position.x = 0.45;
  rot.add(film);
  const film2 = film.clone(); film2.position.x = -0.45; rot.add(film2);
  // 透振方向标线
  const axisLine = mesh(new THREE.BoxGeometry(0.1, 4.4, 0.12), MAT.emissive(0xfacc15, 0.8), 0.5, 0, 0);
  rot.add(axisLine);
  g.add(rot);
  // 固定指针
  g.add(mesh(new THREE.BoxGeometry(0.5, 1.2, 0.3), MAT.emissive(0xef4444, 0.7), 0.6, 4.9, 0));
  const frame = mesh(new THREE.BoxGeometry(1.2, 2.5, 2.2), MAT.dark(), 0, -5, 0);
  g.add(frame);
  return { group: g, rot };
}

/** 数显表（LCD），返回 setText */
export function meterBox(w = 14, hgt = 8, d = 10, title = '光功率计') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, hgt, d), MAT.paint(0xd6d3cb), 0, hgt / 2, 0));
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w - 1, hgt - 1), new THREE.MeshBasicMaterial({ map: tex }));
  panel.position.set(0, hgt / 2, d / 2 + 0.01);
  g.add(panel);
  const setText = (main, unit = '', sub = '') => {
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#cfcac0'; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#1f2937'; ctx.font = 'bold 26px "Microsoft YaHei"'; ctx.fillText(title, 18, 36);
    ctx.fillStyle = '#0a1f14'; ctx.fillRect(18, 56, 476, 120);
    ctx.fillStyle = '#4ade80'; ctx.font = 'bold 84px Consolas, monospace'; ctx.textAlign = 'right';
    ctx.fillText(main, 400, 150);
    ctx.font = 'bold 34px Consolas, monospace'; ctx.textAlign = 'left'; ctx.fillText(unit, 410, 150);
    ctx.fillStyle = '#334155'; ctx.font = '24px "Microsoft YaHei"'; ctx.fillText(sub, 18, 222);
    tex.needsUpdate = true;
  };
  setText('----');
  return { group: g, setText };
}

/** 小旋钮（装饰/可转动） */
export function knobMesh(r = 1.2, len = 1.4, color = 0x111317) {
  const g = new THREE.Group();
  const k = mesh(new THREE.CylinderGeometry(r, r, len, 24), new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.5 }));
  g.add(k);
  const mk = mesh(new THREE.BoxGeometry(r * 0.25, len + 0.02, r * 0.9), MAT.emissive(0xffffff, 0.2), 0, 0, r * 0.5);
  g.add(mk);
  return g;
}

/** 器材柜图标：统一的单色线描（currentColor） */
const ico = (body) => `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const post = '<path d="M32 30v8M24 38h16"/>';
export const ICONS = {
  laser: ico('<rect x="4" y="13" width="40" height="13" rx="2"/><path d="M44 16h5v7h-5"/><path d="M50 19.5h11" stroke="#c41e3a" stroke-width="2"/><path d="M12 26v6M36 26v6M8 32h32"/>'),
  lamp: ico('<rect x="8" y="8" width="24" height="22" rx="1.5"/><path d="M12 13h16M12 17h16M12 21h16"/><path d="M32 15h6v8h-6"/><path d="M42 13l9-4M42 19h11M42 25l9 4"/><path d="M14 30v4M26 30v4M10 34h20"/>'),
  sodium: ico('<rect x="8" y="8" width="24" height="22" rx="1.5"/><circle cx="20" cy="19" r="5"/><path d="M32 15h6v8h-6"/><path d="M42 13l9-4M42 19h11M42 25l9 4" stroke="#a86a12"/><path d="M14 30v4M26 30v4M10 34h20"/>'),
  mercury: ico('<rect x="8" y="8" width="24" height="22" rx="1.5"/><path d="M20 12v14"/><path d="M32 15h6v8h-6"/><path d="M42 13l9-4M42 19h11M42 25l9 4"/><path d="M14 30v4M26 30v4M10 34h20"/>'),
  lens: ico('<path d="M32 3c5 7 5 20 0 27c-5-7-5-20 0-27z"/>' + post),
  screen: ico('<rect x="27" y="3" width="10" height="27"/>' + post),
  object: ico('<rect x="24" y="3" width="16" height="27"/><path d="M29 9v15M29 9h7M29 15.5h5" stroke-width="2.2"/>' + post),
  mirror: ico('<rect x="29" y="3" width="5" height="27"/><path d="M34 5l3 3M34 11l3 3M34 17l3 3M34 23l3 3"/>' + post),
  slit: ico('<rect x="22" y="3" width="20" height="27"/><path d="M32 7v19" stroke-width="2.4"/><path d="M42 16h6"/>' + post),
  polarizer: ico('<circle cx="32" cy="16" r="13"/><path d="M32 5v22" stroke-width="2"/>' + post),
  waveplate: ico('<circle cx="32" cy="16" r="13"/><path d="M23 7l18 18M23 25l18-18" stroke-dasharray="2 2"/>' + post),
  detector: ico('<rect x="4" y="18" width="28" height="16" rx="1.5"/><rect x="8" y="22" width="20" height="7"/><rect x="42" y="8" width="16" height="13" rx="1.5"/><path d="M42 14.5h-4M32 26h8v-5"/>'),
  expander: ico('<path d="M20 14h14l3 3v4l-3 3H20z"/><path d="M37 19l22-11M37 19l22 11" stroke="#c41e3a"/><path d="M27 24v8M21 34h12"/>'),
  newton: ico('<circle cx="32" cy="20" r="16"/><circle cx="32" cy="20" r="11"/><circle cx="32" cy="20" r="6.5"/><circle cx="32" cy="20" r="2.5" fill="currentColor"/>'),
  grating: ico('<rect x="22" y="4" width="20" height="28"/><path d="M26 8v20M29 8v20M32 8v20M35 8v20M38 8v20" stroke-width="1"/>'),
  dmirror: ico('<rect x="22" y="4" width="20" height="28"/><path d="M22 32h20v4H22z"/><path d="M26 8l4 4M26 14l4 4"/>'),
  prism: ico('<path d="M32 4L50 34H14z"/><path d="M4 22l16-3M44 20l16 6" stroke-width="1.2"/>'),
  biprism: ico('<path d="M28 3h6l4 13.5-4 13.5h-6z"/><path d="M38 16.5H31"/>' + post),
  wedge: ico('<path d="M6 30h52M6 30L58 22"/><path d="M50 30v-7" stroke-width="2.2"/><path d="M12 6v10M20 6v10M28 6v10M36 6v10M44 6v10" stroke-width="1"/>'),
  photocell: ico('<rect x="4" y="10" width="22" height="20" rx="2"/><circle cx="15" cy="20" r="5"/><rect x="38" y="8" width="22" height="24" rx="1.5"/><path d="M42 14h14v6H42z"/><path d="M26 20h12"/>'),
  tube: ico('<rect x="8" y="14" width="48" height="12" rx="6"/><path d="M14 14v12M50 14v12"/><path d="M20 20h24" stroke-dasharray="3 2"/>'),
  dslit: ico('<rect x="22" y="3" width="20" height="27"/><path d="M29.5 7v19M34.5 7v19" stroke-width="2"/>' + post),
  scope: ico('<path d="M6 22l40-10 2 6-40 10z"/><path d="M46 12l10-2.5 1.2 4.6-10 2.5"/><path d="M24 22l-6 12M28 21l6 13"/>'),
  holo: ico('<rect x="20" y="4" width="24" height="28" rx="1"/><path d="M24 10c4 2 12 2 16 0M24 16c4 2 12 2 16 0M24 22c4 2 12 2 16 0"/>'),
  cell: ico('<rect x="14" y="8" width="36" height="24" rx="1.5"/><path d="M18 14h28M18 20h28M18 26h28" stroke-dasharray="2 2"/><rect x="26" y="2" width="12" height="6"/>'),
  splitter: ico('<rect x="24" y="8" width="16" height="16" transform="rotate(45 32 16)"/><path d="M4 16h56M32 16v18" stroke="#c41e3a" stroke-width="1.2"/>'),
  sample: ico('<path d="M12 24l40-12v6L12 30z"/><path d="M4 8l24 12 24-14" stroke="#c41e3a" stroke-width="1.2"/>'),
  filter: ico('<rect x="24" y="4" width="16" height="26" rx="1"/><circle cx="32" cy="17" r="3"/>' + post),
};
