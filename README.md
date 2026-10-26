# YT-7000 Vintage Cassette Deck — Authoritative DJ Radio Station

An authentic vintage skeuomorphic cassette player web application powered by YouTube, featuring a **Password-Protected Admin DJ Booth** and a **Millisecond-Synchronized Radio Station**.

The Admin/DJ's player serves as the **Master Clock**. Anyone using the link tunes in as a listener and is locked to the exact millisecond the DJ's track is on in real time.

---

## Architecture & Roles

```
┌────────────────────────────────────────────────────────┐
│               ADMIN / DJ MASTER (Password: admin)       │
│  - Loads Songs & Playlists                             │
│  - Play / Pause / Seek / Track Skip Controls           │
│  - Reports authoritative millisecond position (1Hz)    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ POST /api/admin/sync
┌────────────────────────────────────────────────────────┐
│                    Python Server                       │
│  - Validates Admin Password ("admin")                  │
│  - Authoritative Station State (basePos + Δt)          │
│  - Real-Time Server-Sent Events (SSE) Bus              │
└───────────────────────────┬────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │ Real-time SSE / Millisecond   │
            ▼                               ▼
   [ Listener Client 1 ]           [ Listener Client 2 ]
   - Auto-locked to DJ's track     - Auto-locked to DJ's track
   - Sync drift: ±15ms             - Sync drift: ±15ms
   - Volume & CRT view controls    - Volume & CRT view controls
```

### 1. Admin DJ Booth (Password: `admin`)
- Click **`DJ LOGIN`** at the top right of the deck and enter `admin`.
- Unlocks full master broadcaster rights:
  - Add single songs or import playlists in the **`MIXTAPE / DUB`** studio.
  - Play, Pause, Stop, or Seek anywhere in the track.
  - Skip forward/backward through the playlist.
- The Admin's active YouTube player position is reported to the server and broadcasts the exact live millisecond to every connected listener globally!

### 2. Radio Listeners (The Audience)
- Anyone opening the link without logging in is a **Listener**.
- Locked to whatever track the DJ is playing at the exact same millisecond.
- When the DJ pauses, seeks, or changes tracks, all listeners' decks react instantaneously.
- Listeners have personal control over their output volume and can toggle between the spinning cassette reels and the vintage CRT TV monitor.

---

## Quickstart

### 1. Start the Server

```bash
cd "/Users/johndoe.z/Eden Z/yt_radio"
python3 server.py
```

* Default port: `8000` (customize with `PORT=3000 python3 server.py`)
* Default DJ password: `admin` (customize with `ADMIN_PASSWORD=mysecret python3 server.py`)

### 2. Open the Player & Studio

Visit `http://localhost:8000` (or the public Cloudflare tunnel URL):

- **Cassette Player**: The vintage hi-fi deck is front and center. Click **`TUNE IN / ON AIR`** to listen in lockstep with the station broadcast.
- **Embedded DJ Studio Admin (Below Player)**:
  - Scroll down or click **`🎛️ DJ Studio Admin ↓`** in the deck footer.
  - Enter password **`admin`** to unlock master broadcast controls.
  - Add songs by URL/ID, import playlists in batch, and control playback as the authoritative Master Clock!
- **Standalone Admin Portal**: Also accessible directly at `http://localhost:8000/admin`.

---

## Testing DJ Broadcast & Millisecond Sync

1. Open **[http://localhost:8000/admin](http://localhost:8000/admin)** in **Window 1 (DJ Studio)**:
   - Enter `admin` and click **UNLOCK BROADCAST STUDIO**.
   - Press **`PLAY`** to start the master broadcast.
2. Open **[http://localhost:8000](http://localhost:8000)** in **Window 2 (Listener Deck)**:
   - Click **`TUNE IN / ON AIR`**.
   - Notice Window 2 automatically synchronizes to the exact track and millisecond of the DJ Studio.
3. In **Window 1 (DJ Studio)**:
   - Press **`PAUSE`**, click **`FORCE SYNC ALL`**, or add a new track.
   - Watch **Window 2** immediately react and stay synchronized in real time!

---

## API Endpoints

- `POST /api/admin/login` — Authenticate DJ with password (`{"password": "admin"}`)
- `GET  /api/admin/verify` — Validate active DJ token
- `POST /api/admin/sync` — [DJ Only] Report master playback position and play/pause state
- `GET  /api/station` — Return computed live millisecond station position and listener count
- `GET  /api/events` — Real-time Server-Sent Events (SSE) broadcast stream
- `POST /api/playlist/add` — [DJ Only] Add a track to the broadcast queue
- `POST /api/playlist/remove` — [DJ Only] Remove a track by index or ID
- `POST /api/playlist/import` — [DJ Only] Batch import tracks

---

## License

MIT
