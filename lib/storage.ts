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
import type { Session, StoredMessage } from "./types";

const NS = "termchat";

const k = {
  session: () => `${NS}:session`,
  privkey: (user: string) => `${NS}:${user}:privkey`,
  contacts: (user: string) => `${NS}:${user}:contacts`,
  messages: (user: string, peer: string) => `${NS}:${user}:msgs:${peer.toLowerCase()}`,
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
  list.push(msg);
  localStorage.setItem(k.messages(username, peer), JSON.stringify(list));
  return list;
}
