#!/usr/bin/env python3
"""
yt_radio - Lightweight Synchronized Radio & Static Web Server
Admin DJ Master Clock & Real-Time SSE Event Bus Architecture

Endpoints:
  POST /api/admin/login      - Authenticate Admin DJ (Password: "admin")
  GET  /api/admin/verify     - Verify active Admin token
  POST /api/admin/sync       - Admin DJ reports authoritative master playback position
  GET  /api/station          - Station status, authoritative DJ millisecond state & listener count
  GET  /api/time             - Precision server timestamp in ms for NTP sync
  GET  /api/events           - Real-time Server-Sent Events (SSE) broadcast stream
  GET  /api/playlist         - Retrieve full playlist JSON
  POST /api/playlist/add     - [Admin Only] Add a single track
  POST /api/playlist/remove  - [Admin Only] Remove a track by index or ID
  POST /api/playlist/import  - [Admin Only] Import an array of tracks
  GET  /                     - Serves index.html and static web assets
"""

import http.server
import json
import os
import queue
import re
import socketserver
import sys
import threading
import time
import uuid
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("PORT", 8000))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")

# Active Admin Session Tokens
admin_tokens = set()
tokens_lock = threading.Lock()

# Active listener tracker: { client_ip: last_seen_epoch_seconds }
active_listeners = {}
LISTENER_TIMEOUT = 25
playlist_version = int(time.time())

# Real-Time SSE Subscribers
sse_clients = set()
clients_lock = threading.Lock()
server_running = True


