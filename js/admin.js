/**
 * yt_radio - Station Admin DJ Studio Controller
 * 
 * Manages DJ authentication, master station playback,
 * millisecond clock broadcasting, and playlist queue operations.
 */

class AdminStudio {
  constructor() {
    this.token = sessionStorage.getItem('yt_radio_admin_token') || null;
    this.player = null;
    this.isPlayerReady = false;
    this.playlist = [];
    this.currentTrackIndex = 0;
    this.syncInterval = null;

    // Elements
    this.loginView = document.getElementById('login-view');
    this.dashboardView = document.getElementById('dashboard-view');
    this.inputPassword = document.getElementById('input-password');
    this.btnLogin = document.getElementById('btn-login');
    this.btnLogout = document.getElementById('btn-logout');
    this.loginError = document.getElementById('login-error');

    this.vfdStatus = document.getElementById('vfd-status');
    this.vfdTitle = document.getElementById('vfd-title');
    this.vfdTime = document.getElementById('vfd-time');
    this.statListeners = document.getElementById('stat-listeners');
    this.statTotalTracks = document.getElementById('stat-total-tracks');

    this.btnMasterPlay = document.getElementById('btn-master-play');
    this.btnMasterPause = document.getElementById('btn-master-pause');
    this.btnMasterStop = document.getElementById('btn-master-stop');
    this.btnMasterSync = document.getElementById('btn-master-sync');

    this.inputYtUrl = document.getElementById('input-yt-url');
    this.inputSongTitle = document.getElementById('input-song-title');
    this.inputSongArtist = document.getElementById('input-song-artist');
    this.inputSongDuration = document.getElementById('input-song-duration');
    this.btnFetchInfo = document.getElementById('btn-fetch-info');
    this.btnAddSong = document.getElementById('btn-add-song');
    this.addFeedback = document.getElementById('add-feedback');

    this.inputBatch = document.getElementById('input-batch');
    this.btnImportBatch = document.getElementById('btn-import-batch');
    this.importFeedback = document.getElementById('import-feedback');
    this.queueList = document.getElementById('admin-queue-list');
  }

  async init() {
    this.bindEvents();
    if (this.token) {
      const valid = await this.verifyToken();
      if (valid) {
        this.showDashboard();
      } else {
        this.showLogin();
      }
    } else {
      this.showLogin();
    }
  }

