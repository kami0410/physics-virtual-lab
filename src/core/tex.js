// 公式排版（KaTeX）：目录页与实验页共用
import katex from 'katex';

export function tex(s, display = false) {
  return katex.renderToString(s, { displayMode: display, throwOnError: false, strict: false });
}
/** 将 $$..$$ 与 $..$ 渲染为公式 */
export function renderMath(html) {
  return html
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, s) => tex(s, true))
    .replace(/\$([^$\n]+?)\$/g, (_, s) => tex(s, false));
}
