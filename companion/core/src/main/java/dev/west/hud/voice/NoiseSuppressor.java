package dev.west.hud.voice;

/**
 * Gürültü engelleyici (48 kHz, mono). Önce 85 Hz altını (uğultu, masa titreşimi) kesen bir yüksek geçiren
 * süzgeç; sonra kısa zamanlı Fourier dönüşümüyle spektral bastırma: her frekans bandının gürültü tabanı
 * sürekli öğrenilir (fan, klima, klavye uğultusu…), konuşma yokken o bantlar kısılır, konuşma korunur
 * ("karar yönelimli" Wiener kazancı). Pencere 20 ms, adım 10 ms; ek gecikme 10 ms.
 */
public final class NoiseSuppressor {
    public static final int FRAME = 960;
    private static final int HOP = 480, WIN = 960, N = 1024, BINS = N / 2 + 1;

    private final float[] window = new float[WIN];
    private final float[] in = new float[WIN];
    private final float[] overlap = new float[WIN];
    private final float[] re = new float[N], im = new float[N];
    private final float[] noise = new float[BINS], smooth = new float[BINS], prevGain = new float[BINS], prevPost = new float[BINS], gain = new float[BINS];
    private final float[] out = new float[FRAME];
    private int hops;
    // Yüksek geçiren süzgeç (2. derece Butterworth, 85 Hz) durumu
    private final float b0, b1, b2, a1, a2;
    private float x1, x2, y1, y2;
    /** 0 (kapalı) … 1 (en güçlü) */
    public float strength = 1f;

    public NoiseSuppressor() {
        for (int i = 0; i < WIN; i++) window[i] = (float) Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN));
        double w0 = 2 * Math.PI * 85 / 48000.0, cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * Math.sqrt(0.5));
        double a0 = 1 + alpha;
        b0 = (float) ((1 + cos) / 2 / a0);
        b1 = (float) (-(1 + cos) / a0);
        b2 = b0;
        a1 = (float) (-2 * cos / a0);
        a2 = (float) ((1 - alpha) / a0);
        java.util.Arrays.fill(prevGain, 1);
    }

    /** 960 örneklik kareyi yerinde işler */
    public void process(short[] pcm) {
        float[] x = new float[FRAME];
        for (int i = 0; i < FRAME; i++) {
            float v = pcm[i] / 32768f;
            float y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1;
            x1 = v;
            y2 = y1;
            y1 = y;
            x[i] = y;
        }
        for (int h = 0; h < FRAME / HOP; h++) hop(x, h * HOP, h * HOP);
        for (int i = 0; i < FRAME; i++) pcm[i] = (short) Math.max(-32768, Math.min(32767, Math.round(out[i] * 32768f)));
    }

    private void hop(float[] src, int off, int dst) {
        System.arraycopy(in, HOP, in, 0, WIN - HOP);
        System.arraycopy(src, off, in, WIN - HOP, HOP);
        for (int i = 0; i < N; i++) {
            re[i] = i < WIN ? in[i] * window[i] : 0;
            im[i] = 0;
        }
        fft(re, im, false);
        hops++;
        float floor = 1 - strength * 0.9f; // en fazla ~ -20 dB
        for (int k = 0; k < BINS; k++) {
            float p = re[k] * re[k] + im[k] * im[k] + 1e-12f;
            // Gürültü tabanı: zamanda yumuşatılmış gücün minimumu (aşağıya hızlı, yukarıya yavaş; konuşmayı
            // kovalamaz). Minimum, ortalamanın altında kaldığı için sapma payıyla büyütülür.
            smooth[k] = hops == 1 ? p : smooth[k] * 0.8f + p * 0.2f;
            if (hops <= 20) noise[k] = hops == 1 ? smooth[k] : Math.min(noise[k], smooth[k]) * 0.5f + smooth[k] * 0.5f;
            else if (smooth[k] < noise[k]) noise[k] = noise[k] * 0.6f + smooth[k] * 0.4f;
            else noise[k] = noise[k] * 1.004f + 1e-13f;
            float nk = noise[k] * 2.2f;
            float post = p / nk;
            float prio = 0.97f * prevGain[k] * prevGain[k] * prevPost[k] + 0.03f * Math.max(post - 1, 0);
            float g = prio / (1 + prio);
            gain[k] = Math.max(floor, g);
            prevGain[k] = g;
            prevPost[k] = post;
        }
        // Komşu bantlarla yumuşat ("müzikal gürültü" cıvıltısını azaltır)
        float prev = gain[0];
        for (int k = 1; k < BINS - 1; k++) {
            float c = gain[k];
            gain[k] = 0.25f * prev + 0.5f * c + 0.25f * gain[k + 1];
            prev = c;
        }
        if (strength <= 0) java.util.Arrays.fill(gain, 1);
        for (int k = 0; k < BINS; k++) {
            re[k] *= gain[k];
            im[k] *= gain[k];
            if (k > 0 && k < N / 2) {
                re[N - k] = re[k];
                im[N - k] = -im[k];
            }
        }
        fft(re, im, true);
        for (int i = 0; i < WIN; i++) overlap[i] += re[i] * window[i];
        System.arraycopy(overlap, 0, out, dst, HOP);
        System.arraycopy(overlap, HOP, overlap, 0, WIN - HOP);
        java.util.Arrays.fill(overlap, WIN - HOP, WIN, 0);
    }

    /** Yerinde radix-2 karmaşık FFT; inverse ise 1/N ile ölçekler */
    static void fft(float[] re, float[] im, boolean inverse) {
        int n = re.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                float t = re[i];
                re[i] = re[j];
                re[j] = t;
                t = im[i];
                im[i] = im[j];
                im[j] = t;
            }
        }
        for (int len = 2; len <= n; len <<= 1) {
            double ang = 2 * Math.PI / len * (inverse ? 1 : -1);
            float wr = (float) Math.cos(ang), wi = (float) Math.sin(ang);
            for (int i = 0; i < n; i += len) {
                float cr = 1, ci = 0;
                for (int j = 0; j < len / 2; j++) {
                    int a = i + j, b = a + len / 2;
                    float xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr;
                    im[b] = im[a] - xi;
                    re[a] += xr;
                    im[a] += xi;
                    float t = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = t;
                }
            }
        }
        if (inverse) for (int i = 0; i < n; i++) {
            re[i] /= n;
            im[i] /= n;
        }
    }
}
