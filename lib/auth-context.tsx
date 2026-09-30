"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "./api";
import { generateKeyPair } from "./crypto";
import * as store from "./storage";
import type { Session } from "./types";

interface AuthState {
  ready: boolean;
  session: Session | null;
  privateKeyPem: string | null;
  keyMissing: boolean;
  register: (username: string, email: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  getFreshAccessToken: () => Promise<string>;
  regenerateKeys: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [privateKeyPem, setPrivateKeyPem] = useState<string | null>(null);
  const [keyMissing, setKeyMissing] = useState(false);

  useEffect(() => {
    const existing = store.loadSession();
    if (existing) {
      setSession(existing);
      const pem = store.loadPrivateKey(existing.username);
      if (pem) {
        setPrivateKeyPem(pem);
      } else {
        setKeyMissing(true);
      }
    }
    setReady(true);
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    await api.signup(username, email, password);
    const tokens = await api.login(username, password);
    const { publicKeyPem, privateKeyPem: privPem } = await generateKeyPair();
    await api.updatePublicKey(tokens.access_token, publicKeyPem);

    store.savePrivateKey(username, privPem);
    const s: Session = {
      username,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
    store.saveSession(s);
    setSession(s);
    setPrivateKeyPem(privPem);
    setKeyMissing(false);
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      const tokens = await api.login(username, password);

      const s: Session = {
        username,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      };

      store.saveSession(s);
      setSession(s);

      const pem = store.loadPrivateKey(username);

      if (pem) {
        setPrivateKeyPem(pem);
        setKeyMissing(false);

        // Private key exists → safe to enter chat
        return true;
      }

      setPrivateKeyPem(null);
      setKeyMissing(true);

      // No private key → stay on login page and show recovery UI
      return false;
    },
    []
  );

  const logout = useCallback(() => {
    store.clearSession();
    setSession(null);
    setPrivateKeyPem(null);
    setKeyMissing(false);
  }, []);

  const getFreshAccessToken = useCallback(async (): Promise<string> => {
    const current = store.loadSession();
    if (!current) throw new Error("not authenticated");
    try {
      await api.getMe(current.access_token);
      return current.access_token;
    } catch {
      const tokens = await api.refreshTokens(current.refresh_token);
      const s: Session = {
        username: current.username,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      };
      store.saveSession(s);
      setSession(s);
      return s.access_token;
    }
  }, []);

  const regenerateKeys = useCallback(async () => {
    if (!session) throw new Error("not authenticated");
    const { publicKeyPem, privateKeyPem: privPem } = await generateKeyPair();
    const token = await getFreshAccessToken();
    await api.updatePublicKey(token, publicKeyPem);
    store.savePrivateKey(session.username, privPem);
    setPrivateKeyPem(privPem);
    setKeyMissing(false);
  }, [session, getFreshAccessToken]);

  return (
    <AuthContext.Provider
      value={{
        ready,
        session,
        privateKeyPem,
        keyMissing,
        register,
        login,
        logout,
        getFreshAccessToken,
        regenerateKeys,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
