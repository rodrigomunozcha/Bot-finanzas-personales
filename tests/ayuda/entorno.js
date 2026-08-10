/**
 * Monta los archivos de Apps Script en un contexto aislado, con dobles de los
 * servicios de Google.
 *
 * Los archivos se cargan tal cual, sin require ni module. Dentro de este
 * contexto "module" y "require" no existen, exactamente igual que en Apps
 * Script, asi que los bloques de compatibilidad se saltan solos y lo que se
 * ejercita es el mismo camino que va a correr en produccion.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ORDEN = [
  'datos.gen.js', 'parsers.js', 'tarjeta.js', 'clasificador.js',
  'telegram.js', 'almacen.js', 'mensajes.js', 'entradas.js', 'conversacion.js', 'informes.js', 'principal.js', 'diagnostico.js',
];

/**
 * Google Sheets guarda lo que se le manda, sin convertir.
 *
 * Se creyo lo contrario durante un tiempo y el doble convertia los textos con
 * forma de fecha en objetos Date. Era falso: la evidencia llego de Looker
 * Studio, que reporto la columna fechaHora como texto y no la pudo usar para
 * ningun grafico de tiempo. Un texto con forma de fecha se queda como texto.
 *
 * Por eso el codigo convierte a Date antes de escribir, y este doble tiene que
 * guardar tal cual para que esa conversion se pruebe de verdad.
 */
function comoLoGuardaSheets(valor) {
  return valor;
}

function hojaFalsa(nombre, encabezados, contador) {
  const filas = [encabezados.slice()];
  const asegurar = (n) => { while (filas.length < n) filas.push([]); };
  const contar = (op) => { contador[op] = (contador[op] || 0) + 1; };

  return {
    _filas: filas,
    getName: () => nombre,
    getLastRow: () => filas.length,
    setFrozenRows: () => {},
    appendRow: (f) => { contar('escrituras'); filas.push(f.map(comoLoGuardaSheets)); },
    deleteRow: (n) => { contar('escrituras'); filas.splice(n - 1, 1); },
    getRange(fila, col, nFilas = 1, nCols = 1) {
      return {
        getValues() {
          contar('lecturas');
          const salida = [];
          for (let r = 0; r < nFilas; r++) {
            const origen = filas[fila - 1 + r] || [];
            const trozo = [];
            for (let c = 0; c < nCols; c++) {
              const v = origen[col - 1 + c];
              trozo.push(v === undefined ? '' : v);
            }
            salida.push(trozo);
          }
          return salida;
        },
        setValue(v) {
          contar('escrituras');
          asegurar(fila); filas[fila - 1][col - 1] = comoLoGuardaSheets(v);
        },
        setValues(vals) {
          contar('escrituras');
          vals.forEach((f, r) => {
            asegurar(fila + r);
            f.forEach((v, c) => { filas[fila - 1 + r][col - 1 + c] = comoLoGuardaSheets(v); });
          });
        },
      };
    },
  };
}

