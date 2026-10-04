package com.adivinaadivinador.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.content.res.AssetManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.security.SecureRandom;
import java.util.List;

public class MainActivity extends Activity {

    private static final String HOME = "file:///android_asset/home.html";
    private static final int BG = 0xFF17102E;

    // Estáticos para sobrevivir si Android recrea la actividad mientras se es anfitrión.
    private static GameServer server;
    private static Discovery.Responder responder;
    private static String hostName = "";

    private WebView web;
    private WifiManager.MulticastLock multicastLock;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        prefs = getSharedPreferences("adivina", MODE_PRIVATE);

        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Enlaces externos (p. ej. créditos en Wikimedia) en el navegador, no dentro del juego.
                Uri url = request.getUrl();
                if (!"https".equals(url.getScheme())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                    // Sin navegador instalado: no se hace nada.
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !request.getUrl().toString().startsWith("file:")) {
                    view.loadUrl(HOME + "#error=" + Uri.encode("No se pudo conectar con la partida. ¿Están en la misma red Wi-Fi?"));
                }
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        setContentView(web);

        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            multicastLock = wifi.createMulticastLock("adivina");
            multicastLock.setReferenceCounted(false);
            multicastLock.acquire();
        }

        if (server != null && server.isRunning()) web.loadUrl(hostUrl());
        else web.loadUrl(HOME);
    }

    @Override
    public void onBackPressed() {
        String url = web.getUrl();
        if (url != null && url.startsWith("http")) confirmLeave();
        else if (url != null && url.contains("creditos.html") && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (isFinishing()) stopHosting();
        if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
        web.destroy();
        super.onDestroy();
    }

    private void confirmLeave() {
        boolean hosting = server != null && server.isRunning();
        new AlertDialog.Builder(this)
                .setTitle("¿Salir de la partida?")
                .setMessage(hosting
                        ? "Eres el anfitrión: si sales, la partida se cierra para todos."
                        : "Podrás volver a unirte cuando quieras.")
                .setPositiveButton("Salir", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        stopHosting();
                        web.loadUrl(HOME);
                    }
                })
                .setNegativeButton("Quedarme", null)
                .show();
    }

    private static synchronized void stopHosting() {
        if (responder != null) responder.stop();
        if (server != null) server.stop();
        responder = null;
        server = null;
    }

    private static String hostUrl() {
        return "http://127.0.0.1:" + server.port() + "/#host=" + server.hostKey() + "&name=" + Uri.encode(hostName);
    }

    private static String randomKey() {
        SecureRandom r = new SecureRandom();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 12; i++) sb.append(Integer.toHexString(r.nextInt(16)));
        return sb.toString();
    }

    private void load(final String url) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.loadUrl(url);
            }
        });
    }

    /** Lo que la página puede pedirle a Android (window.AndroidBridge en JavaScript). */
    final class Bridge {

        @JavascriptInterface
        public String getName() {
            return prefs.getString("name", "");
        }

        @JavascriptInterface
        public void saveName(String name) {
            prefs.edit().putString("name", name == null ? "" : name.trim()).apply();
        }

        @JavascriptInterface
        public String host(String name) {
            try {
                synchronized (MainActivity.class) {
                    hostName = name == null ? "" : name.trim();
                    if (server == null || !server.isRunning()) {
                        final AssetManager am = getAssets();
                        server = new GameServer(new GameServer.AssetSource() {
                            @Override
                            public InputStream open(String path) throws IOException {
                                return am.open(path);
                            }
                        }, randomKey());
                        server.start(GameServer.DEFAULT_PORT);
                        responder = new Discovery.Responder(server);
                        responder.start();
                    }
                }
                load(hostUrl());
                return "{\"ok\":true}";
            } catch (Exception e) {
                stopHosting();
                return "{\"error\":" + JSONObject.quote("No se pudo crear la partida: " + e.getMessage()) + "}";
            }
        }

        @JavascriptInterface
        public boolean isHosting() {
            return server != null && server.isRunning();
        }

        @JavascriptInterface
        public void resumeHost() {
            if (isHosting()) load(hostUrl());
        }

        @JavascriptInterface
        public void stopHost() {
            stopHosting();
        }

        @JavascriptInterface
        public void discover() {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    List<Discovery.Found> list = Discovery.search(2500);
                    final JSONArray arr = new JSONArray();
                    try {
                        for (Discovery.Found f : list) {
                            arr.put(new JSONObject().put("ip", f.ip).put("port", f.port)
                                    .put("host", f.hostName).put("players", f.players));
                        }
                    } catch (Exception ignored) {
                    }
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            web.evaluateJavascript("window.onHostsFound && window.onHostsFound(" + arr + ")", null);
                        }
                    });
                }
            }, "discovery-search").start();
        }

        @JavascriptInterface
        public void join(String address, String name) {
            String a = address == null ? "" : address.trim();
            a = a.replaceFirst("^https?://", "").replaceAll("/.*$", "");
            if (a.isEmpty()) return;
            if (!a.contains(":")) a = a + ":" + GameServer.DEFAULT_PORT;
            load("http://" + a + "/#name=" + Uri.encode(name == null ? "" : name.trim()));
        }

        @JavascriptInterface
        public void leave() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    confirmLeave();
                }
            });
        }

        @JavascriptInterface
        public void goHome() {
            load(HOME);
        }
    }
}
