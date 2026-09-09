import { afterEach, expect, it, vi } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { WiimClient } from './wiim.js';
import { xmlEscape } from './xml.js';

const xml = (body: string) => new Response(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${body}</s:Body></s:Envelope>`, { headers: { 'content-type': 'text/xml' } });
afterEach(() => vi.unstubAllGlobals());
it('sends correctly escaped next-track DIDL metadata and supports clearing the native queue', async () => {
  const fetcher = vi.fn(async () => xml('<ok/>')); vi.stubGlobal('fetch', fetcher);
  const client = new WiimClient('speaker.local');
  await client.setNextUri('http://music/stream?a=1&b=2', { id: 'track', title: 'A & B <Mix>', artist: 'An artist', album: 'An album', durationSeconds: 65, disc: 1, index: 2 }, 'http://music/cover');
  const options = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(options.headers).toMatchObject({ SOAPAction: '"urn:schemas-upnp-org:service:AVTransport:1#SetNextAVTransportURI"' });
  const parser = new XMLParser({ removeNSPrefix: true });
  const body = parser.parse(String(options.body)).Envelope.Body.SetNextAVTransportURI;
  expect(body.NextURI).toBe('http://music/stream?a=1&b=2');
  const metadata = parser.parse(body.NextURIMetaData)['DIDL-Lite'].item;
  expect(metadata.title).toBe('A & B <Mix>');
  await client.setNextUri('');
  expect(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body)).toContain('<NextURI></NextURI>');
});
it('reads the track URI as internal transport identity, independent of display metadata', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => String(options.body).includes('GetTransportInfo') ? xml('<CurrentTransportState>PLAYING</CurrentTransportState>') : xml(`<TrackURI>${xmlEscape('http://music/Audio/track/stream?api_key=secret')}</TrackURI><TrackDuration>00:03:00</TrackDuration><RelTime>00:00:04</RelTime>`)));
  expect(await new WiimClient('speaker.local').transportState()).toMatchObject({ transport: 'PLAYING', trackUri: 'http://music/Audio/track/stream?api_key=secret', positionSeconds: 4, durationSeconds: 180 });
});
it('does not leak stream credentials through SOAP fault messages', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => xml('<s:Fault><detail><errorCode>401</errorCode><errorDescription>http://music?api_key=secret</errorDescription></detail></s:Fault>')));
  const track = { id: 'track', title: 'Title', artist: 'Artist', album: 'Album', durationSeconds: 60, disc: 1, index: 1 };
  await expect(new WiimClient('speaker.local').setUri('http://music?api_key=secret', track, '')).rejects.toThrow('code 401');
  await expect(new WiimClient('speaker.local').setUri('http://music?api_key=secret', track, '')).rejects.not.toThrow('secret');
});
it('recognises renderers without the optional native next-URI action', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => xml('<s:Fault><detail><errorCode>401</errorCode></detail></s:Fault>')));
  const client = new WiimClient('speaker.local'); await client.setNextUri('http://music/next');
  expect(client.supportsNextUri()).toBe(false);
});
