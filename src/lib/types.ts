export type LoaderKind = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

export interface Loader {
  kind: LoaderKind;
  version: string | null;
}

export interface Instance {
  id: string;
  name: string;
  icon: string | null;
  /** Özel banner görseli (yerel dosya yolu) */
  banner?: string | null;
  /** Prosedürel manzara tohumu */
  coverSeed?: string | null;
  group: string | null;
  mcVersion: string;
  loader: Loader;
  versionId: string | null;
  javaPath: string | null;
  memoryMb: number | null;
  extraJvmArgs: string[];
  resolution: [number, number] | null;
  isTemplate: boolean;
  created: string;
  lastPlayed: string | null;
  totalPlaySecs: number;
  importedFrom: string | null;
}

export interface NewInstance {
  name: string;
  mcVersion: string;
  loader: Loader;
  icon?: string | null;
  group?: string | null;
}

export interface ThemeSettings {
  accent: string;
  blur: number;
  opacity: number;
  windowEffect: "mica" | "acrylic" | "none";
  density: "compact" | "comfortable";
  reduceMotion: boolean;
  /** İmlecin arkasında, altındaki rengi alan piksel parçacıklar */
  cursorTrail: boolean;
}

export interface Accessibility {
  /** Zayıf bilgisayarlar için ana anahtar */
  performanceMode: boolean;
  westMenus: boolean;
  westHud: boolean;
  gameAnimations: boolean;
  smoothFont: boolean;
  perfMods: boolean;
  lowGraphics: boolean;
  launcherEffects: boolean;
}

export interface GameDefaults {
  resolution: [number, number] | null;
  fullscreen: boolean;
  jvmArgs: string[];
  preLaunch: string;
  postExit: string;
  wrapper: string;
}

export interface Settings {
  theme: ThemeSettings;
  defaultMemoryMb: number | null;
  autoJava: boolean;
  maxConcurrentDownloads: number;
  backupOnExit: boolean;
  backupDir: string | null;
  backupKeep: number;
  closeOnLaunch: boolean;
  /** Oyun açılınca launcher: açık kalsın / küçült / gizle (oyun kapanınca geri gelir) */
  launchBehavior: "keep" | "minimize" | "hide";
  /** Açılışta gösterilen sayfa */
  startPage: string;
  game: GameDefaults;
  microsoftClientId: string | null;
  /** Ashi'nin yapay zekası: ücretsiz yerel model (Ollama) veya anahtar kelime modu */
  aiProvider: "ollama" | "claude" | "off";
  claudeModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  onboardingDone: boolean;
  companionEnabled: boolean;
  discordRpc: boolean;
  discordClientId: string | null;
  autoUpdate: boolean;
  /** West arka plan müziği (launcher ve oyun menüleri) */
  music: boolean;
  musicInGame: boolean;
  /** Arayüz dili; boş → sistem dilinden seçilir */
  language: "" | "tr" | "en" | "de";
  accessibility: Accessibility;
}

export interface ManifestEntry {
  id: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha";
  url: string;
  releaseTime: string;
}

export interface LoaderVersion {
  version: string;
  stable: boolean;
}

export interface JavaInstall {
  path: string;
  version: string;
  major: number;
  arch: string;
  managed: boolean;
}

export interface Hardware {
  totalMemoryMb: number;
  availableMemoryMb: number;
  logicalCores: number;
  cpuBrand: string;
}

export interface JvmProfile {
  memoryMb: number;
  gc: "GenerationalZgc" | "G1";
  flags: string[];
  reason: string;
}

export interface Progress {
  task: string;
  stage: string;
  current: number;
  total: number;
  message: string | null;
}

export interface GameLog {
  instanceId: string;
  line: string;
  stderr: boolean;
}

export interface GameExit {
  instanceId: string;
  code: number | null;
  sessionSecs: number;
  crashed: boolean;
  /** Ashi'nin test çalıştırmasıysa true — UI çökme uyarısı göstermez */
  duringHunt: boolean;
  modCount: number;
}

