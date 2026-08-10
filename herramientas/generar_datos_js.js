/**
 * Convierte los JSON de datos/ en un archivo JavaScript para Apps Script.
 *
 * clasp solo sube archivos .js, .html y appsscript.json, asi que un .json de
 * datos nunca llegaria al proyecto. En vez de duplicar las categorias a mano en
 * codigo (que se desincronizaria al primer cambio), el JSON sigue siendo la
 * unica fuente de verdad y de ahi se genera el .js.
 *
 * Uso:  node herramientas/generar_datos_js.js
 */

const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const leer = (n) => JSON.parse(fs.readFileSync(path.join(raiz, 'datos', n), 'utf8'));

const gasto = leer('categorias_gasto.json');
const ingreso = leer('categorias_ingreso.json').map(({ _comentario, ...c }) => c);
const semilla = leer('comercios_semilla.json').reglas;

const salida = `/**
 * ARCHIVO GENERADO. No editar a mano.
 * Se produce con: node herramientas/generar_datos_js.js
 * La fuente de verdad son los JSON de datos/.
 */

var CATEGORIAS_GASTO = ${JSON.stringify(gasto, null, 2)};

var CATEGORIAS_INGRESO = ${JSON.stringify(ingreso, null, 2)};

var COMERCIOS_SEMILLA = ${JSON.stringify(semilla, null, 2)};
`;

const destino = path.join(raiz, 'apps_script', 'datos.gen.js');
fs.writeFileSync(destino, salida);
console.log(
  `datos.gen.js: ${gasto.length} categorias de gasto, ` +
  `${ingreso.length} de ingreso, ${semilla.length} comercios`
);
