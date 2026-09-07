import { XMLParser } from 'fast-xml-parser';
import type { PlaybackState, Track } from './types.js';
import { formatClock, parseClock, xmlEscape } from './xml.js';

type SoapArgs = Record<string, string | number>;
type XmlNode = Record<string, unknown>;
export interface WiimTransportState {
  transport: PlaybackState['transport'];
  trackUri?: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  durationSeconds: number;
  positionSeconds: number;
}

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });

function firstText(node: unknown, key: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const record = node as XmlNode;
  if (record[key] !== undefined) return String(record[key]);
  for (const value of Object.values(record)) {
    const found = firstText(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

export class WiimClient {
  private readonly baseUrl: string;
  constructor(host: string, port = 49152) { this.baseUrl = `http://${host}:${port}`; }

  private async soap(service: 'AVTransport' | 'RenderingControl', action: string, args: SoapArgs): Promise<XmlNode> {
    const version = '1';
    const path = service === 'AVTransport' ? '/upnp/control/rendertransport1' : '/upnp/control/rendercontrol1';
    const bodyArgs = Object.entries(args).map(([key, value]) => `<${key}>${xmlEscape(String(value))}</${key}>`).join('');
    const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:${version}">${bodyArgs}</u:${action}></s:Body></s:Envelope>`;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"urn:schemas-upnp-org:service:${service}:${version}#${action}"` }, body,
      signal: AbortSignal.timeout(5_000)
    });
    const text = await response.text();
    const result = parser.parse(text) as XmlNode;
    // Device responses can contain authenticated stream URLs. Do not put the
    // response body into public API errors or logs.
    if (!response.ok || firstText(result, 'errorCode')) throw new Error(`WiiM ${action} failed (${response.status}, code ${firstText(result, 'errorCode') ?? 'unknown'})`);
    return result;
  }

  private metadata(uri: string, track: Track, artworkUri: string): string {
    return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="${xmlEscape(track.id)}" parentID="0" restricted="1"><dc:title>${xmlEscape(track.title)}</dc:title><upnp:artist>${xmlEscape(track.artist)}</upnp:artist><upnp:album>${xmlEscape(track.album)}</upnp:album><upnp:albumArtURI>${xmlEscape(artworkUri)}</upnp:albumArtURI><upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo="http-get:*:audio/*:*" duration="${formatClock(track.durationSeconds)}">${xmlEscape(uri)}</res></item></DIDL-Lite>`;
  }

  async setUri(uri: string, track: Track, artworkUri: string): Promise<void> {
    await this.soap('AVTransport', 'SetAVTransportURI', { InstanceID: 0, CurrentURI: uri, CurrentURIMetaData: this.metadata(uri, track, artworkUri) });
  }

  async setNextUri(uri: string, track?: Track, artworkUri = ''): Promise<void> {
    await this.soap('AVTransport', 'SetNextAVTransportURI', { InstanceID: 0, NextURI: uri, NextURIMetaData: track ? this.metadata(uri, track, artworkUri) : '' });
  }

  async playUri(uri: string, track: Track, artworkUri: string): Promise<void> {
    await this.setUri(uri, track, artworkUri);
    await this.play();
  }

  async play(): Promise<void> { await this.soap('AVTransport', 'Play', { InstanceID: 0, Speed: 1 }); }
  async pause(): Promise<void> { await this.soap('AVTransport', 'Pause', { InstanceID: 0 }); }
  async stop(): Promise<void> { await this.soap('AVTransport', 'Stop', { InstanceID: 0 }); }
  async seek(seconds: number): Promise<void> { await this.soap('AVTransport', 'Seek', { InstanceID: 0, Unit: 'REL_TIME', Target: formatClock(seconds) }); }
  async setVolume(volume: number): Promise<void> { await this.soap('RenderingControl', 'SetVolume', { InstanceID: 0, Channel: 'Master', DesiredVolume: Math.max(0, Math.min(100, Math.round(volume))) }); }
  async setMute(muted: boolean): Promise<void> { await this.soap('RenderingControl', 'SetMute', { InstanceID: 0, Channel: 'Master', DesiredMute: muted ? 1 : 0 }); }

  async transportState(): Promise<WiimTransportState> {
    const [transport, position] = await Promise.all([
      this.soap('AVTransport', 'GetTransportInfo', { InstanceID: 0 }),
      this.soap('AVTransport', 'GetPositionInfo', { InstanceID: 0 })
    ]);
    const metadata = firstText(position, 'TrackMetaData');
    const parsedMetadata = metadata && metadata !== 'NOT_IMPLEMENTED' ? parser.parse(metadata) as XmlNode : {};
    const rawTransport = firstText(transport, 'CurrentTransportState') ?? 'UNKNOWN';
    const valid = ['PLAYING', 'PAUSED_PLAYBACK', 'STOPPED', 'TRANSITIONING'].includes(rawTransport) ? rawTransport : 'UNKNOWN';
    return {
      transport: valid as PlaybackState['transport'],
      trackUri: firstText(position, 'TrackURI'),
      title: firstText(parsedMetadata, 'title'), artist: firstText(parsedMetadata, 'artist'), album: firstText(parsedMetadata, 'album'),
      artworkUrl: firstText(parsedMetadata, 'albumArtURI'), durationSeconds: parseClock(firstText(position, 'TrackDuration')),
      positionSeconds: parseClock(firstText(position, 'RelTime'))
    };
  }

  async state(): Promise<PlaybackState & { trackUri?: string }> {
    const [transport, volume, mute] = await Promise.all([
      this.transportState(),
      this.soap('RenderingControl', 'GetVolume', { InstanceID: 0, Channel: 'Master' }),
      this.soap('RenderingControl', 'GetMute', { InstanceID: 0, Channel: 'Master' })
    ]);
    return { ...transport, volume: Number(firstText(volume, 'CurrentVolume') ?? 0), muted: firstText(mute, 'CurrentMute') === '1' };
  }
}
