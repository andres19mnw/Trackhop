# AGENTS.md — Trackhop

Permanent context for AI agents working in this repository.

> **Language:** code, product names and user documentation are in English; some legacy comments are in Italian. Write new comments, strings and docs in English unless the file you touch is consistently Italian.
>
> **Source of truth:** the code and the Gradle files. `README.md` and some guides are stale in places (see §11). When they disagree, the code wins.
>
> **Working tree state:** a Git merge may be in progress with unresolved index entries. Before touching anything run `git status --short` and read §11.

---

## 1. Project description

**Trackhop** (formerly *Songport*; Android package `com.xlollx.songport`, `rootProject.name = "Songport"`) keeps playlists identical across music services: Spotify, Apple Music, YouTube Music, Amazon Music, TIDAL, Deezer, SoundCloud, LiveOne, personal servers (Navidrome/Subsonic, Jellyfin, Emby, Plex, Lyrion, Mopidy) and read-only sources (Last.fm, ListenBrainz, public NetEase, QQ Music, JioSaavn, Anghami, Qobuz and SoundCloud links, TikTok, radio). It also imports and exports CSV, TSV, M3U, PLS, XSPF, JSPF, iTunes XML, JSON, OPML and text files.

**This fork builds the Android app only.** The two products of the original project are:

1. **Android app** (`android/`): syncs run on the device, scheduled with WorkManager, tokens encrypted on the phone. There is no Trackhop account and no central server for the app.
2. **Trackhop Desktop / Server** (`server/`): the same engine on the JVM, with a web page, its own scheduler, the `trackhop` CLI, a JSON API at `/api/v1`, MCP, and a Docker image. It is optional and in **beta**.

**In this fork the server, Desktop, Docker, website and packaging are kept in Git exactly as upstream ships them but are never built, edited or released.** Do not add instructions that require server parity, CLI/MCP updates, `docs/assets/tools/*.js` ports, or changes to `server/`, `docs/`, `packaging/`, `community/`, `social/`, `fastlane/`, `play/` or `fdroid/`.

The app does not play music: it reads and writes playlists, matches tracks, reports unmatched tracks and reviews, and offers tools (duplicates, unplayable tracks, stats, backup, Discover, Wrapped, poster, lyrics, etc.).

License: **AGPL-3.0-only** with additional terms in `NOTICE`.

---

## 2. Technologies

| Area | Technology | Notes |
|---|---|---|
| Language | Kotlin **2.1.21** | All production code and tests. |
| JVM | **17** | `sourceCompatibility`/`targetCompatibility` and `jvmTarget` in every module. |
| Build | Gradle **8.14.3** | Wrapper only in `android/gradle/wrapper`. `server/` uses the system Gradle. |
| Android | AGP **8.11.1**, `compileSdk`/`targetSdk` **36**, `minSdk` **26** | `versionCode 171`, `versionName 2.0.0` at the time of writing. |
| Android UI | Jetpack Compose, BOM **2025.06.00**, Material 3 | No `navigation-compose`: navigation is state in `MainActivity`. |
| Android extras | Activity Compose, lifecycle-runtime-compose, WorkManager 2.10.2, Glance 1.1.1, Haze 1.6.10, reorderable 3.0.0, Biometric, Browser, WebKit, security-crypto, Play App Update | Versions pinned in `android/app/build.gradle`. |
| Network/JSON | OkHttp **4.12.0**, kotlinx-serialization-json **1.8.1**, coroutines **1.10.2** | `Http` centralizes 429/5xx retries. |
| AI | ML Kit GenAI Prompt (Gemini Nano) | Only `full` and `play` flavors; `fdroid`/`appgallery` use an empty stub. |
| Server | JDK `com.sun.net.httpserver.HttpServer`, Java AWT/ImageIO, SWT 3.135.0 (Desktop), jaudiotagger 3.0.1, JLayer 1.0.1 | No web framework (Spring, Ktor, etc.). |
| Tests | JUnit 4, MockWebServer, Robolectric (`:bridge` tests), Compose UI Test + Espresso Intents (instrumented) | No TestNG or JUnit 5. |
| Site/web tools | Jekyll (GitHub Pages) + dependency-free ESM JavaScript | Public tools in `docs/assets/tools/`, tests with `node:test`. |
| Scripts | Python 3 and Bash | `scripts/`, `server/desktop/package.sh`, `server/e2e/run.sh`. |

**Not present** (verified in the builds): Room/SQLite, a relational database, Hilt/Koin or any DI container, Retrofit, Navigation Compose, ktlint, detekt, Spotless, a version catalog (`libs.versions.toml`) or npm dependencies.

---

## 3. Architecture

### 3.1 Modules

