# Contributing to Wallet System

Thank you for considering contributing! This document outlines how to get set up and how to submit changes.

## Development Setup

**Prerequisites:** Node.js 18+, Docker, npm

```bash
git clone <repo-url>
cd wallet-system
npm install
cp .env.example .env        # fill in your values
docker-compose up -d        # start Postgres + Redis
npx prisma migrate dev      # run migrations
npm run dev                 # start the dev server
```

The API will be available at `http://localhost:3000` and Swagger docs at `http://localhost:3000/api-docs`.

## Running Tests

Tests use a separate database defined in `.env.test`. Create it before running:

```bash
cp .env.example .env.test   # fill in test DB credentials
npm test
```

All tests must pass before a PR is accepted.

## Code Style

- **TypeScript strict mode is on** — no `any` types, no implicit nulls
- No comments explaining *what* the code does — only *why* when non-obvious
- Follow the existing layered pattern: route → controller → service → Prisma
- Response format must use the existing `successResponse` / `errorResponse` utilities

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`: `git checkout -b feat/your-feature`
2. Make your changes, add tests for new behaviour
3. Run `npm test` — all tests must pass
4. Run `npm run build` — TypeScript must compile without errors
5. Open a PR with a clear title and description explaining the *why* of the change

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
src/
├── controllers/   HTTP request handling, input validation
├── services/      Business logic, database access
├── middleware/    Auth, error handling
├── routes/        Express route definitions
├── utils/         Shared helpers (JWT, responses, validation)
├── swagger-docs/  OpenAPI documentation
└── config/        Prisma client singleton
prisma/
├── schema.prisma  Database schema
└── migrations/    Migration history
```
