package com.adivinaadivinador.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/** Estado de una partida: jugadores, configuración, preguntas y puntajes. Todo es thread-safe vía synchronized. */
public final class Game {

    public static final int MAX_PLAYERS = 40;
    private static final long DISCONNECT_MS = 6000;
    private static final long LOBBY_DROP_MS = 90_000;
    private static final int FIRST_BONUS = 100;
    private static final char NBSP = '\u00A0';
    private static final int OPTIONS = 4;

    /** Modos de juego: escribir la respuesta o elegirla entre varias opciones. */
    public static final String MODE_WRITE = "write";
    public static final String MODE_CHOICE = "choice";

    enum Phase { LOBBY, QUESTION, REVEAL, FINAL }

    static final class Item {
        final String prompt;
        final String answer;
        final List<String> accepted = new ArrayList<String>();
        /** Foto o logo (nombre al azar en assets/img) y, si el logo muestra el nombre, sus etapas pixeladas. */
        String image;
        final List<String> pixels = new ArrayList<String>();

        Item(String prompt, String answer, List<String> aliases) {
            this.prompt = prompt;
            this.answer = answer;
            addAccepted(answer);
            for (String a : aliases) addAccepted(a);
        }

        private void addAccepted(String raw) {
            String n = Matcher.normalize(raw);
            if (!n.isEmpty() && !accepted.contains(n)) accepted.add(n);
        }
    }

    static final class Category {
        final String id, name, icon, ask, type;
        final List<Item> items = new ArrayList<Item>();
        final Set<String> allAnswers = new HashSet<String>();

        Category(String id, String name, String icon, String ask, String type) {
            this.id = id;
            this.name = name;
            this.icon = icon;
            this.ask = ask;
            this.type = type;
        }

        void add(Item item) {
            items.add(item);
            allAnswers.addAll(item.accepted);
        }
    }

    static final class Player {
        final String id;
        final String name;
        final boolean host;
        final long joinedAt;
        int score;
        long lastSeen;
        boolean connected = true;
        // Pregunta actual
        boolean answered;
        String answer = "";
        int choice = -1;
        Matcher.Result result;
        int gained;
        boolean first;
        int streak;
        int exactCount;

        Player(String id, String name, boolean host, long now) {
            this.id = id;
            this.name = name;
            this.host = host;
            this.joinedAt = now;
            this.lastSeen = now;
        }
    }

    static final class Question {
        final Category category;
        final Item item;
        final String prompt;
        final String hint;
        /** Solo en modo opciones: las opciones en orden, cuál es la buena y cuáles quita la ayuda 50/50. */
        List<String> options;
        int correct = -1;
        final List<Integer> removed = new ArrayList<Integer>();

        Question(Category category, Item item, String prompt, String hint) {
            this.category = category;
            this.item = item;
            this.prompt = prompt;
            this.hint = hint;
        }
    }

    private final Random rnd = new SecureRandom();
    private final String hostKey;
    private final Map<String, Category> categories = new LinkedHashMap<String, Category>();
    private final Map<String, Player> players = new LinkedHashMap<String, Player>();
    private List<String> joinUrls = new ArrayList<String>();

    private Phase phase = Phase.LOBBY;
    private int version = 1;

    // Configuración elegida por el anfitrión
    private final Set<String> selected = new LinkedHashSet<String>();
    private int rounds = 10;
    private int seconds = 25;
    private int tolerance = Matcher.NORMAL;
    private boolean hints = true;
    private String mode = MODE_WRITE;
    private String customText = "";
    private Category custom = new Category("custom", "Personalizada", "✍️", "Pistas del anfitrión", "text");

    // Ronda en curso
    private final List<Question> questions = new ArrayList<Question>();
    private int qIndex = -1;
    private long qStart, qDeadline, qHintAt;
    private boolean hintShown;
    private boolean firstGiven;

    public Game(String categoriesJson, String hostKey) throws JSONException {
        this(categoriesJson, null, hostKey);
    }