| Module | Type | Responsibility |
|---|---|---|
| `android/core` (`:core`) | Pure Kotlin/JVM | Engine: models, `FileStore`, matching, connectors, `SyncEngine`, playlist formats, shared groups, AI, notifications. **Must not import `android.*` or `androidx.*`.** |
| `android/ytm` (`:ytm`) | Pure Kotlin/JVM | YouTube Music client (`youtubei/v1/...` endpoints) and shared JSON helpers. Also free of Android. |
| `android/bridge` (`:bridge`) | Android library | WebView-based connectors and sessions (Spotify web, Apple, Amazon, Deezer web, LiveOne, Anghami, Qobuz, SoundCloud, YouTube Music) and the protocol with the external Trackhop Bridge app. Depends on `:ytm`. |
| `android/app` (`:app`) | Android app | Compose UI, `AndroidEnv`, authentication, WorkManager, widgets, notifications, tools. Depends on `:core`; `full`/`fdroid` also on `:bridge`. |
| `server` | Standalone Gradle build | Includes `../android/core` as `:core`, `../android/ytm` as `:ytm`, and an explicit list of files from `android/bridge/src/main/java` that do not use Android. Adds web, API, CLI, MCP, Desktop and Docker. |

The server build does not know about the Android build: `server/settings.gradle` points at the directories under `android/`, and `server/build.gradle` copies the app's `strings.xml` files and version so texts are not duplicated.

### 3.2 Engine layers

```
Android UI (Compose)                Web page / CLI / API / MCP
        │                                     │
        └──────────────┬──────────────────────┘
                       ▼
              SyncEngine (core/sync)
        plan()  ── reads and decides, writes nothing
        apply() ── writes, caches, produces the report
                       │
        ┌──────────────┼───────────────┐
        ▼              ▼               ▼
   Matcher        MusicProvider     FileStore
 (title/ISRC)    (connectors)      (store.json)
                       │
                 Http / OkHttp
                       │
              Official APIs or web services
```

1. **Platform (`platform.Env`).** The only platform dependency the engine receives: `dataDir`, `store`, `tokens`, `redirectUri`, `text(name, args)`, `log`, `startAuth`, `keyValues`, `squareJpeg`, `targetCoordinator` and `onServer`. Implementations: `AndroidEnv` (Context, `Diagnostics`, `TokenStore`) and `ServerEnv` (data folder, `JsonTokenVault`, `Log`).
2. **Persistence (`data.FileStore`).** A single `store.json` holding `StoreData` (jobs, reports, match cache, ignored tracks, settings, pair states, groups…). It exposes `StateFlow<StoreData>` and helpers (`upsertJob`, `putMatch`, `putMisses`, `putIgnored`, `addReport`, `confirmRemovals`…). Writes are coalesced for 500 ms and done via temp file + rename; `flush()` forces a write.
3. **Connectors (`providers`).** The `MusicProvider` interface (list playlists, read tracks, search, create, add, remove, versions, covers, ordering, lyrics…). `Providers` holds the factories and singletons; `Connectors.kt` registers the app's connectors and `server/Main.kt` the server's. `OAuthProvider` implements PKCE and refresh; `CredentialsProvider` covers personal servers and Last.fm/ListenBrainz usernames.
4. **Sync engine (`sync.SyncEngine`).** `run()` checks versions and locks, then executes `plan()` + `apply()`. `plan()` reads source and target, reuses the cache, searches for missing tracks and builds a `SyncPlan`; `apply()` adds in batches, removes, reorders, saves the cache and produces a `SyncReport`. `Matcher` scores ISRC, normalized title, artists, duration and version markers (live/remix/acoustic…).
5. **Android UI.** Composables in `ui/`; `MainActivity` holds tab and screen state; `ToolsScreen` enumerates the tools; `Store.state` is observed with `collectAsState()`.
6. **Server.** `Web` is a single `HttpHandler` routing to feature modules (`SyncsWeb`, `PlaylistsWeb`, `SettingsWeb`, `ToolsWeb`, `AccountsWeb`…), to `/api/v1` (`Api*.kt`), to `/mcp`, and to static/PWA files. `Runner` replaces WorkManager with a loop that wakes every minute.
7. **Website and tools.** `docs/` is a Jekyll site. `docs/assets/tools/*.js` are browser playlist converters; they are **ports** of the Kotlin logic (`CsvCodec`, `PlaylistFiles`, link parsing) and have their own Node tests.

### 3.3 Service identity and cache keys

- A connector has a `serviceId` and, with multiple accounts, a `slot` (`"2"`, `"3"`…): `id = "spotify@2"`.
- The cache normalizes to a service **family** via `FileStore.family()`: `spotify_bridge` → `spotify`, `apple_bridge` → `apple`, `deezer_bridge` → `deezer`, `ytm` → `youtube`. A match found through one route serves every route of that service.
- Match keys are `sourceFamily:trackId>targetFamily`; library keys append `#album`, `#artist` or `#podcast`. **Do not change this format without migrating data and tests**: Track Sync, the review screens and the server all read it.
- The special library ids are `__liked__`, `__albums__`, `__artists__`, `__podcasts__`, `__recent__` (`MusicProvider`).

### 3.4 Persistent data

