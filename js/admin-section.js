/**
 * yt_radio - Embedded DJ Studio Admin Section Controller
 * 
 * Manages DJ authentication, master station playback,
 * millisecond clock broadcasting, and playlist queue operations
 * directly below the cassette player on the main page.
 */

export class AdminSectionController {
  constructor(syncEngine, player, cassetteUI) {
    this.syncEngine = syncEngine;
    this.player = player;
    this.cassetteUI = cassetteUI;
    this.isOpen = false;
    this.playlist = [];

    // Header & Toggle Elements
    this.section = document.getElementById('admin-station-section');
    this.panelHeader = document.querySelector('.admin-section-header');
    this.panelBody = document.getElementById('admin-panel-body');
    this.btnToggle = document.getElementById('btn-admin-panel-toggle');
    this.btnFooter = document.getElementById('btn-footer-dj');
    this.toggleArrow = document.getElementById('toggle-arrow');
    this.toggleText = document.getElementById('toggle-text');
    this.pillStatus = document.getElementById('admin-pill-status');
    this.badgeFooter = document.getElementById('admin-badge-indicator');

    // Security Clearance Gate
    this.gateCard = document.getElementById('admin-gate-card');
    this.inputPassword = document.getElementById('input-studio-password');
    this.btnUnlock = document.getElementById('btn-studio-unlock');
    this.gateError = document.getElementById('studio-gate-error');

    // Studio Console
    this.consoleCard = document.getElementById('admin-studio-console');
    this.consoleStatusText = document.getElementById('console-status-text');
    this.consolePeerCount = document.getElementById('console-peer-count');
    this.btnForceSync = document.getElementById('btn-console-force-sync');
    this.btnLogout = document.getElementById('btn-console-logout');

    // Master Transport Strip
    this.transportTrackNum = document.getElementById('transport-track-num');
    this.transportTimeCode = document.getElementById('transport-time-code');
    this.transportTrackName = document.getElementById('transport-track-name');
    this.btnTransportPlay = document.getElementById('btn-transport-play');
    this.btnTransportPause = document.getElementById('btn-transport-pause');
    this.btnTransportResync = document.getElementById('btn-transport-resync');

    // Tabs & Forms
    this.tabBtnAdd = document.getElementById('tab-btn-add');
    this.tabBtnBatch = document.getElementById('tab-btn-batch');
    this.paneAdd = document.getElementById('pane-add-song');
    this.paneBatch = document.getElementById('pane-batch-import');

    this.inputAddUrl = document.getElementById('input-add-url');
    this.btnAutoFetch = document.getElementById('btn-auto-fetch');
    this.inputAddTitle = document.getElementById('input-add-title');
    this.inputAddArtist = document.getElementById('input-add-artist');
    this.inputAddDuration = document.getElementById('input-add-duration');
    this.btnAddTrack = document.getElementById('btn-submit-add-track');
    this.addFeedback = document.getElementById('add-track-feedback');

    this.textareaBatch = document.getElementById('textarea-batch-urls');
    this.btnBatchImport = document.getElementById('btn-submit-batch-import');
    this.batchFeedback = document.getElementById('batch-import-feedback');

    // Queue Elements
    this.queueCountBadge = document.getElementById('queue-count-badge');
    this.queueList = document.getElementById('studio-rotation-queue-list');
  }

  async init() {
    this.bindEvents();

    // Check if syncEngine already verified admin from sessionStorage
    if (this.syncEngine.isAdmin) {
      this.unlockConsole();
      this.openPanel();
    } else {
      this.lockConsole();
    }

    // Load initial playlist
    await this.refreshPlaylist();

    // Listen to SyncEngine events
    this.syncEngine.on('adminStatusChange', (isAdmin) => {
      if (isAdmin) {
        this.unlockConsole();
      } else {
        this.lockConsole();
      }
    });

    this.syncEngine.on('playlistUpdate', (list) => {
      this.playlist = list || [];
      this.renderQueue();
    });

    this.syncEngine.on('listenersChange', (count) => {
      if (this.consolePeerCount) {
        this.consolePeerCount.textContent = count;
      }
    });

    this.syncEngine.on('tick', (state) => {
      this.updateTransport(state);
    });
  }

