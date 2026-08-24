"""Respalda la hoja de Google en una base SQLite local.

    python3 herramientas/respaldar.py

Busca en Descargas el Excel mas reciente exportado desde tu hoja Finanzas, lo
importa, y deja los datos en datos/finanzas.db mas un CSV para abrir en Excel.

Dos decisiones que importan:

1. NUNCA BORRA NADA. Los movimientos se agregan o se actualizan por su id, pero
   ningun registro se elimina aunque desaparezca de la hoja. Esa es toda la
   gracia de un respaldo: si la hoja se corrompe o se borra por accidente, la
   base local sigue teniendo el historial completo.

2. No corre solo ni deja nada en segundo plano. Se ejecuta cuando tu lo pides,
   tarda un segundo, y termina. El Mac no gasta nada el resto del tiempo.
"""

import csv
import datetime
import os
import sqlite3
import sys
import glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lector_xlsx import leer_hojas, serial_a_fecha   # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(RAIZ, "datos", "finanzas.db")
CSV_SALIDA = os.path.join(RAIZ, "datos", "movimientos.csv")
DESCARGAS = os.path.expanduser("~/Downloads")

# Columnas de la hoja y su nombre en la base. El orden no importa: se calzan por
# el encabezado, asi que agregar una columna en Sheets no rompe la importacion.
COLUMNAS = {
    "id": "id",
    "fechaHora": "fecha_hora",
    "tipo": "tipo",
    "comercio": "comercio",
    "monto": "monto",
    "moneda": "moneda",
    "montoClp": "monto_clp",
    "medioPago": "medio_pago",
    "categoria": "categoria",
    "subcategoria": "subcategoria",
    "nota": "nota",
    "estado": "estado",
    "correoId": "correo_id",
    "creado": "creado",
}
FECHAS = {"fechaHora", "creado", "actualizado"}
NUMEROS = {"monto", "montoClp", "confirmaciones"}


def crear_base(con):
    con.executescript("""
        CREATE TABLE IF NOT EXISTS movimientos (
            id            TEXT PRIMARY KEY,
            fecha_hora    TEXT,
            tipo          TEXT,
            comercio      TEXT,
            monto         REAL,
            moneda        TEXT,
            monto_clp     REAL,
            medio_pago    TEXT,
            categoria     TEXT,
            subcategoria  TEXT,
            nota          TEXT,
            estado        TEXT,
            correo_id     TEXT,
            creado        TEXT,
            visto_en      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_fecha ON movimientos (fecha_hora);
        CREATE INDEX IF NOT EXISTS idx_categoria ON movimientos (categoria);

        CREATE TABLE IF NOT EXISTS aprendizaje (
            comercio       TEXT PRIMARY KEY,
            categoria      TEXT,
            subcategoria   TEXT,
            confirmaciones INTEGER,
            actualizado    TEXT
        );

        -- Categorias que el usuario creo desde el bot. No estan en el codigo:
        -- si se pierde la hoja de Google y no estuvieran aca, se perderian, y
        -- eso contradice la razon de ser de este respaldo. La clave es la
        -- pareja categoria + subcategoria, porque una categoria puede tener
        -- varias filas (una por subcategoria) y ninguna es "la principal".
        CREATE TABLE IF NOT EXISTS categorias_personalizadas (
            tipo         TEXT,
            categoria    TEXT,
            subcategoria TEXT,
            creado       TEXT,
            PRIMARY KEY (tipo, categoria, subcategoria)
        );

        CREATE TABLE IF NOT EXISTS respaldos (
            cuando   TEXT,
            archivo  TEXT,
            nuevos   INTEGER,
            editados INTEGER,
            total    INTEGER
        );
    """)


def excel_mas_reciente():
    """El Excel de Finanzas descargado mas recientemente."""
    candidatos = [
        r for r in glob.glob(os.path.join(DESCARGAS, "*.xlsx"))
        if "finanzas" in os.path.basename(r).lower()
    ]
    if not candidatos:
        return None
    return max(candidatos, key=os.path.getmtime)


def limpiar(campo, valor):
    if valor in ("", None):
        return None
    if campo in FECHAS:
        fecha = serial_a_fecha(valor)
        if fecha:
            # Los movimientos traen hora; lo demas no la necesita.
            return fecha.strftime("%Y-%m-%d %H:%M" if fecha.hour or fecha.minute
                                  else "%Y-%m-%d")
        return str(valor)
    if campo in NUMEROS:
        try:
            return float(valor)
        except ValueError:
            return None
    return str(valor)


def filas_como_diccionarios(hoja):
    if not hoja or len(hoja) < 2:
        return []
    encabezados = [str(c).strip() for c in hoja[0]]
    salida = []
    for fila in hoja[1:]:
        if not any(str(c).strip() for c in fila):
            continue
        salida.append({
            encabezados[i]: fila[i] if i < len(fila) else ""
            for i in range(len(encabezados))
        })
    return salida


