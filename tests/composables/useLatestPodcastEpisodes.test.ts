import type { Podcast, PodcastEpisode } from "@/plugins/api/interfaces";
import { $t } from "@/plugins/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetLibraryPodcasts, mockGetPodcastEpisodes, mockToast } =
  vi.hoisted(() => {
    return {
      mockGetLibraryPodcasts: vi.fn(),
      mockGetPodcastEpisodes: vi.fn(),
      mockToast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
      },
    };
  });

vi.mock("@/plugins/api", () => ({
  api: {
    getLibraryPodcasts: mockGetLibraryPodcasts,
    getPodcastEpisodes: mockGetPodcastEpisodes,
  },
}));

vi.mock("vue-sonner", () => ({
  toast: mockToast,
}));

import { useLatestPodcastEpisodes } from "@/composables/useLatestPodcastEpisodes";

function makePodcast(id: string): Podcast {
  return { item_id: id, provider: "test" } as unknown as Podcast;
}

function makeEpisode(id: string, releaseDate?: string): PodcastEpisode {
  return {
    item_id: id,
    provider: "test",
    name: id,
    uri: `podcast_episode://test/${id}`,
    metadata: releaseDate ? { release_date: releaseDate } : {},
  } as unknown as PodcastEpisode;
}

describe("useLatestPodcastEpisodes", () => {
  beforeEach(() => {
    mockGetLibraryPodcasts.mockReset();
    mockGetPodcastEpisodes.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
  });

  it("loads every library page and caps simultaneous feed requests at four", async () => {
    const podcasts = Array.from({ length: 501 }, (_, i) =>
      makePodcast(`p${i}`),
    );
    mockGetLibraryPodcasts.mockImplementation((_a, _b, limit, offset) =>
      Promise.resolve(podcasts.slice(offset, offset + limit)),
    );
    let active = 0;
    let peak = 0;
    mockGetPodcastEpisodes.mockImplementation(async (id: string) => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return [makeEpisode(id, "2026-11-07")];
    });
    const { load, episodes, progress } = useLatestPodcastEpisodes();
    await load();
    expect(mockGetLibraryPodcasts.mock.calls).toEqual([
      [undefined, undefined, 500, 0],
      [undefined, undefined, 500, 500],
    ]);
    expect(mockGetPodcastEpisodes).toHaveBeenCalledTimes(501);
    expect(peak).toBe(4);
    expect(episodes.value).toHaveLength(100);
    expect(progress.value).toEqual({ loaded: 501, total: 501 });
  });

  it("surfaces a library failure and allows a successful refresh", async () => {
    mockGetLibraryPodcasts.mockRejectedValueOnce(
      new Error("library unavailable"),
    );
    const { load, refresh, loadFailed, isLoading, hasLoadedOnce } =
      useLatestPodcastEpisodes();
    await load();
    expect(loadFailed.value).toBe(true);
    expect(hasLoadedOnce.value).toBe(true);
    expect(isLoading.value).toBe(false);
    expect(mockGetPodcastEpisodes).not.toHaveBeenCalled();
    mockGetLibraryPodcasts.mockResolvedValue([]);
    await refresh();
    expect(loadFailed.value).toBe(false);
    expect(mockToast.success).toHaveBeenCalledWith(
      $t("latest_episodes_refreshed"),
    );
  });

  it("ignores overlapping loads while the library request is pending", async () => {
    let finish!: (value: Podcast[]) => void;
    mockGetLibraryPodcasts.mockReturnValue(
      new Promise<Podcast[]>((resolve) => {
        finish = resolve;
      }),
    );
    const { load, isLoading } = useLatestPodcastEpisodes();
    const pending = load();
    await load();
    expect(isLoading.value).toBe(true);
    expect(mockGetLibraryPodcasts).toHaveBeenCalledTimes(1);
    finish([]);
    await pending;
    expect(isLoading.value).toBe(false);
  });

  it("sets a hard load failure when every feed rejects in a non-empty library", async () => {
    mockGetLibraryPodcasts.mockResolvedValueOnce([
      makePodcast("p1"),
      makePodcast("p2"),
    ]);
    mockGetLibraryPodcasts.mockResolvedValue([]);
    mockGetPodcastEpisodes.mockRejectedValue(new Error("boom"));

    const {
      episodes,
      loadFailed,
      hasPartialFailure,
      failedFeedCount,
      totalFeedCount,
      progress,
      load,
    } = useLatestPodcastEpisodes();

    await load();

    expect(loadFailed.value).toBe(true);
    expect(hasPartialFailure.value).toBe(false);
    expect(episodes.value).toEqual([]);
    expect(failedFeedCount.value).toBe(2);
    expect(totalFeedCount.value).toBe(2);
    expect(progress.value).toEqual({ loaded: 2, total: 2 });
    expect(mockToast.error).toHaveBeenCalledWith(
      $t("latest_episodes_load_failed"),
    );
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("does not show refreshed feedback on an all-fail manual refresh", async () => {
    mockGetLibraryPodcasts.mockResolvedValueOnce([makePodcast("p1")]);
    mockGetLibraryPodcasts.mockResolvedValue([]);
    mockGetPodcastEpisodes.mockRejectedValue(new Error("boom"));

    const { loadFailed, refresh } = useLatestPodcastEpisodes();

    await refresh();

    expect(loadFailed.value).toBe(true);
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      $t("latest_episodes_load_failed"),
    );
  });

  it("reports a partial failure when only some feeds reject", async () => {
    mockGetLibraryPodcasts.mockResolvedValueOnce([
      makePodcast("p1"),
      makePodcast("p2"),
    ]);
    mockGetLibraryPodcasts.mockResolvedValue([]);
    mockGetPodcastEpisodes.mockImplementation((itemId: string) =>
      itemId === "p1"
        ? Promise.resolve([makeEpisode("e1", "2024-01-01")])
        : Promise.reject(new Error("boom")),
    );

    const { episodes, loadFailed, hasPartialFailure, failedFeedCount, load } =
      useLatestPodcastEpisodes();

    await load();

    expect(loadFailed.value).toBe(false);
    expect(hasPartialFailure.value).toBe(true);
    expect(failedFeedCount.value).toBe(1);
    expect(episodes.value.map((e) => e.name)).toEqual(["e1"]);
    expect(mockToast.error).toHaveBeenCalledWith(
      $t("latest_episodes_partial_failure", ["1"]),
    );
  });

  it("stays normal empty content for an empty library", async () => {
    mockGetLibraryPodcasts.mockResolvedValue([]);

    const { episodes, loadFailed, hasPartialFailure, failedFeedCount, load } =
      useLatestPodcastEpisodes();

    await load();

    expect(loadFailed.value).toBe(false);
    expect(hasPartialFailure.value).toBe(false);
    expect(failedFeedCount.value).toBe(0);
    expect(episodes.value).toEqual([]);
    expect(mockGetPodcastEpisodes).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("succeeds with fulfilled-but-empty feeds", async () => {
    mockGetLibraryPodcasts.mockResolvedValueOnce([makePodcast("p1")]);
    mockGetLibraryPodcasts.mockResolvedValue([]);
    mockGetPodcastEpisodes.mockResolvedValue([]);

    const { episodes, loadFailed, hasPartialFailure, refresh } =
      useLatestPodcastEpisodes();

    await refresh();

    expect(loadFailed.value).toBe(false);
    expect(hasPartialFailure.value).toBe(false);
    expect(episodes.value).toEqual([]);
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith(
      $t("latest_episodes_refreshed"),
    );
  });

  it("applies playback data to a matching episode by uri", async () => {
    mockGetLibraryPodcasts.mockResolvedValueOnce([makePodcast("p1")]);
    mockGetLibraryPodcasts.mockResolvedValue([]);
    mockGetPodcastEpisodes.mockResolvedValue([makeEpisode("e1", "2024-01-01")]);

    const { episodes, load, applyPlaybackUpdate } = useLatestPodcastEpisodes();
    await load();

    const updated = applyPlaybackUpdate("podcast_episode://test/e1", {
      fully_played: true,
      seconds_played: 42,
    });

    expect(updated).toBe(true);
    expect(episodes.value[0].fully_played).toBe(true);
    expect(episodes.value[0].resume_position_ms).toBe(42000);
  });

  it("ignores playback events for an unrelated uri", async () => {
    mockGetLibraryPodcasts.mockResolvedValueOnce([makePodcast("p1")]);
    mockGetLibraryPodcasts.mockResolvedValue([]);
    mockGetPodcastEpisodes.mockResolvedValue([makeEpisode("e1", "2024-01-01")]);

    const { episodes, load, applyPlaybackUpdate } = useLatestPodcastEpisodes();
    await load();

    const updated = applyPlaybackUpdate("podcast_episode://test/other", {
      fully_played: true,
      seconds_played: 42,
    });

    expect(updated).toBe(false);
    expect(episodes.value[0].fully_played).toBeUndefined();
    expect(episodes.value[0].resume_position_ms).toBeUndefined();
  });

  it("applies playback fields defensively", async () => {
    mockGetLibraryPodcasts.mockResolvedValueOnce([makePodcast("p1")]);
    mockGetLibraryPodcasts.mockResolvedValue([]);
    mockGetPodcastEpisodes.mockResolvedValue([makeEpisode("e1", "2024-01-01")]);

    const { episodes, load, applyPlaybackUpdate } = useLatestPodcastEpisodes();
    await load();

    // Missing object_id and malformed payloads must not throw or mutate.
    expect(applyPlaybackUpdate(undefined, undefined)).toBe(false);
    expect(applyPlaybackUpdate("podcast_episode://test/e1", undefined)).toBe(
      true,
    );
    applyPlaybackUpdate("podcast_episode://test/e1", {
      fully_played: "yes",
      seconds_played: "nan",
    });

    expect(episodes.value[0].fully_played).toBeUndefined();
    expect(episodes.value[0].resume_position_ms).toBeUndefined();
  });
});
