import { getAuth } from 'firebase/auth';

/**
 * fetch() wrapper for our own /api routes. Attaches the signed-in user's Firebase ID token
 * as `Authorization: Bearer <token>`, which the server's authMiddleware verifies.
 * Identity is never taken from the request body.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  // Resolved lazily at call time; the Firebase app is initialised in ./firebase before any request is made.
  const user = getAuth().currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
