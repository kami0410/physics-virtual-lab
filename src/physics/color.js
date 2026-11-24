// 波长 -> 显示颜色（sRGB, 0..1），基于 CIE 视见函数的分段近似
export function wavelengthToRGB(nm) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780) { r = 1; }
  let f = 1;
  if (nm < 420) f = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700) f = 0.3 + (0.7 * (780 - nm)) / 80;
  const gam = 0.8;
  return [Math.pow(r * f, gam), Math.pow(g * f, gam), Math.pow(b * f, gam)];
}
export function rgbCss(nm, a = 1) {
  const [r, g, b] = wavelengthToRGB(nm);
  return `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a})`;
}
export function rgbHex(nm) {
  const [r, g, b] = wavelengthToRGB(nm);
  return ((r * 255) << 16) | ((g * 255) << 8) | (b * 255);
}
