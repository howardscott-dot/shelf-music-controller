import { expect, it } from 'vitest';
import { parseDeviceDescription } from './outputs.js';

it('builds a generic renderer from its advertised UPnP services instead of assuming WiiM paths', () => {
  const device = parseDeviceDescription(`<?xml version="1.0"?><root><URLBase>http://192.0.2.40:8080/</URLBase><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Living Room CXN</friendlyName><manufacturer>Cambridge Audio</manufacturer><modelName>CXN100</modelName><UDN>uuid:example-player</UDN><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:2</serviceType><controlURL>/control/transport</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/control/volume</controlURL></service></serviceList></device></root>`, 'http://192.0.2.40:8080/device.xml');
  expect(device).toMatchObject({ name: 'Living Room CXN', manufacturer: 'Cambridge Audio', model: 'CXN100', avTransportUrl: 'http://192.0.2.40:8080/control/transport', renderingControlUrl: 'http://192.0.2.40:8080/control/volume', avTransportType: 'urn:schemas-upnp-org:service:AVTransport:2' });
});

it('rejects a UPnP server that cannot render audio', () => {
  expect(() => parseDeviceDescription('<root><device><friendlyName>NAS media server</friendlyName></device></root>', 'http://192.0.2.50/device.xml')).toThrow('controllable UPnP audio renderer');
});
