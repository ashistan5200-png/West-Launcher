import { NavLink, useNavigate } from "react-router-dom";
import { Home, Library, Settings, Plus, Compass, Shirt, Images, Newspaper } from "lucide-react";
import clsx from "clsx";
import { useChat } from "@/stores/chat";
import { useInstances } from "@/stores/instances";
import { AshiHead } from "./AshiHead";
import { InstanceIcon } from "./InstanceIcon";
import { tx } from "@/lib/i18n";

const NAV = [
  { to: "/", icon: Home, label: tx("Ana sayfa") },
  { to: "/library", icon: Library, label: tx("Kütüphane") },
  { to: "/browse", icon: Compass, label: tx("Keşfet") },
  { to: "/skins", icon: Shirt, label: tx("Skinler") },
  { to: "/gallery", icon: Images, label: tx("Galeri") },
  { to: "/news", icon: Newspaper, label: tx("Haberler") },
];

/** Sol gezinme: sayfalar, son instance'lar (adlarıyla), en altta Ashi ve Ayarlar. Dar pencerede simgelere iner. */
export function Sidebar() {
  const navigate = useNavigate();
  const { instances, running } = useInstances();
  const recent = instances
    .filter((i) => !i.isTemplate)
    .sort((a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? ""))
    .slice(0, 6);
  const { open: chatOpen, toggle: toggleChat } = useChat();

  return (
    <nav className="rota-side" aria-label={tx("Gezinme")}>
      <div className="rota-side-group">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"} data-tour={to} className={({ isActive }) => clsx("rota-nav", isActive && "active")} title={label}>
            <Icon size={17} />
            <span className="rota-nav-label">{label}</span>
          </NavLink>
        ))}
      </div>

      <div className="rota-side-head">
        <span className="rota-nav-label">{tx("Instance'lar")}</span>
        <button className="rota-side-add" title={tx("Yeni instance")} aria-label={tx("Yeni instance")} onClick={() => navigate("/library?new=1")}><Plus size={15} /></button>
      </div>
      <div className="rota-side-group rota-side-instances">
        {recent.map((i) => (
          <NavLink key={i.id} to={`/instance/${i.id}`} className={({ isActive }) => clsx("rota-nav rota-nav-inst", isActive && "active")} title={i.name}>
            <InstanceIcon instance={i} size={22} />
            <span className="rota-nav-label truncate">{i.name}</span>
            {running[i.id] !== undefined && <span className="rota-live" title={tx("Çalışıyor")} />}
          </NavLink>
        ))}
      </div>

      <div className="rota-side-group rota-side-bottom">
        <button data-tour="ashi" className={clsx("rota-nav", chatOpen && "active")} title={tx("Ashi'ye sor")} onClick={toggleChat}>
          <AshiHead size={18} />
          <span className="rota-nav-label">{tx("Ashi'ye sor")}</span>
        </button>
        <NavLink to="/settings" className={({ isActive }) => clsx("rota-nav", isActive && "active")} title={tx("Ayarlar")}>
          <Settings size={17} />
          <span className="rota-nav-label">{tx("Ayarlar")}</span>
        </NavLink>
      </div>
    </nav>
  );
}
