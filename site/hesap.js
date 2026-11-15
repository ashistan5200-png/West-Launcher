/* Supabase e-posta bağlantıları: kayıt doğrulama ve şifre sıfırlama */
(() => {
  const { supabaseUrl, supabaseKey } = window.WEST;
  const $ = (id) => document.getElementById(id);
  const show = (id) => { document.querySelectorAll(".acct-state").forEach((e) => (e.hidden = e.id !== id)); };

  // Bağlantı bilgisi URL'nin # kısmında gelir; okuduktan sonra adres çubuğundan silinir
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(location.search);
  const get = (k) => hash.get(k) ?? query.get(k);
  if (location.hash || location.search) history.replaceState(null, "", location.pathname);

  const error = get("error_code") || get("error");
  const type = get("type");
  const token = get("access_token");

  const logout = (t) => fetch(`${supabaseUrl}/auth/v1/logout`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${t}` } }).catch(() => {});

  if (error) {
    const desc = (get("error_description") || "").replace(/\+/g, " ");
    $("failTitle").textContent = error === "otp_expired" ? "Bağlantının süresi dolmuş" : "Bağlantı geçersiz";
    $("failText").textContent = error === "otp_expired"
      ? "E-posta bağlantıları kısa bir süre geçerlidir. West Client'tan tekrar dene: kayıt için yeniden kayıt ol, şifre için “Şifremi unuttum”."
      : desc || "Bu bağlantı kullanılmış ya da süresi dolmuş olabilir.";
    return show("failed");
  }
  if (!token) return show("nothing");

  if (type === "recovery") {
    // Hangi hesap için olduğunu göster
    fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` } })
      .then((r) => r.json()).then((u) => { if (u?.email) $("resetFor").textContent = `${u.email} için yeni bir şifre seç.`; }).catch(() => {});
    show("reset");
    const strength = (p) => Math.min(4, (p.length >= 8) + (p.length >= 12) + (/[a-zçğıöşü]/.test(p) && /[A-ZÇĞİÖŞÜ]/.test(p)) + (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)));
    const LABEL = ["Çok zayıf", "Zayıf", "Orta", "İyi", "Güçlü"];
    $("pw1").addEventListener("input", () => {
      const s = strength($("pw1").value);
      $("meter").dataset.level = s;
      $("meter").querySelector("small").textContent = $("pw1").value ? LABEL[s] : "";
    });
    $("show").addEventListener("change", (e) => { $("pw1").type = $("pw2").type = e.target.checked ? "text" : "password"; });
    $("reset").addEventListener("submit", async (e) => {
      e.preventDefault();
      const p1 = $("pw1").value, p2 = $("pw2").value, err = $("resetErr");
      err.hidden = true;
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      if (p1.length < 8) return fail("Şifre en az 8 karakter olmalı.");
      if (!(/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(p1) && /\d/.test(p1))) return fail("Şifrede en az bir harf ve bir rakam olsun.");
      if (p1 !== p2) return fail("Şifreler aynı değil.");
      $("resetBtn").disabled = true;
      try {
        const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
          method: "PUT",
          headers: { apikey: supabaseKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ password: p1 }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          const m = (j.msg || j.error_description || j.message || "").toLowerCase();
          throw new Error(m.includes("same") ? "Yeni şifre eskisinden farklı olmalı." : m.includes("weak") || m.includes("should be") ? "Şifre çok zayıf; daha uzun ve karışık bir şifre seç." : r.status === 401 ? "Bağlantının süresi dolmuş. Uygulamadan tekrar “Şifremi unuttum” de." : "Şifre değiştirilemedi, tekrar dene.");
        }
        await logout(token);
        show("resetDone");
      } catch (ex) {
        fail(ex.message);
        $("resetBtn").disabled = false;
      }
    });
    return;
  }

  // signup, email_change, magiclink, invite → doğrulandı. Tarayıcıda oturum bırakma.
  void logout(token);
  show("confirmed");
})();
