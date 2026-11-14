import { useEffect, useRef } from "react";
import { FunctionAnimation, SkinViewer, type PlayerObject } from "skinview3d";
import { BoxGeometry, CircleGeometry, Group, Mesh, MeshLambertMaterial, MeshBasicMaterial, TorusGeometry, DoubleSide } from "three";
import type { AshiMood } from "@/lib/ashi";
import { useAshi } from "@/stores/ashi";
import { useSettings } from "@/stores/settings";

/**
 * Ashi — AshiWest skinli, Minecraft formatında 3D maskot.
 * Tüm pozlar tek bir FunctionAnimation içinde, her karede sıfırdan
 * hesaplanır; böylece ruh hali değişince eski pozdan artık kalmaz.
 */

type Pose = (p: PlayerObject, t: number, lens: Group) => void;

const reset = (p: PlayerObject) => {
  const s = p.skin;
  for (const part of [s.head, s.body, s.leftArm, s.rightArm, s.leftLeg, s.rightLeg]) part.rotation.set(0, 0, 0);
  p.position.set(0, 0, 0);
  p.rotation.set(0, 0, 0);
  s.leftArm.rotation.z = Math.PI * 0.02;
  s.rightArm.rotation.z = -Math.PI * 0.02;
};

/** Hafif nefes: hiçbir pozda karakter heykel gibi durmasın. */
const breathe = (p: PlayerObject, t: number) => {
  const b = Math.sin(t * 2.2) * 0.04;
  p.skin.leftArm.rotation.z += b;
  p.skin.rightArm.rotation.z -= b;
  p.skin.head.rotation.x += Math.sin(t * 1.1) * 0.03;
};

