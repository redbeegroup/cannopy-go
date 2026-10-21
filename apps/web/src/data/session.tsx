import type { Business, MemberRole, User } from '@cannopy/core';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import {
  type Auth,
  clearBooks,
  clearDevice,
  loadAuth,
  loadSession,
  localDb,
  type Session,
  saveAuth,
  saveSession,
} from '../db/local';
import { syncManager } from '../sync/manager';
import { api, setApiToken } from './api';

/**
 * Who is signed in on this device and which business is open. Both are kept
 * in the meta table so the app opens straight into the books without signal:
 * the token is only checked when syncing.
 *
 * Three states: nobody signed in (sign-in screen), signed in with no business
 * open (choose or create one), and a business open (the app).
 */
interface SessionState {
  auth: Auth | null;
  session: Session | null;
  /** True while the session is being read from IndexedDB on first open. */
  loading: boolean;
  /** After a sign-in: keeps the token and user, no business open yet. */
  setAuth(auth: Auth): Promise<void>;
  /** Opens a business. Drops the books of a different business kept on this device. */
  openBusiness(business: Business, role: MemberRole): Promise<void>;
  updateBusiness(patch: Partial<Business>): Promise<void>;
  updateUser(patch: Partial<User>): Promise<void>;
  /** Closes the business but stays signed in, to pick another. */
  closeBusiness(): Promise<void>;
  /** Signs out on the server (best effort) and wipes the device copy. */
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [auth, setAuthState] = useState<Auth | null>(null);
  const [session, setState] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadAuth(localDb), loadSession(localDb)])
      .then(([a, s]) => {
        if (cancelled) return;
        setApiToken(a?.token ?? null);
        setAuthState(a);
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

  const setAuth = useCallback(async (a: Auth) => {
    await saveAuth(localDb, a);
    setApiToken(a.token);
    setAuthState(a);
    setState((s) => (s ? { ...s, token: a.token, user: a.user } : s));
  }, []);

  const openBusiness = useCallback(
    async (business: Business, role: MemberRole) => {
      if (!auth) throw new Error('Sign in before opening a business');
      const current = await loadSession(localDb);
      if (current && current.business.id !== business.id) {
        syncManager.stop();
        await clearBooks(localDb);
      }
      const s: Session = { ...auth, business, role };
      await saveSession(localDb, s);
      setState(s);
      syncManager.start(business.id);
    },
    [auth],
  );

  const updateBusiness = useCallback(
    async (patch: Partial<Business>) => {
      if (!session) return;
      const next = { ...session, business: { ...session.business, ...patch } };
      await saveSession(localDb, next);
      setState(next);
    },
    [session],
  );

  const updateUser = useCallback(
    async (patch: Partial<User>) => {
      if (!auth) return;
      await setAuth({ ...auth, user: { ...auth.user, ...patch } });
    },
    [auth, setAuth],
  );

  const closeBusiness = useCallback(async () => {
    syncManager.stop();
    await clearBooks(localDb);
    setState(null);
  }, []);

  const signOut = useCallback(async () => {
    syncManager.stop();
    try {
      await api('/auth/sign-out', { method: 'POST', body: {} });
    } catch {
      // No signal or already signed out: the device copy goes either way.
    }
    await clearDevice(localDb);
    setApiToken(null);
    setAuthState(null);
    setState(null);
  }, []);

  return (
    <SessionContext.Provider
      value={{
        auth,
        session,
        loading,
        setAuth,
        openBusiness,
        updateBusiness,
        updateUser,
        closeBusiness,
        signOut,
      }}
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

/** For screens inside the app, where an open business is guaranteed. */
export function useSession(): Session {
  const { session } = useSessionState();
  if (!session)
    throw new Error('No session: this screen must be rendered after a business is open');
  return session;
}
