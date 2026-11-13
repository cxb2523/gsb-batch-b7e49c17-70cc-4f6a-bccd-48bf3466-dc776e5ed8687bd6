'use strict'

/**
 * 组件胶水层测试：
 * 直接读取 src/canvasPlayer.vue 的 <script setup> 块，去掉 import 后
 * 用 Function 构造出组件的 options 对象，从而在不启动浏览器的情况下
 * 验证「进度条拖动 / 点击 -> 定位片段 -> 以片段内偏移起播」这条链路。
 *
 * 纯计算部分由 sequence.test.js / playbackSequence.test.js 覆盖，
 * 这里只关心组件是否把正确的时间与下标交给 VideoPlay。
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const PlaybackSequence = require('../src/playbackSequence.js')
const { toSeconds, nextPlayableIndex } = require('../src/sequence.js')

function loadComponentOptions() {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/canvasPlayer.vue'), 'utf8')
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)
  assert.ok(script, 'canvasPlayer.vue 应包含 <script setup> 块')
  const body = script[1]
    .replace(/^\s*import\s+.*$/gm, '')
    .replace('export default', 'return')
  // eslint-disable-next-line no-new-func
  const factory = new Function('PlaybackSequence', 'toSeconds', 'nextPlayableIndex', body)
  return factory(PlaybackSequence, toSeconds, nextPlayableIndex)
}

const componentOptions = loadComponentOptions()

const SAMPLE = [
  { url: 'a.mp4', playPoint: { start: '0', end: '3' } },
  { url: 'b.mp4', playPoint: { start: '4', end: '9.88' } },
  { url: 'c.mp4', playPoint: { start: '10', end: '10.5' } },
]

// 造一个不依赖 Vue / DOM 的组件实例：data() + methods 绑定到同一个对象
function createComponent(list) {
  const vm = Object.assign({}, componentOptions.data())
  vm.videoList = list
  for (const key of Object.keys(componentOptions.methods)) {
    vm[key] = componentOptions.methods[key].bind(vm)
  }
  // 拦截真正创建 video / canvas 的异步入口，只记录调用参数
  vm.videoPlayCalls = []
  vm.VideoPlay = function(offset) {
    vm.videoPlayCalls.push(offset)
  }
  vm.videoObj = {
    paused: true,
    pause() {
      this.paused = true
    },
    play() {
      this.paused = false
    },
  }
  return vm
}

// 简易 DOM 桩：进度条宽度 200px，起点 0
function stubBar() {
  global.document = {
    querySelector(selector) {
      if (selector === '.bar') {
        return {
          getBoundingClientRect() {
            return { left: 0, width: 200, top: 0, height: 10 }
          },
        }
      }
      return null
    },
    getElementById() {
      return null
    },
  }
}

function restoreDocument() {
  delete global.document
}

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message || ''} 期望 ${expected}，实际 ${actual}`)
}

test('comTotalTime 用字符串 start / end 建立累计时长分段表', () => {
  const vm = createComponent(SAMPLE)
  vm.comTotalTime()
  closeTo(vm.totalTime, 3 + (9.88 - 4) + 0.5, '总时长')
  closeTo(vm.skipDict[0], 3, '第一段累计时长')
  closeTo(vm.skipDict[1], 3 + (9.88 - 4), '第二段累计时长')
  closeTo(vm.skipDict[2], vm.totalTime, '第三段累计时长')
  assert.strictEqual(vm.sequence.totalTime, vm.totalTime)
  assert.strictEqual(vm.playIndex, 0)
})

test('拖动后松手：跳到后面的片段，并带片段内偏移', () => {
  const vm = createComponent(SAMPLE)
  vm.comTotalTime()
  vm.playedTime = 5 // 第二段（3 ~ 8.88）内偏移 2
  vm.skipProgress()

  assert.strictEqual(vm.playIndex, 1)
  assert.strictEqual(vm.playedTime, 5)
  assert.strictEqual(vm.endFlag, false)
  assert.deepStrictEqual(vm.videoPlayCalls, [2], '以片段内偏移 2 起播，而不是整条序列时间')
})

test('拖动跨越多个片段：定位到目标片段', () => {
  const vm = createComponent(SAMPLE)
  vm.comTotalTime()
  vm.playedTime = 8.88 + 0.25 // 第三段（累计 8.88 起）内偏移 0.25
  vm.skipProgress()

  assert.strictEqual(vm.playIndex, 2)
  assert.strictEqual(vm.videoPlayCalls.length, 1)
  assert.ok(Math.abs(vm.videoPlayCalls[0] - 0.25) < 1e-9)
})

test('拖动落在片段边界：归入后一片段，偏移为 0', () => {
  const vm = createComponent(SAMPLE)
  vm.comTotalTime()
  vm.playedTime = 3 // 第一段与第二段的分界
  vm.skipProgress()

  assert.strictEqual(vm.playIndex, 1)
  assert.deepStrictEqual(vm.videoPlayCalls, [0])
  assert.strictEqual(vm.playedTime, 3)
})

test('拖动到总时长末端：按播放结束处理，不再起播', () => {
  const vm = createComponent(SAMPLE)
  vm.comTotalTime()
  vm.playedTime = vm.totalTime
  vm.skipProgress()

  assert.strictEqual(vm.endFlag, true)
  assert.strictEqual(vm.paused, true)
  assert.strictEqual(vm.playIndex, SAMPLE.length, '结束哨兵下标不越界访问片段')
  assert.strictEqual(vm.videoPlayCalls.length, 0)
  assert.strictEqual(vm.playedTime, vm.totalTime)

  // 结束后再点播放按钮：从头开始
  vm.changeVideoState()
  assert.strictEqual(vm.playIndex, 0)
  assert.strictEqual(vm.playedTime, 0)
  assert.strictEqual(vm.endFlag, false)
})

test('点击进度条左端：跳回第一段开头，不产生负进度', () => {
  stubBar()
  try {
    const vm = createComponent(SAMPLE)
    vm.comTotalTime()
    vm.playedTime = 9
    vm.skipLine({ clientX: 0 })

    assert.strictEqual(vm.playIndex, 0)
    assert.strictEqual(vm.playedTime, 0)
    assert.deepStrictEqual(vm.videoPlayCalls, [0])
  } finally {
    restoreDocument()
  }
})

test('点击进度条中间：按比例定位片段', () => {
  stubBar()
  try {
    const vm = createComponent(SAMPLE)
    vm.comTotalTime()
    // 中点：总时长 9.38 / 2 = 4.69，位于第二段
    vm.skipLine({ clientX: 100 })

    assert.ok(Math.abs(vm.playedTime - vm.totalTime / 2) < 1e-9)
    assert.strictEqual(vm.playIndex, 1)
    assert.strictEqual(vm.videoPlayCalls.length, 1)
    assert.ok(Math.abs(vm.videoPlayCalls[0] - (vm.totalTime / 2 - 3)) < 1e-9)
  } finally {
    restoreDocument()
  }
})

test('拖动超出进度条范围：比例夹在 [0, 1]', () => {
  stubBar()
  try {
    const vm = createComponent(SAMPLE)
    vm.comTotalTime()

    vm.setValue({ clientX: -50 })
    assert.strictEqual(vm.playedTime, 0)

    vm.setValue({ clientX: 500 })
    assert.strictEqual(vm.playedTime, vm.totalTime)
    assert.strictEqual(vm.progressPercent(), 100)
  } finally {
    restoreDocument()
  }
})

test('单片段序列：跳转到开头与末端都不越界', () => {
  const list = [{ url: 'only.mp4', playPoint: { start: '2', end: '7.5' } }]
  const vm = createComponent(list)
  vm.comTotalTime()
  assert.strictEqual(vm.totalTime, 5.5)

  vm.playedTime = 0
  vm.skipProgress()
  assert.strictEqual(vm.playIndex, 0)
  assert.deepStrictEqual(vm.videoPlayCalls, [0])

  vm.playedTime = 5.5
  vm.skipProgress()
  assert.strictEqual(vm.endFlag, true)
  assert.strictEqual(vm.playIndex, 1)
  assert.strictEqual(vm.videoPlayCalls.length, 1, '末端不再起播新片段')
})

test('start 大于 end 的非法片段：不产生负进度，跳转被跳过', () => {
  const list = [
    { url: 'ok1.mp4', playPoint: { start: '0', end: '2' } },
    { url: 'bad.mp4', playPoint: { start: '9', end: '4' } },
    { url: 'ok2.mp4', playPoint: { start: '3', end: '5' } },
  ]
  const vm = createComponent(list)
  vm.comTotalTime()
  closeTo(vm.totalTime, 2 + 0 + 2, '总时长（非法片段按 0 计）')
  assert.strictEqual(vm.skipDict[0], 2)
  assert.strictEqual(vm.skipDict[1], 2)
  assert.strictEqual(vm.skipDict[2], 4)

  // 拖动到第二段区域（非法片段累计时长与第一段相同）→ 归入第三段
  vm.playedTime = 2
  vm.skipProgress()
  assert.strictEqual(vm.playIndex, 2)
  assert.deepStrictEqual(vm.videoPlayCalls, [0])

  // 拖到 0 时长片段之前的位置不会产生负进度
  vm.playedTime = 0
  vm.skipProgress()
  assert.strictEqual(vm.playedTime, 0)
  assert.strictEqual(vm.playIndex, 0)
})

test('全部片段非法 / 空 list：不出现负进度或越界', () => {
  const vm = createComponent([{ url: 'bad.mp4', playPoint: { start: '9', end: '1' } }])
  vm.comTotalTime()
  assert.strictEqual(vm.totalTime, 0)
  assert.strictEqual(vm.progressPercent(), 0)

  vm.playedTime = 1
  vm.skipProgress()
  assert.strictEqual(vm.endFlag, true)
  assert.strictEqual(vm.playIndex, 1)
  assert.strictEqual(vm.videoPlayCalls.length, 0)

  const empty = createComponent([])
  empty.comTotalTime()
  assert.strictEqual(empty.totalTime, 0)
  empty.gotoPlay()
  assert.strictEqual(empty.paused, true)
  assert.strictEqual(empty.playIndex, 0)
  assert.strictEqual(empty.videoPlayCalls.length, 0)
})

test('真实配置形状：四段字符串小数点时长，跨片段跳转与切换', () => {
  // 与 src/data.js 的 playPoint 写法一致（全部是字符串，且带多余小数位）
  const list = [
    { url: 'v.mp4', logoPosition: { x: 'left', y: 'top' }, playPoint: { end: '3.120000', start: '0' } },
    { url: 'v.mp4', logoPosition: { x: 'right', y: 'top' }, playPoint: { end: '10.200000', start: '4.320000' } },
    { url: 'v.mp4', logoPosition: { x: 'left', y: 'bottom' }, playPoint: { end: '20.320000', start: '11.400000' } },
    { url: 'v.mp4', logoPosition: { x: 'right', y: 'bottom' }, playPoint: { end: '24.72', start: '21.520000' } },
  ]
  const vm = createComponent(list)
  vm.comTotalTime()
  // 片段时长：3.12 / 5.88 / 8.92 / 3.2
  closeTo(vm.totalTime, 21.12, '与 data.js 里的 duration 一致')

  // 依次播放：每段切换点等于累计时长，进度单调
  const timeline = vm.sequence.timeline
  const expected = []
  for (let i = 0; i < vm.sequence.length; i += 1) {
    expected.push(timeline.segments[i].cumulativeEnd)
  }
  for (let i = 0; i < vm.sequence.length; i += 1) {
    vm.playNext({ pause() {} })
    if (i < vm.sequence.length - 1) {
      closeTo(vm.playedTime, expected[i], `第 ${i + 1} 段切换点`)
      assert.strictEqual(vm.playIndex, i + 1)
    } else {
      assert.strictEqual(vm.endFlag, true)
      closeTo(vm.playedTime, vm.totalTime, '播放结束时的已播时长')
    }
  }

  // 跳到第三段中间（累计 9.0 ~ 17.92）
  vm.playedTime = 9.0 + 4.4
  vm.skipProgress()
  assert.strictEqual(vm.playIndex, 2)
  closeTo(vm.videoPlayCalls[vm.videoPlayCalls.length - 1], 4.4, '片段内偏移')
  closeTo(vm.playedTime, 13.4, '整条序列已播时长')
  // 源视频起点 = start + 偏移
  closeTo(timeline.segments[2].start + 4.4, 15.8, '源视频起点')
})

test('正常播放切换：ontimeupdate 累加的是片段内偏移', () => {
  const vm = createComponent(SAMPLE)
  vm.comTotalTime()

  // 模拟第一段播放：video currentTime 0.5 -> 3
  let state = vm.sequence.syncFromVideo(0.5)
  assert.strictEqual(state.playedTime, 0.5)
  state = vm.sequence.syncFromVideo(3)
  assert.strictEqual(state.playedTime, 3)
  assert.strictEqual(state.reachedEnd, true)

  // playNext 推进到第二段，进度不倒退
  vm.playNext({ pause() {} })
  assert.strictEqual(vm.playIndex, 1)
  assert.strictEqual(vm.playedTime, 3)

  // 第二段内偏移 2s -> 整条序列 5s
  state = vm.sequence.syncFromVideo(6)
  assert.ok(Math.abs(state.playedTime - 5) < 1e-9)
})
