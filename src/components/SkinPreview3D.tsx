import { useEffect, useRef } from "react";
import {
  CrouchAnimation, FunctionAnimation, IdleAnimation, RunningAnimation, SkinViewer, WalkingAnimation, WaveAnimation, type PlayerAnimation,
} from "skinview3d";

export type PreviewAnim = "idle" | "walk" | "run" | "wave" | "crouch" | "pose";

const make = (a: PreviewAnim): PlayerAnimation => {
  switch (a) {
    case "walk": return new WalkingAnimation();
    case "run": return new RunningAnimation();
    case "wave": return new WaveAnimation("right");
    case "crouch": return new CrouchAnimation();
    // Kahraman pozu: bir kol önde (kılıç tutar gibi), ağırlık geride
    case "pose":
      return new FunctionAnimation((p, t) => {
        const s = p.skin;
        s.rightArm.rotation.set(-0.9 + Math.sin(t * 1.6) * 0.04, -0.3, -0.12);
        s.leftArm.rotation.set(0.35, 0, 0.22);
        s.rightLeg.rotation.set(-0.25, 0, 0);
        s.leftLeg.rotation.set(0.25, 0, 0);
        s.head.rotation.set(0.05, -0.25 + Math.sin(t * 0.7) * 0.05, 0);
        s.body.rotation.set(0, 0.12, 0);
      });
    default: return new IdleAnimation();
  }
};

interface Props {
  dataUrl: string;
  slim: boolean;
  animation: PreviewAnim;
  autoRotate: boolean;
  nameTag?: string | null;
  capeUrl?: string | null;
  width: number;
  height: number;
}

/** Sürükleyerek döndürülebilen, tekerlekle yakınlaştırılabilen 3D skin önizlemesi. */
export default function SkinPreview3D({ dataUrl, slim, animation, autoRotate, nameTag, capeUrl, width, height }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);

  useEffect(() => {
    if (!canvas.current) return;
    let v: SkinViewer;
    try {
      v = new SkinViewer({ canvas: canvas.current, width, height, pixelRatio: "match-device", fov: 40, zoom: 0.7 });
    } catch {
      return;
    }
    v.controls.enablePan = false;
    v.controls.minDistance = 25;
    v.controls.maxDistance = 90;
    v.globalLight.intensity = 2.7;
    v.cameraLight.intensity = 0.8;
    v.playerWrapper.rotation.y = -0.4;
    viewer.current = v;
    return () => {
      v.dispose();
      viewer.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => viewer.current?.setSize(width, height), [width, height]);
  useEffect(() => void viewer.current?.loadSkin(dataUrl, { model: slim ? "slim" : "default" }), [dataUrl, slim]);
  useEffect(() => {
    if (viewer.current) viewer.current.animation = make(animation);
  }, [animation]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.autoRotate = autoRotate;
    v.autoRotateSpeed = 0.9;
  }, [autoRotate]);
  useEffect(() => {
    if (viewer.current) viewer.current.nameTag = nameTag ?? null;
  }, [nameTag]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (capeUrl) void v.loadCape(capeUrl);
    else v.loadCape(null);
  }, [capeUrl]);

  return <canvas ref={canvas} className="skin-canvas" style={{ width, height }} aria-label="3D skin önizlemesi" />;
}
