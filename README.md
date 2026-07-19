# Chessforge

Браузерная шахматно-коллекционная игра: колоды с модификациями, бой с ИИ и онлайн по коду комнаты.

## Запуск

```bash
pnpm install
pnpm dev
```

Откройте `http://127.0.0.1:5173/`.

Для **онлайна** во втором терминале:

```bash
pnpm dev:server
```

Vite проксирует `/ws` → `ws://127.0.0.1:8787/ws`.

## Онлайн

Связь идёт через **WebSocket-relay** (не PeerJS). Хост в браузере по-прежнему авторитетен по правилам партии; сервер только склеивает двух игроков в комнате. Так стабильнее через VPN, чем WebRTC.

**Бой → Онлайн** → колода → **Создать комнату** → передайте код. Соперник входит со своей колодой.

### GitHub Pages

Статика на Pages **не может** хостить WebSocket. Нужен отдельный relay (Fly.io / Railway / Render):

```bash
pnpm --filter @chessforge/server start
```

В workflow Pages задайте секрет/env:

```
VITE_WS_URL=wss://your-relay.example.com/ws
```

Без `VITE_WS_URL` кнопка онлайна на проде покажет ошибку конфигурации.

## Деплой (GitHub Pages)

Workflow публикует сборку в ветку `gh-pages`. В Settings → Pages укажите branch **`gh-pages`** / root.