| Data | Android app | Server / Desktop |
|---|---|---|
| State | `filesDir/store.json` | `/data/store.json` (or `SONGPORT_DATA`) |
| Tokens | `EncryptedSharedPreferences` (`TokenStore`), falling back to plain preferences | `tokens.json` with owner-only permissions |
| Log | `Diagnostics` / `songport.log` | `songport.log` + stdout |
| Playlist files | app folder / SAF | `/data/csv/` |
| Backups | `.trackhop` configuration; optional encrypted full backup | same, via web/CLI |

Actual store limits: `MAX_REPORTS = 200`, `MAX_CACHE = 20_000`, misses remembered for 7 days, present/unremoved memory for 30 days. Reports are immutable apart from the review flow (`updateReport`).

---

## 4. Directory structure

```
Trackhop/
├── AGENTS.md                      # this document
├── README.md, CONTRIBUTING.md, SECURITY.md, NOTICE, LICENSE
├── TRACK_SYNC.md                  # functional spec for Track Sync (not code)
├── android/
│   ├── gradlew, gradlew.bat, build.gradle, settings.gradle, gradle.properties
│   ├── core/src/main/kotlin/com/xlollx/songport/
│   │   ├── Features.kt            # 2.0 feature switch
│   │   ├── model/                 # Track, Playlist, SyncJob, SyncReport, SyncPlan, MatchPolicy…
│   │   ├── data/                  # FileStore, Settings, Tokens, backups, Redact
│   │   ├── net/                   # Http, Json, NetError, Pacer, Relay
│   │   ├── platform/              # Env, AuthMode, BuildDefaults, KeyValues
│   │   ├── providers/             # MusicProvider, OAuthProvider, official connectors
│   │   ├── sync/                  # SyncEngine, Matcher, tool logic and sync rules
│   │   ├── shared/                # shared playlists and transports
│   │   ├── ai/                    # AI client and mixes
│   │   └── notify/                # notification channels
│   ├── ytm/src/main/kotlin/com/xlollx/songport/ytmbridge/
│   ├── bridge/src/main/java/com/xlollx/songport/ytmbridge/
│   ├── app/src/main/java/com/xlollx/songport/
│   │   ├── MainActivity.kt, SongportApp.kt, Notifications.kt
│   │   ├── auth/                  # PKCE, callback, loopback, MusicKit, app lock
│   │   ├── data/                  # Store, TokenStore, Diagnostics, CrashLog
│   │   ├── net/                   # Connectivity, HostLog
│   │   ├── platform/              # AndroidEnv, Res
│   │   ├── providers/             # web/plugin connectors and app registry
│   │   ├── sync/                  # SyncWorker, Scheduler, backups, tools
│   │   ├── ui/                    # Compose screens and components
│   │   ├── widget/                # Glance widgets and tile
│   │   ├── automation/, ai/, update/
│   │   └── ...
│   ├── app/src/full|fdroid|play|appgallery/   # per-distribution code and texts
│   ├── app/src/storeCommon/       # shared by play and appgallery
│   ├── app/src/mlkit|nomlkit/     # real Gemini Nano or stub
│   └── app/src/test|androidTest/  # JVM tests and instrumented flows
├── server/
│   ├── settings.gradle, build.gradle, VERSION, CHANGELOG.md, Dockerfile
│   ├── src/main/kotlin/com/xlollx/songport/server/
│   │   ├── Main.kt, Web.kt, Runner.kt, ServerEnv.kt, Storage.kt
│   │   ├── Api*.kt, ApiDocs.kt    # /api/v1 and OpenAPI
│   │   ├── Cli*.kt, Mcp*.kt       # CLI and MCP
│   │   ├── *Web.kt                # pages and endpoints by feature
│   │   └── Desktop.kt, DesktopWindow.kt
│   ├── src/test/kotlin/...        # server tests
│   ├── desktop/package.sh         # Desktop packaging
│   └── e2e/                       # Playwright + Docker (not in CI)
├── docs/                          # Jekyll site: guide, privacy, assets, JS tools
├── packaging/                     # winget, Chocolatey, Scoop, MSIX, Flathub, Docker Hub
├── fastlane/, play/, fdroid/      # store metadata and recipes
├── community/                     # Supabase schema for community matches (planned)
├── scripts/                       # Python/Bash maintenance utilities
└── social/                        # social media images
```

The README's "Project layout" section places `model/`, `providers/` and `sync/` under `app/`. In the real code they live in `core/` (the README is stale).

---

## 5. How it works

### 5.1 App startup

1. `SongportApp.onCreate()`:
   - installs `CrashLog`;
   - sets `Features.build = BuildConfig.V2`;
   - loads `BuildDefaults` from `BuildConfig` (`AndroidEnv.buildDefaults()`), initializes `Res`;
   - registers connectors with `installConnectors()`;
   - installs `SafFolder`, `Notify.secretsInVault`, Gemini Nano, `HostLog`, `Connectivity`, `OfflineQueue`, `BuiltIn`, concerts/merch readers;
   - creates the notification channel and calls `Scheduler.applyAll(this)`.
