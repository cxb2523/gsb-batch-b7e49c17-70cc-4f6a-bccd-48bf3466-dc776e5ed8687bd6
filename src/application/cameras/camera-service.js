export class CameraNotFoundError extends Error {}

/**
 * @param {{
 *   inferenceClient: (path: string, options?: { method?: string, body?: unknown }) => Promise<any>,
 *   cameraRegistry: {
 *     list: () => Promise<any[]>,
 *     get: (id: string | null | undefined) => Promise<any>,
 *     register: (camera: any) => Promise<any>,
 *     update: (camera: any) => Promise<any>,
 *     remove: (id: string) => Promise<void>
 *   },
 *   wait?: (milliseconds: number) => Promise<void>
 * }} dependencies
 */
export function createCameraService({ inferenceClient, cameraRegistry, wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }) {
  return {
    async list() {
      return cameraRegistry.list();
    },

    /** @param {{ name: string, normalizedUrl: string, streamPath: string }} input */
    async register({ name, normalizedUrl, streamPath }) {
      const cameras = await cameraRegistry.list();
      let camera;
      try {
        const id = `camara${nextAvailableCameraNumber(cameras)}`;
        camera = await cameraRegistry.register({ id, name, streamPath, normalizedUrl });
      } catch (error) {
        // Otra sesión pudo registrar el mismo source_id entre el listado y el POST.
        if (!/\b409\b/.test(error instanceof Error ? error.message : String(error))) throw error;
        const refreshed = await cameraRegistry.list();
        const id = `camara${nextAvailableCameraNumber(refreshed)}`;
        camera = await cameraRegistry.register({ id, name, streamPath, normalizedUrl });
      }

      try {
        const source = await inferenceClient('/sources/start', {
          method: 'POST', body: { source_id: camera.id, stream_path: camera.streamPath ?? streamPath }
        });
        return { camera, inference: { available: true, source } };
      } catch (error) {
        return {
          camera,
          inference: { available: false, error: error instanceof Error ? error.message : String(error) }
        };
      }
    },

    /** @param {string} id */
    async start(id) {
      const camera = await cameraRegistry.get(id);
      if (!camera) throw new CameraNotFoundError('Primero registra una camara.');
      return inferenceClient('/sources/start', {
        method: 'POST', body: { source_id: camera.id, stream_path: camera.streamPath ?? camera.id }
      });
    },

    /** @param {string} id @param {{ name: string, normalizedUrl: string, streamPath: string }} input */
    async update(id, { name, normalizedUrl, streamPath }) {
      const current = await cameraRegistry.get(id);
      if (!current) throw new CameraNotFoundError('La cámara ya no existe. Recarga el inventario.');
      const wasActive = current.active === true;
      let stopped = false;

      if (wasActive) {
        await inferenceClient(`/sources/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
        stopped = true;
      }

      let camera;
      try {
        camera = await cameraRegistry.update({ id: current.id, name, streamPath, normalizedUrl });
      } catch (error) {
        // Evita dejar la fuente apagada si la edición no llegó a persistirse.
        if (stopped) {
          try {
            await inferenceClient('/sources/start', { method: 'POST', body: { source_id: current.id } });
          } catch { /* Se conserva el error original de edición. */ }
        }
        throw error;
      }

      if (!wasActive) return { camera, inference: { available: false, source: null } };
      // El worker consulta la configuración cada 2 s; espera dos ciclos completos
      // para que observe la fuente detenida y lea el stream_path ya actualizado.
      await wait(5_000);
      try {
        const source = await inferenceClient('/sources/start', {
          method: 'POST', body: { source_id: camera.id }
        });
        return { camera, inference: { available: true, source } };
      } catch (error) {
        return { camera, inference: { available: false, error: error instanceof Error ? error.message : String(error) } };
      }
    },

    /** @param {string} id */
    async remove(id) {
      const camera = await cameraRegistry.get(id);
      if (!camera) return { removed: true };

      let warning = null;
      try {
        await inferenceClient(`/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch {
        warning = 'No se pudo detener la inferencia antes de eliminar la cámara.';
      }

      if (warning) return { removed: false, inferenceStopped: false, warning };
      await cameraRegistry.remove(id);

      return { removed: true, inferenceStopped: warning === null, warning };
    }
  };
}
import { nextAvailableCameraNumber } from '#domain/camera/camera.js';
