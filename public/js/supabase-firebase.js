/**
 * Browser Helper: Firebase Auth + Supabase Third-Party Authentication
 * Project ID: gueattend | Supabase Ref: cnpullmxupyqdndxzbih
 *
 * Uses ONLY public Firebase Web Config + Supabase Publishable (Anon) Key.
 * Never touches or stores Supabase secret keys or Firebase service account credentials.
 */

let cachedSupabaseConfig = null;
let cachedSupabaseClient = null;

/**
 * Ensures the signed-in Firebase user carries `role = "authenticated"` custom claim
 * and refreshes the Firebase ID token (`getIdToken(true)`) whenever claims are assigned.
 */
export async function refreshFirebaseTokenWithClaims(firebaseUser) {
  if (!firebaseUser) return null;

  try {
    const tokenResult = await firebaseUser.getIdTokenResult();
    if (tokenResult?.claims?.role === 'authenticated') {
      return tokenResult.token;
    }

    const syncResp = await fetch('/api/auth/sync-claims', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenResult.token}`,
      },
      body: JSON.stringify({}),
    });

    if (syncResp.ok) {
      const data = await syncResp.json();
      if (data.tokenRefreshRequired || data.claimAssigned) {
        return await firebaseUser.getIdToken(true);
      }
    }
  } catch (err) {
    console.warn('[supabase-firebase] Claim sync/refresh note:', err.message);
  }

  return firebaseUser.getIdToken();
}

/**
 * Fetches public Supabase URL and publishable anon key from backend (never secret keys).
 */
export async function getPublicSupabaseConfig() {
  if (cachedSupabaseConfig) return cachedSupabaseConfig;
  const resp = await fetch('/api/auth/supabase-config');
  if (!resp.ok) {
    return { configured: false, url: '', anonKey: '' };
  }
  cachedSupabaseConfig = await resp.json();
  return cachedSupabaseConfig;
}

/**
 * Creates a Supabase JS client authenticated dynamically via Firebase ID tokens
 * through Supabase's official third-party `accessToken` callback.
 */
export async function createFirebaseSupabaseClient(firebaseAuth) {
  if (cachedSupabaseClient) return cachedSupabaseClient;

  const supaCfg = await getPublicSupabaseConfig();
  if (!supaCfg.configured || !supaCfg.url || !supaCfg.anonKey) {
    return null;
  }

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');

  cachedSupabaseClient = createClient(supaCfg.url, supaCfg.anonKey, {
    accessToken: async () => {
      const user = firebaseAuth?.currentUser;
      if (!user) return null;
      return refreshFirebaseTokenWithClaims(user);
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return cachedSupabaseClient;
}