2. `MainActivity` installs the splash, enables edge-to-edge, handles intents (share, links, widgets, notifications), applies the optional biometric lock and draws `MainScreen`.
3. `MainScreen` obtains the `Store.get(ctx)` singleton, observes `store.state`, and keeps the current tab, open editor, filters and sub-screens in `rememberSaveable`. Tabs are `TAB_SYNCS`, `TAB_ACCOUNTS`, `TAB_DISCOVER`, `TAB_TOOLS`, `TAB_SETTINGS` and `TAB_LOG` (not a tab: a notification opens it).

### 5.2 Synchronization

1. The user taps "Run now"/"Sync all", or WorkManager wakes `SyncWorker` on schedule.
2. `Scheduler`/`SyncWorker` check connectivity, syncs handed over to the server, timing (`Timing`) and run state; `SyncEngine` also checks the playlists' versions.
3. `SyncEngine.run(job)`:
   - checks source/target versions (an unattended run is skipped when neither changed);
   - takes target locks (`TargetLocks`, `ServerLocks`) so two syncs never write the same playlist;
   - `plan()`: reads source and target, reuses `matchCache`, searches missing tracks (`search`/`searchWide`), scores with `Matcher`, applies `MatchPolicy`, and computes additions, removals, unmatched tracks and reviews;
   - `apply()`: creates the target playlist if needed, adds in batches, removes when `mirrorRemovals`, reorders when `keepOrder`, copies the cover when applicable, stores matches/misses and writes the `SyncReport`.
4. The `SyncReport` is saved in the store (partial during the run, final when it ends). The sync card, review screens, notifications, notification channels (`notify`), the server webhook and the "Missing on my server" list (`Wanted`) all read from it.
5. A network failure is not treated as a service failure: it is marked as `netError` and retried (WorkManager on the phone, `retryAt` on the server).

### 5.3 Review and actions on a report

- `SyncEngine.ignore()` adds the source track to the job's list and to `ignoredTracks` (family key).
- `assignMatch()` saves the canonical match, removes old keys/misses and, when asked, restores the ignore.
- `removeMatch()` and `restoreIgnored()` work on the same route identity.
- `restoreRemoved()` adds back what a run removed.
- The review UI lives in `UnmatchedScreen`, `PlaylistTracksScreen`, `TrackSyncScreen` and the sync cards.

### 5.4 Track Sync (current branch)

`TrackSync` (`core/sync/TrackSync.kt`) **creates no new storage**: it rebuilds source→target routes from `jobs`, `matchCache`, `ignoredTracks` and `reports`. Each row is `MATCHED`, `IGNORED` or `PENDING` (not found in the latest report). `TrackSyncScreen` filters, searches, resolves a pasted link (`resolveTrackLink`), assigns/replaces a match and restores an ignore. Actions call `SyncEngine.assignMatch/removeMatch/restoreIgnored`; they do not re-run the whole sync. The entry point is in `ToolsScreen` (`Tool.TRACK_SYNC`, "Your music" section) and `MainActivity` (`trackSyncOpen`).

### 5.5 Server and Desktop

1. `main()` reads `Config` from the environment (`SONGPORT_*`), configures `Lyrics`/`Updates` and, when `SONGPORT_MULTIUSER` is on with a password, delegates to `MultiUser`.
2. `launch()` initializes `Features`, logging, versions, `BuildDefaults`, server connectors, `ServerEnv`, `Runner` and `Web`.
3. `web.start(port)` serves pages and API; `started()` starts the scheduler, writes the local CLI key and registers the shutdown save hook.
4. Every request goes through `Web.handle()`: health check, PWA, `/api/v1`, `/mcp`, HTTP basic auth (when a password is set), same-origin check for POST, then routing to the matching page.
5. `Runner.startScheduler()` wakes every minute and starts due jobs plus backups, lyrics and artist alerts.

### 5.6 Authentication

| Mode | Where | Implementation |
|---|---|---|
| OAuth 2.0 + PKCE in browser | App | `AuthFlow`, `AuthCallbackActivity`, `Pkce`; redirect `songport://callback` |
| OAuth with loopback (Google) | App | `LoopbackServer` + `AuthFlow.startLoopbackFlow` |
| Credentials (server, user) | App | `ServerLoginActivity` + `CredentialsProvider` |
| MusicKit JS (Apple Music) | App | `AppleAuthActivity` + WebView asset loader |
| OAuth on the web page | Server | `Auth` with `state` + PKCE, back to `<SONGPORT_URL>/callback` |
| Page password | Server | HTTP Basic when `SONGPORT_PASSWORD`; multi-user with `SONGPORT_MULTIUSER` |
| API | Server | `Authorization: Bearer` token; only its SHA-256 is stored |
| Local lock | App | Optional fingerprint/PIN (`LockActivity`, `BiometricPrompt`) |

Tokens must never appear in logs, reports or configuration backups. `data/Redact.kt` exists for redaction; use it when adding diagnostics.

### 5.7 Backups

- **Configuration** (`ConfigBackup`): a `.trackhop` file with jobs, optional reports, matches, ignored tracks, portable settings and File playlists. It excludes tokens, secrets, app lock and device-specific data.
- **Encrypted full backup** (`EncryptedBackup`): AES-256-GCM with PBKDF2; includes tokens and cookies when the user asks.
- When a file from another device is imported, scheduled syncs arrive turned off (`scheduledOn`) so they do not run twice.

