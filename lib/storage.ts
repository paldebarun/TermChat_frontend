/**
 * All persistence here is local to this browser only. In particular:
 *  - the RSA private key never leaves the device it was generated on.
 *  - message history is kept client-side because the server has no
 *    "conversation history" endpoint by design (it only ever forwards
 *    ciphertext, or queues it briefly for offline delivery).
 *
 * Logging in on a fresh browser with no local private key means old
 * messages encrypted to the previous key can never be read again -
 * that's an inherent, correct property of real end-to-end encryption,
 * not a bug. The UI surfaces this explicitly (see app/login/page.tsx).
 */
import type { AgentRun, Session, StoredMessage } from "./types";

const NS = "termchat";

const k = {
  session: () => `${NS}:session`,
  privkey: (user: string) => `${NS}:${user}:privkey`,
  contacts: (user: string) => `${NS}:${user}:contacts`,
  messages: (user: string, peer: string) => `${NS}:${user}:msgs:${peer.toLowerCase()}`,
  runs: (user: string, peer: string) => `${NS}:${user}:agent:${peer.toLowerCase()}`,
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(k.session(), JSON.stringify(session));
}
export function loadSession(): Session | null {
  return safeParse<Session | null>(localStorage.getItem(k.session()), null);
}
export function clearSession() {
  localStorage.removeItem(k.session());
}

export function savePrivateKey(username: string, pem: string) {
  localStorage.setItem(k.privkey(username), pem);
}
export function loadPrivateKey(username: string): string | null {
  return localStorage.getItem(k.privkey(username));
}
export function hasPrivateKey(username: string): boolean {
  return localStorage.getItem(k.privkey(username)) !== null;
}

export function loadContacts(username: string): string[] {
  return safeParse<string[]>(localStorage.getItem(k.contacts(username)), []);
}
export function addContact(username: string, contact: string) {
  const list = loadContacts(username);
  const normalized = contact.trim();
  if (!normalized) return list;
  if (!list.some((c) => c.toLowerCase() === normalized.toLowerCase())) {
    list.push(normalized);
    localStorage.setItem(k.contacts(username), JSON.stringify(list));
  }
  return list;
}

export function loadMessages(username: string, peer: string): StoredMessage[] {
  return safeParse<StoredMessage[]>(localStorage.getItem(k.messages(username, peer)), []);
}
export function appendMessage(username: string, peer: string, msg: StoredMessage) {
  const list = loadMessages(username, peer);
  if (list.some((m) => m.id === msg.id)) return list;
  list.push(msg);
  localStorage.setItem(k.messages(username, peer), JSON.stringify(list));
  return list;
}

const MAX_STORED_RUNS = 50;

/** Assistant console history for one peer. Runs that were in flight when the
 * page closed can never finish, so they come back as cancelled. */
export function loadRuns(username: string, peer: string): AgentRun[] {
  return safeParse<AgentRun[]>(localStorage.getItem(k.runs(username, peer)), []).map((r) =>
    r.status === "running" ? { ...r, status: "cancelled", finishedAt: r.finishedAt ?? Date.now() } : r
  );
}
export function saveRuns(username: string, peer: string, runs: AgentRun[]) {
  try {
    localStorage.setItem(k.runs(username, peer), JSON.stringify(runs.slice(-MAX_STORED_RUNS)));
  } catch {
    // storage full or unavailable - history just won't survive a reload
  }
}

/* Group conversations reuse the message store under a `g:<groupId>` key.
 * Usernames can't contain ':' so this never collides with a peer. */
export const groupKey = (groupId: string) => `g:${groupId}`;
