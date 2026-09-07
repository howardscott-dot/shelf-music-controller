// Shared by CD and cassette lookups: MusicBrainz allows one request per second.
let nextRequest = 0;
export async function musicBrainzFetch(url: URL): Promise<Response> {
  const wait = Math.max(0, nextRequest - Date.now());
  nextRequest = Math.max(Date.now(), nextRequest) + 1100;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const response = await fetch(url, { headers: { 'User-Agent': 'SHELF/0.1 (personal self-hosted music controller)', Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 429 || response.status === 503) nextRequest = Math.max(nextRequest, Date.now() + 10_000);
  return response;
}
