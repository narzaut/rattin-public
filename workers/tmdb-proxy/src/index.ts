// Cloudflare Worker: TMDB API Proxy
// Proxies requests to api.themoviedb.org, adding the API key from env.
// Caches responses at the edge to reduce TMDB API calls.

interface Env {
  TMDB_API_KEY: string;
}

const TMDB_BASE = "https://api.themoviedb.org";

// Cache TTLs per path pattern (seconds)
const CACHE_TTL: Record<string, number> = {
  "/3/genre/": 7 * 24 * 3600,        // 7 days
  "/3/trending/": 24 * 3600,           // 24 hours
  "/3/discover/": 24 * 3600,           // 24 hours
  "/3/movie/": 24 * 3600,              // 24 hours
  "/3/tv/": 6 * 3600,                  // 6 hours
  "/3/search/": 30 * 60,               // 30 minutes
  "/3/review/": 6 * 3600,              // 6 hours
  "/3/configuration": 7 * 24 * 3600,   // 7 days
};

function getTTL(path: string): number {
  for (const [prefix, ttl] of Object.entries(CACHE_TTL)) {
    if (path.startsWith(prefix)) return ttl;
  }
  return 60 * 60; // default: 1 hour
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Only allow GET requests
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build the TMDB URL with API key
    const tmdbUrl = new URL(url.pathname + url.search, TMDB_BASE);
    tmdbUrl.searchParams.set("api_key", env.TMDB_API_KEY);

    // Check Cloudflare edge cache
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    // Fetch from TMDB
    const tmdbResponse = await fetch(tmdbUrl.toString(), {
      headers: { "User-Agent": "Rattin-Proxy/1.0" },
    });

    if (!tmdbResponse.ok) {
      return new Response(await tmdbResponse.text(), {
        status: tmdbResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ttl = getTTL(url.pathname);

    // Clone the response and add cache headers
    response = new Response(await tmdbResponse.text(), {
      status: tmdbResponse.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${ttl}`,
        "Access-Control-Allow-Origin": "*",
      },
    });

    // Store in Cloudflare edge cache
    await cache.put(cacheKey, response.clone());

    return response;
  },
};
