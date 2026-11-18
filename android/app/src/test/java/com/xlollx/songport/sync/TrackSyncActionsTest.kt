package com.xlollx.songport.sync

import com.xlollx.songport.data.Store
import com.xlollx.songport.model.PlaylistRef
import com.xlollx.songport.model.ProviderException
import com.xlollx.songport.model.SyncJob
import com.xlollx.songport.model.Track
import com.xlollx.songport.platform.env
import com.xlollx.songport.providers.Providers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.UUID

/**
 * The actions Track Sync performs on the same stores the engine uses: replacing a match, restoring
 * an ignore and validating a pasted link. No service is contacted by these paths.
 */
class TrackSyncActionsTest {
    private val ctx = FakeContext()
    private val engine = SyncEngine(ctx.env) { name, _ -> "s:$name" }
    private val run = UUID.randomUUID().toString().take(6)
    private val created = mutableListOf<String>()

    private fun source(id: String) = "$run-$id"

    private fun job(
        sourceProvider: String,
        targetProvider: String,
        ignored: List<String> = emptyList(),
    ): SyncJob {
        val job = SyncJob(
            id = "ts-$run-${UUID.randomUUID().toString().take(6)}",
            name = "Track Sync test",
            source = PlaylistRef(sourceProvider, "source", "Source playlist"),
            target = PlaylistRef(targetProvider, "target", "Target playlist"),
            ignoredSourceIds = ignored,
        )
        Store.get(ctx).upsertJob(job)
        created += job.id
        return job
    }

    @After fun tearDown() {
        val store = Store.get(ctx)
        created.forEach { store.deleteJob(it) }
    }

    @Test fun assigningAMatchReplacesLegacyKeysAndRestoresTheIgnore() {
        val store = Store.get(ctx)
        val trackId = source("assign")
        val identity = "youtube:$trackId>spotify"
        val canonical = "youtube:$trackId>spotify"
        val legacy = "ytm:$trackId>spotify_bridge"
        val staleMiss = "youtube:$trackId>spotify_bridge"
        val job = job("ytm", "spotify_bridge", ignored = listOf(trackId))

        store.putMatch(legacy, "old-target")
        store.putMisses(listOf(legacy, canonical, staleMiss))
        store.putIgnored("ytm", trackId, "spotify_bridge")

        engine.assignMatch("youtube", trackId, "spotify", "new-target", restoreIgnored = true)

        val data = store.data
        assertEquals("new-target", data.matchCache[canonical])
        assertEquals(1, data.matchCache.keys.count { TrackSync.parseKey(it)?.identity == identity })
        assertFalse(data.ignoredTracks.any { TrackSync.parseKey(it)?.identity == identity })
        assertFalse(legacy in data.missCache)
        assertFalse(canonical in data.missCache)
        assertFalse(staleMiss in data.missCache)
        assertEquals(emptyList<String>(), store.job(job.id)!!.ignoredSourceIds)
    }

    @Test fun removingAMatchRemovesEveryKeyOfThatRouteOnly() {
        val store = Store.get(ctx)
        val trackId = source("remove")
        val keptId = source("kept")
        val legacy = "ytm:$trackId>spotify_bridge"
        val canonical = "youtube:$trackId>spotify"

        store.putMatch(legacy, "old-target")
        store.putMatch(canonical, "new-target")
        store.putMatch("youtube:$keptId>spotify", "kept-target")
        store.putMisses(listOf(legacy, canonical))

        engine.removeMatch("youtube", trackId, "spotify")

        val data = store.data
        assertFalse(legacy in data.matchCache)
        assertFalse(canonical in data.matchCache)
        assertEquals("kept-target", data.matchCache["youtube:$keptId>spotify"])
        assertFalse(legacy in data.missCache)
        assertFalse(canonical in data.missCache)
    }

