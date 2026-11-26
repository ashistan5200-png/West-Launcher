/* West Client tanıtım sitesi — bağımlılıksız */
(() => {
  const { repo: REPO, supabaseUrl: SB, supabaseKey: SBKEY } = window.WEST;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ───────── Üst menü ─────────
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 30);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  $("#burger").addEventListener("click", () => nav.classList.toggle("open"));
  $$("#navLinks a").forEach((a) => a.addEventListener("click", () => nav.classList.remove("open")));

  // ───────── Piksel gökyüzü (hero) ─────────
  const sky = $("#sky");
  const ctx = sky.getContext("2d");
  const PX = 6;
  let W = 0, H = 0, t0 = performance.now();
  const rand = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const r = rand(20261115);
  const stars = Array.from({ length: 140 }, () => ({ x: r(), y: r() * 0.55, s: r() > 0.8 ? 2 : 1, p: r() * 6.28 }));
  const clouds = Array.from({ length: 7 }, () => ({ x: r(), y: 0.08 + r() * 0.25, w: 10 + Math.floor(r() * 18), v: 0.004 + r() * 0.006 }));
  // Her katman için önceden üretilmiş dağ profili (döngüsel)
  const ridge = (n, amp, rough, seed) => {
    const rr = rand(seed); const out = []; let y = 0;
    for (let i = 0; i < n; i++) { y += (rr() - 0.5) * rough; y *= 0.96; out.push(y); }
    const max = Math.max(...out.map(Math.abs)) || 1;
    return out.map((v) => (v / max) * amp);
  };
  const layers = [
    { base: 0.58, amp: 0.13, color: "#5a2f4a", speed: 0.004, data: ridge(400, 1, 2.2, 7) },
    { base: 0.7, amp: 0.1, color: "#3a2034", speed: 0.009, data: ridge(400, 1, 2.6, 11) },
    { base: 0.82, amp: 0.07, color: "#1d1220", speed: 0.016, data: ridge(400, 1, 3, 17) },
  ];
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = sky.clientWidth; H = sky.clientHeight;
    sky.width = Math.ceil(W / PX); sky.height = Math.ceil(H / PX);
    ctx.imageSmoothingEnabled = false;
    void dpr;
  };
  resize();
  addEventListener("resize", resize);
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(sky);
  const draw = (now) => {
    const w = sky.width, h = sky.height, time = (now - t0) / 1000;
    // Gökyüzü
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#120d22"); g.addColorStop(0.45, "#3b2347"); g.addColorStop(0.75, "#b35c4e"); g.addColorStop(1, "#e8a25c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // Yıldızlar (göz kırpar)
    for (const s of stars) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 1.3 + s.p));
      ctx.fillStyle = `rgba(255,255,255,${a * (1 - s.y * 1.3)})`;
      ctx.fillRect(Math.floor(s.x * w), Math.floor(s.y * h), s.s, s.s);
    }
    // Güneş: piksel daire, hafif yükselip alçalır
    // Başlığın arkasına düşmesin: sağ üst köşede, kısa kenara göre boyutlanır
    const tall = h > w;
    const sx = Math.floor(w * (tall ? 0.8 : 0.84)), sy = Math.floor(h * ((tall ? 0.12 : 0.2) + Math.sin(time * 0.15) * 0.015)), R = Math.max(4, Math.floor(Math.min(w, h) * 0.06));
    ctx.fillStyle = "rgba(255,210,138,.18)";
    for (let dy = -R * 2; dy <= R * 2; dy++) for (let dx = -R * 2; dx <= R * 2; dx++) if (dx * dx + dy * dy <= 4 * R * R && dx * dx + dy * dy > R * R * 1.4) { if ((dx + dy) % 3 === 0) ctx.fillRect(sx + dx, sy + dy, 1, 1); }
    ctx.fillStyle = "#ffd28a";
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) ctx.fillRect(sx + dx, sy + dy, 1, 1);
    // Bulutlar
    ctx.fillStyle = "rgba(255,255,255,.14)";
    for (const c of clouds) {
      const x = Math.floor((((c.x + time * c.v) % 1.3) - 0.15) * w), y = Math.floor(c.y * h);
      ctx.fillRect(x, y, c.w, 2); ctx.fillRect(x + 2, y - 2, c.w - 4, 2);
    }
    // Dağlar (parallax)
    for (const L of layers) {
      ctx.fillStyle = L.color;
      const off = time * L.speed * L.data.length + scrollY * L.speed * 0.6;
      for (let x = 0; x < w; x++) {
        const i = Math.floor(x + off) % L.data.length;
        const y = Math.floor(h * (L.base - L.data[i] * L.amp));
        ctx.fillRect(x, y, 1, h - y);
      }
    }
    if (!reduce && visible) requestAnimationFrame(draw);
    else if (!reduce) setTimeout(() => requestAnimationFrame(draw), 400);
  };
  requestAnimationFrame(draw);

  // ───────── Yükselen parçacıklar ─────────
  if (!reduce) {
    const m = $("#motes");
    for (let i = 0; i < 26; i++) {
      const el = document.createElement("i");
      el.style.left = `${(i * 37 + 7) % 100}%`;
      el.style.animationDuration = `${14 + ((i * 7) % 14)}s`;
      el.style.animationDelay = `${-((i * 3.3) % 20)}s`;
      m.appendChild(el);
    }
  }

  // ───────── Kaydırınca beliren öğeler + sayaçlar ─────────
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  $$(".reveal").forEach((el) => io.observe(el));

  // ───────── Ashi'nin avı (canlandırma) ─────────
  const modsEl = $("#mods"), huntText = $("#huntText"), bar = $("#huntBar");
  const N = 64, LIBS = new Set([0, 1, 2, 3, 9, 17]);
  const cells = Array.from({ length: N }, (_, i) => {
    const c = document.createElement("div");
    c.className = "mod" + (LIBS.has(i) ? " lib" : "");
    modsEl.appendChild(c);
    return c;
  });
  const sleep = (ms) => new Promise((res) => setTimeout(res, reduce ? 0 : ms));
  const say = (s) => { huntText.style.opacity = 0; setTimeout(() => { huntText.textContent = s; huntText.style.opacity = 1; }, 180); };
  let huntRunning = false;
  async function hunt() {
    if (huntRunning) return;
    huntRunning = true;
    while (true) {
      const bad = [...Array(N).keys()].filter((i) => !LIBS.has(i))[Math.floor(Math.random() * (N - LIBS.size))];
      cells.forEach((c, i) => (c.className = "mod" + (LIBS.has(i) ? " lib" : "") + (LIBS.has(i) ? "" : " on")));
      bar.style.width = "0%";
      say("Önce çökmeyi kendi gözümle göreyim, tüm modlar açık…");
      await sleep(1700);
      say("Bonk! Çöktü. Kütüphaneler tek başına sağlam; asıl modlarda arıyorum.");
      await sleep(1700);
      let suspects = [...Array(N).keys()].filter((i) => !LIBS.has(i));
      let round = 1;
      const total = Math.ceil(Math.log2(suspects.length)) + 1;
      while (suspects.length > 1) {
        const half = suspects.slice(0, Math.ceil(suspects.length / 2));
        cells.forEach((c, i) => { if (!LIBS.has(i) && !c.classList.contains("out")) c.classList.toggle("on", half.includes(i)); });
        say(`Tur ${round}: ${half.length} modu açık bıraktım, oyunu açıyorum…`);
        await sleep(1500);
        const crashed = half.includes(bad);
        suspects = crashed ? half : suspects.filter((i) => !half.includes(i));
        cells.forEach((c, i) => { if (!LIBS.has(i) && !suspects.includes(i)) { c.classList.remove("on"); c.classList.add("out"); } });
        say(crashed ? "Çöktü! Suçlu bu grupta." : "Ayakta kaldı, bu grup masum.");
        bar.style.width = `${Math.min(100, (round / total) * 100)}%`;
        round++;
        await sleep(1200);
      }
      cells[bad].className = "mod bad";
      bar.style.width = "100%";
      say(`Buldum! Suçlu mod #${bad + 1}. Yalnızca ${round - 1} turda. Bütün modların eski haline döndü.`);
      await sleep(4200);
    }
  }
  new IntersectionObserver(([e]) => { if (e.isIntersecting) hunt(); }, { threshold: 0.3 }).observe($("#hunt"));

  // ───────── Ekran görüntüsünü büyüt ─────────
  const lb = $("#lightbox");
  $$(".frame img, .window img").forEach((im) => (im.onclick = () => { $("img", lb).src = im.src; $("img", lb).alt = im.alt; lb.classList.add("on"); }));
  lb.onclick = () => lb.classList.remove("on");
  addEventListener("keydown", (e) => { if (e.key === "Escape") lb.classList.remove("on"); });

  // ───────── Ashi sohbeti (canlandırma) ─────────
  const chatBody = $("#chatBody");
  const SCRIPT = [
    ["me", "Bana arkadaşlarla oynayacağımız korku temalı bir modpack kur."],
    ["ai", "Fabric 1.21.1'de 12 modluk bir paket öneriyorum: canavarlar, karanlık mağaralar, ses efektleri ve performans için FPS paketi. Kurayım mı?"],
    ["me", "Kur!"],
    ["acts", ["Instance oluşturuldu: Karanlık Orman (Fabric 1.21.1)", "The Graveyard, Cave Dweller, Sound Physics Remastered kuruldu", "9 mod ve 3 kütüphane daha kuruldu", "FPS paketi: Sodium, Lithium, FerriteCore"]],
    ["ai", "Hazır! \"Karanlık Orman\" paketini kütüphanende bulabilirsin. Arkadaşlarınla paylaşmak için Paylaş sekmesinden bir senkron kodu alabilirsin."],
  ];
  let chatStarted = false;
  async function playChat() {
    if (chatStarted) return;
    chatStarted = true;
    for (const [who, what] of SCRIPT) {
      if (who !== "me") {
        const t = document.createElement("div");
        t.className = "msg ai typing";
        t.innerHTML = "<i></i><i></i><i></i>";
        chatBody.appendChild(t);
        await sleep(who === "acts" ? 1400 : 1100);
        chatBody.removeChild(t);
      }
      if (who === "acts") {
        const ul = document.createElement("ul");
        ul.className = "acts";
        what.forEach((x, i) => { const li = document.createElement("li"); li.textContent = x; li.style.animationDelay = `${i * 0.35}s`; ul.appendChild(li); });
        chatBody.appendChild(ul);
        await sleep(what.length * 350 + 500);
      } else {
        const m = document.createElement("div");
        m.className = `msg ${who}`;
        m.textContent = what;
        chatBody.appendChild(m);
        await sleep(who === "me" ? 700 : 1300);
      }
    }
  }
  new IntersectionObserver(([e]) => { if (e.isIntersecting) playChat(); }, { threshold: 0.35 }).observe($("#chat"));

  // ───────── Launcher turu ─────────
  const CAPS = {
    instance: "Modlar, dünyalar, loglar ve paylaşım tek sayfada; son oturumun performansı en üstte.",
    browse: "Modrinth ve CurseForge'da ara; paketine uyan sürüm ve gerekli kütüphaneler kendiliğinden gelir.",
    skins: "Büyük 3D önizleme, arşiv ve hesap değiştirme aynı sayfada.",
    library: "Bütün paketlerin kapaklarıyla; kodla arkadaşının paketini ekle, şablondan yenisini aç.",
  };
  $$(".tour-tabs button").forEach((b) => b.addEventListener("click", () => {
    $$(".tour-tabs button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); });
    const img = $("#tourImg");
    img.src = `assets/shots/${b.dataset.shot}.webp`;
    img.alt = b.textContent;
    $("#tourCap").textContent = CAPS[b.dataset.shot];
  }));

  // ───────── İşletim sistemini tanı ─────────
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua) ? "win" : /Mac OS X|Macintosh/i.test(ua) ? "mac" : /Linux|X11/i.test(ua) && !/Android/i.test(ua) ? "linux" : null;
  if (os) {
    const card = $(`.dl[data-os="${os}"]`);
    card?.classList.add("me");
    const href = $("a.btn", card)?.getAttribute("href");
    if (href) { $("#heroDl").href = href; $("#heroDlText").textContent = `${os === "win" ? "Windows" : os === "mac" ? "macOS" : "Linux"} için indir`; }
  }

  // ───────── Son sürüm etiketi (yalnızca numara) ─────────
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rel) => { if (rel && rel.tag_name) $("#verTag").textContent = rel.tag_name; })
    .catch(() => {});

})();
