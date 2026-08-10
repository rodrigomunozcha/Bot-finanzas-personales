"""Extrae el arbol de categorias de gasto desde un respaldo .mmbak de Money Manager.

El .mmbak es una base SQLite sin cifrar. Las categorias viven en ZCATEGORY:
  ZDOTYPE = 1  -> gasto
  ZDOTYPE = 0  -> ingreso
  ZISDEL  = 1  -> borrada, se ignora
  ZPUID        -> apunta al ZUID del padre

Ojo: la app marca "sin padre" de dos formas distintas segun la version que creo
la categoria, con cadena vacia y con el literal "0". Si solo se considera una de
las dos, la mitad del arbol se pierde en silencio.

Las categorias de ingreso no se toman del respaldo. Un arbol de ingresos suele
venir atado al pais y al trabajo de quien lo escribio, asi que el de
datos/categorias_ingreso.json esta pensado desde cero y es facil de ajustar.

Uso:
    python3 herramientas/extraer_categorias.py <respaldo.mmbak> > datos/categorias_gasto.json
"""

import json
import sqlite3
import sys


def extraer(ruta_respaldo):
    con = sqlite3.connect(f"file:{ruta_respaldo}?mode=ro", uri=True)
    filas = con.execute(
        """
        SELECT c.ZUID, c.ZNAME, c.ZPUID, c.ZORDER
        FROM ZCATEGORY c
        WHERE c.ZDOTYPE = 1 AND c.ZISDEL = 0
        """
    ).fetchall()
    con.close()

    SIN_PADRE = (None, "", "0")

    por_uid = {uid: (nombre, puid, orden) for uid, nombre, puid, orden in filas}
    raices = [(uid, n, o) for uid, (n, p, o) in por_uid.items() if p in SIN_PADRE]
    raices.sort(key=lambda r: r[2])

    arbol = []
    for uid, nombre, _ in raices:
        hijas = [(n, o) for _, (n, p, o) in por_uid.items() if p == uid]
        hijas.sort(key=lambda h: h[1])
        arbol.append({"nombre": nombre, "subcategorias": [n for n, _ in hijas]})
    return arbol


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    print(json.dumps(extraer(sys.argv[1]), ensure_ascii=False, indent=2))
