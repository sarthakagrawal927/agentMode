const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api';
// Non-sensitive profile cache only (email/name/picture/id/plan).
// The auth token itself is now held in an httpOnly cookie set by the server.
const PROFILE_KEY = 'agentdata_profile';
// Legacy key (used to hold the JWT in localStorage). We purge it on load to
// neutralise pre-migration tokens and force a one-time re-login.
const LEGACY_KEY = 'agentdata_auth';

export interface AuthUser {
  email: string;
  name: string;
  picture: string;
  // idToken stays in the type for callsite stability but is no longer
  // populated client-side — the cookie is the source of truth.
  idToken?: string;
  id?: string;
  plan?: string;
}

interface StoredProfile {
  email: string;
  name: string;
  picture: string;
  id?: string;
  plan?: string;
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    // Purge any legacy token-bearing entry left over from the localStorage era.
    if (localStorage.getItem(LEGACY_KEY)) {
      localStorage.removeItem(LEGACY_KEY);
    }
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProfile;
    return { ...parsed, idToken: undefined } as AuthUser;
  } catch {
    return null;
  }
}

function storeProfile(user: AuthUser) {
  const profile: StoredProfile = {
    email: user.email,
    name: user.name,
    picture: user.picture,
    id: user.id,
    plan: user.plan,
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearUser() {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(LEGACY_KEY);
  // Best-effort: clear server cookie too.
  void fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
}

// Kept for backward compatibility with callsites that spread the result into
// fetch headers. We now rely on the httpOnly cookie + credentials:'include',
// so this returns an empty object.
export function getAuthHeaders(): Record<string, string> {
  return {};
}

// Wrapper that callsites can adopt incrementally — sends the cookie and the
// usual JSON content-type. Existing callsites still work because the cookie
// rides along on every same-origin/cross-origin (with credentials) request.
export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' });
}

async function syncSession(idToken: string): Promise<StoredProfile | null> {
  try {
    // Send the Google ID token via Authorization header on the very first call
    // — the server promotes it to an httpOnly cookie on success. Subsequent
    // requests use the cookie automatically.
    const resp = await fetch(`${API_BASE_URL}/auth/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      email: data.email,
      name: data.name,
      picture: data.picture,
      id: data.id,
      plan: data.plan || 'free',
    };
  } catch {
    return null;
  }
}

export function initGoogleAuth(onSignIn: (user: AuthUser) => void) {
  if (typeof window === 'undefined' || !GOOGLE_CLIENT_ID) return;

  const g = (window as any).google;
  if (!g?.accounts?.id) return;

  g.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: async (response: any) => {
      const idToken: string = response.credential;
      try {
        const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        // Sync with backend: this both upserts the user and sets the httpOnly
        // cookie. We only persist non-sensitive profile metadata locally.
        const session = await syncSession(idToken);
        const user: AuthUser = {
          email: session?.email || payload.email,
          name: session?.name || payload.name || payload.email,
          picture: session?.picture || payload.picture || '',
          id: session?.id,
          plan: session?.plan || 'free',
        };
        storeProfile(user);
        onSignIn(user);
      } catch {
        // ignore decode errors
      }
    },
  });
}

export function renderGoogleButton(element: HTMLElement) {
  const g = (window as any).google;
  if (!g?.accounts?.id) return;
  g.accounts.id.renderButton(element, {
    theme: 'outline',
    size: 'medium',
    type: 'standard',
    text: 'signin',
  });
}

export function getGoogleClientId() {
  return GOOGLE_CLIENT_ID;
}
