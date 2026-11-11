import type { ResolvedEntity } from '../resolve';
import type { CardConfig, HomeAssistant } from '../types';

/** What `group_by` can read from Home Assistant's registries, outermost first. */
export const GROUP_LEVELS = ['floor', 'area', 'device', 'label'] as const;
export type GroupLevel = (typeof GROUP_LEVELS)[number];

/** `group_by` from YAML: one level or a list of them. Kept in house order (floor before area…). */
export function parseGroupBy(raw: unknown): GroupLevel[] {
  if (raw === undefined || raw === null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.some((l) => !GROUP_LEVELS.includes(l as GroupLevel))) {
    throw new Error(`"group_by" must be one or more of: ${GROUP_LEVELS.join(', ')}`);
  }
  return GROUP_LEVELS.filter((l) => list.includes(l));
}

/** Checks for `group_by` and each entity's own `group`. */
export function validateGroups(raw: CardConfig): void {
  parseGroupBy(raw.group_by);
  (raw.entities ?? []).forEach((e, i) => {
    const group = typeof e === 'object' && e ? (e as { group?: unknown }).group : undefined;
    if (group !== undefined && group !== null && typeof group !== 'string') {
      throw new Error(`Entity ${i + 1}: "group" must be text, such as "Kitchen" or "Ground floor / Kitchen"`);
    }
  });
}

/** An entity's own `group`, split at each "/" into levels: "Ground floor / Kitchen". */
export function splitGroup(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  return text
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The registry fields grouping reads, which the card's own HomeAssistant type leaves out. */
interface Registries {
  entities?: Record<string, { device_id?: string | null; area_id?: string | null; labels?: string[] }>;
  devices?: Record<
    string,
    { name?: string | null; name_by_user?: string | null; area_id?: string | null; labels?: string[] }
  >;
  areas?: Record<string, { name?: string; floor_id?: string | null }>;
  floors?: Record<string, { name?: string }>;
  labels?: Record<string, { name?: string }>;
}

/** "living_room" → "Living room": a readable stand-in when only an id is known. */
function fromId(id: string): string {
  const text = id.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The name of `entityId`'s floor, area, device or first label, from the registries. */
export function levelName(entityId: string, level: GroupLevel, hass: HomeAssistant): string | undefined {
  const reg = hass as unknown as Registries;
  const entry = reg.entities?.[entityId];
  const device = entry?.device_id ? reg.devices?.[entry.device_id] : undefined;
  const areaId = entry?.area_id ?? device?.area_id ?? undefined;
  switch (level) {
    case 'area':
      return areaId ? (reg.areas?.[areaId]?.name ?? fromId(areaId)) : undefined;
    case 'floor': {
      const floorId = areaId ? reg.areas?.[areaId]?.floor_id : undefined;
      return floorId ? (reg.floors?.[floorId]?.name ?? fromId(floorId)) : undefined;
    }
    case 'device':
      return device ? (device.name_by_user ?? device.name ?? undefined) : undefined;
    case 'label': {
      const label = [...(entry?.labels ?? []), ...(device?.labels ?? [])][0];
      return label ? (reg.labels?.[label]?.name ?? fromId(label)) : undefined;
    }
  }
}

/**
 * Which groups an entity sits in, outermost first. Its own `group` wins; otherwise each
 * `group_by` level is read from the registries, and a level it has none of is `other`.
 */
export function groupPath(e: ResolvedEntity, levels: GroupLevel[], hass: HomeAssistant, other: string): string[] {
  const own = splitGroup((e.config as { group?: unknown }).group);
  if (own.length) return own;
  return levels.map((level) => levelName(e.entityId, level, hass) ?? other);
}

export interface TreeNode {
  name: string;
  /** Group names from the top down to this node; empty for the root. A leaf has its group's. */
  path: string[];
  /** The sum of the positive values below (a leaf: its own value, or 0 without one). */
  value: number;
  depth: number;
  children: TreeNode[];
  /** Leaves only: the entity and its index into the chart's items. */
  entity?: ResolvedEntity;
  index?: number;
}

/** A leaf's size: its value when that is a positive number, else nothing. */
export function leafValue(e: ResolvedEntity): number {
  return e.available && e.value !== null && e.value > 0 ? e.value : 0;
}

/**
 * The entities as a tree: a root holding the groups, each holding its subgroups and then its
 * entities. Every level is ordered largest first; equal values keep the order they came in.
 */
export function buildTree(items: ResolvedEntity[], paths: string[][], rootName: string): TreeNode {
  const root: TreeNode = { name: rootName, path: [], value: 0, depth: 0, children: [] };
  items.forEach((entity, index) => {
    let node = root;
    for (const name of paths[index] ?? []) {
      let child = node.children.find((c) => c.entity === undefined && c.name === name);
      if (!child) {
        child = { name, path: [...node.path, name], value: 0, depth: node.depth + 1, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({
      name: entity.name,
      path: node.path,
      value: 0,
      depth: node.depth + 1,
      children: [],
      entity,
      index,
    });
  });
  const total = (node: TreeNode): number => {
    node.value = node.entity ? leafValue(node.entity) : node.children.reduce((sum, c) => sum + total(c), 0);
    const order = new Map(node.children.map((c, i) => [c, i]));
    node.children.sort((a, b) => b.value - a.value || order.get(a)! - order.get(b)!);
    return node.value;
  };
  total(root);
  return root;
}

/** The group at `path` below `root`, or undefined when there is no such group (any more). */
export function findNode(root: TreeNode, path: string[]): TreeNode | undefined {
  let node: TreeNode | undefined = root;
  for (const name of path) {
    node = node.children.find((c) => c.entity === undefined && c.name === name);
    if (!node) return undefined;
  }
  return node;
}

/** How many levels lie below `node` (0 for a leaf). */
export function treeHeight(node: TreeNode): number {
  return node.children.length ? 1 + Math.max(...node.children.map(treeHeight)) : 0;
}

export interface Span {
  node: TreeNode;
  /** Levels below the partition's root: 0 is the root itself. */
  level: number;
  /** Where the node starts and ends, as fractions of the root's value (0–1). */
  x0: number;
  x1: number;
}

/**
 * Every node under `root` with the share of the whole it covers, for sunbursts and icicles:
 * each child gets a slice of its parent's span in proportion to its value. Nodes with nothing to
 * show (a zero value) are left out.
 */
export function partition(root: TreeNode): Span[] {
  const out: Span[] = [];
  const walk = (node: TreeNode, level: number, x0: number, x1: number) => {
    out.push({ node, level, x0, x1 });
    if (node.value <= 0) return;
    let x = x0;
    for (const child of node.children) {
      if (child.value <= 0) continue;
      const w = ((x1 - x0) * child.value) / node.value;
      walk(child, level + 1, x, x + w);
      x += w;
    }
  };
  walk(root, 0, 0, 1);
  return out;
}
