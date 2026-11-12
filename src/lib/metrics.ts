import type { Blog } from "../../shared/blogs";

/** deterministic 32-bit string hash */
export function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** deterministic 0..1 from an integer seed */
export function rand01(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface BuildingMetrics {
  /** height in world units */
  height: number;
  /** 0..1 share of lit windows */
  lit: number;
  /** 0..1 tag breadth */
  breadth: number;
  seed: number;
}

const MAX_HEIGHT = 214;
const MIN_HEIGHT = 14;

/**
 * The visual encoding, and the only place the city makes a claim about a blog:
 *
 *   height ← 活跃度（在这份列表里的更新排序）+ 标签广度
 *   windows ← 活跃度（越新鲜，亮着的窗越多）
 *   footprint ← 标签广度
 *   疑似失效的博客：矮、几乎全黑
 *
 * Everything is deterministic, so the same blog always gets the same tower.
 */
export function buildingMetrics(blog: Blog): BuildingMetrics {
  const seed = hashStr(blog.id);
  const jitter = rand01(seed);
  const breadth = Math.min(blog.tags.length, 8) / 8;
  const fresh = Math.max(0, Math.min(1, blog.fresh));

  if (blog.dead) {
    return {
      height: 9 + jitter * 13,
      lit: 0.015 + jitter * 0.02,
      breadth,
      seed,
    };
  }

  const score = 0.6 * Math.pow(fresh, 0.5) + 0.26 * Math.pow(breadth, 0.65) + 0.14 * jitter;
  return {
    height: MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * score,
    lit: 0.08 + 0.8 * Math.pow(fresh, 0.75),
    breadth,
    seed,
  };
}
