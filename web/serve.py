"""Servidor estático de desenvolvimento, sem cache.

Por que isto existe: `python -m http.server` deixa o Chrome guardar os .js
em cache. Aí você edita uma constante (DWELL_Z_MS, por exemplo), reinicia o
servidor, recarrega a página — e nada muda, porque o arquivo velho está no
cache DO NAVEGADOR, não do servidor. Reiniciar o servidor não resolve.

Este servidor manda `Cache-Control: no-store` em tudo, então cada recarga
busca os arquivos de novo.

Uso:
    cd web
    python serve.py            # porta 8080
    python serve.py 9000       # outra porta

Depois abra http://localhost:8080 no Chrome ou Edge (a Web Serial API exige
contexto seguro: localhost serve, file:// não).
"""

import functools
import http.server
import os
import socketserver
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # uma linha curta por requisição, sem o timestamp barulhento
        sys.stderr.write("%s %s\n" % (self.command, self.path))


def main():
    port = 8080
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("porta inválida: %s" % sys.argv[1], file=sys.stderr)
            return 1

    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        print("servindo %s" % root)
        print("http://localhost:%d  (sem cache) — Ctrl+C para parar" % port)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nparado")
    return 0


if __name__ == "__main__":
    sys.exit(main())
