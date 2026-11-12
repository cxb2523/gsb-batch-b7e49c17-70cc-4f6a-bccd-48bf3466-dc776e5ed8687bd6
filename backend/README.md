# CanvHQ backend

The API: NestJS 12 (ESM), Prisma 7 on PostgreSQL, Better Auth, CASL for permissions, Zod for validation, S3-compatible storage. In production it also serves the built web app.

```bash
pnpm install --frozen-lockfile
pnpm run generate                    # the Prisma client; needed before building, type-checking or testing
npm run start:dev                    # needs the database and storage: `docker compose up -d db storage` from the repository root
npm test                             # unit tests, no database
pnpm run test:integration            # real Postgres: `docker compose up -d db storage`
npm run lint
npx prisma generate && npx prisma migrate dev --name <change>   # after editing prisma/schema.prisma
```

Never use `prisma db push` or `--accept-data-loss`. Settings are validated at start; see `src/config/env.schema.ts`. How the pieces fit together, and the rules to keep, are in the repository's `AGENTS.md`.
