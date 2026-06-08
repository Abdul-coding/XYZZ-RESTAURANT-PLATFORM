# XYZZ Smart Restaurant Platform

Production-oriented NestJS MVP implementing the approved V1 backend architecture:

- QR dining sessions with anonymous session tokens
- Branch-specific menus, variants, add-ons, and configurable tax snapshots
- Payment-before-order workflow with idempotent payment references
- Load-balanced waiter assignment
- FCFS kitchen queue and item-level ready/delivered tracking
- JWT/RBAC staff security and SSE notifications
- Ratings, complaints, tips, audit-ready schema, PostgreSQL, Redis, and RabbitMQ infrastructure

## Run locally

```bash
cp .env.example .env
docker compose up -d postgres redis rabbitmq
npm install
npx prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
```

Health check: `GET http://localhost:3000/api/v1/health`

Seeded admin: `admin@xyzz.local` / `ChangeMe123!` (change immediately outside local development).

## Demo payment mode

With `PAYMENT_DEMO_MODE=true`, order creation accepts unique references beginning with
`demo_pay_`. Production must disable this and connect a signature-verified Razorpay or
Stripe webhook. The server never accepts an arbitrary client payment-success flag.

API responses follow the project contract:

```json
{ "success": true, "data": {}, "message": "Success" }
```
