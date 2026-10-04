package com.adivinaadivinador.app;

import java.text.Normalizer;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Compara lo que escribe un jugador con la respuesta correcta y decide qué
 * tan bien la escribió. "Colombia" vale el 100 %, "Olombia" o "Colonbia"
 * valen una parte de los puntos, y otra respuesta válida de la misma
 * categoría ("Irak" cuando era "Irán") no vale nada.
 */
public final class Matcher {

    public static final int STRICT = 0;
    public static final int NORMAL = 1;
    public static final int GENEROUS = 2;

    public static final class Result {
        public final double accuracy;
        public final String label;

        Result(double accuracy, String label) {
            this.accuracy = accuracy;
            this.label = label;
        }
    }

    private static final Set<String> LEADING_ARTICLES = new HashSet<String>(Arrays.asList(
            "el", "la", "los", "las", "lo", "un", "una", "the"));

    private Matcher() {
    }

    /** Minúsculas, sin tildes, sin signos, sin espacios y sin artículo inicial. */
    public static String normalize(String s) {
        if (s == null) return "";
        String t = s.trim().toLowerCase(Locale.ROOT);
        t = Normalizer.normalize(t, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        t = t.replace("&", " y ");
        t = t.replaceAll("[^a-z0-9]+", " ").trim();
        if (t.isEmpty()) return "";
        String[] words = t.split(" ");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < words.length; i++) {
            if (i == 0 && words.length > 1 && LEADING_ARTICLES.contains(words[0])) continue;
            sb.append(words[i]);
        }
        return sb.toString();
    }

    /** Distancia de Damerau-Levenshtein (versión OSA): cuenta letras cambiadas, de más, de menos o volteadas. */
    public static int distance(String a, String b) {
        int n = a.length(), m = b.length();
        int[][] d = new int[n + 1][m + 1];
        for (int i = 0; i <= n; i++) d[i][0] = i;
        for (int j = 0; j <= m; j++) d[0][j] = j;
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= m; j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                int v = Math.min(Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1), d[i - 1][j - 1] + cost);
                if (i > 1 && j > 1 && a.charAt(i - 1) == b.charAt(j - 2) && a.charAt(i - 2) == b.charAt(j - 1)) {
                    v = Math.min(v, d[i - 2][j - 2] + 1);
                }
                d[i][j] = v;
            }
        }
        return d[n][m];
    }

    /**
     * @param guess         lo que escribió el jugador
     * @param answers       respuestas aceptadas, ya normalizadas
     * @param otherAnswers  todas las respuestas normalizadas de la categoría (para detectar "es otra")
     * @param tolerance     STRICT, NORMAL o GENEROUS
     */
    public static Result score(String guess, Collection<String> answers, Set<String> otherAnswers, int tolerance) {
        String g = normalize(guess);
        if (g.isEmpty()) return new Result(0, "Sin respuesta");

        int bestD = Integer.MAX_VALUE;
        int bestLen = 1;
        double bestRatio = Double.MAX_VALUE;
        for (String a : answers) {
            if (a.isEmpty()) continue;
            if (g.equals(a)) return new Result(1, "¡Exacto!");
            int d = distance(g, a);
            double ratio = (double) d / a.length();
            if (ratio < bestRatio) {
                bestRatio = ratio;
                bestD = d;
                bestLen = a.length();
            }
        }
        if (otherAnswers != null && otherAnswers.contains(g)) {
            return new Result(0, "Esa es otra respuesta");
        }

        switch (tolerance) {
            case STRICT:
                if (bestD == 1 && bestLen >= 5) return new Result(0.5, "Casi (un error)");
                break;
            case GENEROUS:
                if (bestD <= 1 && bestLen >= 3) return new Result(0.9, "¡Casi perfecto!");
                if (bestRatio <= 0.25) return new Result(0.7, "Muy cerca");
                if (bestRatio <= 0.4) return new Result(0.45, "Se parece");
                if (bestRatio <= 0.5 && bestLen >= 6) return new Result(0.2, "Algo parecido");
                break;
            default:
                if (bestD == 1 && bestLen >= 4) return new Result(0.8, "¡Casi perfecto!");
                if (bestRatio <= 0.2 && bestLen >= 5) return new Result(0.6, "Muy cerca");
                if (bestRatio <= 0.34 && bestLen >= 6) return new Result(0.35, "Se parece");
                break;
        }
        return new Result(0, "Incorrecto");
    }
}
