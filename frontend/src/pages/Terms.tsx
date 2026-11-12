import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Lock,
  FileText,
  Server,
  UserCheck,
} from 'lucide-react';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicFooter } from '@/components/PublicFooter';
import { useSession } from '@/lib/auth-client';
import { useAuthConfig } from '@/lib/auth-config';

export function Terms() {
  const { data: session } = useSession();
  const { config: authConfig } = useAuthConfig();

  const operatorName = authConfig?.operator?.name;
  const operatorContact = authConfig?.operator?.contact;
  const hasOperator = Boolean(operatorName || operatorContact);

  return (
    <div className="bg-paper min-h-screen text-ink font-sans antialiased flex flex-col justify-between selection:bg-ink selection:text-white">
      <PublicHeader fixed={true} />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-8 py-12 pt-20 sm:pt-24 pb-20 flex flex-col gap-8">
        {/* Page Title & Eyebrow */}
        <div className="border-b border-border pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-2 border border-border rounded-md mb-4 font-mono text-[11px] text-brand uppercase tracking-wider font-semibold shadow-2xs">
            <FileText className="w-3.5 h-3.5 text-brand" />
            <span>Terms of use</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-ink leading-tight">
            Terms and Conditions
          </h1>
          <p className="text-sm sm:text-base text-ink-muted mt-3 leading-relaxed max-w-2xl">
            Plain-language guidelines governing the use of CanvHQ software and this instance.
          </p>
        </div>

        {/* Section: Instance operator */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-brand-subtle grid place-items-center text-brand-strong shrink-0">
              <UserCheck className="w-4 h-4" />
            </div>
            <h2>1. Instance operator</h2>
          </div>
          {hasOperator ? (
            <p className="text-sm text-ink-prose leading-relaxed">
              This instance is provided by{' '}
              <strong className="text-ink font-semibold">{operatorName || 'the operator'}</strong>
              {operatorContact && (
                <>
                  {' '}
                  (contact:{' '}
                  {operatorContact.includes('@') ? (
                    <a
                      href={`mailto:${operatorContact}`}
                      className="text-brand hover:underline font-medium"
                    >
                      {operatorContact}
                    </a>
                  ) : (
                    <a
                      href={operatorContact}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:underline font-medium"
                    >
                      {operatorContact}
                    </a>
                  )}
                  )
                </>
              )}
              .
            </p>
          ) : (
            <p className="text-sm text-ink-prose leading-relaxed">
              The person who runs this instance has not published contact details. Ask whoever gave
              you the link.
            </p>
          )}
        </section>

        {/* Section: Open source */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-avatar-blue-bg grid place-items-center text-ink-tertiary shrink-0">
              <Server className="w-4 h-4" />
            </div>
            <h2>2. Open-source and self-hosting</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            CanvHQ is open-source software that you can inspect and self-host. The terms of use of
            the code are in its licence, in the source repository. CanvHQ also uses open-source
            libraries made by others; their licences are listed in{' '}
            <a
              href="/THIRD_PARTY_LICENSES.txt"
              className="text-brand-strong underline underline-offset-2 hover:text-ink"
            >
              the open-source licences file
            </a>
            .
          </p>
        </section>

        {/* Section: Your passphrase and your canvases */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-brand-subtle grid place-items-center text-brand-strong shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <h2>3. Your passphrase and your canvases</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            Your canvas is encrypted in your browser before saving. The server stores only encrypted
            blobs and wrapped keys, and does not hold the keys to open your canvases.
          </p>
          <ul className="list-disc list-inside text-sm text-ink-prose flex flex-col gap-2 pl-1 leading-relaxed">
            <li>
              <strong>Passphrase custody:</strong> You are responsible for keeping your passphrase
              safe. We cannot reset your passphrase. If you lose it, your canvases cannot be opened.
            </li>
            <li>
              <strong>Public links:</strong> A public link carries the canvas key in its address
              fragment. Anyone with the link can view the canvas.
            </li>
          </ul>
        </section>

        {/* Section: Workspace Ownership */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-brand-subtle grid place-items-center text-brand-strong shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h2>4. Workspace ownership</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            You retain ownership of the workspaces and canvases you create. Workspace administrators
            can manage membership and access, or delete workspaces and canvases at any time.
          </p>
        </section>

        {/* Section: Limitation of Liability */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-surface-2 grid place-items-center text-brand shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <h2>5. Software provided as-is</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            CanvHQ software is provided "as is", without warranty of any kind. The authors and
            operators are not liable for any claim, damages, or data loss resulting from forgotten
            passphrases, lost encryption keys, or system issues.
          </p>
        </section>

        {/* Bottom Navigation Links */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-border">
          <Link
            to={session ? '/workspace' : '/login'}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-border-strong text-xs font-semibold text-ink rounded-lg shadow-xs hover:bg-surface-warm hover:border-border-strong hover:-translate-y-0.5 transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{session ? 'Back to Workspace' : 'Back to Sign In'}</span>
          </Link>

          <div className="flex items-center gap-4 text-xs font-medium text-ink-muted">
            <Link to="/privacy" className="hover:text-ink transition-colors">
              Privacy Notice
            </Link>
            <span className="text-border-strong">·</span>
            <Link
              to="/security"
              className="hover:text-ink transition-colors inline-flex items-center gap-1"
            >
              <span>Security Specifications</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
