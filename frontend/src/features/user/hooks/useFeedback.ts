import { useCallback, useEffect, useRef, useState } from 'react';

export interface Feedback {
  tone: 'success' | 'error';
  message: string;
}

const SUCCESS_VISIBLE_MS = 5000;

/** Inline success/error message for one form. Successes fade after a few seconds; errors stay. */
export function useFeedback() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setFeedback(null);
  }, []);

  const showError = useCallback((message: string) => {
    clearTimeout(timer.current);
    setFeedback({ tone: 'error', message });
  }, []);

  const showSuccess = useCallback((message: string) => {
    clearTimeout(timer.current);
    setFeedback({ tone: 'success', message });
    timer.current = setTimeout(() => setFeedback(null), SUCCESS_VISIBLE_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { feedback, showError, showSuccess, clear };
}
