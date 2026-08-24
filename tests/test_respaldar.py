"""Pruebas del respaldo local.

Se construye un .xlsx igual al que exporta Google Sheets, con fechas como
numeros de serie y textos compartidos, porque ahi es donde se rompen las cosas.
"""

import contextlib
import datetime
import io
import os
import sqlite3
import sys
import tempfile
import unittest
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "herramientas"))

import respaldar  # noqa: E402
from lector_xlsx import leer_hojas, ORIGEN_EXCEL  # noqa: E402

ENCABEZADOS = ["id", "fechaHora", "tipo", "comercio", "monto", "moneda",
               "montoClp", "medioPago", "categoria", "subcategoria", "nota",
               "estado", "correoId", "mensajeId", "creado"]


def como_serial(cuando):
    return (cuando - ORIGEN_EXCEL).total_seconds() / 86400.0


def escribir_xlsx(ruta, hojas):
    """Arma un .xlsx minimo con la misma estructura que exporta Google."""
    textos, indice = [], {}

    def celda(ref, valor):
        if isinstance(valor, (int, float)):
            return f'<c r="{ref}"><v>{valor}</v></c>'
        if valor == "":
            return f'<c r="{ref}"/>'
        if valor not in indice:
            indice[valor] = len(textos)
            textos.append(valor)
        return f'<c r="{ref}" t="s"><v>{indice[valor]}</v></c>'

    def letra(n):
        s = ""
        while n >= 0:
            s = chr(65 + n % 26) + s
            n = n // 26 - 1
        return s

    partes = {}
    for numero, (nombre, filas) in enumerate(hojas.items(), start=1):
        xml = []
        for f, fila in enumerate(filas, start=1):
            celdas = "".join(celda(f"{letra(c)}{f}", v) for c, v in enumerate(fila))
            xml.append(f'<row r="{f}">{celdas}</row>')
        partes[f"xl/worksheets/sheet{numero}.xml"] = (
            '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats'
            '.org/spreadsheetml/2006/main"><sheetData>' + "".join(xml) +
            "</sheetData></worksheet>"
        )

    hojas_xml = "".join(
        f'<sheet name="{n}" sheetId="{i}" r:id="rId{i}"/>'
        for i, n in enumerate(hojas, start=1)
    )
    rels_xml = "".join(
        f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/'
        f'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
        for i in range(1, len(hojas) + 1)
    )

    with zipfile.ZipFile(ruta, "w") as z:
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0"?><workbook xmlns="http://schemas.openxml'
                   'formats.org/spreadsheetml/2006/main" xmlns:r="http://schemas'
                   '.openxmlformats.org/officeDocument/2006/relationships">'
                   f"<sheets>{hojas_xml}</sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0"?><Relationships xmlns="http://schemas.'
                   f'openxmlformats.org/package/2006/relationships">{rels_xml}'
                   "</Relationships>")
        z.writestr("xl/sharedStrings.xml",
                   '<?xml version="1.0"?><sst xmlns="http://schemas.openxml'
                   'formats.org/spreadsheetml/2006/main">' +
                   "".join(f"<si><t>{t}</t></si>" for t in textos) + "</sst>")
        for nombre, contenido in partes.items():
            z.writestr(nombre, contenido)


def movimiento(id_, comercio, monto, cuando, categoria="🍴 Alimentación",
               estado="cerrado", nota=""):
    return [id_, como_serial(cuando), "gasto", comercio, monto, "CLP", monto,
            "debito", categoria, "🛒 Supermercado", nota, estado, "correo1",
            "100", como_serial(cuando)]


