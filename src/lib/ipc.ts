import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CrashAnalysis, FixReport,
  ProjectDetail, ProjectVersion,
  ContentTags, WestStatus, WestAccount, WestSignupResult,
  ContentFile, UpdateReport, World, LogFile, FileEntry, ExportReport,
  AshiEvent, AshiSkin, HuntPlan,
  PatchNote, ModUpdate, AssetDiff,
  Screenshot, FoundInstance, CompanionConfig, CompanionInfo, UpdateStatus,
  AccountView, Cape, DeviceCode, MsLoginEvent, Skin, AiStatus, AiSetupProgress, PortItem, PortResult, GameMode, GameModes, ModeApplyReport,
  ChatOutcome, ContentHit, ContentKind, ContentSource, InstallReport, InstalledContent, SearchQuery, SearchResult, SecretStatus,
  GameExit, GameLog, Hardware, Instance, JavaInstall, JvmProfile, LoaderKind,
  LoaderVersion, ManifestEntry, NewInstance, Progress, RunningInfo, Settings,
} from "./types";

/** Rust komutlarının tek, tipli giriş noktası. */
export const api = {
  // ayarlar & sistem
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  getHardware: () => invoke<Hardware>("get_hardware"),
  getDataDir: () => invoke<string>("get_data_dir"),
  cacheSize: () => invoke<number>("cache_size"),
  clearCache: () => invoke<void>("clear_cache"),
  resetSettings: () => invoke<Settings>("reset_settings"),
  setWindowEffect: (effect: string) => invoke<void>("set_window_effect", { effect }),

  // sürümler
  listMcVersions: (includeSnapshots = false) => invoke<ManifestEntry[]>("list_mc_versions", { includeSnapshots }),
  listLoaderVersions: (kind: LoaderKind, mc: string) => invoke<LoaderVersion[]>("list_loader_versions", { kind, mc }),

  // instance
  listInstances: () => invoke<Instance[]>("list_instances"),
  getInstance: (id: string) => invoke<Instance>("get_instance", { id }),
  createInstance: (req: NewInstance) => invoke<Instance>("create_instance", { req }),
  updateInstance: (instance: Instance) => invoke<Instance>("update_instance", { instance }),
  cloneInstance: (id: string, name: string, includeWorlds: boolean) =>
    invoke<Instance>("clone_instance", { id, name, includeWorlds }),
  makeTemplate: (id: string, name: string) => invoke<Instance>("make_template", { id, name }),
  createFromTemplate: (templateId: string, name: string) => invoke<Instance>("create_from_template", { templateId, name }),
  deleteInstance: (id: string) => invoke<void>("delete_instance", { id }),
  instancePath: (id: string) => invoke<string>("instance_path", { id }),

  // java
  listJava: () => invoke<JavaInstall[]>("list_java"),
  installJava: (major: number) => invoke<JavaInstall>("install_java", { major }),
  previewJvm: (instanceId: string, javaMajor: number) => invoke<JvmProfile>("preview_jvm", { instanceId, javaMajor }),

  // başlatma
  launch: (id: string, opts: { offlineName?: string; joinServer?: string } = {}) =>
    invoke<number>("launch_instance", { id, auth: null, offlineName: opts.offlineName ?? null, joinServer: opts.joinServer ?? null }),
  kill: (id: string) => invoke<void>("kill_instance", { id }),
  running: () => invoke<RunningInfo[]>("running_instances"),
  // Haberler
  newsPatchNotes: () => invoke<PatchNote[]>("news_patch_notes"),
  newsPatchBody: (contentPath: string) => invoke<string>("news_patch_body", { contentPath }),
  newsModUpdates: () => invoke<ModUpdate[]>("news_mod_updates"),
  newsAssetDiff: (version: string, base: string | null) => invoke<AssetDiff>("news_asset_diff", { version, base }),
  newsTexture: (version: string, path: string) => invoke<ArrayBuffer>("news_texture", { version, path }),
  newsSound: (hash: string) => invoke<ArrayBuffer>("news_sound", { hash }),
  newsExport: (dest: string, file: { version?: string; path?: string; hash?: string }) =>
    invoke<void>("news_export", { dest, version: file.version ?? null, path: file.path ?? null, hash: file.hash ?? null }),
  updateStatus: () => invoke<UpdateStatus>("update_status"),
  checkUpdate: () => invoke<UpdateStatus>("check_update"),
  installUpdate: () => invoke<void>("install_update"),
  getCompanion: (id: string) => invoke<CompanionInfo>("get_companion", { id }),
  setCompanionConfig: (id: string, config: CompanionConfig) => invoke<void>("set_companion_config", { id, config }),

  // Ashi — Otomatik Suçlu Avcısı
  planHunt: (id: string) => invoke<HuntPlan>("plan_hunt", { id }),
  startHunt: (id: string, offlineName: string) => invoke<HuntPlan>("start_hunt", { id, auth: null, offlineName }),
  cancelHunt: (id: string) => invoke<void>("cancel_hunt", { id }),
  disableMods: (id: string, files: string[]) => invoke<string[]>("disable_mods", { id, files }),
  fixMod: (id: string, file: string, location: string | null) => invoke<FixReport>("fix_mod", { id, file, location }),
  undoFix: (id: string, fixed: string, backup: string) => invoke<void>("undo_fix", { id, fixed, backup }),
  analyzeCrash: (id: string, file?: string) => invoke<CrashAnalysis | null>("analyze_crash", { id, file: file ?? null }),
  ashiSkin: () => invoke<AshiSkin>("ashi_skin"),

  // İçerik motoru
  searchContent: (query: SearchQuery) => invoke<SearchResult>("search_content", { query }),
  contentTags: () => invoke<ContentTags>("content_tags"),
  setInstanceImage: (id: string, kind: "icon" | "banner", path: string | null) => invoke<Instance>("set_instance_image", { id, kind, path }),
  /** Klasörü açar / güvenli dosyayı varsayılan uygulamayla açar; `reveal` → klasörde seçili gösterir */
  openPath: (path: string, reveal = false) => invoke<void>("open_path", { path, reveal }),
  readInstanceText: (instanceId: string, path: string) => invoke<string>("read_instance_text", { instanceId, path }),
  writeInstanceText: (instanceId: string, path: string, content: string) => invoke<void>("write_instance_text", { instanceId, path, content }),
  readImageData: (path: string) => invoke<string>("read_image_data", { path }),
  saveTempImage: (data: string, ext: "png" | "jpg" | "webp") => invoke<string>("save_temp_image", { data, ext }),
  listModes: (id: string) => invoke<GameModes>("list_modes", { id }),
  saveMode: (id: string, modeId: string | null, name: string, icon: string, includeOptions: boolean) => invoke<GameMode>("save_mode", { id, modeId, name, icon, includeOptions }),
  applyMode: (id: string, modeId: string) => invoke<ModeApplyReport>("apply_mode", { id, modeId }),
  renameMode: (id: string, modeId: string, name: string, icon: string) => invoke<void>("rename_mode", { id, modeId, name, icon }),
  deleteMode: (id: string, modeId: string) => invoke<void>("delete_mode", { id, modeId }),
  contentProject: (id: string) => invoke<ProjectDetail>("content_project", { id }),
  contentVersions: (id: string) => invoke<ProjectVersion[]>("content_versions", { id }),
  /** İçeriği seçilen Modrinth sürümüyle değiştirir; yeni içerik kimliğini döndürür */
  setContentVersion: (instanceId: string, id: string, versionId: string) => invoke<string>("set_content_version", { instanceId, id, versionId }),
  /** Ashi Taşıyıcı: hedef sürümde her içeriğin karşılığı var mı */
  portPlan: (instanceId: string, mc: string, loader: LoaderKind) => invoke<PortItem[]>("port_plan", { instanceId, mc, loader }),
  /** Instance'ın hedef sürümde bir kopyasını oluşturup içerikleri taşır */
  portInstance: (instanceId: string, mc: string, loader: LoaderKind, loaderVersion: string | null, name: string, includeWorlds: boolean, keepDisabled: string[]) =>
    invoke<PortResult>("port_instance", { instanceId, mc, loader, loaderVersion, name, includeWorlds, keepDisabled }),
  westStatus: () => invoke<WestStatus>("west_status"),
  westUsernameAvailable: (username: string) => invoke<boolean>("west_username_available", { username }),
  westSignup: (username: string, email: string, password: string) => invoke<WestSignupResult>("west_signup", { username, email, password }),
  westLogin: (email: string, password: string) => invoke<WestAccount>("west_login", { email, password }),
  westLogout: () => invoke<void>("west_logout"),
  westResetPassword: (email: string) => invoke<void>("west_reset_password", { email }),
  westApi: <T = unknown>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, opts: { query?: [string, string][]; body?: unknown; prefer?: string } = {}) =>
    invoke<T>("west_api", { method, path, query: opts.query ?? null, body: opts.body ?? null, prefer: opts.prefer ?? null }),
  westUpload: (path: string, folder: "avatars" | "banners" | "posts" | "stories" | "messages") => invoke<string>("west_upload", { path, folder }),
  installContent: (instanceId: string, source: ContentSource, projectId: string, kind: ContentKind) =>
    invoke<InstallReport>("install_content", { instanceId, source, projectId, kind }),
  installModpack: (hit: ContentHit) => invoke<Instance>("install_modpack", { source: hit.source, projectId: hit.id }),
  installedContent: (instanceId: string) => invoke<InstalledContent[]>("installed_content", { instanceId }),
  listContent: (instanceId: string) => invoke<ContentFile[]>("list_content", { instanceId }),
  // Oyun içi Mod Merkezi'nin bekleyen değişiklikleri
  livemodsPending: (id: string) => invoke<LiveOp[]>("livemods_pending", { id }),
  livemodsUndo: (id: string, index: number) => invoke<LiveOp[]>("livemods_undo", { id, index }),
  livemodsRetry: (id: string) => invoke<LiveOp[]>("livemods_retry", { id }),
  livemodsApply: (id: string) => invoke<string[]>("livemods_apply", { id }),
  refreshContent: (instanceId: string) => invoke<ContentFile[]>("refresh_content", { instanceId }),
  setContentEnabled: (instanceId: string, ids: string[], enabled: boolean) => invoke<void>("set_content_enabled", { instanceId, ids, enabled }),
  deleteContent: (instanceId: string, ids: string[]) => invoke<void>("delete_content", { instanceId, ids }),
  updateContent: (instanceId: string, ids: string[]) => invoke<UpdateReport>("update_content", { instanceId, ids }),
  addContentFiles: (instanceId: string, paths: string[]) => invoke<string[]>("add_content_files", { instanceId, paths }),
  listWorlds: (instanceId: string) => invoke<World[]>("list_worlds", { instanceId }),
  backupWorld: (instanceId: string, folder: string) => invoke<string>("backup_world", { instanceId, folder }),
  deleteWorld: (instanceId: string, folder: string) => invoke<void>("delete_world", { instanceId, folder }),
  worldBackupsDir: (instanceId: string) => invoke<string>("world_backups_dir", { instanceId }),
  listLogs: (instanceId: string) => invoke<LogFile[]>("list_logs", { instanceId }),
  readLog: (instanceId: string, path: string) => invoke<string>("read_log", { instanceId, path }),
  listFiles: (instanceId: string, path: string) => invoke<FileEntry[]>("list_files", { instanceId, path }),
  filePath: (instanceId: string, path: string) => invoke<string>("file_path", { instanceId, path }),
  exportMrpack: (instanceId: string, dest: string, version: string, extras: string[]) => invoke<ExportReport>("export_mrpack", { instanceId, dest, version, extras }),

  // Ashi asistanı + anahtarlar (değerler asla UI'a dönmez)
  ashiChat: (history: unknown[], message: string, activeInstance: string | null) =>
    invoke<ChatOutcome>("ashi_chat", { history, message, activeInstance }),
  secretStatus: () => invoke<SecretStatus>("secret_status"),
  // Launcher kilidi (şifre yalnızca Argon2 özeti olarak saklanır)
  lockStatus: () => invoke<{ hasPassword: boolean }>("lock_status"),
  setLauncherPassword: (password: string | null) => invoke<{ hasPassword: boolean }>("set_launcher_password", { password }),
  verifyLauncherPassword: (password: string) => invoke<boolean>("verify_launcher_password", { password }),
  resetLauncherLock: () => invoke<void>("reset_launcher_lock"),
  ollamaStatus: () => invoke<AiStatus>("ollama_status"),
  /** Ollama'yı (gerekiyorsa) ve modeli tek seferde kurar */
  ollamaSetup: (model?: string) => invoke<void>("ollama_setup", { model: model ?? null }),

  // Hesaplar (token'lar asla UI'a gelmez)
  listAccounts: () => invoke<AccountView[]>("list_accounts"),
  addOfflineAccount: (name: string) => invoke<AccountView[]>("add_offline_account", { name }),
  setActiveAccount: (uuid: string) => invoke<AccountView[]>("set_active_account", { uuid }),
  removeAccount: (uuid: string) => invoke<AccountView[]>("remove_account", { uuid }),
  msLoginStart: () => invoke<DeviceCode>("ms_login_start"),
  msLoginCancel: () => invoke<void>("ms_login_cancel"),
  /** Doğrudan giriş: Microsoft'un giriş sayfasını ayrı bir pencerede açar */
  msLoginWindow: () => invoke<void>("ms_login_window"),
  accountSkin: (account: string) => invoke<Skin | null>("account_skin", { account }),
  accountCapes: (account: string) => invoke<Cape[]>("account_capes", { account }),
  setAccountCape: (account: string, capeId: string | null) => invoke<void>("set_account_cape", { account, capeId }),
  applySkin: (skinId: string, account: string) => invoke<{ uploaded: boolean; accounts: AccountView[] }>("apply_skin", { skinId, account }),

  // Skin arşivi
  listSkins: () => invoke<Skin[]>("list_skins"),
  importSkinFile: (path: string) => invoke<Skin>("import_skin_file", { path }),
  importSkinPlayer: (name: string) => invoke<Skin>("import_skin_player", { name }),
  updateSkin: (id: string, patch: { name?: string; slim?: boolean; favorite?: boolean }) =>
    invoke<Skin>("update_skin", { id, name: patch.name ?? null, slim: patch.slim ?? null, favorite: patch.favorite ?? null }),
  deleteSkin: (id: string) => invoke<void>("delete_skin", { id }),
  saveSkinPng: (pngBase64: string, name: string, slim: boolean) => invoke<Skin>("save_skin_png", { pngBase64, name, slim }),

  // Ekran görüntüleri
  listScreenshots: (instanceId: string | null = null) => invoke<Screenshot[]>("list_screenshots", { instanceId }),
  generateThumbs: (paths: string[]) => invoke<void>("generate_thumbs", { paths }),
  /** İkili yanıt → blob: URL (tuval kirlenmez) */
  readScreenshot: (path: string) => invoke<ArrayBuffer>("read_screenshot", { path }),
  copyScreenshot: (path: string) => invoke<void>("copy_screenshot", { path }),
  copyPngBytes: (pngBase64: string) => invoke<void>("copy_png_bytes", { pngBase64 }),
  exportScreenshot: (path: string, dest: string) => invoke<void>("export_screenshot", { path, dest }),
  exportPng: (dest: string, pngBase64: string) => invoke<void>("export_png", { dest, pngBase64 }),
  deleteScreenshot: (path: string) => invoke<void>("delete_screenshot", { path }),
  saveScreenshotEdit: (source: string, pngBase64: string) => invoke<Screenshot>("save_screenshot_edit", { source, pngBase64 }),
  screenshotsFolder: (instanceId: string) => invoke<string>("screenshots_folder", { instanceId }),

  // Diğer launcher'lardan aktarım
  detectLaunchers: () => invoke<FoundInstance[]>("detect_launchers"),
  detectLauncherFolder: (path: string) => invoke<FoundInstance[]>("detect_launcher_folder", { path }),
  importInstance: (found: FoundInstance, mcVersion: string | null, includeWorlds: boolean) =>
    invoke<Instance>("import_instance", { found, mcVersion, includeWorlds }),
};

