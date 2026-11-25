import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Gamepad2, Globe2, Plus, Play, Wifi, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { InstanceIcon } from "@/components/InstanceIcon";
import { Avatar } from "@/components/social/PostCard";
import { startInvitePolling, useInvites, type WorldInvite } from "@/stores/invites";
import { useInstances } from "@/stores/instances";
import { useAccounts } from "@/stores/accounts";
import { useSettings } from "@/stores/settings";
import { formatRelative, LOADER_LABEL, errorText } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { tx } from "@/lib/i18n";

const who = (inv: WorldInvite) => inv.from?.display_name || inv.from?.username || tx("Bir arkadaşın");

/** Davetin bağlantı türü: kısa etiket + açıklama */
function reach(inv: WorldInvite) {
  if (inv.kind === "lan") return { label: tx("Aynı ağ"), hint: tx("Bu dünya yalnızca davet edenle aynı internete (modeme) bağlı olanlara açık."), warn: true };
  if (inv.kind === "upnp") return { label: tx("İnternet"), hint: tx("Dünya, davet edenin modemi üzerinden açıldı."), warn: false };
  return { label: tx("Her ağdan"), hint: tx("Nereden bağlanırsan bağlan katılabilirsin."), warn: false };
}

/** Sağ alttaki davet kartları + instance seçme penceresi */
export function InviteCenter() {
  const { pending, open } = useInvites();
  useEffect(() => startInvitePolling(), []);
  const shown = pending.slice(0, 3);
  return (
    <>
      <AnimatePresence initial={false}>
        {shown.map((inv) => <InviteToast key={inv.id} inv={inv} onOpen={() => open(inv)} />)}
      </AnimatePresence>
      <JoinModal />
    </>
  );
}

function InviteToast({ inv, onOpen }: { inv: WorldInvite; onOpen: () => void }) {
  const dismiss = useInvites((s) => s.dismiss);
  const r = reach(inv);
  return (
    <motion.div
      layout
      className="invite-toast"
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
    >
      <div className="invite-glow" aria-hidden />
      <div className="invite-top">
        <div className="invite-avatar">
          <Avatar url={inv.from?.avatar_url} name={who(inv)} size={40} />
          <span className="invite-badge"><Gamepad2 size={11} /></span>
        </div>
        <div className="grow invite-text">
          <span className="invite-eyebrow">{tx("Dünya daveti")} · {formatRelative(inv.at)}</span>
          <strong className="truncate">{tx("{0} seni dünyasına çağırıyor", who(inv))}</strong>
          <span className="invite-world truncate"><Globe2 size={12} /> {inv.world}</span>
        </div>
        <button className="icon-btn sm" aria-label={tx("Yoksay")} onClick={(e) => { e.stopPropagation(); dismiss(inv.id); }}><X size={14} /></button>
      </div>
      <div className="invite-bottom">
        <div className="invite-chips">
          {inv.version && <span className="chip">{inv.loader ? `${inv.loader} ` : ""}{inv.version}</span>}
          <span className={`chip${r.warn ? " warn" : ""}`}><Wifi size={11} /> {r.label}</span>
        </div>
        <span className="btn btn-primary btn-sm invite-join"><Play size={13} /> {tx("Katıl")}</span>
      </div>
    </motion.div>
  );
}

type Fit = { inst: Instance; ok: boolean; reason: string };