    /** @param imagesJson contenido de data/imagenes.json, o null si no hay imágenes. */
    public Game(String categoriesJson, String imagesJson, String hostKey) throws JSONException {
        this.hostKey = hostKey;
        JSONArray cats = new JSONObject(categoriesJson).getJSONArray("categories");
        for (int i = 0; i < cats.length(); i++) {
            JSONObject c = cats.getJSONObject(i);
            Category cat = new Category(c.getString("id"), c.getString("name"), c.getString("icon"),
                    c.getString("ask"), c.getString("type"));
            boolean scramble = "scramble".equals(cat.type);
            JSONArray items = c.getJSONArray("items");
            for (int j = 0; j < items.length(); j++) {
                JSONArray it = items.getJSONArray(j);
                int base = scramble ? 0 : 1;
                List<String> aliases = new ArrayList<String>();
                for (int k = base + 1; k < it.length(); k++) aliases.add(it.getString(k));
                String prompt = scramble ? "" : it.getString(0);
                cat.add(new Item(prompt, it.getString(base), aliases));
            }
            categories.put(cat.id, cat);
            if (c.optBoolean("default", false)) selected.add(cat.id);
        }
        if (selected.isEmpty() && !categories.isEmpty()) selected.add(categories.keySet().iterator().next());
        if (imagesJson != null) attachImages(new JSONObject(imagesJson));
    }

