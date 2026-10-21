import type { Business, User } from '@cannopy/core';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { clearDevice, loadSession, localDb, type Session, saveSession } from '../db/local';
import { syncManager } from '../sync/manager';

/**
 * The business and owner this device is set up for. Null until onboarding
 * finishes. Stored in the meta table so the app opens straight into the books
 * without signal.
 */
interface SessionState {
  session: Session | null;
  /** True while the session is being read from IndexedDB on first open. */
  loading: boolean;
  setSession(session: Session): Promise<void>;
  updateBusiness(patch: Partial<Business>): Promise<void>;
  updateUser(patch: Partial<User>): Promise<void>;
  /** Wipes the device copy and returns to onboarding. */
  reset(): Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setState] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadSession(localDb)
      .then((s) => {
        if (cancelled) return;
        setState(s);
        if (s) syncManager.start(s.business.id);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSession = useCallback(async (s: Session) => {
    await saveSession(localDb, s);
    setState(s);
    syncManager.start(s.business.id);
  }, []);

  const updateBusiness = useCallback(
    async (patch: Partial<Business>) => {
      if (!session) return;
      await setSession({ ...session, business: { ...session.business, ...patch } });
    },
    [session, setSession],
  );

  const updateUser = useCallback(
    async (patch: Partial<User>) => {
      if (!session) return;
      await setSession({ ...session, user: { ...session.user, ...patch } });
    },
    [session, setSession],
  );

  const reset = useCallback(async () => {
    syncManager.stop();
    await clearDevice(localDb);
    setState(null);
  }, []);

  return (
    <SessionContext.Provider
      value={{ session, loading, setSession, updateBusiness, updateUser, reset }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionState(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionState needs a SessionProvider');
  return ctx;
}

/** For screens inside the app, where a session is guaranteed. */
export function useSession(): Session {
  const { session } = useSessionState();
  if (!session) throw new Error('No session: this screen must be rendered after onboarding');
  return session;
}
