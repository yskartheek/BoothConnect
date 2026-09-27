# BoothConnect

Voter field-operations platform: a Flutter app for field volunteers, a Next.js
admin portal and a NestJS API, in one pnpm + Turborepo monorepo.

| Path             | What it is                                         |
| ---------------- | -------------------------------------------------- |
| `apps/api`       | NestJS REST API (`/v1`)                            |
| `apps/admin-web` | Next.js admin portal                               |
| `apps/mobile`    | Flutter app (Android and iOS)                      |
| `packages/`      | Shared packages (ESLint config, later more)        |
| `infra/`         | docker-compose for local services, `.env` template |
| `docs/`          | Setup, plan, ADRs, manual-testing guides           |

**Getting started:** [docs/SETUP.md](docs/SETUP.md).

More: [implementation plan](docs/IMPLEMENTATION_PLAN.md) ·
[architecture decisions](docs/adr/README.md) ·
[manual testing](docs/manual-testing/README.md) ·
[product spec](VOTER_FIELD_OPERATIONS_APP_SPEC.md)
