import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, Loader2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/ipc";
import { errorText } from "@/lib/format";
import { useInstances } from "@/stores/instances";
import { tx } from "@/lib/i18n";

/** Arkadaşının senkron kodundan paketi kur; sonra o paketi güncelledikçe sen de güncellersin */
export function JoinPackModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const refresh = useInstances((s) => s.refresh);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const inst = await api.packSyncJoin(code);
      await refresh();
      onClose();
      navigate(`/instance/${inst.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={tx("Arkadaşının paketini ekle")} onClose={onClose} width={440}>
      <div className="feat">
        <p className="feat-lead">{tx("Arkadaşının verdiği 7 harfli senkron kodunu yaz. Paket kurulur; o değiştirdikçe sen de tek tıkla güncellersin.")}</p>
        <form className="feat-row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void join(); }}>
          <input autoFocus placeholder="ABCD234" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={10} style={{ fontFamily: "var(--font-mono, monospace)", letterSpacing: ".12em" }} />
          <button className="btn btn-primary" disabled={!code.trim() || busy}>{busy ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />} {tx("Kur")}</button>
        </form>
        {error && <p className="feat-error">{error}</p>}
      </div>
    </Modal>
  );
}
