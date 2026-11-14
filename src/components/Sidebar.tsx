import { NavLink, useNavigate } from "react-router-dom";
import { Home, Library, Settings, Plus, Play, Compass, Shirt, Images, Newspaper } from "lucide-react";
import { useChat } from "@/stores/chat";
import { AshiHead } from "./AshiHead";
import clsx from "clsx";
import { useInstances } from "@/stores/instances";
import { InstanceIcon } from "./InstanceIcon";

const NAV = [
  { to: "/", icon: Home, label: "Ana Sayfa" },
  { to: "/library", icon: Library, label: "Kütüphane" },
  { to: "/browse", icon: Compass, label: "Keşfet" },
  { to: "/skins", icon: Shirt, label: "Skin ve hesaplar" },
  { to: "/gallery", icon: Images, label: "Ekran görüntüleri" },
  { to: "/news", icon: Newspaper, label: "Haberler ve güncellemeler" },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { instances, running } = useInstances();
  const recent = instances.filter((i) => !i.isTemplate).slice(0, 6);
  const { open: chatOpen, toggle: toggleChat } = useChat();

  return (
    <nav className="sidebar">
      {NAV.map(({ to, icon: Icon, label }) => (
        <NavLink key={to} to={to} end data-tour={to} className={({ isActive }) => clsx("nav-item", isActive && "active")} title={label}>
          <Icon size={18} />
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
        <button className="nav-item nav-add" title="Yeni instance" onClick={() => navigate("/library?new=1")}>
          <Plus size={18} />
        </button>
      </div>

      <div className="sidebar-bottom">
        <button data-tour="ashi" className={clsx("nav-item nav-ashi", chatOpen && "active")} title="Ashi'ye sor" onClick={toggleChat}>
          <AshiHead size={22} />
        </button>
        <NavLink to="/settings" className={({ isActive }) => clsx("nav-item", isActive && "active")} title="Ayarlar">
          <Settings size={18} />
        </NavLink>
      </div>
    </nav>
  );
}
