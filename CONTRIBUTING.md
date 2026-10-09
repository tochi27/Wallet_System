# Contributing to Wallet System

Thank you for considering contributing! This document outlines how to get set up and how to submit changes.

## Branch Strategy

- **`main`** — stable, production-ready. Never commit directly to this branch.
- **`wallet-dev`** — integration branch. All contributions go here first.

Fork the repo, branch off `wallet-dev`, and open your PR back into `wallet-dev`. Direct PRs to `main` will not be accepted.

## Development Setup

**Prerequisites:** Node.js 20+, Docker, npm

```bash
git clone <repo-url>
cd wallet-system
npm install                                              # installs all workspaces
cp apps/api/.env.example apps/api/.env.development       # fill in your values
docker compose up -d postgres redis                      # start Postgres + Redis
npm run db:migrate                                       # run migrations
npm run dev:api                                          # start the API dev server
```

This is an npm workspaces monorepo. Run commands from the repo root; the root scripts forward to the right app (for example `npm run test:api` runs `npm run test -w apps/api`).

The API will be available at `http://localhost:4000` and Swagger docs at `http://localhost:4000/api-docs`.

## Running Tests

All tests are fully mocked — no running database or Redis required.

```bash
npm run test:api
```

All tests must pass before a PR is accepted. TypeScript must also compile without errors:

```bash
npm run build:api
```

## Code Style

- **TypeScript strict mode is on** — no `any` types, no implicit nulls
- No comments explaining *what* the code does — only *why* when non-obvious
- Follow the existing layered pattern: route → controller → service → Prisma
- New behaviour must be covered by tests

## Submitting a Pull Request

1. Fork the repo and create a branch off `wallet-dev`: `git checkout -b feat/your-feature`
2. Make your changes and add tests for new behaviour
3. Run `npm run test:api` — all tests must pass
4. Run `npm run build:api` — TypeScript must compile without errors
5. Open a PR against `wallet-dev` with a clear title and description explaining the *why* of the change

## Commit Message Format

Use the conventional commits style:

```
feat: add transfer endpoint
fix: correct insufficient balance error code to 400
chore: remove unused config package
```

## Reporting Issues

Open a GitHub issue with:
- A short description of the bug or feature request
- Steps to reproduce (for bugs)
- Expected vs actual behaviour

## Project Structure

```
apps/
├── api/                          # Express REST API
│   ├── src/
│   │   ├── app.ts                # Express app setup, middleware, workers
│   │   ├── server.ts             # Entry point
│   │   ├── config/               # Prisma client, env validation, logger, Redis config
│   │   ├── controllers/          # HTTP request handling
│   │   ├── middleware/           # Auth, validation, rate limiting
│   │   ├── queues/               # BullMQ queue definitions
│   │   ├── routes/               # Express route definitions
│   │   ├── services/             # Business logic and database access
│   │   ├── swagger-docs/         # Modular OpenAPI/Swagger JSDoc comments
│   │   ├── tests/
│   │   │   ├── integration/      # Supertest controller tests
│   │   │   └── unit/             # Service and worker unit tests
│   │   ├── utils/                # Helpers (JWT, locks, cache, idempotency)
│   │   ├── validators/           # Zod request schemas
│   │   └── workers/              # BullMQ worker processes
│   └── prisma/
│       ├── schema.prisma         # Database schema
│       └── migrations/           # Migration history
└── web/                          # Frontend (coming soon)
```