    @Test fun restoringAnIgnoreClearsTheGlobalSetAndEverySyncOfTheRoute() {
        val store = Store.get(ctx)
        val trackId = source("restore")
        val legacy = "ytm:$trackId>spotify_bridge"
        val canonical = "youtube:$trackId>spotify"
        val staleMiss = "youtube:$trackId>spotify_bridge"
        val otherRoute = "spotify:$trackId>deezer"
        val first = job("ytm", "spotify_bridge", ignored = listOf(trackId))
        val second = job("youtube", "spotify@2", ignored = listOf(trackId, "keep-me"))
        val elsewhere = job("spotify", "deezer", ignored = listOf(trackId))

        store.putIgnored("ytm", trackId, "spotify_bridge")
        store.update { it.copy(ignoredTracks = it.ignoredTracks + legacy + otherRoute) }
        store.putMisses(listOf(legacy, canonical, staleMiss))

        engine.restoreIgnored("youtube", trackId, "spotify")

        val data = store.data
        assertTrue(data.ignoredTracks.none { TrackSync.parseKey(it)?.identity == "youtube:$trackId>spotify" })
        assertTrue(otherRoute in data.ignoredTracks)
        assertTrue(legacy !in data.missCache)
        assertTrue(canonical !in data.missCache)
        assertTrue(staleMiss !in data.missCache)
        assertEquals(emptyList<String>(), store.job(first.id)!!.ignoredSourceIds)
        assertEquals(listOf("keep-me"), store.job(second.id)!!.ignoredSourceIds)
        // Another route was not touched, even though it uses the same source id.
        assertEquals(listOf(trackId), store.job(elsewhere.id)!!.ignoredSourceIds)
    }

    @Test fun restoringAnIgnoreStoredOnlyOnTheSyncStillWorks() {
        val store = Store.get(ctx)
        val trackId = source("job-only")
        val miss = "spotify:$trackId>youtube"
        val job = job("spotify", "youtube", ignored = listOf(trackId))
        store.putMisses(listOf(miss))

        engine.restoreIgnored("spotify", trackId, "youtube")

        assertEquals(emptyList<String>(), store.job(job.id)!!.ignoredSourceIds)
        assertFalse(miss in store.data.missCache)
    }

    /**
     * A route read through the Spotify web bridge must keep searching on that session: the
     * official connector comes first in the registry and needs its own Premium login.
     */
    @Test fun reviewActionsUseTheSyncsOwnConnectionNotTheFirstOfTheFamily() {
        val official = FakeProvider("spotify", signedIn = false)
        val bridge = FakeProvider("spotify_bridge")
        Providers.testDoubles = listOf(official, bridge)
        try {
            val job = job("spotify_bridge", "youtube")

            assertEquals("spotify_bridge", engine.connectorForReview("spotify", listOf(job))?.id)
            // The destination side of the same route still resolves its own family.
            assertEquals("spotify_bridge", engine.connectorForReview("spotify", listOf(job), target = true)?.id)
        } finally {
            Providers.testDoubles = emptyList()
        }
    }

    @Test fun sourceTrackOrderFollowsThePlaylist() = runBlocking {
        val playlist = FakeProvider("spotify_bridge")
        playlist.lists["source"] = mutableListOf(
            Track(id = source("first"), title = "First"),
            Track(id = source("second"), title = "Second"),
        )
        Providers.testDoubles = listOf(playlist)
        try {
            val order = engine.sourceTrackOrder(job("spotify_bridge", "youtube"))

            assertEquals(listOf(source("first"), source("second")), order)
        } finally {
            Providers.testDoubles = emptyList()
        }
    }

    @Test fun invalidLinksAreRejectedBeforeAnythingIsWritten() = runBlocking {
        val store = Store.get(ctx)
        val before = store.data.matchCache
        for (bad in listOf("", "not a link", "https://example.com/track/1", "https://open.spotify.com/playlist/abc")) {
            try {
                engine.resolveTrackLink("spotify", bad)
                fail("accepted: $bad")
            } catch (e: ProviderException) {
                assertTrue("message for $bad", e.message!!.isNotBlank())
            }
        }
        assertEquals(before, store.data.matchCache)
    }
}
