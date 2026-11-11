import type { Material } from "../schema"
import type { NoiseVoice, ToneVoice } from "./sound-voices"

export type Strike = { click: NoiseVoice; body: ToneVoice; ring?: ToneVoice }

export type MaterialVoice = { press: Strike; release: Strike }

export const MATERIALS: Record<Material, MaterialVoice> = {
  plastic: {
    press: { click: { frequency: 3400, q: 1.4, decay: 0.016, peak: 0.3 }, body: { frequency: 170, glideTo: 70, attack: 0.002, decay: 0.05, peak: 0.26 } },
    release: { click: { frequency: 5200, q: 2, decay: 0.01, peak: 0.1 }, body: { frequency: 320, glideTo: 220, decay: 0.022, peak: 0.06 } },
  },
  metal: {
    press: { click: { frequency: 5600, q: 5, decay: 0.012, peak: 0.36 }, body: { frequency: 420, glideTo: 380, wave: "triangle", decay: 0.09, peak: 0.16 }, ring: { frequency: 1160, decay: 0.16, peak: 0.045 } },
    release: { click: { frequency: 7000, q: 6, decay: 0.008, peak: 0.12 }, body: { frequency: 620, wave: "triangle", decay: 0.05, peak: 0.05 }, ring: { frequency: 1710, decay: 0.1, peak: 0.02 } },
  },
  rubber: {
    press: { click: { frequency: 900, q: 0.7, filter: "lowpass", decay: 0.03, peak: 0.24 }, body: { frequency: 120, glideTo: 60, attack: 0.004, decay: 0.07, peak: 0.24 } },
    release: { click: { frequency: 1400, q: 0.7, filter: "lowpass", decay: 0.018, peak: 0.08 }, body: { frequency: 180, glideTo: 140, decay: 0.03, peak: 0.05 } },
  },
  glass: {
    press: { click: { frequency: 6400, q: 3, decay: 0.006, peak: 0.32 }, body: { frequency: 2350, decay: 0.07, peak: 0.07 }, ring: { frequency: 3520, decay: 0.12, peak: 0.035 } },
    release: { click: { frequency: 8000, q: 3, decay: 0.004, peak: 0.11 }, body: { frequency: 2790, decay: 0.04, peak: 0.03 } },
  },
  paper: {
    press: { click: { frequency: 2200, q: 0.6, attack: 0.004, decay: 0.035, peak: 0.26 }, body: { frequency: 140, glideTo: 90, decay: 0.03, peak: 0.11 } },
    release: { click: { frequency: 3600, q: 0.6, attack: 0.003, decay: 0.025, peak: 0.1 }, body: { frequency: 200, decay: 0.015, peak: 0.03 } },
  },
}
