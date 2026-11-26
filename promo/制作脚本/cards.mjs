import { launch, newPage, adv, Rec, HERE } from './lib.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const V = process.argv.includes('--v');
const SZ = V ? { w: 1080, h: 1920, dsf: 1 } : { w: 1920, h: 1080, dsf: 1 };
const SUF = V ? '_v' : '';
const b = await launch();
const C = pathToFileURL(path.join(HERE, 'cards.html')).href;
for (const [card, dur] of [['title', 6.0], ['end', 8.0]]) {
  const p = await newPage(b, SZ);
  await p.goto(C + '?card=' + card + (V ? '&v=1' : ''));
  const dir = path.join(HERE, 'frames' + SUF, 'card_' + card);
  fs.rmSync(dir, { recursive: true, force: true });
  await new Rec(dir, 30).shoot(p, Math.round(dur * 30));
  await p.close();
}
const caps = {
  c01: { no: '01', t: '自己动手，而不是看动画', d: '摆放器材 · 调节仪器 · 看着刻度自己读数' },
  c02: { no: '02', t: '现象由物理模型实时算出', d: '条纹、轨迹、波形，每次实验参数都不同' },
  c03: { no: '03', t: '开放工作台', d: '光路设计台 · 衍射工作台，自由搭建' },
  c04: { no: '04', t: '完整的数据处理', d: '拟合 · 作图 · 不确定度 · 实验报告', pos: 'r' },
  home: { kind: 'tag', k: '64 个实验', t: '力学 · 热学 · 电磁学 · 光学 · 近代物理' },
  newton: { kind: 'tag', k: '光学', t: '牛顿环', d: '等厚干涉测曲率半径' },
  mwhite: { kind: 'tag', k: '光学', t: '白光干涉', d: '迈克尔逊干涉仪找零光程' },
  zeeman: { kind: 'tag', k: '近代物理', t: '塞曼效应', d: '法布里–珀罗标准具看谱线分裂' },
  oscilloscope: { kind: 'tag', k: '电磁学', t: '示波器', d: '李萨如图形测频率' },
  emratio: { kind: 'tag', k: '电磁学', t: '电子荷质比', d: '亥姆霍兹线圈让电子束弯成圆' },
  chladni: { kind: 'tag', k: '力学', t: '克拉尼图形', d: '方板的振动模式' },
  snake: { kind: 'tag', k: '力学', t: '蛇摆', d: '摆长渐变的单摆阵列' },
  bohr: { kind: 'tag', k: '力学', t: '波尔共振', d: '受迫振动与相位差' },
  stringwave: { kind: 'tag', k: '力学', t: '弦线上的驻波' },
  abbe: { kind: 'tag', k: '光学', t: '阿贝成像', d: '空间滤波去掉网格' },
  franckhertz: { kind: 'tag', k: '近代物理', t: '弗兰克–赫兹实验', d: '原子能级的量子化' },
  spectro: { kind: 'tag', k: '光学', t: '分光计', d: '三棱镜色散' },
};
fs.mkdirSync(path.join(HERE, 'caps' + SUF), { recursive: true });
const p = await newPage(b, SZ);
for (const [k, v] of Object.entries(caps)) {
  await p.goto(C + '?card=cap&' + new URLSearchParams(V ? { ...v, v: 1 } : v).toString());
  await adv(p, 50);
  await p.screenshot({ path: path.join(HERE, 'caps' + SUF, k + '.png'), omitBackground: true });
}
await b.close();
console.log('ok');