---

## 6. Code conventions

### Style and organization

- Official Kotlin style, **4-space** indentation, trailing commas common. There is no automatic formatter: **do not reformat whole files** or reorder imports.
- Imports often use wildcards for own packages (`import com.xlollx.songport.providers.*`) and are **not alphabetically sorted**. Follow the file you are editing.
- Packages: `com.xlollx.songport` for app/core, `com.xlollx.songport.server` for the server, `com.xlollx.songport.ytmbridge` for `ytm` and `bridge`.
- One file per topic/feature; file names are descriptive (`SyncEngine.kt`, `PlaylistFiles.kt`, `TrackSyncScreen.kt`). There are no artificial `controller/service/repository` layers.
- KDoc explains **why** a decision exists, not what the code already says. Comments are in English (new) and Italian (legacy). Keep the language of the block you edit; do not translate en masse.
- Test names are English sentences (`firstRunAddsWhatTheTargetHas`), not `test1`.

### Naming

- Connectors: `XxxProvider`, `SERVICE` constant, `displayName`, `brandColor`, `noteName`.
- Model: `Track`, `Playlist`, `PlaylistRef`, `SyncJob`, `SyncReport`, `SyncPlan`, `MatchPolicy`, `MatchReview`, `Progress`.
- UI: Composables in PascalCase (`SyncsScreen`, `TrackSyncScreen`, `PrefSection`); private helpers in camelCase.
- Strings: `snake_case` with an area prefix (`track_sync_*`, `tools_*`, `error_*`, `note_*`, `provider_note_*`).
- Tests: `*Test.kt` for JVM; `*FlowTest.kt` for instrumented flows.

### State and concurrency

- There are no ViewModels: screens get `Store.get(ctx)`, do `val data by store.state.collectAsState()`, and use `remember`/`rememberSaveable` for local state.
- State that must survive rotation uses `rememberSaveable` and `Saver` (e.g. `ProviderSaver`, `JobSaver`).
- Network/IO work uses `suspend` functions, `Dispatchers.IO` and `coroutineScope`/`async` when parallel. Always rethrow `CancellationException`.
- Connectors declare `searchParallelism`, `searchSpacingMs`, `readGate`, `addSpacingMs` when the service rate-limits. Respect them; never burst.
- Target and read locks (`TargetLocks`, `ServiceReads`) are part of the design; do not remove them "to simplify".

### Errors

- User-facing error: `ProviderException("clear message")` or `env.text("key")`.
- Run error: stored in `SyncReport.error` (and `netError` for network problems); not thrown to the UI.
- Log: `env.log(tag, message)` or `Diagnostics.log`; include useful context, never tokens or secrets.
- `runCatching` is for optional operations (cover, version, cache); do not use it to hide failures in the main flow.
- Transient network failures are detected with `NetError.kind()` / `isTransientNetwork()`.

### UI

- Material 3, `Brand` palette (`ui/Theme.kt`), typography and shared components (`Common.kt`, `Prefs.kt`, `PagePieces.kt`).
- Use `PrefSection`/`PrefRow`/`PrefSwitch` for settings and tools; `FitDialog` for dialogs; `SnackbarHostState` for messages.
- Add `testTag`/semantics when the screen will have an instrumented flow.
- Respect state-based navigation and back handling (`ScreenBackHandler`, `BackAwareScreen`).
- All user-visible text goes into `strings.xml`; do not hardcode English in Composables.

### Data compatibility

- `StoreData` and serializable models are read with `ignoreUnknownKeys` and defaults: **add new fields with a default**, do not rename or remove existing fields without an explicit migration.
- `ConfigBackup` has `format` and `version`; if you change the format, bump `VERSION` and keep reading older versions.
- Do not write `store.json` by hand or create a second store for the same data. Use `FileStore` and its helpers.

---

## 7. Rules for modifying the project

