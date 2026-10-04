import type {
  TokenPair,
  UserPublic,
  UploadInitRequest,
  UploadInitResponse,
  PartUrlsResponse,
  UploadStatusResponse,
  CompletePartInfo,
  UploadedFileOut,
  DownloadUrlResponse,
  AssistantQueryRequest,
  AssistantQueryResponse,
  AssistantGroupQueryRequest,
  Group,
  GroupSummary,
} from "./types";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;

    try {
      const body = await res.json();

      if (body?.detail) {
        detail = Array.isArray(body.detail)
          ? body.detail
              .map((d: any) => d.msg ?? JSON.stringify(d))
              .join("; ")
          : body.detail;
      }
    } catch {
      // response wasn't JSON
    }

    throw new ApiError(detail, res.status);
  }

  return res.json();
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

export function signup(
  username: string,
  email: string,
  password: string
): Promise<UserPublic> {
  return fetch(`${API_URL}/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      email,
      password,
    }),
  }).then((r) => handle<UserPublic>(r));
}

export function login(
  username: string,
  password: string
): Promise<TokenPair> {
  const form = new URLSearchParams();

  form.set("username", username);
  form.set("password", password);

  return fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  }).then((r) => handle<TokenPair>(r));
}

export function refreshTokens(
  refresh_token: string
): Promise<TokenPair> {
  return fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refresh_token,
    }),
  }).then((r) => handle<TokenPair>(r));
}

export function getMe(
  accessToken: string
): Promise<UserPublic> {
  return fetch(`${API_URL}/users/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((r) => handle<UserPublic>(r));
}

export function updatePublicKey(
  accessToken: string,
  publicKey: string
): Promise<UserPublic> {
  return fetch(`${API_URL}/users/me/public-key`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      public_key: publicKey,
    }),
  }).then((r) => handle<UserPublic>(r));
}

export function getPublicKeyOf(
  accessToken: string,
  username: string
): Promise<UserPublic> {
  return fetch(
    `${API_URL}/users/${encodeURIComponent(username)}/public-key`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  ).then((r) => handle<UserPublic>(r));
}

export function wsUrl(accessToken: string): string {
  const base =
    process.env.NEXT_PUBLIC_WS_URL ||
    "ws://localhost:8000/ws";

  return `${base}?token=${encodeURIComponent(accessToken)}`;
}

/* -------------------------------------------------------------------------- */
/* Multipart uploads                                                          */
/* -------------------------------------------------------------------------- */

export function initUpload(
  accessToken: string,
  data: UploadInitRequest
): Promise<UploadInitResponse> {
  return fetch(`${API_URL}/uploads/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(data),
  }).then((r) => handle<UploadInitResponse>(r));
}

export function getPartUrls(
  accessToken: string,
  uploadId: string,
  partNumbers: number[]
): Promise<PartUrlsResponse> {
  return fetch(`${API_URL}/uploads/${uploadId}/parts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      part_numbers: partNumbers,
    }),
  }).then((r) => handle<PartUrlsResponse>(r));
}

export function getUploadStatus(
  accessToken: string,
  uploadId: string
): Promise<UploadStatusResponse> {
  return fetch(`${API_URL}/uploads/${uploadId}/status`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((r) => handle<UploadStatusResponse>(r));
}

export function completeUpload(
  accessToken: string,
  uploadId: string,
  parts: CompletePartInfo[]
): Promise<UploadedFileOut> {
  return fetch(`${API_URL}/uploads/${uploadId}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      parts,
    }),
  }).then((r) => handle<UploadedFileOut>(r));
}

export function abortUpload(
  accessToken: string,
  uploadId: string
): Promise<UploadedFileOut> {
  return fetch(`${API_URL}/uploads/${uploadId}/abort`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((r) => handle<UploadedFileOut>(r));
}

export function deleteUpload(
  accessToken: string,
  uploadId: string
): Promise<UploadedFileOut> {
  return fetch(`${API_URL}/uploads/${uploadId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((r) => handle<UploadedFileOut>(r));
}

export function getDownloadUrl(
  accessToken: string,
  uploadId: string
): Promise<DownloadUrlResponse> {
  return fetch(
    `${API_URL}/uploads/${uploadId}/download-url`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  ).then((r) => handle<DownloadUrlResponse>(r));
}
/* -------------------------------------------------------------------------- */
/* Assistant                                                                  */
/* -------------------------------------------------------------------------- */

/** Backend allows ~30s queueing + ~120s run; the contract asks for >= 160s. */
export const ASSISTANT_TIMEOUT_MS = 160_000;

export function queryAssistant(
  accessToken: string,
  data: AssistantQueryRequest,
  signal?: AbortSignal
): Promise<AssistantQueryResponse> {
  return fetch(`${API_URL}/assistant/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(data),
    signal,
  }).then((r) => handle<AssistantQueryResponse>(r));
}

/* -------------------------------------------------------------------------- */
/* Groups                                                                     */
/* -------------------------------------------------------------------------- */

function authed(accessToken: string, json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${accessToken}`,
  };
}

export function createGroup(
  accessToken: string,
  name: string,
  members: string[]
): Promise<Group> {
  return fetch(`${API_URL}/groups`, {
    method: "POST",
    headers: authed(accessToken, true),
    body: JSON.stringify({ name, members }),
  }).then((r) => handle<Group>(r));
}

export function listGroups(accessToken: string): Promise<GroupSummary[]> {
  return fetch(`${API_URL}/groups`, {
    headers: authed(accessToken),
  }).then((r) => handle<GroupSummary[]>(r));
}

export function getGroup(accessToken: string, groupId: string): Promise<Group> {
  return fetch(`${API_URL}/groups/${groupId}`, {
    headers: authed(accessToken),
  }).then((r) => handle<Group>(r));
}

export function renameGroup(
  accessToken: string,
  groupId: string,
  name: string
): Promise<Group> {
  return fetch(`${API_URL}/groups/${groupId}`, {
    method: "PATCH",
    headers: authed(accessToken, true),
    body: JSON.stringify({ name }),
  }).then((r) => handle<Group>(r));
}

export function addGroupMembers(
  accessToken: string,
  groupId: string,
  usernames: string[]
): Promise<Group> {
  return fetch(`${API_URL}/groups/${groupId}/members`, {
    method: "POST",
    headers: authed(accessToken, true),
    body: JSON.stringify({ usernames }),
  }).then((r) => handle<Group>(r));
}

/** Remove a member (admin) or leave the group (username = yourself). 204. */
export async function removeGroupMember(
  accessToken: string,
  groupId: string,
  username: string
): Promise<void> {
  const res = await fetch(
    `${API_URL}/groups/${groupId}/members/${encodeURIComponent(username)}`,
    { method: "DELETE", headers: authed(accessToken) }
  );
  if (!res.ok) await handle<never>(res);
}

export function queryGroupAssistant(
  accessToken: string,
  data: AssistantGroupQueryRequest,
  signal?: AbortSignal
): Promise<AssistantQueryResponse> {
  return fetch(`${API_URL}/assistant/group-query`, {
    method: "POST",
    headers: authed(accessToken, true),
    body: JSON.stringify(data),
    signal,
  }).then((r) => handle<AssistantQueryResponse>(r));
}
