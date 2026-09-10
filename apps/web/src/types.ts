export type Source = 'jellyfin' | 'spotify' | 'plex' | 'files';
export type SpineStyle = 'cd' | 'tape' | 'covers';
export interface SpotifyStatus { configured: boolean; connected: boolean; connectUrl: string; deviceId?: string; deviceName?: string }
export interface SpotifyDevices { devices: { id: string; name: string; active: boolean; restricted: boolean }[]; selectedId?: string }
export interface SourceConnection { configured: boolean; connected?: boolean; error?: string; albums?: number }
export interface SourceStatus { jellyfin: SourceConnection; spotify: SpotifyStatus; plex: SourceConnection; files: SourceConnection }
export interface OutputDevice { id: string; name: string; manufacturer?: string; model?: string; address: string; origin: 'configured' | 'discovered' | 'manual'; selected: boolean; protocol: 'UPnP / DLNA' }
export interface OutputDevices { devices: OutputDevice[]; selectedId?: string }
export interface AlbumSummary { id: string; title: string; artist: string; year?: number; genres: string[]; artworkUrl: string; thumbnailUrl?: string; backArtworkUrl: string; spineUrl: string; source?: Source; externalUrl?: string }
export interface Track { id: string; title: string; artist: string; album: string; index: number; disc: number; durationSeconds: number }
export interface AlbumDetail extends AlbumSummary { tracks: Track[]; durationSeconds: number }
export interface GuideResult { items: AlbumSummary[]; interpretation: string; shouldPlay: boolean }
export interface AlbumRef { source: Source; albumId: string; title: string; artist: string; artworkUrl?: string; addedAt: string }
export interface Crate { id: string; name: string; createdAt: string; albums: AlbumRef[] }
export interface AlbumIntelligence { album: AlbumDetail; related: AlbumSummary[]; listening: { plays: number; lastPlayedAt?: string }; context: string; credits: string[]; linerNotes: string; note: string }
export interface SourcedStory { text: string; sourceName: string; sourceUrl: string }
export interface TrackIntelligence { track: Track; story?: SourcedStory; lyrics?: { plain: string; sourceName: string; sourceUrl?: string }; note: string }
export interface PlaybackState {
  transport: 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING' | 'UNKNOWN';
  title?: string; artist?: string; album?: string; artworkUrl?: string; durationSeconds: number; positionSeconds: number; volume: number; muted: boolean;
  trackId?: string; albumId?: string; externalUrl?: string; deviceName?: string; shuffle?: boolean; supportsVolume?: boolean; disallows?: Record<string, boolean>;
  queueIndex?: number; queueLength?: number; queueWarning?: string;
}
