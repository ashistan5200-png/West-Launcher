export type LoaderKind = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

export interface Loader {
  kind: LoaderKind;
  version: string | null;
}

export interface Instance {
  id: string;
  name: string;
  icon: string | null;
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
  microsoftClientId: string | null;
  /** Ashi'nin yapay zekası: ücretsiz yerel model, kendi Claude anahtarın veya kapalı */
  aiProvider: "ollama" | "claude" | "off";
  ollamaUrl: string;
  ollamaModel: string;
  onboardingDone: boolean;
  companionEnabled: boolean;
  discordRpc: boolean;
  discordClientId: string | null;
  autoUpdate: boolean;
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
}

export type HuntVerdict =
  | { kind: "culprit"; mods: ModBrief[] }
  | { kind: "combination"; suspects: ModBrief[] }
  | { kind: "notReproduced" };

export type HuntPhase = "baseline" | "hunting" | "verify" | "done";

export interface AshiEvent {
  instanceId: string;
  kind: "started" | "testing" | "tested" | "done" | "cancelled" | "error";
  round: number;
  maxRounds: number;
  phase: HuntPhase | null;
  totalMods: number;
  enabled: number;
  suspects: number;
  outcome: "crash" | "ok" | null;
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
}

export interface SearchQuery {
  query: string;
  kind?: ContentKind;
  gameVersion?: string | null;
  loader?: string | null;
  sort?: "relevance" | "downloads" | "updated";
  limit?: number;
  offset?: number;
  sources?: ContentSource[] | null;
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
  mode: "ollama" | "claude" | "keyword";
}

export interface OllamaStatus {
  running: boolean;
  models: string[];
  modelInstalled: boolean;
}

export interface PullProgress {
  status: string;
  completed: number;
  total: number;
  done: boolean;
  error: string | null;
}

export interface SecretStatus {
  anthropic: boolean;
  curseforge: boolean;
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
  menuMode: "auto" | "button" | "off";
  pose: "idle" | "hero" | "wave";
  coachTips: boolean;
  coachEverywhere: boolean;
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
