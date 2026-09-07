import { describe, expect, it } from 'vitest';
import { formatClock, parseClock, xmlEscape } from './xml.js';

describe('UPnP XML helpers', () => {
  it('escapes media URLs for SOAP and DIDL', () => expect(xmlEscape('a&b<"c"')).toBe('a&amp;b&lt;&quot;c&quot;'));
  it('converts UPnP clocks', () => {
    expect(parseClock('01:02:03')).toBe(3723);
    expect(formatClock(3723)).toBe('01:02:03');
    expect(parseClock('NOT_IMPLEMENTED')).toBe(0);
  });
});
