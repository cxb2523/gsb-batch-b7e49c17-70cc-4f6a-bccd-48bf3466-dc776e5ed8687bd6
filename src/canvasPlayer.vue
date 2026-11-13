<template>
  <div class="popup-layer">
    <div class="video-player-wrapper">
      <div id="VideoDom">
        <div id="canvasDom">
          <div v-show="showDom" id="progressBar" :class="[paused ? 'show' : '']">
            <div class="bar" @click="skipLine">
              <div
                ref="trunk"
                class="line"
                :class="['progress', paused ? 'pause' : 'play', !drag ? 'trans' : '']"
                :style="{ width: `${progressPercent()}%` }"
              ></div>
              <div id="circle" :class="{ trans: !drag }"></div>
            </div>

            <div class="left-box">
              <div href="#" class="btn">
                <button
                  class="play"
                  :class="[paused ? 'play' : 'pause']"
                  @click="changeVideoState"
                ></button>
              </div>
              <div class="total-time">{{ sToHs(playedTime) }} / {{ sToHs(totalTime) }}</div>
            </div>
            <div class="volume">
              <input type="checkbox" @click="changeVoiceStatus" />
              <svg viewBox="0 0 108 96">
                <path
                  d="M7,28 L35,28 L35,28 L59,8 L59,88 L35,68 L7,68 C4.790861,68 3,66.209139 3,64 L3,32 C3,29.790861 4.790861,28 7,28 Z"
                ></path>
                <path
                  d="M79,62 C83,57.3333333 85,52.6666667 85,48 C85,43.3333333 83,38.6666667 79,34 L49,3"
                ></path>
                <path
                  d="M95,69 C101.666667,61.6666667 105,54.3333333 105,47 C105,39.6666667 101.666667,32.3333333 95,25 L75.5,6 L49,33"
                ></path>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
    <i class="popup-layer-btn-close" @click="close">x</i>
    <div v-show="!showDom" class="loadEffect">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
    </div>
    <section v-show="paused" class="playContainer" @click="changeVideoState">
      <li class="playBtn">
        <a href="#" title="start">Start</a>
      </li>
    </section>
  </div>
</template>

<script setup>
import PlaybackSequence from './playbackSequence.js'
import { toSeconds, nextPlayableIndex } from './sequence.js'

