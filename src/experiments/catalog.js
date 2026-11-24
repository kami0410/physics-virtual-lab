// 实验目录：目录页只需要每个实验的 meta 与缩略图；实验本体（含三维模型和物理模型）按需加载
// 新增实验：写 xxx.js（实验本体）和 xxx.meta.js（目录信息），再在下面登记一行。

import * as LensExperiment_M from './lens.meta.js';
import * as ScopeExperiment_M from './scope.meta.js';
import * as YoungExperiment_M from './young.meta.js';
import * as NewtonExperiment_M from './newton.meta.js';
import * as WedgeExperiment_M from './wedge.meta.js';
import * as BiprismExperiment_M from './biprism.meta.js';
import * as MichelsonExperiment_M from './michelson.meta.js';
import * as FabryPerotExperiment_M from './fabryperot.meta.js';
import * as SpectrometerExperiment_M from './spectrometer.meta.js';
import * as PrismExperiment_M from './prism.meta.js';
import * as SlitExperiment_M from './slit.meta.js';
import * as UltrasonicExperiment_M from './ultrasonic.meta.js';
import * as AbbeExperiment_M from './abbe.meta.js';
import * as PolarizationExperiment_M from './polarization.meta.js';
import * as BrewsterExperiment_M from './brewster.meta.js';
import * as PolarimeterExperiment_M from './polarimeter.meta.js';
import * as HoloExperiment_M from './holo.meta.js';
import * as PhotoelectricExperiment_M from './photoelectric.meta.js';
import * as VoltAmpExperiment_M from './voltamp.meta.js';
import * as BridgeExperiment_M from './bridge.meta.js';
import * as CalibExperiment_M from './calib.meta.js';

const E = (M, load) => ({ meta: M.meta, thumb: M.thumb, load });
export const CATALOG = [
  E(LensExperiment_M, () => import('./lens.js').then((m) => m.LensExperiment)),
  E(ScopeExperiment_M, () => import('./scope.js').then((m) => m.ScopeExperiment)),
  E(YoungExperiment_M, () => import('./young.js').then((m) => m.YoungExperiment)),
  E(NewtonExperiment_M, () => import('./newton.js').then((m) => m.NewtonExperiment)),
  E(WedgeExperiment_M, () => import('./wedge.js').then((m) => m.WedgeExperiment)),
  E(BiprismExperiment_M, () => import('./biprism.js').then((m) => m.BiprismExperiment)),
  E(MichelsonExperiment_M, () => import('./michelson.js').then((m) => m.MichelsonExperiment)),
  E(FabryPerotExperiment_M, () => import('./fabryperot.js').then((m) => m.FabryPerotExperiment)),
  E(SpectrometerExperiment_M, () => import('./spectrometer.js').then((m) => m.SpectrometerExperiment)),
  E(PrismExperiment_M, () => import('./prism.js').then((m) => m.PrismExperiment)),
  E(SlitExperiment_M, () => import('./slit.js').then((m) => m.SlitExperiment)),
  E(UltrasonicExperiment_M, () => import('./ultrasonic.js').then((m) => m.UltrasonicExperiment)),
  E(AbbeExperiment_M, () => import('./abbe.js').then((m) => m.AbbeExperiment)),
  E(PolarizationExperiment_M, () => import('./polarization.js').then((m) => m.PolarizationExperiment)),
  E(BrewsterExperiment_M, () => import('./brewster.js').then((m) => m.BrewsterExperiment)),
  E(PolarimeterExperiment_M, () => import('./polarimeter.js').then((m) => m.PolarimeterExperiment)),
  E(HoloExperiment_M, () => import('./holo.js').then((m) => m.HoloExperiment)),
  E(PhotoelectricExperiment_M, () => import('./photoelectric.js').then((m) => m.PhotoelectricExperiment)),
  E(VoltAmpExperiment_M, () => import('./voltamp.js').then((m) => m.VoltAmpExperiment)),
  E(BridgeExperiment_M, () => import('./bridge.js').then((m) => m.BridgeExperiment)),
  E(CalibExperiment_M, () => import('./calib.js').then((m) => m.CalibExperiment)),
];
