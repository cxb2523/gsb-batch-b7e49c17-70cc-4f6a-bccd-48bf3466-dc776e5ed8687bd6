// The project's colours as inline CSS variables on <html>, over the defaults in
// app/globals.css. Every project on this machine runs on the same address, so
// the colours app/layout.js applied before the first paint can be another
// project's: a --cn-* variable that is not in this project's set goes, and the
// default shows again.
export function applyBranding(style, variables) {
  for (const name of Array.from(style)) {
    if (name.startsWith('--cn-') && !(name in variables)) style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(variables)) {
    style.setProperty(name, value);
  }
}
