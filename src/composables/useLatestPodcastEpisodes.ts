/**
 * useLatestPodcastEpisodes
 *
 * Stateful orchestration for the "latest podcast episodes" page. It fetches
 * every podcast in the library, then fans out to each podcast's episode feed
 * with bounded concurrency, tolerating individual feed failures. The pure
 * merge/sort/cap logic lives in `@/helpers/podcast_latest`; the bounded
 * concurrency primitive lives in `@/helpers/concurrency`.
 */
import { computed, ref } from "vue";
import { toast } from "vue-sonner";
import { api } from "@/plugins/api";
import { store } from "@/plugins/store";
import { $t } from "@/plugins/i18n";
import type { Podcast, PodcastEpisode } from "@/plugins/api/interfaces";
import { mapWithConcurrency } from "@/helpers/concurrency";
import {
  buildLatestEpisodes,
  DEFAULT_CANDIDATES_PER_PODCAST,
  MAX_LATEST_EPISODES,
  takeNewestCandidates,
} from "@/helpers/podcast_latest";

/** Maximum podcast feeds fetched in parallel. */
export const MAX_CONCURRENT_FEEDS = 4;

/** Page size used when paging through the library podcasts endpoint. */
const LIBRARY_PODCASTS_PAGE_SIZE = 500;
const FEED_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedFeed {
  updatedAt: number;
  episodes: PodcastEpisode[];
}

export interface UseLatestPodcastEpisodesOptions {
  candidatesPerPodcast?: number;
  maxResults?: number;
}

export interface LoadProgress {
  loaded: number;
  total: number;
}

