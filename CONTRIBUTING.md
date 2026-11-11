# Contributing

Thanks for looking. This page is the short version of what makes a change easy to accept.

## Getting it running

```bash
npm install
npm test          # the unit suite (Vitest)
npm run build     # lint, then bundle to dist/
npm start         # rebuild on change, served on port 5000 for a local Home Assistant
```

`npm run build` runs the linter first and stops if it fails, so a green build means lint and
bundle both passed. `dist/chartdeck-card.js` is committed on purpose — the Marketplace
(HACS) installs it straight from the repository — so a change to `src/` needs the bundle
rebuilt in the same commit. CI fails if it was not.

## Commit messages matter

Releases are cut by [semantic-release][sr] from the commit history, so the first line
decides the next version number:

| Prefix | Means | Version |
| --- | --- | --- |
| `fix:` | something was wrong and now is not | patch |
| `feat:` | something the card could not do before | minor |
| `docs:`, `chore:`, `refactor:`, `test:`, `ci:` | no release on their own | none |

A `BREAKING CHANGE:` paragraph in the body means a major. Write the body for somebody
reading it in a year: what was wrong, what it does now, and why it was done that way.

## The rules every style follows

- **Drawn by the card itself.** No chart library. If a new style needs maths, it goes in a
  small pure function with tests, not a dependency.
- **Set up from the visual editor.** A new option is not finished until the editor can set
  it. YAML-only options get pushed back.
- **Theme-aware.** Colours come from Home Assistant's theme variables or the card's own
  severity bands, and every style is checked in light and dark.
- **Respects reduced motion.** Animations are skipped when the browser asks for less motion.

## Tests

Anything that can be a pure function should be — scales, band lookups, path geometry — and
pure functions get tests. `npm run coverage` fails if the suite reaches less of the source
than the thresholds in `vitest.config.ts`. What a chart looks like is checked by hand in a
real Home Assistant before release.

## Translations

Chartdeck speaks English, German, Spanish, French, Dutch and Portuguese. To add a language, copy
`src/locales/en.json` to `src/locales/<code>.json`, translate the values (leave every
`{placeholder}` as it is), and add a line for it to `LOADERS` in `src/localize.ts`. Each
language builds into a file of its own that loads only for people using it. A string left out
shows in English. To fix a translation, edit the value in that language's file. No git? Open an issue with the language and your translated file pasted
in, and it will be wired in for you.

## Reporting something

An [issue][issues] with the card's YAML (from "Show code editor"), the entity's state, a
screenshot, and what you expected instead is almost always enough.

[sr]: https://semantic-release.gitbook.io/
[issues]: https://github.com/tempus2016/chartdeck/issues
