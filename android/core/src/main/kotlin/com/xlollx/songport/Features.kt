package com.xlollx.songport

import com.xlollx.songport.data.Settings
import com.xlollx.songport.providers.MusicProvider

/**
 * The release switch. The features of Trackhop 2.0 (planned as 1.18, as comments elsewhere still say:
 * podcasts and OPML, shared playlists and the app's syncs with the user's server, Discover's new
 * pages, listening-based Wrapped and poster, playlist covers on more services, the new library lists)
 * are offered only when [v2] is on. From 2.0 every build ships them on: the app's `BuildConfig.V2` is
 * true unless a build is made with `-PV2=false`, and the server's switch is on unless
 * `TRACKHOP_PREVIEW_2=0` says otherwise ([build]). A build with them off can still show them on a
 * device where the [PreviewCode] was typed into the search of the syncs ([preview],
 * `Settings.preview2`; Settings › Developer options shows the switch to turn it off).
 *
 * Off, only the ways to start something new are hidden: what a user already has (a sync that reads a
 * 2.0 list, a group, followed artists) keeps working and is never deleted. Where nothing sets it (the
 * engine's own tests), [build] stays off.
 */
object Features {
    /** The build's switch: on in every build from 2.0. The app sets it from `BuildConfig.V2`, the server from its own switch. */
    @Volatile @JvmStatic var build: Boolean = false

    /** The developer toggle, asked each time (the app reads `Settings.preview2`); off where nothing sets it. */
    @Volatile @JvmStatic var preview: () -> Boolean = { false }

    /** The features of 2.0 are offered. */
    @JvmStatic val v2: Boolean get() = build || runCatching { preview() }.getOrDefault(false)

    /** [v2] as [settings] say: for a screen that redraws when the settings change. */
    @JvmStatic fun v2(settings: Settings): Boolean = build || settings.preview2

    /** [p]'s library list [playlistId] is offered in the pickers (some are new in 2.0, see [MusicProvider.libraryIsV2]). */
    @JvmStatic fun libraryOffered(p: MusicProvider, playlistId: String, asTarget: Boolean): Boolean = v2 || !p.libraryIsV2(playlistId, asTarget)

    /** A sync puts the source's cover on [p]'s playlist (covers on the services added in 2.0 wait for it where the switch is off). */
    @JvmStatic fun coversOn(p: MusicProvider): Boolean = p.canSetCover && (v2 || !p.coverIsV2)

    /** [p] moves a playlist into the source's order (TIDAL's and YouTube's moves wait for the switch). */
    @JvmStatic fun reorderOn(p: MusicProvider): Boolean = p.canReorder && (v2 || !p.reorderIsV2)
}

/**
 * The code that turns [Features.preview] on, typed into the search of the syncs: only its SHA-256
 * is here, so reading the code does not give it away. The owner hands it to whom they choose.
 * shortcut: a build made with -PV2=false (from 2.0 the default build has them on) is the only place it matters.
 */
object PreviewCode {
    /** SHA-256 of "trackhop-preview:" + the code; tests set their own. */
    @Volatile @JvmStatic var hash: String = "7253ab8a071f0437f2dc6508c02e3eb8dc01b368c050ba5dfa3a48cd78e55267"

    /** [typed] is the code (spaces around it and letter case do not count). */
    @JvmStatic fun matches(typed: String): Boolean {
        val t = typed.trim().lowercase()
        if (t.length < 8) return false
        val d = java.security.MessageDigest.getInstance("SHA-256").digest("trackhop-preview:$t".toByteArray())
        return d.joinToString("") { "%02x".format(it) } == hash
    }
}
