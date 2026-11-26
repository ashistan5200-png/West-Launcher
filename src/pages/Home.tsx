import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FolderInput, Loader2, Play, Plus, Square } from "lucide-react";
import clsx from "clsx";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { useOnboarding } from "@/stores/onboarding";
import { InstanceBanner } from "@/components/InstanceBanner";
import { Logo } from "@/components/Logo";
import { api, isTauri } from "@/lib/ipc";
import type { Instance, PatchNote } from "@/lib/types";
import { LOADER_LABEL, formatDuration, formatRelative } from "@/lib/format";
import { tx } from "@/lib/i18n";

/**
 * Ana sayfa: tek bir iş var, son oynadığın paketi açmak. Altında diğer paketler kapaklarıyla;
 * en altta Minecraft haberleri. Oynama süresi kartın içinde yazar, ayrı istatistik bloğu yoktur.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { instances, running, launching, launch, kill } = useInstances();
  const offlineName = useSettings((s) => s.offlineName);
  const playable = useMemo(
    () => instances.filter((i) => !i.isTemplate).sort((a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? "")),
    [instances],
  );
  const [news, setNews] = useState<PatchNote[]>([]);
  useEffect(() => {
    if (isTauri()) api.newsPatchNotes().then((n) => setNews(n.slice(0, 3))).catch(() => {});
  }, []);

  const play = (i: Instance) => (running[i.id] !== undefined ? kill(i.id) : launch(i.id, offlineName));
  const hero = playable[0];

  if (!hero) {
    return (
      <div className="page rota-empty">
        <Logo size={40} />
        <h1>{tx("West Client'a hoş geldin")}</h1>
        <p className="muted">{tx("Bir instance oluştur ya da başka bir launcher'daki paketlerini taşı. Her instance kendi modlarını, dünyalarını ve ayarlarını tutar.")}</p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary btn-lg" onClick={() => navigate("/library?new=1")}><Plus size={17} /> {tx("Instance oluştur")}</button>
          <button className="btn btn-ghost btn-lg" onClick={() => useOnboarding.getState().openWizard()}><FolderInput size={17} /> {tx("Aktar")}</button>
        </div>
      </div>
    );
  }

  const others = playable.slice(1);
  const heroRunning = running[hero.id] !== undefined;
  const heroLaunching = !!launching[hero.id];

  return (
    <div className="page rota-home">
      <section className="rota-hero">
        <button className="rota-hero-cover" onClick={() => navigate(`/instance/${hero.id}`)} aria-label={tx("{0} instance'ını aç", hero.name)}>
          <InstanceBanner instance={hero} className="rota-cover-img" wide />
        </button>
        <div className="rota-hero-body">
          <span className="rota-kicker">{heroRunning ? tx("Şu an oynanıyor") : tx("Kaldığın yerden devam et")}</span>
          <h1>{hero.name}</h1>
          <p className="rota-meta">
            {LOADER_LABEL[hero.loader.kind]} {hero.mcVersion}
            <span aria-hidden> · </span>
            {formatRelative(hero.lastPlayed)}
            {hero.totalPlaySecs > 0 && <><span aria-hidden> · </span>{tx("{0} oynandı", formatDuration(hero.totalPlaySecs))}</>}
          </p>
          <div className="rota-actions">
            <button className={clsx("btn btn-lg rota-play", heroRunning ? "btn-danger" : "btn-primary")} disabled={heroLaunching} onClick={() => play(hero)}>
              {heroLaunching ? <Loader2 size={18} className="spin" /> : heroRunning ? <Square size={15} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              {heroLaunching ? tx("Hazırlanıyor…") : heroRunning ? tx("Durdur") : tx("Oyna")}
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => navigate(`/instance/${hero.id}`)}>{tx("Modlar ve ayarlar")}</button>
          </div>
        </div>
      </section>

      <section>
        <div className="rota-section-head">
          <h2>{tx("Diğer instance'lar")}</h2>
          <button className="btn-link" onClick={() => navigate("/library")}>{tx("Kütüphane")} <ArrowRight size={14} /></button>
        </div>
        <div className="rota-grid">
          {others.slice(0, 7).map((i) => {
            const r = running[i.id] !== undefined, l = !!launching[i.id];
            return (
              <div key={i.id} className={clsx("rota-card", r && "running")}>
                <button className="rota-card-cover" onClick={() => navigate(`/instance/${i.id}`)} aria-label={tx("{0} instance'ını aç", i.name)}>
                  <InstanceBanner instance={i} className="rota-cover-img" />
                </button>
                <div className="rota-card-body">
                  <div className="grow">
                    <strong className="truncate">{i.name}</strong>
                    <span className="muted small truncate">{LOADER_LABEL[i.loader.kind]} {i.mcVersion} · {formatRelative(i.lastPlayed)}</span>
                  </div>
                  <button className={clsx("rota-mini", r && "stop")} disabled={l} onClick={() => void play(i)} aria-label={r ? tx("{0}: durdur", i.name) : tx("{0}: oyna", i.name)}>
                    {l ? <Loader2 size={15} className="spin" /> : r ? <Square size={12} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                  </button>
                </div>
              </div>
            );
          })}
          <button className="rota-card rota-new" onClick={() => navigate("/library?new=1")}>
            <Plus size={20} />
            <span>{tx("Yeni instance")}</span>
          </button>
        </div>
      </section>

      {news.length > 0 && (
        <section>
          <div className="rota-section-head">
            <h2>{tx("Minecraft'ta neler var")}</h2>
            <button className="btn-link" onClick={() => navigate("/news")}>{tx("Haberler")} <ArrowRight size={14} /></button>
          </div>
          <div className="rota-news">
            {news.map((n) => (
              <button key={n.id} className="rota-news-item" onClick={() => navigate("/news")}>
                {n.image ? <img src={n.image} alt="" loading="lazy" /> : <span className="rota-news-ph" />}
                <span className="grow">
                  <span className="muted small">{n.kind === "snapshot" ? tx("Snapshot") : tx("Sürüm")} {n.version}</span>
                  <strong className="clamp-2">{n.title}</strong>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
