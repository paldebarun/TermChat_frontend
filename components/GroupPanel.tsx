"use client";

import { useState } from "react";

import type { Group } from "@/lib/types";

export function GroupPanel({
  group,
  me,
  busy,
  error,
  onRename,
  onAddMembers,
  onRemoveMember,
  onLeave,
  onClose,
}: {
  group: Group;
  me: string;
  busy: boolean;
  error: string | null;
  onRename: (name: string) => void;
  onAddMembers: (usernames: string[]) => void;
  onRemoveMember: (username: string) => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [adding, setAdding] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  const isAdmin =
    group.members.find((m) => m.username === me)?.role === "admin";

  return (
    <div className="agent-console">
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>
          <span className="prompt">group</span> info
        </span>
        <button type="button" className="btn-quiet" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="agent-body">
        <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
          name
        </div>
        {isAdmin ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const next = name.trim();
              if (next && next !== group.name) onRename(next);
            }}
            style={{ display: "flex", gap: 6, marginBottom: 18 }}
          >
            <input
              className="field"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              style={{ fontSize: 13, padding: "6px 8px" }}
            />
            <button
              className="btn"
              type="submit"
              disabled={busy || !name.trim() || name.trim() === group.name}
              style={{ padding: "6px 10px" }}
            >
              rename
            </button>
          </form>
        ) : (
          <div style={{ marginBottom: 18 }}>{group.name}</div>
        )}

        <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
          members ({group.members.length})
        </div>
        <div style={{ marginBottom: 18 }}>
          {group.members.map((m) => (
            <div
              key={m.username}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 0",
                fontSize: 13,
              }}
            >
              <span>
                {m.username}
                {m.username === me && <span className="dim"> (you)</span>}
                {m.role === "admin" && (
                  <span style={{ color: "var(--warn)" }}> [admin]</span>
                )}
                {!m.public_key && (
                  <span
                    className="err-text"
                    title="has no public key yet - receives nothing until they upload one"
                  >
                    {" "}
                    no key
                  </span>
                )}
              </span>
              {isAdmin && m.username !== me && (
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={busy}
                  style={{ padding: "0 8px", fontSize: 12 }}
                  onClick={() => onRemoveMember(m.username)}
                  title={`Remove ${m.username}`}
                >
                  remove
                </button>
              )}
            </div>
          ))}
        </div>

        {isAdmin && (
          <>
            <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
              add members
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const usernames = Array.from(
                  new Set(
                    adding.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean)
                  )
                );
                if (!usernames.length) return;
                onAddMembers(usernames);
                setAdding("");
              }}
              style={{ display: "flex", gap: 6, marginBottom: 18 }}
            >
              <input
                className="field"
                placeholder="alice, bob"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                style={{ fontSize: 13, padding: "6px 8px" }}
              />
              <button
                className="btn"
                type="submit"
                disabled={busy || !adding.trim()}
                style={{ padding: "6px 10px" }}
              >
                +
              </button>
            </form>
          </>
        )}

        {error && (
          <div className="err-text" style={{ fontSize: 12, marginBottom: 12 }}>
            ! {error}
          </div>
        )}

        <div className="dim" style={{ fontSize: 11, lineHeight: 1.6, marginBottom: 18 }}>
          Messages are encrypted per member. New members can&apos;t read earlier
          messages, and removed members keep only what they already received.
          Attachments are not end-to-end encrypted.
        </div>

        {confirmLeave ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
            <span>leave this group?</span>
            <button className="btn" disabled={busy} onClick={onLeave}>
              yes, leave
            </button>
            <button className="btn-quiet" onClick={() => setConfirmLeave(false)}>
              cancel
            </button>
          </div>
        ) : (
          <button className="btn-quiet" onClick={() => setConfirmLeave(true)}>
            leave group
          </button>
        )}
      </div>
    </div>
  );
}
