// Thin wrapper around the synthesis worklet. Nothing is sampled or downloaded.
export class Sound {
  constructor() { this.ctx = null; this.node = null; this.muted = false; this.ready = false; }
  async start() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule('js/engine-worklet.js');
      this.node = new AudioWorkletNode(this.ctx, 'flight-sound', { numberOfInputs: 0, outputChannelCount: [2] });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.node.connect(this.gain).connect(this.ctx.destination);
      this.ready = true;
    } catch (err) { console.warn('audio unavailable', err); }
  }
  setLevel(v) { if (this.ready) this.gain.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.15); }
  update(params) { if (this.ready) this.node.port.postMessage(params); }
  touch(strength) { if (this.ready) this.node.port.postMessage({ touch: strength }); }
}
