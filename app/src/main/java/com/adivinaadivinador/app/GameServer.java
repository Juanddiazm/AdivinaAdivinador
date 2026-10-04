package com.adivinaadivinador.app;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Servidor HTTP mínimo que corre en el teléfono del anfitrión. Sirve la página
 * del juego (assets/web) y una API JSON. Los demás se unen desde la app o
 * desde cualquier navegador en la misma red Wi-Fi.
 */
public final class GameServer {

    /** De dónde se leen los archivos: AssetManager en Android, disco en pruebas. */
    public interface AssetSource {
        InputStream open(String path) throws IOException;
    }

    public static final int DEFAULT_PORT = 8080;
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final int MAX_BODY = 64 * 1024;

    private final AssetSource assets;
    private final Game game;
    private final String hostKey;
    private final Map<String, byte[]> cache = new HashMap<String, byte[]>();
    private ServerSocket serverSocket;
    private ExecutorService pool;
    private Thread acceptThread, tickThread;
    private volatile boolean running;
    private int port;

    public GameServer(AssetSource assets, String hostKey) throws Exception {
        this.assets = assets;
        this.hostKey = hostKey;
        this.game = new Game(new String(readAll(assets.open("data/categorias.json")), UTF8), hostKey);
    }

    public Game game() {
        return game;
    }

    public int port() {
        return port;
    }

    public String hostKey() {
        return hostKey;
    }

    public boolean isRunning() {
        return running;
    }

    /** Arranca en el primer puerto libre desde {@code preferredPort}. Devuelve el puerto usado. */
    public synchronized int start(int preferredPort) throws IOException {
        if (running) return port;
        IOException last = null;
        for (int p = preferredPort; p < preferredPort + 20; p++) {
            try {
                ServerSocket ss = new ServerSocket();
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress(p));
                serverSocket = ss;
                port = p;
                break;
            } catch (IOException e) {
                last = e;
            }
        }
        if (serverSocket == null) throw last != null ? last : new IOException("Sin puertos libres");
        running = true;
        pool = Executors.newFixedThreadPool(24);
        refreshJoinUrls();

        acceptThread = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "game-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();

