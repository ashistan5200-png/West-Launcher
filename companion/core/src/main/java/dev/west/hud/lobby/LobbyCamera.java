package dev.west.hud.lobby;

import org.joml.Matrix4f;
import org.joml.Vector3f;
import org.joml.Vector4f;

/**
 * Lobinin kamerası: karakterlerin önünde, yukarıdan çapraz bakar. İsteğe bağlı çok yavaş
 * sinematik kayma. Hem sürüm adaptörü (çizim) hem çekirdek (isim etiketleri, tıklama) aynı
 * matrisleri kullanır; böylece etiketler karakterlerin tam üstüne oturur.
 */
public final class LobbyCamera {
    /** Bakılan nokta: karakterlerin göğüs hizası */
    public final Vector3f target = new Vector3f(0, LobbyScene.GROUND + 1.75f, 0.2f);
    public final Vector3f eye = new Vector3f();
    public final Matrix4f view = new Matrix4f(), proj = new Matrix4f(), viewProj = new Matrix4f();
    public float fov = 46f;
    private int width = 1, height = 1;

    /**
     * @param time      saniye (sinematik kayma için)
     * @param cinematic yavaş kayma açık mı
     * @param people    lobideki kişi sayısı (kalabalıkta kamera biraz geri çekilir)
     */
    public void update(float time, boolean cinematic, int people, int w, int h) {
        width = Math.max(1, w);
        height = Math.max(1, h);
        // Bakış noktası her karede sıfırlanır (Gardırop yakınlaşması onu geçici olarak kaydırır)
        target.set(0, LobbyScene.GROUND + 1.75f, 0.2f);
        float yaw = 16f, pitch = 27f, dist = 10.2f + Math.max(0, people - 3) * 0.6f;
        if (cinematic) {
            yaw += (float) Math.sin(time * 0.045) * 6f;
            pitch += (float) Math.sin(time * 0.031 + 1.3) * 1.5f;
            dist += (float) Math.sin(time * 0.027 + 0.7) * 0.5f;
        }
        double yr = Math.toRadians(yaw), pr = Math.toRadians(pitch);
        eye.set(target.x + (float) (Math.sin(yr) * Math.cos(pr) * dist), target.y + (float) (Math.sin(pr) * dist), target.z + (float) (Math.cos(yr) * Math.cos(pr) * dist));
        view.identity().lookAt(eye, target, new Vector3f(0, 1, 0));
        proj.identity().perspective((float) Math.toRadians(fov), (float) width / height, 0.05f, 400f);
        proj.mul(view, viewProj);
    }

    /**
     * Gardırop: kamera bir karaktere yaklaşır (k: 0 → normal görünüm, 1 → yakın plan). Karakter ekranın
     * sol yarısında durur; sağ yarı aksesuar paneline kalır.
     */
    public void focus(float x, float y, float z, float k, int w, int h) {
        if (k <= 0) return;
        float aspect = (float) Math.max(1, w) / Math.max(1, h);
        Vector3f subject = new Vector3f(x, y + 0.95f, z);
        double yr = Math.toRadians(12), pr = Math.toRadians(6);
        float dist = 4.6f;
        Vector3f closeEye = new Vector3f(subject.x + (float) (Math.sin(yr) * Math.cos(pr) * dist), subject.y + (float) (Math.sin(pr) * dist),
                subject.z + (float) (Math.cos(yr) * Math.cos(pr) * dist));
        // Bakış noktasını kameranın sağına kaydır: karakter ekranın ~%27'sinde görünür
        Vector3f fwd = new Vector3f(subject).sub(closeEye).normalize();
        Vector3f right = new Vector3f(fwd).cross(0, 1, 0).normalize();
        float halfW = (float) Math.tan(Math.toRadians(fov) / 2) * dist * aspect;
        Vector3f closeTarget = new Vector3f(subject).add(right.mul(halfW * 0.46f));
        eye.lerp(closeEye, k);
        target.lerp(closeTarget, k);
        view.identity().lookAt(eye, target, new Vector3f(0, 1, 0));
        proj.mul(view, viewProj);
    }

    /** Dünyadaki bir noktanın ekrandaki yeri {x, y} (GUI pikseli); kameranın arkasındaysa null */
    public float[] project(float x, float y, float z) {
        Vector4f v = new Vector4f(x, y, z, 1).mul(viewProj);
        if (v.w <= 0.01f) return null;
        float nx = v.x / v.w, ny = v.y / v.w;
        return new float[] { (nx * 0.5f + 0.5f) * width, (1 - (ny * 0.5f + 0.5f)) * height, v.w };
    }

    /** Ekranın en üstündeki ufuk çizgisinin y'si (gök geçişi için, yaklaşık) */
    public float horizonY() {
        float[] p = project(target.x + (target.x - eye.x) * 40, target.y, target.z + (target.z - eye.z) * 40);
        return p == null ? 0 : p[1];
    }
}
