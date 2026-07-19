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

Импортируйте **корень** репозитория (не `packages/client`).

В настройках проекта:
- **Root Directory** — пусто (`.`)
- **Framework** — Other
- конфиг берётся из `vercel.json` (сборка monorepo → `packages/client/dist`)

`VITE_BASE` не задавайте (по умолчанию `/`).
