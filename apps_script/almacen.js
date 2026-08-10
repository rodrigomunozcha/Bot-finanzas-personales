/**
 * Almacen en Google Sheets.
 *
 * Tres hojas:
 *   movimientos    un registro por gasto, ingreso o movimiento interno
 *   aprendizaje    que categoria corresponde a cada comercio, y cuantas veces
 *                  se ha confirmado
 *   no_entendidos  correos que ningun lector reconocio, para agregar su formato
 *                  despues sin haber perdido el dato
 *
 * Esta es la copia viva. El archivo historico y los analisis viven en el Mac,
 * que baja esta hoja a SQLite cuando esta encendido.
 */

var COLUMNAS = [
  'id', 'fechaHora', 'tipo', 'comercio', 'monto', 'moneda', 'montoClp',
  'medioPago', 'categoria', 'subcategoria', 'nota', 'estado', 'correoId',
  'mensajeId', 'creado',
];

var HOJA_MOVIMIENTOS = 'movimientos';
var HOJA_APRENDIZAJE = 'aprendizaje';
var HOJA_NO_ENTENDIDOS = 'no_entendidos';

/**
 * Estados posibles de un movimiento. Los que empiezan con "esperando" son
 * conversaciones abiertas: hay un mensaje en Telegram esperando respuesta.
 */
var ESTADOS = {
  ESPERANDO_CATEGORIA: 'esperando_categoria',
  ESPERANDO_SUBCATEGORIA: 'esperando_subcategoria',
  ESPERANDO_TIPO_ENTRADA: 'esperando_tipo_entrada',
  CERRADO: 'cerrado',
  REEMBOLSO: 'reembolso',
  INTERNO: 'interno',
};

/**
 * openById y getSheetByName son de las llamadas mas caras de Apps Script, cerca
 * de un segundo cada una. Una sola pulsacion de boton las repetia cinco o seis
 * veces, y eso era casi toda la demora que se sentia en el telefono.
 *
 * Cada ejecucion de Apps Script arranca con el ambito global limpio, asi que
 * esta memoria dura lo que dura la pulsacion y nunca queda desactualizada.
 */
var _libro = null;
var _hojas = {};

function abrirLibro() {
  if (_libro) return _libro;
  var id = PropertiesService.getScriptProperties().getProperty('HOJA_ID');
  if (!id) throw new Error('Falta HOJA_ID. Corre instalar() primero.');
  _libro = SpreadsheetApp.openById(id);
  return _libro;
}

function hoja(nombre) {
  if (!_hojas[nombre]) _hojas[nombre] = abrirLibro().getSheetByName(nombre);
  return _hojas[nombre];
}

/**
 * Identificador corto y unico para el movimiento.
 * Tiene que caber en el callback_data de los botones junto con el resto de la
 * accion, por eso no se usa un UUID completo.
 */
function nuevoId() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

/**
 * Copia del movimiento en la cache de Apps Script.
 *
 * Abrir la planilla cuesta cerca de un segundo, y una pulsacion de boton solo
 * necesita saber que gasto es. Guardando una copia al crearlo, responder deja
 * de depender de Sheets: la cache se lee en milisegundos.
 *
 * Es una ayuda, nunca un requisito. Si la cache falla o expira, todo sigue
 * funcionando leyendo de la hoja como antes.
 */
var VIDA_CACHE_SEGUNDOS = 21600;   // 6 horas

/**
 * Las fechas se guardan como texto en hora local antes de cachear.
 *
 * JSON.stringify convierte un Date a texto UTC, y al leerlo de vuelta la hora
 * queda corrida por la diferencia horaria. Guardando el texto local desde el
 * principio, la cache dice exactamente lo mismo que la planilla.
 */
function _sinFechas(mov) {
  var plano = {};
  Object.keys(mov).forEach(function (clave) {
    var v = mov[clave];
    plano[clave] = (v && typeof v.getMonth === 'function' && !isNaN(v.getTime()))
      ? v.getFullYear() + '-' + _dd(v.getMonth() + 1) + '-' + _dd(v.getDate()) +
        'T' + _dd(v.getHours()) + ':' + _dd(v.getMinutes())
      : v;
  });
  return plano;
}

function _dd(n) {
  return (n < 10 ? '0' : '') + n;
}

function _cachearMovimiento(mov) {
  try {
    CacheService.getScriptCache()
      .put('mov_' + mov.id, JSON.stringify(_sinFechas(mov)), VIDA_CACHE_SEGUNDOS);
  } catch (error) {
    console.error('No se pudo cachear el movimiento: ' + error);
  }
}

function _movimientoCacheado(id) {
  try {
    var texto = CacheService.getScriptCache().get('mov_' + id);
    if (!texto) return null;
    var mov = JSON.parse(texto);
    return mov && mov._fila ? mov : null;
  } catch (error) {
    return null;
  }
}

