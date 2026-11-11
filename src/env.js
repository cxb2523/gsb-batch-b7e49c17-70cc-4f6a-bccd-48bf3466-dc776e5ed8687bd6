import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  CAMERA_PLAYBACK_URL: {},
  INFERENCE_API_URL: {},
  INFERENCE_API_KEY: {},
  PUBLIC_CLERK_PUBLISHABLE_KEY: {}
});
