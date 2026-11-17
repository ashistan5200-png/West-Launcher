package dev.west.hud.net;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;

import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Modemde (UPnP IGD) port açma: dünyayı internetten arkadaşlara açmak için.
 * Sunucu gerektirmez; modem UPnP'yi desteklemiyorsa ya da sağlayıcı CGNAT kullanıyorsa açıkça söyler.
 */
public final class Upnp {
    public record Result(boolean ok, String externalIp, String localIp, String message) {}

    private static volatile String controlUrl, serviceType, mappedLocalIp;
    private static volatile int mappedPort = -1;

    private Upnp() {}

    public static CompletableFuture<Result> open(int port, String description) {
        return CompletableFuture.supplyAsync(() -> {
            String local = null;
            try {
                String location = discover();
                if (location == null) return new Result(false, null, localIp(null), Tr.t("Modemde UPnP bulunamadı; dünya yalnızca aynı ağdakilere açık."));
                URL base = URI.create(location).toURL();
                local = localIp(base.getHost());
                String xml = read(base);
                String[] svc = findService(xml);
                if (svc == null) return new Result(false, null, local, Tr.t("Modem port açmayı desteklemiyor; dünya yalnızca aynı ağdakilere açık."));
                serviceType = svc[0];
                controlUrl = URI.create(location).resolve(svc[1]).toString();
                soap("AddPortMapping", "<NewRemoteHost></NewRemoteHost><NewExternalPort>" + port + "</NewExternalPort><NewProtocol>TCP</NewProtocol>"
                        + "<NewInternalPort>" + port + "</NewInternalPort><NewInternalClient>" + local + "</NewInternalClient><NewEnabled>1</NewEnabled>"
                        + "<NewPortMappingDescription>" + escape(description) + "</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration>");
                mappedPort = port;
                mappedLocalIp = local;
                String resp = soap("GetExternalIPAddress", "");
                Matcher m = Pattern.compile("<NewExternalIPAddress>([^<]+)</NewExternalIPAddress>").matcher(resp);
                String ext = m.find() ? m.group(1).trim() : null;
                if (ext == null || ext.isEmpty()) return new Result(false, null, local, Tr.t("Port açıldı ama dış adres alınamadı."));
                if (isPrivate(ext)) return new Result(false, ext, local, Tr.t("İnternet sağlayıcın paylaşımlı adres (CGNAT) kullanıyor; dışarıdan bağlanılamayabilir."));
                return new Result(true, ext, local, Tr.t("Port açıldı."));
            } catch (Exception e) {
                WestHud.LOG.info("UPnP başarısız: {}", e.toString());
                return new Result(false, null, local != null ? local : localIp(null), Tr.t("Modemde port açılamadı (") + e.getClass().getSimpleName() + Tr.t("); dünya yalnızca aynı ağdakilere açık."));
            }
        });
    }

    /** Dünya kapanınca açılan portu kapat */
    public static void close() {
        int port = mappedPort;
        if (port < 0 || controlUrl == null) return;
        mappedPort = -1;
        CompletableFuture.runAsync(() -> {
            try {
                soap("DeletePortMapping", "<NewRemoteHost></NewRemoteHost><NewExternalPort>" + port + "</NewExternalPort><NewProtocol>TCP</NewProtocol>");
            } catch (Exception ignored) {
            }
        });
    }

    public static boolean mapped() {
        return mappedPort > 0;
    }

    private static String discover() throws Exception {
        String[] targets = { "urn:schemas-upnp-org:device:InternetGatewayDevice:1", "urn:schemas-upnp-org:service:WANIPConnection:1", "upnp:rootdevice" };
        try (DatagramSocket s = new DatagramSocket()) {
            s.setSoTimeout(1500);
            InetAddress group = InetAddress.getByName("239.255.255.250");
            for (String st : targets) {
                String msg = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nST: " + st + "\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n\r\n";
                byte[] b = msg.getBytes(StandardCharsets.US_ASCII);
                s.send(new DatagramPacket(b, b.length, group, 1900));
            }
            long until = System.currentTimeMillis() + 3000;
            byte[] buf = new byte[2048];
            while (System.currentTimeMillis() < until) {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try {
                    s.receive(p);
                } catch (SocketTimeoutException e) {
                    continue;
                }
                String r = new String(p.getData(), 0, p.getLength(), StandardCharsets.US_ASCII);
                Matcher m = Pattern.compile("(?im)^location:\\s*(\\S+)").matcher(r);
                if (m.find() && (r.contains("InternetGatewayDevice") || r.contains("WANIPConnection") || r.contains("WANPPPConnection") || r.toLowerCase().contains("rootdevice"))) {
                    return m.group(1);
                }
            }
        }
        return null;
    }

    private static String[] findService(String xml) {
        Matcher m = Pattern.compile("<service>(.*?)</service>", Pattern.DOTALL).matcher(xml);
        while (m.find()) {
            String block = m.group(1);
            Matcher t = Pattern.compile("<serviceType>([^<]+)</serviceType>").matcher(block);
            Matcher c = Pattern.compile("<controlURL>([^<]+)</controlURL>").matcher(block);
            if (t.find() && c.find()) {
                String type = t.group(1).trim();
                if (type.contains("WANIPConnection") || type.contains("WANPPPConnection")) return new String[] { type, c.group(1).trim() };
            }
        }
        return null;
    }

    private static String soap(String action, String args) throws Exception {
        String body = "<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                + "<s:Body><u:" + action + " xmlns:u=\"" + serviceType + "\">" + args + "</u:" + action + "></s:Body></s:Envelope>";
        HttpURLConnection c = (HttpURLConnection) URI.create(controlUrl).toURL().openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(4000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
        c.setRequestProperty("SOAPAction", "\"" + serviceType + "#" + action + "\"");
        c.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String resp = in == null ? "" : new String(in.readAllBytes(), StandardCharsets.UTF_8);
        if (code >= 400) throw new IllegalStateException("SOAP " + action + " " + code);
        return resp;
    }

    private static String read(URL url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(4000);
        try (InputStream in = c.getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** Bu bilgisayarın yerel ağ adresi (modeme giden arayüz) */
    public static String localIp(String routerHost) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(routerHost != null ? routerHost : "1.1.1.1", routerHost != null ? 80 : 53), 1500);
            return s.getLocalAddress().getHostAddress();
        } catch (Exception e) {
            try {
                return InetAddress.getLocalHost().getHostAddress();
            } catch (Exception e2) {
                return "127.0.0.1";
            }
        }
    }

    static boolean isPrivate(String ip) {
        try {
            InetAddress a = InetAddress.getByName(ip);
            byte[] b = a.getAddress();
            if (b.length != 4) return a.isSiteLocalAddress();
            int x = b[0] & 0xFF, y = b[1] & 0xFF;
            return x == 10 || (x == 172 && y >= 16 && y <= 31) || (x == 192 && y == 168) || (x == 100 && y >= 64 && y <= 127) || a.isLoopbackAddress();
        } catch (Exception e) {
            return true;
        }
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
