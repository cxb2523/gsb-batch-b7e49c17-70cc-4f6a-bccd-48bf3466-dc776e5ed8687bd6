export const classNames = (...names: Array<string | false | null | undefined>): string => names.filter(Boolean).join(" ")
