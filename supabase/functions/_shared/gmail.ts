/**
 * Gmail REST API helpers.
 * Uses fetch() + OAuth access tokens directly — no Python client library needed.
 */

import { fernetDecrypt, fernetEncrypt } from "./fernet.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface TokenData {
  token: string;
  refresh_token?: string;
  expiry?: string;
  scopes?: string[];
}

export interface AttachmentInfo {
  filename: string;
  mime_type: string;
  size: number;
  attachment_id: string;
}

export interface EmailData {
  gmail_id: string;
  thread_id?: string;
  subject: string;
  sender: string;
  sender_email: string;
  recipients: string;
  snippet: string;
  body_text: string;
  body_html: string;
  received_at: string;
  is_read: boolean;
  label_ids: string[];
  has_attachments: boolean;
  attachments: AttachmentInfo[];
  // Structural signals for smarter categorization
  has_list_unsubscribe: boolean;
  is_reply: boolean;
  reply_to_email?: string;
  cc_recipients?: string;
  precedence_header?: string;
}

function getEnv(key: string): string {
  return (
    (
      Deno as unknown as { env: { get(k: string): string | undefined } }
    ).env.get(key) ?? ""
  );
}

export async function decryptTokensSafe(
  encrypted: string,
): Promise<TokenData | null> {
  try {
    return await decryptTokens(encrypted);
  } catch (err) {
    console.error("[gmail] decryptTokensSafe failed:", err);
    return null;
  }
}

async function decryptTokens(encrypted: string): Promise<TokenData> {
  const key = getEnv("TOKEN_ENCRYPTION_KEY");
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  }
  // Back-compat: a previous callback path could write plaintext JSON. Accept
  // it on read so existing rows still work, but new writes always encrypt.
  if (encrypted.trimStart().startsWith("{")) {
    try {
      return JSON.parse(encrypted);
    } catch {
      /* not JSON, fall through */
    }
  }
  const json = await fernetDecrypt(key, encrypted);
  return JSON.parse(json);
}

export async function encryptTokens(tokens: TokenData): Promise<string> {
  const key = getEnv("TOKEN_ENCRYPTION_KEY");
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  }
  return fernetEncrypt(key, JSON.stringify(tokens));
}

// Best-effort Google OAuth token revocation. Used when a user disconnects a
// Gmail account so stored access / refresh tokens can no longer be used. We
// never surface errors here because revocation is a nice-to-have; the primary
// effect is the local row being deactivated.
export async function revokeGoogleTokens(encrypted: string): Promise<void> {
  const tokens = await decryptTokensSafe(encrypted);
  const candidates = [tokens?.refresh_token, tokens?.token].filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );
  for (const token of candidates) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
    } catch (err) {
      console.error("[gmail] token revoke failed:", err);
    }
  }
}

