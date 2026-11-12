import { z } from 'zod';

// Imported first by main.tsx.

// Zod probes for `new Function` at start-up, which the content security policy reports as a
// violation even though the probe is caught; without it Zod uses its plain code path.
z.config({ jitless: true });
