const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL; // e.g. http://172.17.0.1:8191/v1
const CLEARANCE_TTL_MS = 25 * 60 * 1000; // cf_clearance typically lasts ~30min, refresh a bit early

interface Clearance {
  cookie: string;
  userAgent: string;
  expiresAt: number;
}

let cached: Clearance | null = null;
let inFlight: Promise<Clearance> | null = null;

async function solve(url: string): Promise<Clearance> {
  if (!FLARESOLVERR_URL) {
    throw new Error("FLARESOLVERR_URL is not set — can't solve Cloudflare challenge");
  }

  const res = await fetch(FLARESOLVERR_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 60000 }),
  });

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(`FlareSolverr failed to solve challenge: ${data.message}`);
  }

  const { cookies, userAgent } = data.solution;
  const cookie = cookies
    .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
    .join("; ");

  return { cookie, userAgent, expiresAt: Date.now() + CLEARANCE_TTL_MS };
}

/** Cached clearance cookie/UA pair, solving via FlareSolverr only when stale or missing. */
export async function getClearance(
  challengeUrl = "https://www.k-ruoka.fi/kauppa",
): Promise<Clearance> {
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (inFlight) return inFlight; // de-dupe concurrent solves

  inFlight = solve(challengeUrl)
    .then((c) => {
      cached = c;
      inFlight = null;
      return c;
    })
    .catch((err) => {
      inFlight = null;
      throw err;
    });

  return inFlight;
}

/** Call when a request still gets challenged despite a cached clearance — forces a fresh solve. */
export function invalidateClearance() {
  cached = null;
}
