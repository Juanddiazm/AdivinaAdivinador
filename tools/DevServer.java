import com.adivinaadivinador.app.Discovery;
import com.adivinaadivinador.app.GameServer;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Corre el servidor del juego en el computador para probar sin teléfono:
 *   tools/dev_server.sh   y luego abrir http://localhost:8080/#host=dev&name=Anfitrion
 */
public class DevServer {
    public static void main(String[] args) throws Exception {
        final File root = new File(args.length > 0 ? args[0] : "app/src/main/assets");
        GameServer server = new GameServer(new GameServer.AssetSource() {
            @Override
            public InputStream open(String path) throws IOException {
                return new FileInputStream(new File(root, path));
            }
        }, "dev");
        int port = server.start(GameServer.DEFAULT_PORT);
        new Discovery.Responder(server).start();
        System.out.println("Servidor en http://localhost:" + port + "/#host=dev&name=Anfitrion");
        Thread.currentThread().join();
    }
}
