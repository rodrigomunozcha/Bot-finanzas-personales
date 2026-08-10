"""Lee un .xlsx usando solo la libreria estandar de Python.

No se usa openpyxl ni pandas a proposito: el proyecto tiene que funcionar en
cualquier Mac sin instalar nada. Un .xlsx es un zip con XML adentro, y leerlo
son unas cuarenta lineas.

Solo cubre lo que necesitamos: hojas con valores, textos compartidos y fechas.
No entiende formulas, formatos ni graficos, y no le hace falta.
"""

import datetime
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# Excel cuenta los dias desde el 30 de diciembre de 1899. El desfase de dos dias
# respecto a lo que uno esperaria viene de un error de Lotus 1-2-3 que Excel
# copio en los anos ochenta y nunca corrigio, por compatibilidad.
ORIGEN_EXCEL = datetime.datetime(1899, 12, 30)


def serial_a_fecha(valor):
    """Convierte el numero con que Excel guarda las fechas a datetime."""
    try:
        return ORIGEN_EXCEL + datetime.timedelta(days=float(valor))
    except (TypeError, ValueError):
        return None


def _columna(ref):
    """'BC12' -> 54 (indice de columna, base 0)."""
    letras = "".join(c for c in ref if c.isalpha())
    n = 0
    for c in letras:
        n = n * 26 + (ord(c) - 64)
    return n - 1


def leer_hojas(ruta):
    """Devuelve {nombre_de_hoja: [[celda, ...], ...]} con todo como texto."""
    with zipfile.ZipFile(ruta) as z:
        compartidos = []
        if "xl/sharedStrings.xml" in z.namelist():
            compartidos = [
                "".join(t.text or "" for t in si.iter(NS + "t"))
                for si in ET.fromstring(z.read("xl/sharedStrings.xml"))
            ]

        # El nombre visible de cada hoja vive en workbook.xml, y el archivo que
        # le corresponde en workbook.xml.rels. Hay que cruzarlos.
        libro = ET.fromstring(z.read("xl/workbook.xml"))
        relaciones = {
            r.get("Id"): r.get("Target")
            for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        }

        hojas = {}
        for hoja in libro.iter(NS + "sheet"):
            destino = relaciones[hoja.get(NS_REL + "id")].lstrip("/")
            if not destino.startswith("xl/"):
                destino = "xl/" + destino
            hojas[hoja.get("name")] = _leer_hoja(z.read(destino), compartidos)
        return hojas


def _leer_hoja(xml, compartidos):
    filas = []
    for fila_xml in ET.fromstring(xml).iter(NS + "row"):
        fila = []
        for celda in fila_xml.iter(NS + "c"):
            # Las celdas vacias no aparecen en el XML: hay que rellenar segun la
            # referencia (A1, B1, ...) o las columnas quedarian corridas.
            destino = _columna(celda.get("r", ""))
            while len(fila) < destino:
                fila.append("")

            v = celda.find(NS + "v")
            valor = v.text if v is not None else ""
            if celda.get("t") == "s" and valor:
                valor = compartidos[int(valor)]
            elif celda.get("t") == "inlineStr":
                valor = "".join(t.text or "" for t in celda.iter(NS + "t"))
            fila.append(valor)
        filas.append(fila)
    return filas
