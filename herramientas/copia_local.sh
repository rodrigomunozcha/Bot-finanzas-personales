#!/bin/bash
#
# Copia local de la planilla, en un solo comando.
#
# Por que no lee la carpeta de Google Drive del Mac:
#
# Drive para escritorio deja la carpeta en ~/Library/CloudStorage, que macOS
# protege con TCC. Leerla desde una terminal exige darle "Acceso total al
# disco", que es permiso para leer TODO el disco, para siempre y para cualquier
# cosa que se corra desde ahi. No existe una version acotada a esa sola carpeta:
# el contenido de un proveedor de archivos en la nube esta detras de ese permiso
# y de ningun otro. Pagar un permiso de todo el disco para leer un archivo de
# 40 KB no sale a cuenta.
#
# Asi que este archivo no la lee. Le pide el .xlsx directo a Google por el
# navegador, donde la sesion ya esta iniciada, y cae en Descargas como
# cualquier descarga. Cero permisos nuevos, cero credenciales guardadas en el
# Mac, cero servicios extra.
#
# Uso:
#   bash herramientas/copia_local.sh
#
# La primera vez pregunta el identificador de la planilla y lo guarda en
# config.local.json, que no se versiona: apunta a la cuenta personal.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$RAIZ/config.local.json"
DESCARGAS="$HOME/Downloads"

leer_id() {
  [ -f "$CONFIG" ] || return 1
  /usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("hojaId",""))' \
    "$CONFIG" 2>/dev/null
}

HOJA_ID="$(leer_id || true)"

if [ -z "${HOJA_ID:-}" ]; then
  echo "No sé cuál es tu planilla todavía. Esto se pregunta una sola vez."
  echo
  echo "Escríbele /datos al bot en Telegram. Te va a mandar un enlace así:"
  echo "  https://docs.google.com/spreadsheets/d/AQUI_VA_EL_IDENTIFICADOR/edit"
  echo
  echo "Pega ese enlace completo y aprieta Enter:"
  read -r PEGADO
  # Del enlace se saca solo el identificador. Se acepta el enlace entero porque
  # pedirle a alguien que recorte un trozo de una direccion larga es pedirle que
  # se equivoque.
  HOJA_ID="$(printf '%s' "$PEGADO" | sed -n 's#.*/spreadsheets/d/\([a-zA-Z0-9_-]*\).*#\1#p')"
  [ -n "$HOJA_ID" ] || HOJA_ID="$PEGADO"

  if ! printf '%s' "$HOJA_ID" | grep -qE '^[a-zA-Z0-9_-]{20,}$'; then
    echo
    echo "Eso no parece un enlace de Google Sheets. Vuelve a intentarlo." >&2
    exit 1
  fi

  /usr/bin/python3 -c 'import json,sys; json.dump({"hojaId": sys.argv[2]}, open(sys.argv[1],"w"))' \
    "$CONFIG" "$HOJA_ID"
  chmod 600 "$CONFIG"
  echo "Guardado. No vuelvo a preguntar."
  echo
fi

# Marca de tiempo del Excel mas reciente que ya estaba, para distinguir el que
# llegue ahora de uno viejo. Sin esto, una descarga que falla se ve igual que
# una que funciona: el importador tomaria el archivo de la semana pasada y
# diria que todo salio bien.
antes="$(ls -t "$DESCARGAS"/*.xlsx 2>/dev/null | head -1 || true)"
antes_hora="$([ -n "$antes" ] && stat -f %m "$antes" || echo 0)"

echo "Pidiéndole la planilla a Google..."
open "https://docs.google.com/spreadsheets/d/$HOJA_ID/export?format=xlsx"

for _ in $(seq 60); do
  sleep 1
  nuevo="$(ls -t "$DESCARGAS"/*.xlsx 2>/dev/null | head -1 || true)"
  [ -n "$nuevo" ] || continue
  [ "$(stat -f %m "$nuevo")" -gt "$antes_hora" ] || continue
  # Una descarga a medias ya existe como archivo. El .xlsx es un zip, y un zip
  # incompleto no pasa la prueba de integridad, asi que se espera al siguiente
  # segundo en vez de importar la mitad.
  /usr/bin/unzip -tqq "$nuevo" >/dev/null 2>&1 || continue

  echo "Llegó: $(basename "$nuevo")"
  echo
  exec /usr/bin/python3 "$RAIZ/herramientas/respaldar.py" "$nuevo"
done

echo >&2
echo "No llegó ninguna planilla a $DESCARGAS en un minuto." >&2
echo >&2
echo "Suele ser una de dos:" >&2
echo "  - El navegador abrió la sesión de otra cuenta de Google. Cierra las" >&2
echo "    demás, o abre el enlace en una ventana donde solo esté la tuya." >&2
echo "  - El navegador preguntó dónde guardar y quedó esperando respuesta." >&2
echo >&2
echo "Si el archivo ya está en Descargas, impórtalo directo:" >&2
echo "  python3 herramientas/respaldar.py ~/Downloads/loquesea.xlsx" >&2
exit 1