export default {
  data() {
    return {
      list: [],
      // 解析后的片段起止点（保留该字段，兼容原有内部结构）
      playerlist: [],
      // new add ===
      playIndex: 0,
      RAFCancelReq: null,
      logo: '',
      videoList: [],
      // 当前播放对象
      videoObj: {},
      // 是否暂停
      paused: true,
      // 总时长
      totalTime: 0,
      // 当前播放时长
      playedTime: 0,
      endFlag: false,
      // 动态增减
      activeLength: 0,
      // 时间段节点记录,进度条快速定位
      skipDict: [],
      // 是否展示进度条
      showDom: false,
      // 是否已经绑定事件
      drag: 0,
    }
  },
  beforeDestroy() {
    this.setFree()
    console.log('desotory')
    document.removeEventListener('keydown', this.keydown)
    document.removeEventListener('mousemove', this.mouseover)
    document.removeEventListener('mouseup', this.mouseup)
    let canvasDom = document.querySelector('#AutoCanvasId')
    if (canvasDom) {
      canvasDom.removeEventListener('click', this.changeVideoState)
    }
  },
  mounted() {
    let _self = this
    this.init()
    _self.playerlist = _self.list.map((item) => {
      return {
        start: toSeconds(item.playPoint && item.playPoint.start),
        end: toSeconds(item.playPoint && item.playPoint.end),
      }
    })
    _self.videoList = _self.list
    _self.comTotalTime()
    document.addEventListener('keydown', _self.keydown)
    _self.$nextTick(() => {
      _self.gotoPlay()
    })
  },

  methods: {
    initDrop2() {
      let _self = this
      _self.drag = 0
      // 每次 seek 后都会重新进入，事件只绑定一次，避免重复触发跳转
      if (_self.dropBound) {
        return
      }
      _self.dropBound = true
      let dropBtn = document.querySelector('#circle')
      //进度按钮被点击
      dropBtn.addEventListener('mousedown', function() {
        _self.drag = 1
        if (_self.videoObj && _self.videoObj.played) {
          _self.videoObj.pause()
          _self.paused = true
        }
      })
      //页面被释放
      document.addEventListener('mouseup', _self.mouseup)
      // //拖动事件
      document.addEventListener('mousemove', _self.mouseover)
      // AutoCanvasId
      document.querySelector('#AutoCanvasId').addEventListener('click', _self.changeVideoState)
    },
    setValue(touch) {
      let _self = this
      let progress = document.querySelector('.bar')
      if (!progress || !_self.totalTime) {
        return
      }
      let rect = progress.getBoundingClientRect()
      let ratio = rect.width > 0 ? (touch.clientX - rect.left) / rect.width : 0
      //拖动边界检测
      if (ratio < 0) {
        ratio = 0
      } else if (ratio > 1) {
        ratio = 1
      }
      //拖动实时改变进度条（松手后按累计时长分段表定位片段）
      _self.playedTime = ratio * _self.totalTime
    },
    mouseup() {
      let _self = this
      if (_self.drag === 1) {
        this.skipProgress()
      }
      this.drag = 0
    },
    mouseover(e) {
      let _self = this
      if (_self.drag === 1) {
        _self.setValue(e)
      }
    },
    // 把序列状态同步回组件的展示字段
    applySequenceState(state) {
      this.playIndex = state.index
      this.playedTime = state.playedTime
      this.endFlag = state.atEnd
    },
    // 快进跳转：按累计时长分段表定位片段，并以片段内偏移为起点继续播放
    skipProgress() {
      let _self = this
      if (!_self.sequence) {
        return
      }
      let state = _self.sequence.seekToTime(_self.playedTime)
      _self.applySequenceState(state)
      if (state.atEnd) {
        // 落在总时长末端（或序列没有可播放片段）：按播放结束处理
        // 让旧视频的异步回调失效，避免已结束状态下进度继续被推进
        _self.playToken = (_self.playToken || 0) + 1
        if (_self.videoObj && _self.videoObj.pause) {
          _self.videoObj.pause()
        }
        _self.paused = true
        return
      }
      _self.endFlag = false
      _self.paused = false
      _self.VideoPlay(state.offset)
    },
    // 点击快进跳转
    skipLine(e) {
      let _self = this
      let progress = document.querySelector('.bar')
      if (!progress || !_self.totalTime) {
        return
      }
      let rect = progress.getBoundingClientRect()
      let ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0
      if (ratio < 0) {
        ratio = 0
      } else if (ratio > 1) {
        ratio = 1
      }
      _self.playedTime = ratio * _self.totalTime
      _self.skipProgress()
    },
    init() {
      this.RAF()
      this.playedTime = 0
    },
    resetVideo() {
      if (this.videoObj && !this.videoObj.paused) {
        this.videoObj.pause()
        this.paused = true
        if (this.sequence) {
          this.applySequenceState(this.sequence.reset())
        }
      }
    },
    RAF(cb) {
      if (typeof cb !== 'function') {
        return null
      }
      return window.requestAnimationFrame(() => {
        window.setTimeout(cb, 1000 / 60)
      })
    },
    // 启停 canvas 绘制循环：用当前视频的 onplay 启动，切换时由 VideoPlay 取消
    startDraw(cb) {
      this.stopDraw()
      this.RAFCancelReq = this.RAF(cb)
    },
    stopDraw() {
      if (this.RAFCancelReq) {
        window.cancelAnimationFrame(this.RAFCancelReq)
        this.RAFCancelReq = null
      }
      this.drawRunning = false
    },
    // 计算总时长，并按累计时长建立分段表（start / end 字符串按数值参与计算）
    comTotalTime() {
      this.sequence = new PlaybackSequence(this.videoList)
      this.totalTime = this.sequence.totalTime
      this.skipDict = this.sequence.skipDict
    },
    // 进度条百分比，总时长为 0 时返回 0，避免出现 NaN / 负值
    progressPercent() {
      if (!(this.totalTime > 0)) {
        return 0
      }
      let ratio = this.playedTime / this.totalTime
      if (ratio < 0) {
        ratio = 0
      } else if (ratio > 1) {
        ratio = 1
      }
      return ratio * 100
    },
    close() {
      let _self = this
      try {
        if (typeof _self.onClose === 'function') {
          _self.onClose(_self)
        }
        setTimeout(() => {
          _self.$destroy(true)
          _self.$el.parentNode.removeChild(_self.$el)
        }, 200)
      } catch (e) {
        console.log(e)
      }
    },
    keydown(e) {
      let _self = this
      if (e.keyCode === 27) {
        // esc关闭消息
        _self.close()
      }
    },
    // add 播放器核心方法
    async gotoPlay() {
      let _self = this
      _self.endFlag = false
      _self.paused = false
      let state = _self.sequence ? _self.sequence.startAt(0, 0) : { index: 0, playedTime: 0, atEnd: true }
      _self.applySequenceState(state)
      if (state.atEnd) {
        // 序列里没有可播放片段
        _self.paused = true
        return
      }
      _self.VideoPlay()
    },
    // 截获当前视频播放器
    updateCurrentVideo(videoObj) {
      this.videoObj = videoObj
    },
    // 播放 || 暂停
    changeVideoState() {
      if (this.endFlag || (this.videoObj && this.videoObj.paused)) {
        if (this.endFlag) {
          // 结束后再次点击：从头播放
          this.gotoPlay()
          return
        }
        this.videoObj.play()
        this.paused = false
      } else if (this.videoObj && !this.videoObj.paused) {
        this.videoObj.pause()
        this.paused = true
      }
    },
    // 静音
    changeVoiceStatus() {
      if (this.videoObj) {
        this.videoObj.muted = !this.videoObj.muted
      }
    },
    // 核心启动逻辑
    async VideoPlay(shortSliceTime = 0) {
      let _self = this
      let segment = _self.sequence && _self.sequence.currentSegment
      if (!segment || !_self.videoList[segment.index]) {
        return
      }
      // 播放过程中视频被切走 / 跳转时，忽略旧视频的异步回调
      let token = (_self.playToken = (_self.playToken || 0) + 1)
      let isStale = function() {
        return token !== _self.playToken
      }
      // 旧视频的绘制循环到此作废，新片段由自己的 onplay 重新启动
      _self.stopDraw()
      // console.log("_self.playIndex: " + _self.playIndex);
      // 准备工作start
      let elDom = document.querySelector('#VideoDom')
      let canvasDom = document.querySelector('#canvasDom')
      // 一、解析当前视频的各个参数 视频信息：1.当前播放路径、2.播放开始时间、3.播放结束时间、4.下部视频下标
      let currentVideo = _self.videoList[segment.index]
      if (!currentVideo) {
        return
      }
      let currentUrl = currentVideo.url
      // start / end 字符串按数值处理；shortSliceTime 是片段内偏移
      let currentStartTime = segment.start + Math.max(parseFloat(shortSliceTime) || 0, 0)
      let currentEndTime = segment.end
      if (currentStartTime > currentEndTime) {
        currentStartTime = currentEndTime
      }
      if (currentStartTime < 0) {
        currentStartTime = 0
      }
      if (currentStartTime >= currentEndTime) {
        // 片段内已无可播内容（跳到片段末尾）：直接按分段表推进，不创建视频
        _self.sequence.setOffset(segment.duration)
        _self.playedTime = _self.sequence.playedTime
        _self.playNext(null, token)
        return
      }
      // logo信息
      let currentLogoInfo = {
        logo: _self.logo,
        position: (currentVideo && currentVideo.logoPosition) || { x: 'left', y: 'top' },
        videoWidth: currentVideo && currentVideo.width,
      }
      // 二、是否有下一视频（0 时长片段不预加载，沿用后一个可播放片段）
      let nextIndex = _self.sequence
        ? nextPlayableIndex(_self.sequence.timeline, segment.index + 1)
        : segment.index + 1
      if (nextIndex >= _self.videoList.length || !_self.videoList[nextIndex]) {
        // 如果没有  则沿用当前视频
        nextIndex = segment.index
      }
      // 如果有  则配置下一视频的基本信息 视频信息：1.当前播放路径、2.播放开始时间
      let nextVideo = _self.videoList[nextIndex] || {}
      let nextVideoUrl = nextVideo.url || currentUrl
      let nextStartTime = toSeconds(nextVideo.playPoint && nextVideo.playPoint.start)
      //下一视频 配置end
      // 创建两部视频的Dom节点
      let videoObj = await _self.createVideo(elDom, 'AutoVideoId')
      let nextVideoObj = await _self.createVideo(elDom, 'preLoadVideoId', true)
      // 创建canvas的Dom节点
      let CanvasEle = await _self.createCanvas(canvasDom, 'AutoCanvasId') //document.getElementById('AutoCanvasId')
      let context = CanvasEle.getContext('2d')
      if (isStale()) {
        return
      }

      videoObj.src = currentUrl
      // 更新视频对象
      _self.updateCurrentVideo(videoObj)
      // 记录本片段的起点，timeupdate 用它算出片段内偏移
      _self.segmentStartTime = currentStartTime
      // 定位完成后开始播放（seek 落地时由 onseeked 调用；
      // 目标位置与当前位置相同、不会触发 seeked 时直接调用）
      let beginPlaying = function() {
        if (isStale()) {
          return
        }
        _self.seekPending = false
        _self.paused = false
        _self.videoObj.volume = 1
        let playPromise = _self.videoObj.play()

        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              if (isStale()) {
                return
              }
              _self.initDrop2()
              _self.videoObj.play()
            })
            .catch((error) => {
              console.log('sorry! 视频初始化失败', error)
            })
        }
      }

      // 定位到「片段 start + 片段内偏移」。
      // 同一 url 重复跳转时 durationchange 不一定再触发，因此 metadata 就绪后主动定位一次。
      // seek 落地前忽略 timeupdate，避免旧位置的时间把进度推过目标。
      let seekToStart = function() {
        if (isStale()) {
          return
        }
        _self.seekPending = true
        videoObj.currentTime = currentStartTime
        if (!videoObj.seeking) {
          // 目标位置与当前位置相同（如从暂停处继续播放）时不会再触发 seeked
          beginPlaying()
        }
      }
      _self.seekPending = true
      //视频源改变时，指定开始播放时间
      videoObj.ondurationchange = seekToStart
      videoObj.onloadedmetadata = seekToStart
      if (videoObj.readyState >= 1) {
        // 已有 metadata（同一 url 内的跳转），立即定位
        seekToStart()
      } else {
        // 首次加载：metadata 就绪后由 loadedmetadata 定位
        _self.seekPending = true
      }
      //重新定位播放位置
      videoObj.onseeked = beginPlaying
      //播放位置改变：已播时长 = 前面各片段时长之和 + 当前片段内已播时长
      videoObj.ontimeupdate = function() {
        if (isStale() || _self.seekPending || !_self.sequence) {
          return
        }
        let state = _self.sequence.syncFromVideo(videoObj.currentTime)
        _self.playedTime = state.playedTime
        if (state.reachedEnd) {
          // 播到片段末尾时把片段内已播时长对齐到片段时长，
          // 保证切换瞬间的进度等于前面各片段时长之和，不会因采样误差跳变或倒退
          _self.sequence.setOffset(segment.duration)
          _self.playedTime = _self.sequence.playedTime
          _self.playNext(videoObj, token)
        }
      }

      //开始播放
      videoObj.onplay = function() {
        // console.log("onplay");
        // console.log("开始播放：", _self.videoObj.paused);
        CanvasEle.width = videoObj.width
        CanvasEle.height = videoObj.height
        // 每次播放都重启绘制循环；暂停后恢复由同一循环继续
        if (!_self.drawRunning) {
          _self.startDraw(drawData)
        }
        // 创建logo
        _self.createAndPutLogo(canvasDom, 'logoId', currentLogoInfo)
        // 展示进度条
        _self.showDom = true
      }

      // 预加载下一个可播放片段的开头
      nextVideoObj.src = nextVideoUrl
      //视频源改变时，指定开始播放时间
      nextVideoObj.ondurationchange = function() {
        // console.log("ondurationchange");
        nextVideoObj.currentTime = nextStartTime
      }

      function drawData() {
        // 已切到别的片段 / 已跳转，旧视频的绘制循环直接退出
        if (isStale()) {
          _self.drawRunning = false
          return
        }
        if (videoObj.ended) {
          // 视频源提前播完，按分段表推进到下一片段
          _self.stopDraw()
          _self.playNext(videoObj, token)
          return
        }
        if (videoObj.paused) {
          _self.drawRunning = false
          return
        }
        if (videoObj.currentTime >= currentEndTime) {
          // 片段播到配置的 end：对齐片段内进度后推进到下一片段
          _self.stopDraw()
          _self.sequence.setOffset(segment.duration)
          _self.playedTime = _self.sequence.playedTime
          _self.playNext(videoObj, token)
          return
        }
        if (videoObj.currentTime >= currentStartTime) {
          context.drawImage(videoObj, 0, 0, videoObj.width, videoObj.height)
        }
        _self.drawRunning = true
        _self.RAFCancelReq = _self.RAF(drawData)
      }
    },
    // 创建并摆放logo
    createAndPutLogo(parentDom, domId, logoInfo) {
      this.$nextTick(() => {
        let canvasDom = document.querySelector('#AutoCanvasId')
        parentDom = parentDom || document.body
        let obj = document.getElementById(domId)
        if (!obj) {
          obj = document.createElement('img')
          obj.id = domId
          parentDom.appendChild(obj)
        }
        obj.style = {}
        obj.style.display = 'none'
        obj.style.width = `${(canvasDom.width * 150) / 1080}px`
        obj.style.position = 'absolute'
        obj.style[logoInfo.position.x] = `${(canvasDom.width / 1080) * 60}px`
        obj.style[logoInfo.position.y] = `${(canvasDom.width / 1080) * 60}px`
        obj.src = logoInfo.logo
        this.$nextTick(() => {
          obj.style.display = 'block'
        }, 10000)
      })
    },
    //根据父容器大小设置视频尺寸
    setVideoStyle(vObj) {
      let parentWidth = vObj.parentNode.getBoundingClientRect().width
      let parentHeight = vObj.parentNode.getBoundingClientRect().height
      //根据父容器宽高计算 视频缩放比例
      let scaleVal = Math.max(vObj.videoWidth / parentWidth, vObj.videoHeight / parentHeight)
      let scaleWidth = vObj.videoWidth / scaleVal
      let scaleHeight = vObj.videoHeight / scaleVal
      vObj.width = scaleWidth
      vObj.height = scaleHeight
    },

    //创建视频对象
    createVideo(parentDom, domId, isMuted = false) {
      let _self = this
      if (!domId) {
        console.warn('缺少命名ID')
        return
      }
      parentDom = parentDom || document.body
      let obj = document.getElementById(domId)
      if (!obj) {
        obj = document.createElement('Video')
        obj.id = domId
        parentDom.appendChild(obj)
        let videoSize = parseInt(document.getElementsByTagName('video').length)
        //设置视频属性
        obj.preload = 'auto'
        obj.style = 'background:#000000;display:none;position:absolute;left:100%;top:0;'
        obj.autoplay = ''
        obj.style.left = videoSize * 100 + '%'
        obj.controls = true
        obj.muted = isMuted
        obj.volume = 0.1
        //视频加载meta信息后，把自身尺寸修改了
        // 用 addEventListener 绑定，避免被 VideoPlay 里的 onloadedmetadata 覆盖
        obj.addEventListener('loadedmetadata', function() {
          // console.log('onloadedmetadata')
          _self.setVideoStyle(obj)
        })
      }
      return obj
    },
    //创建 Canvas对象
    createCanvas(parentDom, domId) {
      if (!domId) {
        console.warn('缺少命名ID')
        return
      }
      parentDom = parentDom || document.body
      let Obj = document.getElementById(domId)
      if (!Obj) {
        Obj = document.createElement('Canvas')
        Obj.id = domId
        parentDom.appendChild(Obj)
      }
      return Obj
    },

    // 播放下一曲：当前片段播完后推进到下一个可播放片段
    // 同一个片段只推进一次（ontimeupdate 与绘制循环可能同时触发）
    playNext(curVideo, token) {
      let _self = this
      if (token !== undefined && token !== _self.playToken) {
        return
      }
      // 立即让当前视频的后续回调失效，避免重复推进
      _self.playToken = (_self.playToken || 0) + 1
      if (curVideo && curVideo.pause) {
        curVideo.pause()
      }
      let state = _self.sequence ? _self.sequence.advance() : { index: 0, playedTime: 0, atEnd: true }
      _self.applySequenceState(state)
      if (state.atEnd) {
        // 整条序列播放完毕
        _self.paused = true
        _self.endFlag = true
        return
      }
      _self.VideoPlay()
    },
    sToHs(s) {
      //计算分钟
      //算法：将秒数除以60，然后下舍入，既得到分钟数
      s = parseFloat(s).toFixed(0)
      var h
      h = Math.floor(s / 60)
      //计算秒
      //算法：取得秒%60的余数，既得到秒数
      s = s % 60
      //将变量转换为字符串
      h += ''
      s += ''
      //如果只有一位数，前面增加一个0
      h = h.length == 1 ? '0' + h : h
      s = s.length == 1 ? '0' + s : s
      return h + ':' + s
    },
  },
}
</script>
<style>
@import './style/style.css';
</style>
<style lang="less" scoped>
.popup-layer {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.85);
  color: #fff;

  .video-player-wrapper {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .popup-layer-btn-close {
    position: absolute;
    right: 20px;
    top: 20px;
    width: 50px;
    color: rgba(255, 255, 255, 0.8);
    text-align: center;
    font-style: initial;
    font-size: 40px;
    line-height: 30px;
    cursor: pointer;
    padding: 6px 0 12px;
    border-radius: 100%;
    user-select: none;
    &:hover {
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 1);
    }
  }
}

