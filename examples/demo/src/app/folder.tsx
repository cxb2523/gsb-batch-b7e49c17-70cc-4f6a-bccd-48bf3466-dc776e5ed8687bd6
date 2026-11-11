import type { ReactNode } from "react"

export function Folder({ title, description, count, children }: { title: string; description: string; count?: string; children: ReactNode }): ReactNode {
  return (
    <details className="brief-folder">
      <summary>
        <span className="folder-mark" aria-hidden="true"><span className="folder-back" /><span className="folder-paper" /><span className="folder-front" /></span>
        <span className="brief-industry"><strong>{title}</strong><span>{description}</span></span>
        <span className="folder-count">{count}</span>
        <span className="folder-toggle" aria-hidden="true">+</span>
      </summary>
      {children}
    </details>
  )
}
