// 剪辑：每段帧序列 + 字幕图层 → 分段 mp4；转场中心对齐小节线；最后混入配乐
// node edit.mjs 输出.mp4
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HERE } from './lib.mjs';

const OUT = process.argv[2];
const V = process.argv.includes('--v');
const FR = V ? 'frames_v' : 'frames', CP = V ? 'caps_v' : 'caps', SC = V ? '1080:1920' : '1920:1080', CL = V ? 'clips_v' : 'clips';
const F = (...a) => path.join(HERE, ...a);
const B = 2.6, TAIL = 2.4; // 一小节；片尾在最后一小节后再留的余音
fs.mkdirSync(F(CL), { recursive: true });

// [片段, 字幕, 小节数, 进入本段的转场时长]
const SEQ = [
  ['card_title', null, 2, 0],
  ['home', 'home', 2, 0.5],
  ['michelson', 'c01', 2, 0.4],
  ['snake', 'c02', 1, 0.4],
  ['mwhite', 'mwhite', 1, 0.1],
  ['zeeman', 'zeeman', 1, 0.1],
  ['emratio', 'emratio', 1, 0.1],
  ['chladni', 'chladni', 1, 0.1],
  ['oscilloscope', 'oscilloscope', 1, 0.1],
  ['newton', 'newton', 1, 0.1],
  ['stringwave', 'stringwave', 1, 0.1],
  ['spectro', 'spectro', 1, 0.1],
  ['bohr', 'bohr', 1, 0.1],
  ['bench', 'c03', 1, 0.4],
  ['wave', null, 2, 0.3],
  ['analysis', 'c04', 2, 0.4],
  ['card_end', null, 2, 0.6],
];
const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

const lens = [];
let bar = 0;
SEQ.forEach(([name, cap, nb, xin], i) => {
  const xout = i < SEQ.length - 1 ? SEQ[i + 1][3] : 0;
  const len = nb * B + xin / 2 + xout / 2 + (i === SEQ.length - 1 ? TAIL : 0);
  lens.push(len);
  const nFrames = fs.readdirSync(F(FR, name)).filter((f) => f.endsWith('.jpg')).length;
  if (nFrames / 30 < len - 0.01) throw new Error(`${name} 帧不够：${(nFrames / 30).toFixed(2)} < ${len.toFixed(2)}`);
  const out = F(CL, name + '.mp4');
  const inp = ['-framerate', '30', '-i', F(FR, name, '%05d.jpg')];
  let fc = `[0]scale=${SC}:flags=lanczos,setsar=1[v]`;
  if (cap) {
    const isCard = cap.startsWith('c');
    const fin = xin / 2 + (isCard ? 0.3 : 0.12), fout = len - xout / 2 - (isCard ? 0.55 : 0.3);
    inp.push('-loop', '1', '-t', len.toFixed(3), '-i', F(CP, cap + '.png'));
    fc += `;[1]format=rgba,fade=in:st=${fin.toFixed(2)}:d=0.3:alpha=1,fade=out:st=${fout.toFixed(2)}:d=0.25:alpha=1[c];[v][c]overlay=0:0:shortest=1[v2]`;
  } else fc += ';[v]null[v2]';
  ff([...inp, '-filter_complex', fc, '-map', '[v2]', '-t', len.toFixed(3), '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', out]);
  bar += nb;
});

// 转场 k 的中心落在第 k 段开始的小节线上
const inputs = SEQ.flatMap(([name]) => ['-i', F(CL, name + '.mp4')]);
let fc = '', prev = '[0:v]', T = 0;
for (let i = 1; i < SEQ.length; i++) {
  T += SEQ[i - 1][2] * B;
  const x = SEQ[i][3];
  const lbl = i === SEQ.length - 1 ? '[vx]' : `[x${i}]`;
  fc += `${prev}[${i}:v]xfade=transition=fade:duration=${x}:offset=${(T - x / 2).toFixed(3)}${lbl};`;
  prev = lbl;
}
const total = T + SEQ.at(-1)[2] * B + TAIL;
const bars = SEQ.map((s) => s[2]);
// 配乐分段：片头 / 目录 / 迈氏 / 群剪 / 工作台 / 数据处理 / 片尾
const sec = [bars[0], bars[1], bars[2], bars.slice(3, 13).reduce((a, b) => a + b), bars[13] + bars[14], bars[15], bars[16]];
execFileSync('node', [F('music.mjs'), F('music.wav'), ...sec.map(String)], { stdio: 'inherit' });
fc += `[vx]fade=in:st=0:d=0.5,fade=out:st=${(total - 1.2).toFixed(2)}:d=1.2,format=yuv420p[out];`;
fc += `[${SEQ.length}:a]atrim=0:${total.toFixed(3)},afade=out:st=${(total - 1.6).toFixed(2)}:d=1.6,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
ff([...inputs, '-i', F('music.wav'), '-filter_complex', fc, '-map', '[out]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-r', '30',
  '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', OUT]);
console.log('total', total.toFixed(2), 's, bars', bar, '→', OUT);
