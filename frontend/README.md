# CanvHQ frontend

The web app: React 19, Vite, Tailwind, Excalidraw, TanStack Query and Zod. All encryption happens here, in `src/lib/crypto.ts` and `src/lib/keys/`.

```bash
pnpm install --frozen-lockfile
npm run dev                # http://localhost:5173, proxies /api to the backend
npm test                   # unit tests (vitest, jsdom)
npm run lint
npm run build              # also writes dist/THIRD_PARTY_LICENSES.txt
pnpm run test:e2e          # needs the dev stack running; see e2e/README.md
pnpm run test:e2e:image    # needs the production image in demo mode; see e2e/README.md
```

Colours come from the tokens in `src/index.css`; arbitrary hex classes fail a test. How the pieces fit together, and the rules to keep, are in the repository's `AGENTS.md`.