async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getEnv("GOOGLE_CLIENT_ID"),
      client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // Drain body for logs without surfacing provider detail to callers.
    try {
      await res.text();
    } catch {
      /* ignore */
    }
    console.error(`[gmail] token refresh failed status=${res.status}`);
    throw new Error("Token refresh failed");
  }
  const data = await res.json();
  return {
    token: data.access_token,
    refresh_token: refreshToken,
    expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

async function gmailRequest(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`${GMAIL_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveTokens(
  encryptedTokens: string,
  supabase?: { from: (t: string) => unknown },
  accountId?: string,
): Promise<{ tokenData: TokenData; updatedEncryptedTokens?: string }> {
  let tokenData = await decryptTokens(encryptedTokens);
  let updatedEncryptedTokens: string | undefined;

  const isExpired =
    tokenData.expiry &&
    new Date(tokenData.expiry) < new Date(Date.now() + 60_000);

  if (isExpired && tokenData.refresh_token) {
    const refreshed = await refreshAccessToken(tokenData.refresh_token);
    tokenData = { ...tokenData, ...refreshed };
    updatedEncryptedTokens = await encryptTokens(tokenData);
    if (supabase && accountId) {
      // deno-lint-ignore no-explicit-any
      await (supabase.from("gmail_accounts") as any)
        .update({ tokens_encrypted: updatedEncryptedTokens })
        .eq("id", accountId);
    }
  }

  return { tokenData, updatedEncryptedTokens };
}

async function withTokenRefresh<T>(
  tokenData: TokenData,
  fn: (token: string) => Promise<T>,
  encryptedTokens: string,
): Promise<{ result: T; updatedEncryptedTokens?: string }> {
  let result: T;
  let updated: string | undefined;

  try {
    result = await fn(tokenData.token);
  } catch (e) {
    // If the error looks like a 401, try refreshing
    if (tokenData.refresh_token && (e as { status?: number }).status === 401) {
      const refreshed = await refreshAccessToken(tokenData.refresh_token);
      const newTokenData = { ...tokenData, ...refreshed };
      updated = await encryptTokens(newTokenData);
      result = await fn(newTokenData.token);
    } else {
      throw e;
    }
  }

  return { result, updatedEncryptedTokens: updated };
}

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function b64urlDecode(s: string): string {
  try {
    const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

interface EmailPart {
  mimeType?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: unknown[];
  filename?: string;
  headers?: { name: string; value: string }[];
}

interface ExtractState {
  bodyText: string;
  bodyHtml: string;
  hasAttachments: boolean;
  attachments: AttachmentInfo[];
  cidParts: {
    contentId: string;
    mimeType: string;
    data?: string;
    attachmentId?: string;
  }[];
}

function extractBody(part: EmailPart, state: ExtractState) {
  const mime = part.mimeType ?? "";
  const contentId = part.headers
    ?.find((h) => h.name.toLowerCase() === "content-id")
    ?.value?.replace(/[<>]/g, "");

  if (mime === "text/plain" && part.body?.data) {
    state.bodyText = b64urlDecode(part.body.data);
  } else if (mime === "text/html" && part.body?.data) {
    state.bodyHtml = b64urlDecode(part.body.data);
  } else if (mime.startsWith("image/") && contentId) {
    // Inline image referenced by CID
    state.cidParts.push({
      contentId,
      mimeType: mime,
      data: part.body?.data,
      attachmentId: part.body?.attachmentId,
    });
  } else if (part.filename) {
    // Regular attachment
    state.hasAttachments = true;
    if (part.body?.attachmentId) {
      state.attachments.push({
        filename: part.filename,
        mime_type: mime || "application/octet-stream",
        size: part.body.size ?? 0,
        attachment_id: part.body.attachmentId,
      });
    }
  }

  for (const sub of part.parts ?? []) {
    extractBody(sub as EmailPart, state);
  }
}

async function fetchMessageById(
  accessToken: string,
  messageId: string,
): Promise<EmailData | null> {
  try {
    const msgRes = await gmailRequest(
      accessToken,
      `/messages/${messageId}?format=full`,
    );
    if (!msgRes.ok) return null;
    const msg = await msgRes.json();

    const headers: Record<string, string> = {};
    for (const h of msg.payload?.headers ?? []) {
      headers[(h.name as string).toLowerCase()] = h.value as string;
    }

    const state: ExtractState = {
      bodyText: "",
      bodyHtml: "",
      hasAttachments: false,
      attachments: [],
      cidParts: [],
    };
    extractBody(msg.payload ?? {}, state);

    // Replace CID inline image references with embedded data URIs
    for (const cid of state.cidParts) {
      let imgData = cid.data;
      if (!imgData && cid.attachmentId) {
        try {
          const attRes = await gmailRequest(
            accessToken,
            `/messages/${messageId}/attachments/${cid.attachmentId}`,
          );
          if (attRes.ok) {
            const attJson = await attRes.json();
            imgData = attJson.data as string | undefined;
          }
        } catch {
          /* skip on error */
        }
      }
      if (imgData && state.bodyHtml) {
        const base64 = imgData.replace(/-/g, "+").replace(/_/g, "/");
        const dataUri = `data:${cid.mimeType};base64,${base64}`;
        const escaped = cid.contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        state.bodyHtml = state.bodyHtml.replace(
          new RegExp(`cid:${escaped}`, "gi"),
          dataUri,
        );
      }
    }

    const from = headers["from"] ?? "";
    const replyTo = headers["reply-to"] ?? "";
    const replyToEmail = replyTo ? extractEmail(replyTo) : undefined;
    return {
      gmail_id: msg.id as string,
      thread_id: msg.threadId as string,
      subject: headers["subject"] ?? "",
      sender: from,
      sender_email: extractEmail(from),
      recipients: headers["to"] ?? "",
      snippet: (msg.snippet as string) ?? "",
      body_text: state.bodyText,
      body_html: state.bodyHtml,
      received_at: msg.internalDate
        ? new Date(parseInt(msg.internalDate as string, 10)).toISOString()
        : (headers["date"] ?? new Date().toISOString()),
      is_read: !((msg.labelIds as string[]) ?? []).includes("UNREAD"),
      label_ids: (msg.labelIds as string[]) ?? [],
      has_attachments: state.hasAttachments,
      attachments: state.attachments,
      has_list_unsubscribe: !!(
        headers["list-unsubscribe"] || headers["list-unsubscribe-post"]
      ),
      is_reply: !!(headers["in-reply-to"] || headers["references"]),
      reply_to_email:
        replyToEmail && replyToEmail !== extractEmail(from)
          ? replyToEmail
          : undefined,
      cc_recipients: headers["cc"] ?? undefined,
      precedence_header: headers["precedence"] ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function fetchEmails(
  encryptedTokens: string,
  maxResults = 20,
  supabase?: { from: (t: string) => unknown },
  accountId?: string,
  paginate = false,
): Promise<{ emails: EmailData[]; updatedEncryptedTokens?: string }> {
  const { tokenData, updatedEncryptedTokens } = await resolveTokens(
    encryptedTokens,
    supabase,
    accountId,
  );

  const allMessages: { id: string }[] = [];
  let pageToken: string | undefined;
  const hardCap = paginate ? 500 : maxResults;
  const perPage = Math.min(maxResults, 100); // Gmail max per page is 100

  do {
    let url = `/messages?labelIds=INBOX&maxResults=${perPage}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    let listRes = await gmailRequest(tokenData.token, url);
    // If 401, try refreshing the token once and retry
    if (listRes.status === 401 && tokenData.refresh_token) {
      const refreshed = await refreshAccessToken(tokenData.refresh_token);
      tokenData = { ...tokenData, ...refreshed };
      updatedEncryptedTokens = await encryptTokens(tokenData);
      if (supabase && accountId) {
        // deno-lint-ignore no-explicit-any
        await (supabase.from("gmail_accounts") as any)
          .update({ tokens_encrypted: updatedEncryptedTokens })
          .eq("id", accountId);
      }
      listRes = await gmailRequest(tokenData.token, url);
    }
    if (!listRes.ok) {
      try {
        console.error(
          `[gmail] list failed status=${listRes.status} body=${await listRes.text()}`,
        );
      } catch {
        /* ignore */
      }
      throw new Error("Gmail list fetch failed");
    }
    const listData = await listRes.json();
    const messages: { id: string }[] = listData.messages ?? [];
    allMessages.push(...messages);

    pageToken = paginate ? listData.nextPageToken : undefined;
  } while (pageToken && allMessages.length < hardCap);

  // Trim to hard cap
  const messagesToFetch = allMessages.slice(0, hardCap);

  // Fetch individual messages in parallel. Gmail's user-level quota (250
  // units/s) comfortably allows a burst of 50 concurrent message.get calls
  // (5 units each), so for a typical initial fetch we do a single round trip.
  // For very large backlogs we still cap to avoid hammering the quota.
  const CONCURRENCY = 50;
  const emails: EmailData[] = [];

  for (let i = 0; i < messagesToFetch.length; i += CONCURRENCY) {
    const chunk = messagesToFetch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((stub) => fetchMessageById(tokenData.token, stub.id)),
    );
    for (const r of results) {
      if (r) emails.push(r);
    }
  }

  return { emails, updatedEncryptedTokens };
}

