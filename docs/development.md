# 开发说明

给想修改、添加实验，或者想弄清楚程序怎么工作的人看。

## 技术栈

- 纯前端：原生 JavaScript（ES 模块），没有用 React / Vue 之类的框架；
- 三维：[three.js](https://threejs.org)；公式：[KaTeX](https://katex.org)；电路仿真：[spice-ts](https://github.com/mfiumara/spice-ts)；
- 构建：[Vite](https://vite.dev)，单文件版用 vite-plugin-singlefile；
- 测试：Node.js 直接运行的数值验证 + [Playwright](https://playwright.dev) 驱动本机 Chrome / Edge 的端到端测试。

物理模型基本都是自己写的，放在 `src/physics/`，不依赖三维和界面，可以单独在 Node.js 里调用和测试。

## 目录结构

```
├── index.html               页面入口
├── src/
│   ├── main.js              路由（首页 / 实验 / 工作台）、首页目录
│   ├── styles.css           全部样式
│   ├── core/                实验框架（与具体实验无关）
│   │   ├── App.js             实验页：步骤、器材柜、数据表、数据处理、报告、一键运行
│   │   ├── Stage.js           三维场景、相机、灯光
│   │   ├── Component.js       器材（可放置、可选中、带调节面板）
│   │   ├── Controls.js        旋钮、滑块、开关等调节控件
│   │   ├── DataTable.js       数据记录表（含“自己读数”）
│   │   ├── View.js            观察窗（可缩放、拖动的二维画布）
│   │   ├── Tutor.js           AI 助教：离线诊断、操作记录、与大模型对话的工具
│   │   ├── ai/providers.js    大模型接口适配（Anthropic / OpenAI 兼容 / Gemini）与自动中转
│   │   ├── beams.js Coax.js   高斯光束追迹、光具座共轴误差
│   │   ├── circuit.js spice.js oscillo.js   电路求解、SPICE 接口、示波器与信号源
│   │   ├── gpu.js             用 WebGL2 计算干涉衍射图样（不支持时自动用 CPU）
│   │   └── Quality.js         画质自动分档
│   ├── experiments/         每个实验两个文件：xxx.meta.js（目录信息）+ xxx.js（实验本体）
│   │   └── catalog.js         实验登记表
│   ├── physics/             物理模型（纯计算，可在 Node.js 中测试）
│   ├── bench/               光路设计台
│   └── wave/                衍射工作台
├── tests/                   测试
├── tools/                   AI 中转（ai-relay.mjs / ai-relay-core.mjs）
├── public/                  图标、PWA 清单
├── licenses/                收录的第三方代码的许可全文
├── docs/                    文档
└── 启动实验室.cmd / .command  一键启动脚本
```

## 一个实验由什么组成

以单摆为例：

**`src/experiments/pendulum.meta.js`**：首页目录需要的信息，打开首页时只加载这个小文件。

```js
export const meta = {
  id: 'pendulum',               // 网址里的名字：#/exp/pendulum
  part: '力学',                  // 首页分部：力学 / 热学 / 电磁学 / 光学 / 近代物理
  title: '单摆测重力加速度',
  subtitle: '…',
  tags: ['力学', '振动'],
  level: '基础', time: '60 min',
  formula: String.raw`T=2\pi\sqrt{L/g}`,   // 目录卡片上的公式（LaTeX）
  measure: '当地的重力加速度',
  goals: [ … ],                  // 实验目的
  questions: [ … ],              // 思考题（进入实验报告）
};
export function thumb(ctx, w, h) { … }   // 目录卡片的缩略图（画在 canvas 上）
```

**`src/experiments/pendulum.js`**：实验本体，进入实验时才加载。导出一个类，框架会按顺序调用下面这些方法（只有 `build`、`steps` 是必需的）：

| 方法 | 作用 |
|---|---|
| `constructor(app)` | 生成本次实验的随机参数（待测样品、仪器误差） |
| `cameras()` | 三维视图的预设机位（顶部“全景”“干板架”这些按钮） |
| `build()` | 搭建场景：实验台、放置位 `app.addSlot`、器材 `app.addComponent`、观察窗 `app.addView` |
| `steps()` | 实验步骤：每步有 `title`、`html` 说明、`check()` 完成条件、`auto()` 自动完成，可选 `hint`、`status()`、`diagnose()`（给助教用） |
| `tables()` | 数据记录表的列和“记录”按钮 |
| `tick(dt)` | 每帧推进物理过程（时间相关的实验用） |
| `update()` | 状态变化后重画：三维物体位置、读数、观察窗 |
| `globalControls()` | 右下“测量与读数”面板里的全局开关和读数 |
| `analyze()` | 数据处理：返回 `{ html, ok, answers, plots }`；`answers` 用于自算模式的核对 |
| `principle()` | “实验原理”页的内容（HTML + LaTeX） |
| `onPlace(c)` / `onRemove(c)` | 器材放上 / 取下时 |
| `toBench()` / `toWave()` | 可选：把当前光路导出到光路设计台 / 衍射工作台 |

写好后在 `src/experiments/catalog.js` 里登记一行（import meta，加进 `CATALOG`），首页就会出现。

几点约定：

- **物理计算放进 `src/physics/`**，写成不依赖 three.js 的纯函数，并在 `tests/physics-tools.mjs` 里和解析解或文献值对照验证；
- `auto()` 要能从任意状态出发完成本步（学生可能把前面的设置改乱了），一键运行会加速运行，依赖帧更新的状态要在 setter 里同步计算；
- 学生的误操作造成的损坏用 `app.toast(msg, 'warn')` 提示，`'bad'` 留给程序错误（测试会把它当作失败）；
- 文件、注释里不要出现个人或学校信息。

## 测试

```bash
npm test                 # 全部：物理验证 → 构建单文件版 → AI 助教接口测试 → 全部实验端到端测试
npm run test:physics     # 只跑物理模型的数值验证（几秒钟）
npm run test:quick       # 端到端测试，随机操作次数减少
node tests/e2e.mjs --only holo,michelson   # 只测指定实验
```

| 文件 | 内容 |
|---|---|
| `tests/physics.mjs` | 光学基础公式、玻璃色散、干涉衍射的数值验证 |
| `tests/physics-tools.mjs` | 各物理模型与解析解、文献值对照（一百多项检查） |
| `tests/tutor-ai.mjs` | 用本地模拟服务器检查三种大模型接口格式和工具调用 |
| `tests/e2e.mjs` | 用本机 Chrome / Edge 无头打开离线单文件版：每个实验一键运行到底，检查结果误差；再做几百次随机操作，检查有没有报错 |

端到端测试读的是 `dist-single/index.html`，改了代码后要先 `npm run build:single`（`npm test` 会自动构建）。

`e2e.mjs` 的其他选项：`--seed N`（换随机种子）、`--monkey N`（随机操作次数）、`--rescue N`（先自动做几步，再乱调，再续跑，检查自动完成会不会卡住）、`--gpu`（强制走显卡计算路径）、`--headed`（显示浏览器窗口）。

## 第三方代码

引入开源代码前先看许可证：优先 MIT、BSD、Apache-2.0，不要打包 GPL 代码。直接收录的文件要在 `CREDITS.md` 里登记，并把许可全文放进 `licenses/`，再加到 `vite.config.js` 的 `VENDORED` 列表里（构建时会写进产物开头的注释）。
