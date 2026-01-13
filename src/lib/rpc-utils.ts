import { supabase } from "@/integrations/supabase/client";

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  shouldRetry: (error: Error) => {
    const msg = error?.message?.toLowerCase() || '';
    // Don't retry on schema/column errors - they need code fixes
    if (msg.includes('does not exist') || msg.includes('column')) return false;
    // Don't retry on permission errors
    if (msg.includes('permission denied') || msg.includes('rls')) return false;
    // Retry on network/timeout errors
    return true;
  },
};

export async function rpcWithRetry<T>(
  fnName: string,
  params: Record<string, unknown>,
  options: RetryOptions = {}
): Promise<{ data: T | null; error: Error | null }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      console.log(`[RPC] ${fnName} attempt ${attempt + 1}`, sanitizeParams(params));
      const startTime = performance.now();
      
      const { data, error } = await supabase.rpc(fnName as any, params as any);
      
      const duration = Math.round(performance.now() - startTime);
      
      if (error) {
        lastError = new Error(error.message);
        console.error(`[RPC] ${fnName} error (${duration}ms):`, error.message);
        
        if (!opts.shouldRetry(lastError) || attempt === opts.maxRetries) {
          return { data: null, error: lastError };
        }
      } else {
        const rowCount = Array.isArray(data) ? data.length : 1;
        console.log(`[RPC] ${fnName} success (${duration}ms), rows:`, rowCount);
        return { data: data as T, error: null };
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[RPC] ${fnName} exception:`, lastError.message);
      
      if (!opts.shouldRetry(lastError) || attempt === opts.maxRetries) {
        return { data: null, error: lastError };
      }
    }

    // Exponential backoff with jitter
    const jitter = Math.random() * 200;
    console.log(`[RPC] ${fnName} retrying in ${Math.round(delay + jitter)}ms...`);
    await new Promise(resolve => setTimeout(resolve, delay + jitter));
    delay = Math.min(delay * 2, opts.maxDelayMs);
  }

  return { data: null, error: lastError };
}

// Sanitize params for logging (hide sensitive data)
function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key.toLowerCase().includes('password') || key.toLowerCase().includes('token')) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 100) {
      sanitized[key] = value.substring(0, 100) + '...';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function formatRpcError(error: Error | null): string {
  if (!error) return 'Unknown error';
  const msg = error.message || '';
  
  if (msg.includes('timeout') || msg.includes('57014')) {
    return 'Query timed out. Try narrowing your date range or search criteria.';
  }
  if (msg.includes('does not exist')) {
    return 'Database configuration error. Please contact support.';
  }
  if (msg.includes('permission denied')) {
    return 'Access denied. Please check your permissions.';
  }
  if (msg.includes('Failed to fetch') || msg.includes('network')) {
    return 'Network error. Please check your connection and try again.';
  }
  
  return 'Failed to load data. Please try again.';
}