function registrarMovimiento(mov) {
  var h = hoja(HOJA_MOVIMIENTOS);
  var id = mov.id || nuevoId();
  var fila = COLUMNAS.map(function (col) {
    if (col === 'id') return id;
    if (col === 'creado') return new Date();
    return mov[col] === undefined || mov[col] === null ? '' : mov[col];
  });
  h.appendRow(fila);
  _olvidarIndice(h);

  var copia = { id: id, _fila: h.getLastRow() };
  COLUMNAS.forEach(function (col, i) {
    if (col !== 'id') copia[col] = fila[i];
  });
  _cachearMovimiento(copia);

  return id;
}

/**
 * Escribe de vuelta un movimiento que ya se leyo, sin volver a buscarlo.
 * obtenerMovimiento deja el numero de fila en _fila, asi que guardar cuesta una
 * sola escritura y ninguna lectura extra.
 */
function guardarMovimiento(mov) {
  if (!mov._fila) throw new Error('guardarMovimiento necesita un movimiento leído de la hoja.');
  var valores = COLUMNAS.map(function (col) {
    return mov[col] === undefined || mov[col] === null ? '' : mov[col];
  });
  hoja(HOJA_MOVIMIENTOS).getRange(mov._fila, 1, 1, COLUMNAS.length).setValues([valores]);
  _cachearMovimiento(mov);
}

/**
 * Indice de la primera columna a numero de fila, calculado una sola vez por
 * ejecucion. Antes cada busqueda releia la columna completa, y una pulsacion de
 * boton hacia tres busquedas.
 */
var _indices = {};

function _indice(h) {
  var nombre = h.getName();
  if (_indices[nombre]) return _indices[nombre];

  var mapa = {};
  // Con la hoja recien creada getLastRow() es 1 y pedir cero filas lanza error.
  if (h.getLastRow() >= 2) {
    var claves = h.getRange(2, 1, h.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < claves.length; i++) {
      if (claves[i][0] !== '') mapa[claves[i][0]] = i + 2;
    }
  }
  _indices[nombre] = mapa;
  return mapa;
}

function _indiceFila(h, clave) {
  return _indice(h)[clave] || null;
}

/** Tras agregar o borrar filas el indice queda corrido y hay que rehacerlo. */
function _olvidarIndice(h) {
  delete _indices[h.getName()];
}

function obtenerMovimiento(id) {
  // La cache primero: evita abrir la planilla, que es lo que hace lenta la
  // respuesta a un boton. Si no esta, se lee de la hoja y se deja cacheado.
  var cacheado = _movimientoCacheado(id);
  if (cacheado) return cacheado;

  var h = hoja(HOJA_MOVIMIENTOS);
  var fila = _indiceFila(h, id);
  if (!fila) return null;
  var valores = h.getRange(fila, 1, 1, COLUMNAS.length).getValues()[0];
  var mov = { _fila: fila };
  COLUMNAS.forEach(function (col, i) { mov[col] = valores[i]; });
  _cachearMovimiento(mov);
  return mov;
}


/**
 * Movimientos que quedaron sin responder.
 *
 * Un gasto cuyo estado sigue en "esperando" es uno que nunca se clasifico: el
 * mensaje se perdio, llego mientras el freno estaba puesto, o simplemente no se
 * contesto. Sin una forma de listarlos se acumulan en silencio y los informes
 * quedan incompletos sin que nadie se entere.
 */
function movimientosSinClasificar() {
  var h = hoja(HOJA_MOVIMIENTOS);
  if (h.getLastRow() < 2) return [];

  var filas = h.getRange(2, 1, h.getLastRow() - 1, COLUMNAS.length).getValues();
  var iEstado = COLUMNAS.indexOf('estado');

  return filas.filter(function (f) {
    return String(f[iEstado]).indexOf('esperando') === 0;
  }).map(function (f) {
    var mov = {};
    COLUMNAS.forEach(function (col, i) { mov[col] = f[i]; });
    return mov;
  });
}

function contarSinClasificar() {
  return movimientosSinClasificar().length;
}

/** Todos los movimientos de la hoja, en una sola lectura. */
function todosLosMovimientos() {
  var h = hoja(HOJA_MOVIMIENTOS);
  if (h.getLastRow() < 2) return [];

  return h.getRange(2, 1, h.getLastRow() - 1, COLUMNAS.length).getValues()
    .map(function (f) {
      var mov = {};
      COLUMNAS.forEach(function (col, i) { mov[col] = f[i]; });
      return mov;
    });
}

