'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthUser, clearUser, getGoogleClientId, getStoredUser, initGoogleAuth, renderGoogleButton } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export default function AuthButton() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const clientId = getGoogleClientId();

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  useEffect(() => {
    if (user || !clientId) return;

    function tryInit() {
      initGoogleAuth((u) => setUser(u));
      if (btnRef.current) renderGoogleButton(btnRef.current);
    }

    // GSI script may not be loaded yet
    if ((window as any).google?.accounts?.id) {
      tryInit();
    } else {
      const interval = setInterval(() => {
        if ((window as any).google?.accounts?.id) {
          clearInterval(interval);
          tryInit();
        }
      }, 200);
      return () => clearInterval(interval);
    }
  }, [user, clientId]);

  if (!clientId) return null;

  if (user) {
    return (
      <div className="flex items-center gap-2">
        {user.picture && (
          <img src={user.picture} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
        )}
        <span className="text-sm hidden sm:inline">{user.name}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => { clearUser(); setUser(null); }}
        >
          Sign out
        </Button>
      </div>
    );
  }

  return <div ref={btnRef} />;
}