export async function setupGmailWatch(
  encryptedTokens: string,
  supabase: { from: (t: string) => unknown },
  accountId: string,
): Promise<void> {
  const topic = getEnv("PUBSUB_TOPIC");
  if (!topic) {
    console.warn("[setupGmailWatch] PUBSUB_TOPIC not set — skipping");
    return;
  }

  const { tokenData } = await resolveTokens(
    encryptedTokens,
    supabase,
    accountId,
  );
  const res = await gmailRequest(tokenData.token, "/watch", {
    method: "POST",
    body: JSON.stringify({ topicName: topic, labelIds: ["INBOX"] }),
  });

  if (!res.ok) {
    try {
      console.error(
        `[gmail] watch failed status=${res.status} body=${await res.text()}`,
      );
    } catch {
      /* ignore */
    }
    throw new Error("Gmail watch setup failed");
  }

  const data = await res.json();
  // deno-lint-ignore no-explicit-any
  await (supabase.from("gmail_accounts") as any)
    .update({
      history_id: data.historyId as string,
      watch_expiry: new Date(Number(data.expiration)).toISOString(),
    })
    .eq("id", accountId);
}

export interface HistoryFetchResult {
  emails: EmailData[];
  newHistoryId: string | null;
  tooOld?: boolean;
}

