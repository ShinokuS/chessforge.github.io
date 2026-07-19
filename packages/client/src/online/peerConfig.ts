/** PeerJS / WebRTC options tuned for restrictive networks and VPN. */
export const PEER_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Free Open Relay (Metered) — relays when direct P2P fails behind VPN/NAT
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turns:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export function peerClientOptions(debug = 0): Record<string, unknown> {
  return {
    debug,
    secure: true,
    config: {
      iceServers: PEER_ICE_SERVERS,
      iceCandidatePoolSize: 8,
      sdpSemantics: 'unified-plan',
    },
  };
}

export const HEARTBEAT_MS = 4_000;
export const HEARTBEAT_TIMEOUT_MS = 14_000;
export const RECONNECT_ATTEMPTS = 8;
export const RECONNECT_BASE_DELAY_MS = 800;
export const JOIN_TIMEOUT_MS = 25_000;
