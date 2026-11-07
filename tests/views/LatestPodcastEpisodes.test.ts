import { flushPromises, shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@/plugins/api/interfaces";
import type { EventMessage, PodcastEpisode } from "@/plugins/api/interfaces";

const {
  mockGetLibraryPodcasts,
  mockGetPodcastEpisodes,
  mockSubscribe,
  mockUnsubscribe,
  mockRouterPush,
} = vi.hoisted(() => ({
  mockGetLibraryPodcasts: vi.fn(),
  mockGetPodcastEpisodes: vi.fn(),
  mockSubscribe: vi.fn(),
  mockUnsubscribe: vi.fn(),
  mockRouterPush: vi.fn(),
}));

let playedCallback: ((evt: EventMessage) => void) | undefined;

vi.mock("@/plugins/api", () => ({
  api: {
    getLibraryPodcasts: mockGetLibraryPodcasts,
    getPodcastEpisodes: mockGetPodcastEpisodes,
    subscribe: mockSubscribe,
  },
}));

vi.mock("vue-sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/plugins/i18n", () => ({ $t: (key: string) => key }));

import LatestPodcastEpisodes from "@/views/LatestPodcastEpisodes.vue";
import LatestPodcastEpisodeItem from "@/components/LatestPodcastEpisodeItem.vue";
import { Switch } from "@/components/ui/switch";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import Toolbar from "@/components/Toolbar.vue";

function makeEpisode(id: string, releaseDate: string): PodcastEpisode {
  return {
    item_id: id,
    provider: "test",
    name: id,
    uri: `podcast_episode://test/${id}`,
    metadata: { release_date: releaseDate },
  } as unknown as PodcastEpisode;
}

function mountView() {
  return shallowMount(LatestPodcastEpisodes, {
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        // Render the container slot so the episode list is inspectable.
        Container: { template: "<div><slot /></div>" },
        Empty: { template: "<div><slot /></div>" },
        EmptyContent: { template: "<div><slot /></div>" },
        EmptyDescription: { template: "<div><slot /></div>" },
      },
    },
  });
}

