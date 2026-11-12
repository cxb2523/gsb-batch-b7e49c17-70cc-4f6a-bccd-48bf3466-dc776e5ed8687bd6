import { defaults, directiveRegex, idPrefix, spaceDelimiter, specialSymbol } from "@/constants";
import { composeProps, createElementWithProps } from "@/lib/dom";
import { addToQueue, clearQueue, clearQueueHook, clearQueueUnload, dequeue, queueHead, queueIndex, removeFromQueue, speakFromQueue, subscribe } from "@/lib/queue";
import { findCharIndex, getIndex, indexText, isParent, isSetStateFunction, nodeToKey, nodeToWords, parent, stripDirectives, toText } from "@/lib/react";
import { getProgress, isMobile, parse, sanitize, shouldHighlightNextPart, splitNode, textToChunks } from "@/lib/utils";
import type {
  DivProps,
  NodeProps,
  QueueChangeEventHandler,
  SpeakingWord,
  SpeakProps,
  SpeechStatus,
  SpeechSynthesisBoundaryEventHandler,
  SpeechSynthesisErrorHandler,
  SpeechSynthesisEventHandler,
  SpeechSynthesisEventName,
  SpeechSynthesisUtteranceProps,
  SpeechUtterancesQueue,
  UpdateMode,
  UseSpeakOptions,
  UseSpeechOptions,
  UseSpeechOptionsInternal,
} from "@/types";
import { cloneElement, forwardRef, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

type PlaybackEvents = {
  onError?: SpeechSynthesisErrorHandler;
  onStart?: SpeechSynthesisEventHandler;
  onResume?: SpeechSynthesisEventHandler;
  onPause?: SpeechSynthesisEventHandler;
  onStop?: SpeechSynthesisEventHandler;
  onBoundary?: SpeechSynthesisBoundaryEventHandler;
  onQueueChange?: QueueChangeEventHandler;
};

/**
 * Per-instance playback state.
 *
 * Everything the Web Speech API needs to continue speaking (chunk position, character offsets,
 * pending delays, cancel notifications) lives here instead of in module-level state, so that
 * several speech instances can coexist without interfering with each other.
 */
type PlaybackRuntime = {
  /** Whether this instance currently owns its queue item and may react to utterance events. */
  live: boolean;
  phase: "idle" | "queued" | "speaking" | "paused";
  /** Whether `onStart` has already fired for this playback run. */
  startedOnce: boolean;
  /** Whether the `beforeunload` listener is attached for this playback run. */
  listenerAttached: boolean;
  /** Index, within `chunks`, of the chunk currently loaded into the utterance. */
  chunkIndex: number;
  /** Position, within `speechText`, of the first character of `utterance.text`. */
  offset: number;
  /** Start index, within `utterance.text`, of the last boundary event. */
  boundaryCharIndex: number;
  specialSymbolOffset: number;
  /** Highest progress reported so far; progress is never allowed to move backwards. */
  maxProgress: number;
  /** Paused while waiting for a pending next chunk (during a directive delay) to be spoken. */
  pausePending: boolean;
  /** Pending delay (from a `[[delay]]` directive) before the next chunk is spoken. */
  delayTimer?: ReturnType<typeof setTimeout>;
  /** Cancel-induced `end`/`error` events that still need to be ignored. */
  pendingCancelEvents: number;
};

const createPlaybackRuntime = (): PlaybackRuntime => ({
  live: false,
  phase: "idle",
  startedOnce: false,
  listenerAttached: false,
  chunkIndex: 0,
  offset: 0,
  boundaryCharIndex: 0,
  specialSymbolOffset: 0,
  maxProgress: 0,
  pausePending: false,
  pendingCancelEvents: 0,
});

/** Result of loading a chunk: the delay that must elapse before it is spoken, if any. */
type LoadedChunk = { delay: number };

function useStableValue<T>(value: T, mode: UpdateMode, delay: number) {
  const [stableValue, setStableValue] = useState(value);
  const lastUpdated = useRef(0);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    if (mode === "immediate" || delay <= 0) timeout = setTimeout(() => setStableValue(value), 0);
    else if (mode === "debounce") timeout = setTimeout(() => setStableValue(value), delay);
    else if (mode === "throttle") {
      const now = Date.now();
      const elapsed = now - lastUpdated.current;
      timeout = setTimeout(
        () => {
          setStableValue(value);
          lastUpdated.current = Date.now();
        },
        Math.max(0, delay - elapsed),
      );
    }

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [value, mode, delay]);

  return stableValue;
}

