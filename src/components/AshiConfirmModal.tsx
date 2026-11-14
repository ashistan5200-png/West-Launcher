import { useState } from "react";
import { AlertTriangle, Clock, MonitorPlay, ShieldCheck, Swords } from "lucide-react";
import { Modal } from "./Modal";
import { AshiAvatar } from "./AshiAvatar";
import { useAshi } from "@/stores/ashi";
import { useSettings } from "@/stores/settings";

/** Bir test turunun kabaca süresi: modlu paket açılışı ≈ 1–3 dk. */
const MIN_PER_ROUND = 1;
const MAX_PER_ROUND = 3;

export function AshiConfirmModal() {
  const { confirm, closeConfirm, start, busy } = useAshi();
  const offlineName = useSettings((s) => s.offlineName);
  const [err, setErr] = useState<string | null>(null);

  const plan = confirm?.plan;
  const lo = plan ? plan.maxRounds * MIN_PER_ROUND : 0;
  const hi = plan ? plan.maxRounds * MAX_PER_ROUND : 0;

  return (
    <Modal
      open={!!confirm}
      onClose={() => { setErr(null); closeConfirm(); }}
      title="Otomatik Suçlu Avcısı"
      width={540}
      footer={
        <>
          <button className="btn btn-ghost" onClick={closeConfirm}>Vazgeç</button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setErr(null);
              try { await start(confirm!.instanceId, offlineName); } catch (e) { setErr(String(e)); }
            }}
          >
            <Swords size={15} /> {busy ? "Başlatılıyor…" : "Avı başlat"}
          </button>
        </>
      }
    >
      {confirm && plan && (
        <div className="ashi-confirm">
          <div className="ashi-confirm-stage">
            <AshiAvatar mood="think" width={150} height={190} interactive />
          </div>
          <div className="stack">
            <p className="ashi-bubble">
              <strong>{confirm.name}</strong> içindeki <strong>{plan.modCount} modu</strong> ikiye bölerek tarayacağım.
              Her turda oyunu açıp ana menüye ulaşıp ulaşmadığına bakacağım.
            </p>

            <div className="warn-box">
              <AlertTriangle size={16} />
              <div>
                <strong>Bu işlem biraz uzun sürebilir.</strong>
                <span className="small">
                  En fazla ~{plan.maxRounds} tur · tahminen <strong>{lo}–{hi} dakika</strong>
                </span>
              </div>
            </div>

            <ul className="ashi-facts">
              <li><MonitorPlay size={15} /> Oyun penceresi birkaç kez kendiliğinden açılıp kapanacak. Lütfen kapatma; Ashi kapatır.</li>
              <li><ShieldCheck size={15} /> Hiçbir mod silinmez. Av bitince ya da durdurulunca tüm modlar eski haline döner.</li>
              <li><Clock size={15} /> Bu sırada bilgisayarını kullanabilirsin; avı sağ alttaki karttan izleyip istediğin an durdurabilirsin.</li>
            </ul>
            <p className="muted tiny">
              Şimdilik açılışta (ana menüye kadar) olan çökmeleri yakalar. Dünyaya girdikten sonra olan çökmeler için sonuç "tekrarlanmadı" çıkabilir.
            </p>
            {err && <p className="hint error">{err}</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
