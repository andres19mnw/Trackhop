package com.xlollx.songport.ui

import com.xlollx.songport.model.PlaylistRef
import com.xlollx.songport.model.SyncJob
import com.xlollx.songport.model.SyncPlan
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** A kept preview is the sync's plan only until that sync runs: afterwards the lists are not the ones it read. */
class PreviewsTest {
    private val job = SyncJob(id = "j", name = "n", source = PlaylistRef("a", "1", "A"), target = PlaylistRef("b", "2", "B"))
    private val plan = SyncPlan("2", 1, 0, emptyList(), emptyList(), emptyList(), 0, emptyList(), emptyList(), emptyMap(), false)

    @Test fun aPlanMadeBeforeTheLastRunIsNotShownAgain() {
        val run = Previews.Run(job, plan = plan, at = 1_000)
        assertNotNull(Previews.of(run, job.copy(lastRunEpoch = 500)))
        assertNull(Previews.of(run, job.copy(lastRunEpoch = 2_000)))
        // One still being read is not a plan yet: it goes on.
        assertNotNull(Previews.of(Previews.Run(job, at = 1_000), job.copy(lastRunEpoch = 2_000)))
    }
}