    /** imagenes.json: { "marcas": { "Nike": { "img": "a1b2…", "pix": ["…", …] } }, … } */
    private void attachImages(JSONObject images) throws JSONException {
        Iterator<String> ids = images.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            Category cat = categories.get(id);
            if (cat == null) continue;
            JSONObject byAnswer = images.getJSONObject(id);
            for (Item it : cat.items) {
                JSONObject rec = byAnswer.optJSONObject(it.answer);
                if (rec == null) continue;
                it.image = rec.getString("img");
                JSONArray pix = rec.optJSONArray("pix");
                if (pix != null) for (int i = 0; i < pix.length(); i++) it.pixels.add(pix.getString(i));
            }
        }
    }

    // ---------------------------------------------------------------- jugadores

    public synchronized void setJoinUrls(List<String> urls) {
        joinUrls = new ArrayList<String>(urls);
        version++;
    }

    public synchronized String hostName() {
        for (Player p : players.values()) if (p.host) return p.name;
        return "Anfitrión";
    }

    public synchronized int playerCount() {
        return players.size();
    }

    public synchronized JSONObject join(String rawName, String key) throws JSONException {
        String name = cleanName(rawName);
        if (name.isEmpty()) return error("Escribe tu nombre");
        if (players.size() >= MAX_PLAYERS) return error("La partida está llena");
        name = uniqueName(name);
        boolean host = key != null && key.length() > 0 && key.equals(hostKey);
        String id = newId();
        players.put(id, new Player(id, name, host, System.currentTimeMillis()));
        version++;
        return new JSONObject().put("pid", id).put("name", name);
    }

    public synchronized JSONObject leave(String pid) throws JSONException {
        if (players.remove(pid) != null) version++;
        return ok();
    }

    // ---------------------------------------------------------------- acciones del anfitrión

    public synchronized JSONObject updateSettings(String pid, JSONObject s) throws JSONException {
        if (!isHost(pid)) return error("Solo el anfitrión puede cambiar esto");
        if (s.has("categories")) {
            JSONArray arr = s.getJSONArray("categories");
            selected.clear();
            for (int i = 0; i < arr.length(); i++) {
                String id = arr.getString(i);
                if (categories.containsKey(id) || "custom".equals(id)) selected.add(id);
            }
        }
        if (s.has("rounds")) rounds = clamp(s.getInt("rounds"), 1, 100);
        if (s.has("seconds")) seconds = clamp(s.getInt("seconds"), 5, 120);
        if (s.has("tolerance")) tolerance = clamp(s.getInt("tolerance"), Matcher.STRICT, Matcher.GENEROUS);
        if (s.has("hints")) hints = s.getBoolean("hints");
        if (s.has("mode")) mode = MODE_CHOICE.equals(s.getString("mode")) ? MODE_CHOICE : MODE_WRITE;
        if (s.has("custom")) {
            customText = s.getString("custom");
            if (customText.length() > 20000) customText = customText.substring(0, 20000);
            custom = parseCustom(customText);
        }
        version++;
        return ok();
    }

    public synchronized JSONObject start(String pid) throws JSONException {
        if (!isHost(pid)) return error("Solo el anfitrión puede empezar");
        List<Category> cats = new ArrayList<Category>();
        for (String id : selected) {
            Category c = "custom".equals(id) ? custom : categories.get(id);
            if (c != null && !c.items.isEmpty()) cats.add(c);
        }
        if (cats.isEmpty()) return error("Elige al menos una categoría con preguntas");

        // Repartimos las rondas entre las categorías elegidas, alternándolas.
        Map<Category, ArrayDeque<Item>> decks = new LinkedHashMap<Category, ArrayDeque<Item>>();
        for (Category c : cats) {
            List<Item> copy = new ArrayList<Item>(c.items);
            Collections.shuffle(copy, rnd);
            decks.put(c, new ArrayDeque<Item>(copy));
        }
        questions.clear();
        while (questions.size() < rounds) {
            List<Category> order = new ArrayList<Category>(cats);
            Collections.shuffle(order, rnd);
            boolean any = false;
            for (Category c : order) {
                Item it = decks.get(c).poll();
                if (it == null) continue;
                any = true;
                questions.add(makeQuestion(c, it, MODE_CHOICE.equals(mode)));
                if (questions.size() >= rounds) break;
            }
            if (!any) break;
        }
        for (Player p : players.values()) {
            p.score = 0;
            p.streak = 0;
            p.exactCount = 0;
        }
        beginQuestion(0);
        return ok();
    }

    public synchronized JSONObject next(String pid) throws JSONException {
        if (!isHost(pid)) return error("Solo el anfitrión puede avanzar");
        if (phase == Phase.QUESTION) {
            reveal();
        } else if (phase == Phase.REVEAL) {
            if (qIndex + 1 < questions.size()) beginQuestion(qIndex + 1);
            else {
                phase = Phase.FINAL;
                version++;
            }
        }
        return ok();
    }

    public synchronized JSONObject end(String pid) throws JSONException {
        if (!isHost(pid)) return error("Solo el anfitrión puede terminar");
        if (phase == Phase.QUESTION) reveal();
        phase = Phase.FINAL;
        version++;
        return ok();
    }

    public synchronized JSONObject toLobby(String pid) throws JSONException {
        if (!isHost(pid)) return error("Solo el anfitrión puede hacer esto");
        phase = Phase.LOBBY;
        qIndex = -1;
        questions.clear();
        for (Player p : players.values()) {
            p.score = 0;
            p.streak = 0;
            p.exactCount = 0;
            resetAnswer(p);
        }
        version++;
        return ok();
    }

    public synchronized JSONObject kick(String pid, String target) throws JSONException {
        if (!isHost(pid)) return error("Solo el anfitrión puede sacar jugadores");
        Player t = players.get(target);
        if (t != null && !t.host) {
            players.remove(target);
            version++;
        }
        return ok();
    }

    // ---------------------------------------------------------------- respuestas

    public synchronized JSONObject answer(String pid, String text) throws JSONException {
        return answer(pid, text, -1);
    }

    /** @param choice índice de la opción elegida (modo opciones); se ignora en modo escribir. */
    public synchronized JSONObject answer(String pid, String text, int choice) throws JSONException {
        Player p = players.get(pid);
        if (p == null) return error("unknown");
        p.lastSeen = System.currentTimeMillis();
        if (phase != Phase.QUESTION) return error("La ronda ya terminó");
        if (p.answered) return error("Ya respondiste");
        long now = System.currentTimeMillis();
        if (now > qDeadline + 750) return error("Se acabó el tiempo");

        Question q = questions.get(qIndex);
        String clean;
        Matcher.Result r;
        if (q.options != null) {
            if (choice < 0 || choice >= q.options.size()) return error("Elige una opción");
            clean = q.options.get(choice);
            r = choice == q.correct ? new Matcher.Result(1, "¡Correcto!") : new Matcher.Result(0, "Incorrecto");
        } else {
            clean = text == null ? "" : text.trim();
            if (clean.length() > 80) clean = clean.substring(0, 80);
            r = Matcher.score(clean, q.item.accepted, q.category.allAnswers, tolerance);
        }
        double timeLeft = Math.max(0, Math.min(1, (qDeadline - now) / (double) (qDeadline - qStart)));
        int pts = (int) Math.round(r.accuracy * (400 + 600 * timeLeft));
        boolean first = false;
        if (r.accuracy >= 1 && !firstGiven) {
            firstGiven = true;
            first = true;
            pts += FIRST_BONUS;
        }
        p.answered = true;
        p.answer = clean;
        p.choice = q.options != null ? choice : -1;
        p.result = r;
        p.gained = pts;
        p.first = first;
        version++;
        if (allAnswered()) reveal();
        return ok();
    }

    // ---------------------------------------------------------------- reloj

    /** Llamado varias veces por segundo por el servidor. */
    public synchronized void tick() {
        long now = System.currentTimeMillis();
        Iterator<Player> it = players.values().iterator();
        while (it.hasNext()) {
            Player p = it.next();
            boolean c = now - p.lastSeen < DISCONNECT_MS;
            if (c != p.connected) {
                p.connected = c;
                version++;
            }
            if (!c && !p.host && phase == Phase.LOBBY && now - p.lastSeen > LOBBY_DROP_MS) {
                it.remove();
                version++;
            }
        }
        if (phase == Phase.QUESTION) {
            if (hints && !hintShown && now >= qHintAt) {
                hintShown = true;
                version++;
            }
            if (now >= qDeadline || allAnswered()) reveal();
        }
    }

    // ---------------------------------------------------------------- estado para cada jugador

    public synchronized JSONObject state(String pid) throws JSONException {
        Player me = players.get(pid);
        if (me == null) return error("unknown");
        long now = System.currentTimeMillis();
        me.lastSeen = now;
        if (!me.connected) {
            me.connected = true;
            version++;
        }

        JSONObject o = new JSONObject();
        o.put("v", version);
        o.put("phase", phase.name().toLowerCase(Locale.ROOT));

        List<Player> ranking = ranking();
        JSONObject you = new JSONObject()
                .put("id", me.id).put("name", me.name).put("host", me.host)
                .put("score", me.score).put("answered", me.answered).put("answer", me.answer).put("choice", me.choice)
                .put("rank", ranking.indexOf(me) + 1);
        o.put("you", you);

        JSONArray ps = new JSONArray();
        List<Player> list = phase == Phase.LOBBY ? new ArrayList<Player>(players.values()) : ranking;
        for (Player p : list) {
            JSONObject j = new JSONObject()
                    .put("id", p.id).put("name", p.name).put("host", p.host)
                    .put("score", p.score).put("connected", p.connected)
                    .put("answered", p.answered).put("streak", p.streak).put("exact", p.exactCount);
            if (phase == Phase.REVEAL) j.put("gained", p.gained);
            ps.put(j);
        }
        o.put("players", ps);
        o.put("joinUrls", new JSONArray(joinUrls));

        JSONArray sel = new JSONArray();
        for (String id : selected) sel.put(id);
        JSONObject settings = new JSONObject()
                .put("categories", sel).put("rounds", rounds).put("seconds", seconds)
                .put("tolerance", tolerance).put("hints", hints).put("mode", mode)
                .put("customCount", custom.items.size());
        if (me.host) settings.put("custom", customText);
        o.put("settings", settings);

        if (phase == Phase.LOBBY) {
            JSONArray cats = new JSONArray();
            for (Category c : categories.values()) {
                cats.put(new JSONObject().put("id", c.id).put("name", c.name).put("icon", c.icon)
                        .put("ask", c.ask).put("count", c.items.size()));
            }
            o.put("categories", cats);
        }

        if ((phase == Phase.QUESTION || phase == Phase.REVEAL) && qIndex >= 0) {
            Question q = questions.get(qIndex);
            int answeredCount = 0, active = 0;
            for (Player p : players.values()) {
                if (p.connected || p.answered) active++;
                if (p.answered) answeredCount++;
            }
            JSONObject r = new JSONObject()
                    .put("index", qIndex + 1).put("total", questions.size())
                    .put("catId", q.category.id).put("catName", q.category.name)
                    .put("catIcon", q.category.icon).put("ask", q.category.ask)
                    .put("type", q.category.type).put("prompt", q.prompt)
                    .put("durationMs", qDeadline - qStart)
                    .put("remainingMs", Math.max(0, qDeadline - now))
                    .put("answeredCount", answeredCount).put("playerCount", active);
            if (q.options != null) {
                r.put("options", new JSONArray(q.options));
                // La ayuda 50/50 quita opciones malas a mitad de tiempo (solo mientras se responde).
                if (hintShown && phase == Phase.QUESTION) r.put("removed", new JSONArray(q.removed));
            } else if (hintShown || phase == Phase.REVEAL) {
                r.put("hint", q.hint);
            }
            putImage(r, q, now);
            o.put("round", r);
        }

        if (phase == Phase.REVEAL) {
            Question q = questions.get(qIndex);
            List<Player> byPoints = new ArrayList<Player>(players.values());
            Collections.sort(byPoints, new Comparator<Player>() {
                @Override
                public int compare(Player a, Player b) {
                    if (a.gained != b.gained) return b.gained - a.gained;
                    return a.name.compareToIgnoreCase(b.name);
                }
            });
            JSONArray results = new JSONArray();
            for (Player p : byPoints) {
                Matcher.Result res = p.result;
                results.put(new JSONObject()
                        .put("id", p.id).put("name", p.name).put("text", p.answer)
                        .put("label", res == null ? "Sin respuesta" : res.label)
                        .put("accuracy", res == null ? 0 : res.accuracy)
                        .put("points", p.gained).put("first", p.first).put("streak", p.streak));
            }
            JSONObject rv = new JSONObject()
                    .put("answer", q.item.answer)
                    .put("results", results)
                    .put("last", qIndex + 1 >= questions.size());
            if (q.options != null) {
                int[] picks = new int[q.options.size()];
                for (Player p : players.values()) if (p.choice >= 0 && p.choice < picks.length) picks[p.choice]++;
                JSONArray pk = new JSONArray();
                for (int n : picks) pk.put(n);
                rv.put("correct", q.correct).put("picks", pk);
            }
            o.put("reveal", rv);
        }
        return o;
    }

    // ---------------------------------------------------------------- internos

    private void beginQuestion(int index) {
        qIndex = index;
        for (Player p : players.values()) resetAnswer(p);
        long now = System.currentTimeMillis();
        qStart = now;
        qDeadline = now + seconds * 1000L;
        qHintAt = now + seconds * 500L;
        hintShown = false;
        firstGiven = false;
        phase = Phase.QUESTION;
        version++;
    }

    private void reveal() {
        if (phase != Phase.QUESTION) return;
        for (Player p : players.values()) {
            if (!p.answered) {
                p.result = null;
                p.gained = 0;
            }
            p.score += p.gained;
            double acc = p.result == null ? 0 : p.result.accuracy;
            if (acc >= 0.8) p.streak++;
            else p.streak = 0;
            if (acc >= 1) p.exactCount++;
        }
        phase = Phase.REVEAL;
        version++;
    }

    private boolean allAnswered() {
        int active = 0;
        for (Player p : players.values()) {
            if (!p.connected) continue;
            active++;
            if (!p.answered) return false;
        }
        return active > 0;
    }

    private void resetAnswer(Player p) {
        p.answered = false;
        p.answer = "";
        p.choice = -1;
        p.result = null;
        p.gained = 0;
        p.first = false;
    }

    private List<Player> ranking() {
        List<Player> list = new ArrayList<Player>(players.values());
        Collections.sort(list, new Comparator<Player>() {
            @Override
            public int compare(Player a, Player b) {
                if (a.score != b.score) return b.score - a.score;
                return Long.compare(a.joinedAt, b.joinedAt);
            }
        });
        return list;
    }

    private Question makeQuestion(Category c, Item it, boolean choice) {
        String prompt;
        if ("scramble".equals(c.type)) prompt = scramble(it.answer);
        else if (it.image != null) prompt = flagsOf(it.prompt); // con imagen, solo queda la bandera como ayuda
        else prompt = it.prompt;
        Question q = new Question(c, it, prompt, hintFor(it.answer));
        if (choice) addOptions(q);
        return q;
    }

    /**
     * Arma las opciones: la respuesta buena y otras de la misma categoría (si no alcanzan, de
     * cualquier categoría). También elige al azar las opciones malas que quitará la ayuda 50/50.
     */
    private void addOptions(Question q) {
        List<String> opts = new ArrayList<String>();
        opts.add(q.item.answer);
        Set<String> seen = new HashSet<String>(q.item.accepted);
        List<String> pool = new ArrayList<String>();
        for (Item o : q.category.items) if (o != q.item) pool.add(o.answer);
        addDistractors(opts, seen, pool);
        if (opts.size() < OPTIONS) {
            pool.clear();
            for (Category c : categories.values()) for (Item o : c.items) pool.add(o.answer);
            addDistractors(opts, seen, pool);
        }
        Collections.shuffle(opts, rnd);
        q.options = opts;
        q.correct = opts.indexOf(q.item.answer);
        List<Integer> wrong = new ArrayList<Integer>();
        for (int i = 0; i < opts.size(); i++) if (i != q.correct) wrong.add(i);
        Collections.shuffle(wrong, rnd);
        int remove = Math.max(0, opts.size() - 2); // siempre quedan la buena y una mala
        for (int i = 0; i < remove && i < wrong.size(); i++) q.removed.add(wrong.get(i));
        Collections.sort(q.removed);
    }

    private void addDistractors(List<String> opts, Set<String> seen, List<String> pool) {
        Collections.shuffle(pool, rnd);
        for (String cand : pool) {
            if (opts.size() >= OPTIONS) return;
            String n = Matcher.normalize(cand);
            if (n.isEmpty() || seen.contains(n)) continue;
            seen.add(n);
            opts.add(cand);
        }
    }

    /**
     * Imagen de la pregunta. Los logos que muestran el nombre se ven pixelados y se aclaran por
     * etapas a lo largo del tiempo; solo se envía la etapa actual para que nadie se adelante.
     */
    private void putImage(JSONObject r, Question q, long now) throws JSONException {
        Item it = q.item;
        if (it.image == null) return;
        boolean pixelated = phase == Phase.QUESTION && !it.pixels.isEmpty();
        String name = it.image;
        if (pixelated) {
            long total = Math.max(1, qDeadline - qStart);
            long stage = (now - qStart) * it.pixels.size() / total;
            name = it.pixels.get((int) Math.max(0, Math.min(it.pixels.size() - 1, stage)));
        }
        r.put("image", "img/" + name + ".webp").put("pixelated", pixelated);
    }

    /** Solo las banderas (pares de "regional indicators") de un texto: "🗼🇫🇷 Torre…" -> "🇫🇷". */
    static String flagsOf(String text) {
        StringBuilder sb = new StringBuilder();
        int i = 0;
        while (i < text.length()) {
            int cp = text.codePointAt(i);
            int next = i + Character.charCount(cp);
            if (isRegionalIndicator(cp) && next < text.length() && isRegionalIndicator(text.codePointAt(next))) {
                int cp2 = text.codePointAt(next);
                if (sb.length() > 0) sb.append(' ');
                sb.appendCodePoint(cp).appendCodePoint(cp2);
                i = next + Character.charCount(cp2);
            } else {
                i = next;
            }
        }
        return sb.toString();
    }

    private static boolean isRegionalIndicator(int cp) {
        return cp >= 0x1F1E6 && cp <= 0x1F1FF;
    }

    /** "Costa Rica" -> "C _ _ _ _   R _ _ _" */
    static String hintFor(String answer) {
        StringBuilder sb = new StringBuilder();
        boolean startOfWord = true;
        for (int i = 0; i < answer.length(); i++) {
            char ch = answer.charAt(i);
            if (ch == ' ') {
                sb.append("   ");
                startOfWord = true;
                continue;
            }
            if (!startOfWord) sb.append(NBSP); // espacio que no parte la palabra en dos líneas
            if (Character.isLetterOrDigit(ch)) {
                sb.append(startOfWord ? Character.toUpperCase(ch) : '_');
                startOfWord = false;
            } else {
                sb.append(ch);
            }
        }
        return sb.toString();
    }

    private String scramble(String answer) {
        String up = answer.toUpperCase(Locale.forLanguageTag("es"));
        String[] words = up.split(" ");
        StringBuilder out = new StringBuilder();
        for (String w : words) {
            if (out.length() > 0) out.append("   ");
            String best = w;
            for (int attempt = 0; attempt < 12; attempt++) {
                List<Character> chars = new ArrayList<Character>();
                for (char ch : w.toCharArray()) chars.add(ch);
                Collections.shuffle(chars, rnd);
                StringBuilder sb = new StringBuilder();
                for (char ch : chars) sb.append(ch);
                best = sb.toString();
                if (!best.equals(w)) break;
            }
            for (int i = 0; i < best.length(); i++) {
                if (i > 0) out.append(NBSP);
                out.append(best.charAt(i));
            }
        }
        return out.toString();
    }

    /** Cada línea: "pista = respuesta / otra forma de escribirla" */
    static Category parseCustom(String text) {
        Category c = new Category("custom", "Personalizada", "✍️", "Pistas del anfitrión", "text");
        for (String line : text.split("\n")) {
            int sep = line.indexOf('=');
            if (sep < 0) sep = line.indexOf('|');
            if (sep < 0) continue;
            String prompt = line.substring(0, sep).trim();
            String[] answers = line.substring(sep + 1).split("/");
            String answer = answers[0].trim();
            if (prompt.isEmpty() || Matcher.normalize(answer).isEmpty()) continue;
            List<String> aliases = new ArrayList<String>();
            for (int i = 1; i < answers.length; i++) aliases.add(answers[i].trim());
            c.add(new Item(prompt, answer, aliases));
        }
        return c;
    }

    private boolean isHost(String pid) {
        Player p = players.get(pid);
        if (p != null) p.lastSeen = System.currentTimeMillis();
        return p != null && p.host;
    }

    private String cleanName(String raw) {
        if (raw == null) return "";
        String n = raw.replaceAll("[\\p{Cc}<>]", "").trim().replaceAll("\\s+", " ");
        if (n.length() > 16) n = n.substring(0, 16).trim();
        return n;
    }

    private String uniqueName(String name) {
        String candidate = name;
        int n = 2;
        while (nameTaken(candidate)) candidate = name + " " + (n++);
        return candidate;
    }

    private boolean nameTaken(String name) {
        for (Player p : players.values()) if (p.name.equalsIgnoreCase(name)) return true;
        return false;
    }

    private String newId() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 16; i++) sb.append(Integer.toHexString(rnd.nextInt(16)));
        return sb.toString();
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    static JSONObject ok() throws JSONException {
        return new JSONObject().put("ok", true);
    }

    static JSONObject error(String msg) throws JSONException {
        return new JSONObject().put("error", msg);
    }
}
