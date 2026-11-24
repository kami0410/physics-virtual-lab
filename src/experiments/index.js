import { LensExperiment } from './lens.js';
import { ScopeExperiment } from './scope.js';
import { HoloExperiment } from './holo.js';
import { VoltAmpExperiment } from './voltamp.js';
import { BridgeExperiment } from './bridge.js';
import { CalibExperiment } from './calib.js';
import { MichelsonExperiment } from './michelson.js';
import { NewtonExperiment } from './newton.js';
import { WedgeExperiment } from './wedge.js';
import { BiprismExperiment } from './biprism.js';
import { SpectrometerExperiment } from './spectrometer.js';
import { PrismExperiment } from './prism.js';
import { SlitExperiment } from './slit.js';
import { PolarizationExperiment } from './polarization.js';
import { PolarimeterExperiment } from './polarimeter.js';
import { PhotoelectricExperiment } from './photoelectric.js';
import { AbbeExperiment } from './abbe.js';
import { YoungExperiment } from './young.js';
import { BrewsterExperiment } from './brewster.js';
import { FabryPerotExperiment } from './fabryperot.js';
import { UltrasonicExperiment } from './ultrasonic.js';

export const EXPERIMENTS = [
  LensExperiment, ScopeExperiment, YoungExperiment, NewtonExperiment, WedgeExperiment, BiprismExperiment, MichelsonExperiment, FabryPerotExperiment,
  SpectrometerExperiment, PrismExperiment, SlitExperiment, UltrasonicExperiment, AbbeExperiment, PolarizationExperiment, BrewsterExperiment, PolarimeterExperiment, HoloExperiment, PhotoelectricExperiment,
  VoltAmpExperiment, BridgeExperiment, CalibExperiment,
];