// ───────── Ashi — Otomatik Suçlu Avcısı ─────────
export interface ModBrief {
  file: string;
  name: string;
  /** Kütüphane/çekirdek mod (Fabric API, Kotlin…) */
  library: boolean;
  /** Bu moda bağlı modlar */
  dependents: string[];
}

export type HuntVerdict =
  | { kind: "culprit"; mods: ModBrief[] }
  | { kind: "combination"; suspects: ModBrief[] }
  | { kind: "notReproduced" }
  | { kind: "dependency"; message: string };

export type HuntPhase = "baseline" | "libraries" | "hunting" | "verify" | "done";

export interface AshiEvent {
  instanceId: string;
  kind: "started" | "testing" | "tested" | "done" | "cancelled" | "error";
  round: number;
  maxRounds: number;
  phase: HuntPhase | null;
  totalMods: number;
  enabled: number;
  suspects: number;
  outcome: "crash" | "ok" | "other" | null;
  verdict: HuntVerdict | null;
  message: string | null;
}

export interface HuntPlan {
  modCount: number;
  maxRounds: number;
}

export interface AshiSkin {
  dataUrl: string;
  slim: boolean;
}

export interface RunningInfo {
  instanceId: string;
  pid: number;
  uptimeSecs: number;
}

// ───────── İçerik motoru (Modrinth + CurseForge) ─────────
export type ContentSource = "modrinth" | "curseforge";
export type ContentKind = "mod" | "modpack" | "shader" | "resourcepack";

export interface ContentHit {
  source: ContentSource;
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon: string | null;
  downloads: number;
  kind: ContentKind;
  categories: string[];
  url: string;
  alsoOn: ContentSource | null;
  clientSide?: "required" | "optional" | "unsupported" | "unknown" | null;
  serverSide?: "required" | "optional" | "unsupported" | "unknown" | null;
  versions?: string[];
  loaders?: string[];
  updated?: string | null;
  gallery?: string[];
}

/** Modrinth proje ayrıntısı (yalnızca kullanılan alanlar) */
export interface ProjectDetail {
  id: string; slug: string; title: string; description: string; body: string; project_type: string;
  categories: string[]; additional_categories?: string[]; loaders: string[]; game_versions: string[];
  client_side: string; server_side: string; downloads: number; followers: number;
  icon_url: string | null; published: string; updated: string;
  license?: { id: string; name: string; url: string | null } | null;
  source_url?: string | null; issues_url?: string | null; wiki_url?: string | null; discord_url?: string | null;
  donation_urls?: { platform: string; url: string }[];
  gallery: { url: string; raw_url?: string; title: string | null; description: string | null; featured: boolean }[];
  ownerName?: string; ownerAvatar?: string | null;
}
export interface ProjectVersion {
  id: string; name: string; version_number: string; changelog: string | null; date_published: string;
  downloads: number; version_type: "release" | "beta" | "alpha"; game_versions: string[]; loaders: string[];
  files: { filename: string; size: number; primary: boolean }[];
}

export interface WestAccount { userId: string; username: string; email: string; emailConfirmed: boolean }
export interface WestStatus { configured: boolean; account: WestAccount | null }
export interface WestSignupResult { needsConfirmation: boolean; account: WestAccount | null }

export interface ModrinthCategory { name: string; projectType: string; header: string; icon: string }
export interface GameVersionTag { version: string; versionType: "release" | "snapshot" | "alpha" | "beta" | string; major: boolean }
export interface ContentTags { categories: ModrinthCategory[]; gameVersions: GameVersionTag[] }

export interface SearchQuery {
  query: string;
  kind?: ContentKind;
  gameVersion?: string | null;
  loader?: string | null;
  sort?: "relevance" | "downloads" | "updated" | "newest" | "follows";
  limit?: number;
  offset?: number;
  sources?: ContentSource[] | null;
  categories?: string[] | null;
  environment?: "client" | "server" | "both" | null;
}

export interface SearchResult {
  hits: ContentHit[];
  total: number;
  notices: string[];
}

export interface InstallReport {
  installed: { title: string; file: string; dependencyOf: string | null }[];
  skipped: string[];
  warnings: string[];
}