export async function fetchEmailsByHistoryId(
  encryptedTokens: string,
  startHistoryId: string,
  supabase?: { from: (t: string) => unknown },
  accountId?: string,
): Promise<HistoryFetchResult> {
  const { tokenData } = await resolveTokens(
    encryptedTokens,
    supabase,
    accountId,
  );

  const res = await gmailRequest(
    tokenData.token,
    `/history?startHistoryId=${startHistoryId}&labelId=INBOX&historyTypes=messageAdded`,
  );

  if (res.status === 404) {
    return { emails: [], newHistoryId: null, tooOld: true };
  }
  if (!res.ok) {
    try {
      console.error(
        `[gmail] history.list failed status=${res.status} body=${await res.text()}`,
      );
    } catch {
      /* ignore */
    }
    throw new Error("Gmail history fetch failed");
  }

  const data = await res.json();
  const newHistoryId = (data.historyId as string) ?? null;

  // Collect unique message IDs added to INBOX.
  // The API request already filters by labelId=INBOX, so all returned
  // messagesAdded records are for inbox messages. The stub objects in
  // messagesAdded frequently have an empty labelIds array even for genuine
  // inbox messages, so filtering on the stub is incorrect — trust the API.
  const messageIds = new Set<string>();
  for (const record of (data.history ?? []) as {
    messagesAdded?: { message: { id: string } }[];
  }[]) {
    for (const added of record.messagesAdded ?? []) {
      messageIds.add(added.message.id);
    }
  }

  if (messageIds.size === 0) {
    return { emails: [], newHistoryId };
  }

  const results = await Promise.all(
    [...messageIds].map((id) => fetchMessageById(tokenData.token, id)),
  );
  return {
    emails: results.filter((e): e is EmailData => e !== null),
    newHistoryId,
  };
}

