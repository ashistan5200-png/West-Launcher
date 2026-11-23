import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Clock, Layers, Loader2, Newspaper, Play, Plus, Square, Timer } from "lucide-react";
import clsx from "clsx";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { useAccounts } from "@/stores/accounts";
import { useWest } from "@/stores/west";
import { CoverArt } from "@/components/CoverArt";
import { InstanceBanner } from "@/components/InstanceBanner";
import { InstanceIcon } from "@/components/InstanceIcon";
import { Logo } from "@/components/Logo";
import { api, isTauri } from "@/lib/ipc";
import type { Instance, PatchNote } from "@/lib/types";
import { LOADER_LABEL, formatDuration, formatRelative } from "@/lib/format";
import { tx } from "@/lib/i18n";

const greet = () => {
  const h = new Date().getHours();
  return h < 6 ? tx("İyi geceler") : h < 12 ? tx("Günaydın") : h < 18 ? tx("İyi günler") : tx("İyi akşamlar");
};

export function HomePage() {
  const navigate = useNavigate();
  const { instances, running, launching, launch, kill } = useInstances();
  const offlineName = useSettings((s) => s.offlineName);
  const account = useAccounts((s) => s.accounts.find((a) => a.active) ?? null);
  const west = useWest((s) => s.account);
  const playable = useMemo(
    () => instances.filter((i) => !i.isTemplate).sort((a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? "")),
    [instances],
  );
  const hero = playable[0];
  const totalSecs = playable.reduce((s, i) => s + i.totalPlaySecs, 0);
  const [news, setNews] = useState<PatchNote[]>([]);
  useEffect(() => {
    if (isTauri()) api.newsPatchNotes().then((n) => setNews(n.slice(0, 4))).catch(() => {});
  }, []);

  if (!hero) {
    return (
      <div className="welcome">
        <CoverArt seed="west-client" className="welcome-art" wide />
        <div className="welcome-body">
          <Logo size={44} />
          <h1>{tx("West Client'a hoş geldin")}</h1>
          <p className="muted">{tx("İlk instance'ını oluştur ya da başka bir launcher'daki paketlerini taşı.")}</p>
          <div className="row" style={{ justifyContent: "center", gap: 10 }}>
            <button className="btn btn-primary btn-xl" onClick={() => navigate("/library?new=1")}><Plus size={18} /> {tx("Instance oluştur")}</button>
          </div>
        </div>
      </div>
    );
  }

  const heroRunning = running[hero.id] !== undefined;
  const heroLaunching = !!launching[hero.id];
  const who = west?.username ?? account?.username;
  const play = (i: Instance) => (running[i.id] !== undefined ? kill(i.id) : launch(i.id, offlineName));

  return (
    <div className="home3">
      <div className="home3-top">
        <motion.section className="home3-hero" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <InstanceBanner instance={hero} className="home3-art" wide />
          <div className="home3-shade" />
          <div className="home3-body">
            <span className="home3-eyebrow">{greet()}{who ? `, ${who}` : ""}</span>
            <h1 className="home3-title">{hero.name}</h1>
            <div className="home3-meta">
              <span className={`loader-badge ${hero.loader.kind}`}>{LOADER_LABEL[hero.loader.kind]}</span>
              <span>{tx("Minecraft")} {hero.mcVersion}</span>
              <span className="dot" />
              <span><Timer size={13} /> {formatDuration(hero.totalPlaySecs)}</span>
              <span className="dot" />
              <span><Clock size={13} /> {formatRelative(hero.lastPlayed)}</span>
            </div>
            <div className="home3-actions">
              <button className={clsx("btn home3-play", heroRunning ? "btn-danger" : "btn-primary")} disabled={heroLaunching} onClick={() => play(hero)}>
                {heroLaunching ? <Loader2 size={20} className="spin" /> : heroRunning ? <Square size={16} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                {heroLaunching ? tx("Hazırlanıyor…") : heroRunning ? tx("Durdur") : tx("Oyna")}
              </button>
              <button className="btn btn-glass" onClick={() => navigate(`/instance/${hero.id}`)}>{tx("Instance'ı aç")} <ArrowRight size={15} /></button>
            </div>
          </div>
          <div className="home3-chips">
            <span><Timer size={13} /> {tx("Toplam {0}", formatDuration(totalSecs))}</span>
            <span><Layers size={13} /> {tx("{0} instance", playable.length)}</span>
          </div>
        </motion.section>

        <aside className="home3-side">
          <div className="home3-side-head">
            <h2>{tx("Hızlı başlat")}</h2>
            <button className="icon-btn" title={tx("Yeni instance")} onClick={() => navigate("/library?new=1")}><Plus size={16} /></button>
          </div>
          <div className="home3-list">
            {playable.slice(1, 8).map((i) => {
              const r = running[i.id] !== undefined, l = !!launching[i.id];
              return (
                <div key={i.id} className={clsx("home3-row", r && "running")} onClick={() => navigate(`/instance/${i.id}`)}>
                  <InstanceIcon instance={i} size={36} />
                  <div className="grow">
                    <strong className="truncate">{i.name}</strong>
                    <span className="muted tiny">{LOADER_LABEL[i.loader.kind]} {i.mcVersion} · {formatRelative(i.lastPlayed)}</span>
                  </div>
                  <button className={clsx("home3-mini", r && "stop")} disabled={l} onClick={(e) => { e.stopPropagation(); void play(i); }} aria-label={r ? tx("Durdur") : tx("Oyna")}>
                    {l ? <Loader2 size={15} className="spin" /> : r ? <Square size={12} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                  </button>
                </div>
              );
            })}
            {playable.length === 1 && <p className="muted small home3-empty">{tx("Başka instance yok. Yeni bir tane oluştur ya da diğer launcher'lardan aktar.")}</p>}
          </div>
          <button className="btn btn-ghost btn-sm home3-all" onClick={() => navigate("/library")}>{tx("Kütüphaneyi aç")} <ArrowRight size={14} /></button>
        </aside>
      </div>

      {playable.some((i) => i.totalPlaySecs > 0) && (
        <section>
          <div className="section-head2"><h2>{tx("En çok oynadıkların")}</h2></div>
          <div className="home3-top-played">
            {[...playable].filter((i) => i.totalPlaySecs > 0).sort((a, b) => b.totalPlaySecs - a.totalPlaySecs).slice(0, 5).map((i, k, arr) => (
              <button key={i.id} className="home3-bar" onClick={() => navigate(`/instance/${i.id}`)}>
                <span className="home3-rank">{k + 1}</span>
                <InstanceIcon instance={i} size={30} />
                <div className="grow">
                  <div className="row between"><strong className="truncate">{i.name}</strong><span className="muted small">{formatDuration(i.totalPlaySecs)}</span></div>
                  <div className="home3-track"><span style={{ width: `${Math.max(4, (i.totalPlaySecs / arr[0].totalPlaySecs) * 100)}%` }} /></div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {news.length > 0 && (
        <section>
          <div className="section-head2">
            <h2>{tx("Minecraft'ta neler var")}</h2>
            <button className="btn-link" onClick={() => navigate("/news")}>{tx("Haberler")} <ArrowRight size={14} /></button>
          </div>
          <div className="home3-news">
            {news.map((n) => (
              <button key={n.id} className="home3-news-card" onClick={() => navigate("/news")}>
                {n.image ? <img src={n.image} alt="" loading="lazy" /> : <CoverArt seed={n.id} className="news-card-art" />}
                <div>
                  <span className={`news-kind ${n.kind}`}><Newspaper size={12} /> {n.kind === "snapshot" ? tx("Snapshot") : tx("Sürüm")} {n.version}</span>
                  <strong className="clamp-2">{n.title}</strong>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
