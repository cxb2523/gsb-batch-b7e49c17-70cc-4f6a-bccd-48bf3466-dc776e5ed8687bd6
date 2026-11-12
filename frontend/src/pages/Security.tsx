import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Lock,
  EyeOff,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicFooter } from '@/components/PublicFooter';
import { TechnicalDetails } from '@/components/TechnicalDetails';
import { useSession } from '@/lib/auth-client';

export function Security() {
  const { data: session } = useSession();

  return (
    <div className="bg-paper min-h-screen text-ink font-sans antialiased flex flex-col justify-between selection:bg-ink selection:text-white">
      <PublicHeader fixed={true} />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-8 py-12 pt-20 sm:pt-24 pb-20 flex flex-col gap-8">
        {/* Page Title & Eyebrow */}
        <div className="border-b border-border pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand-subtle border border-brand-border rounded-md mb-4 font-mono text-[11px] text-brand-strong uppercase tracking-wider font-semibold shadow-2xs">
            <ShieldCheck className="w-3.5 h-3.5 text-success" />
            <span>Security specifications & threat model</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-ink leading-tight">
            How CanvHQ protects your canvases
          </h1>
          <p className="text-sm sm:text-base text-ink-muted mt-3 leading-relaxed max-w-2xl">
            A plain-language description of what is encrypted, what is not, and the limits of the
            system.
          </p>
        </div>

        {/* Section 1: What is encrypted */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-brand-subtle grid place-items-center text-brand-strong shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <h2>What is encrypted</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            Your canvas is encrypted in your browser before it is saved. The server stores the
            encrypted result and does not hold a key that opens it.
          </p>
          <ul className="list-disc list-inside text-sm text-ink-prose flex flex-col gap-1.5 pl-1 leading-relaxed">
            <li>Canvas elements, drawings, and shapes.</li>
            <li>Canvas background and grid preferences.</li>
            <li>Images and file attachments placed on a canvas.</li>
          </ul>
        </section>

        {/* Section 2: What is not end-to-end encrypted */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-surface-2 grid place-items-center text-brand-strong shrink-0">
              <EyeOff className="w-4 h-4" />
            </div>
            <h2>What is not end-to-end encrypted</h2>
          </div>
          <p className="text-sm text-ink-prose leading-relaxed">
            To coordinate collaboration and serve the app, the server stores the following metadata
            unencrypted. It needs to read these details so it can list your canvases, show who
            belongs to a workspace, check what each person is allowed to open, deliver invitations
            and keep you signed in, all without opening your canvases. Access to them is limited by
            your role in the workspace.
          </p>
          <ul className="list-disc list-inside text-sm text-ink-prose flex flex-col gap-1.5 pl-1 leading-relaxed">
            <li>Workspace, project, and canvas names.</li>
            <li>Member names, email addresses, and avatar links.</li>
            <li>Workspace and project membership lists.</li>
            <li>Role assignments (owner, admin, editor, viewer).</li>
            <li>Timestamps, canvas revision numbers, and file sizes.</li>
            <li>Sign-in session records (including browser identity and client IP address).</li>
          </ul>
        </section>

        {/* Section 3: What you need to do */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-warning-subtle grid place-items-center text-warning shrink-0">
              <HelpCircle className="w-4 h-4" />
            </div>
            <h2>What you need to do</h2>
          </div>
          <ul className="list-disc list-inside text-sm text-ink-prose flex flex-col gap-2 pl-1 leading-relaxed">
            <li>
              <strong>Keep your passphrase safe.</strong> We cannot reset your passphrase. If you
              lose it, your canvases cannot be opened.
            </li>
            <li>
              <strong>Share public links only with people you trust.</strong> Anyone who receives
              the link can view the canvas, and anyone who has the link can pass it to others.
            </li>
          </ul>
        </section>

        {/* Section 4: Limits */}
        <section className="bg-white border border-border p-6 sm:p-8 rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5 text-ink font-bold text-base">
            <div className="w-7 h-7 rounded-lg bg-warning-subtle grid place-items-center text-warning shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
            <h2>Limits</h2>
          </div>
          <ol className="list-decimal list-inside text-sm text-ink-prose flex flex-col gap-2.5 pl-1 leading-relaxed">
            <li>
              The encrypting happens in your browser, using code that the server sends to it. If
              that server were compromised or run by someone malicious, it could send your browser
              altered code that captures what you type. This is a limit of every web app.
            </li>
            <li>
              If your own computer or browser is compromised, for example by malware or a harmful
              extension, it can see what you type and what is on your screen, before and after
              encryption.
            </li>
            <li>
              Someone removed from a workspace keeps whatever they already saw or copied, but not
              future content; rotation protects what is saved afterwards, and it is carried out by
              an administrator's browser.
            </li>
            <li>
              If the server replays an older saved version, a device detects it only if that device
              has already seen a newer one; a brand-new device cannot tell.
            </li>
            <li>
              A public link works for whoever holds it until it is turned off. Turning it off makes
              the link stop working, and the canvas keeps its current key.
            </li>
            <li>
              Public keys of other members come from the server, so a malicious server could hand
              out a key it holds when someone is invited (no key pinning or fingerprints yet;
              planned after launch).
            </li>
          </ol>
        </section>

        {/* Technical Details */}
        <TechnicalDetails title="Technical details">
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-ink text-xs uppercase tracking-wider mb-1">
                Key Derivation
              </h4>
              <p>
                When you set your passphrase, your device generates a random 16-byte salt and
                derives a 256-bit Key Encryption Key (KEK) using PBKDF2 with SHA-256 and 600,000
                iterations.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-ink text-xs uppercase tracking-wider mb-1">
                Key Layers
              </h4>
              <p>
                The KEK wraps your RSA-OAEP 2048-bit user keypair. The workspace key (AES-GCM-256)
                is wrapped with each administrator's public key. Project keys (AES-GCM-256) are
                wrapped with the workspace key or an assigned member's public key. Board keys
                (AES-GCM-256) are wrapped with the project key. The canvas payload is encrypted with
                the board key.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-ink text-xs uppercase tracking-wider mb-1">
                What the Server Stores
              </h4>
              <p>
                The server stores encrypted binary payloads in S3-compatible storage and wrapped key
                envelopes in Postgres. The server does not receive plaintext canvas elements.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-ink text-xs uppercase tracking-wider mb-1">
                Public Links
              </h4>
              <p>
                When you create a public link, the board key is encoded into the URL hash fragment
                after the `#` symbol. Browsers do not send this fragment to web servers in HTTP
                requests.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-ink text-xs uppercase tracking-wider mb-1">
                Session Clearing
              </h4>
              <p>
                Unlocked private keys are cached locally in IndexedDB as non-extractable CryptoKeys
                so other scripts cannot read raw key bytes. Signing out purges cached keys from the
                browser.
              </p>
            </div>
          </div>
        </TechnicalDetails>

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
            <Link
              to="/docs/architecture"
              className="hover:text-ink transition-colors inline-flex items-center gap-1"
            >
              <span>How your data is protected</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
            <span className="text-border-strong">·</span>
            <Link to="/privacy" className="hover:text-ink transition-colors">
              Privacy Policy
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
