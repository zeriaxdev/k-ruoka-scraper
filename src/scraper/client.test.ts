import { test, expect, afterAll } from "bun:test";
import { fetchJson, UpstreamError } from "./client";

let hits = 0;
let mode = "ok";

const server = Bun.serve({
  port: 0,
  fetch() {
    hits++;
    if (mode === "ok") return Response.json({ result: [] });
    if (mode === "challenge")
      return new Response("<html><title>Just a moment...</title>", {
        status: 403,
        headers: { "cf-mitigated": "challenge", "cf-ray": "abc123-HEL" },
      });
    if (mode === "flaky")
      return hits < 3 ? new Response("upstream boom", { status: 503 }) : Response.json({ ok: true });
    return new Response("nope", { status: 400 });
  },
});
const url = `http://localhost:${server.port}/`;
afterAll(() => server.stop(true));

test("Cloudflare challenge is named, not retried, and not reported as a bare 403", async () => {
  hits = 0;
  mode = "challenge";
  const err = (await fetchJson(url, {}, "t").catch((e) => e)) as UpstreamError;
  expect(err).toBeInstanceOf(UpstreamError);
  expect(err.kind).toBe("challenge");
  expect(err.status).toBe(403);
  expect(err.message).toContain("Cloudflare");
  expect(err.message).toContain("abc123-HEL");
  expect(hits).toBe(1); // deterministic: retrying would just hammer the origin
});

test("retries transient 5xx and eventually succeeds", async () => {
  hits = 0;
  mode = "flaky";
  expect(await fetchJson(url, {}, "t")).toEqual({ ok: true });
  expect(hits).toBe(3);
});

test("surfaces the real status and body for a non-retryable error", async () => {
  hits = 0;
  mode = "bad";
  const err = (await fetchJson(url, {}, "t").catch((e) => e)) as UpstreamError;
  expect(err.status).toBe(400);
  expect(err.kind).toBe("http");
  expect(err.detail).toBe("nope");
  expect(hits).toBe(1);
});
