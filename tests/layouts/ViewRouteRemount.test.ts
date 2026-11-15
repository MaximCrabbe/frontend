import View from "@/layouts/default/View.vue";
import { mount } from "@vue/test-utils";
import { defineComponent, onMounted } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it, vi } from "vitest";

const { mounted, store } = vi.hoisted(() => ({
  mounted: vi.fn(),
  store: { frameless: false, mobileLayout: false },
}));

vi.mock("@/plugins/store", () => ({ store }));
vi.mock("@/plugins/eventbus", () => ({
  eventbus: { off: vi.fn(), on: vi.fn() },
}));
vi.mock("@/components/navigation/AppSidebar.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/ui/sidebar", () => ({
  SidebarInset: { template: "<div><slot /></div>" },
  SidebarProvider: { template: "<div><slot /></div>" },
}));

vi.mock("@/components/AddManualLink.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/DialogDeleteConfirmation.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/SetupFlowDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/PlayerGroupPlaybackDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/PlayerRenameDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/CommandCenter.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/layouts/default/PlayAnnouncementDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/genre/DeleteGenreDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/genre/LinkGenreDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/genre/MergeGenreDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/layouts/default/AddToPlaylistDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/layouts/default/AudioOverlayDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/layouts/default/CreatePlaylistDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/layouts/default/CreateSmartPlaylistDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/layouts/default/ImportPlaylistDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/layouts/default/ItemContextMenu.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/layouts/default/PlayerSelect.vue", () => ({
  default: { template: "<div />" },
}));

describe("default View", () => {
  it("remounts a reused detail component for path changes, but not query changes", async () => {
    const Detail = defineComponent({
      setup() {
        onMounted(mounted);
        return () => "detail";
      },
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/playlists/:id", component: Detail }],
    });
    await router.push("/playlists/first");
    await router.isReady();

    mount(View, {
      global: {
        plugins: [router],
        stubs: { VMain: { template: "<main><slot /></main>" } },
      },
    });
    expect(mounted).toHaveBeenCalledTimes(1);

    await router.push("/playlists/second");
    expect(mounted).toHaveBeenCalledTimes(2);

    await router.push("/playlists/second?tab=tracks");
    expect(mounted).toHaveBeenCalledTimes(2);
  });
});
