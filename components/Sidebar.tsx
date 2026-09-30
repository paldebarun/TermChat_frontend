"use client";

import { useState } from "react";
import type { ConnStatus } from "@/lib/useWebSocket";

export function Sidebar({
  username,
  status,
  contacts,
  activePeer,
  unread,
  onSelect,
  onAddContact,
  onLogout,
  addError,
  adding,
}: {
  username: string;
  status: ConnStatus;
  contacts: string[];
  activePeer: string | null;
  unread: Record<string, number>;
  onSelect: (peer: string) => void;
  onAddContact: (name: string) => void;
  onLogout: () => void;
  addError: string | null;
  adding: boolean;
}) {
  const [draft, setDraft] = useState("");

  const statusMeta: Record<ConnStatus, { label: string; color: string }> = {
    connecting: { label: "connecting…", color: "var(--warn)" },
    open: { label: "online", color: "var(--accent)" },
    closed: { label: "reconnecting…", color: "var(--warn)" },
    error: { label: "offline", color: "var(--err)" },
  };
  const meta = statusMeta[status];

  return (
    <div
      style={{
        width: 260,
        minWidth: 260,
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-raised)",
      }}
    >
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ fontSize: 13 }}>
          <span className="prompt">user@termchat</span>
          <span className="dim">:~$</span> {username}
        </div>
        <div style={{ fontSize: 12, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: meta.color,
              display: "inline-block",
            }}
          />
          <span className="dim">{meta.label}</span>
        </div>
      </div>

      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
        <div className="dim" style={{ fontSize: 11, marginBottom: 6, letterSpacing: "0.03em" }}>
          add contact
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            onAddContact(draft.trim());
            setDraft("");
          }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            className="field"
            placeholder="username"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ fontSize: 13, padding: "6px 8px" }}
          />
          <button className="btn" type="submit" disabled={adding} style={{ padding: "6px 10px" }}>
            +
          </button>
        </form>
        {addError && (
          <div className="err-text" style={{ fontSize: 11, marginTop: 6 }}>
            ! {addError}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {contacts.length === 0 && (
          <div className="dim" style={{ padding: 16, fontSize: 12, lineHeight: 1.6 }}>
            no contacts yet. add a registered username above to start an encrypted
            conversation.
          </div>
        )}
        {contacts.map((c) => (
          <button
            key={c}
            onClick={() => onSelect(c)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              textAlign: "left",
              padding: "10px 16px",
              background: activePeer === c ? "var(--bg)" : "transparent",
              border: "none",
              borderLeft: activePeer === c ? "2px solid var(--accent)" : "2px solid transparent",
              color: activePeer === c ? "var(--fg)" : "var(--fg-dim)",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          >
            <span>{c}</span>
            {unread[c] > 0 && (
              <span
                style={{
                  fontSize: 11,
                  color: "#06120a",
                  background: "var(--accent)",
                  padding: "1px 6px",
                }}
              >
                {unread[c]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
        <button className="btn-quiet" style={{ width: "100%" }} onClick={onLogout}>
          logout
        </button>
      </div>
    </div>
  );
}
