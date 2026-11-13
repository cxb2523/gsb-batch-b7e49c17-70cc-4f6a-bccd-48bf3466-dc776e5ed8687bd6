'use strict'

const {
  createTimeline,
  locateByTime,
  timeAtSegment,
  nextPlayableIndex,
  toSeconds,
} = require('./sequence.js')

function clamp(value, min, max) {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

/**
 * 整条序列的播放状态机。
 *
 * 负责推进「已播时长 - 片段下标 - 片段内偏移」这三个量，使其始终满足：
 *
 *   playedTime = 前面各片段时长之和 + 当前片段内已播时长
 *
 * 播放器组件只负责把它同步到 video / canvas 上，可以直接在 Node 里测试。
 */
class PlaybackSequence {
  constructor(list) {
    this.timeline = createTimeline(list)
    this.index = 0
    this.offset = 0
    this.playedTime = 0
    this.atEnd = false
    this.startAt(0, 0)
  }

  get segments() {
    return this.timeline.segments
  }

  get totalTime() {
    return this.timeline.totalTime
  }

  get skipDict() {
    return this.timeline.skipDict
  }

  get length() {
    return this.timeline.segments.length
  }

  get currentSegment() {
    return this.timeline.segments[this.index] || null
  }

  get snapshot() {
    return {
      index: this.index,
      offset: this.offset,
      playedTime: this.playedTime,
      atEnd: this.atEnd,
    }
  }

  get progressRatio() {
    if (this.totalTime <= 0) {
      return 0
    }
    return clamp(this.playedTime / this.totalTime, 0, 1)
  }

  // 重新配置片段（列表被外部替换时使用）
  rebuild(list) {
    this.timeline = createTimeline(list)
    return this.startAt(0, 0)
  }

  // 回到序列开头
  reset() {
    return this.startAt(0, 0)
  }

  // 序列全部播放完毕
  finish() {
    this.index = this.length
    this.offset = 0
    this.playedTime = this.totalTime
    this.atEnd = true
    return this.snapshot
  }

  /**
   * 从指定片段、片段内指定偏移开始播放。
   *
   * - index 越界会收敛到有效范围；
   * - 时长为 0 的非法片段会被跳过；
   * - offset 到达片段末尾（或超出）时归入后一片段；
   * - 已经没有可播放片段时进入结束状态。
   *
   * @param {number} index
   * @param {number} [offset=0]
   * @returns {{index: number, offset: number, playedTime: number, atEnd: boolean}}
   */
  startAt(index, offset = 0) {
    const segments = this.segments
    let next = nextPlayableIndex(this.timeline, index)
    let remaining = Math.max(toSeconds(offset, 0), 0)

    while (next < segments.length && remaining >= segments[next].duration) {
      remaining -= segments[next].duration
      next = nextPlayableIndex(this.timeline, next + 1)
    }

    if (next >= segments.length) {
      return this.finish()
    }

    const segment = segments[next]
    this.index = next
    this.offset = clamp(remaining, 0, segment.duration)
    this.playedTime = segment.cumulativeStart + this.offset
    this.atEnd = false
    return this.snapshot
  }

  // 当前片段播完，进入下一个可播放片段
  advance() {
    const segment = this.currentSegment
    return this.startAt(segment ? segment.index + 1 : this.index + 1, 0)
  }

  /**
   * 按整条序列的时长跳转。
   *
   * - 落在片段边界时归入后一片段（offset 为 0）；
   * - 落在总时长末端时按播放结束处理（atEnd 为 true，index 为 length）。
   *
   * @param {number} time
   * @returns {{index: number, offset: number, playedTime: number, atEnd: boolean}}
   */
  seekToTime(time) {
    const point = locateByTime(this.timeline, time)
    if (point.atEnd) {
      return this.finish()
    }
    this.index = point.index
    this.offset = point.offset
    this.playedTime = timeAtSegment(this.timeline, point.index, point.offset)
    this.atEnd = false
    return this.snapshot
  }

  /**
   * 把当前片段内偏移推进到指定值（只增不减），用于片段播完瞬间对齐进度。
   *
   * @param {number} offset
   * @returns {{index: number, offset: number, playedTime: number, atEnd: boolean}}
   */
  setOffset(offset) {
    const segment = this.currentSegment
    if (!segment || this.atEnd) {
      return this.snapshot
    }
    const next = clamp(toSeconds(offset, 0), 0, segment.duration)
    if (next > this.offset) {
      this.offset = next
      this.playedTime = segment.cumulativeStart + next
    }
    return this.snapshot
  }

  /**
   * 用当前 video 的 currentTime 推进已播时长。
   *
   * 只增不减：播放过程中 video 时间若有抖动或回退，进度不会倒退。
   * reachedEnd 表示视频已越过本片段的 end，调用方应切到下一片段。
   *
   * @param {number} currentTime 当前 video 的播放秒数
   * @returns {{index: number, offset: number, playedTime: number, atEnd: boolean, reachedEnd: boolean}}
   */
  syncFromVideo(currentTime) {
    const segment = this.currentSegment
    if (!segment || this.atEnd) {
      return Object.assign(this.snapshot, { reachedEnd: this.atEnd })
    }

    const time = toSeconds(currentTime, segment.start)
    // 到达片段末尾（含）即算播完，与 canvas 绘制循环的 currentTime >= end 一致
    const reachedEnd = time >= segment.end
    const offset = clamp(time - segment.start, 0, segment.duration)

    if (offset > this.offset) {
      this.offset = offset
      this.playedTime = segment.cumulativeStart + offset
    }

    return Object.assign(this.snapshot, { reachedEnd })
  }
}

module.exports = PlaybackSequence
module.exports.PlaybackSequence = PlaybackSequence
