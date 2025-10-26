# 🚀 Prisma + Docker + Node.js Backend

A **TypeScript-based backend** built with **Express**, **Prisma**, and **token blacklisting** — fully containerized with Docker, tested with **Jest**, and documented with **Swagger**.  
This project is built for scalability, maintainability, and production readiness.

---

## ⚙️ Tech Stack

| Layer | Technology | Purpose |
|:------|:------------|:--------|
| Language | **TypeScript** | Type safety and developer experience |
| Framework | **Express.js** | Web server framework |
| ORM | **Prisma** | Database modeling and access |
| Cache & Auth | Token blacklisting and caching |
| Testing | **Jest + Supertest** | Unit and integration testing |
| Documentation | **Swagger (swagger-jsdoc + swagger-ui-express)** | API documentation |
| Containerization | **Docker + Docker Compose** | Environment consistency |
| Database | **PostgreSQL** | Persistent data layer |

---

## 🧩 Features

✅ **User Authentication & JWT Token Management**  
✅ **Token Blacklisting** for secure logout and session invalidation  
✅ **Prisma ORM Integration** with PostgreSQL  
✅ **Centralized Error Handling & Validation Middleware**  
✅ **Modular Swagger Documentation** (Superset Swagger Docs)  
✅ **Unit & Integration Testing with Jest + Supertest**  
✅ **Dockerized Environment** (Postgres + App)  
✅ **Layered Architecture** (Controller → Service → Model)  

---

## 🏁 Quick Start

### 1. Prerequisites
- Node.js **v18+**
- Docker & Docker Compose
- npm or yarn

---

### 2. Clone & Install

```bash
git clone <your-repo-url>
cd wallet-system
npm install
```

---

### 3. Environment Setup

Create a `.env` file in the root directory:

```env
DATABASE_URL
REDIS_URL
PORT
NODE_ENV
JWT_SECRET
expiresIn
```

---

### 4. Configuration Directory

Create a `/config` folder with Prisma config:

```
config/
├── db.ts
```

Example `db.ts`:
```
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
export default prisma;

```

---

### 5. Run with Docker (Recommended)

```bash
docker-compose up --build
# or in background
docker-compose up -d --build
```

---

### 6. Database Initialization

```bash
npx prisma generate
npx prisma db push
```

---

## 🧪 Testing

Unit & integration tests are written with **Jest** and **Supertest**.

Run all tests:
```bash
npm run test
```

---

## 🧰 Development Scripts

| Command | Description |
|:--------|:-------------|
| `npm run dev` | Start development server with Nodemon |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run compiled project in production |
| `npm run db:studio` | Open Prisma Studio |
| `npm run lint` | Run ESLint for code quality |
| `npm run test` | Run Jest test suite |

---

## 📚 API Documentation (Swagger)

Swagger Docs are auto-generated using **swagger-jsdoc** and served via **swagger-ui-express**.

Access Swagger UI:
```
http://localhost:3000/api-docs
```

**Swagger Setup Example (`src/swagger-docs/swagger.ts`):**
```ts
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Wallet System API",
      version: "1.0.0",
      description: "API documentation for Prisma Wallet System",
    },
    servers: [
      {
        url: `http://localhost:${port}`,
      },
    ],
  },
  apis: ["./src/swagger-docs/*.docs.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
export const swaggerDocs = (app: any) => {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};
```

---

## 🔒 Token Blacklisting

Development stage token blacklisting is used to **invalidate JWT tokens** after logout.
```ts
const blacklistedTokens = new Set<string>();

// Add token to blacklist
export const addToBlacklist = (token: string) => {
  blacklistedTokens.add(token);
};

// Check if token is blacklisted
export const isBlacklisted = (token: string): boolean => {
  return blacklistedTokens.has(token);
};

// Optional: clean up expired tokens automatically
export const addToBlacklistWithExpiry = (token: string, expiresIn: number) => {
  blacklistedTokens.add(token);
  setTimeout(() => blacklistedTokens.delete(token), expiresIn * 1000); // expiresIn in seconds
};
```

**Redis** Logic can be implemented also.

**Key logic (simplified):** in the case of using **Redis**
```ts
import { redisClient } from "../services/redis.service";

export const blacklistToken = async (token: string) => {
  await redisClient.set(token, "blacklisted", "EX", 60 * 60 * 24);
};

export const isBlacklisted = async (token: string) => {
  const value = await redisClient.get(token);
  return value === "blacklisted";
};
```

---

## 🧱 Project Structure

```
src/
├── app.ts                # Express app setup
├── server.ts             # Entry point
├── config/               # Config module
├── controllers/          # Route handlers
├── middleware/           # Auth & validation middleware
├── routes/               # API routes
├── services/             # Business logic
├── swagger-docs/         # Swagger modular docs
├── tests/                # Jest unit & integration tests
└── utils/                # Helpers, responses, and utilities
```

---

## 🐳 Docker Overview

**docker-compose.yml:**
```yaml
version: "3.8"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: mydb
    ports:
      - "5432:5432"
```

---

## 🚨 Troubleshooting

| Issue | Fix |
|:------|:----|
| `Port already in use` | Change ports in `.env` or `docker-compose.yml` |
| `Prisma errors` | Run `npx prisma generate` and `npx prisma db push` |
| Tests failing due to DB | Run containers before executing tests |

---

## 🧠 Future Enhancements
- Add **role-based access control (RBAC)**
- Implement **rate limiting** and **token blacklisting** with Redis
- CI/CD pipeline with GitHub Actions
- Deployment-ready Helm chart for Kubernetes
- Real-time notifications (WebSocket or Socket.IO)

---
