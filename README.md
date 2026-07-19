# Chessforge

Браузерная шахматно-коллекционная игра: колоды с модификациями, бой с ИИ и онлайн по коду комнаты.

## Запуск

```bash
pnpm install
pnpm dev
```

Откройте `http://127.0.0.1:5173/`.

## Онлайн

Только **GitHub Pages** + PeerJS Cloud (отдельный сервер не нужен).

**Бой → Онлайн** → колода → **Создать комнату** → передайте код. Соперник входит со своей колодой.

Связь peer-to-peer через PeerJS. В жёстких сетях/VPN соединение может быть нестабильным — это ограничение WebRTC без своего TURN, не Pages.

## Деплой (GitHub Pages)

Workflow публикует сборку в ветку `gh-pages`. В Settings → Pages укажите branch **`gh-pages`** / root.

## Деплой (Vercel)

Импортируйте репозиторий. В Project Settings:

- **Root Directory** — пусто (корень) **или** `packages/client`
- **Output Directory** — `dist` (или очистите поле — возьмётся из `vercel.json`)
- **Framework** — Other

В корне `vercel.json` копирует сборку в `/dist`, чтобы Vercel её нашёл.
