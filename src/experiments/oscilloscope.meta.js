// OscilloscopeExperiment 的目录信息与缩略图
export const meta = {
  id: 'oscilloscope',
  title: '示波器的使用',
  subtitle: '扫描与触发 · 测电压和频率 · 李萨如图形测频率',
  tags: ['电学', '示波器', '交流'],
  level: '基础',
  time: '60 min',
  color: '#0f766e',
  formula: String.raw`U_{pp}=H\cdot D_y,\quad f=\dfrac{n}{x\cdot D_x},\quad \dfrac{f_y}{f_x}=\dfrac{N_x}{N_y}`,
  measure: '正弦信号的峰峰值与频率、待测信号的频率',
  goals: ['了解示波器的结构，理解扫描和触发同步的作用', '学会调出稳定的波形，用示波器测量电压和频率', '观察李萨如图形，用它测量未知信号的频率'],
  questions: ['波形不稳定（左右移动）时应调节哪些旋钮？为什么调节触发电平能使波形稳定？', '“微调”旋钮不在校准位置时，读数会怎样？', '李萨如图形为什么总在缓慢转动？怎样判断频率比已调得很准？', '交流耦合和直流耦合测同一个带直流偏置的信号，图形有什么不同？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#c7c9c4'; ctx.fillRect(0, 0, w, h);
  const x = w * 0.08, y = h * 0.1, sw = w * 0.84, sh = h * 0.8;
  ctx.fillStyle = '#050c08'; ctx.fillRect(x, y, sw, sh);
  ctx.strokeStyle = 'rgba(170,210,190,.3)'; ctx.lineWidth = 0.6; ctx.beginPath();
  for (let i = 0; i <= 10; i++) { ctx.moveTo(x + (i * sw) / 10, y); ctx.lineTo(x + (i * sw) / 10, y + sh); }
  for (let j = 0; j <= 8; j++) { ctx.moveTo(x, y + (j * sh) / 8); ctx.lineTo(x + sw, y + (j * sh) / 8); }
  ctx.stroke();
  const glow = (f) => { ctx.strokeStyle = 'rgba(60,255,120,.25)'; ctx.lineWidth = 4; ctx.beginPath(); f(); ctx.stroke(); ctx.strokeStyle = '#a6ffbf'; ctx.lineWidth = 1.3; ctx.beginPath(); f(); ctx.stroke(); };
  glow(() => { for (let i = 0; i <= 200; i++) { const t = i / 200, px = x + t * sw, py = y + sh * 0.5 - Math.sin(t * Math.PI * 5) * sh * 0.3; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } });
  glow(() => { for (let i = 0; i <= 300; i++) { const t = (i / 300) * Math.PI * 2, px = x + sw * 0.5 + Math.sin(t + 0.6) * sw * 0.2, py = y + sh * 0.5 - Math.sin(2 * t) * sh * 0.3; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } });
}
