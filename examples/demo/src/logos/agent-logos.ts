import antigravity from "./antigravity.webp"
import claudeCode from "./claude-code.webp"
import codex from "./codex.webp"
import fx from "./fx.webp"
import hermes from "./hermes.webp"
import opencode from "./opencode.svg"
import pusharyGlyph from "./pushary-glyph.png"
import pusharyIcon from "./pushary-icon.png"

export const AGENT_LOGOS = { "claude-code": claudeCode, codex, fx, antigravity, opencode, hermes } as const

export type AgentLogo = keyof typeof AGENT_LOGOS

export const PUSHARY_GLYPH = { href: pusharyGlyph, aspect: 318 / 472 } as const

export const PUSHARY_ICON = pusharyIcon
