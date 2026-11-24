# 致谢与来源

本项目的仪器模型、物理计算和界面代码大部分为自行编写，少数文件直接收录自宽松许可的开源项目（见“直接收录的源代码”）。下面列出打包进程序的开源组件、收录的源代码、引用的数据与公式，以及参考过思路的开源项目。

## 打包进程序的开源组件

| 组件 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | 0.187 | MIT | 三维渲染 |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.19 | MIT | 公式排版（含字体） |
| [IBM Plex Mono](https://github.com/IBM/plex)（经 @fontsource 打包） | 5.3 | SIL OFL 1.1 | 读数、数据表等宽字体 |

构建时，这些组件的版权与许可全文会自动写入 `index.html` 开头的注释。多文件版还会另外生成 `THIRD-PARTY-LICENSES.txt`（见 `vite.config.js` 里的 `licenseNotice`）。

只在开发和测试时使用、不进入发布文件的工具：Vite（MIT）、vite-plugin-singlefile（MIT）、playwright-core（Apache-2.0）。

## 直接收录的源代码

| 项目 | 许可证 | 收录的文件 | 本项目的修改 |
|---|---|---|---|
| [Optica Viva](https://github.com/iiogurt/Optica_Viva)（Copyright (c) 2026 iiogurt） | MIT | `js/lib/glasscat.js` → `src/physics/glasscat.js`（431 种 SCHOTT / OHARA / CDGM 玻璃）；`js/lib/raytrace.js` → `src/physics/lensTrace.js`（精确三维序列追迹、傍轴分析、赛德尔和数）；`js/lib/glass.js` → `src/physics/glassdb.js` | 玻璃库加入国产旧牌号别名（K9 → H-K9L 等）、水、PMMA、金刚石与中文类别名；追迹器改由 `glassdb.js` 取折射率 |

MIT 许可全文保存在 `licenses/Optica_Viva-LICENSE.txt`，构建时与上表组件一起写入 `index.html` 开头的注释。

## 数据与公式

- **CIE 1931 色匹配函数**：采用 C. Wyman、P.-P. Sloan、P. Shirley 的解析拟合，见 *Simple Analytic Approximations to the CIE XYZ Color Matching Functions*，JCGT 2(2), 2013（`src/physics/color.js`）。
- **XYZ 到 sRGB 的转换矩阵与 sRGB 编码曲线**：IEC 61966-2-1。
- **光学玻璃 Sellmeier 系数**：N-BK7、F2、SF2、SF5、N-SF11，取自 SCHOTT 光学玻璃数据表（refractiveindex.info 收录同一组数据）。每组系数都用目录给出的 n_d 和 ν_d 校验过，见 `tests/physics.mjs`（`src/physics/glass.js`）。
- **普朗克黑体辐射公式**：白光光源按 2850 K 钨丝灯计算。
- **玻璃目录数据**：[refractiveindex.info](https://refractiveindex.info) 数据库（CC0），即 SCHOTT、OHARA、CDGM 厂商的 Zemax 目录（经 Optica Viva 整理）。
- **带限角谱法**：K. Matsushima, T. Shimobaba, *Band-Limited Angular Spectrum Method for Numerical Simulation of Free-Space Propagation in Far and Near Fields*, Opt. Express 17, 19662 (2009)（`src/physics/wavefield.js`）。
- **虹的笛卡儿理论**、光栅方程、单次 FFT 菲涅耳变换：标准公式，由 `tests/physics-tools.mjs` 做数值验证。
- 菲涅耳公式、马吕斯定律、贝塞尔函数、斯托克斯–穆勒矩阵等都是标准物理公式，由 `tests/physics.mjs` 做数值验证。

## 参考过思路的开源项目（未复制代码）

| 项目 | 许可证 | 参考内容 |
|---|---|---|
| [diffractsim](https://github.com/rafael-fuente/diffractsim) | MPL-2.0 | 用色匹配函数把光谱换算成显示颜色，以及白光衍射、干涉的颜色计算思路。本项目的实现另行编写。 |
| [ray-optics](https://github.com/ricktu288/ray-optics) | Apache-2.0 | 二维非序列光线追迹的场景组织：光源、镜面、玻璃、光栅、探测器等元件模型，以及部分反射、全反射、虚像检测的思路。`src/physics/rays2d.js` 与 `src/bench/` 为重新实现。 |
| [LightPipes](https://github.com/opticspy/lightpipes)（© LightPipes Developers） | BSD-3-Clause | 光场接口设计（begin → 光阑 → 透镜 → 传播）。`src/physics/wavefield.js` 为 JavaScript 重新实现。 |
| [Incoherent-Light-Simulation](https://github.com/rafael-fuente/Incoherent-Light-Simulation) | BSD-3-Clause | 用“逐点非相干叠加”的数值模型检验部分相干光条纹可见度的做法。本项目据此写了双缝、双棱镜相干度的数值验证测试。 |

以后再借鉴其他项目时，只吸收 MIT、BSD、Apache 等宽松许可下的代码（并在此登记来源）。GPL 项目或没有声明许可证的项目，只参考思路。
