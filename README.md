# Chessforge

Браузерная шахматно-коллекционная игра: колоды с модификациями, бой с ИИ и онлайн по коду комнаты.

## Запуск

```bash
pnpm install
pnpm dev
```

Откройте `http://127.0.0.1:5173/`.

## Онлайн (без своего сервера)

PeerJS/WebRTC **не используется** — через VPN он постоянно ломается (`ICE failed`).

Онлайн идёт через **Firebase Realtime Database** (обычный HTTPS). Сайт по-прежнему только на GitHub Pages или Vercel.

### Один раз настроить Firebase (~3 минуты)

1. [console.firebase.google.com](https://console.firebase.google.com/) → Create project  
2. **Build → Realtime Database → Create** (регион любой)  
3. Rules → Publish:

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    }
  }
}
```

4. Project settings → Your apps → **Web** → скопировать конфиг  
5. В `packages/client/.env` (локально) и в Vercel/GitHub Actions **Environment Variables**:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=....firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://....firebaseio.com
VITE_FIREBASE_PROJECT_ID=...
```

6. Задеплоить снова.

Без этих переменных онлайн покажет понятную ошибку настройки, а не ICE.

## Деплой (GitHub Pages)

Workflow → ветка `gh-pages`. Добавьте те же `VITE_FIREBASE_*` в Actions secrets/vars и прокиньте в workflow `env` при `build`.

## Деплой (Vercel)

Root Directory — корень репо. Output — `dist` (`vercel.json`).  
Те же `VITE_FIREBASE_*` в Project → Environment Variables.
