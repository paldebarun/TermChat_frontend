"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { wsUrl } from "./api";
import { decryptMessage } from "./crypto";
import type { WireError, WireMessageIn, WireMessageOut } from "./types";

export type ConnStatus = "connecting" | "open" | "closed" | "error";

interface UseWsArgs {
  username: string | null;
  privateKeyPem: string | null;
  getFreshAccessToken: () => Promise<string>;
  onIncoming: (msg: {
  peer: string;
  text: string;
  timestamp: string;
  id: string;
  attachment?: WireMessageOut["attachment"];
}) => void;
  onSystem: (line: string) => void;
}

export function useWebSocket({
  username,
  privateKeyPem,
  getFreshAccessToken,
  onIncoming,
  onSystem,
}: UseWsArgs) {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const closedByUs = useRef(false);
  const onIncomingRef = useRef(onIncoming);
  const onSystemRef = useRef(onSystem);
  onIncomingRef.current = onIncoming;
  onSystemRef.current = onSystem;

  // Bumped every time the effect is torn down, so an in-flight connect()
  // from a *previous* mount (e.g. React Strict Mode's dev-only double
  // mount, or an overlapping reconnect) can detect it's stale and bail
  // out instead of opening a second, orphaned socket. Without this, two
  // live connections can end up registered for the same user, and the
  // server (by design, for multi-device support) forwards every message
  // to all of a user's open connections - which looks like each message
  // arriving twice in a single tab.
  const generationRef = useRef(0);

  const connect = useCallback(async () => {
    if (!username || !privateKeyPem) return;
    const myGeneration = ++generationRef.current;
    setStatus("connecting");
    let token: string;
    try {
      token = await getFreshAccessToken();
    } catch {
      if (myGeneration !== generationRef.current) return; // superseded while awaiting
      setStatus("error");
      onSystemRef.current("auth failed - could not obtain a session token");
      return;
    }
    if (myGeneration !== generationRef.current) return; // superseded while awaiting

    // Guard against ever having two sockets open at once for any other reason.
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      wsRef.current.close();
    }

    const ws = new WebSocket(wsUrl(token));
    wsRef.current = ws;
    closedByUs.current = false;

    ws.onopen = () => {
      setStatus("open");
      onSystemRef.current("connection established");
    };

    ws.onmessage = async (ev) => {
      let data: WireMessageOut | WireError;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (data.type === "error") {
        onSystemRef.current(`server: ${data.detail}`);
        return;
      }
      if (data.type === "message") {
        try {
          const text = await decryptMessage(privateKeyPem, data);
          onIncomingRef.current({
  peer: data.sender,
  text,
  timestamp: data.timestamp,
  id: data.message_id,
  attachment: data.attachment,
});
        } catch {
          onSystemRef.current(`failed to decrypt an incoming message from ${data.sender}`);
        }
      }
    };

    ws.onclose = (ev) => {
      if (myGeneration !== generationRef.current) return; // a newer connect() owns the socket now
      setStatus("closed");
      wsRef.current = null;
      if (closedByUs.current) return;
      onSystemRef.current(
        ev.code === 1008 ? "session expired - reconnecting" : "connection lost - reconnecting"
      );
      setTimeout(() => {
        if (myGeneration !== generationRef.current) return; // effect was torn down meanwhile
        connect();
      }, 1500);
    };

    ws.onerror = () => {
      if (myGeneration !== generationRef.current) return;
      setStatus("error");
    };
  }, [username, privateKeyPem, getFreshAccessToken]);

  useEffect(() => {
    connect();
    return () => {
      closedByUs.current = true;
      generationRef.current++; // invalidate this connect() attempt, in flight or not
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect]);

  const sendEncrypted = useCallback((payload: WireMessageIn) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  return { status, sendEncrypted };
}