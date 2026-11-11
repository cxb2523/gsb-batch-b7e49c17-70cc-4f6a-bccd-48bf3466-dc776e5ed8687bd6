import type { ReactNode } from "react"
import { SoundToggle } from "react-isokit"
import { BrandMark } from "../brand-mark"
import { GITHUB_REPO } from "./links"
import { href } from "./route-store"
import { useTheme } from "./theme-store"

const NAV_LINKS = [
  { to: "figures", label: "Figures" },
  { to: "studio", label: "Studio" },
  { to: "lab", label: "Lab" },
  { to: "components", label: "Components" },
  { to: "sound", label: "Sound" },
] as const

function ThemeToggle(): ReactNode {
  const [theme, setTheme] = useTheme()
  const dark = theme === "dark"
  return (
    <button type="button" className="pill" onClick={() => setTheme(dark ? "light" : "dark")} aria-pressed={dark}>
      {dark ? "Dark" : "Light"}
    </button>
  )
}

export function SiteHeader({ current }: { current?: string | undefined }): ReactNode {
  return (
    <header className="bar">
      <a className="brand" href={href()}>
        <svg viewBox="-10 -11 20 22" width="18" height="20" aria-hidden="true">
          <BrandMark className="mark" />
        </svg>
        isokit
      </a>
      <nav className="site-nav" aria-label="Site">
        {NAV_LINKS.map((link) => (
          <a key={link.to} href={href(link.to)} aria-current={current === link.to ? "page" : undefined}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="site-controls">
        <a className="github-link" href={GITHUB_REPO}>GitHub</a>
        <SoundToggle className="pill" />
        <ThemeToggle />
      </div>
    </header>
  )
}
