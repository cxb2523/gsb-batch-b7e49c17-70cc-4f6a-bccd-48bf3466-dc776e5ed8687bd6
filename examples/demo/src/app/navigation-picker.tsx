import { type ReactNode, useId, useRef } from "react"

export type NavigationGroup = {
  label: string
  links: readonly { label: string; href: string }[]
}

export function NavigationPicker({ label, current, groups }: { label: string; current: { label: string; href: string }; groups: readonly NavigationGroup[] }): ReactNode {
  const id = useId()
  const menu = useRef<HTMLElement>(null)
  return (
    <div className="navigation-picker">
      <button type="button" className="picker-trigger" popoverTarget={id} aria-label={`${label}: ${current.label}`}>
        <span className="picker-label">{label}</span>
        <span className="picker-value">{current.label}</span>
        <span className="picker-chevron" aria-hidden="true" />
      </button>
      <nav ref={menu} id={id} popover="auto" className="picker-menu" aria-label={label}>
        {groups.map((group) => (
          <div className="picker-group" key={group.label}>
            <p>{group.label}</p>
            {group.links.map((link) => (
              <a key={link.href} href={link.href} aria-current={link.href === current.href ? "page" : undefined} onClick={() => menu.current?.hidePopover()}>
                {link.label}
                <span className="picker-check" aria-hidden="true" />
              </a>
            ))}
          </div>
        ))}
      </nav>
    </div>
  )
}
