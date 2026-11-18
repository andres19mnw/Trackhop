@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.xlollx.songport.ui

import android.content.ClipboardManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.xlollx.songport.R
import com.xlollx.songport.data.FileStore
import com.xlollx.songport.data.Store
import com.xlollx.songport.model.PlaylistRef
import com.xlollx.songport.model.SyncJob
import com.xlollx.songport.model.TargetSearch
import com.xlollx.songport.model.Track
import com.xlollx.songport.providers.MusicProvider
import com.xlollx.songport.providers.Providers
import com.xlollx.songport.sync.Durations
import com.xlollx.songport.sync.SyncEngine
import com.xlollx.songport.sync.TrackSync
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.text.Normalizer
import java.util.Locale

private val DIACRITICS = Regex("\\p{M}+")

private enum class SyncFilter {
    ALL, MATCHED, IGNORED;

    fun accepts(status: TrackSync.Status): Boolean = when (this) {
        ALL -> true
        MATCHED -> status == TrackSync.Status.MATCHED
        IGNORED -> status == TrackSync.Status.IGNORED
    }
}

private enum class ConfirmKind { REMOVE, RESTORE }

private data class ConfirmState(val kind: ConfirmKind, val entry: TrackSync.Entry)

private data class MatchEditorState(val entry: TrackSync.Entry, val replacing: Boolean)

private data class TrackChoice(val trackId: String, val track: Track?)

