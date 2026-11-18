package com.xlollx.songport.sync

import com.xlollx.songport.model.PlaylistRef
import com.xlollx.songport.model.SyncJob
import com.xlollx.songport.model.SyncReport
import com.xlollx.songport.model.Track
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackSyncTest {

    private fun job(
        id: String,
        source: String,
        target: String,
        sourceName: String = "Source",
        targetName: String = "Target",
        ignored: List<String> = emptyList(),
    ) = SyncJob(
        id = id,
        name = id,
        source = PlaylistRef(source, "s-$id", sourceName),
        target = PlaylistRef(target, "t-$id", targetName),
        ignoredSourceIds = ignored,
    )

    private fun report(id: String, jobId: String, started: Long, vararg tracks: Track) = SyncReport(
        id = id,
        jobId = jobId,
        jobName = jobId,
        startedEpoch = started,
        durationMs = 1,
        unmatchedTracks = tracks.toList(),
    )

    private fun track(id: String) = Track(id, "Title $id", listOf("Artist"))

    @Test fun keysAreNormalisedToServiceFamiliesAndKeepTheStoredForm() {
        val key = TrackSync.parseKey("spotify_bridge:abc>ytm")!!
        assertEquals("spotify", key.sourceProvider)
        assertEquals("abc", key.sourceTrackId)
        assertEquals("youtube", key.destinationProvider)
        assertEquals("spotify:abc>youtube", key.identity)
        assertEquals("spotify:abc>youtube", key.canonical)
        assertEquals("spotify_bridge:abc>ytm", key.raw)

        assertEquals("spotify>youtube", TrackSync.routeId("spotify_bridge", "ytm"))
        assertEquals("spotify:abc>youtube", TrackSync.key("spotify_bridge", "abc", "ytm").canonical)
    }

    @Test fun malformedKeysAreIgnored() {
        for (raw in listOf("", "spotify:abc", ">youtube", "spotify:>youtube", "spotify:abc>", ":abc>youtube", ">")) {
            assertNull(raw, TrackSync.parseKey(raw))
        }
    }

    @Test fun routesGroupJobsAndRecordsOncePerServicePair() {
        val first = job("j1", "spotify_bridge", "ytm", "Road Trip", "Road Trip", ignored = listOf("a"))
        val second = job("j2", "spotify@2", "youtube", "Discover Weekly", "Weekly", ignored = listOf("b", "f"))
        val other = job("j3", "deezer", "tidal")

        val routes = TrackSync.buildRoutes(
            jobs = listOf(first, second, other),
            matches = linkedMapOf(
                // The same identity through a connector and through the family: the canonical key wins.
                "spotify_bridge:a>ytm" to "old-target",
                "spotify:a>youtube" to "new-target",
                "spotify:c>youtube" to "c-target",
            ),
            ignored = linkedSetOf(
                // A match and an ignore on the same track: the match is the visible relationship.
                "spotify_bridge:a>ytm",
                "spotify:b>ytm",
                // A record whose sync was deleted: it still has to be reachable.
                "spotify:orphan>deezer",
                "not-a-key",
            ),
            reports = listOf(
                report("r1", "j1", 10, track("a"), track("b"), track("d")),
                report("r2", "j2", 20, track("d"), track("e")),
            ),
        )

        assertEquals(listOf("spotify>youtube", "deezer>tidal", "spotify>deezer"), routes.map { it.id })

        val route = routes[0]
        assertEquals(listOf("j1", "j2"), route.jobs.map { it.id })
        assertEquals(2, route.matchedCount)
        assertEquals(2, route.ignoredCount)
        assertEquals(2, route.pendingCount)
        assertEquals(6, route.entries.size)
        // The canonical key replaced the older connector key, not both.
        assertEquals("new-target", route.matched.first { it.sourceTrackId == "a" }.matchedTrackId)
        assertEquals(setOf("b", "f"), route.ignored.map { it.sourceTrackId }.toSet())
        // The same pending source in two reports of the same route is one row.
        assertEquals(setOf("d", "e"), route.pending.map { it.sourceTrackId }.toSet())
        assertTrue(route.pending.all { it.reportId != null && it.jobId != null })
        assertTrue(route.pending.all { it.sourceTrack != null })

        // A sync with no records yet is still listed, so it can say it is empty.
        assertEquals("deezer>tidal", routes[1].id)
        assertEquals(1, routes[1].jobs.size)
        assertTrue(routes[1].entries.isEmpty())

        // A record without a sync keeps its data and is not shown as a fake duplicate.
        val orphan = routes[2]
        assertTrue(orphan.jobs.isEmpty())
        assertEquals(listOf("orphan"), orphan.ignored.map { it.sourceTrackId })
    }

    @Test fun pendingComesFromTheLatestReportOfEachSync() {
        val one = job("j", "spotify", "youtube")
        val routes = TrackSync.buildRoutes(
            jobs = listOf(one),
            matches = emptyMap(),
            ignored = emptySet(),
            reports = listOf(
                report("old", "j", 100, track("old-source")),
                report("new", "j", 200, track("new-source")),
            ),
        )

        val pending = routes.single().pending
        assertEquals(listOf("new-source"), pending.map { it.sourceTrackId })
        assertEquals("new", pending.single().reportId)
    }

    @Test fun blankMatchesAreNotRows() {
        val one = job("j", "spotify", "youtube")
        val routes = TrackSync.buildRoutes(
            jobs = listOf(one),
            matches = linkedMapOf("spotify:a>youtube" to "", "spotify:b>youtube" to "target-b"),
            ignored = emptySet(),
            reports = emptyList(),
        )

        val route = routes.single()
        assertEquals(listOf("b"), route.matched.map { it.sourceTrackId })
    }

    @Test fun noJobsAndNoRecordsMakeNoRoutes() {
        assertTrue(TrackSync.buildRoutes(emptyList(), emptyMap(), emptySet(), emptyList()).isEmpty())
    }

    @Test fun rowsFollowTheSourcePlaylistOrderAndNumberItsTracks() {
        val one = job("j1", "spotify", "youtube")
        val two = job("j2", "spotify", "youtube")
        val route = TrackSync.buildRoutes(
            jobs = listOf(one, two),
            matches = linkedMapOf(
                "spotify:a>youtube" to "ta",
                "spotify:b>youtube" to "tb",
                // A match remembered from an older run: the playlist no longer lists it.
                "spotify:old>youtube" to "told",
            ),
            ignored = linkedSetOf("spotify:c>youtube"),
            reports = listOf(report("r1", "j1", 10, track("d")), report("r2", "j2", 20, track("e"))),
        ).single()

        // The second playlist is read after the first: a track in both keeps its first place.
        val rows = TrackSync.rows(route.entries, listOf(listOf("c", "a", "d"), listOf("e", "a", "b", "x")))

        assertEquals(listOf("c", "a", "d", "e", "b", "old"), rows.map { it.entry.sourceTrackId })
        assertEquals(listOf(1, 2, 3, 4, 5, null), rows.map { it.position })
        // A filter narrows the list but does not renumber it.
        val filtered = TrackSync.rows(route.entries.filter { it.status == TrackSync.Status.IGNORED }, listOf(listOf("c", "a", "d")))
        assertEquals(listOf(1), filtered.map { it.position })
    }
}
