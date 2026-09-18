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
  'telegram.js', 'almacen.js', 'mensajes.js', 'entradas.js', 'conversacion.js', 'graficos.js', 'informes.js', 'respaldo.js', 'principal.js', 'diagnostico.js',
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
    categorias_personalizadas: hojaFalsa('categorias_personalizadas',
      ['tipo', 'categoria', 'subcategoria', 'creado'], contador),
  };

  const almacenPropiedades = Object.assign(
    { TELEGRAM_TOKEN: 'token-falso', TELEGRAM_CHAT_ID: '999', HOJA_ID: 'libro-falso' },
    propiedades
  );

  let siguienteMensaje = 100;
  const porEntregar = [];   // avisos que Telegram tiene para entregar
  const graficos = [];      // graficos que el codigo pidio dibujar
  const activadores = [];   // activadores programados, sin ejecutar nada

  /**
   * Doble de Google Drive y de la exportacion de Sheets.
   *
   * Cubre solo lo que usa respaldo.js: exportar la planilla como xlsx, buscar
   * y crear una carpeta, y subir un archivo. Guarda cada pedido para que las
   * pruebas lo revisen, y deja simular las dos fallas que importan: una
   * exportacion que devuelve una pagina en vez de un Excel, y una subida
   * rechazada.
   */
  const drive = {
    token: 'token-oauth-falso-que-no-debe-aparecer',
    carpetas: [],
    archivos: [],
    pedidos: [],
    respuestaExportacion: { codigo: 200, bytes: [0x50, 0x4b, 0x03, 0x04, 1, 2, 3] },
    fallarSubidaCon: null,
    cuerpoDeError: 'error de mentira',
  };
  const respuestaGoogle = (codigo, cuerpo, bytes) => ({
    getResponseCode: () => codigo,
    getContentText: () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
    getBlob: () => ({ getBytes: () => (bytes || []).slice() }),
  });
  function googleFalso(url, opciones) {
    const metodo = String(opciones.method || 'get').toLowerCase();
    drive.pedidos.push({ url, metodo });

    const autorizado = opciones.headers &&
      opciones.headers.Authorization === 'Bearer ' + drive.token;
    if (!autorizado) return respuestaGoogle(401, drive.cuerpoDeError);

    if (url.includes('/export?format=xlsx')) {
      const r = drive.respuestaExportacion;
      return respuestaGoogle(r.codigo, '', r.bytes);
    }
    if (url.includes('/upload/drive/v3/files')) {
      if (drive.fallarSubidaCon) return respuestaGoogle(drive.fallarSubidaCon, drive.cuerpoDeError);
      const texto = Buffer.from(opciones.payload).toString('latin1');
      const meta = JSON.parse(/\{[^\r\n]*\}/.exec(texto)[0]);
      const archivo = {
        id: 'archivo' + (drive.archivos.length + 1),
        nombre: meta.name,
        carpeta: meta.parents[0],
        // Drive le pone la fecha de creación. Una prueba que quiera un respaldo
        // viejo la retrocede a mano.
        creadoEn: Date.now(),
      };
      drive.archivos.push(archivo);
      return respuestaGoogle(200, { id: archivo.id, name: archivo.nombre });
    }
    if (url.includes('/drive/v3/files') && metodo === 'get') {
      const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(url) || [])[1] || '');
      const nombre = (/name = '([^']*)'/.exec(q) || [])[1];
      const padre = (/'([^']*)' in parents/.exec(q) || [])[1];

      // Búsqueda de carpeta por nombre, opcionalmente dentro de otra.
      if (nombre) {
        return respuestaGoogle(200, {
          files: drive.carpetas
            .filter((c) => c.name === nombre && (!padre || c.padre === padre))
            .map((c) => ({ id: c.id })),
        });
      }

      // Búsqueda de respaldos viejos dentro de una carpeta.
      const antesDe = (/createdTime < '([^']*)'/.exec(q) || [])[1];
      const corte = antesDe ? Date.parse(antesDe) : Infinity;
      return respuestaGoogle(200, {
        files: drive.archivos
          .filter((a) => a.carpeta === padre && a.creadoEn < corte)
          .map((a) => ({ id: a.id })),
      });
    }
    if (url.includes('/drive/v3/files') && metodo === 'post') {
      const meta = JSON.parse(opciones.payload);
      const carpeta = {
        id: 'carpeta' + (drive.carpetas.length + 1),
        name: meta.name,
        padre: meta.parents ? meta.parents[0] : null,
      };
      drive.carpetas.push(carpeta);
      return respuestaGoogle(200, { id: carpeta.id });
    }
    // Mover un archivo de carpeta: en Drive es cambiarle el padre.
    if (url.includes('/drive/v3/files/') && metodo === 'patch') {
      const id = (/\/files\/([^?]+)/.exec(url) || [])[1];
      const destino = (/[?&]addParents=([^&]*)/.exec(url) || [])[1];
      const archivo = drive.archivos.filter((a) => a.id === id)[0];
      if (!archivo) return respuestaGoogle(404, 'no existe ese archivo');
      archivo.carpeta = destino;
      return respuestaGoogle(200, { id: id });
    }
    return respuestaGoogle(404, 'ruta no simulada en el doble: ' + url);
  }

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
    encodeURIComponent, decodeURIComponent,

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
    // Doble del servicio de graficos: registra lo que se le pide dibujar y
    // devuelve una imagen de mentira, para poder verificar los datos que van al
    // grafico sin depender de que Google los dibuje.
    Charts: (() => {
      const construido = (tipo) => {
        const c = { _tipo: tipo, _datos: null, _titulo: '' };
        const yo = {
          setDataTable: (t) => { c._datos = t; return yo; },
          setTitle: (t) => { c._titulo = t; return yo; },
          setDimensions: () => yo,
          setLegendPosition: () => yo,
          set3D: () => yo,
          build: () => ({
            getAs: () => { graficos.push(c); return { _imagen: tipo }; },
          }),
        };
        return yo;
      };
      return {
        ColumnType: { STRING: 'string', NUMBER: 'number' },
        Position: { NONE: 'none' },
        newDataTable: () => {
          const filas = [];
          const t = {
            _filas: filas,
            addColumn: () => t,
            addRow: (f) => { filas.push(f); return t; },
            build: () => ({ _filas: filas }),
          };
          return t;
        },
        newPieChart: () => construido('torta'),
        newColumnChart: () => construido('columnas'),
        newBarChart: () => construido('barras'),
      };
    })(),
    Utilities: {
      getUuid: () => 'uuid-falso',
      // Sin espera real: las pruebas no pueden tardar lo que tarda el bot.
      sleep: (ms) => { relojFalso.avanzar(ms); },
      // Apps Script devuelve los bytes como un arreglo de numeros, igual que
      // este doble, y respaldo.js los concatena para armar la subida a Drive.
      newBlob: (texto) => ({ getBytes: () => Array.from(Buffer.from(String(texto), 'utf8')) }),
    },
    /**
     * Activadores programados. Se guardan en una lista y nada corre de verdad.
     *
     * Existe para que revisarSalud() e instalar() se puedan probar: las dos
     * consultan los activadores del proyecto, y sin este doble reventaban con
     * "ScriptApp is not defined" antes de llegar a lo que se queria verificar.
     */
    ScriptApp: {
      getProjectTriggers: () => activadores.slice(),
      deleteTrigger(t) {
        const i = activadores.indexOf(t);
        if (i >= 0) activadores.splice(i, 1);
      },
      newTrigger(funcion) {
        const constructor = {
          timeBased: () => constructor,
          everyMinutes: () => constructor,
          everyDays: () => constructor,
          onWeekDay: () => constructor,
          onMonthDay: () => constructor,
          atHour: () => constructor,
          create() {
            const t = { getHandlerFunction: () => funcion };
            activadores.push(t);
            return t;
          },
        };
        return constructor;
      },
      WeekDay: { SUNDAY: 'SUNDAY' },
      getOAuthToken: () => drive.token,
    },
    UrlFetchApp: {
      fetch(url, opciones = {}) {
        // Lo que va a Google lo atiende el doble de Drive. Todo lo demas es
        // Telegram, que era lo unico que este doble conocia antes del respaldo.
        if (/^https:\/\/(docs\.google\.com|www\.googleapis\.com)\//.test(url)) {
          return googleFalso(url, opciones);
        }
        const metodo = url.split('/').pop();
        const cuerpo = typeof opciones.payload === 'string'
          ? JSON.parse(opciones.payload) : opciones.payload;
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
    /** Graficos que el codigo mando a dibujar, con sus datos. */
    graficos,
    /** El doble de Drive: carpetas, archivos subidos, pedidos, y fallas a simular. */
    drive,
    /** Imagenes enviadas a Telegram, con su pie de foto. */
    fotos: () => enviados.filter((x) => x.metodo === 'sendPhoto'),
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
    categoriasPersonalizadas() {
      const [encabezados, ...filas] = hojas.categorias_personalizadas._filas;
      return filas.map((f) => Object.fromEntries(encabezados.map((c, j) => [c, f[j]])));
    },
  };
}

module.exports = { crearEntorno };