/**
 * The global review of matched and ignored tracks, in Tools -> Your music.
 *
 * It reads the match cache, the ignore sets and the latest reports that syncs already write; no
 * data is duplicated. Records are grouped by source -> destination service pair because that is
 * how the stores relate them, and every sync that uses that pair is listed in the selector.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrackSyncScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val store = remember { Store.get(ctx) }
    val data by store.state.collectAsState()
    val engine = remember { SyncEngine(ctx) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val errorText = ctx.getString(R.string.error_generic)

    var selectedRoute by rememberSaveable { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(SyncFilter.ALL) }
    var refresh by remember { mutableStateOf(0) }
    var actionBusy by remember { mutableStateOf(false) }
    var editor by remember { mutableStateOf<MatchEditorState?>(null) }
    var confirm by remember { mutableStateOf<ConfirmState?>(null) }

    // Track metadata is requested once per id and kept for this visit: the stores only hold ids.
    val lookups = remember { mutableStateMapOf<String, Track?>() }
    var lookupLoading by remember { mutableStateOf(0) }
    var lookupFailures by remember { mutableStateOf(0) }

    // The source playlists' own order, read once per sync: the stores keep matches and ignores by
    // track id, never the place the track holds in the playlist.
    val sourceOrders = remember { mutableStateMapOf<String, List<String>>() }

    val built = remember(data.jobs, data.matchCache, data.ignoredTracks, data.reports, refresh) {
        runCatching { TrackSync.buildRoutes(data.jobs, data.matchCache, data.ignoredTracks, data.reports) }
    }
    val routes = built.getOrDefault(emptyList())
    val buildError = built.exceptionOrNull()
    val route = routes.firstOrNull { it.id == selectedRoute } ?: routes.firstOrNull()

    LaunchedEffect(routes, selectedRoute) {
        if (route == null) {
            selectedRoute = null
        } else if (route.id != selectedRoute) {
            selectedRoute = route.id
        }
    }

    fun keyOf(provider: String, trackId: String) = "$provider:$trackId"

    val lookupKeys = route?.entries.orEmpty().flatMap { entry ->
        buildList {
            if (entry.sourceTrack?.title.isNullOrBlank() && entry.sourceTrackId.isNotBlank()) {
                add(keyOf(entry.sourceProvider, entry.sourceTrackId))
            }
            if (entry.status == TrackSync.Status.MATCHED &&
                entry.matchedTrack?.title.isNullOrBlank() &&
                !entry.matchedTrackId.isNullOrBlank()
            ) {
                add(keyOf(entry.destinationProvider, entry.matchedTrackId!!))
            }
        }
    }.distinct()

    LaunchedEffect(route?.id, lookupKeys, refresh) {
        val missing = lookupKeys.filterNot { lookups.containsKey(it) }
        if (missing.isEmpty()) {
            lookupLoading = 0
            return@LaunchedEffect
        }
        lookupLoading = missing.size
        lookupFailures = 0
        try {
            // A few at a time: the services' search limits are not made for a burst of lookups.
            for (chunk in missing.chunked(4)) {
                val loaded = coroutineScope {
                    chunk.map { key ->
                        async {
                            val provider = key.substringBefore(':')
                            val id = key.substringAfter(':')
                            val track = try {
                                engine.lookupTrack(provider, id)
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                null
                            }
                            key to track
                        }
                    }.awaitAll()
                }
                loaded.forEach { (key, track) ->
                    lookups[key] = track
                    if (track == null) lookupFailures += 1
                }
                lookupLoading = (lookupLoading - chunk.size).coerceAtLeast(0)
            }
        } finally {
            lookupLoading = 0
        }
    }

    LaunchedEffect(route?.id, route?.jobs, refresh) {
        val jobs = route?.jobs.orEmpty().filter { !it.source.playlistId.isNullOrBlank() }
        jobs.filterNot { sourceOrders.containsKey(it.id) }.forEach { job ->
            sourceOrders[job.id] = engine.sourceTrackOrder(job)
        }
    }

    fun sourceOf(entry: TrackSync.Entry): Track? =
        entry.sourceTrack?.takeIf { it.title.isNotBlank() }
            ?: lookups[keyOf(entry.sourceProvider, entry.sourceTrackId)]

    fun matchOf(entry: TrackSync.Entry): Track? =
        entry.matchedTrack?.takeIf { it.title.isNotBlank() }
            ?: entry.matchedTrackId?.let { lookups[keyOf(entry.destinationProvider, it)] }

    fun sourceLoading(entry: TrackSync.Entry): Boolean =
        entry.sourceTrack?.title.isNullOrBlank() &&
            entry.sourceTrackId.isNotBlank() &&
            !lookups.containsKey(keyOf(entry.sourceProvider, entry.sourceTrackId))

    fun matchLoading(entry: TrackSync.Entry): Boolean =
        entry.status == TrackSync.Status.MATCHED &&
            entry.matchedTrack?.title.isNullOrBlank() &&
            !entry.matchedTrackId.isNullOrBlank() &&
            !lookups.containsKey(keyOf(entry.destinationProvider, entry.matchedTrackId!!))

    fun reload() {
        lookups.clear()
        sourceOrders.clear()
        lookupFailures = 0
        refresh += 1
    }

    fun saveChoice(entry: TrackSync.Entry, choice: TrackChoice) {
        if (actionBusy) return
        actionBusy = true
        scope.launch {
            try {
                val wasIgnored = entry.status == TrackSync.Status.IGNORED
                engine.assignMatch(
                    sourceProvider = entry.sourceProvider,
                    sourceTrackId = entry.sourceTrackId,
                    destinationProvider = entry.destinationProvider,
                    destinationTrackId = choice.trackId,
                    restoreIgnored = wasIgnored,
                )
                choice.track?.takeIf { it.title.isNotBlank() }?.let {
                    lookups[keyOf(entry.destinationProvider, choice.trackId)] = it
                }
                editor = null
                snackbar.showSnackbar(
                    ctx.getString(if (wasIgnored) R.string.track_sync_assign_done else R.string.track_sync_saved),
                )
                refresh += 1
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                snackbar.showSnackbar(e.message ?: errorText)
            } finally {
                actionBusy = false
            }
        }
    }

    fun applyConfirmation(state: ConfirmState) {
        if (actionBusy) return
        actionBusy = true
        scope.launch {
            try {
                when (state.kind) {
                    ConfirmKind.REMOVE -> engine.removeMatch(
                        state.entry.sourceProvider, state.entry.sourceTrackId, state.entry.destinationProvider,
                    )
                    ConfirmKind.RESTORE -> engine.restoreIgnored(
                        state.entry.sourceProvider, state.entry.sourceTrackId, state.entry.destinationProvider,
                    )
                }
                confirm = null
                snackbar.showSnackbar(
                    ctx.getString(
                        if (state.kind == ConfirmKind.REMOVE) R.string.track_sync_removed else R.string.track_sync_restored,
                    ),
                )
                refresh += 1
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                snackbar.showSnackbar(e.message ?: errorText)
            } finally {
                actionBusy = false
            }
        }
    }

    // The source playlist's own order, numbered as it numbers its tracks: a filter narrows the
    // list but does not renumber it, so a row keeps the place the playlist gives it.
    val rows = TrackSync.rows(
        entries = route?.entries.orEmpty()
            .filter { entry -> filter.accepts(entry.status) && entry.matches(query, sourceOf(entry), matchOf(entry)) },
        sourceOrders = route?.jobs.orEmpty().map { sourceOrders[it.id].orEmpty() },
    )

    ScreenBackHandler(onClose)

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar, Modifier.padding(bottom = LocalBottomBarInset.current)) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.track_sync_title)) },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.nav_back))
                    }
                },
                actions = {
                    IconButton(onClick = { reload() }) {
                        Icon(Icons.Filled.Refresh, stringResource(R.string.track_sync_refresh))
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp + LocalBottomBarInset.current),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    when {
                        buildError != null -> ErrorPanel(
                            body = buildError.message ?: stringResource(R.string.track_sync_error_body),
                            onRetry = { reload() },
                        )
                        routes.isEmpty() -> EmptyPanel(
                            title = stringResource(R.string.track_sync_empty_title),
                            body = stringResource(R.string.track_sync_empty_body),
                        )
                        route != null -> {
                            RouteHeader(
                                route = route,
                                routes = routes,
                                onSelect = { selectedRoute = it },
                            )
                            SummaryRow(route)
                            SearchAndFilters(
                                query = query,
                                onQuery = { query = it },
                                filter = filter,
                                onFilter = { filter = it },
                                total = route.entries.size,
                                matched = route.matchedCount,
                                ignored = route.ignoredCount,
                            )
                        }
                    }
                }
            }

            if (route != null && buildError == null) {
                if (lookupLoading > 0) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                            Text(
                                stringResource(R.string.track_sync_loading),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                if (lookupFailures > 0) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                            Icon(
                                Icons.Filled.ErrorOutline, null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                stringResource(R.string.track_sync_partial_error),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.weight(1f),
                            )
                            TextButton(onClick = { reload() }) { Text(stringResource(R.string.track_sync_retry)) }
                        }
                    }
                }
                if (route.entries.isEmpty()) {
                    item {
                        EmptyPanel(
                            title = stringResource(R.string.track_sync_empty_route_title),
                            body = stringResource(R.string.track_sync_empty_route_body),
                            compact = true,
                        )
                    }
                } else if (rows.isEmpty()) {
                    item {
                        EmptyPanel(
                            title = stringResource(R.string.track_sync_no_results_title),
                            body = stringResource(R.string.track_sync_no_results_body),
                            compact = true,
                        )
                    }
                } else {
                    items(rows, key = { it.entry.rowKey }) { row ->
                        EntryCard(
                            entry = row.entry,
                            position = row.position,
                            route = route,
                            source = sourceOf(row.entry),
                            match = matchOf(row.entry),
                            sourceLoading = sourceLoading(row.entry),
                            matchLoading = matchLoading(row.entry),
                            busy = actionBusy,
                            onReplace = { editor = MatchEditorState(row.entry, replacing = true) },
                            onAssign = { editor = MatchEditorState(row.entry, replacing = false) },
                            onRemove = { confirm = ConfirmState(ConfirmKind.REMOVE, row.entry) },
                            onRestore = { confirm = ConfirmState(ConfirmKind.RESTORE, row.entry) },
                        )
                    }
                }
            }
        }
    }

    editor?.let { state ->
        MatchEditorDialog(
            state = state,
            route = route ?: return@let,
            sourceTrack = sourceOf(state.entry),
            busy = actionBusy,
            onDismiss = { if (!actionBusy) editor = null },
            onSave = { choice -> saveChoice(state.entry, choice) },
        )
    }

    confirm?.let { state ->
        ConfirmDialog(
            state = state,
            route = route,
            sourceTrack = route?.let { sourceOf(state.entry) },
            busy = actionBusy,
            onDismiss = { if (!actionBusy) confirm = null },
            onConfirm = { applyConfirmation(state) },
        )
    }
}

/* ------------------------------------------------------------------ selector and summary */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RouteHeader(route: TrackSync.Route, routes: List<TrackSync.Route>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                OutlinedTextField(
                    value = routeTitle(route),
                    onValueChange = {},
                    readOnly = true,
                    label = { Text(stringResource(R.string.track_sync_selector_label)) },
                    placeholder = { Text(stringResource(R.string.track_sync_selector_hint)) },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                    modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
                )
                ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    routes.forEach { item ->
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(routeTitle(item), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(
                                        routeServices(item),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            },
                            onClick = {
                                expanded = false
                                onSelect(item.id)
                            },
                        )
                    }
                }
            }
            Text(
                routeServices(route),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (route.jobs.size > 1) {
                Text(
                    stringResource(R.string.track_sync_shared_by, route.jobs.size),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (route.jobs.isEmpty()) {
                Text(
                    stringResource(R.string.track_sync_unlinked_title),
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    stringResource(R.string.track_sync_unlinked_body),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun SummaryRow(route: TrackSync.Route) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        SummaryTile(
            label = stringResource(R.string.track_sync_summary_matched),
            count = route.matchedCount,
            icon = Icons.Filled.CheckCircle,
            container = Tones.successContainer(),
            content = Tones.onSuccessContainer(),
            modifier = Modifier.weight(1f),
        )
        SummaryTile(
            label = stringResource(R.string.track_sync_summary_ignored),
            count = route.ignoredCount,
            icon = Icons.Filled.VisibilityOff,
            container = MaterialTheme.colorScheme.tertiaryContainer,
            content = MaterialTheme.colorScheme.onTertiaryContainer,
            modifier = Modifier.weight(1f),
        )
        SummaryTile(
            label = stringResource(R.string.track_sync_summary_pending),
            count = route.pendingCount,
            icon = Icons.Filled.Schedule,
            container = MaterialTheme.colorScheme.secondaryContainer,
            content = MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun SummaryTile(
    label: String,
    count: Int,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    container: Color,
    content: Color,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = container),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = content, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text(
                    label,
                    style = MaterialTheme.typography.labelMedium,
                    color = content,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                count.toString(),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = content,
            )
        }
    }
}

@Composable
private fun SearchAndFilters(
    query: String,
    onQuery: (String) -> Unit,
    filter: SyncFilter,
    onFilter: (SyncFilter) -> Unit,
    total: Int,
    matched: Int,
    ignored: Int,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = onQuery,
            singleLine = true,
            label = { Text(stringResource(R.string.track_sync_search_hint)) },
            leadingIcon = { Icon(Icons.Filled.Search, null) },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = { onQuery("") }) {
                        Icon(Icons.Filled.Close, stringResource(R.string.track_sync_search_clear))
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = filter == SyncFilter.ALL,
                onClick = { onFilter(SyncFilter.ALL) },
                label = { Text("${stringResource(R.string.track_sync_filter_all)} ($total)") },
            )
            FilterChip(
                selected = filter == SyncFilter.MATCHED,
                onClick = { onFilter(SyncFilter.MATCHED) },
                label = { Text("${stringResource(R.string.track_sync_filter_matched)} ($matched)") },
            )
            FilterChip(
                selected = filter == SyncFilter.IGNORED,
                onClick = { onFilter(SyncFilter.IGNORED) },
                label = { Text("${stringResource(R.string.track_sync_filter_ignored)} ($ignored)") },
            )
        }
    }
}

