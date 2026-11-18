package dev.west.hud.voice;

import dev.west.hud.Config;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import io.github.jaredmdobson.concentus.OpusApplication;
import io.github.jaredmdobson.concentus.OpusDecoder;
import io.github.jaredmdobson.concentus.OpusEncoder;

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.DataLine;
import javax.sound.sampled.Mixer;
import javax.sound.sampled.SourceDataLine;
import javax.sound.sampled.TargetDataLine;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Grup sesli sohbeti (West'in kendi sistemi; başka ses modu gerektirmez, varsa onunla birlikte çalışır).
 *
 * <p>Mikrofon 48 kHz mono okunur → gürültü engelleyici ({@link NoiseSuppressor}) → sesle etkinleşme
 * ya da bas-konuş → Opus (20 ms kareler, ~24 kbit/s) → birkaç kare bir pakette lobinin gizli kanalına.
 * Gelen paketler kişi başına çözülür, kısa bir titreşim tamponunda bekletilir, kayıp kareler Opus'un
 * kayıp gizlemesiyle doldurulur, herkes karıştırılıp hoparlöre verilir.
 *
 * <p>Mikrofon yalnızca bir grupta (lobide en az 2 kişi) ve sesli sohbet açıkken, susturulmamışken açılır.
 */
public final class VoiceEngine {
    public static final VoiceEngine INSTANCE = new VoiceEngine();
    public static final int RATE = 48000, FRAME = 960;
    private static final AudioFormat FORMAT = new AudioFormat(RATE, 16, 1, true, false);

    /** Paket gönderme yolu (lobi bağlantısı); gönderemezse false */
    public interface Sink {
        boolean send(int seq, List<byte[]> frames);
    }

    public volatile Sink sink;

    // ───── Arayüzün okuduğu durum ─────
    /** İşlenmiş mikrofon seviyesi (dBFS, -100…0) */
    public volatile float micDb = -100;
    /** Şu an gönderiliyor mu (konuşuyorsun) */
    public volatile boolean transmitting;
    public volatile String micError, speakerError;
    /** Mikrofon testi: kendi sesini (gürültü engellenmiş hâliyle) duyarsın; gruba gönderilmez */
    public volatile boolean test;
    /** Simple Voice Chat yüklü mü (varsa onunla çakışmadan çalışılır) */
    public volatile boolean otherVoiceMod;
    public volatile boolean capturing, playing;

    private volatile int groupSize;
    private volatile boolean pttDown, wantCapture, wantPlay;
    private volatile Thread captureThread, playThread;
    private long captureFailAt, playFailAt;
    private final Map<String, Speaker> speakers = new ConcurrentHashMap<>();
    private final ArrayDeque<short[]> loop = new ArrayDeque<>();

    private VoiceEngine() {}

    // ───────── Yaşam döngüsü (istemci tick'i) ─────────

    /**
     * @param members konuşma grubundaki kişi sayısı (sen dahil); 2'den azsa mikrofon açılmaz
     */
    public void tick(Game game, int members) {
        Config.Data d = WestHud.config.data;
        groupSize = members;
        otherVoiceMod = game.modLoaded("voicechat");
        pttDown = game.pushToTalkDown();
        boolean group = members >= 2;
        boolean on = d.voice && (group || test);
        wantPlay = on && !d.voiceDeafened;
        wantCapture = on && (test || (!d.voiceMuted && !d.voiceDeafened));
        long now = System.currentTimeMillis();
        if (wantCapture && captureThread == null && now - captureFailAt > 15000) {
            Thread t = new Thread(this::captureLoop, "West voice capture");
            t.setDaemon(true);
            captureThread = t;
            t.start();
        }
        if (wantPlay && playThread == null && now - playFailAt > 15000) {
            Thread t = new Thread(this::playLoop, "West voice playback");
            t.setDaemon(true);
            playThread = t;
            t.start();
        }
        if (!wantPlay) speakers.clear();
        speakers.values().removeIf(s -> now - s.lastPacket > 30_000);
        if (!wantCapture) {
            transmitting = false;
            micDb = -100;
        }
    }

    /** Ayarlarda "Otomatik": başka ses modu varsa bas-konuş (iki sistem aynı anda açık mikrofon dinlemesin) */
    public boolean pushToTalk() {
        String m = WestHud.config.data.voiceMode;
        return "ptt".equals(m) || ("auto".equals(m) && otherVoiceMod);
    }

    /** Kişi konuşuyor mu (son ~0.35 sn'de ondan ses geldi) */
    public boolean speaking(String id) {
        Speaker s = speakers.get(id);
        return s != null && System.currentTimeMillis() - s.lastPacket < 350 && s.loud;
    }

    // ───────── Mikrofon ─────────

    /** Kullanılabilir mikrofonlar (ayarlarda seçmek için) */
    public static List<String> microphones() {
        List<String> out = new ArrayList<>();
        try {
            DataLine.Info info = new DataLine.Info(TargetDataLine.class, FORMAT);
            for (Mixer.Info mi : AudioSystem.getMixerInfo()) {
                try {
                    if (AudioSystem.getMixer(mi).isLineSupported(info)) out.add(mi.getName());
                } catch (Exception ignored) {
                }
            }
        } catch (Throwable ignored) {
        }
        return out;
    }

    /** Mikrofondan 960 örneklik kareler okuyan kaynak */
    private interface Source extends AutoCloseable {
        boolean read(short[] pcm) throws Exception;

        @Override
        void close();
    }

    private Source openMic() throws Exception {
        String test = System.getProperty("west.voiceIn");
        if (test != null) return wavSource(Path.of(test));
        String want = WestHud.config.data.voiceMic;
        TargetDataLine line = null;
        AudioFormat fmt = null;
        Exception last = null;
        // 48 kHz mono yoksa stereo ya da 44.1 kHz açılır ve 48 kHz monoya çevrilir
        for (AudioFormat f : FALLBACKS) {
            DataLine.Info info = new DataLine.Info(TargetDataLine.class, f);
            try {
                if (want != null && !want.isBlank())
                    for (Mixer.Info mi : AudioSystem.getMixerInfo())
                        if (mi.getName().equals(want)) {
                            Mixer m = AudioSystem.getMixer(mi);
                            if (m.isLineSupported(info)) line = (TargetDataLine) m.getLine(info);
                        }
                if (line == null) line = (TargetDataLine) AudioSystem.getLine(info);
                int inFrame = Math.round(FRAME * f.getSampleRate() / RATE);
                line.open(f, inFrame * f.getFrameSize() * 4);
                fmt = f;
                break;
            } catch (Exception e) {
                last = e;
                line = null;
            }
        }
        if (line == null) throw last != null ? last : new IllegalStateException("no microphone");
        line.start();
        final TargetDataLine l = line;
        final int ch = fmt.getChannels();
        final int inFrame = Math.round(FRAME * fmt.getSampleRate() / RATE);
        byte[] buf = new byte[inFrame * 2 * ch];
        short[] mono = new short[inFrame];
        return new Source() {
            @Override
            public boolean read(short[] pcm) {
                int got = 0;
                while (got < buf.length) {
                    int n = l.read(buf, got, buf.length - got);
                    if (n <= 0) return false;
                    got += n;
                }
                for (int i = 0; i < inFrame; i++) {
                    int o = i * 2 * ch;
                    int v = (short) ((buf[o] & 0xFF) | (buf[o + 1] << 8));
                    if (ch == 2) v = (v + (short) ((buf[o + 2] & 0xFF) | (buf[o + 3] << 8))) / 2;
                    mono[i] = (short) v;
                }
                resample(mono, inFrame, pcm, FRAME);
                return true;
            }

            @Override
            public void close() {
                l.stop();
                l.close();
            }
        };
    }

    private static final AudioFormat[] FALLBACKS = { FORMAT, new AudioFormat(RATE, 16, 2, true, false), new AudioFormat(44100, 16, 1, true, false),
            new AudioFormat(44100, 16, 2, true, false) };

    /** Doğrusal yeniden örnekleme (ör. 882 → 960 örnek) */
    private static void resample(short[] in, int n, short[] out, int m) {
        if (n == m) {
            System.arraycopy(in, 0, out, 0, m);
            return;
        }
        for (int i = 0; i < m; i++) {
            float p = (float) i * (n - 1) / (m - 1);
            int a = (int) p;
            int b = Math.min(n - 1, a + 1);
            float k = p - a;
            out[i] = (short) Math.round(in[a] * (1 - k) + in[b] * k);
        }
    }

    /** Test kancası: 48 kHz mono 16 bit WAV dosyasını mikrofon gibi gerçek zamanlı ve döngüyle oku */
    private static Source wavSource(Path p) throws Exception {
        byte[] all = Files.readAllBytes(p);
        int data = 44;
        for (int i = 12; i + 8 < all.length; ) {
            String id = new String(all, i, 4, java.nio.charset.StandardCharsets.US_ASCII);
            int size = (all[i + 4] & 0xFF) | (all[i + 5] & 0xFF) << 8 | (all[i + 6] & 0xFF) << 16 | (all[i + 7] & 0xFF) << 24;
            if (id.equals("data")) {
                data = i + 8;
                break;
            }
            i += 8 + size;
        }
        final int start = data;
        return new Source() {
            int pos = start;
            long next = System.nanoTime();

            @Override
            public boolean read(short[] pcm) throws Exception {
                for (int i = 0; i < FRAME; i++) {
                    if (pos + 1 >= all.length) pos = start;
                    pcm[i] = (short) ((all[pos] & 0xFF) | (all[pos + 1] << 8));
                    pos += 2;
                }
                next += 20_000_000L;
                long wait = next - System.nanoTime();
                if (wait > 0) Thread.sleep(wait / 1_000_000, (int) (wait % 1_000_000));
                return true;
            }

            @Override
            public void close() {}
        };
    }

    private void captureLoop() {
        Source src = null;
        try {
            src = openMic();
            micError = null;
            capturing = true;
            NoiseSuppressor ns = new NoiseSuppressor();
            OpusEncoder enc = new OpusEncoder(RATE, 1, OpusApplication.OPUS_APPLICATION_VOIP);
            enc.setBitrate(24000);
            enc.setComplexity(5);
            enc.setUseInbandFEC(true);
            enc.setPacketLossPercent(5);
            short[] pcm = new short[FRAME];
            byte[] out = new byte[1275];
            ArrayDeque<short[]> preroll = new ArrayDeque<>();
            List<byte[]> batch = new ArrayList<>();
            int seq = (int) (Math.random() * 1_000_000);
            long holdUntil = 0;
            boolean was = false;
            float level = -100;
            while (wantCapture) {
                if (!src.read(pcm)) break;
                Config.Data d = WestHud.config.data;
                float gain = Math.max(0, d.voiceInVol);
                if (gain != 1) for (int i = 0; i < FRAME; i++) pcm[i] = (short) Math.max(-32768, Math.min(32767, Math.round(pcm[i] * gain)));
                ns.strength = d.voiceNoise ? 1f : 0f;
                ns.process(pcm);
                double sum = 0;
                for (short s : pcm) sum += (double) s * s;
                float db = (float) (10 * Math.log10(sum / FRAME / (32768.0 * 32768.0) + 1e-10));
                level = db > level ? db : level * 0.85f + db * 0.15f;
                micDb = level;
                long now = System.currentTimeMillis();
                if (db > d.voiceSensitivity) holdUntil = now + 400;
                if (test) {
                    synchronized (loop) {
                        loop.add(pcm.clone());
                        while (loop.size() > 12) loop.poll();
                    }
                }
                boolean tx = !test && !d.voiceMuted && groupSize >= 2 && sink != null && (pushToTalk() ? pttDown : now < holdUntil);
                transmitting = tx;
                if (tx) {
                    // Sesle etkinleşmede ilk hece kesilmesin: son 2 kare de gönderilir
                    if (!was) for (short[] p : preroll) batch.add(encode(enc, p, out));
                    batch.add(encode(enc, pcm, out));
                    if (batch.size() >= framesPerPacket()) {
                        sink.send(seq++, batch);
                        batch = new ArrayList<>();
                    }
                } else if (!batch.isEmpty()) {
                    if (sink != null) sink.send(seq++, batch);
                    batch = new ArrayList<>();
                }
                was = tx;
                preroll.add(pcm.clone());
                while (preroll.size() > 2) preroll.poll();
            }
        } catch (Throwable e) {
            micError = friendly(e, true);
            captureFailAt = System.currentTimeMillis();
            if (!e.toString().equals(lastMicLog)) WestHud.LOG.warn("Sesli sohbet: mikrofon açılamadı: {}", e.toString());
            lastMicLog = e.toString();
        } finally {
            if (src != null) src.close();
            capturing = false;
            transmitting = false;
            captureThread = null;
        }
    }

    private static byte[] encode(OpusEncoder enc, short[] pcm, byte[] out) throws Exception {
        int n = enc.encode(pcm, 0, FRAME, out, 0, out.length);
        return java.util.Arrays.copyOf(out, n);
    }

    /**
     * Paket başına kare: Supabase Realtime'da her alıcıya ulaşan ileti ayrı sayılır; kalabalık grupta
     * kareler birleştirilerek ileti sayısı sınırın altında tutulur (2 kişi 60 ms, 7 kişi 140 ms).
     */
    private int framesPerPacket() {
        return Math.max(3, Math.min(7, groupSize + 1));
    }

    // ───────── Gelen ses ─────────

    private static final class Speaker {
        OpusDecoder dec;
        final ArrayDeque<short[]> queue = new ArrayDeque<>();
        int lastSeq = -1, lastN = 3;
        long lastPacket;
        boolean started, loud;
    }

    /** Lobi kanalından gelen paket (Realtime iş parçacığında çağrılır) */
    public void receive(String from, int seq, List<byte[]> frames) {
        Config.Data d = WestHud.config.data;
        if (!wantPlay || d.voiceMutedPeople.contains(from) || frames.isEmpty()) return;
        Speaker s = speakers.computeIfAbsent(from, k -> new Speaker());
        synchronized (s) {
            try {
                if (s.dec == null) s.dec = new OpusDecoder(RATE, 1);
                if (s.lastSeq >= 0) {
                    int gap = seq - s.lastSeq - 1;
                    if (gap < 0 && gap > -100) return; // tekrar ya da geç gelen
                    if (gap > 0 && gap <= 3) {
                        // Kayıp paketler: Opus kayıp gizlemesiyle doldur
                        for (int i = 0; i < Math.min(8, gap * s.lastN); i++) {
                            short[] pcm = new short[FRAME];
                            s.dec.decode(null, 0, 0, pcm, 0, FRAME, false);
                            s.queue.add(pcm);
                        }
                    } else if (gap != 0) s.dec.resetState();
                }
                double sum = 0;
                for (byte[] f : frames) {
                    short[] pcm = new short[FRAME];
                    int n = s.dec.decode(f, 0, f.length, pcm, 0, FRAME, false);
                    if (n <= 0) continue;
                    for (short v : pcm) sum += (double) v * v;
                    s.queue.add(pcm);
                }
                s.loud = 10 * Math.log10(sum / (FRAME * frames.size()) / (32768.0 * 32768.0) + 1e-10) > -55;
                // Gecikme birikmesin: 300 ms'den fazlası atılır
                while (s.queue.size() > 15) s.queue.poll();
                s.lastSeq = seq;
                s.lastN = frames.size();
                s.lastPacket = System.currentTimeMillis();
            } catch (Exception e) {
                WestHud.LOG.debug("Sesli sohbet: paket çözülemedi: {}", e.toString());
            }
        }
    }

    private static short[] next(Speaker s) {
        synchronized (s) {
            if (!s.started) {
                // Titreşim tamponu: bir paket + bir kare birikince başla
                if (s.queue.size() >= s.lastN + 1) s.started = true;
                else return null;
            }
            short[] f = s.queue.poll();
            if (f == null) s.started = false;
            return f;
        }
    }

    // ───────── Hoparlör ─────────

    private interface Sinkline extends AutoCloseable {
        void write(byte[] b) throws Exception;

        @Override
        void close();
    }

    private Sinkline openSpeaker() throws Exception {
        String test = System.getProperty("west.voiceOut");
        if (test != null) {
            OutputStream os = new FileOutputStream(test, true);
            return new Sinkline() {
                long next = System.nanoTime();

                @Override
                public void write(byte[] b) throws Exception {
                    os.write(b);
                    next += 20_000_000L;
                    long wait = next - System.nanoTime();
                    if (wait > 0) Thread.sleep(wait / 1_000_000, (int) (wait % 1_000_000));
                }

                @Override
                public void close() {
                    try {
                        os.close();
                    } catch (Exception ignored) {
                    }
                }
            };
        }
        SourceDataLine line = null;
        AudioFormat fmt = null;
        Exception last = null;
        for (AudioFormat f : FALLBACKS) {
            try {
                line = (SourceDataLine) AudioSystem.getLine(new DataLine.Info(SourceDataLine.class, f));
                int outFrame = Math.round(FRAME * f.getSampleRate() / RATE);
                line.open(f, outFrame * f.getFrameSize() * 5);
                fmt = f;
                break;
            } catch (Exception e) {
                last = e;
                line = null;
            }
        }
        if (line == null) throw last != null ? last : new IllegalStateException("no speaker");
        line.start();
        final SourceDataLine l = line;
        final int ch = fmt.getChannels();
        final int outFrame = Math.round(FRAME * fmt.getSampleRate() / RATE);
        final short[] mono = new short[FRAME], res = new short[outFrame];
        final byte[] buf = new byte[outFrame * 2 * ch];
        final boolean direct = ch == 1 && outFrame == FRAME;
        return new Sinkline() {
            @Override
            public void write(byte[] b) {
                if (direct) {
                    l.write(b, 0, b.length);
                    return;
                }
                for (int i = 0; i < FRAME; i++) mono[i] = (short) ((b[2 * i] & 0xFF) | (b[2 * i + 1] << 8));
                resample(mono, FRAME, res, outFrame);
                for (int i = 0; i < outFrame; i++)
                    for (int c = 0; c < ch; c++) {
                        int o = (i * ch + c) * 2;
                        buf[o] = (byte) res[i];
                        buf[o + 1] = (byte) (res[i] >> 8);
                    }
                l.write(buf, 0, buf.length);
            }

            @Override
            public void close() {
                l.stop();
                l.close();
            }
        };
    }

    private void playLoop() {
        Sinkline out = null;
        try {
            out = openSpeaker();
            speakerError = null;
            playing = true;
            float[] acc = new float[FRAME];
            byte[] bytes = new byte[FRAME * 2];
            while (wantPlay) {
                java.util.Arrays.fill(acc, 0);
                Config.Data d = WestHud.config.data;
                float vol = Math.max(0, d.voiceOutVol);
                for (Speaker s : speakers.values()) {
                    short[] f = next(s);
                    if (f == null) continue;
                    for (int i = 0; i < FRAME; i++) acc[i] += f[i] * vol;
                }
                if (test) {
                    short[] f;
                    synchronized (loop) {
                        f = loop.size() > 2 ? loop.poll() : null;
                    }
                    if (f != null) for (int i = 0; i < FRAME; i++) acc[i] += f[i];
                }
                for (int i = 0; i < FRAME; i++) {
                    // Yumuşak kırpma: birden çok kişi aynı anda konuşunca cızırtı olmasın
                    float v = acc[i] / 32768f;
                    v = v > 0.8f ? 0.8f + (float) Math.tanh((v - 0.8f) * 2.5f) * 0.2f : v < -0.8f ? -0.8f + (float) Math.tanh((v + 0.8f) * 2.5f) * 0.2f : v;
                    int s = Math.round(v * 32767f);
                    bytes[2 * i] = (byte) s;
                    bytes[2 * i + 1] = (byte) (s >> 8);
                }
                out.write(bytes);
            }
        } catch (Throwable e) {
            speakerError = friendly(e, false);
            playFailAt = System.currentTimeMillis();
            if (!e.toString().equals(lastSpeakerLog)) WestHud.LOG.warn("Sesli sohbet: hoparlör açılamadı: {}", e.toString());
            lastSpeakerLog = e.toString();
        } finally {
            if (out != null) out.close();
            playing = false;
            playThread = null;
        }
    }

    private String lastMicLog, lastSpeakerLog;

    private static String friendly(Throwable e, boolean mic) {
        String m = String.valueOf(e.getMessage());
        if (e instanceof IllegalArgumentException || m.contains("No line matching") || m.contains("no microphone") || m.contains("no speaker"))
            return mic ? dev.west.hud.Tr.t("Mikrofon bulunamadı. Bir mikrofon bağla ya da ayarlardan başka birini seç.") : dev.west.hud.Tr.t("Ses çıkış aygıtı bulunamadı.");
        if (e instanceof javax.sound.sampled.LineUnavailableException)
            return mic ? dev.west.hud.Tr.t("Mikrofon şu an kullanılamıyor (başka bir uygulama kullanıyor ya da izin verilmemiş).") : dev.west.hud.Tr.t("Ses çıkış aygıtı şu an kullanılamıyor.");
        return m;
    }

    /** Mikrofon değişti: yakalama yeniden açılsın */
    public void restartMic() {
        Thread t = captureThread;
        if (t == null) return;
        wantCapture = false;
        captureFailAt = 0;
    }

    /** Uygulama kapanırken ya da ses kapatılınca */
    public void stop() {
        wantCapture = false;
        wantPlay = false;
    }
}
