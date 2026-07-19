# Chessforge

Браузерная шахматно-коллекционная игра: колоды с модификациями фигур, бой с ИИ и онлайн по ссылке-приглашению.

## Стек

- `@chessforge/engine` — правила
- `@chessforge/ai` — поиск хода и сборка колоды ИИ
- `@chessforge/client` — Vite + React (GitHub Pages)

Онлайн — **PeerJS / WebRTC** (отдельный игровой сервер не нужен).

## Локальный запуск

```bash
pnpm install
unset VITE_BASE
pnpm dev
```

Откройте `http://127.0.0.1:5173/`.

## Деплой на GitHub Pages (важно)

Сайт собирается в ветку **`gh-pages`**. Один раз настройте Pages:

1. Репозиторий → **Settings → Pages**
2. **Build and deployment → Source**: **Deploy from a branch**
3. **Branch**: `gh-pages` / folder `/ (root)` → Save

После пуша в `main` workflow **Deploy GitHub Pages** соберёт клиент и обновит `gh-pages`.

Адрес проекта:

`https://<user>.github.io/<имя-репозитория>/`

Для этого репо: **https://ShinokuS.github.io/chessforge.github.io/**

> Если открывается «документация» Jekyll / README вместо игры — Pages всё ещё смотрит на ветку `main`. Переключите source на `gh-pages`, как выше.
