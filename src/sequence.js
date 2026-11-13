'use strict'

/**
 * 片段序列的纯计算工具。
 *
 * 播放器把多段视频按各自的 playPoint.start / playPoint.end 依次播放，
 * 进度条显示的是「整条序列的已播放时长」。这里集中实现：
 *
 *  1. 把字符串形式的 start / end 解析成数值，建立累计时长分段表；
 *  2. 由「片段下标 + 片段内偏移」得到整条序列的已播放时长；
 *  3. 由「整条序列的播放时长」定位应播放的片段及其片段内偏移。
 *
 * 所有函数都不产生副作用，便于本地用 Node 直接测试。
 */

/**
 * 把 start / end 配置解析成秒数。字符串（如 "3.120000"）按数值参与计算，
 * 空值、非数字、NaN、Infinity 一律退回 fallback（默认 0）。
 *
 * @param {*} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
function toSeconds(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }
  const number = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(number) ? number : fallback
}

/** 取一个片段配置里的起止点，兼容 playPoint 字段与直接的 start / end 字段。 */
function getPlayPoint(fragment) {
  if (!fragment || typeof fragment !== 'object') {
    return { start: 0, end: 0 }
  }
  const point = fragment.playPoint || fragment
  return {
    start: point.start,
    end: point.end,
  }
}

/**
 * 建立累计时长分段表。
 *
 * 每个片段记录：
 *   - start / end：片段在源视频里的起止秒数（数值）；
 *   - duration：本片段贡献给整条序列的时长，`end - start` 小于 0 时按 0 处理，
 *     因此 start > end 的非法片段不会产生负进度，也不会破坏后续片段的累计时长；
 *   - cumulativeStart / cumulativeEnd：本片段在整条序列里的起止时长。
 *
 * @param {Array} list 片段配置数组（$canvasVideoPlayer(list) 传入的 list）
 * @returns {{segments: Array, skipDict: number[], totalTime: number}}
 */
function createTimeline(list) {
  const fragments = Array.isArray(list) ? list : []
  const segments = []
  const skipDict = []
  let totalTime = 0

  for (let i = 0; i < fragments.length; i += 1) {
    const point = getPlayPoint(fragments[i])
    const start = toSeconds(point.start)
    const end = toSeconds(point.end)
    // start > end 的非法片段时长按 0 计，避免出现负进度。
    const duration = Math.max(0, end - start)
    const cumulativeStart = totalTime
    totalTime += duration
    segments.push({
      index: i,
      start,
      end,
      duration,
      cumulativeStart,
      cumulativeEnd: totalTime,
    })
    skipDict.push(totalTime)
  }

  return { segments, skipDict, totalTime }
}

/**
 * 把整条序列的播放时长定位到「片段下标 + 片段内偏移」。
 *
 * 规则：
 *   - 时间先收敛到 [0, totalTime]；
 *   - 落在片段边界（等于前一片段的 cumulativeEnd）时归入后一片段，offset 为 0；
 *   - 时长为 0 的非法片段会被跳过；
 *   - 落在总时长末端（time >= totalTime）按播放结束处理，返回 atEnd: true，
 *     此时 index 为 segments.length（结束哨兵），调用方不应再用它访问片段；
 *   - 空序列同样按播放结束处理。
 *
 * @param {{segments: Array, totalTime: number}} timeline
 * @param {number} time 整条序列的播放时长
 * @returns {{index: number, offset: number, atEnd: boolean}}
 */
function locateByTime(timeline, time) {
  const segments = (timeline && timeline.segments) || []
  const totalTime = (timeline && timeline.totalTime) || 0
  const target = Math.min(Math.max(toSeconds(time), 0), totalTime)

  if (segments.length === 0) {
    return { index: 0, offset: 0, atEnd: true }
  }
  if (totalTime <= 0 || target >= totalTime) {
    return { index: segments.length, offset: 0, atEnd: true }
  }

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    if (segment.duration <= 0) {
      continue
    }
    // 严格小于：正好落在边界上时归入后一个片段。
    if (target < segment.cumulativeEnd) {
      const offset = Math.min(Math.max(target - segment.cumulativeStart, 0), segment.duration)
      return { index: i, offset, atEnd: false }
    }
  }

  return { index: segments.length, offset: 0, atEnd: true }
}

/**
 * 由「片段下标 + 片段内偏移」得到整条序列的已播放时长。
 *
 * 片段的起始时长是前面所有片段 duration 之和，因此序列进度天然单调：
 * 前一片段播完时的值等于后一片段的起始值。
 * 下标或偏移越界都会被收敛，不会出现负进度或超过总时长。
 *
 * @param {{segments: Array, totalTime: number}} timeline
 * @param {number} index 片段下标
 * @param {number} [offset=0] 片段内已播放秒数
 * @returns {number}
 */
function timeAtSegment(timeline, index, offset = 0) {
  const segments = (timeline && timeline.segments) || []
  if (segments.length === 0) {
    return 0
  }
  const safeIndex = Math.floor(toSeconds(index, 0))
  if (safeIndex >= segments.length) {
    return timeline.totalTime
  }
  const segment = segments[Math.max(0, safeIndex)]
  const safeOffset = Math.min(Math.max(toSeconds(offset, 0), 0), segment.duration)
  return segment.cumulativeStart + safeOffset
}

/**
 * 从 fromIndex 开始找第一个可播放（duration > 0）的片段。
 * 返回 segments.length 表示序列已经播放结束。
 *
 * @param {{segments: Array}} timeline
 * @param {number} fromIndex
 * @returns {number}
 */
function nextPlayableIndex(timeline, fromIndex) {
  const segments = (timeline && timeline.segments) || []
  let index = Math.floor(toSeconds(fromIndex, 0))
  if (index < 0) {
    index = 0
  }
  if (index > segments.length) {
    index = segments.length
  }
  while (index < segments.length && segments[index].duration <= 0) {
    index += 1
  }
  return index
}

module.exports = {
  toSeconds,
  createTimeline,
  locateByTime,
  timeAtSegment,
  nextPlayableIndex,
}
