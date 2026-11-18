package com.xlollx.songport.sync

import com.xlollx.songport.data.FileStore
import com.xlollx.songport.model.SyncJob
import com.xlollx.songport.model.SyncReport
import com.xlollx.songport.model.Track

/**
 * The records Track Sync reviews, read from the stores that syncs already use:
 *
 *  - matches in [FileStore]'s cache ("srcFamily:trackId>dstFamily" -> target id);
 *  - ignored tracks, both the global set and each sync's own list;
 *  - tracks the latest report still lists as not found (pending).
 *
 * Keys are normalised to service families because a match found through a bridge belongs to every
 * route of that service. Playlists are not part of the key: a match or an ignore applies to the
 * whole source -> destination route, so the screen shows it once per route instead of duplicating
 * it for every sync that uses the same two services.
 */
object TrackSync {

    /** A match or ignore key, split into the three parts the screen needs. */
    data class Key(
        val sourceProvider: String,
        val sourceTrackId: String,
        val destinationProvider: String,
        /** The exact key held in the store: an older key may use a connector id instead of a family. */
        val raw: String,
    ) {
        val identity: String get() = "$sourceProvider:$sourceTrackId>$destinationProvider"
        val canonical: String get() = FileStore.cacheKey(sourceProvider, sourceTrackId, destinationProvider)
    }

    enum class Status { MATCHED, IGNORED, PENDING }

    /** One row of the screen. Pending rows have no stored key yet: they live in the latest report. */
    data class Entry(
        val key: Key,
        val status: Status,
        val matchedTrackId: String? = null,
        /** Source metadata carried by a report, so a pending row can be shown without a request. */
        val sourceTrack: Track? = null,
        val matchedTrack: Track? = null,
        val reportId: String? = null,
        val jobId: String? = null,
    ) {
        val sourceProvider: String get() = key.sourceProvider
        val sourceTrackId: String get() = key.sourceTrackId
        val destinationProvider: String get() = key.destinationProvider

        /** Stable key for a lazy list; two reports naming the same source are folded into one row. */
        val rowKey: String get() = "${status.name}:${key.identity}:${matchedTrackId.orEmpty()}:${reportId.orEmpty()}"
    }

    /**
     * A source -> destination route and every record that belongs to it. [jobs] is empty for old
     * records whose sync no longer exists: they are historical data and must remain reachable.
     */
    data class Route(
        val id: String,
        val sourceProvider: String,
        val destinationProvider: String,
        val jobs: List<SyncJob>,
        val entries: List<Entry>,
    ) {
        val matched: List<Entry> get() = entries.filter { it.status == Status.MATCHED }
        val ignored: List<Entry> get() = entries.filter { it.status == Status.IGNORED }
        val pending: List<Entry> get() = entries.filter { it.status == Status.PENDING }
        val matchedCount: Int get() = matched.size
        val ignoredCount: Int get() = ignored.size
        val pendingCount: Int get() = pending.size
    }

    /** What a pasted link resolves to, before the user confirms it. */
    data class ResolvedLink(
        /** The service the link was copied from ("spotify", "youtube"...). */
        val sourceService: String,
        val sourceTrackId: String,
        /** The destination service family the link was translated to. */
        val destinationService: String,
        val destinationTrackId: String,
        /** Destination metadata when its catalogue could be read; null is valid (the id still is). */
        val track: Track? = null,
    ) {
        val converted: Boolean get() = !TrackLinks.matches(sourceService, destinationService)
        val url: String? get() = TrackLinks.url(destinationService, destinationTrackId)
    }

    /**
     * Splits "srcFamily:trackId>dstFamily" and normalises the services. Malformed keys are ignored:
     * the old screens left a few empty values in the cache, and they must not become rows.
     */
    fun parseKey(raw: String): Key? {
        val gt = raw.indexOf('>')
        if (gt <= 0 || gt == raw.lastIndex) return null
        val left = raw.substring(0, gt)
        val colon = left.indexOf(':')
        if (colon <= 0 || colon == left.lastIndex) return null
        val source = FileStore.family(left.substring(0, colon))
        val trackId = left.substring(colon + 1)
        val destination = FileStore.family(raw.substring(gt + 1))
        if (source.isBlank() || trackId.isBlank() || destination.isBlank()) return null
        return Key(source, trackId, destination, raw)
    }