const POSES: Record<AshiMood, Pose> = {
  idle: (p, t) => {
    breathe(p, t);
    p.skin.head.rotation.y = Math.sin(t * 0.6) * 0.25;
  },

  // Selam: sağ kol havada sallanır, kafa hafif yana yatık
  wave: (p, t) => {
    breathe(p, t);
    p.skin.rightArm.rotation.x = Math.PI;
    p.skin.rightArm.rotation.z = Math.sin(t * 7) * 0.45 - 0.25;
    p.skin.head.rotation.z = Math.sin(t * 1.5) * 0.08 + 0.08;
    p.position.y = Math.abs(Math.sin(t * 3.5)) * 0.35;
  },

  // Düşünme: el çenede, kafa yatık, ağırlık bir ayaktan diğerine
  think: (p, t, lens) => {
    breathe(p, t);
    lens.visible = true;
    p.skin.rightArm.rotation.x = -2.05;
    p.skin.rightArm.rotation.z = 0.55;
    p.skin.head.rotation.z = -0.14;
    p.skin.head.rotation.x = 0.12 + Math.sin(t * 1.3) * 0.04;
    p.skin.head.rotation.y = -0.25;
    p.rotation.z = Math.sin(t * 0.9) * 0.025;
  },

  // İz sürme: büyüteç önde, yerinde yürüyüş, etrafa bakınma
  search: (p, t, lens) => {
    lens.visible = true;
    const w = t * 6;
    p.skin.leftLeg.rotation.x = Math.sin(w) * 0.45;
    p.skin.rightLeg.rotation.x = -Math.sin(w) * 0.45;
    p.skin.leftArm.rotation.x = -Math.sin(w) * 0.4;
    p.skin.rightArm.rotation.x = -1.25 + Math.sin(w * 0.5) * 0.08;
    p.skin.rightArm.rotation.y = -0.2;
    p.skin.head.rotation.y = Math.sin(t * 1.4) * 0.55;
    p.skin.head.rotation.x = 0.18;
    p.position.y = Math.abs(Math.sin(w)) * 0.3;
  },

  // Çökme yakalandı: bonk! hızlı yumruk + geri sekme
  bonk: (p, t) => {
    const k = (t * 5) % (Math.PI * 2);
    p.skin.rightArm.rotation.x = -Math.max(0, Math.sin(k)) * 1.9;
    p.skin.body.rotation.y = Math.sin(k) * 0.25;
    p.skin.head.rotation.y = Math.sin(k) * 0.2;
    p.position.z = -Math.max(0, Math.sin(k + 1)) * 0.8;
    p.skin.leftArm.rotation.x = 0.35;
  },

  // Suçlu bulundu: zıplama, iki kol havada
  celebrate: (p, t) => {
    const j = Math.abs(Math.sin(t * 4.5));
    p.position.y = j * 2.2;
    p.skin.leftArm.rotation.x = Math.PI;
    p.skin.rightArm.rotation.x = Math.PI;
    p.skin.leftArm.rotation.z = 0.35 + Math.sin(t * 9) * 0.2;
    p.skin.rightArm.rotation.z = -0.35 - Math.sin(t * 9) * 0.2;
    p.skin.leftLeg.rotation.x = j * 0.35;
    p.skin.rightLeg.rotation.x = -j * 0.35;
    p.skin.head.rotation.x = -0.2;
  },

  // ── Kurulum sihirbazı pozları ──
  // Kartın üst kenarında oturma: bacaklar öne uzanmış, kenardan sarkıyor gibi
  sit: (p, t) => {
    breathe(p, t);
    p.skin.rightLeg.rotation.x = -Math.PI / 2 + Math.sin(t * 1.7) * 0.12;
    p.skin.leftLeg.rotation.x = -Math.PI / 2 + Math.sin(t * 1.7 + 1.4) * 0.12;
    p.skin.head.rotation.y = Math.sin(t * 0.6) * 0.2;
    p.skin.rightArm.rotation.x = -0.25;
    p.skin.leftArm.rotation.x = -0.25;
  },

  // Şifre gizli: iki el gözlerin üstünde, kafa hafif önde
  "sit-cover": (p, t) => {
    p.skin.rightLeg.rotation.x = -Math.PI / 2;
    p.skin.leftLeg.rotation.x = -Math.PI / 2;
    p.skin.head.rotation.x = 0.12;
    p.skin.rightArm.rotation.x = -2.55;
    p.skin.rightArm.rotation.z = 0.55;
    p.skin.leftArm.rotation.x = -2.55;
    p.skin.leftArm.rotation.z = -0.55;
    p.position.y = Math.sin(t * 2.2) * 0.1;
  },

  // Şifre gösteriliyor: bir el aşağı inmiş, kafa eğik — parmak arasından aşağı bakıyor
  "sit-peek": (p, t) => {
    p.skin.rightLeg.rotation.x = -Math.PI / 2;
    p.skin.leftLeg.rotation.x = -Math.PI / 2;
    p.skin.head.rotation.x = 0.42;
    p.skin.head.rotation.y = -0.18 + Math.sin(t * 0.8) * 0.04;
    // sağ el yüzden iyice inmiş (bir göz açık), sol el hâlâ yarı kapatıyor
    p.skin.rightArm.rotation.x = -0.95;
    p.skin.rightArm.rotation.z = 0.35;
    p.skin.leftArm.rotation.x = -2.25;
    p.skin.leftArm.rotation.z = -0.3;
  },

  // Oturarak selam (son adım)
  "sit-wave": (p, t) => {
    p.skin.rightLeg.rotation.x = -Math.PI / 2 + Math.sin(t * 2.2) * 0.18;
    p.skin.leftLeg.rotation.x = -Math.PI / 2 + Math.sin(t * 2.2 + 1.4) * 0.18;
    p.skin.rightArm.rotation.x = Math.PI;
    p.skin.rightArm.rotation.z = Math.sin(t * 7) * 0.45 - 0.25;
    p.skin.leftArm.rotation.x = -0.25;
    p.skin.head.rotation.z = Math.sin(t * 1.5) * 0.08 + 0.08;
  },

  // Koşu: geniş kol/bacak salınımı, zıplayan gövde
  run: (p, t) => {
    const w = t * 15;
    p.skin.rightLeg.rotation.x = Math.cos(w) * 1.25;
    p.skin.leftLeg.rotation.x = Math.cos(w + Math.PI) * 1.25;
    p.skin.rightArm.rotation.x = Math.cos(w + Math.PI) * 1.4;
    p.skin.leftArm.rotation.x = Math.cos(w) * 1.4;
    p.skin.rightArm.rotation.z = -0.18;
    p.skin.leftArm.rotation.z = 0.18;
    p.skin.body.rotation.x = 0.12;
    p.skin.head.rotation.x = -0.05;
    p.position.y = Math.abs(Math.cos(w)) * 1.2;
  },

  // Zıplama: kollar yukarı, bacaklar toplanmış (dikey yay CSS tarafında)
  jump: (p) => {
    p.skin.rightArm.rotation.x = -2.6;
    p.skin.leftArm.rotation.x = -2.6;
    p.skin.rightArm.rotation.z = -0.35;
    p.skin.leftArm.rotation.z = 0.35;
    p.skin.rightLeg.rotation.x = -0.7;
    p.skin.leftLeg.rotation.x = 0.35;
  },

  // Üzgün: kafa önde, omuzlar düşük, yavaş salınım
  sad: (p, t) => {
    p.skin.head.rotation.x = 0.45;
    p.skin.head.rotation.y = Math.sin(t * 0.5) * 0.1;
    p.skin.leftArm.rotation.z = 0.02;
    p.skin.rightArm.rotation.z = -0.02;
    p.skin.leftArm.rotation.x = 0.1;
    p.skin.rightArm.rotation.x = 0.1;
    p.rotation.z = Math.sin(t * 0.8) * 0.03;
    p.position.y = -0.3;
  },
};