function crearEntorno(propiedades = {}) {
  const enviados = [];   // todo lo que se le mando a Telegram
  const contador = {};   // operaciones contra la hoja, para medir el costo real
  const hojas = {
    movimientos: hojaFalsa('movimientos', [
      'id', 'fechaHora', 'tipo', 'comercio', 'monto', 'moneda', 'montoClp',
      'medioPago', 'categoria', 'subcategoria', 'nota', 'estado', 'correoId',
      'mensajeId', 'creado',
    ], contador),
    aprendizaje: hojaFalsa('aprendizaje',
      ['comercio', 'categoria', 'subcategoria', 'confirmaciones', 'actualizado'], contador),
    no_entendidos: hojaFalsa('no_entendidos',
      ['fecha', 'asunto', 'correoId', 'extracto'], contador),
  };

  const almacenPropiedades = Object.assign(
    { TELEGRAM_TOKEN: 'token-falso', TELEGRAM_CHAT_ID: '999', HOJA_ID: 'libro-falso' },
    propiedades
  );

  let siguienteMensaje = 100;
  const porEntregar = [];   // avisos que Telegram tiene para entregar

  // Reloj controlable: las tandas rapidas duran casi un minuto y las pruebas no
  // pueden esperar eso de verdad.
  const relojFalso = {
    desfase: 0,
    avanzar(ms) { this.desfase += ms; },
  };
  const AhoraReal = Date.now;

  const Reloj = function (...args) { return new Date(...args); };
  Reloj.prototype = Date.prototype;
  Reloj.now = () => AhoraReal() + relojFalso.desfase;

  const contexto = vm.createContext({
    Date: new Proxy(Date, { get: (t, p) => (p === 'now' ? Reloj.now : t[p]) }),
    console: { log: () => {}, error: () => {} },
    JSON, Math, Number, String, Object, Array, RegExp, Error, isNaN, parseFloat,

    SpreadsheetApp: {
      openById: () => ({ getSheetByName: (n) => hojas[n] }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in almacenPropiedades ? almacenPropiedades[k] : null),
        getProperties: () => ({ ...almacenPropiedades }),
        setProperty: (k, v) => { almacenPropiedades[k] = v; },
        setProperties: (obj) => { Object.assign(almacenPropiedades, obj); },
        deleteProperty: (k) => { delete almacenPropiedades[k]; },
      }),
    },
    ContentService: {
      createTextOutput: (t) => ({ getContent: () => t }),
    },
    CacheService: (() => {
      const datos = new Map();
      return {
        getScriptCache: () => ({
          get: (k) => (datos.has(k) ? datos.get(k) : null),
          put: (k, v) => { datos.set(k, v); },
          remove: (k) => { datos.delete(k); },
          removeAll: (ks) => { ks.forEach((k) => datos.delete(k)); },
        }),
      };
    })(),
    Utilities: {
      getUuid: () => 'uuid-falso',
      // Sin espera real: las pruebas no pueden tardar lo que tarda el bot.
      sleep: (ms) => { relojFalso.avanzar(ms); },
    },
    UrlFetchApp: {
      fetch(url, opciones) {
        const metodo = url.split('/').pop();
        const cuerpo = JSON.parse(opciones.payload);
        enviados.push({ metodo, cuerpo });

        let resultado = true;
        if (metodo === 'sendMessage') {
          resultado = { message_id: siguienteMensaje++ };
        } else if (metodo === 'getUpdates') {
          // Telegram solo devuelve los avisos con update_id >= offset. El doble
          // lo respeta para que las pruebas verifiquen que el offset avanza.
          const desde = cuerpo.offset || 0;
          resultado = porEntregar.filter((u) => u.update_id >= desde);
        }
        return { getContentText: () => JSON.stringify({ ok: true, result: resultado }) };
      },
    },
  });

  const raiz = path.join(__dirname, '..', '..', 'apps_script');
  for (const archivo of ORDEN) {
    vm.runInContext(fs.readFileSync(path.join(raiz, archivo), 'utf8'), contexto, {
      filename: archivo,
    });
  }

  return {
    contexto,
    enviados,
    hojas,
    contador,
    propiedades: almacenPropiedades,
    /** Deja avisos listos para que revisarTelegram los recoja. */
    encolarAvisos(...avisos) { porEntregar.push(...avisos); },
    /** Adelanta el reloj que ve el codigo, sin esperar de verdad. */
    adelantarReloj(ms) { relojFalso.avanzar(ms); },
    /** El offset guardado, que es lo que le confirma a Telegram la entrega. */
    offset() { return Number(almacenPropiedades.TELEGRAM_OFFSET || 0); },
    /** Cuenta operaciones contra la hoja mientras corre lo que se le pase. */
    medir(accion) {
      const antes = { lecturas: contador.lecturas || 0, escrituras: contador.escrituras || 0 };
      accion();
      return {
        lecturas: (contador.lecturas || 0) - antes.lecturas,
        escrituras: (contador.escrituras || 0) - antes.escrituras,
      };
    },
    /** Ejecuta una expresion dentro del contexto, como si fuera Apps Script. */
    correr: (codigo) => vm.runInContext(codigo, contexto),
    /** Ultimo mensaje enviado a Telegram, con su texto. */
    ultimoTexto: () => {
      const m = enviados.filter((e) => e.metodo === 'sendMessage' || e.metodo === 'editMessageText');
      return m.length ? m[m.length - 1].cuerpo.text : null;
    },
    ultimoTeclado: () => {
      const m = enviados.filter((e) => e.metodo === 'sendMessage' || e.metodo === 'editMessageText');
      const ultimo = m[m.length - 1];
      return ultimo && ultimo.cuerpo.reply_markup
        ? ultimo.cuerpo.reply_markup.inline_keyboard : null;
    },
    /**
     * Aprieta el boton cuyo texto contenga lo indicado.
     *
     * Se busca desde el mensaje mas reciente hacia atras, no solo en el ultimo:
     * en Telegram los botones de un mensaje anterior siguen ahi y el usuario
     * puede apretarlos aunque despues hayan llegado otros mensajes.
     */
    apretar(fragmento) {
      const conBotones = enviados.filter(
        (x) => (x.metodo === 'sendMessage' || x.metodo === 'editMessageText') &&
          x.cuerpo.reply_markup && x.cuerpo.reply_markup.inline_keyboard.length
      );

      for (let i = conBotones.length - 1; i >= 0; i--) {
        for (const fila of conBotones[i].cuerpo.reply_markup.inline_keyboard) {
          for (const boton of fila) {
            if (boton.text.includes(fragmento)) {
              this.contexto.manejarBoton({ id: 'cbq', data: boton.callback_data });
              return boton;
            }
          }
        }
      }
      throw new Error(`No hay ningún botón con "${fragmento}"`);
    },
    /** Fila de movimientos como objeto, por indice (0 = el primero). */
    movimiento(i = 0) {
      const [encabezados, ...filas] = hojas.movimientos._filas;
      const fila = filas[i];
      if (!fila) return null;
      return Object.fromEntries(encabezados.map((c, j) => [c, fila[j]]));
    },
    aprendizaje() {
      const [encabezados, ...filas] = hojas.aprendizaje._filas;
      return filas.map((f) => Object.fromEntries(encabezados.map((c, j) => [c, f[j]])));
    },
  };
}

module.exports = { crearEntorno };
