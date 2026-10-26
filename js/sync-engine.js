/**
 * yt_radio - Global Synchronization Engine with Admin DJ Master Clock & SSE Event Bus
 * 
 * In this architecture:
 * - Admin DJ (authenticated with password 'admin') acts as the authoritative MASTER CLOCK.
 * - Listeners continuously track the exact millisecond of the Admin's track in real time.
 */

export class SyncEngine {
  constructor(options = {}) {
    this.epoch = options.epoch || 1704067200000;
    this.clientId = 'client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    this.playlist = [];
    this.totalDuration = 0;
    this.clockOffset = 0; // serverTime - clientLocalTime
    this.listenersCount = 1;
    this.currentTrackIndex = -1;
    this.playlistVersion = 0;
    this.eventSource = null;

    // Admin DJ State
    this.adminToken = sessionStorage.getItem('yt_radio_admin_token') || null;
    this.isAdmin = false;
    this.stationState = null; // Master station state reported by DJ
    this.adminSyncInterval = null;

    this.listeners = {
      trackChange: [],
      tick: [],
      syncDrift: [],
      listenersChange: [],
      playlistUpdate: [],
      djStateUpdate: [],
      adminStatusChange: [],
      ready: []
    };
    this.tickInterval = null;
    this.heartbeatInterval = null;
  }

  async init(playlistData = null) {
    if (playlistData && Array.isArray(playlistData)) {
      this.setPlaylist(playlistData);
    } else {
      await this.reloadPlaylist();
    }

    // High-precision clock calibration
    await this.calibrateClock();

    // Verify existing admin token if present
    await this.verifyAdmin();

    // Connect to Real-Time SSE Event Bus
    this.initSSE();

    // Fetch initial station state
    await this.fetchStationState();

    // Start background tick and heartbeat loops
    this.startTickLoop();
    this.startHeartbeat();

    this.emit('ready', this.getSyncState());
    return this;
  }