def load_playlist():
    playlist_path = os.path.join(DIRECTORY, "playlist.json")
    if os.path.exists(playlist_path):
        try:
            with open(playlist_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error reading playlist: {e}")
    return []


# Authoritative Station Master Clock State
initial_playlist = load_playlist()
initial_track = initial_playlist[0] if initial_playlist else {
    "id": "8GW6sLrK40k",
    "title": "HOME - Resonance",
    "artist": "Electronic Gems",
    "duration": 212
}

station_lock = threading.Lock()
station_state = {
    "trackIndex": 0,
    "track": initial_track,
    "basePosition": 0.0,           # seconds (float)
    "baseTimestamp": time.time(),  # server epoch seconds (float)
    "isPlaying": False,
    "adminOnline": False,
    "adminLastSeen": 0.0
}


def get_live_station_state():
    """
    Computes the authoritative live millisecond playback position
    """
    now = time.time()
    with station_lock:
        state = dict(station_state)
        state["track"] = dict(station_state["track"]) if station_state.get("track") else None

    if state["isPlaying"]:
        elapsed = now - state["baseTimestamp"]
        duration = float(state["track"].get("duration", 212) if state["track"] else 212)
        current_pos = state["basePosition"] + elapsed

        # Automatic wrap-around if track finished and admin hasn't intervened
        if duration > 0 and current_pos >= duration:
            current_pos = current_pos % duration

        state["currentPosition"] = round(current_pos, 3)
    else:
        state["currentPosition"] = round(state["basePosition"], 3)

    state["serverTime"] = int(now * 1000)
    state["adminOnline"] = (now - state["adminLastSeen"]) < 10.0
    return state


def clean_listeners():
    now = time.time()
    stale = [ip for ip, ts in active_listeners.items() if now - ts > LISTENER_TIMEOUT]
    for ip in stale:
        del active_listeners[ip]
    return len(active_listeners)


def broadcast_sse(event_data):
    with clients_lock:
        stale_queues = []
        for q in sse_clients:
            try:
                q.put_nowait(event_data)
            except queue.Full:
                stale_queues.append(q)
        for q in stale_queues:
            sse_clients.discard(q)


def save_playlist(playlist):
    global playlist_version
    playlist_path = os.path.join(DIRECTORY, "playlist.json")
    try:
        with open(playlist_path, "w", encoding="utf-8") as f:
            json.dump(playlist, f, indent=2)
        playlist_version = int(time.time() * 1000)
        return True
    except Exception as e:
        print(f"Error saving playlist: {e}")
        return False


def extract_youtube_id(input_str):
    input_str = input_str.strip()
    match = re.search(r'(?:v=|youtu\.be/|embed/|shorts/)([a-zA-Z0-9_-]{11})', input_str)
    if match:
        return match.group(1)
    if re.match(r'^[a-zA-Z0-9_-]{11}$', input_str):
        return input_str
    return None


class RadioHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token, X-Client-ID")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def is_admin(self):
        token = self.headers.get("X-Admin-Token")
        if not token:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            token = query.get("token", [None])[0]
        with tokens_lock:
            return token in admin_tokens if token else False

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path in ["/admin", "/admin/"]:
            self.path = "/admin.html"
        return super().do_HEAD()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path in ["/admin", "/admin/"]:
            self.path = "/admin.html"
            return super().do_GET()

        if parsed.path == "/api/time":
            server_time_ms = int(time.time() * 1000)
            self.send_json_response({"serverTime": server_time_ms})
            return

        if parsed.path == "/api/admin/verify":
            valid = self.is_admin()
            self.send_json_response({"isAdmin": valid})
            return

        if parsed.path == "/api/station" or parsed.path == "/api/heartbeat":
            client_ip = self.client_address[0]
            active_listeners[client_ip] = time.time()
            count = clean_listeners()

            playlist = load_playlist()
            with clients_lock:
                sse_count = len(sse_clients)
            total_listeners = max(1, max(count, sse_count))

            station_info = get_live_station_state()
            data = {
                "serverTime": station_info["serverTime"],
                "listeners": total_listeners,
                "totalTracks": len(playlist),
                "playlistVersion": playlist_version,
                "station": station_info,
                "status": "LIVE"
            }
            self.send_json_response(data)
            return

        if parsed.path == "/api/events":
            # Server-Sent Events (SSE) Stream
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            client_queue = queue.Queue(maxsize=100)
            with clients_lock:
                sse_clients.add(client_queue)

            client_ip = self.client_address[0]
            active_listeners[client_ip] = time.time()

            try:
                # Welcome event with immediate station state
                initial_event = {
                    "type": "INIT",
                    "serverTime": int(time.time() * 1000),
                    "playlistVersion": playlist_version,
                    "listeners": len(sse_clients),
                    "station": get_live_station_state()
                }
                self.wfile.write(f"data: {json.dumps(initial_event)}\n\n".encode("utf-8"))
                self.wfile.flush()

                while server_running:
                    try:
                        event = client_queue.get(timeout=10.0)
                        self.wfile.write(f"data: {json.dumps(event)}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, socketserver.socket.error):
                pass
            finally:
                with clients_lock:
                    sse_clients.discard(client_queue)
            return

        if parsed.path == "/api/playlist":
            playlist = load_playlist()
            self.send_json_response({
                "playlist": playlist,
                "version": playlist_version,
                "totalDuration": sum(t.get("duration", 212) for t in playlist)
            })
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            self.send_json_response({"error": "Invalid JSON"}, status=400)
            return

        # 1. Admin Authentication
        if parsed.path == "/api/admin/login":
            password = payload.get("password", "")
            if password == ADMIN_PASSWORD:
                token = f"admin_token_{uuid.uuid4().hex}"
                with tokens_lock:
                    admin_tokens.add(token)
                print(f"[Admin Auth] DJ logged in successfully. Token generated.")
                self.send_json_response({
                    "success": True,
                    "token": token,
                    "message": "Welcome to the DJ Booth!"
                })
            else:
                print(f"[Admin Auth] Incorrect password attempt.")
                self.send_json_response({"error": "Incorrect admin password"}, status=401)
            return

        # 2. Admin DJ Master Clock Sync (Only authenticated Admin can report live clock)
        if parsed.path == "/api/admin/sync":
            if not self.is_admin():
                self.send_json_response({"error": "Admin authorization required"}, status=403)
                return

            now = time.time()
            track_index = int(payload.get("trackIndex", 0))
            track_id = payload.get("trackId")
            position = float(payload.get("position", 0.0))
            is_playing = bool(payload.get("isPlaying", False))
            track_obj = payload.get("track")

            with station_lock:
                station_state["trackIndex"] = track_index
                if track_obj:
                    station_state["track"] = track_obj
                elif track_id:
                    station_state["track"] = {
                        "id": track_id,
                        "title": payload.get("title", station_state["track"].get("title", "")),
                        "artist": payload.get("artist", station_state["track"].get("artist", "")),
                        "duration": float(payload.get("duration", 212))
                    }
                station_state["basePosition"] = position
                station_state["baseTimestamp"] = now
                station_state["isPlaying"] = is_playing
                station_state["adminOnline"] = True
                station_state["adminLastSeen"] = now

            live_state = get_live_station_state()

            # Push authoritative state update to all listeners over SSE
            broadcast_sse({
                "type": "DJ_STATE_UPDATE",
                "state": live_state
            })

            self.send_json_response({"success": True, "station": live_state})
            return

        # 3. Protected Playlist Management (Admin Only)
        if parsed.path in ["/api/playlist/add", "/api/playlist/remove", "/api/playlist/import"]:
            if not self.is_admin():
                self.send_json_response({"error": "Admin access required to modify broadcast playlist"}, status=403)
                return

            if parsed.path == "/api/playlist/add":
                raw_id = payload.get("id") or payload.get("url") or ""
                video_id = extract_youtube_id(raw_id)
                if not video_id:
                    self.send_json_response({"error": "Invalid YouTube URL or Video ID"}, status=400)
                    return

                title = payload.get("title", "").strip() or f"Track {video_id}"
                artist = payload.get("artist", "").strip() or "YT Broadcast"
                raw_duration = payload.get("duration", 212)
                duration = 212
                if isinstance(raw_duration, str) and ":" in raw_duration:
                    parts = raw_duration.split(":")
                    try:
                        duration = int(parts[0]) * 60 + int(parts[1])
                    except Exception:
                        duration = 212
                else:
                    try:
                        duration = int(raw_duration)
                    except Exception:
                        duration = 212

                playlist = load_playlist()
                new_track = {
                    "id": video_id,
                    "title": title,
                    "artist": artist,
                    "duration": max(10, duration)
                }
                playlist.append(new_track)
                save_playlist(playlist)

                print(f"[Radio DJ] Added track: {title} ({video_id}) [{duration}s]")
                broadcast_sse({
                    "type": "PLAYLIST_UPDATED",
                    "version": playlist_version,
                    "playlist": playlist
                })
                self.send_json_response({
                    "success": True,
                    "track": new_track,
                    "playlist": playlist,
                    "version": playlist_version
                })
                return

            if parsed.path == "/api/playlist/remove":
                track_index = payload.get("index")
                track_id = payload.get("id")

                playlist = load_playlist()
                if track_index is not None and 0 <= track_index < len(playlist):
                    removed = playlist.pop(track_index)
                elif track_id:
                    playlist = [t for t in playlist if t.get("id") != track_id]
                    removed = track_id
                else:
                    self.send_json_response({"error": "Track not found"}, status=404)
                    return

                save_playlist(playlist)
                print(f"[Radio DJ] Removed track: {removed}")
                broadcast_sse({
                    "type": "PLAYLIST_UPDATED",
                    "version": playlist_version,
                    "playlist": playlist
                })
                self.send_json_response({
                    "success": True,
                    "playlist": playlist,
                    "version": playlist_version
                })
                return

            if parsed.path == "/api/playlist/import":
                tracks = payload.get("tracks", [])
                if not isinstance(tracks, list) or len(tracks) == 0:
                    self.send_json_response({"error": "Empty or invalid tracks list"}, status=400)
                    return

                playlist = load_playlist()
                added_count = 0
                for item in tracks:
                    vid = extract_youtube_id(item.get("id") or item.get("url") or "")
                    if vid:
                        playlist.append({
                            "id": vid,
                            "title": item.get("title", f"Track {vid}"),
                            "artist": item.get("artist", "YT Broadcast"),
                            "duration": max(10, int(item.get("duration", 212)))
                        })
                        added_count += 1

                save_playlist(playlist)
                print(f"[Radio DJ] Imported {added_count} tracks")
                broadcast_sse({
                    "type": "PLAYLIST_UPDATED",
                    "version": playlist_version,
                    "playlist": playlist
                })
                self.send_json_response({
                    "success": True,
                    "added": added_count,
                    "playlist": playlist,
                    "version": playlist_version
                })
                return

        self.send_json_response({"error": "Endpoint not found"}, status=404)

    def send_json_response(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        if "/api/time" in args[0] or "/api/station" in args[0] or "/api/events" in args[0] or "/api/admin/sync" in args[0]:
            return
        super().log_message(format, *args)


def run():
    global server_running
    server_address = ("", PORT)
    httpd = http.server.ThreadingHTTPServer(server_address, RadioHTTPRequestHandler)
    print("=" * 60)
    print(f"  YT-7000 Vintage Cassette Deck - DJ Radio Station Server")
    print(f"  Admin DJ Booth Password: '{ADMIN_PASSWORD}'")
    print(f"  Local URL: http://localhost:{PORT}")
    print(f"  Serving directory: {DIRECTORY}")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server_running = False
        httpd.server_close()


if __name__ == "__main__":
    run()