  bindEvents() {
    // Login
    this.btnLogin.addEventListener('click', () => this.handleLogin());
    this.inputPassword.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleLogin();
    });

    // Logout
    this.btnLogout.addEventListener('click', () => {
      this.token = null;
      sessionStorage.removeItem('yt_radio_admin_token');
      if (this.syncInterval) clearInterval(this.syncInterval);
      this.showLogin();
    });

    // Master Controls
    this.btnMasterPlay.addEventListener('click', () => {
      if (this.player && this.isPlayerReady) {
        this.player.playVideo();
        this.sendSyncState(true);
      }
    });

    this.btnMasterPause.addEventListener('click', () => {
      if (this.player && this.isPlayerReady) {
        this.player.pauseVideo();
        this.sendSyncState(false);
      }
    });

    this.btnMasterStop.addEventListener('click', () => {
      if (this.player && this.isPlayerReady) {
        this.player.stopVideo();
        this.sendSyncState(false, 0);
      }
    });

    this.btnMasterSync.addEventListener('click', () => {
      this.sendSyncState(true);
      this.btnMasterSync.classList.add('active');
      setTimeout(() => this.btnMasterSync.classList.remove('active'), 300);
    });

    // Tabs
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        const pane = document.getElementById(btn.getAttribute('data-tab'));
        if (pane) pane.classList.remove('hidden');
      });
    });

    // Auto-detect YouTube Metadata
    this.btnFetchInfo.addEventListener('click', () => this.fetchYouTubeMeta());
    this.inputYtUrl.addEventListener('change', () => {
      if (!this.inputSongTitle.value) this.fetchYouTubeMeta();
    });

    // Add Song
    this.btnAddSong.addEventListener('click', () => this.handleAddSong());

    // Batch Import
    this.btnImportBatch.addEventListener('click', () => this.handleBatchImport());
  }

  showLogin() {
    this.loginView.classList.remove('hidden');
    this.dashboardView.classList.add('hidden');
    this.btnLogout.classList.add('hidden');
  }

  showDashboard() {
    this.loginView.classList.add('hidden');
    this.dashboardView.classList.remove('hidden');
    this.btnLogout.classList.remove('hidden');

    this.loadPlaylist();
    this.initMasterPlayer();
    this.startMasterSyncLoop();
  }

  async verifyToken() {
    try {
      const res = await fetch('/api/admin/verify', {
        headers: { 'X-Admin-Token': this.token }
      });
      const data = await res.json();
      return !!data.isAdmin;
    } catch (e) {
      return false;
    }
  }

  async handleLogin() {
    const password = this.inputPassword.value.trim();
    if (!password) return;

    this.btnLogin.disabled = true;
    this.loginError.classList.add('hidden');

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
      this.token = data.token;
      sessionStorage.setItem('yt_radio_admin_token', this.token);
      this.showDashboard();
    } catch (err) {
      this.loginError.textContent = err.message;
      this.loginError.classList.remove('hidden');
    } finally {
      this.btnLogin.disabled = false;
    }
  }

  initMasterPlayer() {
    if (this.player) return;

    const checkYT = setInterval(() => {
      if (window.YT && window.YT.Player) {
        clearInterval(checkYT);
        const firstTrack = this.playlist[0] || { id: "8GW6sLrK40k" };
        this.player = new window.YT.Player('admin-player-container', {
          height: '100%',
          width: '100%',
          videoId: firstTrack.id,
          playerVars: {
            autoplay: 0,
            controls: 1,
            enablejsapi: 1,
            origin: window.location.origin
          },
          events: {
            onReady: () => {
              this.isPlayerReady = true;
              console.log('[AdminStudio] Master player ready');
            },
            onStateChange: (event) => {
              if (event.data === window.YT.PlayerState.PLAYING) {
                this.sendSyncState(true);
              } else if (event.data === window.YT.PlayerState.PAUSED) {
                this.sendSyncState(false);
              }
            }
          }
        });
      }
    }, 100);
  }

  startMasterSyncLoop() {
    if (this.syncInterval) clearInterval(this.syncInterval);

    this.syncInterval = setInterval(async () => {
      if (!this.player || !this.isPlayerReady) return;

      const isPlaying = typeof this.player.getPlayerState === 'function' && this.player.getPlayerState() === 1;
      const currentPos = this.player.getCurrentTime() || 0;

      // Update monitor display
      const currentTrack = this.playlist[this.currentTrackIndex] || this.playlist[0];
      if (currentTrack) {
        this.vfdTitle.textContent = currentTrack.title;
        const dur = currentTrack.duration || 212;
        const curMin = String(Math.floor(currentPos / 60)).padStart(2, '0');
        const curSec = String(Math.floor(currentPos % 60)).padStart(2, '0');
        const durMin = String(Math.floor(dur / 60)).padStart(2, '0');
        const durSec = String(Math.floor(dur % 60)).padStart(2, '0');
        this.vfdTime.textContent = `${curMin}:${curSec} / ${durMin}:${durSec}`;
        this.vfdStatus.textContent = isPlaying ? 'STATUS: TRANSMITTING LIVE' : 'STATUS: PAUSED';
      }

      // Send master sync to server
      this.sendSyncState(isPlaying, currentPos);

      // Refresh listeners count
      try {
        const res = await fetch('/api/station', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          this.statListeners.textContent = data.listeners || 1;
        }
      } catch (e) {}
    }, 1000);
  }

  async sendSyncState(isPlaying, overridePos = null) {
    if (!this.token) return;

    const currentTrack = this.playlist[this.currentTrackIndex] || this.playlist[0];
    const pos = overridePos !== null ? overridePos : (this.player ? this.player.getCurrentTime() || 0 : 0);

    const payload = {
      trackIndex: this.currentTrackIndex,
      trackId: currentTrack ? currentTrack.id : null,
      track: currentTrack,
      position: pos,
      isPlaying: isPlaying
    };

    try {
      await fetch('/api/admin/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': this.token
        },
        body: JSON.stringify(payload)
      });
    } catch (e) {}
  }

  async loadPlaylist() {
    try {
      const res = await fetch('/api/playlist', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        this.playlist = data.playlist || [];
        this.statTotalTracks.textContent = this.playlist.length;
        this.renderQueue();
      }
    } catch (e) {}
  }

  renderQueue() {
    this.queueList.innerHTML = '';
    if (this.playlist.length === 0) {
      this.queueList.innerHTML = '<div style="color:#7b8596; font-size:12px; padding:10px; text-align:center;">Queue is empty. Add songs above!</div>';
      return;
    }

    this.playlist.forEach((track, index) => {
      const row = document.createElement('div');
      row.className = 'queue-row';

      const durMin = String(Math.floor((track.duration || 212) / 60)).padStart(2, '0');
      const durSec = String(Math.floor((track.duration || 212) % 60)).padStart(2, '0');

      row.innerHTML = `
        <div class="queue-row-title">#${index + 1}. ${track.title} (${durMin}:${durSec})</div>
        <div class="queue-row-actions">
          <button class="play-now-btn" data-index="${index}">▶ PLAY NOW</button>
          <button class="delete-track-btn" data-index="${index}">&times;</button>
        </div>
      `;

      row.querySelector('.play-now-btn').addEventListener('click', () => {
        this.switchTrack(index);
      });

      row.querySelector('.delete-track-btn').addEventListener('click', async () => {
        if (confirm(`Remove "${track.title}" from broadcast?`)) {
          await this.removeTrack(index);
        }
      });

      this.queueList.appendChild(row);
    });
  }

  switchTrack(index) {
    if (index < 0 || index >= this.playlist.length) return;
    this.currentTrackIndex = index;
    const track = this.playlist[index];
    if (this.player && this.isPlayerReady) {
      this.player.loadVideoById(track.id, 0);
      this.player.playVideo();
      this.sendSyncState(true, 0);
    }
  }

  async removeTrack(index) {
    try {
      const res = await fetch('/api/playlist/remove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': this.token
        },
        body: JSON.stringify({ index })
      });
      if (res.ok) {
        await this.loadPlaylist();
      }
    } catch (e) {}
  }

  async fetchYouTubeMeta() {
    const rawUrl = this.inputYtUrl.value.trim();
    const vid = this.extractId(rawUrl);
    if (!vid) return;

    this.btnFetchInfo.textContent = 'FETCHING...';
    try {
      const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${vid}`);
      if (res.ok) {
        const data = await res.json();
        if (data.title && !this.inputSongTitle.value) this.inputSongTitle.value = data.title;
        if (data.author_name && !this.inputSongArtist.value) this.inputSongArtist.value = data.author_name;
      }
    } catch (e) {} finally {
      this.btnFetchInfo.textContent = 'FETCH INFO';
    }
  }

  async handleAddSong() {
    const vid = this.extractId(this.inputYtUrl.value);
    if (!vid) {
      alert('Please enter a valid YouTube URL or Video ID');
      return;
    }

    const title = this.inputSongTitle.value.trim() || `Track ${vid}`;
    const artist = this.inputSongArtist.value.trim() || 'YT Creator';
    const durStr = this.inputSongDuration.value.trim() || '3:30';

    let duration = 210;
    if (durStr.includes(':')) {
      const p = durStr.split(':');
      duration = parseInt(p[0]) * 60 + parseInt(p[1]);
    } else {
      duration = parseInt(durStr) || 210;
    }

    this.btnAddSong.disabled = true;
    try {
      const res = await fetch('/api/playlist/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': this.token
        },
        body: JSON.stringify({ id: vid, title, artist, duration })
      });
      if (!res.ok) throw new Error('Failed to add track');

      this.addFeedback.textContent = `Added "${title}" to station queue!`;
      this.addFeedback.className = 'feedback-banner success';
      this.inputYtUrl.value = '';
      this.inputSongTitle.value = '';
      this.inputSongArtist.value = '';
      await this.loadPlaylist();
    } catch (e) {
      this.addFeedback.textContent = e.message;
      this.addFeedback.className = 'feedback-banner error-banner';
    } finally {
      this.btnAddSong.disabled = false;
      setTimeout(() => this.addFeedback.className = 'feedback-banner hidden', 4000);
    }
  }

  async handleBatchImport() {
    const text = this.inputBatch.value.trim();
    if (!text) return;

    let tracks = [];
    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        tracks = JSON.parse(text);
      } catch (e) {
        alert('Invalid JSON: ' + e.message);
        return;
      }
    } else {
      const lines = text.split('\n');
      for (const line of lines) {
        const vid = this.extractId(line);
        if (vid) {
          tracks.push({ id: vid, title: `Track ${vid}`, artist: 'YT Broadcast', duration: 212 });
        }
      }
    }

    if (tracks.length === 0) {
      alert('No valid YouTube tracks detected in input.');
      return;
    }

    this.btnImportBatch.disabled = true;
    try {
      const res = await fetch('/api/playlist/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': this.token
        },
        body: JSON.stringify({ tracks })
      });
      if (!res.ok) throw new Error('Import failed');

      this.importFeedback.textContent = `Imported ${tracks.length} tracks!`;
      this.importFeedback.className = 'feedback-banner success';
      this.inputBatch.value = '';
      await this.loadPlaylist();
    } catch (e) {
      this.importFeedback.textContent = e.message;
      this.importFeedback.className = 'feedback-banner error-banner';
    } finally {
      this.btnImportBatch.disabled = false;
      setTimeout(() => this.importFeedback.className = 'feedback-banner hidden', 4000);
    }
  }

  extractId(str) {
    if (!str) return null;
    str = str.trim();
    const match = str.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (match && match[1]) return match[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const admin = new AdminStudio();
  admin.init();
});
