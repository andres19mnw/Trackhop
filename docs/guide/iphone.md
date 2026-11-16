---
title: Trackhop on iPhone and iPad
description: There is no Trackhop app for iPhone, but your own Trackhop server (Docker, on a NAS or a home computer) runs your playlist syncs and its page sits on the iPhone's home screen like an app. How to set it up, what works and what doesn't.
---

# Trackhop on iPhone and iPad

There is no Trackhop app in the App Store. What works on an iPhone or an iPad today is your own
**Trackhop server**: it runs your syncs day and night, and its page sits on the home screen and opens
full screen, like an app.

## What you need

- **A Trackhop server**: [Trackhop on Docker](docker), on a NAS, a Raspberry Pi or a computer that
  stays on. The syncs run there, so they keep going with the iPhone off or locked.
  No computer at home? [Trackhop on Azure](docker#on-azure-beta) runs in your own Azure subscription,
  always on, with an `https://` address.
- **The server within reach of the iPhone**: on the same Wi-Fi at home; from outside, through a VPN
  such as Tailscale or a [reverse proxy](docker#behind-a-reverse-proxy) with an `https://` address.
- **A password** on the server (`SONGPORT_PASSWORD`), since other devices can reach it.

[Trackhop Desktop](desktop) is not enough on its own: its page answers only on the computer it runs on.

## On the home screen

1. Open the server's address in **Safari** (for example `http://192.168.1.20:8080`) and sign in.
2. Tap **Share › Add to Home Screen**, then **Add**.
3. Open Trackhop from the home screen. The first time it asks for the password again: it keeps its
   own sign-in, apart from Safari's.

## What you can do from the iPhone

- See every sync, its last run and what changed.
- Run a sync now, turn one on or off, change its schedule.
- Make a new sync, and review the tracks that were not found.
- Everything else the server's page offers: radio syncs, notifications, lyrics, AI playlists, the
  API.

The page shows the server live and keeps nothing on the iPhone. If the server is off or out of reach,
it says so.

## Connect the services from a computer

Connect Spotify, YouTube Music and the other services from a computer's browser, not from the
home-screen app: their sign-in page can leave the app and not come back to it. Some services also
accept a sign-in only on `127.0.0.1` or an `https://` address: the [Docker guide](docker#services)
gives the rule for each one.

## Why no App Store app

An App Store app needs Apple's paid developer membership, and an iPhone app cannot run syncs on its
own schedule in the background the way Android allows: a scheduled sync would run only when iOS
decides. A server you own does that part better, for every device you have.

If an iPhone app would make a difference for you, say so in an
[issue](https://github.com/xlollx/Trackhop/issues/new/choose): requests decide what comes next.

[All guide pages](./)