/* ------------------------------------------------------------------ rows */

@Composable
private fun EntryCard(
    entry: TrackSync.Entry,
    position: Int?,
    route: TrackSync.Route,
    source: Track?,
    match: Track?,
    sourceLoading: Boolean,
    matchLoading: Boolean,
    busy: Boolean,
    onReplace: () -> Unit,
    onAssign: () -> Unit,
    onRemove: () -> Unit,
    onRestore: () -> Unit,
) {
    val destinationName = serviceName(route.destinationProvider)
    val accent = when (entry.status) {
        TrackSync.Status.MATCHED -> MaterialTheme.colorScheme.primary
        TrackSync.Status.IGNORED -> MaterialTheme.colorScheme.tertiary
        TrackSync.Status.PENDING -> MaterialTheme.colorScheme.secondary
    }
    // A pending row comes from one report: name the playlist of that sync. Matches and ignores are
    // shared by the whole route, so they list every sync that uses it.
    val entryJob = entry.jobId?.let { id -> route.jobs.firstOrNull { it.id == id } }
    val sourcePlaylists = entryJob?.let(::sourcePlaylistName) ?: sourcePlaylistNames(route)
    val targetPlaylists = entryJob?.let(::targetPlaylistName) ?: targetPlaylistNames(route)

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(4.dp).background(accent))
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // The place the track holds in the source playlist, as the playlist shows it.
                    if (position != null) {
                        Text(
                            "$position.",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = accent,
                            modifier = Modifier.widthIn(min = 24.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                    StatusPill(
                        text = stringResource(statusLabel(entry.status)),
                        tone = statusTone(entry.status),
                        icon = statusIcon(entry.status),
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        sourcePlaylists.ifBlank { stringResource(R.string.track_sync_source) },
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val stacked = maxWidth < 420.dp
                    if (stacked) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            TrackBlock(
                                label = stringResource(R.string.track_sync_source),
                                providerId = entry.sourceProvider,
                                track = source,
                                fallbackId = entry.sourceTrackId,
                                loading = sourceLoading,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Icon(
                                Icons.Filled.ArrowDownward, null,
                                modifier = Modifier.align(Alignment.CenterHorizontally).size(20.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            MatchBlock(
                                entry = entry,
                                destinationName = destinationName,
                                match = match,
                                loading = matchLoading,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    } else {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TrackBlock(
                                label = stringResource(R.string.track_sync_source),
                                providerId = entry.sourceProvider,
                                track = source,
                                fallbackId = entry.sourceTrackId,
                                loading = sourceLoading,
                                modifier = Modifier.weight(1f),
                            )
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowForward, null,
                                modifier = Modifier.padding(horizontal = 12.dp).size(20.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            MatchBlock(
                                entry = entry,
                                destinationName = destinationName,
                                match = match,
                                loading = matchLoading,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }

                val playlistLine = when {
                    sourcePlaylists.isNotBlank() && targetPlaylists.isNotBlank() ->
                        stringResource(R.string.track_sync_playlists, sourcePlaylists, targetPlaylists)
                    sourcePlaylists.isNotBlank() -> stringResource(R.string.track_sync_source_playlist, sourcePlaylists)
                    targetPlaylists.isNotBlank() -> stringResource(R.string.track_sync_target_playlist, targetPlaylists)
                    else -> ""
                }
                if (playlistLine.isNotBlank()) {
                    Text(
                        playlistLine,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                when (entry.status) {
                    TrackSync.Status.IGNORED -> Text(
                        stringResource(R.string.track_sync_ignored_reason, destinationName),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TrackSync.Status.PENDING -> Text(
                        stringResource(R.string.track_sync_pending_reason),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TrackSync.Status.MATCHED -> Unit
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    when (entry.status) {
                        TrackSync.Status.MATCHED -> {
                            TextButton(enabled = !busy, onClick = onReplace) {
                                Icon(Icons.Filled.SwapHoriz, null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.track_sync_action_replace))
                            }
                            TextButton(
                                enabled = !busy,
                                onClick = onRemove,
                                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                            ) {
                                Icon(Icons.Filled.DeleteOutline, null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.track_sync_action_remove))
                            }
                        }
                        TrackSync.Status.IGNORED -> {
                            Button(enabled = !busy, onClick = onAssign) {
                                Icon(Icons.Filled.Link, null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.track_sync_action_assign))
                            }
                            TextButton(enabled = !busy, onClick = onRestore) {
                                Icon(Icons.Filled.Restore, null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.track_sync_action_restore))
                            }
                        }
                        TrackSync.Status.PENDING -> TextButton(enabled = !busy, onClick = onAssign) {
                            Icon(Icons.Filled.Link, null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.track_sync_action_assign))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TrackBlock(
    label: String,
    providerId: String,
    track: Track?,
    fallbackId: String,
    loading: Boolean,
    modifier: Modifier = Modifier,
) {
    val provider = providerForFamily(providerId)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            ServiceLogo(provider, 18.dp)
            Spacer(Modifier.width(6.dp))
            Text(
                provider?.displayName ?: providerId,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        when {
            track != null && track.title.isNotBlank() -> {
                Text(
                    track.title,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                val details = listOfNotNull(
                    track.artistLine.trim().ifBlank { null },
                    track.album.trim().ifBlank { null },
                    Durations.format(track.durationMs).ifBlank { null },
                ).joinToString(" · ")
                if (details.isNotBlank()) {
                    Text(
                        details,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            loading -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(6.dp))
                Text(
                    stringResource(R.string.track_sync_loading),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else -> {
                Text(
                    stringResource(R.string.track_sync_track_details_unavailable),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (fallbackId.isNotBlank()) {
                    Text(
                        stringResource(R.string.track_sync_track_id, fallbackId),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun MatchBlock(
    entry: TrackSync.Entry,
    destinationName: String,
    match: Track?,
    loading: Boolean,
    modifier: Modifier = Modifier,
) {
    if (entry.status == TrackSync.Status.MATCHED) {
        TrackBlock(
            label = stringResource(R.string.track_sync_match),
            providerId = entry.destinationProvider,
            track = match,
            fallbackId = entry.matchedTrackId.orEmpty(),
            loading = loading,
            modifier = modifier,
        )
    } else {
        val provider = providerForFamily(entry.destinationProvider)
        Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                stringResource(R.string.track_sync_match),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                ServiceLogo(provider, 18.dp)
                Spacer(Modifier.width(6.dp))
                Text(
                    provider?.displayName ?: destinationName,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                stringResource(R.string.track_sync_no_match),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/* ------------------------------------------------------------------ match editor */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MatchEditorDialog(
    state: MatchEditorState,
    route: TrackSync.Route,
    sourceTrack: Track?,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (TrackChoice) -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val engine = remember { SyncEngine(ctx) }
    val destinationName = serviceName(route.destinationProvider)
    val errorText = ctx.getString(R.string.error_generic)
    val job = remember(route.id, route.jobs) { jobForRoute(engine, route) }

    var tab by remember { mutableStateOf(0) }
    var link by remember { mutableStateOf("") }
    var resolving by remember { mutableStateOf(false) }
    var resolution by remember { mutableStateOf<TrackSync.ResolvedLink?>(null) }
    var linkError by remember { mutableStateOf<String?>(null) }

    val initialQuery = remember(state.entry.key.identity, sourceTrack?.title) {
        sourceTrack?.let { track ->
            listOf(track.artistLine, track.title).filter { it.isNotBlank() }.joinToString(" - ")
        }.orEmpty()
    }
    var searchQuery by remember(initialQuery) { mutableStateOf(initialQuery) }
    var searching by remember { mutableStateOf(false) }
    var searchResult by remember { mutableStateOf<TargetSearch?>(null) }
    var searchError by remember { mutableStateOf<String?>(null) }
    var searchChoice by remember { mutableStateOf<Track?>(null) }

    val choice: TrackChoice? = if (tab == 0) {
        resolution?.let { TrackChoice(it.destinationTrackId, it.track) }
    } else {
        searchChoice?.let { TrackChoice(it.id, it) }
    }

    fun pasteLink() {
        val clip = ctx.getSystemService(ClipboardManager::class.java)?.primaryClip
        val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString().orEmpty()
        val url = Regex("""https?://\S+""").find(text)?.value
        if (url == null) {
            linkError = ctx.getString(R.string.search_clipboard_empty)
        } else {
            link = url
            resolution = null
            linkError = null
        }
    }

    fun validateLink() {
        if (link.isBlank() || resolving) return
        resolving = true
        linkError = null
        resolution = null
        scope.launch {
            try {
                resolution = engine.resolveTrackLink(route.destinationProvider, link)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                linkError = e.message ?: errorText
            } finally {
                resolving = false
            }
        }
    }

    fun search() {
        val q = searchQuery.trim()
        if (q.isBlank() || searching) return
        searching = true
        searchError = null
        searchChoice = null
        scope.launch {
            try {
                searchResult = engine.searchOnTarget(job, q, sourceTrack)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                searchResult = null
                searchError = e.message ?: errorText
            } finally {
                searching = false
            }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = {
            Text(
                stringResource(
                    if (state.replacing) R.string.track_sync_editor_replace_title else R.string.track_sync_editor_assign_title,
                ),
            )
        },
        text = {
            Column(
                Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    stringResource(R.string.track_sync_editor_intro, destinationName),
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (sourceTrack != null) {
                    TrackLine(sourceTrack, Modifier.fillMaxWidth(), emphasis = true)
                } else {
                    Text(
                        stringResource(R.string.track_sync_track_id, state.entry.sourceTrackId),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = tab == 0,
                        onClick = { tab = 0 },
                        label = { Text(stringResource(R.string.track_sync_editor_link_tab)) },
                    )
                    FilterChip(
                        selected = tab == 1,
                        onClick = { tab = 1 },
                        label = { Text(stringResource(R.string.track_sync_editor_search_tab)) },
                    )
                }

                if (tab == 0) {
                    OutlinedTextField(
                        value = link,
                        onValueChange = {
                            link = it
                            resolution = null
                            linkError = null
                        },
                        singleLine = true,
                        enabled = !resolving && !busy,
                        label = { Text(stringResource(R.string.track_sync_editor_link_label)) },
                        supportingText = { Text(stringResource(R.string.track_sync_editor_link_help, destinationName)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(enabled = !resolving && !busy, onClick = ::pasteLink) {
                            Icon(Icons.Filled.ContentPaste, null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.track_sync_editor_paste))
                        }
                        Spacer(Modifier.weight(1f))
                        Button(
                            enabled = link.isNotBlank() && !resolving && !busy,
                            onClick = ::validateLink,
                        ) {
                            if (resolving) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                            }
                            Text(stringResource(R.string.track_sync_editor_validate))
                        }
                    }
                    linkError?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                    resolution?.let { resolved ->
                        LinkPreview(
                            resolution = resolved,
                            destinationName = destinationName,
                        )
                    }
                } else {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = {
                            searchQuery = it
                            searchChoice = null
                            searchResult = null
                            searchError = null
                        },
                        singleLine = true,
                        enabled = !searching && !busy,
                        label = { Text(stringResource(R.string.track_sync_editor_search_label, destinationName)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Spacer(Modifier.weight(1f))
                        Button(
                            enabled = searchQuery.isNotBlank() && !searching && !busy,
                            onClick = ::search,
                        ) {
                            if (searching) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                            }
                            Text(stringResource(R.string.unmatched_search))
                        }
                    }
                    searchError?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                    val result = searchResult
                    if (result != null) {
                        if (result.hits.isEmpty()) {
                            Text(
                                stringResource(R.string.unmatched_no_results),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            result.hits.take(10).forEach { hit ->
                                val selected = searchChoice?.id == hit.track.id
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .selectable(
                                            selected = selected,
                                            role = Role.RadioButton,
                                            onClick = { searchChoice = hit.track },
                                        )
                                        .padding(vertical = 4.dp),
                                ) {
                                    RadioButton(selected = selected, onClick = null)
                                    Spacer(Modifier.width(6.dp))
                                    TrackLine(hit.track, Modifier.weight(1f))
                                }
                            }
                        }
                    }
                    searchChoice?.let {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    stringResource(R.string.track_sync_editor_preview),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                                )
                                TrackLine(it)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                enabled = choice != null && !busy && !resolving && !searching,
                onClick = { choice?.let(onSave) },
            ) {
                Text(stringResource(R.string.track_sync_editor_save))
            }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        },
    )
}

@Composable
private fun LinkPreview(resolution: TrackSync.ResolvedLink, destinationName: String) {
    val provider = providerForFamily(resolution.destinationService)
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                stringResource(R.string.track_sync_editor_preview),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                ServiceLogo(provider, 20.dp)
                Spacer(Modifier.width(8.dp))
                Text(
                    provider?.displayName ?: destinationName,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            val track = resolution.track
            if (track != null && track.title.isNotBlank()) {
                TrackLine(track)
            } else {
                Text(
                    stringResource(R.string.track_sync_link_unreadable),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                Text(
                    stringResource(R.string.track_sync_track_id, resolution.destinationTrackId),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            Text(
                stringResource(
                    if (resolution.converted) R.string.track_sync_link_converted else R.string.track_sync_link_valid,
                    destinationName,
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
        }
    }
}

/* ------------------------------------------------------------------ confirmation */

@Composable
private fun ConfirmDialog(
    state: ConfirmState,
    route: TrackSync.Route?,
    sourceTrack: Track?,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    val destinationName = serviceName(route?.destinationProvider ?: state.entry.destinationProvider)
    val title = sourceTrack?.takeIf { it.title.isNotBlank() }?.title ?: state.entry.sourceTrackId
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = {
            Text(
                stringResource(
                    if (state.kind == ConfirmKind.REMOVE) R.string.track_sync_remove_title else R.string.track_sync_restore_title,
                ),
            )
        },
        text = {
            Text(
                stringResource(
                    if (state.kind == ConfirmKind.REMOVE) R.string.track_sync_remove_body else R.string.track_sync_restore_body,
                    title,
                    destinationName,
                ),
            )
        },
        confirmButton = {
            TextButton(
                enabled = !busy,
                onClick = onConfirm,
                colors = ButtonDefaults.textButtonColors(
                    contentColor = if (state.kind == ConfirmKind.REMOVE) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                ),
            ) {
                Text(
                    stringResource(
                        if (state.kind == ConfirmKind.REMOVE) R.string.track_sync_remove_confirm else R.string.track_sync_restore_confirm,
                    ),
                )
            }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
    )
}

/* ------------------------------------------------------------------ empty and error panels */

@Composable
private fun EmptyPanel(title: String, body: String, compact: Boolean = false) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(if (compact) 20.dp else 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                Modifier.size(if (compact) 48.dp else 72.dp)
                    .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(50)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (compact) Icons.Filled.Search else Icons.Filled.SwapHoriz,
                    null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(if (compact) 24.dp else 34.dp),
                )
            }
            Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            Text(
                body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun ErrorPanel(body: String, onRetry: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.ErrorOutline, null, tint = MaterialTheme.colorScheme.onErrorContainer)
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.track_sync_error_title),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
            Text(
                body.ifBlank { stringResource(R.string.track_sync_error_body) },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            TextButton(onClick = onRetry) { Text(stringResource(R.string.track_sync_retry)) }
        }
    }
}

/* ------------------------------------------------------------------ small helpers */

private fun TrackSync.Entry.matches(query: String, source: Track?, match: Track?): Boolean {
    val needle = foldText(query)
    if (needle.isBlank()) return true
    return sequenceOf(
        key.sourceTrackId,
        key.destinationProvider,
        matchedTrackId.orEmpty(),
        source?.title,
        source?.artistLine,
        source?.album,
        match?.title,
        match?.artistLine,
        match?.album,
    ).filterNotNull().any { foldText(it).contains(needle) }
}

private fun foldText(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFD)
        .replace(DIACRITICS, "")
        .lowercase(Locale.ROOT)
        .trim()

private fun providerForFamily(service: String): MusicProvider? {
    val family = FileStore.family(service)
    val candidates = Providers.all().filter { FileStore.family(it.serviceId) == family }
    return candidates.firstOrNull { it.slot.isEmpty() } ?: candidates.firstOrNull()
}

@Composable
private fun serviceName(service: String): String =
    providerForFamily(service)?.displayName ?: FileStore.family(service)

private fun routeTitle(route: TrackSync.Route): String {
    val source = sourcePlaylistNames(route)
    val target = targetPlaylistNames(route)
    return when {
        source.isNotBlank() && target.isNotBlank() -> "$source → $target"
        source.isNotBlank() -> source
        target.isNotBlank() -> target
        route.jobs.isNotEmpty() -> route.jobs.joinToString(" · ") { it.name }
        else -> routeServices(route)
    }
}

private fun routeServices(route: TrackSync.Route): String {
    val source = providerForFamily(route.sourceProvider)?.displayName ?: route.sourceProvider
    val destination = providerForFamily(route.destinationProvider)?.displayName ?: route.destinationProvider
    return "$source → $destination"
}

private fun sourcePlaylistName(job: SyncJob): String =
    job.source.playlistName.ifBlank { job.source.playlistId.orEmpty() }

private fun targetPlaylistName(job: SyncJob): String =
    job.target.playlistName.ifBlank { job.target.playlistId.orEmpty() }

private fun sourcePlaylistNames(route: TrackSync.Route): String =
    route.jobs.map(::sourcePlaylistName).filter { it.isNotBlank() }.distinct().joinToString(", ")

private fun targetPlaylistNames(route: TrackSync.Route): String =
    route.jobs.map(::targetPlaylistName).filter { it.isNotBlank() }.distinct().joinToString(", ")

/**
 * The job an editor action searches with. Providers are not taken from the family's first
 * connector: that can be the official route (Spotify's API needs its own login and Premium) while
 * the syncs use the web bridge. [SyncEngine.connectorForReview] picks the session the syncs have.
 */
private fun jobForRoute(engine: SyncEngine, route: TrackSync.Route): SyncJob {
    val sourceId = engine.connectorForReview(route.sourceProvider, route.jobs)?.id
        ?: providerForFamily(route.sourceProvider)?.id
        ?: route.sourceProvider
    val destinationId = engine.connectorForReview(route.destinationProvider, route.jobs, target = true)?.id
        ?: providerForFamily(route.destinationProvider)?.id
        ?: route.destinationProvider
    val base = route.jobs.firstOrNull() ?: SyncJob(
        id = "track-sync:" + route.id,
        name = "Track Sync",
        source = PlaylistRef(provider = sourceId),
        target = PlaylistRef(provider = destinationId),
    )
    return base.copy(
        source = base.source.copy(provider = sourceId),
        target = base.target.copy(provider = destinationId),
    )
}

private fun statusLabel(status: TrackSync.Status): Int = when (status) {
    TrackSync.Status.MATCHED -> R.string.track_sync_status_matched
    TrackSync.Status.IGNORED -> R.string.track_sync_status_ignored
    TrackSync.Status.PENDING -> R.string.track_sync_status_pending
}

private fun statusTone(status: TrackSync.Status): Tone = when (status) {
    TrackSync.Status.MATCHED -> Tone.Ok
    TrackSync.Status.IGNORED -> Tone.Warning
    TrackSync.Status.PENDING -> Tone.Accent
}

private fun statusIcon(status: TrackSync.Status): androidx.compose.ui.graphics.vector.ImageVector = when (status) {
    TrackSync.Status.MATCHED -> Icons.Filled.CheckCircle
    TrackSync.Status.IGNORED -> Icons.Filled.VisibilityOff
    TrackSync.Status.PENDING -> Icons.Filled.Schedule
}
