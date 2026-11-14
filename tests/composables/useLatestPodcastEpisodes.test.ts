import type { Podcast, PodcastEpisode } from "@/plugins/api/interfaces";
import { $t } from "@/plugins/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { api } from "@/plugins/api";
import { store } from "@/plugins/store";

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
    serverInfo: { value: { server_id: "test-server" } },
    getLibraryPodcasts: mockGetLibraryPodcasts,
    getPodcastEpisodes: mockGetPodcastEpisodes,
  },
}));

vi.mock("@/plugins/store", () => ({
  store: { currentUser: { user_id: "test-user" } },
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
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    sessionStorage.clear();
    api.serverInfo.value!.server_id = "test-server";
    store.currentUser!.user_id = "test-user";
    mockGetLibraryPodcasts.mockReset();
    mockGetPodcastEpisodes.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
  });

  it("restores known episodes immediately and only loads uncached feeds on a fresh revisit", async () => {
    mockGetLibraryPodcasts.mockResolvedValue([makePodcast("p1")]);
    mockGetPodcastEpisodes.mockResolvedValue([
      makeEpisode("known", "2026-11-13"),
    ]);
    await useLatestPodcastEpisodes().load();
    mockGetLibraryPodcasts.mockResolvedValue([
      makePodcast("p1"),
      makePodcast("p2"),
    ]);
    mockGetPodcastEpisodes.mockClear();
    mockGetPodcastEpisodes.mockResolvedValue([
      makeEpisode("new", "2026-11-14"),
    ]);
    const revisit = useLatestPodcastEpisodes();
    expect(revisit.episodes.value.map((e) => e.item_id)).toEqual(["known"]);
    await revisit.load();
    expect(mockGetPodcastEpisodes.mock.calls).toEqual([["p2", "test"]]);
    expect(revisit.episodes.value.map((e) => e.item_id)).toEqual([
      "new",
      "known",
    ]);
    expect(revisit.progress.value).toEqual({ loaded: 2, total: 2 });
  });

  it("shows a completed feed while another feed is still pending", async () => {
    mockGetLibraryPodcasts.mockResolvedValue([
      makePodcast("fast"),
      makePodcast("slow"),
    ]);
    let finish!: (value: PodcastEpisode[]) => void;
    mockGetPodcastEpisodes.mockImplementation((id: string) =>
      id === "fast"
        ? Promise.resolve([makeEpisode("first", "2026-11-14")])
        : new Promise<PodcastEpisode[]>((resolve) => {
            finish = resolve;
          }),
    );
    const { load, episodes, isLoading, progress } = useLatestPodcastEpisodes();
    const pending = load();
    await flushPromises();
    expect(episodes.value.map((e) => e.item_id)).toEqual(["first"]);
    expect(isLoading.value).toBe(true);
    expect(progress.value).toEqual({ loaded: 1, total: 2 });
    finish([makeEpisode("second", "2026-11-13")]);
    await pending;
    expect(episodes.value.map((e) => e.item_id)).toEqual(["first", "second"]);
  });

  it("revalidates expired feeds, replaces changed data, and removes unsubscribed podcasts", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000000);
    mockGetLibraryPodcasts.mockResolvedValue([
      makePodcast("p1"),
      makePodcast("removed"),
    ]);
    mockGetPodcastEpisodes.mockImplementation(async (id: string) => [
      makeEpisode(id),
    ]);
    await useLatestPodcastEpisodes().load();
    now.mockReturnValue(1300000);
    mockGetLibraryPodcasts.mockResolvedValue([makePodcast("p1")]);
    mockGetPodcastEpisodes.mockClear();
    mockGetPodcastEpisodes.mockResolvedValue([makeEpisode("changed")]);
    const revisit = useLatestPodcastEpisodes();
    await revisit.load();
    expect(mockGetPodcastEpisodes.mock.calls).toEqual([["p1", "test"]]);
    expect(revisit.episodes.value.map((e) => e.item_id)).toEqual(["changed"]);
  });

  it("manual refresh bypasses freshness and retains cached episodes on feed or library errors", async () => {
    mockGetLibraryPodcasts.mockResolvedValue([makePodcast("p1")]);
    mockGetPodcastEpisodes.mockResolvedValue([makeEpisode("known")]);
    const listing = useLatestPodcastEpisodes();
    await listing.load();
    mockGetPodcastEpisodes.mockRejectedValue(new Error("offline"));
    await listing.refresh();
    expect(mockGetPodcastEpisodes).toHaveBeenCalledTimes(2);
    expect(listing.episodes.value.map((e) => e.item_id)).toEqual(["known"]);
    expect(listing.hasPartialFailure.value).toBe(true);
    mockGetLibraryPodcasts.mockRejectedValue(new Error("offline"));
    await listing.refresh();
    expect(listing.loadFailed.value).toBe(true);
    expect(listing.episodes.value.map((e) => e.item_id)).toEqual(["known"]);
  });

  it("tolerates corrupt, malformed, disabled and full browser storage", async () => {
    mockGetLibraryPodcasts.mockResolvedValue([makePodcast("p1")]);
    mockGetPodcastEpisodes.mockResolvedValue([makeEpisode("known")]);
    for (const raw of [
      "{broken",
      "[]",
      "null",
      '{"bad":{"updatedAt":1,"episodes":[null]}}',
      '{"bad":null}',
    ]) {
      const read = vi.spyOn(Storage.prototype, "getItem").mockReturnValue(raw);
      await useLatestPodcastEpisodes().load();
      read.mockRestore();
    }
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const listing = useLatestPodcastEpisodes();
    await listing.load();
    expect(listing.episodes.value.map((e) => e.item_id)).toEqual(["known"]);
    expect(listing.loadFailed.value).toBe(false);
  });

  it("isolates cached feeds by server and user, and keeps playback updates on revisit", async () => {
    mockGetLibraryPodcasts.mockResolvedValue([makePodcast("p1")]);
    mockGetPodcastEpisodes.mockResolvedValue([makeEpisode("known")]);
    const listing = useLatestPodcastEpisodes();
    await listing.load();
    listing.applyPlaybackUpdate("podcast_episode://test/known", {
      fully_played: true,
    });
    expect(useLatestPodcastEpisodes().episodes.value[0].fully_played).toBe(
      true,
    );
    store.currentUser!.user_id = "other-user";
    expect(useLatestPodcastEpisodes().episodes.value).toEqual([]);
    store.currentUser!.user_id = "test-user";
    api.serverInfo.value!.server_id = "other-server";
    expect(useLatestPodcastEpisodes().episodes.value).toEqual([]);
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