export function useQueue() {
  const [queue, setQueue] = useState<SpeechUtterancesQueue>([]);

  useEffect(() => subscribe(setQueue), []);

  return { queue, dequeue, clearQueue: clearQueueHook };
}

export function useSpeak(options?: UseSpeakOptions) {
  const [speechProps, setSpeechProps] = useState<SpeakProps>({ text: "" });
  const { start, ...speechInterface } = useSpeech({ ...speechProps, ...options, stableText: true, autoPlay: false });

  const speak = useCallback((text: ReactNode, options: SpeechSynthesisUtteranceProps = {}) => setSpeechProps({ text, ...options }), []);

  useEffect(() => {
    if (speechProps.text) start();
  }, [speechProps]);

  return { speak, start, ...speechInterface };
}

export function useSpeech(speechProps: UseSpeechOptions) {
  const { uniqueId, normalizedText, reactContent, ...speechInterface } = useSpeechInternal(speechProps);

  return speechInterface;
}

/** @internal */
export function useSpeechInternal({
  id,
  text,
  stableText = false,
  pitch = defaults.pitch,
  rate = defaults.rate,
  volume = defaults.volume,
  lang = defaults.lang,
  voiceURI = defaults.voice,
  autoPlay = false,
  preserveUtteranceQueue = false,
  highlightText = false,
  showOnlyHighlightedText = false,
  highlightMode = "word",
  highlightProps,
  highlightContainerProps,
  enableDirectives = false,
  updateMode = "immediate",
  updateDelay = 0,
  maxChunkSize,
  onError = console.error,
  onStart,
  onResume,
  onPause,
  onStop,
  onBoundary,
  onQueueChange,
}: UseSpeechOptionsInternal) {
  const [speechStatus, speechStatusRef, setSpeechStatus] = useStateRef<SpeechStatus>("stopped");
  const [speakingWord, speakingWordRef, setSpeakingWord] = useStateRef<SpeakingWord>(null);
  const { utteranceRef, updateProps } = useSpeechSynthesisUtterance();
  const highlightRef = useRef(false);
  const playbackRef = useRef<PlaybackRuntime | null>(null);
  if (!playbackRef.current) playbackRef.current = createPlaybackRuntime();
  const runtime = playbackRef.current;
  const paramsRef = useRef<SpeechSynthesisUtteranceProps>({ pitch, rate, volume, lang, voiceURI });
  const eventsRef = useRef<PlaybackEvents>({ onError, onStart, onResume, onPause, onStop, onBoundary, onQueueChange });

  paramsRef.current = { pitch, rate, volume, lang, voiceURI };
  eventsRef.current = { onError, onStart, onResume, onPause, onStop, onBoundary, onQueueChange };

  const uniqueId = useMemo(() => `${idPrefix}${id ?? crypto.randomUUID()}`, [id]);
  const key = useMemo(() => (stableText ? text : nodeToKey(text)), [text, stableText]);
  const stableKey = useStableValue(key, updateMode, updateDelay);
  const stringifiedVoices = useMemo(() => voiceURI.toString(), [voiceURI]);
  const normalizedText = useMemo(() => (isValidElement(text) ? [text] : text), [stableKey]);
  const { indexedText, sanitizedText, speechText, words } = useMemo(() => {
    const strippedText = enableDirectives ? stripDirectives(normalizedText) : normalizedText;
    const words = nodeToWords(strippedText);
    const sanitizedText = `${spaceDelimiter}${sanitize(toText(enableDirectives ? normalizedText : words))}`;
    const speechText = (stripDirectives(sanitizedText) as string).trimStart();
    return { indexedText: indexText(strippedText, uniqueId), sanitizedText, speechText, words };
  }, [enableDirectives, normalizedText]);
  const chunks = useMemo(() => textToChunks(sanitizedText, maxChunkSize, enableDirectives), [enableDirectives, maxChunkSize, sanitizedText]);
  /**
   * Position, within `speechText`, of the first character spoken for every chunk.
   *
   * `speechText` is the sanitized text with directives stripped and its single leading space
   * removed, so the running total walks the same stripped characters. Directive chunks
   * contribute no characters, which keeps later offsets exact.
   */
  const chunkStarts = useMemo(() => {
    const starts: number[] = [];
    let position = 0;
    for (const chunk of chunks) {
      const spokenChunk = enableDirectives ? (stripDirectives(chunk) as string) : chunk;
      starts.push(Math.max(0, position + (spokenChunk.length - spokenChunk.trimStart().length) - spaceDelimiter.length));
      position += spokenChunk.length;
    }
    return starts;
  }, [chunks, enableDirectives]);

  const reactContent = useMemo(() => (showOnlyHighlightedText ? highlightedText(indexedText) : indexedText), [speakingWord, showOnlyHighlightedText, highlightMode, indexedText]);
  const Text = useCallback(
    forwardRef<HTMLDivElement, DivProps>((props, ref) => (
      <div ref={ref} {...composeProps(uniqueId, props)}>
        {reactContent}
      </div>
    )),
    [reactContent],
  );

  function reportProgress(progress: number, force = false) {
    const bounded = Math.max(0, Math.min(100, progress));
    if (!force && bounded < runtime.maxProgress) return;
    runtime.maxProgress = Math.max(runtime.maxProgress, bounded);
    eventsRef.current.onBoundary?.({ progress: runtime.maxProgress });
  }

  function clearDelay() {
    if (!runtime.delayTimer) return;
    clearTimeout(runtime.delayTimer);
    runtime.delayTimer = undefined;
  }

  function detachUtteranceHandlers() {
    const utterance = utteranceRef.current;
    if (!utterance) return;
    utterance.onstart = null;
    utterance.onend = null;
    utterance.onerror = null;
    utterance.onboundary = null;
  }

  function detachUnloadListener() {
    if (!runtime.listenerAttached) return;
    window.removeEventListener("beforeunload", clearQueueUnload);
    runtime.listenerAttached = false;
  }

  /** Applies the current playback parameters, optionally overridden by directives, to the utterance. */
  function applyParams(overrides: SpeechSynthesisUtteranceProps = {}) {
    updateProps({ ...paramsRef.current, ...overrides });
  }

  /**
   * Makes this instance inert: it stops reacting to utterance events and drops any pending work.
   * Called when the instance is stopped, superseded, or removed from the queue by someone else.
   */
  function invalidate() {
    runtime.live = false;
    runtime.phase = "idle";
    runtime.pausePending = false;
    clearDelay();
  }

  function resetRuntime() {
    invalidate();
    runtime.startedOnce = false;
    runtime.chunkIndex = 0;
    runtime.offset = 0;
    runtime.boundaryCharIndex = 0;
    runtime.specialSymbolOffset = 0;
    runtime.maxProgress = 0;
    runtime.pendingCancelEvents = 0;
    detachUnloadListener();
    detachUtteranceHandlers();
  }

  /**
   * Loads the next speakable chunk, starting at `index`, into the utterance.
   *
   * Leading directive chunks are consumed here: parameter directives update the given `params`,
   * `[[skip]]` directives skip subsequent chunks. Returns `null` when no chunk is left to speak.
   */
  function loadChunk(index: number, params: SpeechSynthesisUtteranceProps = {}): LoadedChunk | null {
    let delay = 0;
    if (enableDirectives) {
      let skip = false;
      while (index < chunks.length) {
        const currentText = chunks[index] ?? "";
        const match = directiveRegex.exec(currentText);
        if (!match) {
          if (!skip) break;
          index++;
          continue;
        }
        const directive = match[1];
        const value = parse(match[2] ?? "");
        switch (directive) {
          case "delay":
            delay += value as number;
            break;
          case "pitch":
          case "rate":
          case "volume":
          case "lang":
          case "voice":
            params[directive === "voice" ? "voiceURI" : directive] = value === "default" ? defaults[directive] : (value as never);
            break;
          case "skip":
            if (typeof value === "boolean") skip = value;
            break;
        }
        index++;
      }
    }

    const utterance = utteranceRef.current;
    if (index >= chunks.length || !utterance) return null;
    runtime.chunkIndex = index;
    const rawText = chunks[index] ?? "";
    const text = rawText.trimStart();
    utterance.text = text;
    runtime.offset = (chunkStarts[index] ?? 0) + (rawText.length - text.length);
    runtime.boundaryCharIndex = 0;
    runtime.specialSymbolOffset = 0;
    applyParams(params);
    return { delay };
  }

  function attachUtteranceHandlers() {
    const utterance = utteranceRef.current;
    if (!utterance) return;
    utterance.onstart = handleStart;
    utterance.onend = handleEnd;
    utterance.onerror = handleEnd;
    utterance.onboundary = handleBoundary;
  }

  function handleStart() {
    if (!runtime.live) return;
    if (!runtime.listenerAttached) {
      window.addEventListener("beforeunload", clearQueueUnload);
      runtime.listenerAttached = true;
    }
    highlightRef.current = true;
    runtime.phase = "speaking";
    runtime.pausePending = false;
    if (speechStatusRef.current !== "started") setSpeechStatus("started");
    reportProgress(getProgress(runtime.offset, speechText.length));
    if (runtime.startedOnce) return;
    runtime.startedOnce = true;
    eventsRef.current.onStart?.();
  }

  function handleEnd() {
    if (!runtime.live) return;
    // Events produced by our own `cancel()` calls must not be mistaken for the natural end of a chunk.
    if (runtime.pendingCancelEvents > 0) {
      runtime.pendingCancelEvents--;
      return;
    }
    advanceChunk();
  }

  function handleBoundary(event: SpeechSynthesisEvent) {
    if (!runtime.live) return;
    const utterance = utteranceRef.current;
    if (!utterance) return;
    const { charIndex, charLength, name } = event as SpeechSynthesisEvent & { name: SpeechSynthesisEventName };
    if (name === "word") {
      const isSpecialSymbol = +(utterance.text[charIndex + charLength] === specialSymbol);
      const index = findCharIndex(words, runtime.offset + runtime.specialSymbolOffset + charIndex - isSpecialSymbol);
      if (shouldHighlightNextPart(highlightMode, utterance, charIndex) || parent(index) !== parent(speakingWordRef.current?.index))
        setSpeakingWord({ index, charIndex: isSpecialSymbol ? charIndex + charLength + 1 : charIndex, length: isSpecialSymbol || charLength });
      if (isSpecialSymbol) runtime.specialSymbolOffset -= charLength + 1;
    }
    runtime.boundaryCharIndex = charIndex;
    reportProgress(getProgress(runtime.offset + charIndex + charLength, speechText.length));
  }

  function speakCurrent() {
    if (!runtime.live) return;
    runtime.phase = "speaking";
    speakFromQueue();
  }

  /**
   * Called when the current chunk has finished. Loads the next chunk and either speaks it right
   * away or schedules it after the directive delay; when there are no chunks left, playback
   * completes.
   */
  function advanceChunk() {
    const nextIndex = runtime.chunkIndex + 1;
    if (nextIndex < chunks.length) {
      const loaded = loadChunk(nextIndex);
      if (loaded) {
        if (runtime.phase === "paused") {
          runtime.pausePending = true;
          return;
        }
        if (loaded.delay > 0) {
          clearDelay();
          runtime.delayTimer = setTimeout(() => {
            runtime.delayTimer = undefined;
            if (!runtime.live || runtime.phase !== "speaking" || runtime.pausePending) return;
            speakCurrent();
          }, loaded.delay);
          return;
        }
        return speakCurrent();
      }
    }
    finishPlayback({ completed: true });
  }

  /**
   * Detaches this instance from playback and from the queue.
   *
   * Synthesis is only cancelled when this instance was the one speaking, so stopping a waiting
   * or already-stopped instance can never disturb another instance that owns the synthesiser.
   */
  function finishPlayback({ completed }: { completed: boolean }) {
    const utterance = utteranceRef.current;
    const wasLive = runtime.live;
    const wasSpeaking = wasLive && runtime.phase !== "queued";
    clearDelay();
    detachUnloadListener();
    detachUtteranceHandlers();
    runtime.live = false;
    runtime.phase = "idle";
    runtime.pausePending = false;
    if (completed) reportProgress(100, true);
    setSpeakingWord(null);
    highlightRef.current = false;
    if (wasLive && utterance) removeFromQueue(utterance, eventsRef.current.onQueueChange);
    setSpeechStatus("stopped");
    if (wasSpeaking) window.speechSynthesis?.cancel();
    // Only hand over to the next queued item when this instance actually owned playback.
    if (wasSpeaking || (!wasLive && queueHead())) speakFromQueue();
    if (wasSpeaking) eventsRef.current.onStop?.();
  }

  function start() {
    const synth = window.speechSynthesis;
    if (!synth) return eventsRef.current.onError?.(new Error("Browser not supported! Try some other browser."));
    // Resuming a paused instance continues from where it paused; it is never requeued or restarted.
    if (runtime.phase === "paused") return resume();
    if (runtime.phase === "queued") return;
    if (runtime.live) return;

    resetRuntime();
    runtime.live = true;
    runtime.phase = "queued";
    if (!loadChunk(0)) {
      runtime.live = false;
      runtime.phase = "idle";
      return setSpeechStatus("stopped");
    }
    attachUtteranceHandlers();

    // `preserveUtteranceQueue` decides whether existing utterances are kept. When they are
    // cleared, their owning instances are invalidated before anything is cancelled.
    if (!preserveUtteranceQueue) clearQueue();
    const utterance = utteranceRef.current!;
    const item = addToQueue({ text: speechText, utterance, setSpeechStatus, onRemove: invalidate }, eventsRef.current.onQueueChange);
    const index = queueIndex(item);

    if (index > 0) {
      setSpeechStatus("queued");
      return;
    }

    setSpeechStatus("started");
    runtime.phase = "speaking";
    if (synth.speaking || synth.paused || synth.pending) synth.cancel();
    speakFromQueue();
  }

  function pause() {
    if (!runtime.live) return;
    if (isMobile(false) || runtime.phase === "queued") return stop();
    if (runtime.phase !== "speaking") return;
    runtime.phase = "paused";
    if (runtime.delayTimer) {
      // There is no active utterance to pause yet: freeze the pending chunk instead.
      clearDelay();
      runtime.pausePending = true;
    } else {
      window.speechSynthesis?.pause();
    }
    setSpeechStatus("paused");
    eventsRef.current.onPause?.();
  }

  function resume() {
    if (!runtime.live) return;
    runtime.phase = "speaking";
    if (runtime.pausePending) {
      // The next chunk was loaded while playback was frozen; speaking it resumes at the exact spot.
      runtime.pausePending = false;
      speakFromQueue();
    } else {
      window.speechSynthesis?.resume();
    }
    setSpeechStatus("started");
    eventsRef.current.onResume?.();
  }

  function stop() {
    if (!runtime.live) {
      if (speechStatusRef.current !== "stopped") setSpeechStatus("stopped");
      return;
    }
    finishPlayback({ completed: false });
  }

  /**
   * Continues from the current reading position after a playback parameter has changed.
   * Changing utterance properties has no effect on an utterance that is already speaking, so
   * the current chunk is cancelled and re-spoken from the last reported boundary.
   */
  function continueAfterChange() {
    const utterance = utteranceRef.current;
    if (!runtime.live || runtime.phase !== "speaking" || !utterance) return;
    const resumeFrom = Math.max(0, Math.min(runtime.boundaryCharIndex, utterance.text.length));
    const remaining = utterance.text.slice(resumeFrom).trimStart();
    if (!remaining) return advanceChunk();
    runtime.offset += utterance.text.length - remaining.length;
    utterance.text = remaining;
    runtime.boundaryCharIndex = 0;
    applyParams();
    runtime.pendingCancelEvents++;
    window.speechSynthesis?.cancel();
    speakFromQueue();
  }

  function highlightedText(node: ReactNode, index = ""): ReactNode {
    if (!highlightText || !isParent(index, speakingWord?.index)) return;
    switch (typeof node) {
      case "number":
        node = String(node);
      case "string":
        const highlighted = splitNode(highlightMode, node as string, speakingWord)[1];
        return (
          <span {...highlightContainerProps}>
            <mark {...highlightProps}>{highlighted}</mark>
          </span>
        );
    }
    if (Array.isArray(node)) return node.map((child, i) => highlightedText(child, getIndex(index, i)));
    if (isValidElement<NodeProps>(node)) return cloneElement(node, { children: highlightedText(node.props.children, index) });
  }

  useEffect(() => {
    return () => stop();
  }, [enableDirectives, key]);

  useLayoutEffect(() => {
    highlightRef.current = false;
    if (autoPlay) start();
  }, [autoPlay, enableDirectives, normalizedText]);

  useLayoutEffect(() => {
    if (!highlightText || !highlightRef.current || showOnlyHighlightedText || !speakingWord) return;

    const parts = speakingWord.index.split("-");
    const parentIndex = parts.slice(0, -1).join("-");

    const elements = Array.from(document.getElementsByClassName(`${uniqueId}${parentIndex}`));
    const elementSnapshots = elements.map((element) => {
      const originalTextContent = element.textContent;
      const [before, highlighted, after] = splitNode(highlightMode, element.textContent, speakingWord);

      const container = createElementWithProps("span", highlightContainerProps);
      const mark = createElementWithProps("mark", highlightProps);
      mark.textContent = highlighted;

      if (before) container.appendChild(document.createTextNode(before));
      container.appendChild(mark);
      if (after) container.appendChild(document.createTextNode(after));

      element.textContent = "";
      element.appendChild(container);

      return [element, originalTextContent] as const;
    });

    return () => {
      if (highlightRef.current) elementSnapshots.forEach(([element, originalTextContent]) => (element.textContent = originalTextContent));
    };
  }, [speakingWord, highlightText, showOnlyHighlightedText, highlightMode]);

  useEffect(() => {
    applyParams();
    if (!runtime.live || runtime.phase !== "speaking") return;
    const timeout = setTimeout(() => {
      if (runtime.live && runtime.phase === "speaking") continueAfterChange();
    }, 500);
    return () => clearTimeout(timeout);
  }, [pitch, rate, volume, lang, stringifiedVoices]);

  return {
    uniqueId,
    normalizedText,
    reactContent,
    Text,
    speechStatus,
    isInQueue: speechStatus === "started" || speechStatus === "queued",
    start,
    pause,
    stop,
  };
}

