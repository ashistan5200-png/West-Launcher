import { useEffect, useRef } from "react";
import track from "@/assets/west_lobby.mp3";
import { useSettings } from "@/stores/settings";
import { useInstances } from "@/stores/instances";

/**
 * West arka plan müziği. Launcher açıkken döngüyle çalar; bir oyun çalışırken susar
 * (oyunda West Companion aynı müziği kendisi çalar, üst üste binmez). Ayarlar → Görünüm → Ses.
 */
export function BackgroundMusic() {
  const on = useSettings((s) => s.settings.music && s.loaded);
  const playing = useInstances((s) => Object.keys(s.running).length > 0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const fade = useRef<number | undefined>(undefined);

  useEffect(() => {
    const a = new Audio(track);
    a.loop = true;
    a.volume = 0;
    audio.current = a;
    return () => {
      a.pause();
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const want = on && !playing;
    const target = want ? 0.32 : 0;
    window.clearInterval(fade.current);
    const start = () => {
      if (want && a.paused) void a.play().catch(() => {});
    };
    start();
    // Tarayıcı otomatik çalmayı engellerse ilk tıklamada başlat
    const kick = () => start();
    window.addEventListener("pointerdown", kick, { once: true });
    fade.current = window.setInterval(() => {
      const d = target - a.volume;
      if (Math.abs(d) < 0.02) {
        a.volume = target;
        if (target === 0) a.pause();
        window.clearInterval(fade.current);
        return;
      }
      a.volume = Math.max(0, Math.min(1, a.volume + Math.sign(d) * 0.02));
    }, 40);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.clearInterval(fade.current);
    };
  }, [on, playing]);

  return null;
}