1. **Inspect before editing.** Read the affected module, its tests and the full flow. Do not assume a technology exists because a document mentions it.
2. **Make no unrequested changes.** Do not migrate architecture, reformat, rename packages or move files "while you are there".
3. **Respect module boundaries.** `core` and `ytm` must not import Android. If you need a Context, the code belongs in `app` or must go through `Env`.
4. **Do not duplicate storage.** Matches, ignored tracks, reports and settings live in `FileStore`; tokens in `TokenVault`. Reuse `TrackSync`, `SyncEngine` and the existing helpers.
5. **Preserve historical data.** Do not delete old reports, matches, ignored tracks or jobs "to clean up". Old keys using connector ids must still be read.
6. **Keep keys compatible.** `sourceFamily:trackId>targetFamily` and `FileStore.family()` are a contract between app, server, Track Sync and backups.
7. **New service:** implement `MusicProvider` (or extend `OAuthProvider`/`CredentialsProvider`) in `core/providers`, register it in `app/providers/Connectors.kt`. **Do not touch `server/Main.kt`; this fork does not build the server.**
8. **Server, docs, packaging are off-limits.** Do not read or modify `server/`, `docs/`, `packaging/`, `community/`, `social/`, `fastlane/`, `play/` or `fdroid/`. They exist in Git only to keep upstream merges conflict-free. Do not add instructions that require server parity, CLI/MCP updates, or `docs/assets/tools/*.js` ports.
9. **Flavors:** do not branch on flavor names; use `BuildConfig.STORE_BUILD`, `BuildConfig.PLUGIN_LINKS` and `Features.v2`. `play`/`appgallery` use official APIs only and never link to external payments. `fdroid` cannot include ML Kit. `full`/`fdroid` include `:bridge`; `play`/`appgallery` do not.
10. **Strings:** add the same key to `android/app/src/main/res/values/strings.xml` and the 11 `values-*` folders (de, es, fr, it, ja, ko, pl, pt-rBR, ru, tr, zh), with the same name and order. Escape apostrophes (`\'`). If you cannot translate, leave an approximate translation and say so in the PR.
11. **Playlist formats:** if you change `CsvCodec`, `PlaylistFiles` or link parsing, **also update the Kotlin side only** (`CsvCodec.kt`, `PlaylistFiles.kt`, `PlaylistLinks.kt`, contract tests). The `docs/assets/tools/*.js` ports are not maintained in this fork.
12. **Do not invent data or results.** Tools must work on real records. Do not add demo data to the production build.
13. **Do not commit secrets** (keystores, tokens, cookies, traffic captures) or `local.properties`. Do not print credentials in logs.
14. **Add tests** when logic changes: a unit test in the matching module; a contract test for HTTP; a flow test for UI.
15. **Do not run destructive Git commands** (`reset --hard`, `checkout --`, `clean -fd`, `merge --abort`, `commit`, `add`) without explicit permission. The tree may contain the user's half-merged work.

---

## 8. Dependency management

