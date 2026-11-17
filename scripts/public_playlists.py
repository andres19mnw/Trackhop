#!/usr/bin/env python3
"""Counts the public playlists that carry Trackhop's description ("Synced with Trackhop"), on the
services whose official API can search public playlists: Spotify (client credentials) and YouTube
(an API key). Only counts are written, never a playlist's name, owner or link. A service without its
key, or failing, keeps its last count (read back from the badges branch) instead of dropping to 0.

    python3 scripts/public_playlists.py OUT_DIR
Environment: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, YOUTUBE_API_KEY (each optional).
"""
import base64, json, os, sys, time, urllib.parse, urllib.request

PHRASE = "synced with trackhop"
UA = "Trackhop-stats/1 (+https://trackhop.org)"
PREVIOUS = "https://raw.githubusercontent.com/xlollx/Trackhop/badges/public-playlists.json"


def get(url, headers=None, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def spotify():
    cid, secret = os.environ.get("SPOTIFY_CLIENT_ID"), os.environ.get("SPOTIFY_CLIENT_SECRET")
    if not cid or not secret:
        return None
    auth = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    token = get("https://accounts.spotify.com/api/token", {"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                b"grant_type=client_credentials")["access_token"]
    seen = set()
    offset = 0
    # Spotify's search stops at offset 1000; only playlists whose description really says it count.
    while offset < 1000:
        q = urllib.parse.urlencode({"q": '"Synced with Trackhop"', "type": "playlist", "limit": 50, "offset": offset})
        page = get(f"https://api.spotify.com/v1/search?{q}", {"Authorization": f"Bearer {token}"})["playlists"]
        items = [p for p in page.get("items") or [] if p]
        for p in items:
            if PHRASE in (p.get("description") or "").lower():
                seen.add(p["id"])
        if not page.get("next") or not items:
            break
        offset += 50
        time.sleep(0.3)
    return len(seen)


def youtube():
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        return None
    seen, token = set(), None
    # 100 quota units a page out of 10,000 a day: at most 20 pages.
    for _ in range(20):
        params = {"part": "snippet", "type": "playlist", "q": '"Synced with Trackhop"', "maxResults": 50, "key": key}
        if token:
            params["pageToken"] = token
        page = get("https://www.googleapis.com/youtube/v3/search?" + urllib.parse.urlencode(params))
        for it in page.get("items") or []:
            if PHRASE in ((it.get("snippet") or {}).get("description") or "").lower():
                seen.add((it.get("id") or {}).get("playlistId"))
        token = page.get("nextPageToken")
        if not token:
            break
    seen.discard(None)
    return len(seen)


def main(out):
    try:
        prev = get(PREVIOUS + f"?{int(time.time())}")
    except Exception:
        prev = {}
    counts = {}
    for name, fn in (("spotify", spotify), ("youtube", youtube)):
        try:
            n = fn()
        except Exception as e:  # a service down or a key refused: keep yesterday's count
            print(f"::warning::{name}: {type(e).__name__}: {e}")
            n = None
        counts[name] = n if n is not None else prev.get(name, 0)
        print(f"{name}: {n if n is not None else 'kept ' + str(counts[name])}")
    total = sum(counts.values())
    # Never down by a bad day: a count that falls by more than half is kept as it was and flagged.
    if prev.get("total") and total < prev["total"] / 2:
        print(f"::warning::total fell from {prev['total']} to {total}: kept the previous one")
        counts, total = {k: prev.get(k, 0) for k in counts}, prev["total"]
    os.makedirs(out, exist_ok=True)
    data = {**counts, "total": total, "checked": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime())}
    json.dump(data, open(os.path.join(out, "public-playlists.json"), "w"), indent=1)
    # The README's badge reads this through shields.io's endpoint format.
    json.dump({"schemaVersion": 1, "label": "public playlists synced", "message": f"{total:,}", "color": "7c3aed"},
              open(os.path.join(out, "public-playlists-badge.json"), "w"))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
