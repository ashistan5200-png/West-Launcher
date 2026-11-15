import { Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { useAccounts } from "@/stores/accounts";

/** Microsoft girişi — uygulama genelinde (her sayfadan ve kurulum sihirbazından) görünür. */
export function LoginModal() {
  const { loginOpen, loginError, loginStage, cancelLogin, startLogin } = useAccounts();
  return (
    <Modal
      open={loginOpen || !!loginError}
      onClose={cancelLogin}
      title="Microsoft ile giriş"
      width={420}
      footer={
        loginError ? (
          <>
            <button className="btn btn-ghost" onClick={cancelLogin}>Kapat</button>
            <button className="btn btn-primary" onClick={() => void startLogin()}>Tekrar dene</button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={cancelLogin}>İptal</button>
        )
      }
    >
      {loginError ? (
        <p className="hint error">{loginError}</p>
      ) : (
        <div className="login-box">
          <p className="small">Açılan Microsoft penceresinde, Minecraft'a sahip hesabının e-posta adresi ve şifresiyle giriş yap. Giriş bitince pencere kendiliğinden kapanır ve hesabın buraya eklenir.</p>
          <p className="muted tiny row"><Loader2 size={13} className="spin" /> {loginStage ?? "Giriş bekleniyor…"}</p>
          {!loginStage && <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => void startLogin()}>Giriş penceresini öne getir</button>}
          <p className="muted tiny">Şifren yalnızca Microsoft'un kendi sayfasına girilir; West Client onu görmez ve saklamaz.</p>
        </div>
      )}
    </Modal>
  );
}