  /**
   * Connect to Server-Sent Events (SSE) for instant cross-machine synchronization
   */
  initSSE() {
    if (typeof window.EventSource === 'undefined') {
      console.warn('[SyncEngine] EventSource not supported by browser. Falling back to HTTP polling.');
      return;
    }

    try {
      this.eventSource = new EventSource('/api/events');

      this.eventSource.onopen = () => {
        console.log('[SyncEngine] Connected to Real-Time SSE Event Bus');
      };

      this.eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);

          if (data.type === 'DJ_STATE_UPDATE') {
            // Authoritative state update broadcasted by Admin DJ
            this.stationState = data.state;
            this.emit('djStateUpdate', this.stationState);
          } else if (data.type === 'PLAYLIST_UPDATED') {
            if (data.playlist && Array.isArray(data.playlist)) {
              this.setPlaylist(data.playlist);
              if (data.version) this.playlistVersion = data.version;
              this.emit('playlistUpdate', this.playlist);
            }
          } else if (data.type === 'INIT') {
            if (data.listeners) {
              this.listenersCount = data.listeners;
              this.emit('listenersChange', this.listenersCount);
            }
            if (data.station) {
              this.stationState = data.station;
              this.emit('djStateUpdate', this.stationState);
            }
          }
        } catch (err) {
          // Ignore keep-alive comments
        }
      };

      this.eventSource.onerror = () => {
        console.warn('[SyncEngine] SSE connection interrupted. Will retry automatically.');
      };
    } catch (e) {
      console.error('[SyncEngine] Could not initialize EventSource:', e);
    }
  }

  async fetchStationState() {
    try {
      const res = await fetch('/api/station', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.station) {
          this.stationState = data.station;
        }
        if (data.listeners) {
          this.listenersCount = data.listeners;
          this.emit('listenersChange', this.listenersCount);
        }
      }
    } catch (e) {
      // offline fallback
    }
  }

  /**
   * Admin Authentication
   */
  async loginAsAdmin(password) {
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Incorrect admin password');
      }

      const data = await res.json();
      this.adminToken = data.token;
      this.isAdmin = true;
      sessionStorage.setItem('yt_radio_admin_token', this.adminToken);
      this.emit('adminStatusChange', true);
      return data;
    } catch (err) {
      console.error('[SyncEngine] Admin login failed:', err);
      throw err;
    }
  }

  logoutAdmin() {
    this.adminToken = null;
    this.isAdmin = false;
    sessionStorage.removeItem('yt_radio_admin_token');
    if (this.adminSyncInterval) clearInterval(this.adminSyncInterval);
    this.emit('adminStatusChange', false);
  }

  async verifyAdmin() {
    if (!this.adminToken) {
      this.isAdmin = false;
      return false;
    }

    try {
      const res = await fetch('/api/admin/verify', {
        headers: { 'X-Admin-Token': this.adminToken },
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        this.isAdmin = !!data.isAdmin;
      } else {
        this.isAdmin = false;
      }
    } catch (e) {
      this.isAdmin = false;
    }

    this.emit('adminStatusChange', this.isAdmin);
    return this.isAdmin;
  }

  /**
   * Start reporting DJ master playback position to the server
   */
  startAdminSyncReporting(player) {
    if (!this.isAdmin) return;
    if (this.adminSyncInterval) clearInterval(this.adminSyncInterval);

    this.adminSyncInterval = setInterval(() => {
      if (!this.isAdmin || !player || !player.isReady) return;
      this.sendAdminSync(player);
    }, 1000);
  }

  async sendAdminSync(player, overrideAction = {}) {
    if (!this.isAdmin || !this.adminToken) return;

    const currentTrack = this.playlist[this.currentTrackIndex] || this.playlist[0];
    const payload = {
      trackIndex: this.currentTrackIndex,
      trackId: currentTrack ? currentTrack.id : null,
      track: currentTrack,
      position: player.getCurrentTime(),
      isPlaying: player.isPlaying,
      ...overrideAction
    };

    try {
      await fetch('/api/admin/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': this.adminToken
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error('[SyncEngine] Failed to send admin master sync:', err);
    }
  }

  /**
   * Compute authoritative live position down to the millisecond
   */
  getLiveDJState() {
    if (!this.stationState) {
      return this.getFallbackSyncState();
    }

    const nowSeconds = this.getNow() / 1000.0;
    const basePos = Number(this.stationState.basePosition || 0.0);
    const baseTime = Number(this.stationState.baseTimestamp || nowSeconds);
    const isPlaying = Boolean(this.stationState.isPlaying);
    const track = this.stationState.track || this.playlist[0];

    let currentPos = basePos;
    if (isPlaying) {
      const elapsed = nowSeconds - baseTime;
      currentPos = basePos + Math.max(0, elapsed);
      const duration = (track && track.duration) || 212;
      if (duration > 0 && currentPos >= duration) {
        currentPos = currentPos % duration;
      }
    }

    const duration = (track && track.duration) || 212;
    const remainingSeconds = Math.max(0, duration - currentPos);

    return {
      trackIndex: this.stationState.trackIndex || 0,
      track: track,
      offsetSeconds: currentPos,
      remainingSeconds: remainingSeconds,
      isPlaying: isPlaying,
      adminOnline: Boolean(this.stationState.adminOnline),
      listenersCount: this.listenersCount,
      isMasterDJ: this.isAdmin
    };
  }

  /**
   * Fallback virtual timeline calculation if DJ is offline
   */
  getFallbackSyncState() {
    if (this.playlist.length === 0 || this.totalDuration === 0) {
      return { trackIndex: 0, track: null, offsetSeconds: 0, remainingSeconds: 0, isPlaying: false };
    }

    const nowMs = this.getNow();
    let elapsedSeconds = (nowMs - this.epoch) / 1000.0;
    if (elapsedSeconds < 0) elapsedSeconds = Math.abs(elapsedSeconds);

    const cyclePosition = elapsedSeconds % this.totalDuration;
    let accumulated = 0;
    let trackIndex = 0;
    let offsetSeconds = 0;

    for (let i = 0; i < this.playlist.length; i++) {
      const track = this.playlist[i];
      if (accumulated + track.duration > cyclePosition) {
        trackIndex = i;
        offsetSeconds = cyclePosition - accumulated;
        break;
      }
      accumulated += track.duration;
    }

    const currentTrack = this.playlist[trackIndex];
    return {
      trackIndex,
      track: currentTrack,
      offsetSeconds,
      remainingSeconds: Math.max(0, currentTrack.duration - offsetSeconds),
      isPlaying: true,
      adminOnline: false,
      listenersCount: this.listenersCount,
      isMasterDJ: this.isAdmin
    };
  }

  getSyncState() {
    if (this.isAdmin) {
      // Admin is the master source of truth
      const track = this.playlist[this.currentTrackIndex] || this.playlist[0];
      return {
        trackIndex: this.currentTrackIndex,
        track: track,
        offsetSeconds: 0, // Admin's player determines position
        remainingSeconds: track ? track.duration : 0,
        isPlaying: false,
        adminOnline: true,
        isMasterDJ: true,
        listenersCount: this.listenersCount
      };
    }

    // Listeners follow the live DJ broadcast
    return this.getLiveDJState();
  }

  async reloadPlaylist() {
    try {
      const res = await fetch('/api/playlist', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        this.setPlaylist(data.playlist || []);
        if (data.version) this.playlistVersion = data.version;
        this.emit('playlistUpdate', this.playlist);
        return;
      }
    } catch (e) {}

    try {
      const res = await fetch('./playlist.json', { cache: 'no-store' });
      if (res.ok) {
        const list = await res.json();
        this.setPlaylist(list);
        this.emit('playlistUpdate', this.playlist);
      } else {
        throw new Error('Could not load playlist.json');
      }
    } catch (err) {
      this.setPlaylist(this.getDefaultPlaylist());
      this.emit('playlistUpdate', this.playlist);
    }
  }

  getDefaultPlaylist() {
    return [
      { id: "8GW6sLrK40k", title: "HOME - Resonance", artist: "Electronic Gems", duration: 212 },
      { id: "MV_3Dpw-BRY", title: "Kavinsky - Nightcall", artist: "Record Makers", duration: 259 },
      { id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley", duration: 213 },
      { id: "kXYiU_JCYtU", title: "Numb (Official HD Video)", artist: "Linkin Park", duration: 187 },
      { id: "eVTXPUF4Oz4", title: "In The End (Official HD Video)", artist: "Linkin Park", duration: 219 }
    ];
  }

  setPlaylist(list) {
    if (!list || list.length === 0) return;
    this.playlist = list.map(item => ({
      ...item,
      duration: Math.max(10, Math.floor(item.duration || 212))
    }));
    this.totalDuration = this.playlist.reduce((acc, t) => acc + t.duration, 0);
  }

  async addTrack(trackData) {
    if (!this.isAdmin || !this.adminToken) {
      throw new Error('Admin authentication required to modify broadcast queue');
    }
    const res = await fetch('/api/playlist/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': this.adminToken
      },
      body: JSON.stringify(trackData)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to add track');
    }
    const data = await res.json();
    this.setPlaylist(data.playlist);
    return data;
  }

  async removeTrack(index) {
    if (!this.isAdmin || !this.adminToken) {
      throw new Error('Admin authentication required to modify broadcast queue');
    }
    const res = await fetch('/api/playlist/remove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': this.adminToken
      },
      body: JSON.stringify({ index })
    });
    if (!res.ok) throw new Error('Failed to remove track');
    const data = await res.json();
    this.setPlaylist(data.playlist);
    return data;
  }

  async importTracks(tracks) {
    if (!this.isAdmin || !this.adminToken) {
      throw new Error('Admin authentication required to import playlist');
    }
    const res = await fetch('/api/playlist/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': this.adminToken
      },
      body: JSON.stringify({ tracks })
    });
    if (!res.ok) throw new Error('Failed to import tracks');
    const data = await res.json();
    this.setPlaylist(data.playlist);
    return data;
  }

  async calibrateClock() {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      try {
        const sendTime = Date.now();
        const res = await fetch('/api/time', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const recvTime = Date.now();
          const rtt = recvTime - sendTime;
          const estimatedServerNow = data.serverTime + Math.round(rtt / 2);
          samples.push({
            offset: estimatedServerNow - recvTime,
            rtt: rtt
          });
        }
      } catch (e) {
        break;
      }
      if (i < 2) await new Promise(r => setTimeout(r, 50));
    }

    if (samples.length > 0) {
      samples.sort((a, b) => a.rtt - b.rtt);
      this.clockOffset = samples[0].offset;
      console.log(`[SyncEngine] High-precision clock calibrated. Offset: ${this.clockOffset}ms (RTT: ${samples[0].rtt}ms)`);
    } else {
      this.clockOffset = 0;
    }
  }

  getNow() {
    return Date.now() + this.clockOffset;
  }

  startTickLoop() {
    if (this.tickInterval) clearInterval(this.tickInterval);

    this.tickInterval = setInterval(() => {
      const state = this.getSyncState();
      if (state.track && state.trackIndex !== this.currentTrackIndex) {
        this.currentTrackIndex = state.trackIndex;
        this.emit('trackChange', state);
      }
      this.emit('tick', state);
    }, 250);
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    const ping = async () => {
      try {
        await this.fetchStationState();
      } catch (e) {}
    };

    ping();
    this.heartbeatInterval = setInterval(ping, 8000);
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(fn => {
        try {
          fn(data);
        } catch (err) {
          console.error(`[SyncEngine] Error in handler for '${event}':`, err);
        }
      });
    }
  }

  destroy() {
    if (this.eventSource) this.eventSource.close();
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.adminSyncInterval) clearInterval(this.adminSyncInterval);
  }
}
