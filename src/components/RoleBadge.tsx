import { Crown, ShieldCheck, Gavel } from "lucide-react";
import clsx from "clsx";
import { ROLE_LABEL, type Role } from "@/lib/depot";

/** West rolü rozeti: Onaylı, Moderatör, Yönetici (Üye için hiçbir şey gösterilmez) */
export function RoleBadge({ role, size = "sm", showMember = false }: { role: Role | null | undefined; size?: "xs" | "sm"; showMember?: boolean }) {
  if (!role || (role === "member" && !showMember)) return null;
  const Icon = role === "admin" ? Crown : role === "moderator" ? Gavel : ShieldCheck;
  return (
    <span className={clsx("role-badge", `role-${role}`, size)} title={ROLE_LABEL[role]}>
      {role !== "member" && <Icon size={size === "xs" ? 10 : 12} />} {ROLE_LABEL[role]}
    </span>
  );
}
