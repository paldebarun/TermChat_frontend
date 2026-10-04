"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { CenteredScreen, TerminalWindow } from "@/components/TerminalWindow";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { login, keyMissing, regenerateKeys, logout } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const hasPrivateKey = await login(username, password);
      console.log("login result:", hasPrivateKey);
      if (hasPrivateKey) {
      router.replace("/chat");
    }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "login failed - is the server running?");
    } finally {
      setBusy(false);
    }
  }

  if (keyMissing) {
    return (
      <CenteredScreen>
        <TerminalWindow title="termchat — key missing">
          <p style={{ marginTop: 0, fontSize: 13 }}>
            <span className="err-text">! no local private key found for this account</span>
          </p>
          <p className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
            this is expected the first time you log in on a new browser or device.
            because messages are end-to-end encrypted, decrypting old conversations
            requires the original private key, which never leaves the device it was
            created on and cannot be recovered.
            <br />
            <br />
            you can generate a new keypair now. this lets you send and receive new
            messages normally, but conversations encrypted under your old key will
            stay unreadable on this device.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              className="btn"
              disabled={regenerating}
              onClick={async () => {
                setRegenerating(true);
                try {
                  await regenerateKeys();
                  router.replace("/chat");
                } catch {
                  setError("could not generate a new keypair - is the server running?");
                  setRegenerating(false);
                }
              }}
            >
              {regenerating ? "> generating…" : "> generate new keypair"}
            </button>
            <button className="btn-quiet" onClick={logout}>
              cancel / log out
            </button>
          </div>
          {error && <div className="err-text" style={{ marginTop: 12 }}>! {error}</div>}
        </TerminalWindow>
      </CenteredScreen>
    );
  }

  return (
    <CenteredScreen>
      <TerminalWindow title="termchat — login">
        <pre style={{ margin: "0 0 16px", color: "var(--accent)", fontSize: 12, lineHeight: 1.3 }}>
{`  _                     _           _
 | |_ ___ _ __ _ __ ___| |__   __ _| |_
 | __/ _ \\ '__| '_ \` _ \\ '_ \\ / _\` | __|
 | ||  __/ |  | | | | | | | | (_| | |_
  \\__\\___|_|  |_| |_| |_|_| |_|\\__,_|\\__|`}
        </pre>
        <p className="dim" style={{ marginTop: 0, marginBottom: 18, fontSize: 13 }}>
          end-to-end encrypted realtime chat. authenticate to continue.
        </p>

        <form onSubmit={onSubmit}>
          <label style={{ display: "block", marginBottom: 12 }}>
            <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>
              <span className="prompt">$</span> username
            </div>
            <input
              className="field"
              value={username}
              autoFocus
              required
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label style={{ display: "block", marginBottom: 12 }}>
            <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>
              <span className="prompt">$</span> password
            </div>
            <div className="pw-wrap">
              <input
                className="field"
                type={showPassword ? "text" : "password"}
                value={password}
                required
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="btn-quiet pw-toggle"
                aria-label={showPassword ? "hide password" : "show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "hide" : "show"}
              </button>
            </div>
          </label>

          {error && <div className="err-text" style={{ marginBottom: 12 }}>! {error}</div>}

          <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "> authenticating…" : "> login"}
          </button>
        </form>

        <div style={{ marginTop: 18, fontSize: 13 }} className="dim">
          no account yet?{" "}
          <Link href="/register">
            <span className="prompt">register</span>
          </Link>
        </div>
      </TerminalWindow>
    </CenteredScreen>
  );
}