- **There is no version catalog and no lockfile.** Versions are declared inline in each `build.gradle`.
- Add a dependency to the module that uses it:
  - `android/core/build.gradle` for pure logic (use `api` only when the type appears in the module's public API, as with serialization, coroutines or OkHttp);
  - `android/ytm/build.gradle` for the YouTube Music client;
  - `android/bridge/build.gradle` for Android/WebView needs;
  - `android/app/build.gradle` for Android UI/platform; use `fullImplementation`, `playImplementation`, etc. for flavors;
  - `server/build.gradle` for JVM-only server/Desktop code.
- Use `testImplementation` for JUnit/MockWebServer/Robolectric; never put test dependencies in `implementation`.
- Before adding a library, check:
  - there is no equivalent internal utility already;
  - it is compatible with Kotlin 2.1/JVM 17 and Android minSdk 26;
  - its license is compatible with AGPL and F-Droid (nothing proprietary in `full`/`fdroid`; ML Kit is the deliberate exception, only in `full`/`play`).
- **Do not upgrade** AGP, Gradle, Kotlin or Compose without a concrete reason and without running all tests: F-Droid rebuilds the APK and compares bytes; toolchain changes can break reproducibility.
- Dependabot only updates GitHub Actions (`open-pull-requests-limit: 0` for Gradle). Gradle libraries are updated by hand.
- The tools in `docs/assets/tools` are dependency-free ESM; `package.json` only declares `"type": "module"`. Do not add a bundler.
- The server compiles individual `:bridge` files through the `bridgeClients` list in `server/build.gradle`. If a new `bridge` file must be used by the server, add it to that list and verify it imports no Android classes.

---

## 9. Important commands

Requirements: **JDK 17** and **Android SDK platform 36 / build-tools 36.0.0** for the app. The server needs Gradle 8.14.3 on `PATH` (it has no wrapper of its own).

### Android (from `android/`)

```bash
# What CI runs: tests for every module
./gradlew :core:test :ytm:test testFullDebugUnitTest :bridge:testDebugUnitTest

# Development APK (full flavor)
./gradlew assembleFullDebug
# Google Play APK
./gradlew assemblePlayDebug
# Other flavors
./gradlew assembleFdroidDebug
./gradlew assembleAppgalleryDebug
# "Preview" build installed next to the normal app
./gradlew assembleFullPreview
# Install on a connected device/emulator
./gradlew installFullDebug
```

On Windows use `gradlew.bat` instead of `./gradlew`.

A single test:

```bash
./gradlew testFullDebugUnitTest --tests "com.xlollx.songport.sync.TrackSyncActionsTest"
./gradlew :core:test --tests "com.xlollx.songport.sync.MatcherTest"
./gradlew :bridge:testDebugUnitTest --tests "com.xlollx.songport.ytmbridge.SpotifyWebClientContractTest"
```

Instrumented tests (emulator running; the flows use fake services and closed network):

```bash
./gradlew connectedFullDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.package=com.xlollx.songport.flows
```

### Server / Desktop (from the repository root)

```bash
gradle -p server test
gradle -p server test installDist --no-daemon --stacktrace
gradle -p server printVersion
gradle -p server installDist desktopLibs      # SWT jars for Desktop packaging
server/desktop/package.sh                     # .msi/.zip, .dmg, .deb/.tar.gz in dist/
```

Run the installed server:

```bash
SONGPORT_DATA=./data SONGPORT_PORT=8080 \
  server/build/install/songport-server/bin/songport-server
```

On Windows: `server\build\install\songport-server\bin\songport-server.bat` with PowerShell environment variables (`$env:SONGPORT_DATA`).

### Docker

```bash
docker build -f server/Dockerfile -t trackhop .
docker run -d --name trackhop -p 8080:8080 -v trackhop-data:/data \
  -e SONGPORT_URL=http://127.0.0.1:8080 -e SONGPORT_PASSWORD=choose-one trackhop
```

### Website and web tools

```bash
node --test docs/assets/tools/*.test.mjs
```

There is no `npm install`: the tools have no dependencies.

### Optional integration tests (not in CI)

```bash
# Real music servers in Docker (Navidrome, Jellyfin, etc.)
scripts/live_servers.sh up
cd android && gradle :core:test --tests '*LiveServersIT*'
scripts/live_servers.sh down

# End-to-end test of the server page (Playwright + Docker)
server/e2e/run.sh
```

### Quick diagnostics

```bash
git status --short          # essential before editing
./gradlew tasks             # available tasks
```

There is no lint/format task.

---

## 10. Testing and validation

### Where tests live

- `android/core/src/test/kotlin/...`: engine logic, matching, formats, official connectors, backups, groups, notifications.
- `android/core/src/test/kotlin/.../contract/`: **contract tests** for each connector against a local `MockWebServer`.
- `android/ytm/src/test/kotlin/...`: YouTube Music client against a mock.
- `android/bridge/src/test/java/...`: web connectors with Robolectric and a mock.
- `android/app/src/test/java/...`: `SyncEngine` with `FakeProvider`, UI/state helpers, backups, automation.
- `server/src/test/kotlin/...`: web page, API, CLI, MCP, multi-user, storage, server connectors.
- `android/app/src/androidTest/java/.../flows/`: UI flows with `FakeWorld`, no network.
- `docs/assets/tools/*.test.mjs`: JS tools with `node:test`.

### Patterns to follow

- **Never** call a real service from a test. Contract tests redirect everything with `Http.rewrite` to `127.0.0.1` and use `MockWebServer`; responses are queued in the expected order.
- In `core` tests, `ContractEnv` implements `Env`; in app tests, `FakeContext` + `FakeProvider`. Texts are replaced by a function returning `"s:<name>"` so notes can be checked by name.
- `Store` is a JVM-wide singleton in tests: use unique prefixes (`UUID`) for track/job ids and clean up in `@After`.
- A failing test should include context in its message (`error=… notes=… unmatched=…`), as the existing ones do.
- Instrumented flows use `FlowTest`/`FakeWorld`: closed network, clean store, and a screenshot + semantics tree on failure.

### What to run for a change

| Change | Minimum |
|---|---|
| `core/sync`, `Matcher`, models | `./gradlew :core:test` |
| Official connector | `./gradlew :core:test` (contract tests) |
| Web connector (`bridge`) | `./gradlew :bridge:testDebugUnitTest` |
| YouTube Music client | `./gradlew :ytm:test` |
| UI, flows, Android platform | `./gradlew testFullDebugUnitTest` plus an instrumented flow when relevant |
| Server, API, CLI, web | `gradle -p server test` |
| Formats/JS port | `node --test docs/assets/tools/*.test.mjs` |
| Strings/flavors | build `assembleFullDebug` and `assemblePlayDebug` |

### Recommended manual validation

- Build the affected flavor, not just `full`.
- Without keys, OAuth services must show "Not configured"; files and personal servers must still work.
- Run a source→target sync with the File provider (no account needed) and review the report.
- Check that a new string appears in all 12 languages (or at least that the build still works).
- In Track Sync: verify that a match/ignore is saved, persists across restarts and does not duplicate keys.
- On the server: `GET /health`, open the page, and `/api/v1/openapi.json` (public, no token).

### CI

- `.github/workflows/build.yml`: tests + `assembleFullDebug` on every push/PR; signed builds and release only with secrets.
- `.github/workflows/server.yml`: `gradle -p server test installDist` and the Docker image build.
- `.github/workflows/ui-tests.yml`: instrumented flows, manual only (`workflow_dispatch`).
- `.github/workflows/codeql.yml`: CodeQL analysis.
- Contract tests do not reach the Internet; E2E tests against real services are not in CI.

---

## 11. Known issues and limitations

Only facts verifiable in the repository or its current state are listed:

1. **Incomplete Track Sync translations.** The 71 new `track_sync_*` keys exist only in `values/strings.xml` (English). The 11 `values-*` folders have 2407 strings against 2478 in English. If you continue that feature, translate the missing keys.
3. **`README.md` is stale about structure.** Its "Project layout" puts `model/`, `providers/` and `sync/` under `app/`, but they are in `core/`. It also omits several languages and modules. The code wins.
4. **No database.** All state lives in one JSON file (`store.json`). Writes are coalesced for 500 ms; if the process dies before a `flush()`, the last changes can be lost. There are caps: 200 reports, 20,000 cache entries, 7 days of misses, 30 days of present-track memory.
5. **No lint or automatic formatting.** Style is maintained by hand; CI will not catch unsorted imports or long lines.
6. **The server lacks some connectors.** Amazon Music and every Apple Music route depend on Android components (WebView or MusicKit JS) and do not exist on server/Desktop; the server registry contains no `AppleMusicProvider`. The app's official Apple route also cannot remove tracks (an Apple API limitation). The official-only server (`officialOnly`, e.g. Microsoft Store) additionally omits unofficial connectors.
7. **Store builds are limited to official APIs.** `play` and `appgallery` do not include `:bridge`; they use the external Trackhop Bridge app or official APIs. `fdroid` does not include ML Kit. This is a distribution constraint, not a bug.
8. **F-Droid reproducibility.** The `full` APK is built without the repository's variables; changing a variable or the toolchain can make F-Droid fail to reproduce the binary. The ART profile is disabled on purpose (`tasks.configureEach` in `app/build.gradle`).
9. **Server allowlist.** `server/build.gradle` compiles only the `bridge` files listed in `bridgeClients` (`BridgeNet`, `WebHost`, `SpotifyWebClient`, `DeezerWebClient`, `LiveOneWebClient`, `AnghamiWebClient`, `QobuzWebClient`). A new file does not reach the server just by existing.
10. **Real-service coverage is unknown.** Tests use mocks; they do not verify the current behavior of external APIs. Several connectors are marked `alpha`/`beta` in the code. Do not claim a service works in production without testing it.
11. **UI/E2E are not in the default CI.** Instrumented flows are manual, and the server E2E suite (`server/e2e/run.sh`) does not run in CI either.
12. **`local.properties` is machine-specific.** It is ignored by Git; do not copy or commit it.
13. **The external Trackhop Bridge app is not in this repository.** Its implementation and internal protocol cannot be verified here; only the client side is visible (`BridgePlugin`, `PluginRelay`, `*BridgeProvider`).
14. **Store/release secrets.** They are not in the repository; publication and signing cannot be verified from the code.

---

## 12. Project-specific good practices

- **Before writing:** identify the right module, look for an existing pattern and check whether a helper already exists. In this project, duplication is usually worse than a small abstraction.
- **Engine first.** If logic can live without Android, it goes in `core` and is tested with plain JUnit. The UI only presents and orchestrates.
- **One source of truth.** Any persistent state change goes through `FileStore`; any playlist change goes through `SyncEngine`/`MusicProvider`.
- **Do not break compatibility.** Add fields with defaults, keep old keys readable and support data from older versions. Users upgrade from old releases and bring backups.
- **Respect service limits.** Do not lower `searchSpacingMs`, ignore `Retry-After` or parallelize beyond what the connector declares.
- **Make errors actionable.** A message should say what happened and what the user can do; technical detail belongs in the log.
- **Test the real flavor.** A change in `play` or `fdroid` is not validated by `assembleFullDebug`.
- **Take care with texts.** Strings are also read by the server (`Strings.load`), which falls back to English when a translation is missing. Do not embed markdown or HTML unless the component expects it.
- **Keep server feature parity.** If you add an operation to the web page, consider API, CLI and MCP; the project tends to expose the same capability through all four.
- **Update documentation only when behavior changes**, and do not rewrite entire guides. `docs/guide/` is translated into several languages; do not break links or Jekyll front matter.
- **If something cannot be verified, say so.** Do not invent services, commands, environment variables or structures. In this document, unconfirmed information is called out explicitly.

### Quick map: where to change what

| I want to… | Main files |
|---|---|
| Add a service | `core/providers/XxxProvider.kt`, `app/providers/Connectors.kt`, `server/Main.kt`, strings, contract tests |
| Change matching | `core/sync/Matcher.kt`, `MatcherTest.kt`, `SyncEngine` and cache keys |
| Change sync behavior | `core/sync/SyncEngine.kt`, `core/model/Models.kt`, `SyncEngineTest.kt` |
| Add an Android tool | `ui/ToolsScreen.kt`, a new screen in `ui/`, `MainActivity.kt`, strings, flow test |
| Add a server page/endpoint | `server/Web.kt` + `*Web.kt`, `Api*.kt`/`ApiDocs.kt`, tests |
| Change the store or settings | `core/data/FileStore.kt`, `ConfigBackup.kt`, `Settings`, tests |
| Change playlist formats | `core/sync/CsvCodec.kt`/`PlaylistFiles.kt`, `docs/assets/tools/playlist.js`, Kotlin and Node tests |
| Change authentication | `app/auth/`, `core/providers/OAuthProvider.kt`, `server/Auth.kt`, `SECURITY.md` |
| Change texts | `app/src/main/res/values*/strings.xml` (12 locales) and, when applicable, `full`/`storeCommon` |
