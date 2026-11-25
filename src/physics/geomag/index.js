// 世界地磁模型 WMM2025（美国 NOAA/NCEI 与英国地质调查局发布，系数属公有领域），计算程序收录自 geomagnetism 0.2.0（Apache-2.0）。
// 本文件替代原 index.js：只带 WMM2025 一组系数，日期超出有效期时取有效期内最近的一天。
import Model from './model.js';
import WMM2025 from './wmm-2025.js';

const START = Date.UTC(2024, 10, 14), END = Date.UTC(2029, 10, 12);
let base = null;

/**
 * 给定地点的地磁场要素
 * @param {number} lat 纬度（度，北正）
 * @param {number} lon 经度（度，东正）
 * @param {number} [alt] 海拔（km）
 * @param {Date} [date]
 * @returns {{x:number,y:number,z:number,h:number,f:number,incl:number,decl:number}} 北、东、下分量与水平、总强度（nT），磁倾角、磁偏角（度）
 */
export function geomagField(lat, lon, alt = 0, date = new Date()) {
  base ||= new Model(WMM2025);
  const t = Math.min(END, Math.max(START, date.getTime()));
  const p = base.getTimedModel(new Date(t)).point([lat, lon, alt]);
  return { x: p.x, y: p.y, z: p.z, h: p.h, f: p.f, incl: p.incl, decl: p.decl };
}
