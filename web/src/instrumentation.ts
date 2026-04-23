/**
 * Next.js instrumentation hook — runs once at server startup (before any
 * route handlers are called).
 *
 * We use it to register undici's EnvHttpProxyAgent so Node's global fetch()
 * respects HTTP_PROXY / HTTPS_PROXY / NO_PROXY environment variables —
 * essential in corporate networks / CentOS 7 codelab-style hosts where all
 * external egress must go through a proxy but internal services must not.
 *
 * Without this, fetch("https://openrouter.ai/...") silently fails with
 * "fetch failed" (ENOTFOUND / ETIMEDOUT) even when curl works.
 */
export async function register() {
  // Only run on the Node.js server runtime (not Edge)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;

  if (!httpProxy && !httpsProxy) {
    console.log("[proxy] no HTTP_PROXY/HTTPS_PROXY set — fetch will go direct");
    return;
  }

  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
    console.log(
      `[proxy] fetch routed via proxy — HTTPS_PROXY=${httpsProxy || httpProxy} NO_PROXY=${process.env.NO_PROXY || process.env.no_proxy || "(unset)"}`
    );
  } catch (err) {
    console.warn(
      "[proxy] failed to install EnvHttpProxyAgent — external fetch may fail:",
      err
    );
  }
}