export function useLatestPodcastEpisodes(
  options: UseLatestPodcastEpisodesOptions = {},
) {
  const candidatesPerPodcast =
    options.candidatesPerPodcast ?? DEFAULT_CANDIDATES_PER_PODCAST;
  const maxResults = options.maxResults ?? MAX_LATEST_EPISODES;

  // Tab-local, scoped to server/user: survives route remounts and page reloads.
  // Upstream exposes full feeds, not a since/cursor/conditional delta endpoint.
  const cacheKey = JSON.stringify([
    "latest-podcast-feeds-v1",
    api.serverInfo.value?.server_id,
    store.currentUser?.user_id,
    candidatesPerPodcast,
  ]);
  let feeds: Record<string, CachedFeed> = {};
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) ?? "{}");
    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      for (const [key, feed] of Object.entries(cached)) {
        const entry = feed as CachedFeed;
        if (
          entry &&
          typeof entry.updatedAt === "number" &&
          Array.isArray(entry.episodes) &&
          entry.episodes.every(
            (episode) =>
              episode &&
              typeof episode.uri === "string" &&
              typeof episode.name === "string",
          )
        ) {
          feeds[key] = entry;
        }
      }
    }
  } catch {
    /* Storage may be unavailable or corrupt; fetching still works. */
  }
  const episodes = ref<PodcastEpisode[]>([]);
  const publish = () => {
    episodes.value = buildLatestEpisodes(
      Object.values(feeds).map((feed) => feed.episodes),
      {
        candidatesPerPodcast,
        maxResults,
      },
    );
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(feeds));
    } catch {
      /* A full/disabled cache must not break the listing. */
    }
  };
  publish();
  const isLoading = ref(false);
  const hasLoadedOnce = ref(false);
  const loadFailed = ref(false);
  const failedFeedCount = ref(0);
  const loadedFeedCount = ref(0);
  const totalFeedCount = ref(0);

  const progress = computed<LoadProgress>(() => ({
    loaded: loadedFeedCount.value,
    total: totalFeedCount.value,
  }));

  // A single meaningful partial-failure state: some feeds failed but we still
  // produced a usable listing from the ones that succeeded.
  const hasPartialFailure = computed(
    () => !loadFailed.value && failedFeedCount.value > 0,
  );

  const loadAllLibraryPodcasts = async (): Promise<Podcast[]> => {
    const collected: Podcast[] = [];
    let offset = 0;
    // Page until a short page signals the end of the library.
    for (;;) {
      const page = await api.getLibraryPodcasts(
        undefined,
        undefined,
        LIBRARY_PODCASTS_PAGE_SIZE,
        offset,
      );
      collected.push(...page);
      if (page.length < LIBRARY_PODCASTS_PAGE_SIZE) break;
      offset += LIBRARY_PODCASTS_PAGE_SIZE;
    }
    return collected;
  };

  /**
   * Load (or reload) the latest episodes. Concurrent invocations are ignored so
   * a manual refresh cannot trigger overlapping loads.
   *
   * @param isManualRefresh when true, a success toast confirms the refresh.
   */
  const load = async (isManualRefresh = false): Promise<void> => {
    if (isLoading.value) return;
    isLoading.value = true;
    loadFailed.value = false;
    failedFeedCount.value = 0;
    loadedFeedCount.value = 0;
    totalFeedCount.value = 0;

    try {
      const podcasts = await loadAllLibraryPodcasts();
      totalFeedCount.value = podcasts.length;
      const feedKey = (podcast: Podcast) =>
        JSON.stringify([podcast.provider, podcast.item_id]);
      const libraryKeys = new Set(podcasts.map(feedKey));
      feeds = Object.fromEntries(
        Object.entries(feeds).filter(([key]) => libraryKeys.has(key)),
      );
      publish();
      const pending = podcasts.filter((podcast) => {
        const cached = feeds[feedKey(podcast)];
        return (
          isManualRefresh ||
          !cached ||
          Date.now() - cached.updatedAt >= FEED_CACHE_TTL_MS
        );
      });
      loadedFeedCount.value = podcasts.length - pending.length;

      const settledFeeds = await mapWithConcurrency(
        pending,
        MAX_CONCURRENT_FEEDS,
        (podcast) => api.getPodcastEpisodes(podcast.item_id, podcast.provider),
        (feed, index) => {
          loadedFeedCount.value += 1;
          if (feed.status === "fulfilled") {
            feeds[feedKey(pending[index])] = {
              updatedAt: Date.now(),
              episodes: takeNewestCandidates(feed.value, candidatesPerPodcast),
            };
            publish();
          }
        },
      );

      let failures = 0;
      for (const feed of settledFeeds) {
        if (feed.status === "rejected") {
          failures += 1;
        }
      }
      failedFeedCount.value = failures;

      // A non-empty library where every feed rejected is a hard load failure,
      // not a partial one: there is no usable listing to show. Empty libraries
      // and fulfilled-but-empty feeds stay normal empty content.
      if (
        podcasts.length > 0 &&
        failures === podcasts.length &&
        episodes.value.length === 0
      ) {
        loadFailed.value = true;
        episodes.value = [];
        hasLoadedOnce.value = true;
        toast.error($t("latest_episodes_load_failed"));
        return;
      }

      hasLoadedOnce.value = true;

      if (failures > 0) {
        toast.error($t("latest_episodes_partial_failure", [String(failures)]));
      } else if (isManualRefresh) {
        toast.success($t("latest_episodes_refreshed"));
      }
    } catch {
      loadFailed.value = true;
      hasLoadedOnce.value = true;
      toast.error($t("latest_episodes_load_failed"));
    } finally {
      isLoading.value = false;
    }
  };

  const refresh = (): Promise<void> => load(true);

  /**
   * Apply a MEDIA_ITEM_PLAYED payload to a matching episode in-place so open
   * views (progress icons, unplayed-only filter) update immediately. Matching
   * is by `uri`; unrelated ids are ignored. Fields are applied defensively:
   * `fully_played` only when present as a boolean, and `resume_position_ms`
   * derived from `seconds_played` (seconds → ms) only when it is a number.
   *
   * @returns true when a matching episode was updated.
   */
  const applyPlaybackUpdate = (
    objectId: string | null | undefined,
    data: unknown,
  ): boolean => {
    if (!objectId) return false;
    const idx = episodes.value.findIndex((episode) => episode.uri === objectId);
    if (idx < 0) return false;

    const playData = (data ?? {}) as Record<string, unknown>;
    const episode = episodes.value[idx];

    if (typeof playData.fully_played === "boolean") {
      episode.fully_played = playData.fully_played;
    }
    if (typeof playData.seconds_played === "number") {
      episode.resume_position_ms = playData.seconds_played * 1000;
    }
    // Cached feeds and the visible list share episode objects.
    publish();
    return true;
  };

  return {
    episodes,
    isLoading,
    hasLoadedOnce,
    loadFailed,
    failedFeedCount,
    totalFeedCount,
    progress,
    hasPartialFailure,
    load,
    refresh,
    applyPlaybackUpdate,
  };
}
