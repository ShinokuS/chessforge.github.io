# Chessforge online relay

Thin **WebSocket room relay** — no game logic. The host browser stays authoritative
(same `PeerMessage` protocol as before). PeerJS/WebRTC was dropped because VPN/NAT
often blocks P2P without a reliable TURN; WSS works over typical VPNs.

## Local

```bash
pnpm --filter @chessforge/server dev
# → ws://127.0.0.1:8787/ws
```

Client Vite proxies `/ws` to this port in `pnpm dev`.

## Production

Deploy this package (Fly.io / Railway / Render), then set for the Pages build:

```
VITE_WS_URL=wss://your-relay.example.com/ws
```

Without `VITE_WS_URL`, production online mode will show a clear configuration error.