    fun key(sourceProvider: String, sourceTrackId: String, destinationProvider: String): Key {
        val source = FileStore.family(sourceProvider)
        val destination = FileStore.family(destinationProvider)
        return Key(source, sourceTrackId, destination, FileStore.cacheKey(source, sourceTrackId, destination))
    }

    fun routeId(sourceProvider: String, destinationProvider: String): String =
        FileStore.family(sourceProvider) + ">" + FileStore.family(destinationProvider)

    /**
     * Builds every route from the current store. Records are grouped once by service pair; each
     * route is listed even when it has no records yet, so a freshly created sync is reachable and
     * can say it is empty. A match always wins over an ignore with the same identity: it is the
     * newer, user-visible relationship in the review screens.
     */
    fun buildRoutes(
        jobs: List<SyncJob>,
        matches: Map<String, String>,
        ignored: Set<String>,
        reports: List<SyncReport>,
    ): List<Route> {
        val jobsByRoute = LinkedHashMap<String, MutableList<SyncJob>>()
        jobs.forEach { job ->
            if (job.source.provider.isBlank() || job.target.provider.isBlank()) return@forEach
            val id = routeId(job.source.provider, job.target.provider)
            jobsByRoute.getOrPut(id) { mutableListOf() } += job
        }

        // A newer canonical key replaces an older key with a connector id. Empty values written by
        // the previous editor are not matches and are dropped here.
        val matchesByIdentity = LinkedHashMap<String, Entry>()
        matches.forEach { (raw, destinationTrackId) ->
            if (destinationTrackId.isBlank()) return@forEach
            val key = parseKey(raw) ?: return@forEach
            val entry = Entry(key, Status.MATCHED, matchedTrackId = destinationTrackId)
            val previous = matchesByIdentity[key.identity]
            if (previous == null || key.raw == key.canonical) matchesByIdentity[key.identity] = entry
        }

        val ignoredByIdentity = LinkedHashMap<String, Entry>()
        fun rememberIgnored(key: Key) {
            if (key.identity in matchesByIdentity) return
            val entry = Entry(key, Status.IGNORED)
            val previous = ignoredByIdentity[key.identity]
            if (previous == null || key.raw == key.canonical) ignoredByIdentity[key.identity] = entry
        }
        ignored.forEach { raw -> parseKey(raw)?.let(::rememberIgnored) }
        // The per-job list is written by the same "Ignore" action. Older stores can have it alone:
        // those tracks are still ignored by their sync and must be shown and restorable.
        jobs.forEach { job ->
            val source = FileStore.family(job.source.provider)
            val destination = FileStore.family(job.target.provider)
            job.ignoredSourceIds.forEach { id -> rememberIgnored(key(source, id, destination)) }
        }

        val entriesByRoute = LinkedHashMap<String, MutableList<Entry>>()
        (matchesByIdentity.values + ignoredByIdentity.values).forEach { entry ->
            val id = entry.key.sourceProvider + ">" + entry.key.destinationProvider
            entriesByRoute.getOrPut(id) { mutableListOf() } += entry
        }

        // Latest report per sync: pending is what the last run did not find. A partial report is the
        // current run's own list, so it is the most recent truth while a sync is still writing.
        val latestReports = reports.groupBy { it.jobId }.mapValues { (_, list) ->
            list.maxByOrNull { it.startedEpoch }
        }

        val routeIds = LinkedHashSet<String>().apply {
            addAll(jobsByRoute.keys)
            addAll(entriesByRoute.keys)
        }

        return routeIds.map { id ->
            val source = id.substringBefore('>')
            val destination = id.substringAfter('>', "")
            val routeJobs = jobsByRoute[id].orEmpty()
            if (source.isBlank() || destination.isBlank()) return@map null

            val stored = entriesByRoute[id].orEmpty()
            val pending = ArrayList<Entry>()
            val seenPending = HashSet<String>()
            routeJobs.forEach { job ->
                val report = latestReports[job.id] ?: return@forEach
                report.unmatchedTracks.forEach { track ->
                    val key = key(source, track.id, destination)
                    if (key.identity in matchesByIdentity || key.identity in ignoredByIdentity) return@forEach
                    if (!seenPending.add(key.identity)) return@forEach
                    pending += Entry(
                        key = key,
                        status = Status.PENDING,
                        sourceTrack = track,
                        reportId = report.id,
                        jobId = job.id,
                    )
                }
            }
            Route(
                id = id,
                sourceProvider = source,
                destinationProvider = destination,
                jobs = routeJobs,
                entries = stored + pending,
            )
        }.filterNotNull()
    }
}
