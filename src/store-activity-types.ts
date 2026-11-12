/** Activity-feed types shared by the store and the framework-free data/activity module. */
export type MenuTab = 'activity' | 'deploys' | 'alerts' | 'services' | 'projects';
export type CameraCommand = { kind: 'zoomIn' | 'zoomOut' | 'reset' | 'pan'; n: number; dx?: number; dz?: number };
export type Focus = { kind: 'service' | 'project'; id: string; n: number };
export type Tone = 'ok' | 'info' | 'warn' | 'crit' | 'muted';

export type EventKind = 'deploy-start' | 'deploy-ok' | 'deploy-fail' | 'down' | 'up' | 'stopped' | 'started' | 'new-node' | 'cpu';

/** One line in the live activity feed, derived from what changed between two patches. */
export interface ActivityEvent {
  id: string;
  kind: EventKind;
  at: number;
  tone: Tone;
  text: string;
  detail?: string;
  serviceId?: string;
}
