# 致谢与来源

本项目的仪器模型、物理计算和界面代码大部分为自行编写，少数文件直接收录自宽松许可的开源项目（见“直接收录的源代码”）。下面列出打包进程序的开源组件、收录的源代码、引用的数据与公式，以及参考过思路的开源项目。

## 打包进程序的开源组件

| 组件 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | 0.187 | MIT | 三维渲染 |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.19 | MIT | 公式排版（含字体） |
| [IBM Plex Mono](https://github.com/IBM/plex)（经 @fontsource 打包） | 5.3 | SIL OFL 1.1 | 读数、数据表等宽字体 |
| [spice-ts](https://github.com/mfiumara/spice-ts)（`@spice-ts/core`，Copyright (c) 2025-present Mattia Fiumara） | 0.4.0 | MIT | 电路仿真引擎（SPICE 网表、梯形积分瞬态分析、直流工作点）。示波器、RC/RLC 暂态等交流实验用它计算电路；只在进入这些实验时才加载。`src/core/spice.js` 负责把接线转成网表并用打靶法求周期稳态 |
| [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)（`@anthropic-ai/sdk`） | 1.14.0 | Apache-2.0（1.0 之前的部分为 MIT，两份许可全文都随程序附上） | AI 助教接入 Claude 时使用（流式输出、工具调用）。只有学生在助教设置里选了 Claude 并发起提问时才加载；OpenAI 兼容格式与 Gemini 格式由 `src/core/ai/providers.js` 直接用 fetch 实现，不依赖其他 SDK |

构建时，这些组件的版权与许可全文会自动写入 `index.html` 开头的注释。多文件版还会另外生成 `THIRD-PARTY-LICENSES.txt`（见 `vite.config.js` 里的 `licenseNotice`）。

只在开发和测试时使用、不进入发布文件的工具：Vite（MIT）、vite-plugin-singlefile（MIT）、playwright-core（Apache-2.0）。

## 直接收录的源代码

| 项目 | 许可证 | 收录的文件 | 本项目的修改 |
|---|---|---|---|
| [Optica Viva](https://github.com/iiogurt/Optica_Viva)（Copyright (c) 2026 iiogurt） | MIT | `js/lib/glasscat.js` → `src/physics/glasscat.js`（431 种 SCHOTT / OHARA / CDGM 玻璃）；`js/lib/raytrace.js` → `src/physics/lensTrace.js`（精确三维序列追迹、傍轴分析、赛德尔和数）；`js/lib/glass.js` → `src/physics/glassdb.js` | 玻璃库加入国产旧牌号别名（K9 → H-K9L 等）、水、PMMA、金刚石与中文类别名；追迹器改由 `glassdb.js` 取折射率 |
| [Magpylib](https://github.com/magpylib/magpylib)（Copyright (c) 2022, Silicon Austria Labs, Magpylib Developers） | BSD-2-Clause | `magpylib/_src/fields/field_BH_circle.py` 中的 `current_circle_Hfield`、`special_cel.py` 中的 `_cel_iter` → `src/physics/loopfield.js` | 由 Python/NumPy 改写成逐点计算的 JavaScript；加上多匝线圈、线圈组叠加的封装。算法出自 F. Ortner 等，*Numerically stable and computationally efficient expression for the magnetic field of a current loop*，MDPI Magnetism 3(1), 11-31 (2023) |

许可全文保存在 `licenses/` 目录（`Optica_Viva-LICENSE.txt`、`magpylib-LICENSE.txt`），构建时与上表组件一起写入 `index.html` 开头的注释。

## 数据与公式

- **CIE 1931 色匹配函数**：采用 C. Wyman、P.-P. Sloan、P. Shirley 的解析拟合，见 *Simple Analytic Approximations to the CIE XYZ Color Matching Functions*，JCGT 2(2), 2013（`src/physics/color.js`）。
- **XYZ 到 sRGB 的转换矩阵与 sRGB 编码曲线**：IEC 61966-2-1。
- **光学玻璃 Sellmeier 系数**：N-BK7、F2、SF2、SF5、N-SF11，取自 SCHOTT 光学玻璃数据表（refractiveindex.info 收录同一组数据）。每组系数都用目录给出的 n_d 和 ν_d 校验过，见 `tests/physics.mjs`（`src/physics/glass.js`）。
- **普朗克黑体辐射公式**：白光光源按 2850 K 钨丝灯计算。
- **玻璃目录数据**：[refractiveindex.info](https://refractiveindex.info) 数据库（CC0），即 SCHOTT、OHARA、CDGM 厂商的 Zemax 目录（经 Optica Viva 整理）。
- **带限角谱法**：K. Matsushima, T. Shimobaba, *Band-Limited Angular Spectrum Method for Numerical Simulation of Free-Space Propagation in Far and Near Fields*, Opt. Express 17, 19662 (2009)（`src/physics/wavefield.js`）。
- **虹的笛卡儿理论**、光栅方程、单次 FFT 菲涅耳变换：标准公式，由 `tests/physics-tools.mjs` 做数值验证。
- **空气黏度**：Sutherland 公式（η₀ = 1.716×10⁻⁵ Pa·s，T₀ = 273.15 K，S = 110.4 K）；**坎宁汉滑移修正**常数 b = 8.23×10⁻³ Pa·m，即教材常用的 6.17×10⁻⁶ m·cmHg（`src/physics/millikan.js`）。
- **单摆大角度周期**：用算术–几何平均（AGM）计算第一类完全椭圆积分，T = 2π√(L/g) / AGM(1, cos(θ₀/2))（`src/physics/pendulum.js`）。
- **导电纸电场**：∇·(σ∇V)=0 的 SOR 迭代解，电极边界用 Shortley–Weller 非等距差分（`src/physics/laplace.js`），与同轴电极的 ln r 解析解对照验证。
- **钢丝弦的驻波**：受迫振动的模式叠加，抗弯刚度按 Euler–Bernoulli 梁的色散关系 ω² = (T/μ)k² + (EI/μ)k⁴（`src/physics/string.js`）。
- **储气瓶放气**：开口系统能量方程（流出气体带走焓）+ 孔口流量公式 + 牛顿冷却（`src/physics/gasvessel.js`），在不传热的极限下精确给出 γ。
- **电子在磁场中的轨道**：Boris 推进算法（J. P. Boris, *Relativistic plasma simulation — optimization of a hybrid code*, Proc. 4th Conf. Num. Sim. Plasmas, 1970），相对论形式，磁场用上面的电流环精确解（`src/physics/electronorbit.js`）。
- **水的表面张力**：IAPWS《Revised Release on Surface Tension of Ordinary Water Substance》（2014）推荐式 σ = 235.8 mN/m·τ^1.256·(1 − 0.625τ)；吊环处的弯月面按二维拉普拉斯—杨方程的解析解 h = 2ℓc·sin(ψ/2)（`src/physics/surface.js`）。
- **气垫导轨**：气膜黏性阻力按 F = −bv（b ≈ ηA/δ）取解析解推进；一维碰撞按恢复系数公式（动量严格守恒）；光电门挡光时刻在子步内线性插值（`src/physics/airtrack.js`）。
- **PN 结与热敏电阻**：硅禁带宽度的温度关系用 Varshni 式（Y. P. Varshni, Physica 34, 149, 1967；硅的参数 1.170 eV、4.73×10⁻⁴ eV/K、636 K）；正向电流含扩散与势垒区复合两部分；NTC 热敏电阻用 B 值公式加小二次项（`src/physics/semi.js`）。
- **塞曼效应**：汞 546.1 nm（7³S₁ → 6³P₂）9 条分量的位置由朗德因子计算，相对强度用 Condon–Shortley 的 J → J+1 跃迁强度公式；e/m、c 取 CODATA 2018 推荐值（`src/physics/zeeman.js`）。
- **T 型（铜–康铜）热电偶**：NIST ITS-90 热电偶数据库的参考函数（0–400 °C 段多项式系数，NIST Monograph 175）；样品冷却按小圆柱自然对流 h = 1.32(ΔT/D)^¼ 加表面辐射；铜、铁、铝比热容的温度关系取手册数据的线性拟合（`src/physics/coolmetal.js`）。
- **波尔共振仪**：摆轮按 θ'' + 2βθ' + ω₀²(1 + cθ²)θ = ω₀²α₀cos ωt 做四阶龙格–库塔积分，稳态振幅与相位差和线性受迫振动解析解对照验证（`src/physics/bohr.js`）。
- **克拉尼图形**：Kirchhoff 薄板的瑞利–里茨解，基函数为勒让德多项式之积，中心固定用罚函数施加，特征值用雅可比旋转法（`src/physics/chladni.js`）。自由方板的频率参数与 A. W. Leissa, *Vibration of Plates*, NASA SP-160 (1969) 的表列值对照验证。
- **乐音**：十二平均律以 A4 = 440 Hz 为标准（ISO 16）；拨弦谐波按三角形初始位移的模式展开、琴码处横向力给出；频谱为汉宁窗的解析变换（`src/physics/music.js`）。
- **太阳能电池**：单二极管等效电路模型（含串联、并联电阻），二分法求工作点（`src/physics/solarcell.js`）。
- **电路中的纯电容回路**：周期稳态打靶法要求各电容初值相互独立，回路中最小的电容串 1 Ω 引线电阻（`src/core/spice.js`），由 `tests/physics-tools.mjs` 与相量法对照。
- 菲涅耳公式、马吕斯定律、贝塞尔函数、斯托克斯–穆勒矩阵等都是标准物理公式，由 `tests/physics.mjs` 做数值验证。

## 参考过思路的开源项目（未复制代码）

| 项目 | 许可证 | 参考内容 |
|---|---|---|
| [diffractsim](https://github.com/rafael-fuente/diffractsim) | MPL-2.0 | 用色匹配函数把光谱换算成显示颜色，以及白光衍射、干涉的颜色计算思路。本项目的实现另行编写。 |
| [ray-optics](https://github.com/ricktu288/ray-optics) | Apache-2.0 | 二维非序列光线追迹的场景组织：光源、镜面、玻璃、光栅、探测器等元件模型，以及部分反射、全反射、虚像检测的思路。`src/physics/rays2d.js` 与 `src/bench/` 为重新实现。 |
| [LightPipes](https://github.com/opticspy/lightpipes)（© LightPipes Developers） | BSD-3-Clause | 光场接口设计（begin → 光阑 → 透镜 → 传播）。`src/physics/wavefield.js` 为 JavaScript 重新实现。 |
| [Incoherent-Light-Simulation](https://github.com/rafael-fuente/Incoherent-Light-Simulation) | BSD-3-Clause | 用“逐点非相干叠加”的数值模型检验部分相干光条纹可见度的做法。本项目据此写了双缝、双棱镜相干度的数值验证测试。 |
| [JAmodel](https://github.com/romanszewczyk/JAmodel)、[pyjam](https://github.com/Ryan-O-Connor/pyjam) | MIT | Jiles–Atherton 磁滞模型的写法（无磁滞曲线 Langevin 函数、不可逆分量的方向判据、可逆分量系数 c）。`src/physics/hysteresis.js` 另行编写，并与初级、次级电路联立积分。 |
| [woscope](https://github.com/m1el/woscope)（© m1el） | MIT | 示波器荧光屏的画法：轨迹亮度按电子束在每段上的停留时间计算（快速移动的陡沿较暗），叠加混合并带余辉。`src/core/oscillo.js` 用 Canvas 2D 重新实现。 |

以后再借鉴其他项目时，只吸收 MIT、BSD、Apache 等宽松许可下的代码（并在此登记来源）。GPL 项目或没有声明许可证的项目，只参考思路。
