import { useConnection } from '@/store/connection';

// ---- response shapes (mirror clipper/app/webui.py) -------------------------
export type JobState = {
  running: string | null;
  last: { step: string; ok: boolean; result: string; at: string } | null;
};

export type StatusResponse = {
  counts: {
    videos: Record<string, number>;
    clips: Record<string, number>;
    posts: Record<string, number>;
  };
  job: JobState;
  threshold: number;
};

export type ReviewClip = {
  id: number;
  title: string | null;
  caption: string | null;
  hashtags: string[];
  hook_score: number;
  start: number;
  end: number;
  permission: string;
  permission_cleared: boolean;
  has_video: boolean;
};

export type Source = {
  id: number;
  url: string;
  type: string;
  permission_status: string;
  cleared: boolean;
  last_seen: string | null;
};

export type PipelineStep =
  | 'run'
  | 'ingest'
  | 'transcribe'
  | 'analyze'
  | 'render'
  | 'publish';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function base(): { url: string; token: string } {
  const { serverUrl, token } = useConnection.getState();
  if (!serverUrl) throw new ApiError(0, 'No server configured — set it in the Server tab.');
  return { url: serverUrl, token };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, token } = base();
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { 'X-Clipper-Token': token } : {}),
  };
  let res: Response;
  try {
    res = await fetch(url + path, { ...init, headers });
  } catch {
    throw new ApiError(0, `Can't reach ${url} — same Wi-Fi? Server running?`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? body.reason ?? JSON.stringify(body);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

// ---- endpoints --------------------------------------------------------------
export const api = {
  status: () => request<StatusResponse>('/api/status'),
  review: () => request<ReviewClip[]>('/api/review'),
  sources: () => request<Source[]>('/api/sources'),
  addSource: (url: string, type: string, permission: string) =>
    request<{ id: number }>('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ url, type, permission }),
    }),
  deleteSource: (id: number) =>
    request<{ ok: boolean }>(`/api/sources/${id}`, { method: 'DELETE' }),
  runStep: (step: PipelineStep) =>
    request<{ started: boolean; step?: string; reason?: string }>(
      `/api/run/${step}`,
      { method: 'POST' },
    ),
  approve: (clipId: number) =>
    request<{ result: string }>(`/api/clip/${clipId}/approve`, { method: 'POST' }),
  reject: (clipId: number) =>
    request<{ result: string }>(`/api/clip/${clipId}/reject`, { method: 'POST' }),
  saveCaption: (clipId: number, caption: string, approve: boolean) =>
    request<{ result: string }>(`/api/clip/${clipId}/caption`, {
      method: 'POST',
      body: JSON.stringify({ caption, approve }),
    }),
};

/** Streaming URL for a clip preview (token goes in the query string). */
export function clipVideoUrl(clipId: number): string {
  const { url, token } = base();
  return `${url}/clip/${clipId}/video${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** Quick connectivity probe used by the Server screen. */
export async function testConnection(
  rawUrl: string,
  token: string,
): Promise<{ ok: true; clipsReady: number } | { ok: false; error: string }> {
  const url = rawUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(`${url}/api/status`, {
      headers: token ? { 'X-Clipper-Token': token } : {},
    });
    if (res.status === 401) return { ok: false, error: 'Server requires a token (or the token is wrong).' };
    if (!res.ok) return { ok: false, error: `Server answered ${res.status}.` };
    const body = (await res.json()) as StatusResponse;
    return { ok: true, clipsReady: body.counts.clips?.ready ?? 0 };
  } catch {
    return { ok: false, error: 'Unreachable — check the address, Wi-Fi, and that `python run.py webui` is running.' };
  }
}
