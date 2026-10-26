/**
 * yt_radio - Streamlined Cassette Player UI Controller (Listener / User Section)
 * 
 * Clean, focused, beautiful retro cassette player interface:
 * - Mechanical button clicks (Web Audio API)
 * - Rotating reels & dynamic tape winding
 * - Dual analog needle VU meters
 * - CRT screen toggle & volume control
 * - Millisecond synchronization to the live DJ broadcast
 */

export class CassetteUI {
  constructor(syncEngine, player) {
    this.syncEngine = syncEngine;
    this.player = player;
    this.audioCtx = null;
    this.vuAnimationId = null;
    this.counterBaseOffset = 0;
    this.isCrtView = false;

    // Deck Elements
    this.playBtn = document.getElementById('btn-play');
    this.playBtnText = document.getElementById('play-btn-text');
    this.syncBtn = document.getElementById('btn-sync');
    this.viewBtn = document.getElementById('btn-view-toggle');
    this.counterResetBtn = document.getElementById('btn-counter-reset');
    this.volumeSlider = document.getElementById('volume-slider');
    this.volumeKnob = document.getElementById('volume-knob');
    this.tapeViewport = document.getElementById('tape-viewport');
    this.crtViewport = document.getElementById('crt-viewport');

    this.spoolLeft = document.getElementById('spool-left');
    this.spoolRight = document.getElementById('spool-right');
    this.tapeLeft = document.getElementById('tape-pack-left');
    this.tapeRight = document.getElementById('tape-pack-right');

    this.needleLeft = document.getElementById('needle-left');
    this.needleRight = document.getElementById('needle-right');
    this.digit1 = document.getElementById('digit-1');
    this.digit2 = document.getElementById('digit-2');
    this.digit3 = document.getElementById('digit-3');

    this.trackTitleEl = document.getElementById('track-title');
    this.trackArtistEl = document.getElementById('track-artist');
    this.trackTimeEl = document.getElementById('track-time');
    this.listenersCountEl = document.getElementById('listeners-count');
    this.statusLed = document.getElementById('status-led');
    this.deckStatusText = document.getElementById('deck-status-text');
    this.ytExternalLink = document.getElementById('yt-external-link');
    this.tuneInBanner = document.getElementById('tune-in-banner');
  }

  init() {
    this.bindEvents();
    this.startVUMeterSimulation();

    // Listen to sync engine events
    this.syncEngine.on('trackChange', (state) => this.updateTrackInfo(state));
    this.syncEngine.on('tick', (state) => this.handleTick(state));
    this.syncEngine.on('listenersChange', (count) => this.updateListeners(count));
    this.syncEngine.on('djStateUpdate', (state) => this.handleDJStateUpdate(state));
    this.syncEngine.on('adminStatusChange', (isAdmin) => {
      if (isAdmin) {
        if (this.deckStatusText) this.deckStatusText.textContent = '★ DJ MASTER BOOTH // ON AIR';
        if (this.playBtnText) this.playBtnText.textContent = 'BROADCAST';
      } else {
        if (this.deckStatusText) this.deckStatusText.textContent = 'TUNED TO DJ // LIVE RADIO';
        if (this.playBtnText) this.playBtnText.textContent = 'TUNE IN / ON AIR';
      }
    });

    // Listen to player state events
    this.player.on('stateChange', ({ state, isPlaying }) => {
      this.setPlayingState(isPlaying);
    });

    // Set initial display
    const initialState = this.syncEngine.getSyncState();
    this.updateTrackInfo(initialState);
  }

