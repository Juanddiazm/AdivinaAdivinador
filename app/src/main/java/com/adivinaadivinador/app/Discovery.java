package com.adivinaadivinador.app;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Encuentra partidas en la red local con un "broadcast" UDP: quien quiere unirse
 * grita "ADIVINA?" y cada anfitrión contesta con su puerto y nombre.
 */
public final class Discovery {

    public static final int PORT = 8766;
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String ASK = "ADIVINA?";
    private static final String REPLY = "ADIVINA!";

    public static final class Found {
        public final String ip;
        public final int port;
        public final String hostName;
        public final int players;

        Found(String ip, int port, String hostName, int players) {
            this.ip = ip;
            this.port = port;
            this.hostName = hostName;
            this.players = players;
        }
    }

    /** Corre en el anfitrión y responde a las búsquedas. */
    public static final class Responder {
        private final GameServer server;
        private volatile boolean running;
        private DatagramSocket socket;

        public Responder(GameServer server) {
            this.server = server;
        }

        public void start() {
            running = true;
            Thread t = new Thread(new Runnable() {
                @Override
                public void run() {
                    loop();
                }
            }, "discovery-responder");
            t.setDaemon(true);
            t.start();
        }

        public void stop() {
            running = false;
            if (socket != null) socket.close();
        }

        private void loop() {
            try {
                socket = new DatagramSocket(null);
                socket.setReuseAddress(true);
                socket.setBroadcast(true);
                socket.bind(new InetSocketAddress(PORT));
                byte[] buf = new byte[512];
                while (running) {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    socket.receive(p);
                    String msg = new String(p.getData(), 0, p.getLength(), UTF8);
                    if (!msg.startsWith(ASK)) continue;
                    String name = server.game().hostName().replace("|", " ");
                    byte[] reply = (REPLY + "|" + server.port() + "|" + server.game().playerCount() + "|" + name).getBytes(UTF8);
                    socket.send(new DatagramPacket(reply, reply.length, p.getAddress(), p.getPort()));
                }
            } catch (Exception ignored) {
            } finally {
                if (socket != null) socket.close();
            }
        }
    }

    /** Busca anfitriones durante {@code timeoutMs} milisegundos. */
    public static List<Found> search(int timeoutMs) {
        Map<String, Found> found = new LinkedHashMap<String, Found>();
        DatagramSocket s = null;
        try {
            s = new DatagramSocket();
            s.setBroadcast(true);
            s.setSoTimeout(250);
            byte[] ask = ASK.getBytes(UTF8);
            long end = System.currentTimeMillis() + timeoutMs;
            int round = 0;
            while (System.currentTimeMillis() < end) {
                if (round++ % 3 == 0) {
                    for (InetAddress target : broadcastTargets()) {
                        try {
                            s.send(new DatagramPacket(ask, ask.length, target, PORT));
                        } catch (Exception ignored) {
                        }
                    }
                }
                try {
                    byte[] buf = new byte[512];
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    s.receive(p);
                    String[] parts = new String(p.getData(), 0, p.getLength(), UTF8).split("\\|", 4);
                    if (parts.length == 4 && REPLY.equals(parts[0])) {
                        String ip = p.getAddress().getHostAddress();
                        found.put(ip, new Found(ip, Integer.parseInt(parts[1]), parts[3], Integer.parseInt(parts[2])));
                    }
                } catch (SocketTimeoutException ignored) {
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (s != null) s.close();
        }
        return new ArrayList<Found>(found.values());
    }

    private static List<InetAddress> broadcastTargets() {
        List<InetAddress> out = new ArrayList<InetAddress>();
        try {
            out.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress b = ia.getBroadcast();
                    if (b != null && !out.contains(b)) out.add(b);
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }
}
