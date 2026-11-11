import type { ReactNode } from "react"
import { GITHUB_AUTHOR, HAIRLINE, ISO_FIGURE, PUSHARY_HOME } from "./links"
import { href } from "./route-store"

export function SiteFooter(): ReactNode {
  return (
    <footer>
      <span>
        MIT · made by <a href={GITHUB_AUTHOR}>Aadil Ghani</a>, maker of{" "}
        <a href={PUSHARY_HOME} target="_blank" rel="noopener">
          Pushary
        </a>
      </span>
      <span>
        <a href={href("design-system")}>Design system</a> · {" "}
        Standing on <a href={HAIRLINE}>Hairline</a> and <a href={ISO_FIGURE}>iso-figure</a>.
      </span>
    </footer>
  )
}
