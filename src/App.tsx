import { useEffect, useRef } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { ProgressDock } from "@/components/ProgressDock";
import { ErrorToast } from "@/components/ErrorToast";
import { AshiDock } from "@/components/AshiDock";
import { AshiConfirmModal } from "@/components/AshiConfirmModal";
import { useAshi } from "@/stores/ashi";
import { HomePage } from "@/pages/Home";
import { AccountPage } from "@/pages/Account";
import { LibraryPage } from "@/pages/Library";
import { InstancePage } from "@/pages/Instance";
import { SettingsPage } from "@/pages/Settings";
import { BrowsePage } from "@/pages/Browse";
import { SkinsPage } from "@/pages/Skins";
import { GalleryPage } from "@/pages/Gallery";
import { NewsPage } from "@/pages/News";
import { Splash } from "@/components/Splash";
import { api } from "@/lib/ipc";
import { InviteHost } from "@/components/features/InviteModal";
import { TooltipLayer } from "@/components/TooltipLayer";
import { UpdateBanner, UpdateModal } from "@/components/UpdateCenter";
import { LockScreen, SetupWizard } from "@/components/SetupWizard";
import { LoginModal } from "@/components/LoginModal";
import { ContextMenu } from "@/components/ContextMenu";
import { AshiTour } from "@/components/AshiTour";
import { ImportWizard } from "@/components/ImportWizard";
import { useAccounts } from "@/stores/accounts";
import { AshiChat } from "@/components/AshiChat";
import { AiSetupModal } from "@/components/AiSetup";
import { ImageCropperHost } from "@/components/ImageCropper";
import { ConfirmHost } from "@/components/ConfirmDialog";
import { CursorTrail } from "@/components/CursorTrail";
import { BackgroundMusic } from "@/components/BackgroundMusic";
import { ContentToasts } from "@/components/ContentToasts";
import { AshiSolver } from "@/components/AshiSolver";
import { useSettings } from "@/stores/settings";
import { useInstances } from "@/stores/instances";
import { AmbientSky } from "@/components/AmbientSky";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  // Açılış sayfası (Ayarlar → Genel): yalnızca ilk açılışta, ana sayfadaysak
  const startPage = useSettings((s) => (s.loaded ? s.settings.startPage : null));
  const startDone = useRef(false);
  useEffect(() => {
    if (!startPage || startDone.current) return;
    startDone.current = true;
    // Kaldırılan sayfalar (ör. eski Sosyal) açılış sayfası olarak kalmışsa ana sayfada kal
    if (startPage !== "/" && !startPage.startsWith("/social") && location.pathname === "/") navigate(startPage, { replace: true });
  }, [startPage]); // eslint-disable-line react-hooks/exhaustive-deps
  // Discord durumu: launcher'da hangi sayfada olunduğu (oyun sürerken Rust tarafı yok sayar)
  useEffect(() => {
    const seg = location.pathname.split("/")[1] || "home";
    void api.discordPage(seg).catch(() => {});
  }, [location.pathname]);
  const loadSettings = useSettings((s) => s.load);
  const reduceMotion = useSettings((s) => s.settings.theme.reduceMotion);
  const { refresh, bindEvents } = useInstances();
  // Oyun açıkken launcher dinlenir: animasyonlar, geçişler ve bulanıklık durur (ekran kartı/işlemci oyuna kalır)
  const gameRunning = useInstances((s) => Object.keys(s.running).length > 0);
  useEffect(() => {
    if (gameRunning) document.documentElement.dataset.game = "1";
    else delete document.documentElement.dataset.game;
  }, [gameRunning]);
  const { bindEvents: bindAshi, loadSkin } = useAshi();

  useEffect(() => {
    void loadSettings();
    void refresh();
    void loadSkin();
    void useAccounts.getState().load();
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
        <UpdateBanner />
        <div className="shell-body">
          <Sidebar />
          <main className="content">
            <AmbientSky quiet={location.pathname !== "/"} />
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
                  <Route path="/gallery" element={<GalleryPage />} />
                  <Route path="/news" element={<NewsPage />} />
                  <Route path="/account" element={<AccountPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </motion.div>
            </AnimatePresence>
          </main>
          <AshiChat />
        </div>
        <div className="dock">
          <AshiDock />
          <ContentToasts />
          <ProgressDock />
        </div>
        <AshiConfirmModal />
        <InviteHost />
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
