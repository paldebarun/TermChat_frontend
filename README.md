# termchat — frontend

A terminal-styled Next.js client for the FastAPI end-to-end encrypted chat
backend. Users register, get an RSA-2048 keypair generated **in their own
browser**, and chat in realtime over the backend's `/ws` endpoint. All
encryption/decryption happens client-side with the Web Crypto API, using the
exact same scheme as the backend's `client/crypto_utils.py` reference
implementation (RSA-OAEP/SHA-256 wrapping a per-message AES-256-GCM key), so
this frontend is a drop-in, browser-native replacement for that reference
Python client.

## What this does and doesn't do

- **Does**: signup, login (JWT access + refresh), realtime send/receive over
  the websocket, per-message end-to-end encryption, an "add contact" flow
  (there is no server-side contacts/discovery endpoint, so this frontend
  looks a username up via `GET /users/{username}/public-key` and remembers
  it locally), and local message history (also client-only, since the
  backend has no history endpoint — it only queues undelivered messages
  briefly for offline delivery).
- **Doesn't**: recover messages if you log in on a device that never had
  your private key. That's inherent to real E2E encryption, not a bug — the
  server never has your private key, so nobody but this browser could ever
  decrypt those messages. The login page explains this and offers to
  generate a fresh keypair when it happens.

## Setup

```bash
npm install
cp .env.example .env.local
# edit .env.local if your backend isn't on localhost:8000
npm run dev
```

Open http://localhost:3000. Make sure the backend (from the attached repo)
is running first — `docker compose up --build` in that repo, by default at
`http://localhost:8000` / `ws://localhost:8000/ws`, which is what
`.env.example` points at.

## Environment variables

| Variable              | Purpose                                   | Default                     |
|------------------------|--------------------------------------------|------------------------------|
| `NEXT_PUBLIC_API_URL`  | Base URL of the FastAPI REST API           | `http://localhost:8000`     |
| `NEXT_PUBLIC_WS_URL`   | Base URL of the websocket endpoint         | `ws://localhost:8000/ws`    |

## Trying it end-to-end

1. Register two accounts in two browser tabs/profiles (e.g. `alice` and
   `bob`) — each generates and uploads its own public key on signup.
2. In alice's tab, add `bob` as a contact and send a message.
3. It arrives instantly in bob's tab if bob is online, decrypted locally;
   otherwise it's delivered the next time bob connects (server-side queue).

## Project layout

```
app/
  layout.tsx          root layout, wires AuthProvider + global styles
  page.tsx            "/" — redirects to /chat or /login
  login/page.tsx       login form + "key missing on this device" recovery flow
  register/page.tsx    signup form, generates & uploads the RSA keypair
  chat/page.tsx         main chat screen: sidebar + conversation + websocket wiring
  globals.css          terminal theme (CRT scanlines, monospace, phosphor palette)
lib/
  api.ts               REST calls to the FastAPI backend
  crypto.ts             Web Crypto implementation of the RSA-OAEP + AES-256-GCM scheme
  storage.ts             localStorage helpers (session, private key, contacts, history)
  auth-context.tsx       React context: session, tokens, refresh-on-expiry, keys
  useWebSocket.ts         websocket connect/reconnect/decrypt hook
  types.ts                shared TypeScript types matching the backend's Pydantic schemas
components/
  TerminalWindow.tsx      shared terminal window chrome
  Sidebar.tsx             contact list + connection status + logout
  ChatWindow.tsx          message log + composer
```

## Notes

- Private keys are stored in `localStorage`, namespaced per username, and
  are never transmitted anywhere. For a real production deployment you'd
  want to encrypt them at rest with a user-supplied passphrase (e.g. via
  WebCrypto's PBKDF2 + AES-KW) rather than storing the PEM in the clear —
  left out here to keep the reference implementation readable, matching
  the backend repo's own "reference implementation" framing.
- The websocket auto-reconnects (with a fresh access token, refreshing via
  the refresh token if needed) if the connection drops or the access token
  expires mid-session.
