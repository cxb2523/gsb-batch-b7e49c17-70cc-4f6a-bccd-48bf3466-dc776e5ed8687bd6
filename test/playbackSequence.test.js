'use strict'

const test = require('node:test')
const assert = require('node:assert')

const PlaybackSequence = require('../src/playbackSequence.js')

// 三个片段的样例：时长 3.12 / 5.88 / 0.6
const SAMPLE = [
  {
    url: 'a.mp4',
    width: 1080,
    height: 1920,
    logoPosition: { x: 'left', y: 'top' },
    playPoint: { start: '0', end: '3.120000' },
  },
  {
    url: 'b.mp4',
    width: 1080,
    height: 1920,
    logoPosition: { x: 'right', y: 'top' },
    playPoint: { start: '4.320000', end: '10.200000' },
  },
  {
    url: 'c.mp4',
    width: 1080,
    height: 1920,
    logoPosition: { x: 'left', y: 'bottom' },
    playPoint: { start: '11.400000', end: '12.000000' },
  },
]

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message || ''} 期望 ${expected}，实际 ${actual}`)
}

function expectedPlayed(sequence, index, offset) {
  return sequence.timeline.segments[index].cumulativeStart + offset
}

test('初始化：从第一段开头开始，已播时长为 0', () => {
  const sequence = new PlaybackSequence(SAMPLE)
  assert.deepStrictEqual(sequence.snapshot, { index: 0, offset: 0, playedTime: 0, atEnd: false })
  closeTo(sequence.totalTime, 3.12 + 5.88 + 0.6, '总时长')
  assert.strictEqual(sequence.currentSegment.start, 0)
})

test('正常切换：已播时长单调递增，切换点等于前一段累计时长', () => {
  const sequence = new PlaybackSequence(SAMPLE)
  const seen = []

  // 第一段从 0 播到 end
  for (const time of [0.5, 1, 2, 3.12]) {
    const state = sequence.syncFromVideo(time)
    seen.push(state.playedTime)
  }
  closeTo(sequence.playedTime, 3.12, '第一段播完')
  assert.strictEqual(sequence.syncFromVideo(3.12).reachedEnd, true, '到达 end 应触发切换')

  // 切到第二段：时间不倒退
  const afterFirst = sequence.advance()
  assert.strictEqual(afterFirst.index, 1)
  assert.strictEqual(afterFirst.offset, 0)
  closeTo(afterFirst.playedTime, 3.12, '切换后的起点等于第一段累计时长')

  // 第二段从 4.32 播到 10.2，进度持续递增
  for (const time of [4.32, 5, 7.5, 10.2]) {
    const state = sequence.syncFromVideo(time)
    seen.push(state.playedTime)
    closeTo(state.playedTime, expectedPlayed(sequence, 1, time - 4.32), `第二段 ${time}s`)
  }

  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] >= seen[i - 1], `进度不应倒退：${seen[i - 1]} -> ${seen[i]}`)
  }

  const afterSecond = sequence.advance()
  assert.strictEqual(afterSecond.index, 2)
  closeTo(afterSecond.playedTime, 3.12 + 5.88, '第三段起点')

  // 最后一段播完进入结束状态，总时长不变
  const end = sequence.advance()
  assert.strictEqual(end.atEnd, true)
  assert.strictEqual(end.index, sequence.length)
  closeTo(end.playedTime, sequence.totalTime, '结束时等于总时长')
})

test('video 时间抖动 / 回退时进度只增不减', () => {
  const sequence = new PlaybackSequence(SAMPLE)
  sequence.seekToTime(5) // 第二段，offset 1.88
  const before = sequence.playedTime

  // 回退的 currentTime 不应让进度倒退
  let state = sequence.syncFromVideo(4.5)
  closeTo(state.playedTime, before, '回退时不变化')

  // 继续前进才更新
  state = sequence.syncFromVideo(6.5)
  closeTo(state.playedTime, expectedPlayed(sequence, 1, 6.5 - 4.32), '前进时按片段内偏移推进')
})

test('跨片段跳转：按累计时长分段表定位并带片段内偏移', () => {
  const sequence = new PlaybackSequence(SAMPLE)

  // 跳到第 3 段中间（累计 9.0 起）
  let state = sequence.seekToTime(9.1)
  assert.strictEqual(state.index, 2)
  closeTo(state.offset, 9.1 - 9.0, '第三段内偏移')
  closeTo(state.playedTime, 9.1, '已播时长等于目标时长')
  // VideoPlay 用 offset 算出源视频起点：start + offset
  const sourceTime = sequence.timeline.segments[2].start + state.offset
  closeTo(sourceTime, 11.4 + (9.1 - 9.0), '源视频起点')

  // 再跳回第一段
  state = sequence.seekToTime(1.5)
  assert.strictEqual(state.index, 0)
  closeTo(state.offset, 1.5, '第一段内偏移')
  closeTo(state.playedTime, 1.5, '第一段已播时长')

  // 跳到第二段中间
  state = sequence.seekToTime(5)
  assert.strictEqual(state.index, 1)
  closeTo(state.offset, 5 - 3.12, '第二段内偏移')
})

test('落在片段边界上归入后一片段', () => {
  const sequence = new PlaybackSequence(SAMPLE)
  const boundaryOne = sequence.timeline.segments[0].cumulativeEnd
  const boundaryTwo = sequence.timeline.segments[1].cumulativeEnd

  let state = sequence.seekToTime(boundaryOne)
  assert.strictEqual(state.index, 1)
  assert.strictEqual(state.offset, 0)
  closeTo(state.playedTime, boundaryOne, '边界时长不丢失')

  state = sequence.seekToTime(boundaryTwo)
  assert.strictEqual(state.index, 2)
  assert.strictEqual(state.offset, 0)
})

test('跳到总时长末端按播放结束处理', () => {
  const sequence = new PlaybackSequence(SAMPLE)
  const total = sequence.totalTime

  let state = sequence.seekToTime(total)
  assert.strictEqual(state.atEnd, true)
  assert.strictEqual(state.index, sequence.length, '结束时下标是 length 哨兵')
  closeTo(state.playedTime, total, '结束时等于总时长')

  // 超出总时长同样按结束处理，且不越界
  state = sequence.seekToTime(total + 100)
  assert.strictEqual(state.atEnd, true)

  // 结束后仍可从头播放
  state = sequence.startAt(0, 0)
  assert.deepStrictEqual(state, { index: 0, offset: 0, playedTime: 0, atEnd: false })
})

test('跳转到第一段开头：无负进度与越界下标', () => {
  const sequence = new PlaybackSequence(SAMPLE)
  sequence.seekToTime(9)
  let state = sequence.seekToTime(0)
  assert.deepStrictEqual(state, { index: 0, offset: 0, playedTime: 0, atEnd: false })

  // 负时间同样收敛到开头
  state = sequence.seekToTime(-10)
  assert.deepStrictEqual(state, { index: 0, offset: 0, playedTime: 0, atEnd: false })

  // 直接跳到第一段偏移
  state = sequence.startAt(0, 2)
  assert.strictEqual(state.index, 0)
  assert.strictEqual(state.offset, 2)
  assert.strictEqual(state.playedTime, 2)
})

test('单片段序列：切换与重复跳转不越界', () => {
  const sequence = new PlaybackSequence([{ url: 'only.mp4', playPoint: { start: '2', end: '7.5' } }])
  closeTo(sequence.totalTime, 5.5, '单片段总时长')

  let state = sequence.seekToTime(2.5)
  assert.strictEqual(state.index, 0)
  assert.strictEqual(state.offset, 2.5)

  // 播完后切下一段：直接结束
  state = sequence.syncFromVideo(7.6)
  assert.strictEqual(state.reachedEnd, true)
  const next = sequence.advance()
  assert.strictEqual(next.atEnd, true)
  assert.strictEqual(next.index, 1)
  closeTo(next.playedTime, 5.5, '结束时等于总时长')

  // 在片段末尾 seek：结束
  state = sequence.seekToTime(5.5)
  assert.strictEqual(state.atEnd, true)

  // 结束后 seek 回开头
  state = sequence.seekToTime(0)
  assert.deepStrictEqual(state, { index: 0, offset: 0, playedTime: 0, atEnd: false })
})

test('start 大于 end 的非法片段被跳过，不产生负进度', () => {
  const sequence = new PlaybackSequence([
    { url: 'ok1.mp4', playPoint: { start: '0', end: '2' } },
    { url: 'bad.mp4', playPoint: { start: '9', end: '4' } },
    { url: 'ok2.mp4', playPoint: { start: '3', end: '5' } },
  ])
  assert.strictEqual(sequence.totalTime, 4)
  assert.strictEqual(sequence.segments[1].duration, 0)

  // 第一段播完直接跳到第三段
  const next = sequence.advance()
  assert.strictEqual(next.index, 2)
  assert.strictEqual(next.playedTime, 2)

  // 指向非法片段的 seek 不会停在 0 时长片段上
  let state = sequence.seekToTime(2)
  assert.strictEqual(state.index, 2)
  assert.strictEqual(state.offset, 0)

  // 片段内偏移超出剩余总时长时按播放结束处理
  state = sequence.startAt(0, 10)
  assert.strictEqual(state.atEnd, true)
  assert.strictEqual(state.index, sequence.length)

  // 片段内偏移为负时收敛到 0
  state = sequence.startAt(0, -5)
  assert.strictEqual(state.offset, 0)
  assert.strictEqual(state.playedTime, 0)

  // 直接指向非法片段时跳到后一个可播放片段
  state = sequence.startAt(1, 0.5)
  assert.strictEqual(state.index, 2)
  assert.strictEqual(state.offset, 0.5)
  assert.strictEqual(state.playedTime, 2.5)
})

test('全序列非法 / 空序列：不产生负进度与越界下标', () => {
  const sequence = new PlaybackSequence([{ url: 'bad.mp4', playPoint: { start: '9', end: '1' } }])
  assert.strictEqual(sequence.totalTime, 0)
  assert.deepStrictEqual(sequence.snapshot, { index: 1, offset: 0, playedTime: 0, atEnd: true })
  assert.strictEqual(sequence.currentSegment, null)
  assert.strictEqual(sequence.progressRatio, 0)

  const empty = new PlaybackSequence([])
  assert.deepStrictEqual(empty.snapshot, { index: 0, offset: 0, playedTime: 0, atEnd: true })

  // 越界下标的 startAt 收敛到结束，而不是访问 undefined
  const state = empty.startAt(5, 3)
  assert.strictEqual(state.atEnd, true)
})

test('进度比例夹在 [0, 1]', () => {
  const sequence = new PlaybackSequence(SAMPLE)
  assert.strictEqual(sequence.progressRatio, 0)
  sequence.seekToTime(sequence.totalTime / 2)
  assert.strictEqual(sequence.progressRatio, 0.5)
  sequence.seekToTime(sequence.totalTime + 50)
  assert.strictEqual(sequence.progressRatio, 1)
})

test('syncFromVideo 对越界 currentTime 收敛，不产生负进度', () => {
  const sequence = new PlaybackSequence(SAMPLE)
  sequence.seekToTime(5) // 第二段 start 4.32, offset 1.88

  // currentTime 低于片段 start（seek 未完成）→ 进度保持不变
  const low = sequence.syncFromVideo(0)
  closeTo(low.playedTime, 5, '低于片段起点时进度不变')
  closeTo(low.offset, 5 - 3.12, '偏移不变')

  // currentTime 超过片段 end → offset 夹在片段时长，reachedEnd 为 true
  const high = sequence.syncFromVideo(12)
  assert.strictEqual(high.reachedEnd, true)
  closeTo(high.offset, 5.88, '偏移夹到片段时长')
  closeTo(high.playedTime, 3.12 + 5.88, '已播时长夹到第二段末尾')
})

test('切换瞬间对齐：setOffset 只能前进，保证进度等于前面片段时长之和', () => {
  const sequence = new PlaybackSequence(SAMPLE)
  // 采样稍有误差：currentTime 略早于 end
  sequence.syncFromVideo(3.1)
  sequence.setOffset(sequence.currentSegment.duration)
  closeTo(sequence.playedTime, 3.12, '对齐到片段时长')

  const snapshot = sequence.advance()
  closeTo(snapshot.playedTime, 3.12, '切换后的起点不跳变、不倒退')

  // setOffset 不会把进度拉回去
  sequence.syncFromVideo(6)
  const before = sequence.playedTime
  sequence.setOffset(0)
  closeTo(sequence.playedTime, before, 'setOffset 只增不减')

  // 结束状态下 setOffset 无效
  sequence.seekToTime(sequence.totalTime)
  const end = sequence.setOffset(1)
  assert.strictEqual(end.atEnd, true)
})
