// 方案的网址编码：把光路设计台的元件表（#/bench?s=…）或衍射工作台的参数（#/wave?s=…）压缩进网址，不需要服务器，离线版也能互相分享。
// 只保存与默认值不同的参数，再用浏览器自带的 deflate 压缩，最后转成 base64url。
import { TYPES } from './elements.js';

const SKIP = new Set(['id', 'type']);
// 保留 9 位有效数字：去掉 0.30000000000000004 之类的尾巴，又不损失精度（近焦点成像对焦距、位置非常敏感）
const round = (v) => (typeof v === 'number' && isFinite(v) ? +v.toPrecision(9) : v);

/** 场景 → 紧凑对象：每个元件只留类型和非默认参数 */
export function packScene({ els, opts, view, note }) {
  const e = els.map((el) => {
    const T = TYPES[el.type], d = { x: 0, y: 0, rot: 0, ...(T ? T.defaults : {}) }, o = { t: el.type };
    for (const [k, v] of Object.entries(el)) {
      if (SKIP.has(k) || v === undefined || typeof v === 'function') continue;
      if (JSON.stringify(v) !== JSON.stringify(d[k])) o[k] = Array.isArray(v) ? v.map(round) : round(v);
    }
    return o;
  });
  const out = { v: 1, e };
  if (opts) out.o = opts;
  if (view) out.w = [round(view.cx), round(view.cy), round(view.s)];
  if (note) out.n = note;
  return out;
}

/** 紧凑对象 → {els(未赋 id 的元件属性), opts, view, note} */
export function unpackScene(p) {
  if (!p || !Array.isArray(p.e)) return null;
  const els = p.e.filter((o) => TYPES[o.t]).map(({ t, ...rest }) => ({ type: t, ...rest }));
  const view = Array.isArray(p.w) ? { cx: +p.w[0] || 0, cy: +p.w[1] || 0, s: +p.w[2] || 2 } : null;
  return { els, opts: p.o || null, view, note: typeof p.n === 'string' ? p.n : '' };
}

const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
async function pipe(bytes, Stream, fmt) { const r = new Blob([bytes]).stream().pipeThrough(new Stream(fmt)); return new Uint8Array(await new Response(r).arrayBuffer()); }

/** 任意 JSON 对象 → 网址参数字符串（z 开头为 deflate 压缩，j 开头为未压缩） */
export async function encodeObj(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    try { return 'z' + b64u(await pipe(raw, CompressionStream, 'deflate-raw')); } catch { /* 老浏览器：退回不压缩 */ }
  }
  return 'j' + b64u(raw);
}

export async function decodeObj(str) {
  try {
    const body = unb64u(str.slice(1));
    const raw = str[0] === 'z' ? await pipe(body, DecompressionStream, 'deflate-raw') : body;
    return JSON.parse(new TextDecoder().decode(raw));
  } catch { return null; }
}

/** 光路设计台场景 ↔ 网址参数 */
export const encodeScene = (scene) => encodeObj(packScene(scene));
export async function decodeScene(str) { return unpackScene(await decodeObj(str)); }

/** 从 location.hash 取 s= 参数 */
export function sceneParam(hash = location.hash) {
  const m = hash.match(/[?&]s=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
