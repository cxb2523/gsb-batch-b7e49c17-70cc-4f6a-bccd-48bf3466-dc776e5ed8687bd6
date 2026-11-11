// Persistencia local de cámaras para el prototipo Node/SvelteKit.
// No es una base de datos multiusuario ni adecuada para serverless.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const configuredDataDir = String(process.env.CAMERA_DATA_DIR ?? '').trim();
const dataDir = configuredDataDir
  ? (isAbsolute(configuredDataDir) ? configuredDataDir : resolve(process.cwd(), configuredDataDir))
  : join(process.cwd(), 'data');
const camerasFile = join(dataDir, 'cameras.json');
const legacyCameraFile = join(dataDir, 'camera.json');

/**
 * @typedef {object} Camera
 * @property {string} id
 * @property {number} number
 * @property {string} name
 * @property {string} url
 * @property {string} streamPath
 * @property {string} registeredAt
 */

/**
 * @template T
 * @param {string} path
 * @param {T} fallback
 * @returns {Promise<T>}
 */
async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

/** @returns {Promise<Camera[]>} */
export async function getCameras() {
  /** @type {Camera[] | null} */
  const cameras = await readJson(camerasFile, null);
  if (Array.isArray(cameras)) return cameras;
  /** @type {Camera | null} */
  const legacyCamera = await readJson(legacyCameraFile, null);
  return legacyCamera ? [legacyCamera] : /** @type {Camera[]} */ ([]);
}

/**
 * @param {string | null | undefined} id
 * @returns {Promise<Camera | null>}
 */
export async function getCamera(id) {
  const cameras = await getCameras();
  return id ? cameras.find((camera) => camera.id === id) ?? null : cameras[0] ?? null;
}

/** @param {Camera[]} cameras */
async function saveCameras(cameras) {
  await mkdir(dataDir, { recursive: true });
  const tmp = join(dataDir, 'cameras.tmp.json');
  await writeFile(tmp, JSON.stringify(cameras, null, 2), { mode: 0o600 });
  await rename(tmp, camerasFile);
  await rm(legacyCameraFile, { force: true });
}

/** @param {Camera} camera */
export async function putCamera(camera) {
  const cameras = await getCameras();
  const index = cameras.findIndex((item) => item.id === camera.id);
  if (index >= 0) cameras[index] = camera;
  else cameras.push(camera);
  await saveCameras(cameras);
}

/** @param {string} id */
export async function removeCamera(id) {
  const cameras = await getCameras();
  await saveCameras(cameras.filter((camera) => camera.id !== id));
}