def importar_movimientos(con, hoja, ahora):
    nuevos = editados = 0
    for cruda in filas_como_diccionarios(hoja):
        if not cruda.get("id"):
            continue

        fila = {destino: limpiar(origen, cruda.get(origen, ""))
                for origen, destino in COLUMNAS.items()}
        fila["visto_en"] = ahora

        previo = con.execute(
            "SELECT categoria, subcategoria, nota, estado, monto_clp"
            " FROM movimientos WHERE id = ?", (fila["id"],)
        ).fetchone()

        campos = ", ".join(fila)
        marcas = ", ".join("?" for _ in fila)
        actualiza = ", ".join(f"{c}=excluded.{c}" for c in fila if c != "id")
        con.execute(
            f"INSERT INTO movimientos ({campos}) VALUES ({marcas})"
            f" ON CONFLICT(id) DO UPDATE SET {actualiza}",
            list(fila.values())
        )

        if previo is None:
            nuevos += 1
        elif tuple(previo) != (fila["categoria"], fila["subcategoria"],
                               fila["nota"], fila["estado"], fila["monto_clp"]):
            editados += 1
    return nuevos, editados


def importar_aprendizaje(con, hoja):
    for cruda in filas_como_diccionarios(hoja):
        if not cruda.get("comercio"):
            continue
        con.execute(
            "INSERT INTO aprendizaje (comercio, categoria, subcategoria,"
            " confirmaciones, actualizado) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(comercio) DO UPDATE SET categoria=excluded.categoria,"
            " subcategoria=excluded.subcategoria,"
            " confirmaciones=excluded.confirmaciones,"
            " actualizado=excluded.actualizado",
            (str(cruda["comercio"]),
             str(cruda.get("categoria") or ""),
             str(cruda.get("subcategoria") or ""),
             limpiar("confirmaciones", cruda.get("confirmaciones", 0)) or 0,
             limpiar("actualizado", cruda.get("actualizado", "")))
        )


def importar_categorias_personalizadas(con, hoja):
    """Las categorias que el usuario agrego desde el bot.

    Se insertan sin borrar: igual que los movimientos, una categoria que
    desaparezca de la hoja sigue estando aca. Las filas repetidas de la hoja
    (agregar dos veces la misma categoria escribe dos) colapsan solas por la
    clave primaria, asi que la copia local queda mas limpia que el original.
    """
    for cruda in filas_como_diccionarios(hoja):
        if not cruda.get("tipo") or not cruda.get("categoria"):
            continue
        con.execute(
            "INSERT OR REPLACE INTO categorias_personalizadas"
            " (tipo, categoria, subcategoria, creado) VALUES (?, ?, ?, ?)",
            (str(cruda["tipo"]),
             str(cruda["categoria"]),
             str(cruda.get("subcategoria") or ""),
             limpiar("creado", cruda.get("creado", "")))
        )


def exportar_csv(con):
    """CSV con marca de orden de bytes, para que Excel respete los acentos."""
    filas = con.execute(
        "SELECT fecha_hora, tipo, comercio, monto, moneda, monto_clp,"
        " medio_pago, categoria, subcategoria, nota, estado"
        " FROM movimientos ORDER BY fecha_hora DESC"
    )
    with open(CSV_SALIDA, "w", encoding="utf-8-sig", newline="") as f:
        escritor = csv.writer(f)
        escritor.writerow([d[0] for d in filas.description])
        escritor.writerows(filas)


def main():
    ruta = sys.argv[1] if len(sys.argv) > 1 else excel_mas_reciente()

    if not ruta or not os.path.exists(ruta):
        print("No encontré ningún Excel de Finanzas en Descargas.\n")
        print("Para exportarlo:")
        print("  1. Abre tu hoja Finanzas en Google Sheets")
        print("  2. Archivo -> Descargar -> Microsoft Excel (.xlsx)")
        print("  3. Vuelve a correr este comando\n")
        print("También puedes pasarle la ruta:")
        print("  python3 herramientas/respaldar.py ~/Downloads/loquesea.xlsx")
        return 1

    hojas = leer_hojas(ruta)
    if "movimientos" not in hojas:
        print(f"'{os.path.basename(ruta)}' no tiene una hoja 'movimientos'.")
        print(f"Hojas encontradas: {', '.join(hojas) or 'ninguna'}")
        return 1

    ahora = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    os.makedirs(os.path.dirname(BASE), exist_ok=True)

    with sqlite3.connect(BASE) as con:
        crear_base(con)
        nuevos, editados = importar_movimientos(con, hojas["movimientos"], ahora)
        if "aprendizaje" in hojas:
            importar_aprendizaje(con, hojas["aprendizaje"])
        if "categorias_personalizadas" in hojas:
            importar_categorias_personalizadas(
                con, hojas["categorias_personalizadas"])

        total = con.execute("SELECT COUNT(*) FROM movimientos").fetchone()[0]
        con.execute("INSERT INTO respaldos VALUES (?, ?, ?, ?, ?)",
                    (ahora, os.path.basename(ruta), nuevos, editados, total))
        exportar_csv(con)

        sin_categoria = con.execute(
            "SELECT COUNT(*) FROM movimientos WHERE estado LIKE 'esperando%'"
        ).fetchone()[0]

    print(f"Respaldado desde {os.path.basename(ruta)}")
    print(f"  {nuevos} movimientos nuevos, {editados} actualizados")
    print(f"  {total} en total guardados en datos/finanzas.db")
    if sin_categoria:
        print(f"  ojo: {sin_categoria} sin categoría (revísalos con /pendientes)")
    print(f"\nCSV para Excel: {os.path.relpath(CSV_SALIDA, RAIZ)}")
    print("\nAvísale al bot escribiéndole:  /respaldado")
    return 0


if __name__ == "__main__":
    sys.exit(main())