  bindEvents() {
    // Tune In / Play button
    this.playBtn.addEventListener('click', () => {
      this.initAudioContext();
      this.playMechanicalSound('heavy-click');

      if (!this.player.isPlaying) {
        this.player.play();
        this.setPlayingState(true);
        if (this.syncEngine.isAdmin) {
          this.deckStatusText.textContent = '★ DJ MASTER BOOTH // ON AIR';
          if (this.playBtnText) this.playBtnText.textContent = 'BROADCASTING';
          this.syncEngine.sendAdminSync(this.player, { isPlaying: true, position: this.player.getCurrentTime() });
        } else {
          this.deckStatusText.textContent = 'TUNED TO DJ // LIVE RADIO';
          if (this.playBtnText) this.playBtnText.textContent = 'TUNED IN';
        }
        if (this.tuneInBanner) this.tuneInBanner.style.display = 'none';
      } else {
        if (this.syncEngine.isAdmin) {
          this.player.pause();
          this.setPlayingState(false);
          this.deckStatusText.textContent = '★ DJ MASTER // BROADCAST PAUSED';
          if (this.playBtnText) this.playBtnText.textContent = 'BROADCAST';
          this.syncEngine.sendAdminSync(this.player, { isPlaying: false, position: this.player.getCurrentTime() });
        } else {
          // Toggle mute or re-sync
          this.player.seekToLive();
          this.deckStatusText.textContent = 'TUNED TO DJ // SYNC: LOCKED';
        }
      }
    });

    // Re-sync to live broadcast
    if (this.syncBtn) {
      this.syncBtn.addEventListener('click', () => {
        this.initAudioContext();
        this.playMechanicalSound('soft-click');
        this.deckStatusText.textContent = 'RE-SYNCING TO DJ BROADCAST...';
        this.player.seekToLive();
        setTimeout(() => {
          this.deckStatusText.textContent = 'TUNED TO DJ // SYNC: LOCKED';
        }, 400);
      });
    }

    // Toggle between Cassette Reels & CRT Video Screen
    this.viewBtn.addEventListener('click', () => {
      this.initAudioContext();
      this.playMechanicalSound('switch');
      this.toggleView();
    });

    // Counter reset button
    this.counterResetBtn.addEventListener('click', () => {
      this.initAudioContext();
      this.playMechanicalSound('soft-click');
      const state = this.syncEngine.getSyncState();
      this.counterBaseOffset = Math.floor(state.offsetSeconds || 0);
      this.updateCounter(0);
    });

    // Volume Slider & Knob
    if (this.volumeSlider) {
      this.volumeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.player.setVolume(val);
        this.updateVolumeKnobRotation(val);
      });
    }

    // Unmute prompt banner
    if (this.tuneInBanner) {
      this.tuneInBanner.addEventListener('click', () => {
        this.playBtn.click();
      });
    }
  }

  handleDJStateUpdate(djState) {
    if (djState.track) {
      this.updateTrackInfo({ track: djState.track });
    }

    if (djState.isPlaying) {
      this.setPlayingState(true);
      this.deckStatusText.textContent = 'TUNED TO DJ // LIVE RADIO';
      if (this.playBtnText) this.playBtnText.textContent = 'TUNED IN';
    } else {
      this.setPlayingState(false);
      this.deckStatusText.textContent = 'DJ PAUSED // BROADCAST ON HOLD';
      if (this.playBtnText) this.playBtnText.textContent = 'BROADCAST PAUSED';
    }
  }

  toggleView() {
    this.isCrtView = !this.isCrtView;
    if (this.isCrtView) {
      this.tapeViewport.classList.add('hidden');
      this.crtViewport.classList.remove('hidden');
      this.viewBtn.textContent = 'TAPE VIEW';
      this.viewBtn.classList.add('active');
    } else {
      this.tapeViewport.classList.remove('hidden');
      this.crtViewport.classList.add('hidden');
      this.viewBtn.textContent = 'CRT SCREEN';
      this.viewBtn.classList.remove('active');
    }
  }

  setPlayingState(isPlaying) {
    if (isPlaying) {
      this.spoolLeft.classList.add('spinning');
      this.spoolRight.classList.add('spinning');
      this.playBtn.classList.add('active');
      this.statusLed.classList.add('active');
      if (this.tuneInBanner) this.tuneInBanner.style.display = 'none';
    } else {
      this.spoolLeft.classList.remove('spinning');
      this.spoolRight.classList.remove('spinning');
      this.playBtn.classList.remove('active');
    }
  }

  updateTrackInfo(state) {
    if (!state || !state.track) return;

    if (this.trackTitleEl) {
      this.trackTitleEl.textContent = state.track.title;
    }
    if (this.trackArtistEl) {
      this.trackArtistEl.textContent = state.track.artist || 'Electronic Gems';
    }
    if (this.ytExternalLink) {
      this.ytExternalLink.href = `https://www.youtube.com/watch?v=${state.track.id}`;
      this.ytExternalLink.title = `Open "${state.track.title}" on YouTube`;
    }

    const stickerTrack = document.getElementById('sticker-track-title');
    if (stickerTrack) {
      stickerTrack.textContent = state.track.title;
    }
  }

  handleTick(state) {
    if (!state || !state.track) return;

    const offset = state.offsetSeconds || 0;
    const duration = state.track.duration || 212;

    const currentMin = Math.floor(offset / 60);
    const currentSec = Math.floor(offset % 60);
    const durMin = Math.floor(duration / 60);
    const durSec = Math.floor(duration % 60);
    const timeStr = `${String(currentMin).padStart(2, '0')}:${String(currentSec).padStart(2, '0')} / ${String(durMin).padStart(2, '0')}:${String(durSec).padStart(2, '0')}`;

    if (this.trackTimeEl) {
      this.trackTimeEl.textContent = timeStr;
    }

    const progress = Math.max(0, Math.min(1, offset / duration));
    const leftScale = 1.0 - (progress * 0.45);
    const rightScale = 0.55 + (progress * 0.45);

    if (this.tapeLeft) {
      this.tapeLeft.style.transform = `scale(${leftScale.toFixed(2)})`;
    }
    if (this.tapeRight) {
      this.tapeRight.style.transform = `scale(${rightScale.toFixed(2)})`;
    }

    const counterVal = Math.max(0, Math.floor(offset) - this.counterBaseOffset);
    this.updateCounter(counterVal);
  }

  updateCounter(val) {
    const formatted = String(val % 1000).padStart(3, '0');
    if (this.digit1) this.digit1.textContent = formatted[0];
    if (this.digit2) this.digit2.textContent = formatted[1];
    if (this.digit3) this.digit3.textContent = formatted[2];
  }

  updateListeners(count) {
    if (this.listenersCountEl) {
      this.listenersCountEl.textContent = count;
    }
  }

  updateVolumeKnobRotation(val) {
    if (this.volumeKnob) {
      const degrees = -135 + (val / 100) * 270;
      this.volumeKnob.style.transform = `rotate(${degrees}deg)`;
    }
  }

  startVUMeterSimulation() {
    let currentL = -20;
    let currentR = -20;
    let targetL = -20;
    let targetR = -20;
    let beatTimer = 0;

    const loop = () => {
      if (this.player && this.player.isPlaying && !this.player.isMuted && this.player.volume > 0) {
        beatTimer += 0.05;
        const volFactor = this.player.volume / 100;

        const baseEnergy = (Math.sin(beatTimer * 5) * 0.3 + Math.cos(beatTimer * 11) * 0.2 + 0.5);
        const randomSpike = Math.random() > 0.85 ? Math.random() * 0.4 : 0;
        const totalEnergy = Math.min(1.0, (baseEnergy + randomSpike) * volFactor);

        targetL = -45 + (totalEnergy * 80) + (Math.random() * 6 - 3);
        targetR = -45 + (totalEnergy * 82) + (Math.random() * 6 - 3);
      } else {
        targetL = -45;
        targetR = -45;
      }

      currentL += (targetL - currentL) * 0.28;
      currentR += (targetR - currentR) * 0.28;

      if (this.needleLeft) {
        this.needleLeft.style.transform = `rotate(${currentL.toFixed(1)}deg)`;
      }
      if (this.needleRight) {
        this.needleRight.style.transform = `rotate(${currentR.toFixed(1)}deg)`;
      }

      this.vuAnimationId = requestAnimationFrame(loop);
    };

    loop();
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playMechanicalSound(type = 'heavy-click') {
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      const filter = this.audioCtx.createBiquadFilter();

      if (type === 'heavy-click') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.08);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);

        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'switch') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.04);

        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1800, now);

        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.05);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.05);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.05);
      }
    } catch (e) {}
  }
}
