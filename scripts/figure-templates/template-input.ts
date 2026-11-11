export type TemplateInput = {
  slug: string
  title: string
  industry: string
  industryTitle: string
  blurb: string
  label: string
  componentName: string
}

export type FigureFiles = { tsx: string; css: string }

export const quoted = (text: string): string => JSON.stringify(text)

export const attribute = (text: string): string => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;")

export const scope = (input: TemplateInput): string => `.fig-${input.slug}`
