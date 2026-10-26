/**
 * yt_radio - High-Precision Synchronized YouTube Player Wrapper
 * 
 * Supports both Admin DJ (Master Clock Broadcaster) and Listeners (Millisecond Radio Mode)
 */

export class YouTubeRadioPlayer {
  constructor(syncEngine, options = {}) {
    this.syncEngine = syncEngine;
    this.containerId = options.containerId || 'youtube-player-frame';
    this.player = null;
    this.isReady = false;
    this.isPlaying = false;
    this.currentVideoId = null;
    this.volume = 80;
    this.isMuted = false;
    this.driftCheckInterval = null;
    this.driftThreshold = 0.35; // 350ms tight synchronization threshold
    this.lastSeekTime = 0;
    this.callbacks = {
      stateChange: [],
      ready: [],
      error: []
    };
  }

  async init() {
    await this.loadIframeAPI();

    return new Promise((resolve) => {
      this.player = new window.YT.Player(this.containerId, {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (event) => {
            this.isReady = true;
            this.player.setVolume(this.volume);
            this.startDriftCorrection();
            this.emit('ready', event);

            // If we are Admin, start the 1-second master clock reporting loop
            if (this.syncEngine.isAdmin) {
              this.syncEngine.startAdminSyncReporting(this);
            }

            // If we are a Listener, hook to DJ state updates
            this.syncEngine.on('djStateUpdate', (state) => this.handleDJStateUpdate(state));

            resolve(this);
          },
          onStateChange: (event) => {
            this.handleStateChange(event);
          },
          onError: (event) => {
            console.error('[YouTubeRadioPlayer] Error code:', event.data);
            this.emit('error', event.data);
          }
        }
      });
    });
  }

  loadIframeAPI() {
    return new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }

      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prevCallback) prevCallback();
        resolve();
      };

      if (!document.getElementById('yt-iframe-api-script')) {
        const tag = document.createElement('script');
        tag.id = 'yt-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      }
    });
  }

  handleStateChange(event) {
    const state = event.data;
    if (state === window.YT.PlayerState.PLAYING) {
      this.isPlaying = true;

      if (this.syncEngine.isAdmin) {
        // Admin DJ started playing -> report master clock immediately
        this.syncEngine.sendAdminSync(this, { isPlaying: true, position: this.getCurrentTime() });
      } else {
        // Listener started playing -> compensate any buffering lag
        this.compensateBufferingLag();
      }
    } else if (state === window.YT.PlayerState.PAUSED || state === window.YT.PlayerState.ENDED) {
      this.isPlaying = false;
      if (this.syncEngine.isAdmin) {
        this.syncEngine.sendAdminSync(this, { isPlaying: false, position: this.getCurrentTime() });
      }
    }
    this.emit('stateChange', { state, isPlaying: this.isPlaying });
  }

  /**
   * Listener logic: React immediately to DJ updates
   */
  handleDJStateUpdate(djState) {
    if (this.syncEngine.isAdmin || !this.isReady || !this.player) return;

    const track = djState.track;
    if (!track) return;

    const liveDJ = this.syncEngine.getLiveDJState();

    // 1. Track change
    if (this.currentVideoId !== track.id) {
      console.log(`[Radio Listener] DJ changed track to: ${track.title} @ ${liveDJ.offsetSeconds.toFixed(2)}s`);
      this.playTrackAt(track.id, liveDJ.offsetSeconds);
      if (!liveDJ.isPlaying) {
        this.pause();
      }
      return;
    }

    // 2. Play / Pause state
    if (liveDJ.isPlaying && !this.isPlaying) {
      this.playTrackAt(track.id, liveDJ.offsetSeconds);
    } else if (!liveDJ.isPlaying && this.isPlaying) {
      this.pause();
      this.player.seekTo(liveDJ.offsetSeconds, true);
    } else if (liveDJ.isPlaying && this.isPlaying) {
      // Check drift
      const current = this.getCurrentTime();
      const drift = Math.abs(current - liveDJ.offsetSeconds);
      if (drift > this.driftThreshold && (Date.now() - this.lastSeekTime > 1500)) {
        this.player.seekTo(liveDJ.offsetSeconds, true);
        this.lastSeekTime = Date.now();
      }
    }
  }

  compensateBufferingLag() {
    if (!this.isReady || !this.player || this.syncEngine.isAdmin) return;

    const liveDJ = this.syncEngine.getLiveDJState();
    const current = this.getCurrentTime();
    const drift = Math.abs(current - liveDJ.offsetSeconds);

    if (drift > 0.3) {
      console.log(`[Radio Listener] Buffering lag compensated: ${drift.toFixed(2)}s. Snapping to DJ master ${liveDJ.offsetSeconds.toFixed(2)}s`);
      this.player.seekTo(liveDJ.offsetSeconds, true);
      this.lastSeekTime = Date.now();
    }
  }

  playTrackAt(videoId, seconds) {
    if (!this.isReady || !this.player) return;

    const preciseSeconds = Math.max(0, parseFloat(Number(seconds).toFixed(2)));
    if (this.currentVideoId !== videoId) {
      this.currentVideoId = videoId;
      this.player.loadVideoById({
        videoId: videoId,
        startSeconds: preciseSeconds
      });
      this.lastSeekTime = Date.now();
    } else {
      this.player.seekTo(preciseSeconds, true);
      this.player.playVideo();
      this.lastSeekTime = Date.now();
    }
  }

  seekToLive() {
    const liveDJ = this.syncEngine.getLiveDJState();
    if (!liveDJ.track) return;

    const preciseOffset = parseFloat(liveDJ.offsetSeconds.toFixed(2));
    if (this.currentVideoId !== liveDJ.track.id) {
      this.playTrackAt(liveDJ.track.id, preciseOffset);
    } else if (this.isReady && this.player) {
      this.player.seekTo(preciseOffset, true);
      this.lastSeekTime = Date.now();
      if (!this.isPlaying && liveDJ.isPlaying) {
        this.player.playVideo();
      }
    }
  }

  play() {
    if (this.isReady && this.player) {
      if (this.syncEngine.isAdmin) {
        this.player.playVideo();
        this.syncEngine.sendAdminSync(this, { isPlaying: true, position: this.getCurrentTime() });
      } else {
        this.seekToLive();
      }
    }
  }

  pause() {
    if (this.isReady && this.player) {
      this.player.pauseVideo();
      if (this.syncEngine.isAdmin) {
        this.syncEngine.sendAdminSync(this, { isPlaying: false, position: this.getCurrentTime() });
      }
    }
  }

  stop() {
    if (this.isReady && this.player) {
      this.player.stopVideo();
      this.isPlaying = false;
      if (this.syncEngine.isAdmin) {
        this.syncEngine.sendAdminSync(this, { isPlaying: false, position: 0 });
      }
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(100, Math.round(vol)));
    if (this.isReady && this.player) {
      this.player.setVolume(this.volume);
      if (this.volume > 0 && this.isMuted) {
        this.unMute();
      }
    }
  }

  mute() {
    this.isMuted = true;
    if (this.isReady && this.player) this.player.mute();
  }

  unMute() {
    this.isMuted = false;
    if (this.isReady && this.player) {
      this.player.unMute();
      this.player.setVolume(this.volume);
    }
  }

  toggleMute() {
    if (this.isMuted) this.unMute();
    else this.mute();
    return this.isMuted;
  }

  getCurrentTime() {
    if (this.isReady && this.player && typeof this.player.getCurrentTime === 'function') {
      return this.player.getCurrentTime() || 0;
    }
    return 0;
  }

  /**
   * Continuous high-precision drift monitor
   */
  startDriftCorrection() {
    if (this.driftCheckInterval) clearInterval(this.driftCheckInterval);

    this.driftCheckInterval = setInterval(() => {
      if (!this.isPlaying || !this.isReady || !this.player) return;
      if (Date.now() - this.lastSeekTime < 1500) return;

      // Admin controls the clock, so admin never drifts from themselves!
      if (this.syncEngine.isAdmin) {
        return;
      }

      // Listener drift check against live DJ state
      const liveDJ = this.syncEngine.getLiveDJState();
      if (!liveDJ.track || !liveDJ.isPlaying) return;

      // Track transition
      if (this.currentVideoId !== liveDJ.track.id) {
        this.playTrackAt(liveDJ.track.id, liveDJ.offsetSeconds);
        return;
      }

      const current = this.getCurrentTime();
      const expected = liveDJ.offsetSeconds;
      const drift = Math.abs(current - expected);

      if (drift > this.driftThreshold) {
        console.warn(`[Listener Drift Guard] Drift of ${drift.toFixed(2)}s detected. Re-aligning to DJ ${expected.toFixed(2)}s...`);
        this.player.seekTo(expected, true);
        this.lastSeekTime = Date.now();
      }
    }, 1000);
  }

  on(event, callback) {
    if (this.callbacks[event]) this.callbacks[event].push(callback);
  }

  emit(event, data) {
    if (this.callbacks[event]) this.callbacks[event].forEach(fn => fn(data));
  }
}
