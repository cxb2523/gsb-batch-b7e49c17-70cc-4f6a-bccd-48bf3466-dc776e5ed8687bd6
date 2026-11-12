import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Terminal,
  Lock,
  Hand,
  MousePointer2,
  Square,
  Diamond,
  Circle,
  MoveUpRight,
  Minus,
  Pencil,
  Type,
  Image as ImageIcon,
  Eraser,
} from 'lucide-react';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicFooter } from '@/components/PublicFooter';
import { APP_VERSION } from '@/lib/constants';

type ExcalidrawTool =
  | 'lock'
  | 'hand'
  | 'select'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'draw'
  | 'text'
  | 'image'
  | 'eraser';

export function Landing() {
  const [activeTool, setActiveTool] = useState<ExcalidrawTool>('select');
  const [isLocked, setIsLocked] = useState(false);

  const tools: Array<{
    id: ExcalidrawTool;
    label: string;
    shortcut?: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'hand',
      label: 'Hand (panning tool)',
      shortcut: 'H',
      icon: <Hand className="w-3.5 h-3.5" />,
    },
    {
      id: 'select',
      label: 'Selection',
      shortcut: 'V or 1',
      icon: <MousePointer2 className="w-3.5 h-3.5" />,
    },
    {
      id: 'rectangle',
      label: 'Rectangle',
      shortcut: 'R or 2',
      icon: <Square className="w-3.5 h-3.5" />,
    },
    {
      id: 'diamond',
      label: 'Diamond',
      shortcut: 'D or 3',
      icon: <Diamond className="w-3.5 h-3.5" />,
    },
    {
      id: 'ellipse',
      label: 'Ellipse',
      shortcut: 'O or 4',
      icon: <Circle className="w-3.5 h-3.5" />,
    },
    {
      id: 'arrow',
      label: 'Arrow',
      shortcut: 'A or 5',
      icon: <MoveUpRight className="w-3.5 h-3.5" />,
    },
    { id: 'line', label: 'Line', shortcut: 'L or 6', icon: <Minus className="w-3.5 h-3.5" /> },
    { id: 'draw', label: 'Draw', shortcut: 'P or 7', icon: <Pencil className="w-3.5 h-3.5" /> },
    { id: 'text', label: 'Text', shortcut: 'T or 8', icon: <Type className="w-3.5 h-3.5" /> },
    {
      id: 'image',
      label: 'Insert image',
      shortcut: '9',
      icon: <ImageIcon className="w-3.5 h-3.5" />,
    },
    { id: 'eraser', label: 'Eraser', shortcut: 'E or 0', icon: <Eraser className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="bg-paper min-h-screen text-ink font-sans antialiased flex flex-col justify-between selection:bg-ink selection:text-white">
      {/* Editorial Appbar with 94rem max width and left-aligned navigation */}
      <PublicHeader fixed={true} />

      {/* Main Content Area */}
      <main className="w-full pt-20 sm:pt-24 pb-16 flex-1 flex flex-col">
        {/* Hero Section */}
        <section className="w-full max-w-[1320px] mx-auto px-4 sm:px-8 py-10 sm:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            {/* Hero Left Column (Copy & Actions) */}
            <div className="lg:col-span-6 flex flex-col items-start text-left">
              {/* Release Pill Badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-border rounded-full text-[11px] font-mono text-ink-muted mb-6 shadow-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                <span className="font-semibold text-ink">Open-source canvas</span>
                <span className="text-border-strong">·</span>
                <span>Built for teams</span>
                <span className="text-border-strong">·</span>
                <span>{APP_VERSION}</span>
              </div>

              {/* Main Editorial Headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-[58px] font-bold tracking-[-0.045em] text-ink leading-[1.12]">
                Make space for
                <br />
                <em className="font-serif italic font-normal text-brand">big-picture thinking.</em>
              </h1>

              {/* Editorial Description */}
              <p className="mt-6 text-base sm:text-lg text-ink-prose leading-relaxed max-w-xl">
                An open workspace for diagrams, architecture, and the ideas that connect them.
                Collaborate freely, keep ownership close, and let your thinking take shape.
              </p>

              {/* Hero CTA Actions */}
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/login"
                  className="group inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white text-[13px] font-semibold rounded-lg shadow-xs hover:bg-ink-hover hover:-translate-y-0.5 active:translate-y-0 transition-all"
                >
                  <span>Explore your workspace</span>
                  <span className="text-sm transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                    ↗
                  </span>
                </Link>

                <a
                  href="https://github.com/qaribhaider/canvhq"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-border-strong text-ink text-[13px] font-semibold rounded-lg shadow-xs hover:bg-surface-warm hover:border-border-strong hover:-translate-y-0.5 active:translate-y-0 transition-all"
                >
                  <svg
                    className="w-4 h-4 fill-current shrink-0"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                    />
                  </svg>
                  <span>View GitHub Repo ↗</span>
                </a>
              </div>

              {/* Trustline Spec */}
              <div className="mt-8 flex flex-wrap items-center gap-2 text-xs font-mono text-ink-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                <span>Self-hostable by design</span>
                <span className="text-border-strong">·</span>
                <span>End-to-end encrypted</span>
                <span className="text-border-strong">·</span>
                <span>No vendor lock-in</span>
              </div>
            </div>

            {/* Hero Right Column (Hero Visual Frame) */}
            <div className="lg:col-span-6 relative">
              <div className="relative p-3.5 sm:p-5 bg-white border border-border rounded-[18px] shadow-[0_22px_55px_rgba(34,49,57,0.07)] sm:rotate-1 hover:rotate-0 transition-transform duration-300">
                {/* Visual Window Top Bar (CANVHQ / BOARD 01 without extra subtitle) */}
                <div className="flex items-center justify-between pb-3.5 font-mono text-[10px] text-ink-muted border-b border-border-subtle mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">CANVHQ</span>
                    <span className="text-border-strong">/</span>
                    <span className="font-medium text-ink-prose">BOARD 01</span>
                  </div>

                  <span className="inline-flex items-center gap-1.5 text-brand-strong bg-success-subtle px-2.5 py-0.5 rounded-full font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    SAVED
                  </span>
                </div>

                {/* Excalidraw Diagram Board */}
                <div className="h-[320px] sm:h-[350px] border border-border rounded-[9px] relative overflow-hidden editorial-canvas-grid select-none flex flex-col justify-between p-4">
                  {/* Standard Excalidraw Top Toolbar */}
                  <div
                    className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-white border border-border rounded-lg p-1 shadow-[0_4px_14px_rgba(23,34,56,0.06)] z-10 max-w-[96%] overflow-x-auto"
                    role="toolbar"
                    aria-label="Excalidraw tools"
                  >
                    {/* Tool: Lock */}
                    <button
                      type="button"
                      onClick={() => setIsLocked(!isLocked)}
                      title="Keep selected tool active after drawing"
                      className={`w-6 h-6 sm:w-7 sm:h-7 rounded grid place-items-center transition-colors ${
                        isLocked
                          ? 'bg-avatar-blue-bg text-ink-tertiary'
                          : 'text-ink-secondary hover:bg-surface-2'
                      }`}
                    >
                      <Lock className="w-3 h-3" />
                    </button>

                    <div className="w-px h-4 bg-surface-2 mx-0.5 shrink-0" />

                    {/* Standard Excalidraw Tools */}
                    {tools.map((t) => {
                      const isSelected = activeTool === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setActiveTool(t.id)}
                          title={`${t.label}${t.shortcut ? ` — ${t.shortcut}` : ''}`}
                          aria-label={t.label}
                          className={`w-6 h-6 sm:w-7 sm:h-7 rounded grid place-items-center transition-colors shrink-0 ${
                            isSelected
                              ? 'bg-avatar-blue-bg text-ink-tertiary font-semibold'
                              : 'text-ink-secondary hover:bg-surface-2'
                          }`}
                        >
                          {t.icon}
                        </button>
                      );
                    })}
                  </div>

                  {/* Architecture Node Diagram */}
                  <div className="flex-1 flex items-center justify-center gap-3 sm:gap-5 px-2 pt-8">
                    {/* Node 1: CLIENT */}
                    <div className="w-[28%] max-w-[110px] h-[86px] sm:h-[96px] bg-white/95 rounded-lg shadow-xs flex flex-col items-center justify-center font-mono text-[11px] sm:text-xs font-semibold text-ink transition-transform hover:-translate-y-0.5">
                      <span className="text-[9px] text-ink-muted font-normal uppercase tracking-wider mb-0.5">
                        LAYER 01
                      </span>
                      <span>CLIENT</span>
                      <span className="text-[9px] text-success font-normal mt-0.5">React 19</span>
                    </div>

                    {/* Directional Connector Arrow */}
                    <div className="flex items-center text-ink-subtle">
                      <span className="hidden sm:inline-block w-4 h-px bg-ink-subtle" />
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>

                    {/* Node 2: API LAYER */}
                    <div className="w-[28%] max-w-[110px] h-[86px] sm:h-[96px] bg-brand-subtle rounded-lg shadow-xs flex flex-col items-center justify-center font-mono text-[11px] sm:text-xs font-semibold text-brand-title transition-transform hover:-translate-y-0.5">
                      <span className="text-[9px] text-brand font-normal uppercase tracking-wider mb-0.5">
                        LAYER 02
                      </span>
                      <span>API LAYER</span>
                      <span className="text-[9px] text-brand font-normal mt-0.5">Hono / Node</span>
                    </div>

                    {/* Directional Connector Arrow */}
                    <div className="flex items-center text-ink-subtle">
                      <span className="hidden sm:inline-block w-4 h-px bg-ink-subtle" />
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>

                    {/* Node 3: STORAGE */}
                    <div className="w-[28%] max-w-[110px] h-[86px] sm:h-[96px] bg-white/95 rounded-lg shadow-xs flex flex-col items-center justify-center font-mono text-[11px] sm:text-xs font-semibold text-ink transition-transform hover:-translate-y-0.5">
                      <span className="text-[9px] text-ink-muted font-normal uppercase tracking-wider mb-0.5">
                        LAYER 03
                      </span>
                      <span>STORAGE</span>
                      <span className="text-[9px] text-success font-normal mt-0.5">
                        E2E Encrypted
                      </span>
                    </div>
                  </div>

                  {/* Bottom Status Bar */}
                  <div className="bg-white/95 border-t border-border -mx-4 -mb-4 px-3 py-1.5 flex items-center justify-between font-mono text-[9px] text-ink-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                      MODE: EDITING
                    </span>
                    <span>GRID: 20PX SNAP</span>
                    <span>ENGINE: EXCALIDRAW CORE</span>
                  </div>
                </div>

                {/* Corner Floating Editorial Sticky Note */}
                <div className="absolute -right-3 sm:-right-5 -bottom-4 sm:-bottom-5 bg-surface-2 border border-brand-border rounded-xl p-3 sm:p-4 shadow-[0_10px_30px_rgba(29,44,59,0.08)] -rotate-3 z-20 pointer-events-none max-w-[200px] text-left">
                  <strong className="block text-xs font-bold text-brand-strong mb-0.5 font-sans">
                    Room to think.
                  </strong>
                  <span className="text-[11px] text-brand-strong leading-snug font-sans">
                    Tools stay quiet. Ideas take focus.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3-Column Feature Strip (Soft Green Editorial Bar) */}
        <section className="w-full bg-surface-2 border-y border-border py-10 px-4 sm:px-8 mt-4 sm:mt-8">
          <div className="max-w-[1240px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 sm:gap-10">
            {/* Pillar 1 */}
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-white border border-border grid place-items-center text-brand text-lg shrink-0 shadow-2xs font-semibold">
                ⌘
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-ink mb-1.5 tracking-tight">
                  A canvas that stays out of the way
                </h3>
                <p className="text-[13px] text-ink-muted leading-relaxed">
                  Familiar drawing tools with a calmer, more considered frame. Focus purely on
                  flows, components, and architectural logic without intrusive UI.
                </p>
              </div>
            </div>

            {/* Pillar 2 */}
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-white border border-border grid place-items-center text-brand text-lg shrink-0 shadow-2xs font-semibold">
                ◇
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-ink mb-1.5 tracking-tight">
                  Your workspace, your rules
                </h3>
                <p className="text-[13px] text-ink-muted leading-relaxed">
                  Organize projects and manage access without unnecessary ceremony. Multi-workspace
                  isolation, member roles, and granular project boundaries.
                </p>
              </div>
            </div>

            {/* Pillar 3 */}
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-white border border-border grid place-items-center text-brand text-lg shrink-0 shadow-2xs font-semibold">
                ↗
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-ink mb-1.5 tracking-tight">
                  Open by nature
                </h3>
                <p className="text-[13px] text-ink-muted leading-relaxed">
                  Open source from day one. Run it with Docker Compose on your own server.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Deep Dive Section ("Everything has room to breathe.") */}
        <section className="w-full max-w-[1240px] mx-auto px-4 sm:px-8 py-16 sm:py-24">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <div>
              <div className="font-mono text-xs font-semibold uppercase tracking-widest text-ink-muted mb-2">
                A thoughtful place to work
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.04em] text-ink">
                Everything has room to breathe.
              </h2>
            </div>
            <p className="text-[14px] text-ink-muted max-w-md leading-relaxed">
              Familiar tools, clearer hierarchy, and a softer visual language that keeps the focus
              on your work.
            </p>
          </div>

          {/* 3 Mini-Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 01 */}
            <div className="p-6 sm:p-7 bg-white border border-border rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.03)] hover:-translate-y-1 transition-all duration-200">
              <div className="font-mono text-[11px] font-semibold text-brand tracking-wider mb-4">
                01 / ORGANIZE
              </div>
              <h3 className="text-lg font-bold text-ink mb-2 tracking-tight">
                Projects with purpose
              </h3>
              <p className="text-[13px] text-ink-muted leading-relaxed">
                Keep canvases grouped by team, product, or the problem you're solving. Fast search,
                intuitive sorting, and instant board access.
              </p>
            </div>

            {/* Card 02 */}
            <div className="p-6 sm:p-7 bg-white border border-border rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.03)] hover:-translate-y-1 transition-all duration-200">
              <div className="font-mono text-[11px] font-semibold text-brand tracking-wider mb-4">
                02 / CREATE
              </div>
              <h3 className="text-lg font-bold text-ink mb-2 tracking-tight">Think visually</h3>
              <p className="text-[13px] text-ink-muted leading-relaxed">
                Start with a blank canvas and build architecture, flows, and shared understanding.
                Native Excalidraw tools and Mermaid diagram support.
              </p>
            </div>

            {/* Card 03 */}
            <div className="p-6 sm:p-7 bg-white border border-border rounded-xl shadow-[0_4px_20px_rgba(23,34,56,0.03)] hover:-translate-y-1 transition-all duration-200">
              <div className="font-mono text-[11px] font-semibold text-brand tracking-wider mb-4">
                03 / PROTECT
              </div>
              <h3 className="text-lg font-bold text-ink mb-2 tracking-tight">
                Privacy stays foundational
              </h3>
              <p className="text-[13px] text-ink-muted leading-relaxed mb-4">
                Clear security status and client-side encryption controls, presented without visual
                noise or technical opacity.
              </p>
              <Link
                to="/security"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-strong hover:text-ink transition-colors"
              >
                <span>Read security architecture</span>
                <span>→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Self-Hosting & Production Readiness Strip */}
        <section className="w-full max-w-[1240px] mx-auto px-4 sm:px-8 pb-12">
          <div className="bg-surface-2 border border-border rounded-2xl p-6 sm:p-10 flex flex-col lg:flex-row items-center justify-between gap-8">
            <div className="max-w-xl text-left">
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 bg-white border border-border rounded-md font-mono text-[10px] text-brand mb-3">
                <Terminal className="w-3 h-3 text-brand" />
                <span>SELF-HOST READY</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink mb-2">
                Deploy on your own terms.
              </h3>
              <p className="text-[13px] sm:text-[14px] text-ink-muted leading-relaxed">
                CanvHQ runs wherever Docker runs, with PostgreSQL and S3-compatible storage. It
                updates its own database, and analytics are off unless you turn them on.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/docs/run-with-docker-compose"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-border-strong text-ink text-[13px] font-semibold rounded-lg shadow-xs hover:bg-surface-warm hover:border-border-strong hover:-translate-y-0.5 transition-all"
              >
                <span>Docker Compose Guide</span>
                <span>↗</span>
              </Link>
              <Link
                to="/docs"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-white text-[13px] font-semibold rounded-lg shadow-xs hover:bg-ink-hover hover:-translate-y-0.5 transition-all"
              >
                <span>Explore Full Documentation</span>
                <span>↗</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Bottom Pre-Footer CTA */}
        <section className="w-full max-w-[1240px] mx-auto px-4 sm:px-8 py-10 sm:py-16 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-ink tracking-tight mb-4">
            Start creating your visual architecture.
          </h2>
          <p className="text-sm sm:text-base text-ink-muted max-w-xl mx-auto mb-8">
            Free and open source. Create your workspace, invite team members, and draw and plan
            together.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-6 py-3 bg-ink text-white text-sm font-semibold rounded-lg shadow-xs hover:bg-ink-hover hover:-translate-y-0.5 transition-all"
            >
              <span>Explore your workspace</span>
              <span>↗</span>
            </Link>
            <Link
              to="/docs"
              className="inline-flex items-center gap-2 px-5 py-3 bg-white border border-border-strong text-ink text-sm font-semibold rounded-lg shadow-xs hover:bg-surface-warm hover:border-border-strong transition-all"
            >
              <span>Read the documentation</span>
            </Link>
          </div>
        </section>
      </main>

      {/* Modern Soft Editorial Footer with 94rem max width */}
      <PublicFooter />
    </div>
  );
}
