export interface AlbumSummary {
  source?: 'jellyfin' | 'spotify' | 'plex' | 'files';
  externalUrl?: string;
  id: string;
  title: string;
  artist: string;
  year?: number;
  genres: string[];
  artworkUrl: string;
  backArtworkUrl: string;
  spineUrl: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  index: number;
  disc: number;
  durationSeconds: number;
}

export interface AlbumDetail extends AlbumSummary {
  tracks: Track[];
  durationSeconds: number;
}

export interface PlaybackState {
  transport: 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING' | 'UNKNOWN';
  trackId?: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  durationSeconds: number;
  positionSeconds: number;
  volume: number;
  muted: boolean;
  albumId?: string;
  externalUrl?: string;
  deviceName?: string;
  shuffle?: boolean;
  supportsVolume?: boolean;
  disallows?: Record<string, boolean>;
  queueIndex?: number;
  queueLength?: number;
  queueWarning?: string;
}
