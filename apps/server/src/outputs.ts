import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { PlaybackState, Track } from './types.js';
import { WiimClient, type UpnpTarget, type WiimTransportState } from './wiim.js';

type XmlNode = Record<string, unknown>;
type DeviceOrigin = 'configured' | 'discovered' | 'manual';
export interface OutputDevice extends UpnpTarget {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  address: string;
  descriptionUrl: string;
  origin: DeviceOrigin;
}
export interface OutputDeviceView {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  address: string;
  origin: DeviceOrigin;
  selected: boolean;
  protocol: 'UPnP / DLNA';
}

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });
const service = (value: unknown) => Array.isArray(value) ? value : value ? [value] : [];
const text = (value: unknown) => value === undefined || value === null ? '' : String(value).trim();
const idFor = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);

function deviceNodes(value: unknown): XmlNode[] {
  if (!value || typeof value !== 'object') return [];
  const node = value as XmlNode;
  const own = node.deviceType || node.serviceList ? [node] : [];
  return own.concat(Object.values(node).flatMap(deviceNodes));
}

export function parseDeviceDescription(xml: string, descriptionUrl: string, origin: DeviceOrigin = 'discovered'): OutputDevice {
  const root = parser.parse(xml) as XmlNode;
  const candidates = deviceNodes(root);
  for (const device of candidates) {
    const services = service((device.serviceList as XmlNode | undefined)?.service) as XmlNode[];
    const transport = services.find((item) => text(item.serviceType).includes(':service:AVTransport:'));
    const rendering = services.find((item) => text(item.serviceType).includes(':service:RenderingControl:'));
    if (!transport || !rendering) continue;
    const udn = text(device.UDN) || descriptionUrl;
    const urlBase = text((root.root as XmlNode | undefined)?.URLBase) || descriptionUrl;
    const resolve = (path: unknown) => new URL(text(path), urlBase).toString();
    const url = new URL(descriptionUrl);
    return {
      id: idFor(udn),
      name: text(device.friendlyName) || text(device.modelName) || url.hostname,
      manufacturer: text(device.manufacturer) || undefined,
      model: text(device.modelName) || undefined,
      address: url.hostname,
      descriptionUrl,
      origin,
      avTransportUrl: resolve(transport.controlURL),
      renderingControlUrl: resolve(rendering.controlURL),
      avTransportType: text(transport.serviceType),
      renderingControlType: text(rendering.serviceType)
    };
  }
  throw new Error('This address does not advertise a controllable UPnP audio renderer.');
}

async function fetchDescription(url: string, origin: DeviceOrigin): Promise<OutputDevice> {
  const response = await fetch(url, { headers: { Accept: 'application/xml,text/xml' }, signal: AbortSignal.timeout(4_000) });
  if (!response.ok) throw new Error(`Player description returned ${response.status}`);
  const body = await response.text();
  if (body.length > 1_000_000) throw new Error('Player description is unexpectedly large');
  return parseDeviceDescription(body, response.url || url, origin);
}

