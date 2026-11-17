import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@/stores/wallet";
import { CoinIcon } from "@/pages/Shop";
import { tx } from "@/lib/i18n";

/** Oyundan çıkınca kazanılan West Coin bildirimi */
export function CoinToast() {
  const { earned, dismissEarned, view } = useWallet();
  const navigate = useNavigate();
  useEffect(() => {
    if (!earned) return;
    const t = window.setTimeout(dismissEarned, 7000);
    return () => window.clearTimeout(t);
  }, [earned, dismissEarned]);
  return (
    <AnimatePresence>
      {earned && (
        <motion.button
          key={earned.at}
          className="coin-toast"
          initial={{ opacity: 0, y: 14, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 16 }}
          onClick={() => { dismissEarned(); navigate("/shop"); }}
        >
          <CoinIcon size={30} />
          <span className="grow">
            <strong>{tx("+{0} West Coin", earned.coins)}</strong>
            <span className="muted tiny">{tx("Oynadığın için kazandın · bakiye {0}", view?.wallet.coins ?? 0)}</span>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