describe("LatestPodcastEpisodes playback sync", () => {
  beforeEach(() => {
    playedCallback = undefined;
    mockGetLibraryPodcasts.mockReset();
    mockGetPodcastEpisodes.mockReset();
    mockSubscribe.mockReset();
    mockUnsubscribe.mockReset();
    mockRouterPush.mockReset();

    mockGetLibraryPodcasts.mockImplementation((_a, _b, _size, offset = 0) =>
      offset === 0
        ? Promise.resolve([{ item_id: "p1", provider: "test" }])
        : Promise.resolve([]),
    );
    mockGetPodcastEpisodes.mockResolvedValue([
      makeEpisode("e1", "2024-01-02"),
      makeEpisode("e2", "2024-01-01"),
    ]);
    mockSubscribe.mockImplementation(
      (_event: EventType, cb: (evt: EventMessage) => void) => {
        playedCallback = cb;
        return mockUnsubscribe;
      },
    );
  });

  it("subscribes to MEDIA_ITEM_PLAYED on mount", async () => {
    mountView();
    await flushPromises();

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith(
      EventType.MEDIA_ITEM_PLAYED,
      expect.any(Function),
    );
  });

  it("updates a matching episode's playback data immediately", async () => {
    const wrapper = mountView();
    await flushPromises();

    playedCallback?.({
      event: EventType.MEDIA_ITEM_PLAYED,
      object_id: "podcast_episode://test/e1",
      data: { fully_played: false, seconds_played: 30 },
    });
    await flushPromises();

    const items = wrapper.findAllComponents(LatestPodcastEpisodeItem);
    const e1 = items.find(
      (i) => (i.props("episode") as PodcastEpisode).item_id === "e1",
    );
    expect(e1?.props("episode")).toMatchObject({
      resume_position_ms: 30000,
    });
  });

  it("drops a fully played episode from the unplayed-only filter immediately", async () => {
    const wrapper = mountView();
    await flushPromises();

    // Enable the unplayed-only filter.
    wrapper.findComponent(Switch).vm.$emit("update:modelValue", true);
    await flushPromises();
    expect(wrapper.findAllComponents(LatestPodcastEpisodeItem)).toHaveLength(2);

    playedCallback?.({
      event: EventType.MEDIA_ITEM_PLAYED,
      object_id: "podcast_episode://test/e1",
      data: { fully_played: true, seconds_played: 120 },
    });
    await flushPromises();

    const remaining = wrapper.findAllComponents(LatestPodcastEpisodeItem);
    expect(remaining).toHaveLength(1);
    expect((remaining[0].props("episode") as PodcastEpisode).item_id).toBe(
      "e2",
    );
  });

  it("ignores playback events for an unrelated uri", async () => {
    const wrapper = mountView();
    await flushPromises();

    playedCallback?.({
      event: EventType.MEDIA_ITEM_PLAYED,
      object_id: "podcast_episode://test/unknown",
      data: { fully_played: true, seconds_played: 99 },
    });
    await flushPromises();

    const items = wrapper.findAllComponents(LatestPodcastEpisodeItem);
    expect(items).toHaveLength(2);
    for (const item of items) {
      const episode = item.props("episode") as PodcastEpisode;
      expect(episode.fully_played).toBeUndefined();
      expect(episode.resume_position_ms).toBeUndefined();
    }
  });

  it("unsubscribes on unmount", async () => {
    const wrapper = mountView();
    await flushPromises();

    wrapper.unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("filters by episode title and podcast name without fetching again", async () => {
    mockGetPodcastEpisodes.mockResolvedValue([
      {
        ...makeEpisode("Science Today", "2026-11-07"),
        podcast: { name: "Daily" },
      },
      {
        ...makeEpisode("Interview", "2026-11-06"),
        podcast: { name: "Science Weekly" },
      },
      { ...makeEpisode("Other", "2026-11-05"), podcast: { name: "Daily" } },
    ]);
    const wrapper = mountView();
    await flushPromises();
    wrapper
      .findComponent(SearchInput)
      .vm.$emit("update:modelValue", " SCIENCE ");
    await flushPromises();
    expect(wrapper.findAllComponents(LatestPodcastEpisodeItem)).toHaveLength(2);
    expect(mockGetPodcastEpisodes).toHaveBeenCalledTimes(1);
    wrapper.findComponent(SearchInput).vm.$emit("update:modelValue", "missing");
    await flushPromises();
    expect(wrapper.findAllComponents(LatestPodcastEpisodeItem)).toHaveLength(0);
  });

  it("offers back navigation and refresh through both controls", async () => {
    const wrapper = mountView();
    await flushPromises();
    const toolbar = wrapper.findComponent(Toolbar);
    toolbar.props("iconAction")?.();
    expect(mockRouterPush).toHaveBeenCalledWith({ name: "podcasts" });
    wrapper.findComponent(Button).vm.$emit("click");
    await flushPromises();
    expect(mockGetLibraryPodcasts).toHaveBeenCalledTimes(2);
    const menu = toolbar.props("menuItems")!;
    await menu[0].action?.();
    await flushPromises();
    expect(mockGetLibraryPodcasts).toHaveBeenCalledTimes(3);
  });

  it("renders empty and failed libraries, and retries a failure", async () => {
    mockGetLibraryPodcasts.mockRejectedValueOnce(new Error("offline"));
    const wrapper = mountView();
    await flushPromises();
    expect(wrapper.findAllComponents(LatestPodcastEpisodeItem)).toHaveLength(0);
    const retry = wrapper.findAllComponents(Button).at(-1)!;
    mockGetLibraryPodcasts.mockResolvedValue([]);
    retry.vm.$emit("click");
    await flushPromises();
    expect(wrapper.findAllComponents(LatestPodcastEpisodeItem)).toHaveLength(0);
    expect(mockGetLibraryPodcasts).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("no_content");
  });

  it("shows feed progress while pending and a partial-failure alert afterwards", async () => {
    let finish!: (episodes: PodcastEpisode[]) => void;
    mockGetLibraryPodcasts.mockResolvedValue([
      { item_id: "p1", provider: "test" },
      { item_id: "p2", provider: "test" },
    ]);
    mockGetPodcastEpisodes.mockRejectedValueOnce(new Error("failed feed"));
    mockGetPodcastEpisodes.mockReturnValueOnce(
      new Promise<PodcastEpisode[]>((resolve) => {
        finish = resolve;
      }),
    );
    const wrapper = mountView();
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
    finish([makeEpisode("survivor", "2026-11-07")]);
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "latest_episodes_partial_failure",
    );
    expect(wrapper.findAllComponents(LatestPodcastEpisodeItem)).toHaveLength(1);
  });
});