  bindEvents() {
    // Header & Footer Toggles
    if (this.panelHeader) {
      this.panelHeader.addEventListener('click', (e) => {
        // Prevent toggle if clicking a button inside header directly
        if (e.target.closest('#btn-admin-panel-toggle')) return;
        this.togglePanel();
      });
    }

    if (this.btnToggle) {
      this.btnToggle.addEventListener('click', () => this.togglePanel());
    }

    if (this.btnFooter) {
      this.btnFooter.addEventListener('click', () => {
        this.openPanel();
        this.section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (!this.syncEngine.isAdmin && this.inputPassword) {
          setTimeout(() => this.inputPassword.focus(), 350);
        }
      });
    }

    // Security Gate Login
    if (this.btnUnlock) {
      this.btnUnlock.addEventListener('click', () => this.handleLogin());
    }

    if (this.inputPassword) {
      this.inputPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.handleLogin();
      });
    }

    // Logout
    if (this.btnLogout) {
      this.btnLogout.addEventListener('click', () => this.handleLogout());
    }

    // Master Transport Controls
    if (this.btnTransportPlay) {
      this.btnTransportPlay.addEventListener('click', () => {
        this.player.play();
        if (this.syncEngine.isAdmin) {
          this.syncEngine.sendAdminSync(this.player, { isPlaying: true, position: this.player.getCurrentTime() });
        }
      });
    }

    if (this.btnTransportPause) {
      this.btnTransportPause.addEventListener('click', () => {
        this.player.pause();
        if (this.syncEngine.isAdmin) {
          this.syncEngine.sendAdminSync(this.player, { isPlaying: false, position: this.player.getCurrentTime() });
        }
      });
    }

    if (this.btnTransportResync) {
      this.btnTransportResync.addEventListener('click', () => {
        if (this.syncEngine.isAdmin) {
          this.sendForceSync();
        } else {
          this.player.seekToLive();
        }
      });
    }

    if (this.btnForceSync) {
      this.btnForceSync.addEventListener('click', () => this.sendForceSync());
    }

    // Tabs
    if (this.tabBtnAdd) {
      this.tabBtnAdd.addEventListener('click', () => this.selectTab('add'));
    }
    if (this.tabBtnBatch) {
      this.tabBtnBatch.addEventListener('click', () => this.selectTab('batch'));
    }

    // Add Song
    if (this.btnAutoFetch) {
      this.btnAutoFetch.addEventListener('click', () => this.fetchYouTubeMeta());
    }

    if (this.inputAddUrl) {
      this.inputAddUrl.addEventListener('change', () => {
        if (!this.inputAddTitle.value) this.fetchYouTubeMeta();
      });
    }

    if (this.btnAddTrack) {
      this.btnAddTrack.addEventListener('click', () => this.handleAddTrack());
    }

    // Batch Import
    if (this.btnBatchImport) {
      this.btnBatchImport.addEventListener('click', () => this.handleBatchImport());
    }
  }

  togglePanel() {
    if (this.isOpen) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  openPanel() {
    this.isOpen = true;
    this.panelBody.classList.remove('collapsed');
    if (this.toggleArrow) this.toggleArrow.textContent = '▲';
    if (this.toggleText) this.toggleText.textContent = 'CLOSE STUDIO';
  }

  closePanel() {
    this.isOpen = false;
    this.panelBody.classList.add('collapsed');
    if (this.toggleArrow) this.toggleArrow.textContent = '▼';
    if (this.toggleText) this.toggleText.textContent = 'OPEN STUDIO';
  }

  selectTab(tab) {
    if (tab === 'add') {
      this.tabBtnAdd.classList.add('active');
      this.tabBtnBatch.classList.remove('active');
      this.paneAdd.classList.remove('hidden');
      this.paneBatch.classList.add('hidden');
    } else {
      this.tabBtnBatch.classList.add('active');
      this.tabBtnAdd.classList.remove('active');
      this.paneBatch.classList.remove('hidden');
      this.paneAdd.classList.add('hidden');
    }
  }

  async handleLogin() {
    const password = this.inputPassword.value.trim();
    if (!password) return;

    this.gateError.classList.add('hidden');
    this.btnUnlock.disabled = true;
    this.btnUnlock.textContent = 'AUTHENTICATING...';

    try {
      await this.syncEngine.loginAsAdmin(password);
      this.unlockConsole();
      this.openPanel();
      this.inputPassword.value = '';

      // Start master reporting loop
      this.syncEngine.startAdminSyncReporting(this.player);

      // Notify user visually
      if (this.cassetteUI && this.cassetteUI.deckStatusText) {
        this.cassetteUI.deckStatusText.textContent = '★ DJ MASTER BOOTH // MASTER CLOCK ACTIVE';
      }
    } catch (err) {
      this.gateError.textContent = err.message || 'Incorrect admin password';
      this.gateError.classList.remove('hidden');
    } finally {
      this.btnUnlock.disabled = false;
      this.btnUnlock.innerHTML = '<span>🔓</span> UNLOCK DJ BOOTH';
    }
  }

  handleLogout() {
    this.syncEngine.logoutAdmin();
    this.lockConsole();
    if (this.cassetteUI && this.cassetteUI.deckStatusText) {
      this.cassetteUI.deckStatusText.textContent = 'TUNED TO DJ // LIVE RADIO';
    }
  }

  unlockConsole() {
    this.gateCard.classList.add('hidden');
    this.consoleCard.classList.remove('hidden');
    this.pillStatus.textContent = '● ON AIR';
    this.pillStatus.className = 'status-pill on-air';

    if (this.badgeFooter) {
      this.badgeFooter.textContent = 'ACTIVE';
      this.badgeFooter.className = 'admin-mini-badge active';
    }

    this.refreshPlaylist();
  }

  lockConsole() {
    this.consoleCard.classList.add('hidden');
    this.gateCard.classList.remove('hidden');
    this.pillStatus.textContent = 'LOCKED';
    this.pillStatus.className = 'status-pill locked';

    if (this.badgeFooter) {
      this.badgeFooter.textContent = 'LOCKED';
      this.badgeFooter.className = 'admin-mini-badge locked';
    }
  }

  async sendForceSync() {
    if (!this.syncEngine.isAdmin || !this.syncEngine.adminToken) return;

    const currentPos = this.player ? this.player.getCurrentTime() : 0;
    const isPlaying = this.player ? this.player.isPlaying : false;

    this.btnForceSync.classList.add('active');
    setTimeout(() => this.btnForceSync.classList.remove('active'), 400);

    await this.syncEngine.sendAdminSync(this.player, {
      position: currentPos,
      isPlaying: isPlaying
    });

    if (this.consoleStatusText) {
      this.consoleStatusText.textContent = '⚡ FORCE SYNC BROADCASTED!';
      setTimeout(() => {
        this.consoleStatusText.textContent = 'MASTER CLOCK BROADCASTING';
      }, 1500);
    }
  }

  updateTransport(state) {
    if (!state || !state.track) return;

    if (this.transportTrackName) {
      this.transportTrackName.textContent = state.track.title || 'Unknown Title';
    }

    const cur = state.offsetSeconds || 0;
    const dur = state.track.duration || 212;
    const curMin = String(Math.floor(cur / 60)).padStart(2, '0');
    const curSec = String(Math.floor(cur % 60)).padStart(2, '0');
    const durMin = String(Math.floor(dur / 60)).padStart(2, '0');
    const durSec = String(Math.floor(dur % 60)).padStart(2, '0');

    if (this.transportTimeCode) {
      this.transportTimeCode.textContent = `${curMin}:${curSec} / ${durMin}:${durSec}`;
    }

    const total = this.playlist.length || 1;
    const currentIdx = (state.trackIndex !== undefined ? state.trackIndex : 0) + 1;
    if (this.transportTrackNum) {
      this.transportTrackNum.textContent = `TRACK [${currentIdx}/${total}]`;
    }
  }

  async refreshPlaylist() {
    try {
      const res = await fetch('/api/playlist', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        this.playlist = data.playlist || [];
        this.renderQueue();
      }
    } catch (e) {
      console.warn('[AdminSection] Failed to refresh playlist:', e);
    }
  }

  renderQueue() {
    if (!this.queueList) return;

    if (this.queueCountBadge) {
      this.queueCountBadge.textContent = this.playlist.length;
    }

    this.queueList.innerHTML = '';

    if (this.playlist.length === 0) {
      this.queueList.innerHTML = `
        <div style="color: #64748b; font-size: 12px; text-align: center; padding: 20px;">
          Broadcast rotation is empty. Add a song or paste a batch above!
        </div>
      `;
      return;
    }

    const liveState = this.syncEngine.getLiveDJState();
    const currentActiveId = liveState.track ? liveState.track.id : null;

    this.playlist.forEach((track, index) => {
      const card = document.createElement('div');
      const isNowPlaying = (track.id === currentActiveId);
      card.className = `queue-item-card ${isNowPlaying ? 'now-playing' : ''}`;

      const durMin = String(Math.floor((track.duration || 212) / 60)).padStart(2, '0');
      const durSec = String(Math.floor((track.duration || 212) % 60)).padStart(2, '0');

      card.innerHTML = `
        <div class="item-left">
          <span class="item-index ${isNowPlaying ? 'active-icon' : ''}">${isNowPlaying ? '▶' : '#' + (index + 1)}</span>
          <div class="item-meta">
            <span class="item-title" title="${this.escapeHtml(track.title)}">${this.escapeHtml(track.title)}</span>
            <span class="item-sub">${this.escapeHtml(track.artist || 'YT Audio')} • ${durMin}:${durSec}</span>
          </div>
        </div>
        <div class="item-actions">
          <button class="btn-play-track" data-index="${index}" title="Switch broadcast to this track">
            ${isNowPlaying ? 'PLAYING' : '▶ PLAY NOW'}
          </button>
          <button class="btn-delete-track" data-index="${index}" title="Remove track from rotation">
            &times;
          </button>
        </div>
      `;

      card.querySelector('.btn-play-track').addEventListener('click', () => {
        this.switchTrack(index);
      });

      card.querySelector('.btn-delete-track').addEventListener('click', async () => {
        if (confirm(`Remove "${track.title}" from broadcast rotation?`)) {
          await this.removeTrack(index);
        }
      });

      this.queueList.appendChild(card);
    });
  }

  async switchTrack(index) {
    if (index < 0 || index >= this.playlist.length) return;
    const track = this.playlist[index];
    this.syncEngine.currentTrackIndex = index;

    // Load and play on player
    this.player.playTrackAt(track.id, 0);

    // If admin, send master sync immediately
    if (this.syncEngine.isAdmin) {
      await this.syncEngine.sendAdminSync(this.player, {
        trackIndex: index,
        trackId: track.id,
        track: track,
        position: 0,
        isPlaying: true
      });
    }

    this.renderQueue();
  }

  async removeTrack(index) {
    if (!this.syncEngine.adminToken) return;

    try {
      const res = await fetch('/api/playlist/remove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': this.syncEngine.adminToken
        },
        body: JSON.stringify({ index })
      });

      if (res.ok) {
        await this.refreshPlaylist();
      }
    } catch (e) {
      console.error('[AdminSection] Remove failed:', e);
    }
  }

  extractYouTubeId(input) {
    if (!input) return null;
    const s = input.trim();
    const match = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
    return null;
  }

  async fetchYouTubeMeta() {
    const raw = this.inputAddUrl.value.trim();
    const vid = this.extractYouTubeId(raw);
    if (!vid) return;

    this.btnAutoFetch.textContent = 'FETCHING...';
    try {
      const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${vid}`);
      if (res.ok) {
        const data = await res.json();
        if (data.title && !this.inputAddTitle.value) this.inputAddTitle.value = data.title;
        if (data.author_name && !this.inputAddArtist.value) this.inputAddArtist.value = data.author_name;
      }
    } catch (e) {
      console.warn('oEmbed fetch error:', e);
    } finally {
      this.btnAutoFetch.textContent = 'FETCH INFO';
    }
  }

  async handleAddTrack() {
    const vid = this.extractYouTubeId(this.inputAddUrl.value);
    if (!vid) {
      this.showFeedback(this.addFeedback, 'Please enter a valid YouTube URL or 11-char ID', false);
      return;
    }

    const title = this.inputAddTitle.value.trim() || `Track ${vid}`;
    const artist = this.inputAddArtist.value.trim() || 'YouTube Audio';
    const durStr = this.inputAddDuration.value.trim() || '3:30';

    let duration = 210;
    if (durStr.includes(':')) {
      const p = durStr.split(':');
      duration = (parseInt(p[0]) || 0) * 60 + (parseInt(p[1]) || 0);
    } else {
      duration = parseInt(durStr) || 210;
    }

    this.btnAddTrack.disabled = true;
    this.btnAddTrack.textContent = 'ADDING...';

    try {
      const res = await fetch('/api/playlist/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': this.syncEngine.adminToken
        },
        body: JSON.stringify({
          id: vid,
          title,
          artist,
          duration
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add song');

      this.showFeedback(this.addFeedback, `Added "${title}" to rotation!`, true);
      this.inputAddUrl.value = '';
      this.inputAddTitle.value = '';
      this.inputAddArtist.value = '';
      this.inputAddDuration.value = '3:30';
      await this.refreshPlaylist();
    } catch (err) {
      this.showFeedback(this.addFeedback, err.message, false);
    } finally {
      this.btnAddTrack.disabled = false;
      this.btnAddTrack.innerHTML = '<span>+</span> ADD TO BROADCAST ROTATION';
    }
  }

  async handleBatchImport() {
    const raw = this.textareaBatch.value.trim();
    if (!raw) return;

    this.btnBatchImport.disabled = true;
    this.btnBatchImport.textContent = 'IMPORTING...';

    let tracks = [];
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        tracks = JSON.parse(raw);
      } catch (e) {
        this.showFeedback(this.batchFeedback, 'Invalid JSON array syntax', false);
        this.btnBatchImport.disabled = false;
        return;
      }
    } else {
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      lines.forEach((line) => {
        const vid = this.extractYouTubeId(line);
        if (vid) {
          tracks.push({
            id: vid,
            title: `Track ${vid}`,
            artist: 'YouTube Video',
            duration: 210
          });
        }
      });
    }

    if (tracks.length === 0) {
      this.showFeedback(this.batchFeedback, 'No valid YouTube links or track objects found', false);
      this.btnBatchImport.disabled = false;
      return;
    }

    try {
      const res = await fetch('/api/playlist/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': this.syncEngine.adminToken
        },
        body: JSON.stringify({ tracks })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import playlist');

      this.showFeedback(this.batchFeedback, `Imported ${data.count || tracks.length} tracks successfully!`, true);
      this.textareaBatch.value = '';
      await this.refreshPlaylist();
    } catch (err) {
      this.showFeedback(this.batchFeedback, err.message, false);
    } finally {
      this.btnBatchImport.disabled = false;
      this.btnBatchImport.innerHTML = '<span>📥</span> IMPORT PLAYLIST';
    }
  }

  showFeedback(el, msg, isSuccess) {
    if (!el) return;
    el.textContent = msg;
    el.className = `feedback-msg ${isSuccess ? 'success' : 'error'}`;
    el.classList.remove('hidden');
    setTimeout(() => {
      el.classList.add('hidden');
    }, 4000);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

