import { validateEnv } from './env.schema.js';

try {
  validateEnv();
  process.exit(0);
} catch {
  process.exit(1);
}
