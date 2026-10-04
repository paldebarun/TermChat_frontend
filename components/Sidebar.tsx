"use client";

import { useState } from "react";
import type { ConnStatus } from "@/lib/useWebSocket";
import type { GroupSummary } from "@/lib/types";

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
  groups,
  activeGroupId,
  onSelectGroup,
  onCreateGroup,
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
  groups: GroupSummary[];
  activeGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  /** resolves to an error message, or null on success */
  onCreateGroup: (name: string, members: string[]) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);

  async function submitGroup(e: React.FormEvent) {
    e.preventDefault();
    const name = groupName.trim();
    const members = Array.from(
      new Set(groupMembers.split(/[\s,]+/).map((m) => m.trim()).filter(Boolean))
    );
    if (!name) {
      setGroupError("name required");
      return;
    }
    setGroupBusy(true);
    setGroupError(null);
    const err = await onCreateGroup(name, members);
    setGroupBusy(false);
    if (err) {
      setGroupError(err);
      return;
    }
    setCreating(false);
    setGroupName("");
    setGroupMembers("");
  }

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
        <div
          style={{
            padding: "10px 16px 6px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span className="dim" style={{ fontSize: 11, letterSpacing: "0.03em" }}>
            groups
          </span>
          <button
            type="button"
            className="btn-quiet"
            style={{ padding: "0 8px", fontSize: 12 }}
            onClick={() => {
              setCreating((v) => !v);
              setGroupError(null);
            }}
            title="Create group"
          >
            {creating ? "×" : "+ new"}
          </button>
        </div>

        {creating && (
          <form
            onSubmit={submitGroup}
            style={{ padding: "0 16px 10px", display: "flex", flexDirection: "column", gap: 6 }}
          >
            <input
              className="field"
              placeholder="group name"
              value={groupName}
              maxLength={100}
              onChange={(e) => setGroupName(e.target.value)}
              style={{ fontSize: 13, padding: "6px 8px" }}
            />
            <input
              className="field"
              placeholder="members: alice, bob"
              value={groupMembers}
              onChange={(e) => setGroupMembers(e.target.value)}
              style={{ fontSize: 13, padding: "6px 8px" }}
            />
            <button className="btn" type="submit" disabled={groupBusy} style={{ padding: "6px 10px" }}>
              {groupBusy ? "creating…" : "> create group"}
            </button>
            {groupError && (
              <div className="err-text" style={{ fontSize: 11 }}>
                ! {groupError}
              </div>
            )}
          </form>
        )}

        {groups.length === 0 && !creating && (
          <div className="dim" style={{ padding: "0 16px 10px", fontSize: 12 }}>
            no groups yet.
          </div>
        )}
        {groups.map((g) => {
          const active = activeGroupId === g.id;
          const count = unread[`g:${g.id}`] ?? 0;
          return (
            <button
              key={g.id}
              onClick={() => onSelectGroup(g.id)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                padding: "10px 16px",
                background: active ? "var(--bg)" : "transparent",
                border: "none",
                borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                color: active ? "var(--fg)" : "var(--fg-dim)",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                # {g.name}
              </span>
              {count > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    color: "#06120a",
                    background: "var(--accent)",
                    padding: "1px 6px",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}

        <div
          className="dim"
          style={{ padding: "10px 16px 6px", fontSize: 11, letterSpacing: "0.03em" }}
        >
          direct messages
        </div>
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
