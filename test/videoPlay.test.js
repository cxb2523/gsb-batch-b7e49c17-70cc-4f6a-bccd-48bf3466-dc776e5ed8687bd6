'use strict'

/**
 * VideoPlay 集成测试：用假的 video / canvas DOM 驱动组件的播放与跳转流程，
 * 验证「切换后进度不跳变不倒退」「跳转以片段内偏移起播」在组件层面成立。
 *
 * 不依赖 Vue：组件 options 通过读取 SFC 的 <script setup> 构造（同 component.test.js）。
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
  const body = script[1].replace(/^\s*import\s+.*$/gm, '').replace('export default', 'return')
  const factory = new Function('PlaybackSequence', 'toSeconds', 'nextPlayableIndex', body)
  return factory(PlaybackSequence, toSeconds, nextPlayableIndex)
}

const componentOptions = loadComponentOptions()

// ---------- 假 DOM ----------

class FakeVideo {
  constructor() {
    this.id = ''
    this._src = ''
    this._currentTime = 0
    this.paused = true
    this.ended = false
    this.seeking = false
    this.readyState = 4 // 视为 metadata 已就绪
    this.width = 1080
    this.height = 1920
    this.volume = 0.1
    this.muted = false
    this.style = {}
    this.handlers = {}
    this.playCalls = 0
    // setVideoStyle 会通过 parentNode 计算尺寸
    this.videoWidth = 1080
    this.videoHeight = 1920
    this.parentNode = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1080, height: 1920 }),
    }
  }
  set src(value) {
    this._src = value
    // 换成新视频源后，真实的 video 会重新触发 durationchange / loadedmetadata
    const self = this
    fakeDom.nextTick(function() {
      self.fire('durationchange')
      self.fire('loadedmetadata')
    })
  }
  get src() {
    return this._src
  }
  set currentTime(value) {
    if (Math.abs(value - this._currentTime) < 1e-9) {
      return
    }
    this._currentTime = value
    this.seeking = true
    const self = this
    fakeDom.pendingSeeked.push(function() {
      self.seeking = false
      self.fire('seeked')
    })
  }
  get currentTime() {
    return this._currentTime
  }
  // 模拟播放推进（不触发 seek）
  advanceTo(value) {
    this._currentTime = value
    this.fire('timeupdate')
  }
  addEventListener(type, fn) {
    this.handlers[type] = this.handlers[type] || []
    this.handlers[type].push(fn)
  }
  removeEventListener() {}
  fire(type) {
    const inline = this['on' + type]
    if (typeof inline === 'function') {
      inline()
    }
    const list = this.handlers[type] || []
    list.slice().forEach((fn) => fn())
  }
  play() {
    this.playCalls += 1
    this.paused = false
    this.fire('play')
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
}

class FakeCanvas {
  constructor() {
    this.id = ''
    this.width = 1080
    this.height = 1920
    this.handlers = {}
    this.drawn = 0
    this.context = {
      drawImage: () => {
        this.drawn += 1
      },
    }
  }
  addEventListener(type, fn) {
    this.handlers[type] = this.handlers[type] || []
    this.handlers[type].push(fn)
  }
  removeEventListener() {}
  getContext() {
    return this.context
  }
}

const fakeDom = {
  registry: {},
  videos: [],
  pendingSeeked: [],
  pendingTicks: [],
  rafQueue: [],
  init() {
    this.registry = {}
    this.videos = []
    this.pendingSeeked = []
    this.pendingTicks = []
    this.rafQueue = []

    const makeEl = (tag, extra) =>
      Object.assign(
        {
          tag,
          style: {},
          handlers: {},
          addEventListener(type, fn) {
            this.handlers[type] = this.handlers[type] || []
            this.handlers[type].push(fn)
          },
          removeEventListener() {},
          appendChild(child) {
            if (child && child.id) {
              fakeDom.registry[child.id] = child
            }
          },
        },
        extra || {}
      )

    global.document = {
      body: makeEl('body'),
      addEventListener() {},
      removeEventListener() {},
      getElementById: (id) => this.registry[id] || null,
      getElementsByTagName: (tag) => (tag === 'video' ? this.videos : []),
      querySelector: (selector) => {
        if (selector === '#VideoDom' || selector === '#canvasDom') {
          return makeEl(selector)
        }
        if (selector === '#AutoCanvasId') {
          return this.registry['AutoCanvasId'] || null
        }
        if (selector === '.bar') {
          return makeEl('.bar', {
            getBoundingClientRect: () => ({ left: 0, width: 200, top: 0, height: 10 }),
            offsetWidth: 200,
          })
        }
        if (selector === '#circle') {
          return makeEl('#circle', { offsetWidth: 10 })
        }
        return null
      },
      createElement: (tag) => {
        if (tag === 'Video') {
          const video = new FakeVideo()
          this.videos.push(video)
          return video
        }
        if (tag === 'Canvas') {
          return new FakeCanvas()
        }
        return makeEl(tag)
      },
    }
    global.window = {
      requestAnimationFrame: (cb) => {
        // 绘制循环不自动执行，避免测试依赖真实帧节奏
        this.rafQueue.push(cb)
        return this.rafQueue.length
      },
      cancelAnimationFrame: () => {},
      setTimeout: (fn, ms) => setTimeout(fn, ms),
    }
    // 组件会通过 appendChild 登记 id，这里补一层：任何带 id 的对象都能被 getElementById 找到
    const originalCreate = global.document.createElement
    global.document.createElement = (tag) => {
      const node = originalCreate(tag)
      const originalAppend = node.appendChild
      node.appendChild = function(child) {
        if (child && child.id) {
          fakeDom.registry[child.id] = child
        }
        return originalAppend.call(this, child)
      }
      return node
    }
  },
  cleanup() {
    delete global.document
    delete global.window
  },
  nextTick(fn) {
    this.pendingTicks.push(fn)
  },
  // 让挂起的 seeked / durationchange 回调执行
  flush() {
    const ticks = this.pendingTicks
    this.pendingTicks = []
    ticks.forEach((fn) => fn())
    while (this.pendingSeeked.length) {
      const list = this.pendingSeeked
      this.pendingSeeked = []
      list.forEach((fn) => fn())
      // seeked 里可能又调用了 play / 定位，继续把新挂起的回调跑完
      const moreTicks = this.pendingTicks
      this.pendingTicks = []
      moreTicks.forEach((fn) => fn())
    }
  },
}

// ---------- 组件实例 ----------

function createComponent(list) {
  const vm = Object.assign({}, componentOptions.data())
  vm.videoList = list
  vm.list = list
  for (const key of Object.keys(componentOptions.methods)) {
    vm[key] = componentOptions.methods[key].bind(vm)
  }
  vm.$nextTick = (fn) => fakeDom.nextTick(fn)
  return vm
}

async function settle() {
  fakeDom.flush()
  await new Promise((resolve) => setTimeout(resolve, 0))
  fakeDom.flush()
}

const SAMPLE = [
  { url: 'a.mp4', playPoint: { start: '0', end: '3' } },
  { url: 'b.mp4', playPoint: { start: '4', end: '9.88' } },
  { url: 'c.mp4', playPoint: { start: '10', end: '12' } },
]

test('正常播放到片段末尾：进度对齐切换点后推进到下一片段，不跳变不倒退', async () => {
  fakeDom.init()
  try {
    const vm = createComponent(SAMPLE)
    vm.comTotalTime()
    vm.VideoPlay()
    await settle()

    const video = vm.videoObj
    assert.ok(video.playCalls >= 1, '第一段开始播放')
    assert.strictEqual(video.currentTime, 0, '第一段从 start=0 起播')

    // 第一段播到 2s
    video.advanceTo(2)
    assert.strictEqual(vm.playedTime, 2)

    // 到达 3s（配置的 end）→ 切第二段
    video.advanceTo(3)
    assert.strictEqual(vm.playIndex, 1, '推进到第二段')
    assert.strictEqual(vm.playedTime, 3, '切换瞬间进度等于第一段累计时长')

    await settle()
    // 真实实现会复用同一个 #AutoVideoId 节点，这里只校验重新定位到第二段起点
    const next = vm.videoObj
    assert.ok(Math.abs(next.currentTime - 4) < 1e-9, '第二段从 start=4 起播')

    // 第二段播 2s → 整条序列 5s
    next.advanceTo(6)
    assert.strictEqual(vm.playedTime, 5)
  } finally {
    fakeDom.cleanup()
  }
})

test('跨片段跳转：定位目标片段并把片段内偏移传给 video 的起点', async () => {
  fakeDom.init()
  try {
    const vm = createComponent(SAMPLE)
    vm.comTotalTime()
    vm.VideoPlay()
    await settle()

    // 跳到第三段中间：累计 8.88 起，目标 9.38 → 偏移 0.5
    vm.playedTime = 8.88 + 0.5
    vm.skipProgress()
    assert.strictEqual(vm.playIndex, 2)
    assert.ok(Math.abs(vm.playedTime - 9.38) < 1e-9)

    await settle()
    const video = vm.videoObj
    assert.ok(Math.abs(video.currentTime - 10.5) < 1e-9, '源视频起点 = start 10 + 偏移 0.5')

    // seek 落地后进度不被旧位置推动
    assert.ok(Math.abs(vm.playedTime - 9.38) < 1e-9, 'seek 过程中进度保持目标值')
  } finally {
    fakeDom.cleanup()
  }
})

test('跳回第一段开头：来源的旧时间不会把进度推成负数或倒退', async () => {
  fakeDom.init()
  try {
    const vm = createComponent(SAMPLE)
    vm.comTotalTime()
    vm.VideoPlay()
    await settle()

    // 先跳到第三段
    vm.playedTime = 9.2
    vm.skipProgress()
    await settle()
    assert.strictEqual(vm.playIndex, 2)

    // 再跳回开头
    vm.playedTime = 0
    vm.skipProgress()
    assert.strictEqual(vm.playIndex, 0)
    assert.strictEqual(vm.playedTime, 0)

    await settle()
    const video = vm.videoObj
    assert.strictEqual(video.currentTime, 0, '从 0 起播')
    video.advanceTo(1)
    assert.strictEqual(vm.playedTime, 1)
  } finally {
    fakeDom.cleanup()
  }
})

test('播放中拖动进度条向后跳：进度单调、目标片段偏移正确', async () => {
  fakeDom.init()
  try {
    const vm = createComponent(SAMPLE)
    vm.comTotalTime()
    vm.VideoPlay()
    await settle()

    // 当前在第二段播放 5.5s
    vm.playedTime = 5.5
    vm.skipProgress()
    await settle()
    assert.strictEqual(vm.playIndex, 1)
    const first = vm.videoObj
    assert.ok(Math.abs(first.currentTime - 6.5) < 1e-9)

    // 向后拖到第三段（累计 8.88 起，目标 9.1 → 偏移 0.22）
    vm.playedTime = 9.1
    vm.skipProgress()
    await settle()
    assert.strictEqual(vm.playIndex, 2)
    assert.ok(vm.playedTime >= 5.5, '进度不应倒退')
    assert.ok(Math.abs(vm.videoObj.currentTime - 10.22) < 1e-9)
  } finally {
    fakeDom.cleanup()
  }
})
