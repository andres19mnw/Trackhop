package com.xlollx.songport.data

import com.xlollx.songport.model.PlaylistRef
import com.xlollx.songport.model.SyncJob
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class TrackSyncStoreTest {

    private fun store() = FileStore(Files.createTempDirectory("track-sync-store").toFile())

    @Test fun removingMatchesAndIgnoresAlsoClearsTheirMisses() {
        val store = store()
        val key = "spotify:a>youtube"

        store.putMatch(key, "target")
        store.putMisses(listOf(key))
        assertTrue(store.cachedMiss("spotify", "a", "youtube"))
        store.removeMatches(listOf(key))
        assertTrue(store.allMatches().isEmpty())
        assertFalse(store.cachedMiss("spotify", "a", "youtube"))

        store.putIgnored("spotify", "a", "youtube")
        store.putMisses(listOf(key))
        assertTrue(store.isIgnored("spotify", "a", "youtube"))
        store.removeIgnoredKeys(listOf(key))
        assertFalse(store.isIgnored("spotify", "a", "youtube"))
        assertFalse(store.cachedMiss("spotify", "a", "youtube"))
    }

    @Test fun blankMatchesAreNeverPublished() {
        val store = store()
        store.putMatch("spotify:a>youtube", "")
        store.putMatch("", "target")
        assertTrue(store.allMatches().isEmpty())
    }

    @Test fun matchesIgnoresAndIgnoredListsSurviveARestart() {
        val dir = Files.createTempDirectory("track-sync-restart").toFile()
        val job = SyncJob(
            id = "restart-job",
            name = "Restart",
            source = PlaylistRef("spotify", "source", "Source"),
            target = PlaylistRef("youtube", "target", "Target"),
            ignoredSourceIds = listOf("ignored-source"),
        )

        val first = FileStore(dir)
        first.putMatch("spotify:matched-source>youtube", "target-id")
        first.putIgnored("spotify", "ignored-source", "youtube")
        first.upsertJob(job)
        first.flush()

        val reopened = FileStore(dir)
        assertEquals("target-id", reopened.cachedMatch("spotify", "matched-source", "youtube"))
        assertTrue(reopened.isIgnored("spotify", "ignored-source", "youtube"))
        assertEquals(listOf("ignored-source"), reopened.job("restart-job")!!.ignoredSourceIds)
        assertEquals(listOf("ignored-source"), reopened.data.jobs.single { it.id == "restart-job" }.ignoredSourceIds)
    }
}
