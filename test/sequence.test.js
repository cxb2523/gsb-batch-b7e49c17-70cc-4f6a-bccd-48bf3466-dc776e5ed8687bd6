'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  toSeconds,
  createTimeline,
  locateByTime,
  timeAtSegment,
  nextPlayableIndex,
} = require('../src/sequence.js')

// 浮点比较：时长来自 parseFloat 减法，允许 1e-9 的误差
function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message || ''} 期望 ${expected}，实际 ${actual}`)
}

function checkInvariant(timeline, index, offset, playedTime) {
  const segment = timeline.segments[index]
  assert.ok(segment, `index ${index} 应指向有效片段`)
  closeTo(playedTime, segment.cumulativeStart + offset, '已播时长 = 前面片段时长之和 + 片段内偏移')
  assert.ok(playedTime >= 0 && playedTime <= timeline.totalTime, '已播时长在 [0, 总时长]')
  assert.ok(offset >= 0 && offset <= segment.duration + 1e-9, '片段内偏移不越界')
}

test('start / end 字符串按数值参与时长计算', () => {
  const timeline = createTimeline([
    { playPoint: { start: '0', end: '3.120000' } },
    { playPoint: { start: '4.320000', end: '10.200000' } },
    { playPoint: { start: '1.5', end: '2' } },
  ])
  closeTo(timeline.totalTime, 3.12 + (10.2 - 4.32) + 0.5, '总时长')
  closeTo(timeline.skipDict[0], 3.12, '第一段累计时长')
  closeTo(timeline.skipDict[1], 3.12 + (10.2 - 4.32), '第二段累计时长')
  closeTo(timeline.skipDict[2], timeline.totalTime, '第三段累计时长')
  assert.strictEqual(timeline.segments[0].start, 0)
  closeTo(timeline.segments[1].start, 4.32, 'start 按数值解析')
  closeTo(timeline.segments[2].duration, 0.5, 'end - start')
  assert.strictEqual(toSeconds('abc'), 0)
  assert.strictEqual(toSeconds(undefined), 0)
  assert.strictEqual(toSeconds('2.75'), 2.75)
})

test('按累计时长分段表定位片段：普通落点', () => {
  // 时长 3 / 5.88 / 0.5，累计 3 / 8.88 / 9.38
  const timeline = createTimeline([
    { playPoint: { start: '0', end: '3' } },
    { playPoint: { start: '4', end: '9.88' } },
    { playPoint: { start: '1', end: '1.5' } },
  ])
  const point = locateByTime(timeline, 5)
  assert.strictEqual(point.index, 1)
  closeTo(point.offset, 2, '第二段内偏移')
  assert.strictEqual(point.atEnd, false)
  checkInvariant(timeline, point.index, point.offset, timeAtSegment(timeline, point.index, point.offset))

  // 落在第二段（累计 3 ~ 8.88）
  const second = locateByTime(timeline, 3 + 2.5)
  assert.strictEqual(second.index, 1)
  closeTo(second.offset, 2.5, '第二段内偏移')

  // 落在第三段
  const third = locateByTime(timeline, 8.88 + 0.25)
  assert.strictEqual(third.index, 2)
  closeTo(third.offset, 0.25, '第三段内偏移')
})

test('落在片段边界时归入后一片段，offset 为 0', () => {
  const timeline = createTimeline([
    { playPoint: { start: '10', end: '13' } },
    { playPoint: { start: '20', end: '25' } },
    { playPoint: { start: '30', end: '32' } },
  ])
  let point = locateByTime(timeline, 3)
  assert.strictEqual(point.index, 1)
  assert.strictEqual(point.offset, 0)
  assert.strictEqual(point.atEnd, false)

  point = locateByTime(timeline, 8)
  assert.strictEqual(point.index, 2)
  assert.strictEqual(point.offset, 0)

  // 跳回第一段开头（0）归入第一段
  point = locateByTime(timeline, 0)
  assert.strictEqual(point.index, 0)
  assert.strictEqual(point.offset, 0)
  assert.strictEqual(point.atEnd, false)
})

test('落在总时长末端按播放结束处理', () => {
  const timeline = createTimeline([
    { playPoint: { start: '0', end: '3' } },
    { playPoint: { start: '0', end: '2' } },
  ])
  const end = locateByTime(timeline, timeline.totalTime)
  assert.strictEqual(end.atEnd, true)
  assert.strictEqual(end.index, timeline.segments.length)

  const past = locateByTime(timeline, timeline.totalTime + 10)
  assert.strictEqual(past.atEnd, true)

  const negative = locateByTime(timeline, -5)
  assert.strictEqual(negative.index, 0)
  assert.strictEqual(negative.offset, 0)
  assert.strictEqual(negative.atEnd, false)
})

test('单片段序列：切换、跳到开头、末端都不越界', () => {
  const timeline = createTimeline([{ playPoint: { start: '2', end: '7.5' } }])
  closeTo(timeline.totalTime, 5.5, '总时长')
  closeTo(timeline.skipDict[0], 5.5, '累计时长')

  const start = locateByTime(timeline, 0)
  assert.strictEqual(start.index, 0)
  assert.strictEqual(start.offset, 0)
  assert.strictEqual(start.atEnd, false)

  const middle = locateByTime(timeline, 3)
  assert.strictEqual(middle.index, 0)
  closeTo(middle.offset, 3, '片段内偏移')

  const end = locateByTime(timeline, timeline.totalTime)
  assert.strictEqual(end.atEnd, true)
  assert.strictEqual(nextPlayableIndex(timeline, 1), 1)
  closeTo(timeAtSegment(timeline, 0, 99), 5.5, '偏移越界时夹到片段末尾')
  closeTo(timeAtSegment(timeline, 5, 0), 5.5, '下标越界时按结束处理')
  assert.strictEqual(timeAtSegment(timeline, -1, 0), 0)
})

test('start 大于 end 的非法片段不产生负进度', () => {
  const timeline = createTimeline([
    { playPoint: { start: '0', end: '2' } },
    { playPoint: { start: '9', end: '4' } }, // 非法，时长按 0
    { playPoint: { start: '3', end: '5' } },
  ])
  assert.strictEqual(timeline.segments[1].duration, 0)
  assert.strictEqual(timeline.segments[1].cumulativeStart, 2)
  assert.strictEqual(timeline.segments[1].cumulativeEnd, 2)
  assert.strictEqual(timeline.totalTime, 4)
  assert.strictEqual(timeline.skipDict[1], 2)
  assert.strictEqual(timeline.skipDict[2], 4)

  // 0 时长片段被跳过，不会成为落点
  assert.strictEqual(nextPlayableIndex(timeline, 0), 0)
  assert.strictEqual(nextPlayableIndex(timeline, 1), 2)

  const atBoundary = locateByTime(timeline, 2)
  assert.strictEqual(atBoundary.index, 2)
  assert.strictEqual(atBoundary.offset, 0)
  assert.strictEqual(atBoundary.atEnd, false)

  // 所有片段都非法时总时长为 0，定位按结束处理
  const allInvalid = createTimeline([{ playPoint: { start: '3', end: '1' } }])
  assert.strictEqual(allInvalid.totalTime, 0)
  assert.strictEqual(locateByTime(allInvalid, 1).atEnd, true)
  assert.strictEqual(locateByTime(allInvalid, 0).atEnd, true)
})

test('timeAtSegment 对抗抖动 / 越界输入', () => {
  const timeline = createTimeline([
    { playPoint: { start: '1', end: '4' } },
    { playPoint: { start: '5', end: '9' } },
  ])
  assert.strictEqual(timeAtSegment(timeline, 0, 0), 0)
  assert.strictEqual(timeAtSegment(timeline, 0, 3), 3)
  assert.strictEqual(timeAtSegment(timeline, 1, 0), 3)
  assert.strictEqual(timeAtSegment(timeline, 1, 2), 5)
  assert.strictEqual(timeAtSegment(timeline, 1, -10), 3)
  assert.strictEqual(timeAtSegment(timeline, 1, 100), 7)
  assert.strictEqual(timeAtSegment(timeline, 99, 0), 7)
  assert.strictEqual(timeAtSegment(timeline, NaN, 0), 0)
})

test('空序列与非法输入', () => {
  const timeline = createTimeline(undefined)
  assert.strictEqual(timeline.totalTime, 0)
  assert.deepStrictEqual(timeline.segments, [])
  assert.deepStrictEqual(locateByTime(timeline, 5), { index: 0, offset: 0, atEnd: true })
  assert.strictEqual(timeAtSegment(timeline, 0, 1), 0)
  assert.strictEqual(nextPlayableIndex(timeline, 3), 0)
})
