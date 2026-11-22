import { api } from './index';
import type { Meta, TokenPair, User } from './types';

/** Public: versions and which sign-in methods the server has switched on. */
export function getMeta(): Promise<Meta> {
  return api.request<Meta>('GET', '/v1/meta', { auth: false });
}

export function signInWithApple(input: {
  identityToken: string;
  nonce: string;
  fullName: { givenName: string; familyName: string } | null;
}): Promise<TokenPair> {
  return api.request<TokenPair>('POST', '/v1/auth/apple', { auth: false, body: input });
}

export function signInWithGoogle(idToken: string): Promise<TokenPair> {
  return api.request<TokenPair>('POST', '/v1/auth/google', { auth: false, body: { idToken } });
}

/** Email and password: offered when the server has PASSWORD_LOGIN_ENABLED=true (`signIn.password` in /v1/meta). */
export function signUpWithPassword(input: { email: string; password: string; name: string }): Promise<TokenPair> {
  return api.request<TokenPair>('POST', '/v1/auth/password/signup', { auth: false, body: input });
}

export function signInWithPassword(input: { email: string; password: string }): Promise<TokenPair> {
  return api.request<TokenPair>('POST', '/v1/auth/password/login', { auth: false, body: input });
}

export function logout(): Promise<void> {
  return api.request<void>('POST', '/v1/auth/logout');
}

export function getMe(): Promise<User> {
  return api.request<User>('GET', '/v1/me');
}

/** Deletes the account and every record it owns, on every device. */
export function deleteMe(): Promise<void> {
  return api.request<void>('DELETE', '/v1/me');
}
