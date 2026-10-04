import com.adivinaadivinador.app.Matcher;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Prueba rápida del puntaje por ortografía: java MatcherCheck */
public class MatcherCheck {
    static int fails = 0;

    static void check(String guess, String answer, int tol, double expected, Set<String> others) {
        List<String> acc = Arrays.asList(Matcher.normalize(answer));
        Matcher.Result r = Matcher.score(guess, acc, others, tol);
        boolean ok = Math.abs(r.accuracy - expected) < 1e-9;
        if (!ok) fails++;
        System.out.printf("%s  %-28s vs %-16s -> %.2f %s%n", ok ? "OK  " : "FAIL", guess, answer, r.accuracy, r.label);
    }

    public static void main(String[] a) {
        Set<String> others = new HashSet<String>(Arrays.asList("iran", "irak", "colombia", "austria", "australia"));
        check("Colombia", "Colombia", Matcher.NORMAL, 1, others);
        check("  colombia ", "Colombia", Matcher.NORMAL, 1, others);
        check("Olombia", "Colombia", Matcher.NORMAL, 0.8, others);
        check("Colmobia", "Colombia", Matcher.NORMAL, 0.8, others);
        check("Kolombya", "Colombia", Matcher.NORMAL, 0.35, others);
        check("Peru", "Perú", Matcher.NORMAL, 1, others);
        check("Irak", "Irán", Matcher.NORMAL, 0, others);
        check("Australia", "Austria", Matcher.NORMAL, 0, others);
        check("Bogota", "Bogotá", Matcher.NORMAL, 1, others);
        check("la torre eifel", "Torre Eiffel", Matcher.NORMAL, 0.8, others);
        check("se lo lleva la corriente", "se lo lleva la corriente", Matcher.NORMAL, 1, others);
        check("se la lleva la corriente", "se lo lleva la corriente", Matcher.NORMAL, 0.8, others);
        check("brasil", "Chile", Matcher.NORMAL, 0, others);
        check("Olombia", "Colombia", Matcher.STRICT, 0.5, others);
        check("Kolombya", "Colombia", Matcher.STRICT, 0, others);
        check("Kolombya", "Colombia", Matcher.GENEROUS, 0.7, others);
        check("", "Colombia", Matcher.NORMAL, 0, others);
        check("Mc Donalds", "McDonald's", Matcher.NORMAL, 1, others);
        check("H&M", "H y M", Matcher.NORMAL, 1, others);
        System.out.println(fails == 0 ? "Todo bien" : fails + " fallos");
        if (fails > 0) System.exit(1);
    }
}