function JoinModal() {
  const { joining: inv, close, dismiss } = useInvites();
  const { instances, running, launching, launch, create } = useInstances();
  const account = useAccounts((s) => s.accounts.find((a) => a.active) ?? null);
  const offlineName = useSettings((s) => s.offlineName);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const list: Fit[] = useMemo(() => {
    if (!inv) return [];
    const fits = instances
      .filter((i) => !i.isTemplate)
      .map((inst): Fit => {
        if (running[inst.id]) return { inst, ok: false, reason: tx("Şu an açık; önce kapat") };
        if (launching[inst.id]) return { inst, ok: false, reason: tx("Başlatılıyor…") };
        if (inv.version && inst.mcVersion !== inv.version) return { inst, ok: false, reason: tx("Minecraft {0} gerekiyor", inv.version) };
        return { inst, ok: true, reason: inv.version ? tx("Sürüm uyuyor") : tx("Sürüm bilinmiyor, deneyebilirsin") };
      });
    // Oynanabilir olanlar üstte; kendi içinde son oynanana göre
    return fits.sort((a, b) => Number(b.ok) - Number(a.ok) || (b.inst.lastPlayed ?? "").localeCompare(a.inst.lastPlayed ?? ""));
  }, [inv, instances, running, launching]);

  const playable = list.filter((f) => f.ok);
  useEffect(() => {
    setErr(null);
    setBusy(false);
    setPicked(playable[0]?.inst.id ?? null);
    // Yalnızca pencere açılırken varsayılanı seç
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv?.id]);

  if (!inv) return <Modal open={false} title="" onClose={close}>{null}</Modal>;

  // Dünya Microsoft hesabı istiyor ama aktif hesap offline
  const needsMicrosoft = !inv.offline && account?.kind === "offline";
  const noAccount = !account;
  const blocked = needsMicrosoft || noAccount;
  const r = reach(inv);

  const join = async (id: string) => {
    setBusy(true);
    setErr(null);
    try {
      await launch(id, offlineName, inv.address);
      const e = useInstances.getState().error;
      if (e) throw new Error(e);
      dismiss(inv.id);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  };

  const createAndJoin = async () => {
    if (!inv.version) return;
    setBusy(true);
    setErr(null);
    try {
      const kind = inv.loader.toLowerCase().includes("fabric") ? "fabric" : "vanilla";
      const inst = await create({ name: `${inv.world} · ${who(inv)}`.slice(0, 40), mcVersion: inv.version, loader: { kind, version: null } });
      await join(inst.id);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={tx("Arkadaşının dünyasına katıl")}
      onClose={close}
      width={520}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => dismiss(inv.id)}>{tx("Daveti yoksay")}</button>
          <span className="grow" />
          <button className="btn btn-ghost" onClick={close}>{tx("Vazgeç")}</button>
          <button className="btn btn-primary" disabled={!picked || busy || blocked || !list.find((f) => f.inst.id === picked)?.ok} onClick={() => picked && void join(picked)}>
            <Play size={15} /> {busy ? tx("Bağlanılıyor…") : tx("Katıl")}
          </button>
        </>
      }
    >
      <div className="join-host">
        <Avatar url={inv.from?.avatar_url} name={who(inv)} size={46} />
        <div className="grow">
          <strong>{inv.world}</strong>
          <span className="muted small">{tx("{0} tarafından açıldı", who(inv))} · {formatRelative(inv.at)}</span>
          <div className="invite-chips">
            {inv.version && <span className="chip">{inv.loader ? `${inv.loader} ` : ""}{inv.version}</span>}
            <span className={`chip${r.warn ? " warn" : ""}`} data-tip={r.hint}><Wifi size={11} /> {r.label}</span>
            {inv.offline && <span className="chip">{tx("Offline hesaplar girebilir")}</span>}
          </div>
        </div>
      </div>

      {noAccount && <p className="hint warn"><AlertTriangle size={14} /> {tx("Katılmak için önce bir Minecraft hesabı ekle.")}</p>}
      {needsMicrosoft && <p className="hint warn"><AlertTriangle size={14} /> {tx("Bu dünyaya yalnızca Microsoft hesabıyla girilebilir. Microsoft hesabına geç ya da arkadaşından paylaşırken \"Offline hesaplar da\" seçeneğini açmasını iste.")}</p>}
      {r.warn && <p className="hint warn"><AlertTriangle size={14} /> {r.hint}</p>}

      <p className="join-label">{tx("Hangi instance ile girmek istiyorsun?")}</p>
      <div className="join-list">
        {list.length === 0 && <p className="muted small">{tx("Henüz instance'ın yok.")}</p>}
        {list.map(({ inst, ok, reason }) => (
          <button
            key={inst.id}
            className={`join-row${picked === inst.id ? " active" : ""}${ok ? "" : " off"}`}
            disabled={!ok || busy}
            onClick={() => setPicked(inst.id)}
            onDoubleClick={() => ok && !blocked && void join(inst.id)}
          >
            <InstanceIcon instance={inst} size={36} />
            <span className="grow join-meta">
              <strong className="truncate">{inst.name}</strong>
              <span className="muted tiny">{LOADER_LABEL[inst.loader.kind] ?? inst.loader.kind} {inst.mcVersion}</span>
            </span>
            <span className={`join-state${ok ? " ok" : ""}`}>{ok ? <Check size={12} /> : null} {ok ? tx("Oynanabilir") : reason}</span>
          </button>
        ))}
      </div>

      {inv.version && playable.length === 0 && (
        <button className="btn btn-ghost join-create" disabled={busy || blocked} onClick={() => void createAndJoin()}>
          <Plus size={15} /> {tx("Minecraft {0} instance'ı oluştur ve katıl", inv.version)}
        </button>
      )}
      {err && <p className="hint error">{err}</p>}
    </Modal>
  );
}
