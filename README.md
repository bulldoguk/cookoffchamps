# Cookoff Champs

A small web app for friendly family cookoffs, at cookoffchamps.com.

An organizer creates an event, photographs each dish and prints a QR poster. Guests scan the code and vote for their favourite dish without knowing who cooked it. When voting closes, a reveal screen shows 3rd, 2nd and then 1st place, one click at a time.

## Stack

It runs entirely on Cloudflare's free tier:

- **Workers:** the API, plus static assets for the frontend
- **D1:** events, entries and votes
- **R2:** photos
- **Turnstile:** keeps scripted votes out

Login emails go through [Resend](https://resend.com)'s free plan. (Cloudflare Email Sending needs the paid Workers plan.)

## Development

```sh
npm install
npm run db:migrate:local
npm run dev        # http://localhost:8787
```

In development, magic-link emails are kept in a dev outbox instead of sent (`EMAIL_MODE=log`): open http://localhost:8787/api/dev/outbox to see them.

## Tests

```sh
npm test
npm run coverage   # fails below 100% lines, branches, functions or statements
```

API tests run inside the Workers runtime against local D1 and R2, through `@cloudflare/vitest-plugin`. Coverage is measured with istanbul and must stay at 100%. CI enforces this on every push and pull request. If any code is excluded from coverage, the comment that excludes it must say why.

## License

MIT
