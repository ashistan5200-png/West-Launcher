import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Compass, FolderInput, Gauge, Loader2, Play, Plus, Server, Sparkles, Square } from "lucide-react";
import clsx from "clsx";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { useOnboarding } from "@/stores/onboarding";
import { useChat } from "@/stores/chat";
import { InstanceBanner } from "@/components/InstanceBanner";
import { Logo } from "@/components/Logo";
import { ServerPrepModal } from "@/components/features/ServerPrepModal";
import { FpsPackModal } from "@/components/features/FpsPackModal";
import { api, isTauri } from "@/lib/ipc";
import type { Instance, PatchNote } from "@/lib/types";
import { LOADER_LABEL, formatDuration, formatRelative } from "@/lib/format";
import { tx } from "@/lib/i18n";

/**
 * Ana sayfa. Üstte son oynanan paketin kapağı tüm genişlikte; adı ve Oyna düğmesi kapağın üstünde.
 * Altında tek tıklık işler (sunucuya göre paket, FPS paketi, Ashi ile modpack, keşfet, aktar),
 * sonra diğer paketler ve Minecraft haberleri.
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
  const [modal, setModal] = useState<null | "server" | "fps">(null);
  const [modCount, setModCount] = useState<number | null>(null);
  const hero = playable[0];

  useEffect(() => {
    if (isTauri()) api.newsPatchNotes().then((n) => setNews(n.slice(0, 3))).catch(() => {});
  }, []);
  useEffect(() => {
    setModCount(null);
    if (hero && isTauri()) api.listContent(hero.id).then((c) => setModCount(Array.isArray(c) ? c.filter((x) => x.kind === "mod" && x.enabled).length : null)).catch(() => {});
  }, [hero?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (i: Instance) => (running[i.id] !== undefined ? kill(i.id) : launch(i.id, offlineName));
  const askAshi = () => {
    useChat.getState().setActiveInstance(null);
    useChat.getState().setDraft(tx("Bana bir modpack kur: "));
    useChat.getState().setOpen(true);
  };

  const quick = [
    { icon: Server, title: tx("Sunucuya göre hazırla"), text: tx("Adresi yaz; sürüm ve gereken modlar kurulsun"), run: () => setModal("server") },
    { icon: Sparkles, title: tx("Ashi ile modpack"), text: tx("Ne istediğini anlat, paketi Ashi kursun"), run: askAshi },
    { icon: Gauge, title: tx("FPS paketi"), text: hero ? tx("{0} için performans modları", hero.name) : tx("Performans modlarını tek tıkla kur"), run: () => (hero ? setModal("fps") : navigate("/library?new=1")) },
    { icon: Compass, title: tx("Mod keşfet"), text: tx("Modrinth'te ara, uyumlu olanı kur"), run: () => navigate(hero ? `/browse?instance=${encodeURIComponent(hero.id)}` : "/browse") },
    { icon: FolderInput, title: tx("Başka launcher'dan aktar"), text: tx("Prism, CurseForge, Modrinth App…"), run: () => useOnboarding.getState().openWizard() },
  ];

  const modals = (
    <>
      {modal === "server" && <ServerPrepModal onClose={() => setModal(null)} />}
      {modal === "fps" && hero && <FpsPackModal instance={hero} onClose={() => setModal(null)} />}
    </>
  );

  if (!hero) {
    return (
      <div className="page h2">
        <section className="h2-welcome">
          <Logo size={44} />
          <h1>{tx("West Client'a hoş geldin")}</h1>
          <p>{tx("Bir instance oluştur ya da başka bir launcher'daki paketlerini taşı. Her instance kendi modlarını, dünyalarını ve ayarlarını tutar.")}</p>
          <div className="row" style={{ gap: 8, justifyContent: "center" }}>
            <button className="btn btn-primary btn-lg" onClick={() => navigate("/library?new=1")}><Plus size={17} /> {tx("Instance oluştur")}</button>
            <button className="btn btn-ghost btn-lg" onClick={() => useOnboarding.getState().openWizard()}><FolderInput size={17} /> {tx("Aktar")}</button>
          </div>
        </section>
        <QuickGrid items={quick.filter((q) => q.icon !== Gauge)} />
        {modals}
      </div>
    );
  }

  const others = playable.slice(1, 8);
  const heroRunning = running[hero.id] !== undefined;
  const heroLaunching = !!launching[hero.id];

  return (
    <div className="page h2">
      {/* ── Karşılama: kapak tüm genişlikte ── */}
      <section className="h2-hero">
        <InstanceBanner instance={hero} className="h2-hero-img" wide />
        <div className="h2-hero-shade" />
        <div className="h2-hero-body">
          <span className={clsx("h2-kicker", heroRunning && "live")}>{heroRunning ? tx("Şu an oynanıyor") : tx("Kaldığın yerden devam et")}</span>
          <h1>{hero.name}</h1>
          <div className="h2-facts">
            <span>{LOADER_LABEL[hero.loader.kind]} {hero.mcVersion}</span>
            {modCount !== null && modCount > 0 && <span>{tx("{0} mod", modCount)}</span>}
            {hero.totalPlaySecs > 0 && <span>{tx("{0} oynandı", formatDuration(hero.totalPlaySecs))}</span>}
            <span>{formatRelative(hero.lastPlayed)}</span>
          </div>
          <div className="h2-actions">
            <button className={clsx("btn btn-lg h2-play", heroRunning ? "btn-danger" : "btn-primary")} disabled={heroLaunching} onClick={() => play(hero)}>
              {heroLaunching ? <Loader2 size={18} className="spin" /> : heroRunning ? <Square size={15} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              {heroLaunching ? tx("Hazırlanıyor…") : heroRunning ? tx("Durdur") : tx("Oyna")}
            </button>
            <button className="btn btn-lg h2-glass" onClick={() => navigate(`/instance/${hero.id}`)}>{tx("Modlar ve ayarlar")}</button>
          </div>
        </div>
      </section>

      <QuickGrid items={quick} />

      {/* ── Diğer paketler ── */}
      <section>
        <div className="rota-section-head">
          <h2>{tx("Paketlerin")}</h2>
          <button className="btn-link" onClick={() => navigate("/library")}>{tx("Kütüphane")} <ArrowRight size={14} /></button>
        </div>
        <div className="h2-shelf">
          {others.map((i) => {
            const r = running[i.id] !== undefined, l = !!launching[i.id];
            return (
              <div key={i.id} className={clsx("h2-tile", r && "running")}>
                <button className="h2-tile-cover" onClick={() => navigate(`/instance/${i.id}`)} aria-label={tx("{0} instance'ını aç", i.name)}>
                  <InstanceBanner instance={i} className="rota-cover-img" />
                </button>
                <div className="h2-tile-body">
                  <div className="grow">
                    <strong className="truncate">{i.name}</strong>
                    <span className="truncate">{LOADER_LABEL[i.loader.kind]} {i.mcVersion} · {formatRelative(i.lastPlayed)}</span>
                  </div>
                  <button className={clsx("rota-mini", r && "stop")} disabled={l} onClick={() => void play(i)} aria-label={r ? tx("{0}: durdur", i.name) : tx("{0}: oyna", i.name)}>
                    {l ? <Loader2 size={15} className="spin" /> : r ? <Square size={12} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                  </button>
                </div>
              </div>
            );
          })}
          <button className="h2-tile h2-tile-new" onClick={() => navigate("/library?new=1")}>
            <Plus size={20} />
            <span>{tx("Yeni instance")}</span>
          </button>
        </div>
      </section>

      {/* ── Haberler ── */}
      {news.length > 0 && (
        <section>
          <div className="rota-section-head">
            <h2>{tx("Minecraft'ta neler var")}</h2>
            <button className="btn-link" onClick={() => navigate("/news")}>{tx("Haberler")} <ArrowRight size={14} /></button>
          </div>
          <div className="h2-news">
            {news.map((n, idx) => (
              <button key={n.id} className={clsx("h2-news-item", idx === 0 && "lead")} onClick={() => navigate("/news")}>
                {n.image ? <img src={n.image} alt="" loading="lazy" /> : <span className="h2-news-ph" />}
                <span className="h2-news-text">
                  <span>{n.kind === "snapshot" ? tx("Snapshot") : tx("Sürüm")} {n.version}</span>
                  <strong className="clamp-2">{n.title}</strong>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {modals}
    </div>
  );
}

function QuickGrid({ items }: { items: { icon: typeof Play; title: string; text: string; run: () => void }[] }) {
  return (
    <section className="h2-quick" aria-label={tx("Hızlı işler")}>
      {items.map((q) => (
        <button key={q.title} className="h2-quick-item" onClick={q.run}>
          <span className="h2-quick-icon"><q.icon size={18} /></span>
          <span className="grow">
            <strong>{q.title}</strong>
            <span>{q.text}</span>
          </span>
        </button>
      ))}
    </section>
  );
}