/** Compras en moneda extranjera que todavia no tienen su valor en pesos. */
function comprasPendientesConversion() {
  var h = hoja(HOJA_MOVIMIENTOS);
  if (h.getLastRow() < 2) return [];
  var filas = h.getRange(2, 1, h.getLastRow() - 1, COLUMNAS.length).getValues();
  var iMoneda = COLUMNAS.indexOf('moneda');
  var iClp = COLUMNAS.indexOf('montoClp');

  return filas.filter(function (f) {
    return f[iMoneda] && f[iMoneda] !== 'CLP' && !f[iClp];
  }).map(function (f) {
    var mov = {};
    COLUMNAS.forEach(function (col, i) { mov[col] = f[i]; });
    return mov;
  });
}

// --- Aprendizaje -----------------------------------------------------------

/**
 * Devuelve el aprendizaje como mapa comercio -> clasificacion.
 * De paso arma el indice de filas con la misma lectura, para que guardar
 * despues no tenga que releer la hoja.
 */
function _olvidarCacheAprendizaje() {
  try {
    CacheService.getScriptCache().remove('aprendizaje');
  } catch (error) {
    console.error('No se pudo limpiar la cache de aprendizaje: ' + error);
  }
}

function cargarAprendizaje() {
  // La cache se consulta antes de llamar a hoja(), porque abrir la planilla es
  // justamente el costo que se quiere evitar. El indice de filas viaja junto
  // con el mapa: se guarda bajo el nombre de la hoja, que es la misma clave que
  // usa _indice(), asi que guardar despues tampoco necesita releer.
  try {
    var texto = CacheService.getScriptCache().get('aprendizaje');
    if (texto) {
      var guardado = JSON.parse(texto);
      _indices[HOJA_APRENDIZAJE] = guardado.indice;
      return guardado.mapa;
    }
  } catch (error) {
    console.error('Cache de aprendizaje ilegible: ' + error);
  }

  var h = hoja(HOJA_APRENDIZAJE);
  var mapa = {};
  var indice = {};
  _indices[h.getName()] = indice;

  if (h.getLastRow() < 2) {
    _cachearAprendizaje(mapa, indice);
    return mapa;
  }

  h.getRange(2, 1, h.getLastRow() - 1, 4).getValues().forEach(function (f, i) {
    if (!f[0]) return;
    indice[f[0]] = i + 2;
    mapa[f[0]] = {
      categoria: f[1],
      subcategoria: f[2] || null,
      confirmaciones: Number(f[3]) || 0,
    };
  });
  _cachearAprendizaje(mapa, indice);
  return mapa;
}

function _cachearAprendizaje(mapa, indice) {
  try {
    CacheService.getScriptCache().put(
      'aprendizaje', JSON.stringify({ mapa: mapa, indice: indice }), VIDA_CACHE_SEGUNDOS
    );
  } catch (error) {
    console.error('No se pudo cachear el aprendizaje: ' + error);
  }
}

function guardarAprendizaje(registro) {
  _olvidarCacheAprendizaje();
  var h = hoja(HOJA_APRENDIZAJE);
  var fila = _indiceFila(h, registro.comercio);
  var valores = [
    registro.comercio, registro.categoria, registro.subcategoria || '',
    registro.confirmaciones, new Date(),
  ];
  if (fila) {
    h.getRange(fila, 1, 1, valores.length).setValues([valores]);
  } else {
    h.appendRow(valores);
    _olvidarIndice(h);
  }
}

/**
 * Olvida lo aprendido de un comercio, para que vuelva a preguntar desde cero.
 * Devuelve true si habia algo que olvidar.
 */
function borrarAprendizaje(comercio) {
  _olvidarCacheAprendizaje();
  var h = hoja(HOJA_APRENDIZAJE);
  var fila = _indiceFila(h, comercio);
  if (!fila) return false;
  h.deleteRow(fila);
  _olvidarIndice(h);
  return true;
}

// --- Correos no entendidos -------------------------------------------------

function registrarNoEntendido(asunto, correoId, extracto) {
  hoja(HOJA_NO_ENTENDIDOS).appendRow([new Date(), asunto, correoId, extracto]);
}

/**
 * Segunda barrera contra duplicados. La primera son las etiquetas de Gmail: el
 * script solo mira los correos sin procesar. Pero si algo falla entre mandar el
 * mensaje a Telegram y reetiquetar el correo, la proxima pasada lo veria otra
 * vez. Revisar los ultimos registros lo evita.
 */
function correoYaRegistrado(correoId) {
  var h = hoja(HOJA_MOVIMIENTOS);
  var ultima = h.getLastRow();
  if (ultima < 2) return false;

  var desde = Math.max(2, ultima - 200);
  var columna = COLUMNAS.indexOf('correoId') + 1;
  var ids = h.getRange(desde, columna, ultima - desde + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === correoId) return true;
  }
  return false;
}
