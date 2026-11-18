package com.xlollx.songport.sync

import com.sun.net.httpserver.HttpServer
import com.xlollx.songport.contract.ContractEnv
import com.xlollx.songport.model.PlaylistRef
import com.xlollx.songport.model.SyncJob
import com.xlollx.songport.model.Track
import com.xlollx.songport.net.Pacer
import com.xlollx.songport.platform.Env
import com.xlollx.songport.providers.Providers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress
import java.util.Collections

/**
 * #57: Spotify lists Jean-Michel Jarre's China 1981 concert in French, the user's Jellyfin in English.
 * The work's other names, from MusicBrainz by the ISRC, find the file; nothing changes when none fits.
 */
class OtherTitlesTest {
    private val rec = "5fb524f1-8cc8-4c04-a921-e34c0a911ea7"
    private val work = "b3edbc7d-4147-33b4-97d9-afca723b955e"
    private val hits: MutableList<String> = Collections.synchronizedList(ArrayList())
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { ex ->
            val p = ex.requestURI.path
            hits += p
            val body = when {
                p.endsWith("/isrc/FRZ118100004") -> """{"recordings":[{"id":"$rec","title":"Les Chants magnétiques, Part 4"}]}"""
                p.endsWith("/recording/$rec") -> """{"id":"$rec","relations":[{"target-type":"work","type":"performance","work":{"id":"$work","title":"Les Chants magnétiques, Part 4"}}]}"""
                p.endsWith("/work/$work") -> """{"id":"$work","title":"Les Chants magnétiques, Part 4","aliases":[{"name":"Magnetic Fields, Part 4"},{"name":"Magnetic Fields"}]}"""
                else -> null
            }
            val bytes = (body ?: """{"error":"x"}""").toByteArray()
            ex.sendResponseHeaders(if (body != null) 200 else 404, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        start()
    }
    private val env = ContractEnv()

    /** A personal server: untagged files, searched by title. */
    private class Library(id: String) : MemoryService(id) {
        override val matchesByMbid = true
        override suspend fun search(ctx: Env, track: Track): List<Track> = super.search(ctx, track)
    }

    @Before fun setUp() {
        MusicBrainz.base = "http://127.0.0.1:${server.address.port}/ws/2"
        MusicBrainz.pace = Pacer(0)
        MusicBrainz.reset()
    }

    @After fun tearDown() {
        server.stop(0)
        MusicBrainz.base = "https://musicbrainz.org/ws/2"
        MusicBrainz.pace = Pacer(1100)
        MusicBrainz.reset()
        Providers.testDoubles = emptyList()
    }

    private fun sync(src: MemoryService, dst: MemoryService) = runBlocking {
        Providers.testDoubles = listOf(src, dst)
        dst.lists.getOrPut("t") { ArrayList() }
        val job = SyncJob(id = "j", name = "j", source = PlaylistRef(src.id, "p", "p"), target = PlaylistRef(dst.id, "t", "t")).also { env.store.upsertJob(it) }
        SyncEngine(env).run(job)
    }

    @Test fun theFrenchTitleFindsTheEnglishFile() {
        val src = MemoryService("msrc"); val dst = Library("mdst")
        src.lists["p"] = mutableListOf(Track("s1", "Chants Magnetiques, Pt. 4 - Live", listOf("Jean-Michel Jarre"), "Les concerts en Chine 1981 (Live)", 380_000, isrc = "FRZ118100004"))
        dst.catalogue += Track("right", "Magnetic Fields, Part 4 (Live)", listOf("Jean-Michel Jarre"), "The Concerts in China", 381_000)
        dst.catalogue += Track("wrong", "Equinoxe, Part 4", listOf("Jean-Michel Jarre"), "Equinoxe", 380_000)
        val r = sync(src, dst)
        assertEquals(listOf("right"), dst.lists["t"]!!.map { it.id })
        assertTrue(r.unmatched.isEmpty())
        // Asked once, remembered: a second run does not ask MusicBrainz again.
        val asked = hits.size
        runBlocking { MusicBrainz.otherTitles(env, "FRZ118100004") }
        assertEquals(asked, hits.size)
    }

    @Test fun noOtherNameLeavesItNotFound() {
        val src = MemoryService("msrc"); val dst = Library("mdst")
        src.lists["p"] = mutableListOf(Track("s1", "Chants Magnetiques, Pt. 4 - Live", listOf("Jean-Michel Jarre"), "Les concerts en Chine 1981 (Live)", 380_000, isrc = "FRZ118100004"))
        dst.catalogue += Track("wrong", "Equinoxe, Part 4", listOf("Jean-Michel Jarre"), "Equinoxe", 380_000)
        val r = sync(src, dst)
        assertTrue(dst.lists["t"]!!.isEmpty())
        assertEquals(1, r.unmatchedTracks.size)
        // And "Equinoxe" is not offered as the closest.
        assertTrue(r.suggestions.isEmpty())
    }

    @Test fun anotherSongWithTheSameNameIsNeverTaken() {
        val src = MemoryService("msrc"); val dst = Library("mdst")
        src.lists["p"] = mutableListOf(Track("s1", "Chants Magnetiques, Pt. 4 - Live", listOf("Jean-Michel Jarre"), "Les concerts en Chine 1981 (Live)", 380_000, isrc = "FRZ118100004"))
        // The English name, by another artist; another part of the piece; the right name but far too long.
        dst.catalogue += Track("cover", "Magnetic Fields, Part 4 (Live)", listOf("Some Tribute Band"), "Covers", 380_000)
        dst.catalogue += Track("part1", "Magnetic Fields (Live)", listOf("Jean-Michel Jarre"), "The Concerts in China", 380_000)
        dst.catalogue += Track("p1", "Magnetic Fields, Part 1 (Live)", listOf("Jean-Michel Jarre"), "The Concerts in China", 380_000)
        dst.catalogue += Track("long", "Magnetic Fields, Part 4 (Live) [Extended]", listOf("Jean-Michel Jarre"), "Remixes", 900_000)
        val r = sync(src, dst)
        assertTrue(dst.lists["t"]!!.map { it.id }.toString(), dst.lists["t"]!!.isEmpty())
        assertEquals(1, r.unmatchedTracks.size)
    }

    @Test fun aSongFoundByItsOwnTitleNeverAsksForOtherNames() {
        val src = MemoryService("msrc"); val dst = Library("mdst")
        src.lists["p"] = mutableListOf(Track("s1", "Oxygene, Pt. 4", listOf("Jean-Michel Jarre"), "Oxygène", 240_000, isrc = "FRZ118100004"))
        dst.catalogue += Track("d", "Oxygène, Part IV", listOf("Jean-Michel Jarre"), "Oxygène", 240_000)
        sync(src, dst)
        assertEquals(listOf("d"), dst.lists["t"]!!.map { it.id })
        assertTrue(hits.toString(), hits.none { "/work/" in it || "/recording/" in it })
    }
}