function discoverLocations(timeout = 2200): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    const locations = new Set<string>();
    const finish = () => { try { socket.close(); } catch { /* already closed */ } resolve([...locations]); };
    const timer = setTimeout(finish, timeout);
    socket.on('message', (message) => {
      const match = message.toString('utf8').match(/^location:\s*(.+)$/im);
      if (match?.[1]) locations.add(match[1].trim());
    });
    socket.on('error', () => { clearTimeout(timer); finish(); });
    socket.bind(() => {
      const targets = [1, 2, 3].flatMap((version) => [`urn:schemas-upnp-org:device:MediaRenderer:${version}`, `urn:schemas-upnp-org:service:AVTransport:${version}`]);
      for (const target of targets) {
        const request = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${target}\r\n\r\n`);
        socket.send(request, 1900, '239.255.255.250');
      }
    });
  });
}

export class OutputManager {
  private readonly file: string;
  private readonly devices = new Map<string, OutputDevice>();
  private selectedId?: string;
  private client?: WiimClient;
  private loaded: Promise<void>;

  constructor(directory: string, configuredHost?: string, configuredPort = 49152) {
    this.file = join(directory, 'output.json');
    if (configuredHost) {
      const id = idFor(`configured:${configuredHost}:${configuredPort}`);
      this.devices.set(id, {
        id, name: 'Configured network player', manufacturer: 'WiiM / UPnP', model: undefined,
        address: configuredHost, descriptionUrl: `http://${configuredHost}:${configuredPort}/description.xml`, origin: 'configured',
        avTransportUrl: `http://${configuredHost}:${configuredPort}/upnp/control/rendertransport1`,
        renderingControlUrl: `http://${configuredHost}:${configuredPort}/upnp/control/rendercontrol1`
      });
      this.selectInMemory(id);
    }
    this.loaded = this.restore();
  }

  private async restore() {
    try {
      const stored = JSON.parse(await readFile(this.file, 'utf8')) as { selected?: OutputDevice };
      if (stored.selected) { this.devices.set(stored.selected.id, stored.selected); this.selectInMemory(stored.selected.id); }
    } catch { /* First run, or the configured fallback remains selected. */ }
  }
  private selectInMemory(id: string) {
    const device = this.devices.get(id);
    if (!device) throw new Error('That network player is no longer available. Discover players again.');
    this.selectedId = id;
    this.client = new WiimClient(device);
  }
  private selected() {
    if (!this.client || !this.selectedId) throw new Error('Choose a network player before starting playback.');
    return { client: this.client, device: this.devices.get(this.selectedId)! };
  }
  private async persist() {
    const selected = this.selectedId ? this.devices.get(this.selectedId) : undefined;
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ selected }, null, 2), { mode: 0o600 });
    await rename(temporary, this.file);
  }
  private views(): OutputDeviceView[] {
    return [...this.devices.values()].map((device) => ({
      id: device.id, name: device.name, manufacturer: device.manufacturer, model: device.model,
      address: device.address, origin: device.origin, selected: device.id === this.selectedId, protocol: 'UPnP / DLNA' as const
    })).sort((a, b) => Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));
  }
  async list() { await this.loaded; return { devices: this.views(), selectedId: this.selectedId }; }
  async discover() {
    await this.loaded;
    const locations = await discoverLocations();
    const found = await Promise.allSettled(locations.map((location) => fetchDescription(location, 'discovered')));
    for (const result of found) if (result.status === 'fulfilled') this.devices.set(result.value.id, result.value);
    // Upgrade the legacy fixed WiiM entry to its real advertised name and paths when possible.
    for (const item of [...this.devices.values()].filter((device) => device.origin === 'configured')) {
      try {
        const described = await fetchDescription(item.descriptionUrl, 'configured');
        const upgraded = { ...described, id: item.id, origin: 'configured' as const };
        this.devices.set(item.id, upgraded);
        for (const candidate of [...this.devices.values()]) if (candidate.id !== item.id && candidate.avTransportUrl === upgraded.avTransportUrl) this.devices.delete(candidate.id);
        if (item.id === this.selectedId) this.selectInMemory(item.id);
      } catch { /* Its established fixed control URLs remain usable. */ }
    }
    if (this.selectedId) await this.persist();
    return { devices: this.views(), selectedId: this.selectedId };
  }
  async addManual(address: string) {
    await this.loaded;
    const raw = address.trim();
    const candidates = /^https?:\/\//i.test(raw) ? [raw] : [
      `http://${raw}/description.xml`, `http://${raw}:49152/description.xml`
    ];
    let lastError: unknown;
    for (const candidate of candidates) {
      try { const device = await fetchDescription(candidate, 'manual'); this.devices.set(device.id, device); return { device: this.view(device), devices: this.views(), selectedId: this.selectedId }; }
      catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error('No compatible player was found at that address.');
  }
  private view(device: OutputDevice): OutputDeviceView { return { id: device.id, name: device.name, manufacturer: device.manufacturer, model: device.model, address: device.address, origin: device.origin, selected: device.id === this.selectedId, protocol: 'UPnP / DLNA' }; }
  async choose(id: string) { await this.loaded; this.selectInMemory(id); await this.persist(); return { ok: true, selected: this.view(this.devices.get(id)!) }; }
  async selectedView() { await this.loaded; return this.selectedId ? this.view(this.devices.get(this.selectedId)!) : undefined; }

  async setUri(uri: string, track: Track, artwork: string) { return this.selected().client.setUri(uri, track, artwork); }
  async setNextUri(uri: string, track?: Track, artwork = '') { return this.selected().client.setNextUri(uri, track, artwork); }
  supportsNextUri() { return this.selected().client.supportsNextUri(); }
  async play() { return this.selected().client.play(); }
  async pause() { return this.selected().client.pause(); }
  async stop() { return this.selected().client.stop(); }
  async seek(seconds: number) { return this.selected().client.seek(seconds); }
  async setVolume(volume: number) { return this.selected().client.setVolume(volume); }
  async setMute(muted: boolean) { return this.selected().client.setMute(muted); }
  async transportState(): Promise<WiimTransportState> { return this.selected().client.transportState(); }
  async state(): Promise<PlaybackState & { trackUri?: string }> {
    const { client, device } = this.selected();
    return { ...(await client.state()), deviceName: device.name };
  }
}

export async function outputRoutes(app: FastifyInstance, { outputs, beforeChoose }: { outputs: OutputManager; beforeChoose?: () => Promise<void> }) {
  const sameOrigin = async (request: { method: string; headers: Record<string, unknown> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (request.method !== 'POST') return;
    const origin = request.headers.origin;
    const host = request.headers.host;
    let other = false;
    try { other = !!origin && new URL(String(origin)).host !== host; } catch { other = true; }
    if (request.headers['sec-fetch-site'] === 'cross-site' || other) return reply.code(403).send({ error: 'Output selection must be used from SHELF on this server.' });
  };
  app.addHook('onRequest', sameOrigin);
  app.get('/', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); return outputs.list(); });
  app.post('/discover', async () => outputs.discover());
  app.post('/manual', async (request) => outputs.addManual(z.object({ address: z.string().trim().min(1).max(300) }).parse(request.body).address));
  app.post('/select', async (request) => {
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(request.body);
    if (beforeChoose) await beforeChoose();
    return outputs.choose(id);
  });
}
