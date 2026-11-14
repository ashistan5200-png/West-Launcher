import { useNavigate } from "react-router-dom";
import { Play, Plus, Clock, Square, Loader2 } from "lucide-react";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { InstanceCard } from "@/components/InstanceCard";
import { InstanceIcon } from "@/components/InstanceIcon";
import { Logo } from "@/components/Logo";
import { useAccounts } from "@/stores/accounts";
import { SkinThumb } from "@/components/SkinThumb";
import { LOADER_LABEL, formatDuration, formatRelative } from "@/lib/format";

export function HomePage() {
  const navigate = useNavigate();
  const { instances, running, launching, launch, kill } = useInstances();
  const { offlineName, setOfflineName } = useSettings();
  const account = useAccounts((s) => s.accounts.find((a) => a.active) ?? null);
  const accountSkin = useAccounts((s) => s.skins.find((k) => k.id === account?.skinId) ?? null);
  const playable = instances.filter((i) => !i.isTemplate);
  const hero = playable[0];

  if (!hero) {
    return (
      <div className="empty">
        <Logo size={40} />
        <h2>West Launcher'a hoş geldin</h2>
        <p className="muted">İlk instance'ını oluştur veya başka bir launcher'dan içe aktar.</p>
        <button className="btn btn-primary" onClick={() => navigate("/library?new=1")}>
          <Plus size={16} /> Instance oluştur
        </button>
      </div>
    );
  }

  const heroRunning = running[hero.id] !== undefined;
  const heroLaunching = !!launching[hero.id];

  return (
    <div className="stack-lg">
      <section className="hero card">
        <InstanceIcon instance={hero} size={72} />
        <div className="hero-text">
          <span className="eyebrow">Kaldığın yerden devam et</span>
          <h1>{hero.name}</h1>
          <div className="chips">
            <span className="chip">{LOADER_LABEL[hero.loader.kind]}</span>
            <span className="chip">{hero.mcVersion}</span>
            <span className="chip"><Clock size={12} /> {formatDuration(hero.totalPlaySecs)}</span>
            <span className="muted small">{formatRelative(hero.lastPlayed)}</span>
          </div>
        </div>
        <div className="hero-actions">
          {account ? (
            <button className="account-chip" onClick={() => navigate("/skins")} title="Hesabı değiştir">
              {accountSkin ? <SkinThumb dataUrl={accountSkin.dataUrl} slim={accountSkin.slim} height={30} /> : null}
              <span>
                <strong>{account.username}</strong>
                <span className="muted tiny">{account.kind === "microsoft" ? "Microsoft" : "Offline"}</span>
              </span>
            </button>
          ) : (
            <input
              className="input-sm"
              value={offlineName}
              onChange={(e) => setOfflineName(e.target.value)}
              placeholder="Offline kullanıcı adı"
              title="Hesap eklemek için Skin ve hesaplar sayfasına git"
            />
          )}
          <button
            className={`btn btn-xl ${heroRunning ? "btn-danger" : "btn-primary"}`}
            disabled={heroLaunching}
            onClick={() => (heroRunning ? kill(hero.id) : launch(hero.id, offlineName))}
          >
            {heroLaunching ? <Loader2 size={18} className="spin" /> : heroRunning ? <Square size={16} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            {heroLaunching ? "Hazırlanıyor" : heroRunning ? "Durdur" : "Oyna"}
          </button>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Son oynananlar</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/library")}>Tümü</button>
        </div>
        <div className="grid">
          {playable.slice(1, 9).map((i) => <InstanceCard key={i.id} instance={i} />)}
        </div>
      </section>
    </div>
  );
}
