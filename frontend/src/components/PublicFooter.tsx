import { Link } from 'react-router-dom';
import { APP_VERSION } from '@/lib/constants';

export function PublicFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full bg-paper border-t border-border font-mono text-[11px] text-ink-muted py-4 px-4 sm:px-8">
      <div className="max-w-[94rem] mx-auto flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4">
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 sm:gap-3">
          <span className="font-medium text-ink">© {currentYear} CanvHQ</span>
          <span className="text-border-strong">·</span>
          <div className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            <span>Self-hostable</span>
          </div>
          <span className="text-border-strong">·</span>
          <span>Open source</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-ink-muted">
          <Link to="/security" className="hover:text-ink transition-colors">
            Security
          </Link>
          <span className="text-border-strong">·</span>
          <Link to="/privacy" className="hover:text-ink transition-colors">
            Privacy
          </Link>
          <span className="text-border-strong">·</span>
          <Link to="/terms" className="hover:text-ink transition-colors">
            Terms
          </Link>
          <span className="text-border-strong">·</span>
          <Link to="/docs" className="hover:text-ink transition-colors">
            Documentation
          </Link>
          <span className="text-border-strong">·</span>
          <a
            href="https://github.com/qaribhaider/canvhq"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink transition-colors"
          >
            GitHub
          </a>
        </div>

        <div className="flex items-center gap-2 text-ink-subtle">
          <span>CanvHQ {APP_VERSION}</span>
          <span className="text-border-strong">·</span>
          <span className="text-ink font-semibold">Apache 2.0 Licensed</span>
        </div>
      </div>
    </footer>
  );
}
