import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * Alinea (como zipalign) y firma un APK con el esquema v2 usando apksig; luego lo verifica.
 *   java -cp apksig.jar:. ApkSign entrada.apk salida.apk llaves.p12 clave alias minSdk
 */
public class ApkSign {
    private static final int ALIGN = 4;
    private static final short ALIGN_EXTRA_ID = (short) 0xd935; // el mismo campo que usa zipalign

    public static void main(String[] a) throws Exception {
        File in = new File(a[0]), out = new File(a[1]);
        File aligned = new File(out.getPath() + ".aligned");
        align(in, aligned);

        char[] pass = a[3].toCharArray();
        KeyStore ks = KeyStore.getInstance("PKCS12");
        FileInputStream f = new FileInputStream(a[2]);
        ks.load(f, pass);
        f.close();
        PrivateKey key = (PrivateKey) ks.getKey(a[4], pass);
        X509Certificate cert = (X509Certificate) ks.getCertificate(a[4]);

        ApkSigner.SignerConfig cfg = new ApkSigner.SignerConfig.Builder("ADIVINA", key, Collections.singletonList(cert)).build();
        new ApkSigner.Builder(Collections.singletonList(cfg))
                .setInputApk(aligned)
                .setOutputApk(out)
                .setMinSdkVersion(Integer.parseInt(a[5]))
                .setV1SigningEnabled(false) // minSdk 24: basta con v2 (v1 de apksig 2.3 no funciona en JDK 17+)
                .setV2SigningEnabled(true)
                .setCreatedBy("Adivina Adivinador build_apk.sh")
                .build()
                .sign();
        aligned.delete();

        checkAlignment(out);
        ApkVerifier.Result r = new ApkVerifier.Builder(out).build().verify();
        if (!r.isVerified()) {
            System.err.println("La firma NO es válida: " + r.getErrors());
            System.exit(1);
        }
        System.out.println("Alineado, firmado y verificado (v2=" + r.isVerifiedUsingV2Scheme() + ")");
    }

    /** Copia el zip agregando relleno a las entradas sin comprimir para que sus datos queden en múltiplos de 4. */
    static void align(File in, File out) throws IOException {
        ZipFile zip = new ZipFile(in);
        final long[] pos = {0};
        OutputStream counting = new FilterOutputStream(new FileOutputStream(out)) {
            @Override
            public void write(int b) throws IOException {
                out.write(b);
                pos[0]++;
            }

            @Override
            public void write(byte[] b, int off, int len) throws IOException {
                out.write(b, off, len);
                pos[0] += len;
            }
        };
        ZipOutputStream zos = new ZipOutputStream(counting);
        Enumeration<? extends ZipEntry> en = zip.entries();
        while (en.hasMoreElements()) {
            ZipEntry src = en.nextElement();
            byte[] data = readAll(zip.getInputStream(src));
            ZipEntry e = new ZipEntry(src.getName());
            e.setTime(src.getTime());
            if (src.getMethod() == ZipEntry.STORED) {
                e.setMethod(ZipEntry.STORED);
                e.setSize(data.length);
                e.setCompressedSize(data.length);
                e.setCrc(src.getCrc());
                zos.flush();
                int nameLen = src.getName().getBytes("UTF-8").length;
                long dataStart = pos[0] + 30 + nameLen + 6;
                int pad = (int) ((ALIGN - dataStart % ALIGN) % ALIGN);
                ByteBuffer extra = ByteBuffer.allocate(6 + pad).order(ByteOrder.LITTLE_ENDIAN);
                extra.putShort(ALIGN_EXTRA_ID).putShort((short) (2 + pad)).putShort((short) ALIGN);
                e.setExtra(extra.array());
            } else {
                e.setMethod(ZipEntry.DEFLATED);
            }
            zos.putNextEntry(e);
            zos.write(data);
            zos.closeEntry();
        }
        zos.close();
        zip.close();
    }

    /** Recorre el directorio central y falla si alguna entrada sin comprimir no está alineada. */
    static void checkAlignment(File apk) throws IOException {
        ByteBuffer b = ByteBuffer.wrap(Files.readAllBytes(apk.toPath())).order(ByteOrder.LITTLE_ENDIAN);
        int eocd = b.limit() - 22;
        while (eocd >= 0 && b.getInt(eocd) != 0x06054b50) eocd--;
        if (eocd < 0) throw new IOException("Zip inválido");
        int count = b.getShort(eocd + 10) & 0xffff;
        int p = b.getInt(eocd + 16);
        for (int i = 0; i < count; i++) {
            if (b.getInt(p) != 0x02014b50) throw new IOException("Directorio central inválido");
            int method = b.getShort(p + 10) & 0xffff;
            int n = b.getShort(p + 28) & 0xffff, e = b.getShort(p + 30) & 0xffff, c = b.getShort(p + 32) & 0xffff;
            int local = b.getInt(p + 42);
            String name = new String(b.array(), p + 46, n, "UTF-8");
            int data = local + 30 + (b.getShort(local + 26) & 0xffff) + (b.getShort(local + 28) & 0xffff);
            if (method == 0 && data % ALIGN != 0) throw new IOException("Entrada sin alinear: " + name);
            p += 46 + n + e + c;
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int r;
        while ((r = in.read(buf)) != -1) out.write(buf, 0, r);
        in.close();
        return out.toByteArray();
    }
}
