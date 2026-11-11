import { type CSSProperties, type ReactNode, useState } from "react"
import { CopyCommand } from "../app/copy-command"
import { Folder } from "../app/folder"
import { NavigationPicker } from "../app/navigation-picker"
import { href } from "../app/route-store"

const COLORS = [
  { token: "--bg", label: "Canvas", use: "The page underneath everything." },
  { token: "--card", label: "Inset", use: "Group related controls and examples." },
  { token: "--surface", label: "Raised", use: "Menus and selected controls." },
  { token: "--line", label: "Edge", use: "Separate content without heavy boxes." },
  { token: "--muted", label: "Secondary", use: "Descriptions and supporting labels." },
  { token: "--fg", label: "Ink", use: "Headings, actions and focus rings." },
] as const
const SPACING = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96] as const
const PAGE_GROUPS = [{ label: "Explore the site", links: [
  { label: "Design system", href: href("design-system") },
  { label: "Components", href: href("components") },
  { label: "Figures", href: href("figures") },
  { label: "Studio", href: href("studio") },
] }]
const CURRENT_PAGE = { label: "Design system", href: href("design-system") }

export function DesignSystemPage(): ReactNode {
  const [selected, setSelected] = useState(true)
  return (
    <main className="page design-system">
      <header className="page-head">
        <p className="eyebrow">isokit · Website foundations</p>
        <h1>A small set of good defaults.</h1>
        <p className="lede">The type, surfaces and controls used across this site. These are live examples: try them, use your keyboard, and switch the theme.</p>
      </header>
      <section className="system-section" aria-labelledby="system-controls">
        <div className="section-head"><h2 id="system-controls">Clear controls.</h2><p>One main action. Quiet alternatives. A selected state you can see without relying on color.</p></div>
        <div className="system-control-grid">
          <div className="system-sample surface">
            <span className="system-label">Actions</span>
            <div className="cta">
              <a className="button" href={href("figures")}>Browse figures</a>
              <a className="button button-secondary" href={href("components")}>Read the docs</a>
              <button type="button" className="button button-secondary" disabled>Unavailable</button>
            </div>
            <p>44 px touch targets. 8 px corners. A small press response.</p>
          </div>
          <div className="system-sample surface">
            <span className="system-label">Selection and feedback</span>
            <div className="filters"><button type="button" className="pill" aria-pressed={selected} onClick={() => setSelected(!selected)}>Toggle selection</button></div>
            <CopyCommand text="npm install react-isokit" label="the install command" />
          </div>
          <div className="system-sample surface">
            <span className="system-label">Page picker</span>
            <NavigationPicker label="Browse" current={CURRENT_PAGE} groups={PAGE_GROUPS} />
            <p>Click to open. Tab through links. Escape or click outside to close.</p>
          </div>
        </div>
      </section>
      <section className="system-section" aria-labelledby="system-surfaces">
        <div className="section-head"><h2 id="system-surfaces">Depth at the edges.</h2><p>A thin border, an inner highlight and a soft shadow. The content stays sharp.</p></div>
        <div className="system-surfaces">
          <div className="system-bezel surface"><span>12</span><code>--radius-card</code><p>Cards and drawing plates</p></div>
          <div className="system-bezel surface system-panel"><span>16</span><code>--radius-panel</code><p>Grouped controls and maker cards</p></div>
          <div className="system-surface-note"><h3>Use space first.</h3><p>A card groups something you can use. Plain text sits on the page. Blur belongs at the viewport edges, away from labels and controls.</p></div>
        </div>
      </section>
      <section className="system-section" aria-labelledby="system-colors">
        <div className="section-head"><h2 id="system-colors">One palette, two themes.</h2><p>Use the role, not a raw color. The same tokens adapt when you switch between light and dark.</p></div>
        <div className="system-colors">
          {COLORS.map((color) => <div className="system-color" key={color.token}><div className="system-swatch" style={{ background: `var(${color.token})` }} /><strong>{color.label}</strong><code>{color.token}</code><p>{color.use}</p></div>)}
        </div>
      </section>
      <section className="system-section" aria-labelledby="system-type">
        <div className="section-head"><h2 id="system-type">Type that gets to the point.</h2><p>Short headings. Comfortable paragraphs. Monospace only where the text is code or a label.</p></div>
        <div className="system-type-row"><span>Page title</span><p className="system-title-sample">Make something click.</p></div>
        <div className="system-type-row"><span>Section title</span><h2>Start with a single button.</h2></div>
        <div className="system-type-row"><span>Body · 15 px</span><p>Add a drawing to your page. Give people something to press, and show them what changed.</p></div>
        <div className="system-type-row"><span>Code · 13 px</span><code>npm install react-isokit</code></div>
      </section>
      <section className="system-section" aria-labelledby="system-spacing">
        <div className="section-head"><h2 id="system-spacing">Room to breathe.</h2><p>Small gaps connect related things. Larger gaps separate sections. Page gutters grow with the viewport.</p></div>
        <div className="system-spacing">{SPACING.map((size, index) => <div key={size}><span style={{ "--sample-space": `var(--space-${index + 1})` } as CSSProperties} /><code>{size}</code></div>)}</div>
      </section>
      <section className="system-section" aria-labelledby="system-motion">
        <div className="section-head"><h2 id="system-motion">Motion with a reason.</h2><p>Presses take 140 ms. Menus and folders settle in 200 ms. Reduced motion keeps everything usable without movement.</p></div>
        <Folder title="Open the folder" description="The paper lifts as the contents appear." count="3 rules">
          <ul className="system-motion-rules"><li>Animate a response to an action.</li><li>Keep hover effects for a mouse or trackpad.</li><li>Make every action work by touch and keyboard.</li></ul>
        </Folder>
      </section>
    </main>
  )
}
