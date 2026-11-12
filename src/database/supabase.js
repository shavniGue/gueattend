/**
 * Supabase Client & Health-Check Service
 *
 * Project Reference: cnpullmxupyqdndxzbih
 * Reads credentials strictly from environment variables:
 *   - SUPABASE_URL
 *   - SUPABASE_PUBLISHABLE_KEY (Anon key)
 *   - SUPABASE_SECRET_KEY (Service Role key)
 *   - SUPABASE_JWKS_URL
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cnpullmxupyqdndxzbih.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';
const SUPABASE_JWKS_URL = process.env.SUPABASE_JWKS_URL || `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;

let supabaseClient = null;
let supabaseAdmin = null;

if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  } catch (err) {
    console.warn('[supabase] Warning initializing public Supabase client:', err.message);
  }
}

if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  try {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  } catch (err) {
    console.warn('[supabase] Warning initializing admin Supabase client:', err.message);
  }
}

/**
 * Diagnostic health-check that reports exact configuration status.
 * Never simulates success.
 */
async function checkSupabaseHealth() {
  const result = {
    configured: false,
    projectUrl: SUPABASE_URL,
    projectRef: 'cnpullmxupyqdndxzbih',
    jwksUrl: SUPABASE_JWKS_URL,
    hasPublishableKey: Boolean(SUPABASE_PUBLISHABLE_KEY),
    hasSecretKey: Boolean(SUPABASE_SECRET_KEY),
    clientInitialized: Boolean(supabaseClient),
    adminInitialized: Boolean(supabaseAdmin),
    jwksReachable: false,
    databaseReachable: false,
    status: 'unconfigured',
    message: '',
  };

  // 1. Verify JWKS Endpoint
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(SUPABASE_JWKS_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const jwks = await resp.json();
      result.jwksReachable = Array.isArray(jwks?.keys) && jwks.keys.length > 0;
    }
  } catch (err) {
    result.jwksError = err.message;
  }

  // 2. Validate Key configuration
  const missing = [];
  if (!SUPABASE_PUBLISHABLE_KEY) missing.push('SUPABASE_PUBLISHABLE_KEY');
  if (!SUPABASE_SECRET_KEY) missing.push('SUPABASE_SECRET_KEY');

  if (missing.length > 0) {
    result.status = 'missing_credentials';
    result.message = `Missing environment configuration: ${missing.join(', ')}. Set them in your environment or .env file.`;
    return result;
  }

  // 3. Test Database Connectivity via Supabase Admin Client
  try {
    if (supabaseAdmin) {
      const { error } = await supabaseAdmin.from('users').select('id', { count: 'exact', head: true });
      if (error) {
        // Table might not exist yet before migrations, check error code
        if (error.code === '42P01') {
          // Table does not exist yet, but connection succeeded!
          result.databaseReachable = true;
          result.configured = true;
          result.status = 'connected_schema_pending';
          result.message = 'Supabase API connected successfully (schema migrations pending).';
        } else {
          result.status = 'auth_error';
          result.message = `Supabase query rejected: ${error.message} (${error.code || 'unknown'})`;
        }
      } else {
        result.databaseReachable = true;
        result.configured = true;
        result.status = 'connected';
        result.message = 'Supabase client connected and operational.';
      }
    }
  } catch (err) {
    result.status = 'connection_failed';
    result.message = `Supabase request failed: ${err.message}`;
  }

  return result;
}

/**
 * Returns ONLY public Supabase configuration safe to expose to browsers.
 * Never includes SUPABASE_SECRET_KEY.
 */
function getSupabasePublicConfig() {
  const validAnon = Boolean(
    SUPABASE_PUBLISHABLE_KEY && !SUPABASE_PUBLISHABLE_KEY.includes('your_')
  );
  return {
    configured: Boolean(SUPABASE_URL && validAnon),
    url: SUPABASE_URL,
    anonKey: validAnon ? SUPABASE_PUBLISHABLE_KEY : '',
  };
}

/**
 * Creates a Firebase-scoped Supabase JS client using the official third-party auth
 * `accessToken` callback so PostgREST runs queries under the PostgreSQL `authenticated` role
 * enforced by Supabase RLS policies.
 */
function createFirebaseScopedSupabaseClient(accessTokenOrCallback) {
  const pubCfg = getSupabasePublicConfig();
  if (!pubCfg.configured) {
    return null;
  }

  const accessTokenFn =
    typeof accessTokenOrCallback === 'function'
      ? accessTokenOrCallback
      : async () => accessTokenOrCallback || null;

  return createClient(pubCfg.url, pubCfg.anonKey, {
    accessToken: accessTokenFn,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY,
  SUPABASE_JWKS_URL,
  supabaseClient,
  supabaseAdmin,
  checkSupabaseHealth,
  getSupabasePublicConfig,
  createFirebaseScopedSupabaseClient,
};