export async function sendEmail(
  encryptedTokens: string,
  to: string[],
  subject: string,
  bodyHtml: string,
  inReplyTo?: string,
  threadId?: string,
  trackingPixelUrl?: string,
  attachments?: { name: string; contentType: string; data: string }[],
): Promise<{ id: string }> {
  const { tokenData } = await resolveTokens(encryptedTokens);

  let html = bodyHtml;
  if (trackingPixelUrl) {
    html += `<img src="${trackingPixelUrl}" width="1" height="1" border="0" alt="" />`;
  }

  const baseHeaders = [
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];
  if (inReplyTo) {
    baseHeaders.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  }

  let mimeMessage: string;

  if (attachments && attachments.length > 0) {
    // Multipart/mixed for emails with attachments
    const boundary = `runemail_${crypto.randomUUID().replace(/-/g, "")}`;
    const htmlB64 = btoa(unescape(encodeURIComponent(html)));

    let body = baseHeaders.join("\r\n");
    body += `\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n`;
    body += `\r\n--${boundary}\r\n`;
    body += `Content-Type: text/html; charset=UTF-8\r\n`;
    body += `Content-Transfer-Encoding: base64\r\n\r\n`;
    body += htmlB64 + `\r\n`;

    for (const att of attachments) {
      body += `\r\n--${boundary}\r\n`;
      body += `Content-Type: ${att.contentType || "application/octet-stream"}; name="${att.name}"\r\n`;
      body += `Content-Disposition: attachment; filename="${att.name}"\r\n`;
      body += `Content-Transfer-Encoding: base64\r\n\r\n`;
      body += att.data + `\r\n`;
    }

    body += `\r\n--${boundary}--`;
    mimeMessage = body;
  } else {
    // Simple HTML email
    const headerLines = [
      ...baseHeaders,
      "Content-Type: text/html; charset=UTF-8",
    ];
    mimeMessage = `${headerLines.join("\r\n")}\r\n\r\n${html}`;
  }

  const raw = btoa(unescape(encodeURIComponent(mimeMessage)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const body: Record<string, string> = { raw };
  if (threadId) body.threadId = threadId;

  const { result } = await withTokenRefresh(
    tokenData,
    async (token) => {
      const res = await gmailRequest(token, "/messages/send", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        try {
          console.error(
            `[gmail] send failed status=${res.status} body=${await res.text()}`,
          );
        } catch {
          /* ignore */
        }
        const err = new Error("Gmail send failed");
        (err as unknown as { status: number }).status = res.status;
        throw err;
      }
      return res.json();
    },
    encryptedTokens,
  );

  return result as { id: string };
}

export async function fetchSentEmails(
  encryptedTokens: string,
  maxResults = 20,
): Promise<
  {
    id: string;
    subject: string;
    to: string;
    date: string;
    body_html: string;
    body: string;
    snippet: string;
    has_attachments: boolean;
    attachments: AttachmentInfo[];
  }[]
> {
  const { tokenData } = await resolveTokens(encryptedTokens);

  const listRes = await gmailRequest(
    tokenData.token,
    `/messages?labelIds=SENT&maxResults=${maxResults}`,
  );
  if (!listRes.ok) return [];

  const data = await listRes.json();
  const messages: { id: string }[] = data.messages ?? [];
  const sent: {
    id: string;
    subject: string;
    to: string;
    date: string;
    body_html: string;
    body: string;
    snippet: string;
    has_attachments: boolean;
    attachments: AttachmentInfo[];
  }[] = [];

  const CONCURRENCY = 5;
  for (let i = 0; i < messages.length; i += CONCURRENCY) {
    const chunk = messages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (stub) => {
        try {
          const msgRes = await gmailRequest(
            tokenData.token,
            `/messages/${stub.id}?format=full`,
          );
          if (!msgRes.ok) return null;
          const msg = await msgRes.json();
          const headers: Record<string, string> = {};
          for (const h of msg.payload?.headers ?? []) {
            headers[(h.name as string).toLowerCase()] = h.value as string;
          }
          const state: ExtractState = {
            bodyText: "",
            bodyHtml: "",
            hasAttachments: false,
            attachments: [],
            cidParts: [],
          };
          extractBody(msg.payload ?? {}, state);
          return {
            id: msg.id as string,
            subject: headers["subject"] ?? "",
            to: headers["to"] ?? "",
            date: headers["date"] ?? "",
            body_html: state.bodyHtml,
            body: state.bodyText,
            snippet: (msg.snippet as string) ?? "",
            has_attachments: state.hasAttachments,
            attachments: state.attachments,
          };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r) sent.push(r);
    }
  }
  return sent;
}

export async function fetchAttachment(
  encryptedTokens: string,
  messageId: string,
  attachmentId: string,
): Promise<{ data: string; size: number } | null> {
  const { tokenData } = await resolveTokens(encryptedTokens);
  try {
    const res = await gmailRequest(
      tokenData.token,
      `/messages/${messageId}/attachments/${attachmentId}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    return { data: json.data as string, size: json.size as number };
  } catch {
    return null;
  }
}

export async function fetchDrafts(
  encryptedTokens: string,
): Promise<{ id: string; subject: string; snippet: string }[]> {
  const { tokenData } = await resolveTokens(encryptedTokens);

  const listRes = await gmailRequest(tokenData.token, "/drafts");
  if (!listRes.ok) return [];

  const data = await listRes.json();
  const draftStubs: { id: string }[] = data.drafts ?? [];
  const drafts: { id: string; subject: string; snippet: string }[] = [];

  const CONCURRENCY = 5;
  for (let i = 0; i < draftStubs.length; i += CONCURRENCY) {
    const chunk = draftStubs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (d) => {
        try {
          const draftRes = await gmailRequest(
            tokenData.token,
            `/drafts/${d.id}`,
          );
          if (!draftRes.ok) return null;
          const draft = await draftRes.json();
          const msg = draft.message ?? {};
          const headers: Record<string, string> = {};
          for (const h of msg.payload?.headers ?? []) {
            headers[(h.name as string).toLowerCase()] = h.value as string;
          }
          return {
            id: d.id,
            subject: headers["subject"] ?? "",
            snippet: (msg.snippet as string) ?? "",
          };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r) drafts.push(r);
    }
  }
  return drafts;
}

export async function fetchGoogleContacts(
  encryptedTokens: string,
): Promise<{ name: string; email: string }[]> {
  const { tokenData } = await resolveTokens(encryptedTokens);
  const contacts: { name: string; email: string }[] = [];
  let pageToken: string | undefined;

  do {
    const url = `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenData.token}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    const connections: Array<{
      names?: Array<{ displayName: string }>;
      emailAddresses?: Array<{ value: string }>;
    }> = data.connections ?? [];
    for (const c of connections) {
      const name = c.names?.[0]?.displayName;
      const email = c.emailAddresses?.[0]?.value?.toLowerCase();
      if (name && email) contacts.push({ name, email });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return contacts;
}

/** Search Google contacts and Workspace directory by name or email query. */
export async function searchGoogleContacts(
  encryptedTokens: string,
  query: string,
): Promise<{ name: string; email: string }[]> {
  const { tokenData } = await resolveTokens(encryptedTokens);
  const results: { name: string; email: string }[] = [];
  const seen = new Set<string>();

  // Try Workspace directory search first (works for Workspace accounts like @nyu.edu)
  try {
    const dirRes = await fetch(
      `https://people.googleapis.com/v1/people:searchDirectoryPeople?query=${encodeURIComponent(query)}&readMask=names,emailAddresses&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE&pageSize=10`,
      { headers: { Authorization: `Bearer ${tokenData.token}` } },
    );
    if (dirRes.ok) {
      const data = await dirRes.json();
      for (const p of data.people ?? []) {
        const name = p.names?.[0]?.displayName;
        const email = p.emailAddresses?.[0]?.value?.toLowerCase();
        if (name && email && !seen.has(email)) {
          seen.add(email);
          results.push({ name, email });
        }
      }
    }
  } catch {
    /* not a Workspace account or scope not granted */
  }

  // Also search personal contacts
  try {
    const contRes = await fetch(
      `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(query)}&readMask=names,emailAddresses&pageSize=10`,
      { headers: { Authorization: `Bearer ${tokenData.token}` } },
    );
    if (contRes.ok) {
      const data = await contRes.json();
      for (const r of data.results ?? []) {
        const p = r.person;
        const name = p.names?.[0]?.displayName;
        const email = p.emailAddresses?.[0]?.value?.toLowerCase();
        if (name && email && !seen.has(email)) {
          seen.add(email);
          results.push({ name, email });
        }
      }
    }
  } catch {
    /* ignore */
  }

  return results;
}
