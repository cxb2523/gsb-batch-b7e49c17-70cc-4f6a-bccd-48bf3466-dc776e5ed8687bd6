import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  UserCheck,
  Database,
  EyeOff,
  Cookie,
  BarChart2,
  Clock,
  UserX,
} from 'lucide-react';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicFooter } from '@/components/PublicFooter';
import { useSession } from '@/lib/auth-client';
import { useAuthConfig } from '@/lib/auth-config';

export function Privacy() {
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
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand-subtle border border-brand-border rounded-md mb-4 font-mono text-[11px] text-brand-strong uppercase tracking-wider font-semibold shadow-2xs">
            <ShieldCheck className="w-3.5 h-3.5 text-success" />
            <span>Privacy notice</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-ink leading-tight">
            Privacy Notice
          </h1>
          <p className="text-sm sm:text-base text-ink-muted mt-3 leading-relaxed max-w-2xl">
            A plain-language explanation of what data this CanvHQ instance collects, how it is used,
            and how long it is kept.
          </p>
        </div>

        {/* Section 1: Who runs this instance */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-brand-subtle grid place-items-center text-brand-strong shrink-0">
              <UserCheck className="w-4 h-4" />
            </div>
            <h2>1. Who runs this instance</h2>
          </div>
          {hasOperator ? (
            <p className="text-sm text-ink-prose leading-relaxed">
              This instance of CanvHQ is operated by{' '}
              <strong className="text-ink font-semibold">{operatorName || 'the operator'}</strong>
              {operatorContact && (
                <>
                  . You can contact them at{' '}
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

        {/* Section 2: Personal data stored */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-avatar-blue-bg grid place-items-center text-ink-tertiary shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <h2>2. Personal data stored</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            The server stores only what is needed to manage sign-in and workspace collaboration:
          </p>
          <ul className="list-disc list-inside text-sm text-ink-prose flex flex-col gap-1.5 pl-1 leading-relaxed">
            <li>
              <strong>Account profile:</strong> your name, email address, and avatar link from your
              OAuth sign-in provider.
            </li>
            <li>
              <strong>Session records:</strong> active sessions including browser identity and
              client IP address.
            </li>
            <li>
              <strong>Workspace content:</strong> workspace and project names, membership lists, and
              role assignments.
            </li>
            <li>
              <strong>Notifications:</strong> the short notices in your inbox, such as someone
              joining a workspace you administer, or access you were given. Each holds a kind and
              the names of the workspace, project or person involved, and never canvas content.
            </li>
          </ul>
        </section>

        {/* Section 3: What is not stored on our side in readable form */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-surface-2 grid place-items-center text-brand-strong shrink-0">
              <EyeOff className="w-4 h-4" />
            </div>
            <h2>3. What is not stored in readable form</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            Canvas visual contents, drawing elements, text within diagrams, and canvas image
            attachments are encrypted in your browser before saving. The server does not hold the
            keys to decrypt or inspect them.
          </p>
        </section>

        {/* Section 4: Cookies */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-warning-subtle grid place-items-center text-warning shrink-0">
              <Cookie className="w-4 h-4" />
            </div>
            <h2>4. Cookies</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            CanvHQ uses essential cookies to keep you signed in. It does not set advertising or
            cross-site tracking cookies.
          </p>
        </section>

        {/* Section 5: Analytics */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-brand-subtle grid place-items-center text-brand-strong shrink-0">
              <BarChart2 className="w-4 h-4" />
            </div>
            <h2>5. Analytics</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            Analytics is off unless the operator configures Umami Analytics. If enabled, it collects
            page views. It is not loaded on canvas or shared-link pages, and it is set to ignore the
            part of the address after the # symbol, where a shared link keeps its key. See Umami's
            own documentation for what it collects.
          </p>
        </section>

        {/* Section 6: Data retention */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-surface-2 grid place-items-center text-ink-tertiary shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <h2>6. Data retention</h2>
          </div>
          <ul className="list-disc list-inside text-sm text-ink-prose flex flex-col gap-2 pl-1 leading-relaxed">
            <li>
              <strong>Sessions:</strong> Kept until they expire or you sign out. Expired sessions
              are purged daily.
            </li>
            <li>
              <strong>Invitations:</strong> Kept until accepted or expired. Expired invitations are
              purged daily.
            </li>
            <li>
              <strong>Notifications:</strong> Kept until you read them. Once read, they are purged
              after 30 days.
            </li>
            <li>
              <strong>Signup attempts:</strong> Only recorded if the operator set a signup limit;
              purged after the limit window passes.
            </li>
            <li>
              <strong>Deleted content:</strong> When you delete a canvas, project, or workspace, the
              records are removed from the database immediately. Associated stored binary files are
              removed shortly after by a background cleanup job.
            </li>
          </ul>
        </section>

        {/* Section 7: Your rights */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-warning-subtle grid place-items-center text-warning shrink-0">
              <UserX className="w-4 h-4" />
            </div>
            <h2>7. Your rights</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            You have control over your data directly within the application:
          </p>
          <ul className="list-disc list-inside text-sm text-ink-prose flex flex-col gap-2 pl-1 leading-relaxed">
            <li>
              <strong>Data export:</strong> Download a complete JSON archive of your personal data,
              sessions, memberships, and notifications at any time from your{' '}
              <Link to="/profile" className="text-brand hover:underline font-medium">
                Profile
              </Link>
              .
            </li>
            <li>
              <strong>Account deletion:</strong> Permanently delete your account and associated
              personal records from your{' '}
              <Link to="/profile" className="text-brand hover:underline font-medium">
                Profile
              </Link>
              .
            </li>
            <li>
              <strong>Contact:</strong> For questions about this instance or its data practices,
              contact the instance operator using the details above.
            </li>
          </ul>
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
            <Link to="/terms" className="hover:text-ink transition-colors">
              Terms and Conditions
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
