import { BookmarksPage, MessagesPage, PrivacyPage, NotificationsPage, PostPage, ProfilePage, SocialFeedPage, SocialSearchPage, TagPage } from "@/pages/Social";
import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { ProgressDock } from "@/components/ProgressDock";
import { ErrorToast } from "@/components/ErrorToast";
import { AshiDock } from "@/components/AshiDock";
import { AshiConfirmModal } from "@/components/AshiConfirmModal";
import { useAshi } from "@/stores/ashi";
import { HomePage } from "@/pages/Home";
import { LibraryPage } from "@/pages/Library";
import { InstancePage } from "@/pages/Instance";
import { SettingsPage } from "@/pages/Settings";
import { BrowsePage } from "@/pages/Browse";
import { SkinsPage } from "@/pages/Skins";
import { GalleryPage } from "@/pages/Gallery";
import { NewsPage } from "@/pages/News";
import { Splash } from "@/components/Splash";
import { TooltipLayer } from "@/components/TooltipLayer";
import { UpdateModal } from "@/components/UpdateCenter";
import { LockScreen, SetupWizard } from "@/components/SetupWizard";
import { LoginModal } from "@/components/LoginModal";
import { ContextMenu } from "@/components/ContextMenu";
import { AshiTour } from "@/components/AshiTour";
import { ImportWizard } from "@/components/ImportWizard";
import { useAccounts } from "@/stores/accounts";
import { AshiChat } from "@/components/AshiChat";
import { AiSetupModal } from "@/components/AiSetup";
import { ImageCropperHost } from "@/components/ImageCropper";
import { AmbientSky } from "@/components/AmbientSky";
import { ConfirmHost } from "@/components/ConfirmDialog";
import { CursorTrail } from "@/components/CursorTrail";
import { BackgroundMusic } from "@/components/BackgroundMusic";
import { startPresence } from "@/stores/west";
import { ContentToasts } from "@/components/ContentToasts";
import { InviteCenter } from "@/components/InviteCenter";
import { AshiSolver } from "@/components/AshiSolver";
import { ShopPage } from "@/pages/Shop";
import { DepotPage } from "@/pages/Depot";
import { CoinToast } from "@/components/CoinToast";
import { startWallet } from "@/stores/wallet";
import { useSettings } from "@/stores/settings";
import { useInstances } from "@/stores/instances";

export default function App() {
  const location = useLocation();
  const loadSettings = useSettings((s) => s.load);
  const reduceMotion = useSettings((s) => s.settings.theme.reduceMotion);
  const { refresh, bindEvents } = useInstances();
  const { bindEvents: bindAshi, loadSkin } = useAshi();

  useEffect(() => {
    void loadSettings();
    void refresh();
    void loadSkin();
    void useAccounts.getState().load();
    startPresence();
    startWallet();
    const un = bindEvents();
    const nameOf = (id: string) => useInstances.getState().instances.find((i) => i.id === id)?.name ?? id;
    const unAshi = bindAshi(nameOf);
    const unLogin = useAccounts.getState().bindEvents();
    return () => {
      void un.then((f) => f());
      void unLogin.then((f) => f());
      void unAshi.then((f) => f());
    };
  }, [loadSettings, refresh, bindEvents, bindAshi, loadSkin]);

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "never"} transition={{ type: "spring", stiffness: 420, damping: 34 }}>
      <div className="shell">
        <TitleBar />
        <div className="shell-body">
          <Sidebar />
          <main className="content">
            <AmbientSky />
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                className="page"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14 }}
              >
                <Routes location={location}>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/library" element={<LibraryPage />} />
                  <Route path="/instance/:id" element={<InstancePage />} />
                  <Route path="/browse" element={<BrowsePage />} />
                  <Route path="/skins" element={<SkinsPage />} />
                  <Route path="/shop" element={<ShopPage />} />
                  <Route path="/depot" element={<DepotPage />} />
                  <Route path="/gallery" element={<GalleryPage />} />
                  <Route path="/news" element={<NewsPage />} />
                  <Route path="/social" element={<SocialFeedPage />} />
                  <Route path="/social/notifications" element={<NotificationsPage />} />
                  <Route path="/social/bookmarks" element={<BookmarksPage />} />
                  <Route path="/social/messages" element={<MessagesPage />} />
                  <Route path="/social/messages/:id" element={<MessagesPage />} />
                  <Route path="/social/settings" element={<PrivacyPage />} />
                  <Route path="/social/search" element={<SocialSearchPage />} />
                  <Route path="/social/tag/:tag" element={<TagPage />} />
                  <Route path="/u/:username" element={<ProfilePage />} />
                  <Route path="/post/:id" element={<PostPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </motion.div>
            </AnimatePresence>
          </main>
          <AshiChat />
        </div>
        <div className="dock">
          <AshiDock />
          <CoinToast />
          <InviteCenter />
          <ContentToasts />
          <ProgressDock />
        </div>
        <AshiConfirmModal />
        <AshiSolver />
        <AiSetupModal />
        <ImageCropperHost />
        <ConfirmHost />
        <CursorTrail />
        <BackgroundMusic />
        <ImportWizard />
        <AshiTour />
        <UpdateModal />
        <SetupWizard />
        <LoginModal />
        <ContextMenu />
        <LockScreen />
        <TooltipLayer />
        <Splash />
        <ErrorToast />
      </div>
    </MotionConfig>
  );
}
