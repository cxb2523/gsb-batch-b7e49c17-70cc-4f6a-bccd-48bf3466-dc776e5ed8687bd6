import { createCameraService } from '#application/cameras/camera-service.js';
import { createMonitoringService } from '#application/monitoring/monitoring-service.js';
import { createServiceLogService } from '#application/logs/service-log-service.js';
import { createAlertService } from '#application/alerts/alert-service.js';
import { createDetectionService } from '#application/detections/detection-service.js';
import { callInference } from '#infrastructure/inference/fastapi-client.js';
import {
  getRegisteredCamera,
  getRegisteredCameras,
  registerCamera,
  updateRegisteredCamera,
  removeRegisteredCamera
} from '#infrastructure/cameras/fastapi-camera-registry.js';

/**
 * Los servicios se crean por solicitud para que el JWT de un operador nunca
 * pueda filtrarse hacia otra solicitud concurrente del panel.
 * @param {string | null} authorization
 */
export function createServerServices(authorization = null) {
  /** @param {string} path @param {Parameters<typeof callInference>[1]} [options] */
  const inferenceClient = (path, options = {}) => callInference(path, { ...options, authorization });
  const cameraRegistry = {
    list: async () => getRegisteredCameras({ inferenceClient }),
    get: async (/** @type {unknown} */ id) => getRegisteredCamera(typeof id === 'string' ? id : null, { inferenceClient }),
    register: (/** @type {{ id: string, name: string, streamPath: string }} */ camera) => registerCamera(camera, { inferenceClient }),
    update: (/** @type {{ id: string, name: string, streamPath: string }} */ camera) => updateRegisteredCamera(camera, { inferenceClient }),
    remove: (/** @type {string} */ id) => removeRegisteredCamera(id, { inferenceClient })
  };
  return {
    cameraService: createCameraService({ inferenceClient, cameraRegistry }),
    monitoringService: createMonitoringService({ inferenceClient, cameraRegistry }),
    serviceLogService: createServiceLogService({ inferenceClient }),
    alertService: createAlertService({ inferenceClient }),
    detectionService: createDetectionService({ inferenceClient })
  };
}
