import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { api, ApiError } from '@/api';
import * as auth from '@/api/auth';
import type { TokenPair, User } from '@/api/types';

/**
 * - `restoring`: launch, checking the Keychain for a session.
 * - `unreachable`: a session is stored but the server could not be reached to resume it.
 * - `signed-out`, `signing-in`, `signed-in`: as named.
 */
export type AuthStatus = 'restoring' | 'unreachable' | 'signed-out' | 'signing-in' | 'signed-in';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Why the last attempt to restore the session failed, when `status` is `unreachable`. */
  restoreError: string | null;
  retryRestore: () => void;
  /** Runs a sign-in request and starts the session it returns. Throws on failure, with the server's message. */
  signIn: (request: () => Promise<TokenPair>) => Promise<void>;
  signOut: () => Promise<void>;
  /** Deletes the account and all its records on the server, then signs out. Throws if the server refused. */
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [user, setUser] = useState<User | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const restore = useCallback(async () => {
    setStatus('restoring');
    setRestoreError(null);
    try {
      if (!(await api.hasStoredSession())) {
        setStatus('signed-out');
        return;
      }
      // getMe refreshes first (there is no access token yet at launch).
      setUser(await auth.getMe());
      setStatus('signed-in');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setStatus('signed-out'); // the stored session was refused; the client has already cleared it
      } else {
        setRestoreError(error instanceof Error ? error.message : 'Could not reach CrewStub.');
        setStatus('unreachable');
      }
    }
  }, []);

  useEffect(() => {
    // The server ended the session part-way through (signed out elsewhere, refresh token refused).
    api.onSignedOut(() => {
      const wasSignedIn = statusRef.current === 'signed-in';
      setUser(null);
      setStatus('signed-out');
      if (wasSignedIn) Alert.alert('Signed out', 'Your session has ended. Please sign in again.');
    });
    void restore();
    return () => api.onSignedOut(null);
  }, [restore]);

  const signIn = useCallback(async (request: () => Promise<TokenPair>) => {
    setStatus('signing-in');
    try {
      const pair = await request();
      await api.startSession(pair);
      setUser(pair.user);
      setStatus('signed-in');
    } catch (error) {
      setStatus('signed-out');
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await auth.logout(); // ends the session on the server too, so the refresh token is dead everywhere
    } catch {
      // Offline or already ended: forgetting the session here is what matters to the person.
    }
    await api.clearSession();
    setUser(null);
    setStatus('signed-out');
  }, []);

  const deleteAccount = useCallback(async () => {
    await auth.deleteMe();
    await api.clearSession();
    setUser(null);
    setStatus('signed-out');
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, user, restoreError, retryRestore: () => void restore(), signIn, signOut, deleteAccount }),
    [status, user, restoreError, restore, signIn, signOut, deleteAccount],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth needs an AuthProvider');
  return value;
}