class RespaldoTest(unittest.TestCase):
    def setUp(self):
        self.carpeta = tempfile.TemporaryDirectory()
        self.xlsx = os.path.join(self.carpeta.name, "Finanzas.xlsx")
        respaldar.BASE = os.path.join(self.carpeta.name, "finanzas.db")
        respaldar.CSV_SALIDA = os.path.join(self.carpeta.name, "movimientos.csv")

    def tearDown(self):
        self.carpeta.cleanup()

    def importar(self, movimientos, aprendizaje=None, categorias=None):
        hojas = {"movimientos": [ENCABEZADOS] + movimientos}
        if aprendizaje is not None:
            hojas["aprendizaje"] = [
                ["comercio", "categoria", "subcategoria", "confirmaciones",
                 "actualizado"]] + aprendizaje
        if categorias is not None:
            hojas["categorias_personalizadas"] = [
                ["tipo", "categoria", "subcategoria", "creado"]] + categorias
        escribir_xlsx(self.xlsx, hojas)
        sys.argv = ["respaldar.py", self.xlsx]
        # La salida del comando no interesa aca y ensucia el informe de pruebas.
        with contextlib.redirect_stdout(io.StringIO()):
            return respaldar.main()

    def consultar(self, sql, *args):
        with sqlite3.connect(respaldar.BASE) as con:
            return con.execute(sql, args).fetchall()

    def test_importa_y_convierte_la_fecha(self):
        cuando = datetime.datetime(2026, 8, 1, 14, 1)
        self.assertEqual(self.importar([movimiento("a1", "JUMBO", 12500, cuando)]), 0)

        filas = self.consultar("SELECT fecha_hora, comercio, monto FROM movimientos")
        self.assertEqual(filas, [("2026-08-01 13:20", "JUMBO", 12500.0)])

    def test_los_acentos_y_emoji_sobreviven(self):
        self.importar([movimiento("a1", "CAFETERÍA ALTURA", 4350,
                                  datetime.datetime(2026, 8, 3, 14, 49))])
        filas = self.consultar("SELECT comercio, categoria FROM movimientos")
        self.assertEqual(filas[0], ("CAFETERÍA ALTURA", "🍴 Alimentación"))

    def test_reimportar_no_duplica(self):
        mov = [movimiento("a1", "JUMBO", 12500, datetime.datetime(2026, 8, 1, 14, 1))]
        self.importar(mov)
        self.importar(mov)
        self.assertEqual(self.consultar("SELECT COUNT(*) FROM movimientos")[0][0], 1)

    def test_una_correccion_en_la_hoja_se_refleja(self):
        cuando = datetime.datetime(2026, 8, 1, 14, 1)
        self.importar([movimiento("a1", "JUMBO", 12500, cuando, categoria="🎁 Regalos")])
        self.importar([movimiento("a1", "JUMBO", 12500, cuando, categoria="🍴 Alimentación")])

        filas = self.consultar("SELECT categoria FROM movimientos WHERE id='a1'")
        self.assertEqual(filas[0][0], "🍴 Alimentación")

    # Esta es la razon de ser del respaldo: si la hoja se corrompe o alguien
    # borra filas por accidente, la base local tiene que conservarlas.
    def test_lo_que_desaparece_de_la_hoja_no_se_borra(self):
        cuando = datetime.datetime(2026, 8, 1, 14, 1)
        self.importar([
            movimiento("a1", "JUMBO", 12500, cuando),
            movimiento("a2", "COPEC", 30000, cuando),
        ])
        self.importar([movimiento("a1", "JUMBO", 12500, cuando)])   # hoja mutilada

        ids = sorted(f[0] for f in self.consultar("SELECT id FROM movimientos"))
        self.assertEqual(ids, ["a1", "a2"])

    def test_cuenta_los_gastos_sin_clasificar(self):
        cuando = datetime.datetime(2026, 8, 1, 14, 1)
        self.importar([
            movimiento("a1", "JUMBO", 12500, cuando),
            movimiento("a2", "DESCONOCIDO", 5000, cuando, estado="esperando_categoria"),
        ])
        pendientes = self.consultar(
            "SELECT COUNT(*) FROM movimientos WHERE estado LIKE 'esperando%'")
        self.assertEqual(pendientes[0][0], 1)

    def test_guarda_el_aprendizaje(self):
        self.importar([movimiento("a1", "JUMBO", 12500, datetime.datetime(2026, 8, 1))],
                      aprendizaje=[["JUMBO CENTRAL", "🍴 Alimentación", "🛒 Supermercado",
                                    3, como_serial(datetime.datetime(2026, 8, 1))]])
        filas = self.consultar("SELECT comercio, confirmaciones FROM aprendizaje")
        self.assertEqual(filas, [("JUMBO CENTRAL", 3)])

    # Las categorias que el usuario crea desde el bot no estan en el codigo.
    # Si no se respaldan, se pierden con la hoja, que es justo lo que este
    # respaldo promete evitar.
    def test_guarda_las_categorias_creadas_desde_el_bot(self):
        creado = como_serial(datetime.datetime(2026, 8, 22, 10, 0))
        self.importar(
            [movimiento("a1", "JUMBO", 12500, datetime.datetime(2026, 8, 1))],
            categorias=[
                ["gasto", "💸 Carrete", "", creado],
                ["gasto", "🐾 Mascotas", "Veterinario", creado],
            ])

        filas = self.consultar(
            "SELECT tipo, categoria, subcategoria FROM categorias_personalizadas"
            " ORDER BY categoria")
        self.assertEqual(filas, [
            ("gasto", "🐾 Mascotas", "Veterinario"),
            ("gasto", "💸 Carrete", ""),
        ])

    def test_una_categoria_repetida_en_la_hoja_no_se_duplica_en_la_base(self):
        creado = como_serial(datetime.datetime(2026, 8, 22, 10, 0))
        self.importar(
            [movimiento("a1", "JUMBO", 12500, datetime.datetime(2026, 8, 1))],
            categorias=[
                ["gasto", "💸 Carrete", "", creado],
                ["gasto", "💸 Carrete", "", creado],
            ])

        total = self.consultar(
            "SELECT COUNT(*) FROM categorias_personalizadas")[0][0]
        self.assertEqual(total, 1)

    def test_una_categoria_borrada_de_la_hoja_sigue_en_la_base(self):
        creado = como_serial(datetime.datetime(2026, 8, 22, 10, 0))
        mov = [movimiento("a1", "JUMBO", 12500, datetime.datetime(2026, 8, 1))]
        self.importar(mov, categorias=[["gasto", "💸 Carrete", "", creado]])
        self.importar(mov, categorias=[])   # el usuario la borró de la hoja

        filas = self.consultar(
            "SELECT categoria FROM categorias_personalizadas")
        self.assertEqual(filas, [("💸 Carrete",)])

    # Un respaldo hecho antes de que existiera esta hoja no puede fallar.
    def test_un_excel_sin_esa_hoja_se_importa_igual(self):
        self.assertEqual(
            self.importar([movimiento("a1", "JUMBO", 12500,
                                      datetime.datetime(2026, 8, 1))]), 0)
        total = self.consultar(
            "SELECT COUNT(*) FROM categorias_personalizadas")[0][0]
        self.assertEqual(total, 0)

    def test_deja_constancia_de_cada_respaldo(self):
        self.importar([movimiento("a1", "JUMBO", 12500, datetime.datetime(2026, 8, 1))])
        filas = self.consultar("SELECT nuevos, total FROM respaldos")
        self.assertEqual(filas, [(1, 1)])

    def test_el_csv_se_abre_con_acentos_en_excel(self):
        self.importar([movimiento("a1", "CAFETERÍA", 4350, datetime.datetime(2026, 8, 1))])
        with open(respaldar.CSV_SALIDA, "rb") as f:
            crudo = f.read()
        self.assertTrue(crudo.startswith(b"\xef\xbb\xbf"), "falta la marca para Excel")
        self.assertIn("CAFETERÍA", crudo.decode("utf-8-sig"))

    def test_las_celdas_vacias_no_corren_las_columnas(self):
        """Google omite las celdas vacías del XML en vez de dejarlas en blanco."""
        escribir_xlsx(self.xlsx, {"movimientos": [
            ENCABEZADOS,
            ["a1", como_serial(datetime.datetime(2026, 8, 1)), "gasto", "JUMBO",
             12500, "CLP", "", "debito", "", "", "", "esperando_categoria",
             "correo1", "100", como_serial(datetime.datetime(2026, 8, 1))],
        ]})
        sys.argv = ["respaldar.py", self.xlsx]
        with contextlib.redirect_stdout(io.StringIO()):
            respaldar.main()

        filas = self.consultar(
            "SELECT comercio, monto_clp, categoria, estado FROM movimientos")
        self.assertEqual(filas, [("JUMBO", None, None, "esperando_categoria")])


class LectorTest(unittest.TestCase):
    def test_lee_varias_hojas_por_su_nombre(self):
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = os.path.join(carpeta, "x.xlsx")
            escribir_xlsx(ruta, {
                "movimientos": [["id"], ["a1"]],
                "aprendizaje": [["comercio"], ["JUMBO"]],
            })
            hojas = leer_hojas(ruta)
            self.assertEqual(sorted(hojas), ["aprendizaje", "movimientos"])
            self.assertEqual(hojas["aprendizaje"][1][0], "JUMBO")


if __name__ == "__main__":
    unittest.main(verbosity=2)
