const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const WS_BASE = API_BASE.replace(/^http/, 'ws');

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

export interface TtsModel {
  name: string;
  language: string;
  level: string;
  path: string;
  json_path: string;
}

export interface EngineInfo {
  tag: string;
  name: string;
  room_name: string;
  clients: number;
  running: boolean;
}

export interface SystemStatus {
  state: string;
  engines: EngineInfo[];
  total_clients: number;
}

export interface AddEngineBody {
  language_tag: string;
  language_name: string;
  model_name: string;
  model_path: string;
  model_json_path: string;
  model_level: string;
}

async function req<T>(method: string, path: string, body?: unknown, auth = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const json = await res.json();
        detail = json.detail || '';
      } catch {}
      throw new Error(detail || `${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function authReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  return req<T>(method, path, body, true);
}

export const api = {
  getModels: () => req<TtsModel[]>('GET', '/api/models'),

  getEngines: () => authReq<EngineInfo[]>('GET', '/api/engines'),

  addEngine: (data: AddEngineBody) => authReq<{ status: string; tag: string }>('POST', '/api/engines', data),

  removeEngine: (tag: string) => authReq<{ status: string }>('DELETE', `/api/engines/${tag}`),

  getStatus: () => authReq<SystemStatus>('GET', '/api/status'),

  startListening: () => authReq<{ status: string; state: string }>('POST', '/api/listen/start'),

  stopListening: () => authReq<{ status: string; state: string }>('POST', '/api/listen/stop'),

  pauseListening: () => authReq<{ status: string; state: string }>('POST', '/api/listen/pause'),

  resumeListening: () => authReq<{ status: string; state: string }>('POST', '/api/listen/resume'),

  getLogs: (limit = 100) => authReq<string[]>('GET', `/api/logs?limit=${limit}`),

  getConfig: () => req<{ frontend_url: string }>('GET', '/api/auth/config'),
};

export const auth = {
  login: (username: string, password: string) =>
    req<{ token: string; user: { id: string; username: string } }>('POST', '/api/auth/login', { username, password }),

  signup: (username: string, password: string) =>
    req<{ token: string; user: { id: string; username: string } }>('POST', '/api/auth/signup', { username, password }),

  logout: () => authReq<{ status: string }>('POST', '/api/auth/logout'),

  me: () => authReq<{ user: { id: string; username: string } }>('GET', '/api/auth/me'),
};

function wsAuthSuffix(): string {
  const token = getToken();
  return token ? `?token=${encodeURIComponent(token)}` : '';
}

export function connectTranscripts(
  onTranscript: (source: string) => void,
  onTranslation: (tag: string, source: string, translated: string) => void,
): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/api/ws/transcripts${wsAuthSuffix()}`);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'transcript') onTranscript(msg.data.source_text);
      else if (msg.type === 'translation') onTranslation(msg.data.tag, msg.data.source_text, msg.data.translated_text);
    } catch {}
  };
  return ws;
}

export function connectLogs(onLog: (entry: string) => void): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/api/ws/logs${wsAuthSuffix()}`);
  ws.onmessage = (e) => onLog(e.data);
  return ws;
}

export async function getBrowserMics(): Promise<MediaDeviceInfo[]> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    stream.getTracks().forEach((t) => t.stop());
    return devices.filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}
