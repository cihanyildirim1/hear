# Hear Frontend

Next.js frontend for Hear (real-time chat + ASL experience).

## Local development

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env.local
```

Set:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

3. Start dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Deploy on Vercel

1. Import this repository in Vercel.
2. Set environment variable:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain.com
```

3. Deploy.

## Important

- This frontend requires a deployed backend API/WebSocket server.
- Do not commit real `.env` files. Use `.env.example` and `.env.production.example` as templates.
