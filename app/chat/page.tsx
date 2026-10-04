"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

import { useAuth } from "@/lib/auth-context";
import { useWebSocket } from "@/lib/useWebSocket";
import { encryptGroupMessage, encryptMessage } from "@/lib/crypto";

import {
  ApiError,
  ASSISTANT_TIMEOUT_MS,
  addGroupMembers,
  createGroup,
  deleteUpload,
  getDownloadUrl,
  getGroup,
  getPublicKeyOf,
  listGroups,
  queryAssistant,
  queryGroupAssistant,
  removeGroupMember,
  renameGroup,
} from "@/lib/api";

import * as store from "@/lib/storage";

import type {
  AgentRun,
  AssistantContextItem,
  AttachmentRef,
  Group,
  GroupSummary,
  StoredMessage,
  WireGroupEvent,
  WireGroupMessageIn,
  WireMessageIn,
} from "@/lib/types";

import {
  uploadFile,
  type PendingAttachment,
} from "@/lib/uploadManager";

import { Sidebar } from "@/components/Sidebar";
import { ChatWindow } from "@/components/ChatWindow";
import { AgentConsole } from "@/components/AgentConsole";
import { GroupPanel } from "@/components/GroupPanel";
import { CenteredScreen } from "@/components/TerminalWindow";

const SHARE_CONTEXT_KEY = "termchat.agent.shareContext";
const CONTEXT_MESSAGES = 20;
const ASSISTANT_HISTORY_RUNS = 6;

type KeyStatus = "idle" | "loading" | "ready" | "error";

