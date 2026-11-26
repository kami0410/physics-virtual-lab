// AI 助教的钩子：在对话循环的关键位置插入程序逻辑，让大模型能稳稳地把实验做完，而不是只靠提示词。
//
//   beforeAsk  ({question, mode})                     → {context}            往这次提问里追加内容
//   preTool    ({name, args, mode, round})            → {block} | {args}     拦下某次工具调用（原因回给模型），或改写参数
//   postTool   ({name, args, result, isError, mode})  → {note}               给工具结果追加说明（如实验进度的变化）
//   stepDone   ({index, title, auto})                 → —                    某一步完成（学生、助教或自动演示都算）
//   stop       ({mode, round, text, progressed})      → {continue}           模型本轮不再调用工具、准备结束时：返回一句话让它接着做
//
// 同一事件的多个钩子按注册顺序执行；preTool 遇到第一个 block 即停止，stop 取第一个 continue。
// 实验可以在类里写 tutorHooks(hooks, tutor) 注册自己的钩子（例如某一步必须先等仪器预热）。
// 调试时也可以在控制台里：__app.tutor.hooks.on('postTool', (c) => console.log(c))

export class Hooks {
  constructor() { this.m = new Map(); }
  /** 注册钩子，返回注销函数 */
  on(ev, fn) {
    if (!this.m.has(ev)) this.m.set(ev, []);
    this.m.get(ev).push(fn);
    return () => { const l = this.m.get(ev); const i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); };
  }
  /** 依次执行，收集各钩子的返回值（出错的钩子只告警，不影响对话） */
  async run(ev, ctx) {
    const out = [];
    for (const fn of [...(this.m.get(ev) || [])]) {
      try { const r = await fn(ctx); if (r) out.push(r); if (r && (r.block || r.continue)) break; } catch (err) { console.warn(`[助教钩子 ${ev}]`, err); }
    }
    return out;
  }
}

/** 默认钩子：工具权限、重复失败保护、进度回报、代做模式下的“没做完就接着做” */
export function installDefaultHooks(hooks, tutor) {
  const app = tutor.app;
  const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\$+/g, '').replace(/\s+/g, ' ').trim();

  // 1. 引导模式下不替学生做数据处理、不替学生填读数、不替学生确认观察步
  const AGENT_ONLY = new Set(['fill_readings', 'run_analysis', 'confirm_step']);
  hooks.on('preTool', ({ name, mode }) => {
    if (mode !== 'agent' && AGENT_ONLY.has(name)) return { block: `引导模式下不能用 ${name}：读数和数据处理要学生自己完成。学生要你代做整个实验时，请他在助教面板顶部切到「代做实验」。` };
  });

  // 2. 同一个调用连续失败 3 次就拦下，免得模型原地打转
  const fails = new Map();
  hooks.on('preTool', ({ name, args }) => {
    const k = name + JSON.stringify(args || {});
    if ((fails.get(k) || 0) >= 3) return { block: '这个调用已经连续失败 3 次。换一种做法：先 get_state 看清可调参数的准确名称和范围，或者用 take_over_step 让程序完成本步。' };
  });
  hooks.on('postTool', ({ name, args, isError }) => {
    const k = name + JSON.stringify(args || {});
    if (isError) fails.set(k, (fails.get(k) || 0) + 1); else fails.delete(k);
  });

  // 3. 改动类工具执行后，把实验进度的变化附在结果里：模型不必每次都再调 get_state
  const ACT = new Set(['set_control', 'press_button', 'place_component', 'apply_fix', 'take_over_step', 'wait', 'fill_readings', 'run_analysis', 'confirm_step']);
  let seen = { step: app.stepIdx, warns: 0 };
  hooks.on('beforeAsk', () => { seen = { step: app.stepIdx, warns: tutor.warns.length }; });
  hooks.on('postTool', ({ name }) => {
    if (!ACT.has(name)) return;
    const s = app.steps[app.stepIdx], note = {};
    if (app.stepIdx !== seen.step) note.completedSteps = app.steps.slice(seen.step, app.stepIdx).map((x, k) => `${seen.step + k + 1}.${strip(x.title)}`);
    note.now = s ? `第 ${app.stepIdx + 1}/${app.steps.length} 步「${strip(s.title)}」${tutor.stepPassed() ? '（完成条件已满足）' : ''}` : '全部步骤已完成';
    if (s && s.status) { try { note.status = strip(app.studentView(() => s.status())); } catch { /* 忽略 */ } }
    const nw = tutor.warns.slice(seen.warns).map((w) => w.msg);
    if (nw.length) note.newWarnings = nw;
    seen = { step: app.stepIdx, warns: tutor.warns.length };
    return { note };
  });

  // 4. 代做模式：步骤完成时在面板里报一声
  hooks.on('stepDone', ({ index, title }) => { if (tutor.mode === 'agent' && tutor.busy) tutor.say(`第 ${index + 1} 步「${strip(title)}」完成`, 'act'); });

  // 5. 代做模式：模型想停下但实验没做完，且最近还有进展 → 让它接着做；连续 3 次没有进展就停下，交给学生
  let idle = 0;
  hooks.on('beforeAsk', () => { idle = 0; });
  hooks.on('stop', ({ mode, progressed }) => {
    if (mode !== 'agent') return;
    const s = app.steps[app.stepIdx];
    if (!s && app.analysisDone !== false) return;
    idle = progressed ? 0 : idle + 1;
    if (idle >= 3) return;
    if (!s) return { continue: '全部步骤已完成。若还没做数据处理，调用 run_analysis；然后用两三句话总结测量结果和误差，结束。' };
    return { continue: `实验还没做完：现在是第 ${app.stepIdx + 1}/${app.steps.length} 步「${strip(s.title)}」${tutor.stepPassed() ? '，完成条件已满足（观察类步骤用 confirm_step 确认）' : ''}。接着做下去。确实做不下去时，说明卡在哪里、需要学生做什么，然后停下。` };
  });

  // 6. 实验自己的钩子
  if (app.exp && typeof app.exp.tutorHooks === 'function') { try { app.exp.tutorHooks(hooks, tutor); } catch (err) { console.warn(err); } }
}
