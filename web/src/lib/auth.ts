const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const STORAGE_KEY = 'agentdata_auth';

export interface AuthUser {
  email: string;
  name: string;
  picture: string;
  idToken: string;
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function storeUser(user: AuthUser) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearUser() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const user = getStoredUser();
  if (!user?.idToken) return {};
  return { Authorization: `Bearer ${user.idToken}` };
}

export function initGoogleAuth(onSignIn: (user: AuthUser) => void) {
  if (typeof window === 'undefined' || !GOOGLE_CLIENT_ID) return;

  const g = (window as any).google;
  if (!g?.accounts?.id) return;

  g.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response: any) => {
      const idToken: string = response.credential;
      // Decode JWT payload (base64url)
      try {
        const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const user: AuthUser = {
          email: payload.email,
          name: payload.name || payload.email,
          picture: payload.picture || '',
          idToken,
        };
        storeUser(user);
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
