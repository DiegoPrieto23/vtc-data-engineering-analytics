"""Servidor estático del informe interactivo.

El informe de `report/` es un sitio estático que lee los JSON de `report/data/`,
así que necesita servirse por HTTP: abrirlo con `file://` hace que el navegador
bloquee el `fetch` de los extractos.

Este script existe para que `docker compose up` deje el informe accesible y, sobre
todo, **imprima en los logs la URL exacta** en la que está escuchando, en lugar de
que haya que deducir el puerto del `docker-compose.yml`.

Variables de entorno:
  REPORT_PORT  Puerto de escucha (por defecto 8080). En Docker Compose se publica
               el mismo puerto dentro y fuera del contenedor, de modo que la URL
               que se imprime aquí es válida desde el host.
  REPORT_HOST  Interfaz de escucha (por defecto 0.0.0.0, necesario en contenedor).
"""

import os
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

REPORT_DIR = Path(__file__).resolve().parent.parent / "report"

# El banner lleva acentos y emojis. Dentro del contenedor la salida ya es UTF-8, pero
# ejecutado directamente en una consola de Windows (cp1252) un `print` con esos caracteres
# lanza UnicodeEncodeError y tira el servidor antes de arrancar.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):  # pragma: no cover - streams no reconfigurables
        pass


class ReportHandler(SimpleHTTPRequestHandler):
    """Sirve el informe sin caché, para que los extractos regenerados se vean al recargar."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


def main():
    host = os.getenv("REPORT_HOST", "0.0.0.0")
    port = int(os.getenv("REPORT_PORT", "8080"))

    if not (REPORT_DIR / "index.html").exists():
        raise SystemExit(f"[ERROR] No se encuentra el informe en {REPORT_DIR}/index.html")

    handler = partial(ReportHandler, directory=str(REPORT_DIR))
    server = HTTPServer((host, port), handler)

    url = f"http://localhost:{port}"
    line = "─" * 52
    print(f"\n{line}", flush=True)
    print("  📊 Informe VTC disponible en:", flush=True)
    print(f"     👉 {url}", flush=True)
    print(f"\n  Sirviendo {REPORT_DIR} (escuchando en {host}:{port})", flush=True)
    print("  Ctrl+C o `docker compose down` para pararlo.", flush=True)
    print(f"{line}\n", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Servidor del informe detenido.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