#VideoDom {
  position: relative;
  font-size: 0;
  line-height: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  #canvasDom {
    position: relative;
    #progressBar {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      bottom: 0;
      width: 100%;
      background: rgba(0, 0, 0, 0.521);
      z-index: 99;
      opacity: 0;
      transition: all 0.5s;
      .left-box {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        width: 50%;
        .btn {
          height: 100%;
          color: #000;
          margin-right: 2px;
          background: transparent;
          border: none;
          button {
            margin: 10px;
            padding: 0;
            box-sizing: border-box;
            border: transparent;
            background: transparent;
            user-select: none;
            &.play {
              height: 20px;
              border-style: solid;
              outline: none;
              border-width: 10px 0 10px 18px;
              border-color: transparent transparent transparent #00a1d6;
              transition: all 0.1s linear;
            }
            &.pause {
              border-style: double;
              border-width: 0px 0px 0px 18px;
              border-color: #00a1d6;
            }
          }
        }
        .total-time {
          color: #e3e3e3;
          font-size: 15px;
          line-height: 100%;
          pointer-events: none;
          user-select: none;
        }
      }

      .bar {
        display: flex;
        align-items: center;
        margin: 10px auto 0;
        width: 98%;
        height: 7px;
        border-radius: 10px;
        background: #7171716e;
        transition: all 0.2s;
        cursor: pointer;
        .line {
          position: relative;
          width: 100%;
          height: 100%;
          background: #00a1d6;
          border-radius: 5px;
          animation-timing-function: linear;
          &.trans {
            transition: all 0.5s;
          }
          &.play {
            animation-play-state: running;
          }
          &.pause {
            animation-play-state: paused;
          }
        }
        #circle {
          position: relative;
          margin-left: -4px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #fff;
          pointer-events: none;
          &.trans {
            pointer-events: auto;
            transition: all 0.5s;
          }
        }
      }

      &:hover {
        .bar {
          height: 13px;
          transition: all 0.2s;
          #circle {
            height: 14px;
            width: 14px;
          }
        }
      }
      &.show {
        opacity: 1;
      }
    }
    &:hover {
      #progressBar {
        opacity: 1;
        transition: all 1s;
      }
    }
  }
}
</style>
