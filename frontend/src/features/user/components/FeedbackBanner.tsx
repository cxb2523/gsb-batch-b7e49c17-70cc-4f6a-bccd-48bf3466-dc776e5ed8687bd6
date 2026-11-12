import { ShieldCheck } from 'lucide-react';
import type { Feedback } from '../hooks/useFeedback';

interface FeedbackBannerProps {
  feedback: Feedback | null;
  showIcon?: boolean;
}

export function FeedbackBanner({ feedback, showIcon = true }: FeedbackBannerProps) {
  if (!feedback) return null;
  const tone =
    feedback.tone === 'success'
      ? 'bg-brand-subtle border border-brand-border text-brand-strong'
      : 'bg-danger-subtle border border-danger-border text-danger';
  return (
    <div
      role={feedback.tone === 'error' ? 'alert' : 'status'}
      className={`p-3 text-xs rounded-xl font-medium flex items-center gap-2 ${tone}`}
    >
      {showIcon && <ShieldCheck className="w-4 h-4 shrink-0" />}
      <span>{feedback.message}</span>
    </div>
  );
}
