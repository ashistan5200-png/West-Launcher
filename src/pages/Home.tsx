import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Boxes, Clock, Compass, Download, Loader2, Newspaper, Play, Plus, Square, Timer, UserRound } from "lucide-react";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { useAccounts } from "@/stores/accounts";
import { InstanceCard } from "@/components/InstanceCard";
import { CoverArt } from "@/components/CoverArt";
import { InstanceBanner } from "@/components/InstanceBanner";
import { Logo } from "@/components/Logo";
import { api, isTauri } from "@/lib/ipc";
import type { PatchNote } from "@/lib/types";
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
  const playable = useMemo(
    () => instances.filter((i) => !i.isTemplate).sort((a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? "")),
    [instances],
  );
  const hero = playable[0];
  const totalSecs = playable.reduce((s, i) => s + i.totalPlaySecs, 0);
  const [news, setNews] = useState<PatchNote[]>([]);
  useEffect(() => {
    if (isTauri()) api.newsPatchNotes().then((n) => setNews(n.slice(0, 3))).catch(() => {});
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
            <button className="btn btn-ghost btn-xl" onClick={() => navigate("/browse")}><Compass size={18} /> {tx("Modpack keşfet")}</button>
          </div>
        </div>
      </div>
    );
  }

  const heroRunning = running[hero.id] !== undefined;
  const heroLaunching = !!launching[hero.id];

  return (
    <div className="home">
      <motion.section className="hero2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <InstanceBanner instance={hero} className="hero2-art" wide />
        <div className="hero2-shade" />
        <div className="hero2-body">
          <span className="eyebrow2">{greet()}{account ? `, ${account.username}` : ""} {tx("· kaldığın yerden devam et")}</span>
          <h1 className="hero2-title">{hero.name}</h1>
          <div className="hero2-meta">
            <span className={`loader-badge ${hero.loader.kind}`}>{LOADER_LABEL[hero.loader.kind]}</span>
            <span>{tx("Minecraft")} {hero.mcVersion}</span>
            <span className="dot" />
            <span><Timer size={14} /> {formatDuration(hero.totalPlaySecs)}</span>
            <span className="dot" />
            <span><Clock size={14} /> {formatRelative(hero.lastPlayed)}</span>
          </div>
          <div className="hero2-actions">
            <button
              className={tx("btn hero2-play {0}", heroRunning ? "btn-danger" : "btn-primary")}
              disabled={heroLaunching}
              onClick={() => (heroRunning ? kill(hero.id) : launch(hero.id, offlineName))}
            >
              {heroLaunching ? <Loader2 size={20} className="spin" /> : heroRunning ? <Square size={17} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              {heroLaunching ? tx("Hazırlanıyor…") : heroRunning ? tx("Durdur") : tx("Oyna")}
            </button>
            <button className="btn btn-glass" onClick={() => navigate(`/instance/${hero.id}`)}>{tx("Instance'ı aç")} <ArrowRight size={16} /></button>
          </div>
        </div>
      </motion.section>

      <section className="stat-row">
        <Stat icon={Timer} label={tx("Toplam oyun süresi")} value={formatDuration(totalSecs)} />
        <Stat icon={Boxes} label={tx("Instance")} value={String(playable.length)} onClick={() => navigate("/library")} />
        <Stat icon={UserRound} label={tx("Hesap")} value={account?.username ?? tx("Ekle")} sub={account ? (account.kind === "microsoft" ? tx("Microsoft") : tx("Offline")) : undefined} onClick={() => navigate("/skins")} />
        <Stat icon={Download} label={tx("İçerik bul")} value={tx("Keşfet")} sub={tx("Modrinth")} onClick={() => navigate("/browse")} />
      </section>

      {playable.length > 1 && (
        <section>
          <div className="section-head2">
            <h2>{tx("Son oynananlar")}</h2>
            <button className="btn-link" onClick={() => navigate("/library")}>{tx("Tümünü gör")} <ArrowRight size={14} /></button>
          </div>
          <div className="grid2">{playable.slice(1, 7).map((i) => <InstanceCard key={i.id} instance={i} />)}</div>
        </section>
      )}

      {news.length > 0 && (
        <section>
          <div className="section-head2">
            <h2>{tx("Minecraft'ta neler var")}</h2>
            <button className="btn-link" onClick={() => navigate("/news")}>{tx("Haberler")} <ArrowRight size={14} /></button>
          </div>
          <div className="news-row">
            {news.map((n) => (
              <button key={n.id} className="news-card" onClick={() => navigate("/news")}>
                {n.image ? <img src={n.image} alt="" loading="lazy" /> : <CoverArt seed={n.id} className="news-card-art" />}
                <div className="news-card-body">
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

function Stat({ icon: Icon, label, value, sub, onClick }: { icon: typeof Timer; label: string; value: string; sub?: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`stat ${onClick ? "clickable" : ""}`} onClick={onClick}>
      <span className="stat-ico"><Icon size={18} /></span>
      <span className="stat-text">
        <span className="stat-label">{label}</span>
        <strong className="truncate">{value}</strong>
        {sub && <span className="tiny muted">{sub}</span>}
      </span>
    </Tag>
  );
}