export default function ChatPage() {
  const {
    ready,
    session,
    privateKeyPem,
    keyMissing,
    getFreshAccessToken,
    logout,
  } = useAuth();

  const router = useRouter();

  const [contacts, setContacts] = useState<string[]>([]);
  const [activePeer, setActivePeerState] = useState<string | null>(null);

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [activeGroupId, setActiveGroupIdState] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<Group | null>(null);
  // Key for per-conversation state (messages, assistant runs).
  const convKey = activeGroupId
    ? store.groupKey(activeGroupId)
    : activePeer;
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);
  activeGroupIdRef.current = activeGroupId;

  // A conversation is either a direct chat or a group, never both.
  const setActivePeer = useCallback((peer: string | null) => {
    setActivePeerState(peer);
    if (peer) {
      setActiveGroupIdState(null);
      setGroupDetail(null);
    }
  }, []);
  const setActiveGroupId = useCallback((id: string | null) => {
    setActiveGroupIdState(id);
    setGroupDetail(null);
    setGroupError(null);
    setGroupPanelOpen(false);
    if (id) setActivePeerState(null);
  }, []);

  const [messagesByPeer, setMessagesByPeer] = useState<
    Record<string, StoredMessage[]>
  >({});

  const [unread, setUnread] = useState<Record<string, number>>({});

  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [sending, setSending] = useState(false);

  const [peerKeyStatus, setPeerKeyStatus] =
    useState<KeyStatus>("idle");

  const [agentRuns, setAgentRuns] = useState<
    Record<string, AgentRun[]>
  >({});
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [shareContext, setShareContext] = useState(false);
  const aborters = useRef<Map<string, AbortController>>(
    new Map()
  );
  // Latest runs, readable from executeRun without making it re-create.
  const agentRunsRef = useRef<Record<string, AgentRun[]>>({});
  agentRunsRef.current = agentRuns;

  useEffect(() => {
    try {
      setShareContext(
        localStorage.getItem(SHARE_CONTEXT_KEY) === "1"
      );
    } catch {
      // storage unavailable
    }
  }, []);

  const [pendingAttachment, setPendingAttachment] =
    useState<PendingAttachment | null>(null);

  /*
   * Ref is intentionally kept in sync with state.
   *
   * Upload callbacks can happen asynchronously and may execute after
   * a render has already happened. Using a ref here prevents stale
   * state from causing an attachment to be orphaned.
   */
  const pendingAttachmentRef =
    useRef<PendingAttachment | null>(null);

  /*
   * Cache recipient public keys in memory.
   *
   * Keys are still fetched from the backend when required, but we avoid
   * making a request for every individual message.
   */
  const publicKeyCache =
    useRef<Map<string, string>>(new Map());

  /*
   * Used by incoming-message handling to determine whether the received
   * message belongs to the currently open conversation.
   */
  const activePeerRef =
    useRef<string | null>(null);

  activePeerRef.current = activePeer;

  /*
   * --------------------------------------------------------------------
   * AUTH / INITIALIZATION
   * --------------------------------------------------------------------
   */

  useEffect(() => {
    if (!ready) {
      return;
    }

    if (!session) {
      router.replace("/login");
      return;
    }

    if (keyMissing) {
      router.replace("/login");
      return;
    }

    setContacts(
      store.loadContacts(session.username)
    );
  }, [
    ready,
    session,
    keyMissing,
    router,
  ]);

  /*
   * --------------------------------------------------------------------
   * SYSTEM LOG
   * --------------------------------------------------------------------
   */

  const onSystem = useCallback((line: string) => {
    console.warn(`[termchat] ${line}`);
  }, []);

  /*
   * --------------------------------------------------------------------
   * ATTACHMENT: REMOVE
   * --------------------------------------------------------------------
   *
   * Behaviour:
   *
   * 1. Upload still running
   *      -> cancel browser requests
   *      -> upload manager aborts multipart upload
   *
   * 2. Upload completed
   *      -> delete the completed object from MinIO/S3
   *
   * 3. No upload id
   *      -> simply remove local UI state
   *
   * The backend remains authoritative for actual object deletion.
   */

  const handleRemoveAttachment =
    useCallback(async () => {
      const pending =
        pendingAttachmentRef.current;

      if (!pending) {
        return;
      }

      const uploadId =
        pending.active.uploadId;

      /*
       * No backend upload exists yet.
       */
      if (!uploadId) {
        pending.active.cancel();

        pendingAttachmentRef.current = null;
        setPendingAttachment(null);

        return;
      }

      /*
       * Upload has already completed.
       *
       * The multipart upload is now a normal object, so DELETE is used
       * instead of multipart ABORT.
       */
      if (pending.progress.phase === "completed") {
        try {
          const token =
            await getFreshAccessToken();

          await deleteUpload(
            token,
            uploadId
          );
        } catch (error) {
          /*
           * Do not keep the composer blocked if deletion fails.
           *
           * The backend/object lifecycle cleanup process should be able
           * to deal with abandoned completed uploads.
           */
          console.error(
            "Failed to delete uploaded attachment:",
            error
          );
        }
      } else {
        /*
         * Upload still active / initializing / retrying.
         *
         * uploadManager owns the actual abort operation.
         */
        pending.active.cancel();
      }

      pendingAttachmentRef.current = null;
      setPendingAttachment(null);
    }, [getFreshAccessToken]);

  /*
   * --------------------------------------------------------------------
   * ATTACHMENT: RETRY
   * --------------------------------------------------------------------
   */

  const handleRetryAttachment =
    useCallback(() => {
      const current =
        pendingAttachmentRef.current;

      if (!current) {
        return;
      }

      const file =
        current.active.file;

      const localId =
        current.localId;

      /*
       * If the previous upload has an upload id, uploadManager will try
       * to resume it.
       *
       * If the backend reports that the previous upload can no longer
       * be resumed, uploadManager should create a fresh multipart upload.
       */
      const oldUploadId =
        current.active.uploadId;

      /*
       * Cancel the previous upload before creating the retry operation.
       */
      current.active.cancel();

      let next!: PendingAttachment;

      const active = uploadFile(
        file,
        getFreshAccessToken,
        (progress) => {
          setPendingAttachment((currentState) => {
            if (
              !currentState ||
              currentState.localId !== localId
            ) {
              return currentState;
            }

            const updated: PendingAttachment = {
              ...currentState,
              progress,
            };

            pendingAttachmentRef.current =
              updated;

            return updated;
          });
        },
        oldUploadId ?? undefined
      );

      next = {
        localId,
        active,
        progress: {
          phase: "initializing",
          uploadedParts: 0,
          totalParts: 0,
          bytesUploaded: 0,
          totalBytes: file.size,
        },
      };

      pendingAttachmentRef.current = next;
      setPendingAttachment(next);

      active.promise
        .then((attachment) => {
          setPendingAttachment((currentState) => {
            if (
              !currentState ||
              currentState.localId !== localId
            ) {
              return currentState;
            }

            const updated: PendingAttachment = {
              ...currentState,
              attachmentRef: attachment,
            };

            pendingAttachmentRef.current =
              updated;

            return updated;
          });
        })
        .catch((error) => {
          console.error(
            "Attachment retry failed:",
            error
          );
        });
    }, [getFreshAccessToken]);

  /*
   * --------------------------------------------------------------------
   * ATTACHMENT: SELECT FILE
   * --------------------------------------------------------------------
   */

  const handleAttachFile =
    useCallback(
      (file: File) => {
        if (!session) {
          return;
        }

        /*
         * Currently the composer supports one attachment at a time.
         *
         * If another upload is active, cancel it before replacing it.
         */
        const existing =
          pendingAttachmentRef.current;

        if (existing) {
          existing.active.cancel();
        }

        const localId = uuidv4();

        let pending!: PendingAttachment;

        const active = uploadFile(
          file,
          getFreshAccessToken,
          (progress) => {
            setPendingAttachment((current) => {
              if (
                !current ||
                current.localId !== localId
              ) {
                return current;
              }

              const updated: PendingAttachment = {
                ...current,
                progress,
              };

              pendingAttachmentRef.current =
                updated;

              return updated;
            });
          }
        );

        pending = {
          localId,
          active,
          progress: {
            phase: "initializing",
            uploadedParts: 0,
            totalParts: 0,
            bytesUploaded: 0,
            totalBytes: file.size,
          },
        };

        pendingAttachmentRef.current =
          pending;

        setPendingAttachment(pending);

        active.promise
          .then((attachment) => {
            setPendingAttachment((current) => {
              if (
                !current ||
                current.localId !== localId
              ) {
                return current;
              }

              const updated: PendingAttachment = {
                ...current,
                attachmentRef: attachment,
              };

              pendingAttachmentRef.current =
                updated;

              return updated;
            });
          })
          .catch((error) => {
            /*
             * uploadManager is responsible for exposing the error
             * through its progress state.
             */
            console.error(
              "Attachment upload failed:",
              error
            );
          });
      },
      [
        session,
        getFreshAccessToken,
      ]
    );

  /*
   * --------------------------------------------------------------------
   * GROUPS
   * --------------------------------------------------------------------
   */

  const refreshGroups = useCallback(async () => {
    try {
      const token = await getFreshAccessToken();
      setGroups(await listGroups(token));
    } catch {
      onSystem("could not load groups");
    }
  }, [getFreshAccessToken, onSystem]);

  const refreshGroupDetail = useCallback(
    async (id: string): Promise<Group | null> => {
      try {
        const token = await getFreshAccessToken();
        const g = await getGroup(token, id);
        if (activeGroupIdRef.current === id) {
          setGroupDetail(g);
        }
        return g;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // we're no longer a member
          setGroups((prev) => prev.filter((x) => x.id !== id));
          if (activeGroupIdRef.current === id) {
            setActiveGroupId(null);
          }
        }
        return null;
      }
    },
    [getFreshAccessToken, setActiveGroupId]
  );

  const pushGroupMessage = useCallback(
    (groupId: string, stored: StoredMessage) => {
      if (!session) {
        return;
      }

      const key = store.groupKey(groupId);

      store.appendMessage(session.username, key, stored);

      setMessagesByPeer((prev) => {
        const base =
          prev[key] ?? store.loadMessages(session.username, key);

        return {
          ...prev,
          [key]: base.some((m) => m.id === stored.id)
            ? base
            : [...base, stored],
        };
      });
    },
    [session]
  );

  const onGroupIncoming = useCallback(
    (msg: {
      groupId: string;
      sender: string;
      text: string;
      timestamp: string;
      id: string;
      attachment?: AttachmentRef;
    }) => {
      if (!session) {
        return;
      }

      const self = msg.sender.toLowerCase() === session.username.toLowerCase();
      const key = store.groupKey(msg.groupId);

      // Already stored (our own send echoed back to this/another tab).
      const known =
        store.loadMessages(session.username, key).some((m) => m.id === msg.id);

      pushGroupMessage(msg.groupId, {
        id: msg.id,
        peer: key,
        sender: msg.sender,
        self,
        text: msg.text,
        timestamp: msg.timestamp,
        ...(msg.attachment ? { attachment: msg.attachment } : {}),
      });

      if (!self && !known && activeGroupIdRef.current !== msg.groupId) {
        setUnread((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
      }
    },
    [session, pushGroupMessage]
  );

  const onGroupEvent = useCallback(
    (evt: WireGroupEvent) => {
      if (!session) {
        return;
      }

      const me = session.username.toLowerCase();
      const target = evt.username ?? "";
      const actor = evt.actor;

      const text =
        evt.event === "created"
          ? `${actor} created the group`
          : evt.event === "renamed"
            ? `${actor} renamed the group`
            : evt.event === "member_added"
              ? `${actor} added ${target}`
              : evt.event === "member_removed"
                ? `${actor} removed ${target}`
                : `${target || actor} left`;

      const removedMe =
        (evt.event === "member_removed" || evt.event === "member_left") &&
        target.toLowerCase() === me;

      if (removedMe) {
        setGroups((prev) => prev.filter((g) => g.id !== evt.group_id));
        if (activeGroupIdRef.current === evt.group_id) {
          setActiveGroupId(null);
        }
        return;
      }

      pushGroupMessage(evt.group_id, {
        id: uuidv4(),
        peer: store.groupKey(evt.group_id),
        self: false,
        system: true,
        text,
        timestamp: new Date().toISOString(),
      });

      void refreshGroups();

      if (activeGroupIdRef.current === evt.group_id) {
        void refreshGroupDetail(evt.group_id);
      }
    },
    [session, pushGroupMessage, refreshGroups, refreshGroupDetail, setActiveGroupId]
  );

  const handleCreateGroup = useCallback(
    async (name: string, members: string[]): Promise<string | null> => {
      if (!session) {
        return "not signed in";
      }

      try {
        const token = await getFreshAccessToken();
        const group = await createGroup(token, name, members);

        await refreshGroups();
        setActiveGroupId(group.id);

        return null;
      } catch (error) {
        return error instanceof ApiError
          ? error.message
          : "could not create group";
      }
    },
    [session, getFreshAccessToken, refreshGroups, setActiveGroupId]
  );

  const runGroupAction = useCallback(
    async (action: (token: string, id: string) => Promise<unknown>) => {
      const id = activeGroupIdRef.current;

      if (!id) {
        return false;
      }

      setGroupBusy(true);
      setGroupError(null);

      try {
        await action(await getFreshAccessToken(), id);
        await Promise.all([refreshGroups(), refreshGroupDetail(id)]);
        return true;
      } catch (error) {
        setGroupError(
          error instanceof ApiError ? error.message : "request failed"
        );
        return false;
      } finally {
        setGroupBusy(false);
      }
    },
    [getFreshAccessToken, refreshGroups, refreshGroupDetail]
  );

  const handleRenameGroup = useCallback(
    (name: string) => void runGroupAction((t, id) => renameGroup(t, id, name)),
    [runGroupAction]
  );

  const handleAddGroupMembers = useCallback(
    (usernames: string[]) =>
      void runGroupAction((t, id) => addGroupMembers(t, id, usernames)),
    [runGroupAction]
  );

  const handleRemoveGroupMember = useCallback(
    (username: string) =>
      void runGroupAction((t, id) => removeGroupMember(t, id, username)),
    [runGroupAction]
  );

  const handleLeaveGroup = useCallback(async () => {
    if (!session) {
      return;
    }

    const id = activeGroupIdRef.current;

    if (!id) {
      return;
    }

    const ok = await runGroupAction((t, gid) =>
      removeGroupMember(t, gid, session.username)
    );

    if (ok) {
      setGroups((prev) => prev.filter((g) => g.id !== id));
      setActiveGroupId(null);
    }
  }, [session, runGroupAction, setActiveGroupId]);

  // Load the member list whenever a group is opened.
  useEffect(() => {
    if (!session || !activeGroupId) {
      return;
    }

    void refreshGroupDetail(activeGroupId);
    setUnread((prev) => ({ ...prev, [store.groupKey(activeGroupId)]: 0 }));

    setMessagesByPeer((prev) => {
      const key = store.groupKey(activeGroupId);
      return prev[key]
        ? prev
        : { ...prev, [key]: store.loadMessages(session.username, key) };
    });
  }, [session, activeGroupId, refreshGroupDetail]);

  /*
   * --------------------------------------------------------------------
   * WEBSOCKET
   * --------------------------------------------------------------------
   */

  const onIncoming = useCallback(
    (msg: {
      peer: string;
      text: string;
      timestamp: string;
      id: string;
      attachment?: AttachmentRef;
    }) => {
      if (!session) {
        return;
      }

      const stored: StoredMessage = {
          id: msg.id,
          peer: msg.peer,
          self: false,
          text: msg.text,
          timestamp: msg.timestamp,
          ...(msg.attachment ? { attachment: msg.attachment } : {}),
        };

      /*
       * Persist message locally first.
       */
      store.appendMessage(
        session.username,
        msg.peer,
        stored
      );

      /*
       * Update in-memory conversation state.
       */
      setMessagesByPeer((prev) => {
        /*
         * When the conversation isn't in memory yet, the fallback read
         * already includes the message persisted above - so dedupe by id.
         */
        const base =
          prev[msg.peer] ??
          store.loadMessages(
            session.username,
            msg.peer
          );

        return {
          ...prev,
          [msg.peer]: base.some((m) => m.id === stored.id)
            ? base
            : [...base, stored],
        };
      });

      /*
       * Automatically add sender to contacts.
       */
      setContacts((prev) => {
        if (
          prev.some(
            (contact) =>
              contact.toLowerCase() ===
              msg.peer.toLowerCase()
          )
        ) {
          return prev;
        }

        return store.addContact(
          session.username,
          msg.peer
        );
      });

      /*
       * Increment unread count when the conversation isn't open.
       */
      if (
        activePeerRef.current?.toLowerCase() !==
        msg.peer.toLowerCase()
      ) {
        setUnread((prev) => ({
          ...prev,
          [msg.peer]:
            (prev[msg.peer] ?? 0) + 1,
        }));
      }
    },
    [session]
  );

  const {
    status,
    sendEncrypted,
  } = useWebSocket({
    username:
      session?.username ?? null,
    privateKeyPem,
    getFreshAccessToken,
    onIncoming,
    onGroupIncoming,
    onGroupEvent,
    onSystem,
  });

  // Group events are live-only, so re-sync the list on every (re)connect.
  useEffect(() => {
    if (status === "open") {
      void refreshGroups();

      if (activeGroupIdRef.current) {
        void refreshGroupDetail(activeGroupIdRef.current);
      }
    }
  }, [status, refreshGroups, refreshGroupDetail]);

  /*
   * --------------------------------------------------------------------
   * LOAD CONVERSATION HISTORY
   * --------------------------------------------------------------------
   */

  useEffect(() => {
    if (!session || !activePeer) {
      return;
    }

    setMessagesByPeer((prev) => {
      /*
       * Avoid repeatedly reading local storage on every render.
       */
      if (prev[activePeer]) {
        return prev;
      }

      return {
        ...prev,
        [activePeer]:
          store.loadMessages(
            session.username,
            activePeer
          ),
      };
    });

    /*
     * Opening a conversation clears its unread count.
     */
    setUnread((prev) => ({
      ...prev,
      [activePeer]: 0,
    }));
  }, [session, activePeer]);

  /*
   * --------------------------------------------------------------------
   * RECIPIENT PUBLIC KEY
   * --------------------------------------------------------------------
   */

  useEffect(() => {
    if (!session || !activePeer) {
      return;
    }

    const cacheKey =
      activePeer.toLowerCase();

    const cached =
      publicKeyCache.current.get(cacheKey);

    if (cached) {
      setPeerKeyStatus("ready");
      return;
    }

    let cancelled = false;

    setPeerKeyStatus("loading");

    (async () => {
      try {
        const token =
          await getFreshAccessToken();

        const user =
          await getPublicKeyOf(
            token,
            activePeer
          );

        if (cancelled) {
          return;
        }

        if (!user.public_key) {
          setPeerKeyStatus("error");

          onSystem(
            `${activePeer} has not uploaded a public key yet`
          );

          return;
        }

        publicKeyCache.current.set(
          cacheKey,
          user.public_key
        );

        setPeerKeyStatus("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setPeerKeyStatus("error");

        onSystem(
          error instanceof ApiError &&
            error.status === 404
            ? `no such user: ${activePeer}`
            : `could not resolve public key for ${activePeer}`
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    session,
    activePeer,
    getFreshAccessToken,
    onSystem,
  ]);

  /*
   * --------------------------------------------------------------------
   * ADD CONTACT
   * --------------------------------------------------------------------
   */

  const handleAddContact =
    useCallback(
      async (name: string) => {
        if (!session) {
          return;
        }

        setAddError(null);

        if (
          name.toLowerCase() ===
          session.username.toLowerCase()
        ) {
          setAddError("that's you");
          return;
        }

        setAdding(true);

        try {
          const token =
            await getFreshAccessToken();

          const user =
            await getPublicKeyOf(
              token,
              name
            );

          /*
           * Cache public key immediately so sending doesn't require
           * another request.
           */
          publicKeyCache.current.set(
            user.username.toLowerCase(),
            user.public_key ?? ""
          );

          const updated =
            store.addContact(
              session.username,
              user.username
            );

          setContacts(updated);
          setActivePeer(user.username);
        } catch (error) {
          setAddError(
            error instanceof ApiError &&
              error.status === 404
              ? "no such user"
              : "lookup failed"
          );
        } finally {
          setAdding(false);
        }
      },
      [
        session,
        getFreshAccessToken,
      ]
    );

  /*
   * --------------------------------------------------------------------
   * DOWNLOAD ATTACHMENT
   * --------------------------------------------------------------------
   *
   * The browser never talks to MinIO using application credentials.
   *
   * Instead:
   *
   * Browser
   *    |
   *    | authenticated request
   *    v
   * FastAPI
   *    |
   *    | authorization + presigned URL
   *    v
   * Browser
   *    |
   *    | direct download
   *    v
   * MinIO
   */

  const handleDownloadAttachment =
    useCallback(
      async (
        fileId: string,
        filename: string
      ) => {
        try {
          const token =
            await getFreshAccessToken();

          const result =
            await getDownloadUrl(
              token,
              fileId
            );

          /*
           * Create a temporary anchor rather than opening the URL
           * directly. This gives the browser a download hint.
           */
          const anchor =
            document.createElement("a");

          anchor.href = result.url;
          anchor.download =
            result.filename || filename;

          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";

          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        } catch (error) {
          console.error(
            "Attachment download failed:",
            error
          );

          onSystem(
            `could not download ${filename}`
          );
        }
      },
      [
        getFreshAccessToken,
        onSystem,
      ]
    );

  /*
   * --------------------------------------------------------------------
   * SEND MESSAGE
   * --------------------------------------------------------------------
   *
   * Supported combinations:
   *
   * 1. text only
   * 2. attachment only
   * 3. text + attachment
   *
   * File bytes are NEVER sent through WebSocket.
   *
   * WebSocket only carries:
   *
   * {
   *   encrypted_content,
   *   encrypted_key,
   *   nonce,
   *   tag,
   *   attachment: {
   *     file_id,
   *     filename
   *   }
   * }
   *
   * The attachment itself is already stored in MinIO.
   */

  const handleSend =
    useCallback(
      async (
        text: string,
        attachment?: AttachmentRef
      ) => {
        if (!session || (!activePeer && !activeGroupId)) {
          return;
        }

        /*
         * Don't allow sending an empty message without an attachment.
         */
        const trimmedText =
          text.trim();

        if (
          !trimmedText &&
          !attachment
        ) {
          return;
        }

        setSending(true);

        const messageId = uuidv4();

        const timestamp =
          new Date().toISOString();

        try {
          let wire: WireMessageIn | WireGroupMessageIn;
          let convKey: string;

          if (activeGroupId) {
            /*
             * Group: re-fetch members so the key list is current, then
             * wrap one AES key per member that has a public key
             * (including ourselves, so our other tabs get it too).
             */
            const token = await getFreshAccessToken();
            const group = await getGroup(token, activeGroupId);

            setGroupDetail((cur) =>
              cur?.id === group.id ? group : cur
            );

            const keys: Record<string, string> = {};

            for (const member of group.members) {
              if (member.public_key) {
                keys[member.username] = member.public_key;
              }
            }

            const skipped = group.members.filter((m) => !m.public_key);

            if (skipped.length) {
              onSystem(
                `no public key yet for ${skipped.map((m) => m.username).join(", ")} - they won't receive this`
              );
            }

            const encrypted = await encryptGroupMessage(keys, trimmedText);

            wire = {
              type: "group_message",
              message_id: messageId,
              group_id: activeGroupId,
              timestamp,
              ...encrypted,
              ...(attachment ? { attachment } : {}),
            };

            convKey = store.groupKey(activeGroupId);
          } else {
            /*
             * Resolve recipient public key.
             */
            let publicKey =
              publicKeyCache.current.get(
                activePeer!.toLowerCase()
              );

            if (!publicKey) {
              const token =
                await getFreshAccessToken();

              const user =
                await getPublicKeyOf(
                  token,
                  activePeer!
                );

              if (!user.public_key) {
                throw new Error(
                  "recipient has no public key"
                );
              }

              publicKey =
                user.public_key;

              publicKeyCache.current.set(
                activePeer!.toLowerCase(),
                publicKey
              );
            }

            /*
             * Encrypt message content client-side. For attachment-only
             * messages we encrypt an empty string. Attachment bytes
             * themselves are NOT end-to-end encrypted (see contract).
             */
            const encrypted =
              await encryptMessage(
                publicKey,
                trimmedText
              );

            wire = {
              type: "message",
              message_id: messageId,
              recipient: activePeer!,
              timestamp,
              ...encrypted,
              ...(attachment ? { attachment } : {}),
            };

            convKey = activePeer!;
          }

          /*
           * Send ciphertext + attachment metadata through WebSocket.
           */
          const delivered =
            sendEncrypted(wire);

          /*
           * Persist our own message locally.
           */
          const stored: StoredMessage = {
            id: messageId,
            peer: convKey,
            self: true,
            text: trimmedText,
            timestamp,
            failed: !delivered,
            attachment,
            ...(activeGroupId ? { sender: session.username } : {}),
          };

          store.appendMessage(
            session.username,
            convKey,
            stored
          );

          setMessagesByPeer((prev) => ({
            ...prev,
            [convKey]: [
              ...(prev[convKey] ?? []),
              stored,
            ],
          }));

          if (!delivered) {
            onSystem(
              "not connected - message saved locally but not sent"
            );
          }

          /*
           * Once the attachment has been referenced by the message,
           * ownership has effectively moved from the composer to the
           * conversation history.
           *
           * Clear the pending attachment UI without deleting the file.
           */
          if (
            attachment &&
            pendingAttachmentRef.current
              ?.attachmentRef?.file_id ===
              attachment.file_id
          ) {
            pendingAttachmentRef.current =
              null;

            setPendingAttachment(null);
          }
        } catch (error) {
          console.error(
            "Could not encrypt/send message:",
            error
          );

          onSystem(
            `could not encrypt/send message to ${activeGroupId ? "group" : activePeer}`
          );

          throw error;
        } finally {
          setSending(false);
        }
      },
      [
        session,
        activePeer,
        activeGroupId,
        getFreshAccessToken,
        sendEncrypted,
        onSystem,
      ]
    );

  /*
   * --------------------------------------------------------------------
   * AGENT CONSOLE
   * --------------------------------------------------------------------
   */

  // Restore the assistant console history when a conversation is opened.
  useEffect(() => {
    if (!session || !convKey) {
      return;
    }

    setAgentRuns((prev) =>
      prev[convKey]
        ? prev
        : { ...prev, [convKey]: store.loadRuns(session.username, convKey) }
    );
  }, [session, convKey]);

  // Persist finished runs so follow-ups still have context after a reload.
  useEffect(() => {
    if (!session) {
      return;
    }

    for (const [peer, runs] of Object.entries(agentRuns)) {
      if (runs.length && runs.every((r) => r.status !== "running")) {
        store.saveRuns(session.username, peer, runs);
      }
    }
  }, [session, agentRuns]);

  const updateRun = useCallback(
    (peer: string, id: string, patch: Partial<AgentRun>) => {
      setAgentRuns((prev) => ({
        ...prev,
        [peer]: (prev[peer] ?? []).map((r) =>
          r.id === id ? { ...r, ...patch } : r
        ),
      }));
    },
    []
  );

  const executeRun = useCallback(
    async (run: AgentRun) => {
      if (!session) {
        return;
      }

      const controller = new AbortController();
      aborters.current.set(run.id, controller);

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, ASSISTANT_TIMEOUT_MS);

      try {
        let message_context: AssistantContextItem[] | undefined;

        if (shareContext) {
          const history =
            messagesByPeer[run.peer] ??
            store.loadMessages(session.username, run.peer);

          message_context = history
            .filter((m) => m.text.trim() && !m.failed && !m.system)
            .slice(-CONTEXT_MESSAGES)
            .map((m) => ({
              message_id: m.id,
              sender: m.self ? session.username : (m.sender ?? m.peer),
              text: m.text,
              timestamp: m.timestamp,
            }));
        }

        // Earlier finished turns of the user's chat with the assistant.
        const assistant_history = (agentRunsRef.current[run.peer] ?? [])
          .filter((r) => r.id !== run.id && r.status === "done" && r.response)
          .slice(-ASSISTANT_HISTORY_RUNS)
          .flatMap((r) => [
            { role: "user" as const, text: r.question },
            { role: "assistant" as const, text: r.response as string },
          ]);

        updateRun(run.peer, run.id, {
          contextCount: message_context?.length ?? 0,
          historyCount: assistant_history.length / 2,
        });

        const token = await getFreshAccessToken();

        const extras = {
          question: run.question,
          ...(message_context?.length
            ? { message_context }
            : {}),
          ...(assistant_history.length
            ? { assistant_history }
            : {}),
        };

        const result = run.groupId
          ? await queryGroupAssistant(
              token,
              { group_id: run.groupId, ...extras },
              controller.signal
            )
          : await queryAssistant(
              token,
              { peer_username: run.peer, ...extras },
              controller.signal
            );

        updateRun(run.peer, run.id, {
          status: "done",
          response: result.response,
          serverRunId: result.run_id,
          finishedAt: Date.now(),
        });
      } catch (error) {
        if (controller.signal.aborted && !timedOut) {
          updateRun(run.peer, run.id, {
            status: "cancelled",
            finishedAt: Date.now(),
          });
        } else if (timedOut) {
          updateRun(run.peer, run.id, {
            status: "error",
            errorStatus: 504,
            finishedAt: Date.now(),
          });
        } else {
          updateRun(run.peer, run.id, {
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "request failed",
            errorStatus:
              error instanceof ApiError
                ? error.status
                : undefined,
            finishedAt: Date.now(),
          });
        }
      } finally {
        clearTimeout(timer);
        aborters.current.delete(run.id);
      }
    },
    [session, shareContext, messagesByPeer, getFreshAccessToken, updateRun]
  );

  const handleAskAssistant = useCallback(
    (question: string) => {
      if (!convKey) {
        return;
      }

      setConsoleOpen(true);

      if (!question) {
        return;
      }

      const run: AgentRun = {
        id: uuidv4(),
        peer: convKey,
        ...(activeGroupId ? { groupId: activeGroupId } : {}),
        question,
        status: "running",
        startedAt: Date.now(),
        contextCount: 0,
      };

      setAgentRuns((prev) => ({
        ...prev,
        [convKey]: [...(prev[convKey] ?? []), run],
      }));

      void executeRun(run);
    },
    [convKey, activeGroupId, executeRun]
  );

  const handleCancelRun = useCallback((id: string) => {
    aborters.current.get(id)?.abort();
  }, []);

  const handleRetryRun = useCallback(
    (id: string) => {
      if (!convKey) {
        return;
      }

      const old = (agentRuns[convKey] ?? []).find(
        (r) => r.id === id
      );

      if (!old) {
        return;
      }

      handleAskAssistant(old.question);
    },
    [convKey, agentRuns, handleAskAssistant]
  );

  const handleToggleShareContext = useCallback(
    (value: boolean) => {
      setShareContext(value);

      try {
        localStorage.setItem(
          SHARE_CONTEXT_KEY,
          value ? "1" : "0"
        );
      } catch {
        // storage unavailable
      }
    },
    []
  );

  /*
   * --------------------------------------------------------------------
   * ACTIVE MESSAGES
   * --------------------------------------------------------------------
   */

  const activeMessages =
    useMemo(
      () =>
        activeGroupId
          ? messagesByPeer[store.groupKey(activeGroupId)] ?? []
          : activePeer
            ? messagesByPeer[activePeer] ?? []
            : [],
      [
        activePeer,
        activeGroupId,
        messagesByPeer,
      ]
    );

  /*
   * --------------------------------------------------------------------
   * LOADING / AUTH GUARD
   * --------------------------------------------------------------------
   */

  if (
    !ready ||
    !session ||
    keyMissing
  ) {
    return (
      <CenteredScreen>
        <span className="dim">
          loading…
        </span>
      </CenteredScreen>
    );
  }

  /*
   * --------------------------------------------------------------------
   * PAGE
   * --------------------------------------------------------------------
   */

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        minHeight: "100vh",
      }}
    >
      <Sidebar
        username={session.username}
        status={status}
        contacts={contacts}
        activePeer={activePeer}
        unread={unread}
        onSelect={setActivePeer}
        onAddContact={handleAddContact}
        onLogout={logout}
        addError={addError}
        adding={adding}
        groups={groups}
        activeGroupId={activeGroupId}
        onSelectGroup={setActiveGroupId}
        onCreateGroup={handleCreateGroup}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <ChatWindow
          group={
            activeGroupId
              ? groupDetail ?? {
                  id: activeGroupId,
                  name:
                    groups.find((g) => g.id === activeGroupId)?.name ?? "…",
                  created_by: "",
                  created_at: "",
                  members: [],
                }
              : null
          }
          groupPanelOpen={groupPanelOpen}
          onToggleGroupPanel={() => setGroupPanelOpen((open) => !open)}
          peer={activePeer}
          username={session.username}
          messages={activeMessages}
          onSend={handleSend}
          sending={sending}
          peerKeyStatus={peerKeyStatus}
          pendingAttachment={pendingAttachment}
          onAttachFile={handleAttachFile}
          onRemoveAttachment={
            handleRemoveAttachment
          }
          onRetryAttachment={
            handleRetryAttachment
          }
          onDownloadAttachment={
            handleDownloadAttachment
          }
          onAskAssistant={handleAskAssistant}
          consoleOpen={consoleOpen}
          onToggleConsole={() =>
            setConsoleOpen((open) => !open)
          }
        />
      </div>

      {groupPanelOpen && groupDetail && (
        <GroupPanel
          key={groupDetail.id}
          group={groupDetail}
          me={session.username}
          busy={groupBusy}
          error={groupError}
          onRename={handleRenameGroup}
          onAddMembers={handleAddGroupMembers}
          onRemoveMember={handleRemoveGroupMember}
          onLeave={handleLeaveGroup}
          onClose={() => setGroupPanelOpen(false)}
        />
      )}

      {consoleOpen && (
        <AgentConsole
          peer={convKey}
          groupName={
            activeGroupId
              ? (groupDetail?.name ??
                groups.find((g) => g.id === activeGroupId)?.name ??
                "group")
              : null
          }
          runs={
            convKey
              ? agentRuns[convKey] ?? []
              : []
          }
          shareContext={shareContext}
          onToggleShareContext={handleToggleShareContext}
          onCancel={handleCancelRun}
          onRetry={handleRetryRun}
          onAsk={handleAskAssistant}
          onSendToChat={(text) => {
            void handleSend(text).catch(() => {});
          }}
          onClose={() => setConsoleOpen(false)}
        />
      )}
    </div>
  );
}