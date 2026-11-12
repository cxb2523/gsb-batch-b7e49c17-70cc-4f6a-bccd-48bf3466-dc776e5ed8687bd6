import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { exportUserData } from '../api';
import { useFeedback } from '../hooks/useFeedback';
import { FeedbackBanner } from './FeedbackBanner';
import { ProfileSectionCard } from './ProfileSectionCard';

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(link);
}

export function DataExportSection() {
  const [isExporting, setIsExporting] = useState(false);
  const { feedback, showError, showSuccess, clear } = useFeedback();

  const handleExport = async () => {
    setIsExporting(true);
    clear();
    try {
      const blob = await exportUserData();
      downloadBlob(blob, `canvhq-data-export-${new Date().toISOString().slice(0, 10)}.json`);
      showSuccess('Your personal data archive was downloaded successfully.');
    } catch (err) {
      showError(errorMessage(err) ?? 'Failed to download data export.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <ProfileSectionCard
      id="privacy"
      title="Data Privacy & Portability (GDPR)"
      icon={<Download className="w-4 h-4 text-brand" />}
      gap="gap-4"
      badge={
        <span className="font-mono text-[10px] bg-surface-2 text-ink-muted border border-border-subtle px-2 py-0.5 rounded-md font-semibold">
          JSON EXPORT
        </span>
      }
    >
      <p className="text-xs text-ink-muted leading-relaxed">
        You can download a complete, machine-readable JSON archive containing your account data,
        active sessions, workspace memberships, and diagram metadata.
      </p>

      <FeedbackBanner feedback={feedback} />

      <div className="p-3.5 bg-paper border border-border rounded-xl text-xs text-ink-muted leading-relaxed flex flex-col gap-1.5">
        <span className="font-semibold text-ink">Encryption notice:</span>
        <p>
          Diagram visual contents are encrypted in your browser before saving. The server does not
          hold the key to read or decrypt them.
        </p>
      </div>

      <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Link to="/privacy" className="text-xs text-ink-muted hover:text-ink underline font-medium">
          Read full Privacy Policy &rarr;
        </Link>
        <Button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className="h-9 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 self-start sm:self-auto"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{isExporting ? 'Preparing Export...' : 'Export Personal Data (JSON)'}</span>
        </Button>
      </div>
    </ProfileSectionCard>
  );
}