export const events = {
  onProgress: (cb: (p: Progress) => void): Promise<UnlistenFn> => listen<Progress>("progress", (e) => cb(e.payload)),
  onGameLog: (cb: (l: GameLog) => void): Promise<UnlistenFn> => listen<GameLog>("game-log", (e) => cb(e.payload)),
  onGameExit: (cb: (x: GameExit) => void): Promise<UnlistenFn> => listen<GameExit>("game-exit", (e) => cb(e.payload)),
  onAshi: (cb: (x: AshiEvent) => void): Promise<UnlistenFn> => listen<AshiEvent>("ashi", (e) => cb(e.payload)),
  onOllamaSetup: (cb: (x: AiSetupProgress) => void): Promise<UnlistenFn> => listen<AiSetupProgress>("ollama-setup", (e) => cb(e.payload)),
  onThumb: (cb: (x: { path: string; thumb: string | null }) => void): Promise<UnlistenFn> =>
    listen<{ path: string; thumb: string | null }>("screenshot-thumb", (e) => cb(e.payload)),
  onScreenshotTaken: (cb: (x: { instanceId: string }) => void): Promise<UnlistenFn> =>
    listen<{ instanceId: string }>("screenshot-taken", (e) => cb(e.payload)),
  onUpdate: (cb: (x: UpdateStatus) => void): Promise<UnlistenFn> => listen<UpdateStatus>("update-status", (e) => cb(e.payload)),
  onMsLogin: (cb: (x: MsLoginEvent) => void): Promise<UnlistenFn> => listen<MsLoginEvent>("ms-login", (e) => cb(e.payload)),
};

/** Tarayıcıda (vite dev, Tauri dışı) UI geliştirmeyi kırmamak için. */
export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Oyun içi Mod Merkezi'nde bekleyen değişiklik */
export interface LiveOp {
  kind: "enable" | "disable" | "delete" | "update" | "install";
  ids: string[];
  label: string;
  at: number;
  /** Yeni oturum bu değişiklikle açılamadıysa sebebi */
  failed?: string;
}