        tickThread = new Thread(new Runnable() {
            @Override
            public void run() {
                int n = 0;
                while (running) {
                    game.tick();
                    if (++n % 40 == 0) refreshJoinUrls(); // la IP puede cambiar si cambia la red
                    try {
                        Thread.sleep(250);
                    } catch (InterruptedException e) {
                        return;
                    }
                }
            }
        }, "game-tick");
        tickThread.setDaemon(true);
        tickThread.start();
        return port;
    }

    public synchronized void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        if (pool != null) pool.shutdownNow();
        if (tickThread != null) tickThread.interrupt();
        serverSocket = null;
    }

    private List<String> lastUrls = Collections.emptyList();

    private void refreshJoinUrls() {
        List<String> urls = new ArrayList<String>();
        for (String ip : localIpv4()) urls.add("http://" + ip + ":" + port);
        if (!urls.equals(lastUrls)) {
            lastUrls = urls;
            game.setJoinUrls(urls);
        }
    }

    /** IPs de la red local (Wi-Fi o punto de acceso) de este dispositivo. */
    public static List<String> localIpv4() {
        List<String> preferred = new ArrayList<String>();
        List<String> others = new ArrayList<String>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName().toLowerCase(Locale.ROOT);
                if (n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("dummy") || n.startsWith("tun")) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || a.isLoopbackAddress()) continue;
                    String ip = a.getHostAddress();
                    if (a.isSiteLocalAddress() && (n.startsWith("wlan") || n.startsWith("ap") || n.startsWith("swlan")
                            || n.startsWith("eth") || n.startsWith("en") || n.startsWith("wl"))) {
                        preferred.add(ip);
                    } else if (a.isSiteLocalAddress()) {
                        others.add(ip);
                    }
                }
            }
        } catch (Exception ignored) {
        }
        preferred.addAll(others);
        return preferred;
    }

    // ---------------------------------------------------------------- HTTP

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = serverSocket.accept();
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        handle(s);
                    }
                });
            } catch (Exception e) {
                if (!running) return;
            }
        }
    }

    private void handle(Socket s) {
        try {
            s.setSoTimeout(15000);
            s.setTcpNoDelay(true);
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            // Keep-alive: atendemos varias peticiones por conexión para que el sondeo sea liviano.
            for (int served = 0; served < 200 && running; served++) {
                String requestLine = readLine(in);
                if (requestLine == null || requestLine.isEmpty()) break;
                Map<String, String> headers = new HashMap<String, String>();
                String line;
                while ((line = readLine(in)) != null && !line.isEmpty()) {
                    int c = line.indexOf(':');
                    if (c > 0) headers.put(line.substring(0, c).trim().toLowerCase(Locale.ROOT), line.substring(c + 1).trim());
                }
                String[] parts = requestLine.split(" ");
                if (parts.length < 2) break;
                String method = parts[0];
                String target = parts[1];
                int len = 0;
                try {
                    len = Integer.parseInt(headers.containsKey("content-length") ? headers.get("content-length") : "0");
                } catch (NumberFormatException ignored) {
                }
                if (len < 0 || len > MAX_BODY) break;
                byte[] body = readExactly(in, len);
                boolean keepAlive = !"close".equalsIgnoreCase(headers.get("connection"))
                        && !requestLine.endsWith("HTTP/1.0");
                route(method, target, new String(body, UTF8), out, keepAlive);
                if (!keepAlive) break;
            }
        } catch (Exception ignored) {
        } finally {
            try {
                s.close();
            } catch (IOException ignored) {
            }
        }
    }

    private void route(String method, String target, String body, OutputStream out, boolean keepAlive) throws Exception {
        String path = target;
        Map<String, String> query = new HashMap<String, String>();
        int q = target.indexOf('?');
        if (q >= 0) {
            path = target.substring(0, q);
            for (String kv : target.substring(q + 1).split("&")) {
                int e = kv.indexOf('=');
                if (e > 0) query.put(URLDecoder.decode(kv.substring(0, e), "UTF-8"), URLDecoder.decode(kv.substring(e + 1), "UTF-8"));
            }
        }

        if (path.startsWith("/api/")) {
            JSONObject req = body.trim().startsWith("{") ? new JSONObject(body) : new JSONObject();
            String pid = req.optString("pid", query.containsKey("pid") ? query.get("pid") : "");
            JSONObject res;
            String api = path.substring(5);
            if ("GET".equals(method) && "state".equals(api)) res = game.state(pid);
            else if ("GET".equals(method) && "info".equals(api)) {
                res = new JSONObject().put("app", "adivina").put("host", game.hostName()).put("players", game.playerCount());
            } else if (!"POST".equals(method)) res = Game.error("Método no permitido");
            else if ("join".equals(api)) res = game.join(req.optString("name"), req.optString("hostKey"));
            else if ("answer".equals(api)) res = game.answer(pid, req.optString("text"));
            else if ("leave".equals(api)) res = game.leave(pid);
            else if ("settings".equals(api)) res = game.updateSettings(pid, req.optJSONObject("settings") == null ? new JSONObject() : req.getJSONObject("settings"));
            else if ("start".equals(api)) res = game.start(pid);
            else if ("next".equals(api)) res = game.next(pid);
            else if ("end".equals(api)) res = game.end(pid);
            else if ("lobby".equals(api)) res = game.toLobby(pid);
            else if ("kick".equals(api)) res = game.kick(pid, req.optString("target"));
            else res = Game.error("No existe");
            send(out, 200, "application/json; charset=utf-8", res.toString().getBytes(UTF8), keepAlive);
            return;
        }

        if (!"GET".equals(method)) {
            send(out, 405, "text/plain", "405".getBytes(UTF8), keepAlive);
            return;
        }
        String file = "/".equals(path) || "/index.html".equals(path) ? "index.html" : path.substring(1);
        if (!file.matches("[a-zA-Z0-9_.-]+") || file.startsWith(".")) {
            send(out, 404, "text/plain", "404".getBytes(UTF8), keepAlive);
            return;
        }
        byte[] data = asset("web/" + file);
        if (data == null) {
            send(out, 404, "text/plain; charset=utf-8", "No encontrado".getBytes(UTF8), keepAlive);
            return;
        }
        send(out, 200, mime(file), data, keepAlive);
    }

    private byte[] asset(String path) {
        synchronized (cache) {
            if (cache.containsKey(path)) return cache.get(path);
        }
        byte[] data;
        try {
            data = readAll(assets.open(path));
        } catch (IOException e) {
            data = null;
        }
        synchronized (cache) {
            cache.put(path, data);
        }
        return data;
    }

    private static String mime(String file) {
        if (file.endsWith(".html")) return "text/html; charset=utf-8";
        if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (file.endsWith(".css")) return "text/css; charset=utf-8";
        if (file.endsWith(".json")) return "application/json; charset=utf-8";
        if (file.endsWith(".png")) return "image/png";
        if (file.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private static void send(OutputStream out, int code, String type, byte[] body, boolean keepAlive) throws IOException {
        String status = code == 200 ? "OK" : code == 404 ? "Not Found" : "Error";
        String head = "HTTP/1.1 " + code + " " + status + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: " + (keepAlive ? "keep-alive" : "close") + "\r\n\r\n";
        out.write(head.getBytes(UTF8));
        out.write(body);
        out.flush();
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') break;
            if (b != '\r') buf.write(b);
            if (buf.size() > 8192) throw new IOException("Línea muy larga");
        }
        if (b == -1 && buf.size() == 0) return null;
        return new String(buf.toByteArray(), UTF8);
    }

    private static byte[] readExactly(InputStream in, int len) throws IOException {
        byte[] b = new byte[len];
        int off = 0;
        while (off < len) {
            int r = in.read(b, off, len - off);
            if (r < 0) throw new IOException("Fin inesperado");
            off += r;
        }
        return b;
    }

    static byte[] readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int r;
            while ((r = in.read(buf)) != -1) out.write(buf, 0, r);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }
}
