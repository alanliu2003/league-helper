# Milestone 6 Implementation Plan (executed)

> Implemented via Option C → stage toward Option A (`packages/server-riot`).

**Goal:** Consume `INGEST_MATCH` jobs and resolve champion IDs via Data Dragon.

**Architecture:** Framework-free Riot transport in `@league-helper/server-riot`; worker owns Prisma + BullMQ processor; API owns Nest DI, Data Dragon, public DTOs.

**Tech stack:** NestJS, BullMQ, Prisma, Redis, Zod, Nuxt, Vitest.

See `docs/superpowers/specs/2026-08-05-milestone-6-design.md` for the approved design.