/** Basit vokselsiz büyüteç: mat arduvaz çerçeve + buz mavisi cam. */
function makeLens(): Group {
  const g = new Group();
  const frame = new MeshLambertMaterial({ color: 0x8a919b });
  const ring = new Mesh(new TorusGeometry(2.1, 0.42, 8, 20), frame);
  const glass = new Mesh(new CircleGeometry(2.0, 20), new MeshBasicMaterial({ color: 0x9fc1dc, transparent: true, opacity: 0.35, side: DoubleSide }));
  const handle = new Mesh(new BoxGeometry(0.8, 3.4, 0.8), new MeshLambertMaterial({ color: 0x5b4a3a }));
  handle.position.y = -3.6;
  ring.add(glass);
  g.add(ring, handle);
  // Sağ elin ucu (kol pivotu omuzda, el ≈ 10 birim aşağıda)
  g.position.set(0, -11.5, -1.5);
  g.rotation.set(Math.PI / 2, 0, 0);
  g.visible = false;
  return g;
}

/**
 * Pozlar arası geçiş hızı (kare başına yaklaşma oranı). Gizlice bakış yavaş,
 * yakalanınca gözleri kapatma bilerek hızlıdır.
 */
const EASE: Partial<Record<AshiMood, number>> = { "sit-cover": 0.42, "sit-peek": 0.07, run: 0.5, jump: 0.35, bonk: 0.5 };

const PARTS = (p: PlayerObject) => [p.skin.head, p.skin.body, p.skin.rightArm, p.skin.leftArm, p.skin.rightLeg, p.skin.leftLeg];

function snapshot(p: PlayerObject): number[] {
  const out: number[] = [];
  for (const part of PARTS(p)) out.push(part.rotation.x, part.rotation.y, part.rotation.z);
  out.push(p.position.x, p.position.y, p.position.z, p.rotation.x, p.rotation.y, p.rotation.z);
  return out;
}

function apply(p: PlayerObject, v: number[]) {
  let i = 0;
  for (const part of PARTS(p)) part.rotation.set(v[i++], v[i++], v[i++]);
  p.position.set(v[i++], v[i++], v[i++]);
  p.rotation.set(v[i++], v[i++], v[i++]);
}

interface Props {
  mood: AshiMood;
  /** Gövdenin dönük olduğu yön (radyan): 0 = kameraya, +π/2 / −π/2 = yanlara */
  facing?: number;
  width?: number;
  height?: number;
  /** Fareyle çevrilebilsin mi */
  interactive?: boolean;
}

export default function Ashi3D({ mood, facing = -0.42, width = 120, height = 150, interactive = false }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  const moodRef = useRef(mood);
  const skin = useAshi((s) => s.skin);
  const reduceMotion = useSettings((s) => s.settings.theme.reduceMotion);

  const facingRef = useRef(facing);
  moodRef.current = mood;
  facingRef.current = facing;

  useEffect(() => {
    if (!canvas.current) return;
    let v: SkinViewer;
    try {
      v = new SkinViewer({ canvas: canvas.current, width, height, pixelRatio: "match-device", fov: 38, zoom: 0.95 });
    } catch {
      return; // WebGL yoksa maskot sessizce gizlenir
    }
    v.controls.enableZoom = false;
    v.controls.enablePan = false;
    v.controls.enableRotate = interactive;
    v.globalLight.intensity = 2.6;
    v.cameraLight.intensity = 0.9;
    v.playerWrapper.rotation.y = facingRef.current; // varsayılan 3/4 bakış — daha sevimli

    const lens = makeLens();
    v.playerObject.skin.rightArm.add(lens);

    let prev: number[] | null = null;
    v.animation = new FunctionAnimation((player, progress) => {
      reset(player);
      lens.visible = false;
      POSES[moodRef.current](player, progress, lens);
      // Hedef poza yumuşak yaklaş (ani sıçrama yok)
      const target = snapshot(player);
      if (prev) {
        const k = EASE[moodRef.current] ?? 0.2;
        apply(player, (prev = prev.map((a, i) => a + (target[i] - a) * k)));
      } else {
        prev = target;
      }
      const w = v.playerWrapper.rotation;
      w.y += (facingRef.current - w.y) * 0.18;
    });
    viewer.current = v;
    return () => {
      v.dispose();
      viewer.current = null;
    };
  }, [width, height, interactive]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    void v.loadSkin(skin.dataUrl, { model: skin.slim ? "slim" : "default" });
  }, [skin, width, height, interactive]);

  useEffect(() => {
    if (viewer.current?.animation) viewer.current.animation.paused = reduceMotion;
  }, [reduceMotion]);

  return <canvas ref={canvas} className="ashi-canvas" style={{ width, height }} aria-label="Ashi" />;
}