function useSpeechSynthesisUtterance() {
  const utteranceRef = useRef<SpeechSynthesisUtterance>(typeof window === "undefined" || !window.speechSynthesis ? null : new SpeechSynthesisUtterance());
  const { voices } = useVoices();

  function updateProps({ pitch, rate, volume, lang, voiceURI }: SpeechSynthesisUtteranceProps) {
    const utterance = utteranceRef.current;
    if (!utterance) return;
    if (pitch !== undefined) utterance.pitch = pitch;
    if (rate !== undefined) utterance.rate = rate;
    if (volume !== undefined) utterance.volume = volume;
    if (lang !== undefined) utterance.lang = lang;
    if (voiceURI === undefined) return;
    if (!voiceURI) {
      utterance.voice = null;
      return;
    }
    if (!Array.isArray(voiceURI)) voiceURI = [voiceURI];
    for (let i = 0; i < voiceURI.length; i++) {
      const uri = voiceURI[i];
      const voice = voices.find((voice) => voice.voiceURI === uri);
      if (voice) {
        utterance.voice = voice;
        if (!lang) utterance.lang = voice.lang;
        return;
      }
    }
  }

  return { utteranceRef, updateProps };
}

function useStateRef<T>(init: T) {
  const [state, setState] = useState(init);
  const ref = useRef(init);

  function setStateRef(value: T) {
    setState((prev) => {
      const next = isSetStateFunction(value) ? value(prev) : value;
      ref.current = next;
      return next;
    });
  }

  return [state, ref, setStateRef] as const;
}

export function useVoices() {
  const [languages, setLanguages] = useState<string[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  function setData(voices: SpeechSynthesisVoice[]) {
    setLanguages(Array.from(new Set(voices.map(({ lang }) => lang))));
    setVoices(voices);
  }

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const voices = synth.getVoices();
    if (voices.length) setData(voices);
    else {
      const onVoicesChanged = () => setData(synth.getVoices());
      synth.addEventListener("voiceschanged", onVoicesChanged);
      return () => synth.removeEventListener("voiceschanged", onVoicesChanged);
    }
  }, []);

  return { languages, voices };
}
