import { cancel } from "@/lib/utils";
import type { CleanupHandler, QueueChangeEventHandler, SpeechQueue, SpeechQueueItem } from "@/types";

const queue: SpeechQueue = [];

const queueListeners: QueueChangeEventHandler[] = [];

/** Adds an item to the queue and returns the item, which can be used to identify it later. */
export function addToQueue(item: SpeechQueueItem, callback?: QueueChangeEventHandler): SpeechQueueItem {
  queue.push(item);
  emit(callback);
  return item;
}

/** Index of a queued item, or `-1` when it is no longer in the queue. */
export function queueIndex(item: SpeechQueueItem): number {
  return queue.indexOf(item);
}

/** The item currently owning speech, if any. */
export function queueHead(): SpeechQueueItem | undefined {
  return queue[0];
}

/**
 * Removes queued items, starting at `start`, and reports each one as stopped.
 * Items are invalidated before synthesis is cancelled so their owning instances stop reacting
 * to the cancellation events the browser emits.
 */
export function clearQueue(cancelSpeech = false, start = 0, emitEvent = false) {
  const removed = queue.splice(start);
  removed.forEach((item) => {
    item.onRemove?.();
    item.setSpeechStatus("stopped");
  });
  if (cancelSpeech) cancel();
  if (emitEvent) emit();
}

export const clearQueueHook = () => clearQueue(true, 0, true);

export const clearQueueUnload = () => clearQueue(true, 0);

export function dequeue(index: number = 0) {
  const wasHead = index === 0;
  removeFromQueue(index);
  if (wasHead) {
    cancel();
    speakFromQueue();
  }
}

export function emit(callback?: QueueChangeEventHandler) {
  const utteranceQueue = queue.map(({ text, utterance: { pitch, rate, volume, lang, voice } }) => ({ text, pitch, rate, volume, lang, voice }));
  queueListeners.forEach((listener) => listener(utteranceQueue));
  callback?.(utteranceQueue);
}

/**
 * Removes a single item from the queue and reports it as stopped.
 *
 * This is a pure queue operation: it never cancels synthesis. Removing the item that is
 * currently speaking is what naturally happens when a speech instance finishes; handing
 * playback to the next item is done by the caller via {@link speakFromQueue}.
 */
export function removeFromQueue(item: SpeechQueueItem | number, callback?: QueueChangeEventHandler): number {
  const index = typeof item === "number" ? item : queueIndex(item);
  if (index === -1 || index >= queue.length) return -1;
  const [removed] = queue.splice(index, 1);
  if (!removed) return -1;
  removed.onRemove?.();
  removed.setSpeechStatus("stopped");
  emit(callback);
  return index;
}

/** Speaks the utterance at the head of the queue, if there is one. */
export function speakFromQueue() {
  const item = queue[0];
  if (item) window.speechSynthesis?.speak(item.utterance);
}

export function subscribe(callback: QueueChangeEventHandler): CleanupHandler {
  queueListeners.push(callback);
  return () => {
    const index = queueListeners.indexOf(callback);
    if (index !== -1) queueListeners.splice(index, 1);
  };
}
