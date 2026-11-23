// Minecraft skin dokusunun (64×64) yerleşimi: her vücut parçası bir "kutu"; kutunun altı yüzü dokuda
// sabit bir düzende durur. Ayna (simetri), parça gizleme ve katman seçimi bu tabloyla çalışır.

export type PartId = "head" | "body" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg";
export type Layer = "inner" | "outer";
export type FaceId = "top" | "bottom" | "right" | "front" | "left" | "back";

export interface Box { part: PartId; layer: Layer; u: number; v: number; w: number; h: number; d: number }
export interface Rect { x: number; y: number; w: number; h: number }

export const PARTS: PartId[] = ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg"];
const MIRROR: Record<PartId, PartId> = { head: "head", body: "body", rightArm: "leftArm", leftArm: "rightArm", rightLeg: "leftLeg", leftLeg: "rightLeg" };

export function boxes(slim: boolean): Box[] {
  const a = slim ? 3 : 4;
  return [
    { part: "head", layer: "inner", u: 0, v: 0, w: 8, h: 8, d: 8 },
    { part: "head", layer: "outer", u: 32, v: 0, w: 8, h: 8, d: 8 },
    { part: "body", layer: "inner", u: 16, v: 16, w: 8, h: 12, d: 4 },
    { part: "body", layer: "outer", u: 16, v: 32, w: 8, h: 12, d: 4 },
    { part: "rightArm", layer: "inner", u: 40, v: 16, w: a, h: 12, d: 4 },
    { part: "rightArm", layer: "outer", u: 40, v: 32, w: a, h: 12, d: 4 },
    { part: "leftArm", layer: "inner", u: 32, v: 48, w: a, h: 12, d: 4 },
    { part: "leftArm", layer: "outer", u: 48, v: 48, w: a, h: 12, d: 4 },
    { part: "rightLeg", layer: "inner", u: 0, v: 16, w: 4, h: 12, d: 4 },
    { part: "rightLeg", layer: "outer", u: 0, v: 32, w: 4, h: 12, d: 4 },
    { part: "leftLeg", layer: "inner", u: 16, v: 48, w: 4, h: 12, d: 4 },
    { part: "leftLeg", layer: "outer", u: 0, v: 48, w: 4, h: 12, d: 4 },
  ];
}

export function faces(b: Box): Record<FaceId, Rect> {
  const { u, v, w, h, d } = b;
  return {
    top: { x: u + d, y: v, w, h: d },
    bottom: { x: u + d + w, y: v, w, h: d },
    right: { x: u, y: v + d, w: d, h },
    front: { x: u + d, y: v + d, w, h },
    left: { x: u + d + w, y: v + d, w: d, h },
    back: { x: u + 2 * d + w, y: v + d, w, h },
  };
}

const inRect = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** Pikselin hangi parçanın hangi yüzünde olduğu (boş alanlar için null) */
export function locate(slim: boolean, x: number, y: number): { box: Box; face: FaceId; rect: Rect } | null {
  for (const b of boxes(slim)) {
    const f = faces(b);
    for (const k of Object.keys(f) as FaceId[]) if (inRect(f[k], x, y)) return { box: b, face: k, rect: f[k] };
  }
  return null;
}

/** Sol-sağ aynadaki karşılık piksel: kollar/bacaklar yer değiştirir, yan yüzler takas edilir, yatay ters çevrilir. */
export function mirror(slim: boolean, x: number, y: number): [number, number] | null {
  const at = locate(slim, x, y);
  if (!at) return null;
  const target = boxes(slim).find((b) => b.part === MIRROR[at.box.part] && b.layer === at.box.layer)!;
  const face: FaceId = at.face === "right" ? "left" : at.face === "left" ? "right" : at.face;
  const r = faces(target)[face];
  const fx = x - at.rect.x, fy = y - at.rect.y;
  return [r.x + (r.w - 1 - fx), r.y + fy];
}

/** Parça/katman görünürlüğüne göre bu piksel düzenlenebilir mi */
export function editable(slim: boolean, x: number, y: number, hidden: Set<string>): boolean {
  const at = locate(slim, x, y);
  return !!at && !hidden.has(at.box.part) && !hidden.has(at.box.layer);
}
