// Every aircraft the simulator can fly. Each is a definition file: published
// geometry, masses, engine and propeller, plus the handbook figures it is
// validated against. The flight model builds itself from the definition.
import c172s from './c172s.js';
import c152 from './c152.js';
import pa28 from './pa28.js';
import dr400 from './dr400.js';
import c182t from './c182t.js';
import sr22 from './sr22.js';
import j3 from './j3.js';
import extra300 from './extra300.js';
import ask21 from './ask21.js';

export const AIRCRAFT = { c172s, c152, pa28, dr400, c182t, sr22, j3, extra300, ask21 };
export const DEFAULT_AIRCRAFT = 'c172s';