export interface InstalledContent {
  source: ContentSource;
  projectId: string;
  versionId: string;
  title: string;
  file: string;
  kind: ContentKind;
  dependencyOf: string | null;
}

// ───────── Ashi asistanı ─────────
export interface Pick {
  hit: ContentHit;
  reason: string;
}

export interface ChatOutcome {
  /** Ham API geçmişi — opak tutulur, aynen geri gönderilir */
  history: unknown[];
  reply: string;
  picks: Pick[];
  searches: string[];
  /** Ashi'nin bu turda yaptığı değişiklikler */
  actions: string[];
  mode: "claude" | "ollama" | "keyword";
}

/** Ashi'nin yerel yapay zekası (Ollama) */
export interface AiStatus {
  installed: boolean;
  running: boolean;
  model: string;
  modelInstalled: boolean;
  recommended: string;
  downloadGb: number;
}

export interface AiSetupProgress {
  stage: "download" | "install" | "start" | "model" | "done" | "error";
  label: string;
  completed: number;
  total: number;
  error: string | null;
}

export interface SecretStatus {
  curseforge: boolean;
  anthropic: boolean;
}

// ───────── Hesaplar + skinler ─────────
export interface AccountView {
  uuid: string;
  username: string;
  kind: "microsoft" | "offline";
  skinId: string | null;
  active: boolean;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface MsLoginEvent {
  status: "progress" | "done" | "error" | "cancelled";
  username: string | null;
  message: string | null;
}

export interface Skin {
  id: string;
  name: string;
  slim: boolean;
  favorite: boolean;
  added: string;
  lastUsed: string | null;
  origin: string;
  dataUrl: string;
}

export interface Cape {
  id: string;
  state: "ACTIVE" | "INACTIVE";
  url: string;
  alias: string;
}

// ───────── Ekran görüntüleri ─────────
export interface Screenshot {
  path: string;
  file: string;
  instanceId: string;
  instanceName: string;
  size: number;
  modified: string;
  thumb: string | null;
  edited: boolean;
}

// ───────── Diğer launcher'lardan aktarım ─────────
export type LauncherId = "modrinth" | "curseforge" | "prism" | "multimc" | "official";

export interface FoundInstance {
  launcher: LauncherId;
  name: string;
  gameDir: string;
  mcVersion: string | null;
  loader: Loader;
  modCount: number;
  worldCount: number;
  hasShaders: boolean;
}

// ───────── West Companion (oyun içi mod) ─────────
export interface CompanionConfig {
  fullbright: boolean;
  fpsOverlay: boolean;
}

export interface CompanionInfo {
  compatible: boolean;
  enabled: boolean;
  config: CompanionConfig;
}

// ───────── Uygulama güncellemeleri ─────────
export interface UpdateInfo {
  current: string;
  version: string;
  title: string;
  notes: string;
  publishedAt: string | null;
  pageUrl: string;
  assetName: string;
  size: number;
}

export interface UpdateStatus {
  current: string;
  info: UpdateInfo | null;
  downloaded: boolean;
  downloading: boolean;
  received: number;
  total: number;
  error: string | null;
}

// ───────── Haberler ─────────
export interface PatchNote {
  id: string;
  title: string;
  version: string;
  kind: "release" | "snapshot" | string;
  date: string;
  image: string | null;
  summary: string;
  contentPath: string;
}

export interface ModUpdate {
  projectId: string;
  slug: string;
  title: string;
  icon: string | null;
  downloads: number;
  versionName: string;
  versionNumber: string;
  date: string;
  gameVersions: string[];
  loaders: string[];
  changelog: string;
  url: string;
}

export interface NewTexture { path: string; name: string; category: string }
export interface NewSound { path: string; name: string; group: string; hash: string; size: number }
export interface AssetDiff { version: string; base: string; textures: NewTexture[]; sounds: NewSound[] }

// ───────── Instance içerik yöneticisi ─────────
export interface ContentUpdate { versionId: string; versionNumber: string; fileName: string; url: string; sha1: string; size: number }
export interface ContentFile {
  id: string;
  file: string;
  kind: "mod" | "resourcepack" | "shader";
  enabled: boolean;
  size: number;
  sha1: string;
  title: string;
  version: string | null;
  author: string | null;
  authorAvatar: string | null;
  icon: string | null;
  projectId: string | null;
  source: "modrinth" | "curseforge" | null;
  url: string | null;
  update: ContentUpdate | null;
  dependencyOf: string | null;
  managed: boolean;
}
export interface UpdateReport { updated: string[]; failed: string[]; backupDir: string | null }
export interface World { folder: string; size: number; lastPlayed: number | null; icon: string | null }
export interface LogFile { path: string; size: number; modified: number; crash: boolean }
export interface FileEntry { name: string; dir: boolean; size: number; modified: number }
export interface ExportReport { path: string; linked: number; embedded: number }

// ───────── Oyun modları (Build / PvP …) ─────────
export interface GameMode {
  id: string;
  name: string;
  icon: string;
  enabled: string[];
  disabled: string[];
  hasOptions: boolean;
}
export interface GameModes {
  modes: GameMode[];
  active: string | null;
}
export interface ModeApplyReport {
  enabled: number;
  disabled: number;
  optionsRestored: boolean;
  missing: number;
}

// ───────── Ashi Taşıyıcı ─────────
export interface PortItem {
  id: string;
  title: string;
  kind: "mod" | "resourcepack" | "shader";
  icon: string | null;
  enabled: boolean;
  fromVersion: string | null;
  status: "ok" | "same" | "missing" | "unknown";
  toVersion: string | null;
}
export interface PortReport { ported: string[]; removed: string[]; keptDisabled: string[]; dependencies: string[]; failed: string[] }
export interface PortResult { instance: Instance; report: PortReport }

// ───────── Ashi Çözücü ─────────
export type CrashCause = "badResourcePath" | "outOfMemory" | "mixinFailed" | "missingClass" | "missingDependency" | "javaVersion" | "graphics" | "duplicateMod" | "unknown";
export interface CrashCulprit { file: string; name: string; ids: string[]; ours: boolean; library: boolean }
export interface FixReport { file: string; backup: string; renamed: number; patchedClasses: number; patchedFiles: number; examples: [string, string][] }
export interface CrashAnalysis {
  source: string;
  cause: CrashCause;
  detail: string | null;
  description: string | null;
  exception: string | null;
  culprit: CrashCulprit | null;
  frame: string | null;
  via: "stack" | "mixin" | "loader" | null;
}

// ───────── Kolaylaştırıcılar ─────────
export interface ServerProbe {
  address: string;
  versionName: string;
  protocol: number;
  mcVersion: string | null;
  motd: string;
  online: number;
  max: number;
  loader: string | null;
  mods: string[];
  favicon: string | null;
}
export interface ServerPrepResult {
  instance: Instance;
  probe: ServerProbe;
  installed: string[];
  missing: string[];
}
export interface FpsItem {
  slug: string;
  title: string;
  why: string;
  status: "installed" | "install" | "skip";
  note: string | null;
}
export interface Precheck {
  problems: string[];
  notes: string[];
  version: string | null;
}
export interface PerfSession {
  at: number;
  seconds: number;
  fpsAvg: number;
  fpsLow1: number;
  fpsMin: number;
  stutters: number;
  memPeakPct: number;
  memMaxMb: number;
  renderDistance: number;
  shaders: boolean;
  mods: number;
  inWorldSecs: number;
}
export interface PerfFinding {
  tone: "bad" | "warn" | "ok";
  title: string;
  text: string;
  action: "fps-pack" | "memory" | "render-distance" | null;
}
export interface PerfReport {
  sessions: PerfSession[];
  findings: PerfFinding[];
}
export interface SyncLink {
  code: string;
  role: "owner" | "member";
  updatedAt: string;
}
export interface SyncStatus {
  link: SyncLink | null;
  hasUpdate: boolean;
  remoteName: string | null;
  remoteUpdatedAt: string | null;
}
export interface SetImportReport {
  name: string;
  installed: number;
  missing: string[];
  otherVersion: string | null;
}
