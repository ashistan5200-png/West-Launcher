import { NavLink, useNavigate } from "react-router-dom";
import { Store, Warehouse, Home, Library, Settings, Plus, Play, Compass, Shirt, Images, Newspaper, MessagesSquare } from "lucide-react";
import { useSocial } from "@/stores/social";
import { useChat } from "@/stores/chat";
import { AshiHead } from "./AshiHead";
import clsx from "clsx";
import { useInstances } from "@/stores/instances";
import { InstanceIcon } from "./InstanceIcon";
import { tx } from "@/lib/i18n";

const NAV = [
  { to: "/", icon: Home, label: tx("Ana Sayfa"), short: tx("Ana") },
  { to: "/library", icon: Library, label: tx("Kütüphane"), short: tx("Kütüphane") },
  { to: "/browse", icon: Compass, label: tx("Keşfet"), short: tx("Keşfet") },
  { to: "/depot", icon: Warehouse, label: tx("West Depo: topluluk dosyaları"), short: tx("Depo") },
  { to: "/social", icon: MessagesSquare, label: tx("West sosyal"), short: tx("Sosyal") },
  { to: "/skins", icon: Shirt, label: tx("Skin ve hesaplar"), short: tx("Skin") },
  { to: "/shop", icon: Store, label: tx("West Coin mağazası"), short: tx("Mağaza") },
  { to: "/gallery", icon: Images, label: tx("Ekran görüntüleri"), short: tx("Galeri") },
  { to: "/news", icon: Newspaper, label: tx("Haberler ve güncellemeler"), short: tx("Haberler") },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { instances, running } = useInstances();
  const recent = instances.filter((i) => !i.isTemplate).slice(0, 6);
  const { open: chatOpen, toggle: toggleChat } = useChat();
  const unread = useSocial((s) => s.unread.notifications + s.unread.messages);

  return (
    <nav className="sidebar">
      {NAV.map(({ to, icon: Icon, label, short }) => (
        <NavLink key={to} to={to} end={to === "/"} data-tour={to} className={({ isActive }) => clsx("nav-item labeled", isActive && "active")} title={label}>
          <span className="nav-ico"><Icon size={19} />{to === "/social" && unread > 0 && <em className="nav-badge">{unread > 9 ? "9+" : unread}</em>}</span>
          <span className="nav-label">{short}</span>
        </NavLink>
      ))}

      <div className="sidebar-sep" />

      <div className="sidebar-instances">
        {recent.map((i) => (
          <NavLink
            key={i.id}
            to={`/instance/${i.id}`}
            className={({ isActive }) => clsx("nav-instance", isActive && "active")}
            title={i.name}
          >
            <InstanceIcon instance={i} size={34} />
            {running[i.id] !== undefined && (
              <span className="running-dot">
                <Play size={8} fill="currentColor" />
              </span>
            )}
          </NavLink>
        ))}
        <button className="nav-item nav-add" title={tx("Yeni instance")} onClick={() => navigate("/library?new=1")}>
          <Plus size={18} />
        </button>
      </div>

      <div className="sidebar-bottom">
        <button data-tour="ashi" className={clsx("nav-item nav-ashi", chatOpen && "active")} title={tx("Ashi'ye sor")} onClick={toggleChat}>
          <AshiHead size={22} />
        </button>
        <NavLink to="/settings" className={({ isActive }) => clsx("nav-item", isActive && "active")} title={tx("Ayarlar")}>
          <Settings size={18} />
        </NavLink>
      </div>
    </nav>
  );
}
