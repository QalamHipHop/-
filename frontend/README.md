# ﷼ Rial — Frontend

Next.js 15 + React 19 + Tailwind v3 + Lightweight Charts. App Router, TypeScript, fully typed.

## Scripts

```bash
pnpm dev        # localhost:3000
pnpm build      # production build
pnpm start      # production server
pnpm lint
pnpm typecheck
```

## Structure

```
src/
├── app/                      # App Router
│   ├── api/health/           # health endpoint
│   ├── trade/[symbol]/       # trading view (chart, order book, form)
│   ├── launchpad/            # launchpad list + new launch + detail
│   ├── portfolio/            # holdings, orders, history
│   ├── admin/                # moderation dashboard
│   ├── settings/             # profile, security, notifications
│   ├── login/  register/     # auth
│   ├── layout.tsx            # shell
│   └── page.tsx              # home (hero, ticker, features)
├── components/
│   ├── ui/                   # primitives (Button, Card, Dialog, …)
│   ├── auth/                 # auth provider + hooks
│   ├── layout/               # header, footer, theme toggle
│   └── market/               # chart, order book, trades, form
├── lib/
│   ├── api.ts                # typed fetch client
│   ├── ws.ts                 # WebSocket client w/ reconnect & heartbeat
│   ├── env.ts                # env validation
│   ├── format.ts             # currency / Rial formatters
│   └── utils.ts              # cn(), timeAgo(), …
```

## Environment

```bash
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
NEXT_PUBLIC_GRAPHQL_URL=http://localhost:8080/graphql
API_INTERNAL_URL=http://backend:8080   # for Docker rewrites
PUBLIC_BASE_URL=http://localhost:3000
```

## Notes

- Internal settlement symbol `﷼` is rendered via the env config (`SETTLEMENT_TOKEN_SYMBOL`).
- All charts use Lightweight Charts; candles are loaded from `/api/tokens/:symbol/candles?tf=…`.
- Live data flows over a single WebSocket connection per browser tab (auto-reconnect, heartbeat).
- All forms use `react-hook-form` + `zod` schemas.
