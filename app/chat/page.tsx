"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

import { useAuth } from "@/lib/auth-context";
import { useWebSocket } from "@/lib/useWebSocket";
import { encryptMessage } from "@/lib/crypto";

import {
  ApiError,
  deleteUpload,
  getDownloadUrl,
  getPublicKeyOf,
} from "@/lib/api";

import * as store from "@/lib/storage";

import type {
  AttachmentRef,
  StoredMessage,
  WireMessageIn,
} from "@/lib/types";

import {
  uploadFile,
  type PendingAttachment,
} from "@/lib/uploadManager";

import { Sidebar } from "@/components/Sidebar";
import { ChatWindow } from "@/components/ChatWindow";
import { CenteredScreen } from "@/components/TerminalWindow";

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
  const [activePeer, setActivePeer] = useState<string | null>(null);

  const [messagesByPeer, setMessagesByPeer] = useState<
    Record<string, StoredMessage[]>
  >({});

  const [unread, setUnread] = useState<Record<string, number>>({});

  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [sending, setSending] = useState(false);

  const [peerKeyStatus, setPeerKeyStatus] =
    useState<KeyStatus>("idle");

  const [systemLines, setSystemLines] = useState<string[]>([]);

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
    setSystemLines((prev) => [
      ...prev.slice(-4),
      line,
    ]);
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
      setMessagesByPeer((prev) => ({
        ...prev,
        [msg.peer]: [
          ...(prev[msg.peer] ??
            store.loadMessages(
              session.username,
              msg.peer
            )),
          stored,
        ],
      }));

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
    onSystem,
  });

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
        if (!session || !activePeer) {
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
          /*
           * Resolve recipient public key.
           */
          let publicKey =
            publicKeyCache.current.get(
              activePeer.toLowerCase()
            );

          if (!publicKey) {
            const token =
              await getFreshAccessToken();

            const user =
              await getPublicKeyOf(
                token,
                activePeer
              );

            if (!user.public_key) {
              throw new Error(
                "recipient has no public key"
              );
            }

            publicKey =
              user.public_key;

            publicKeyCache.current.set(
              activePeer.toLowerCase(),
              publicKey
            );
          }

          /*
           * Encrypt message content client-side.
           *
           * The backend never receives plaintext.
           *
           * For attachment-only messages we encrypt an empty string.
           *
           * IMPORTANT:
           * The attachment itself is currently referenced by file_id.
           * If strict E2EE attachments are required, the file must also
           * be encrypted client-side before upload. The current upload
           * pipeline stores the uploaded bytes as-is.
           */
          const encrypted =
            await encryptMessage(
              publicKey,
              trimmedText
            );

          const wire: WireMessageIn = {
            type: "message",
            message_id: messageId,
            recipient: activePeer,
            timestamp,

            ...encrypted,

            ...(attachment
              ? {
                  attachment,
                }
              : {}),
          };

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
            peer: activePeer,
            self: true,
            text: trimmedText,
            timestamp,
            failed: !delivered,
            attachment,
          };

          store.appendMessage(
            session.username,
            activePeer,
            stored
          );

          setMessagesByPeer((prev) => ({
            ...prev,
            [activePeer]: [
              ...(prev[activePeer] ?? []),
              stored,
            ],
          }));

          /*
           * The message is persisted locally even when the WebSocket
           * is currently disconnected.
           */
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
            `could not encrypt/send message to ${activePeer}`
          );

          throw error;
        } finally {
          setSending(false);
        }
      },
      [
        session,
        activePeer,
        getFreshAccessToken,
        sendEncrypted,
        onSystem,
      ]
    );

  /*
   * --------------------------------------------------------------------
   * ACTIVE MESSAGES
   * --------------------------------------------------------------------
   */

  const activeMessages =
    useMemo(
      () =>
        activePeer
          ? messagesByPeer[activePeer] ?? []
          : [],
      [
        activePeer,
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
        />

        {systemLines.length > 0 && (
          <div
            style={{
              borderTop:
                "1px solid var(--line)",
              padding: "6px 16px",
              fontSize: 11,
            }}
            className="dim"
          >
            {systemLines.map(
              (line, index) => (
                <div key={index}>
                  ~ {line}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}