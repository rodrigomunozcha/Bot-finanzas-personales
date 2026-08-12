/**
 * Lectura de los correos de Banco de Chile.
 *
 * Este archivo es logica pura: no toca Gmail, ni Telegram, ni hojas de calculo.
 * Por eso corre igual bajo Node (para las pruebas) y bajo Apps Script (en
 * produccion). No agregar aqui llamadas a servicios de Google.
 *
 * Cada lector devuelve un objeto normalizado, o null si el correo no le
 * corresponde. Un correo que ningun lector reconoce no se descarta: queda en la
 * bandeja de no entendidos para agregar su formato despues.
 */

/**
 * Nombres fijos para los movimientos que no tienen comercio de verdad.
 *
 * Una transferencia no tiene comercio: tiene una persona al otro lado, y esa
 * persona no entra a este sistema ni por su nombre ni por el texto que se
 * escribio junto al pago. Entonces todas las transferencias comparten nombre.
 *
 * Eso trae un problema que hay que resolver aparte: con un nombre repetido, el
 * aprendizaje por comercio clasificaria sola la tercera transferencia y todas
 * las siguientes con la categoria de las anteriores, sin preguntar y sin que se
 * note. Por eso estos dos nombres estan en COMERCIOS_GENERICOS de
 * clasificador.js, que los deja fuera del aprendizaje: preguntan siempre.
 */
var COMERCIO_TRANSFERENCIA_ENVIADA = 'Transferencia enviada';
var COMERCIO_TRANSFERENCIA_RECIBIDA = 'Transferencia recibida';

/** Los cuatro formatos que sabemos leer hoy, identificados por el asunto. */
var ASUNTOS = {
  COMPRA_DEBITO: /cargo en cuenta/i,
  COMPRA_CREDITO: /compra con tarjeta de cr[eé]dito/i,
  TRANSFERENCIA_RECIBIDA: /aviso de transferencia de fondos/i,
  TRANSFERENCIA_ENVIADA: /comprobante de transferencia a terceros/i,
};

/**
 * Deja el cuerpo del correo en una sola linea de texto plano.
 * Gmail entrega los correos con tablas HTML aplanadas, saltos de linea
 * impredecibles y espacios duros. Todo eso estorba a las expresiones regulares.
 */
function normalizarTexto(cuerpo) {
  return String(cuerpo || '')
    .replace(/ /g, ' ')      // espacio duro de HTML
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Convierte el monto escrito a numero.
 *
 * En Chile el punto separa miles y la coma separa decimales: $12.500 son once
 * mil seiscientos ochenta, no once con seis. El peso ademas no usa decimales en
 * la practica, asi que para CLP todo punto es separador de miles sin excepcion.
 *
 * Para dolares y euros hay ambiguedad real, porque "49.00" puede venir en
 * formato ingles. Ahi aplicamos la regla de que un punto unico seguido de
 * exactamente dos digitos es decimal.
 */
function normalizarMonto(texto, moneda) {
  var t = String(texto).trim().replace(/\s/g, '');

  if (t.indexOf(',') >= 0) {
    // Hay coma: es el separador decimal, los puntos son miles.
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (moneda !== 'CLP' && /^\d+\.\d{2}$/.test(t)) {
    // Formato ingles en moneda extranjera: el punto es decimal.
    // (se deja tal cual)
  } else {
    t = t.replace(/\./g, '');
  }

  var n = parseFloat(t);
  return isNaN(n) ? null : n;
}

/** Detecta la moneda a partir del simbolo que precede al monto. */
function detectarMoneda(simbolo) {
  var s = String(simbolo || '').toUpperCase();
  if (s.indexOf('US') >= 0 || s.indexOf('USD') >= 0) return 'USD';
  if (s.indexOf('EUR') >= 0 || s.indexOf('€') >= 0) return 'EUR';
  return 'CLP';
}

/** "01/08/2026" + "13:20" -> "2026-08-01T13:20" (formato ordenable). */
function normalizarFecha(fecha, hora) {
  var p = String(fecha).split('/');
  if (p.length !== 3) return null;
  var iso = p[2] + '-' + p[1] + '-' + p[0];
  return hora ? iso + 'T' + hora : iso;
}

/**
 * El comprobante de transferencia enviada no trae la fecha en numeros como los
 * demas correos, sino escrita: "martes 11 de agosto de 2026 17:08". Por eso
 * necesita su propio conversor en vez de reusar normalizarFecha.
 *
 * Se aceptan "septiembre" y "setiembre" porque las dos son correctas en
 * espanol y no hay forma de saber cual usa el banco sin ver un correo de ese
 * mes. Costaba una linea, y un mes al ano sin fecha se notaria tarde.
 */
var MESES = {
  enero: '01', febrero: '02', marzo: '03', abril: '04',
  mayo: '05', junio: '06', julio: '07', agosto: '08',
  septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
};

function dosDigitos(numero) {
  var s = String(numero);
  return s.length < 2 ? '0' + s : s;
}

function normalizarFechaLarga(dia, mes, anio, hora) {
  var numeroMes = MESES[String(mes).toLowerCase()];
  if (!numeroMes) return null;

  var iso = anio + '-' + numeroMes + '-' + dosDigitos(dia);
  if (!hora) return iso;

  var partes = String(hora).split(':');
  return iso + 'T' + dosDigitos(partes[0]) + ':' + partes[1];
}

/**
 * Compras con tarjeta, tanto de debito ("Cargo en cuenta") como de credito
 * ("Compra con Tarjeta de Credito"). El cuerpo tiene la misma redaccion en
 * ambos casos, lo que cambia es el asunto y el medio que aparece tras
 * "con cargo a".
 *
 * Ejemplo real:
 *   "Te informamos que se ha realizado una compra por $12.500 con cargo a
 *    Cuenta ****1234 en JUMBO CENTRAL el 01/08/2026 13:20."
 */
var RE_COMPRA = new RegExp(
  'compra por\\s*(US\\$|USD|EUR|€|\\$)\\s*([\\d.,]+)' +
  '\\s*con cargo a\\s+(.+?)\\s*\\*{2,}\\s*(\\d{4})' +
  '\\s+en\\s+(.+?)' +
  '\\s+el\\s+(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(\\d{2}:\\d{2})',
  'i'
);

function leerCompra(asunto, cuerpo) {
  var esDebito = ASUNTOS.COMPRA_DEBITO.test(asunto);
  var esCredito = ASUNTOS.COMPRA_CREDITO.test(asunto);
  if (!esDebito && !esCredito) return null;

  var m = RE_COMPRA.exec(normalizarTexto(cuerpo));
  if (!m) return null;

  var moneda = detectarMoneda(m[1]);
  var monto = normalizarMonto(m[2], moneda);
  if (monto === null) return null;

  return {
    tipo: 'gasto',
    monto: monto,
    moneda: moneda,
    // En moneda extranjera el peso real lo define el banco recien cuando se
    // paga la tarjeta, asi que no se estima: se pregunta esa misma noche.
    montoClp: moneda === 'CLP' ? monto : null,
    pendienteConversion: moneda !== 'CLP',
    medioPago: esCredito ? 'credito' : 'debito',
    // Los cuatro digitos de la cuenta se leen (el grupo 4 hace falta para que
    // el comercio caiga en el grupo 5) pero no se devuelven. Nadie los usaba, y
    // un dato de la cuenta que nadie necesita no tiene por que salir de aca.
    comercio: limpiarComercio(m[5]),
    fechaHora: normalizarFecha(m[6], m[7]),
  };
}

/**
 * Transferencias que te llegan.
 *
 * De todo el correo se toman dos cosas: el monto y la fecha.
 *
 * Antes se guardaba tambien el primer nombre de quien enviaba y la glosa que
 * habia escrito. Los dos se sacaron. El nombre es de una persona que no eligio
 * estar en este sistema, y la glosa es texto libre que esa persona escribio: ahi
 * cabe una direccion, un telefono o el nombre de un tercero, y no hay forma de
 * saber que trae antes de guardarla.
 *
 * Lo que se pierde es real: ya no dice de quien vino la plata ni para que era.
 * Se cambia a proposito por la garantia de que ningun dato de nadie entra aca.
 * Si quieres dejar constancia, la nota la escribes tu desde el boton.
 */

// El banco manda el mismo correo con la tabla aplanada de dos formas distintas,
// segun como se aplaste el HTML:
//   A) "Fecha Asunto 01/08/2026 Maleta y taxi"   (encabezados y luego valores)
//   B) "Fecha 01/08/2026 Asunto Maleta y taxi"   (cada valor tras su etiqueta)
// Hay que reconocer las dos o la mitad de las transferencias se pierde.
var RE_DETALLE_ETIQUETADO = /Fecha\s+(\d{2}\/\d{2}\/\d{4})\s+Asunto\s+(.+?)\s+(?:Datos de destinatario|Nombre y Apellido|Monto)/i;
var RE_DETALLE_EN_TABLA = /Fecha\s+Asunto\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(?:Datos de destinatario|Nombre y Apellido|Monto)/i;

// El monto ya no se ancla al final del texto: despues puede venir el numero de
// comprobante y la fecha larga. Anclarlo hacia que el lector fallara entero.
var RE_TRANSFERENCIA_MONTO = /\bMonto\s*(US\$|USD|EUR|€|\$)\s*([\d.,]+)/i;

function leerTransferenciaRecibida(asunto, cuerpo) {
  if (!ASUNTOS.TRANSFERENCIA_RECIBIDA.test(asunto)) return null;

  var texto = normalizarTexto(cuerpo);
  var mMonto = RE_TRANSFERENCIA_MONTO.exec(texto);
  if (!mMonto) return null;

  var moneda = detectarMoneda(mMonto[1]);
  var monto = normalizarMonto(mMonto[2], moneda);
  if (monto === null) return null;

  // Los patrones de detalle siguen existiendo solo para sacar la fecha. El
  // segundo grupo, que era la glosa, se ignora a proposito.
  var mDetalle = RE_DETALLE_ETIQUETADO.exec(texto) || RE_DETALLE_EN_TABLA.exec(texto);

  return {
    // Se registra como "entrada" y no como "ingreso" a proposito: todavia no
    // sabemos si es plata ganada o una devolucion de algo que adelantaste. Eso
    // lo decide el usuario en el primer boton.
    tipo: 'entrada',
    monto: monto,
    moneda: moneda,
    montoClp: moneda === 'CLP' ? monto : null,
    pendienteConversion: moneda !== 'CLP',
    medioPago: 'transferencia',
    comercio: COMERCIO_TRANSFERENCIA_RECIBIDA,
    fechaHora: mDetalle ? normalizarFecha(mDetalle[1], null) : null,
  };
}

/**
 * Transferencias que tu envias a otra persona.
 *
 * De todo el correo se toman dos cosas: el monto y la fecha. Nada mas.
 *
 * El correo trae el bloque completo del destinatario (nombre y apellido, RUT,
 * tipo y numero de cuenta, banco y correo), tu propia cuenta de origen, y el
 * campo Mensaje. Nada de eso se lee.
 *
 * El campo Mensaje merece explicacion, porque una version anterior de este
 * lector si lo tomaba y lo usaba como nombre de comercio. Fue un error y hay
 * que dejarlo dicho para que nadie lo vuelva a intentar. Ese mensaje es el
 * texto que tu escribes para que la OTRA persona sepa quien le pago, asi que
 * ahi cabe cualquier cosa: una direccion ("Depto 000 calle tal"), el nombre del
 * destinatario, un numero de telefono, el detalle de un tratamiento medico. Un
 * caso real de este proyecto fue una transferencia cuyo mensaje era la
 * dirección de una vivienda. Como comercio, esa direccion habria terminado en
 * la hoja de movimientos, en la tabla de aprendizaje, en el mensaje de Telegram
 * y en el respaldo local.
 *
 * No hay validacion que arregle eso. Es texto libre destinado a un tercero, y
 * lo unico seguro con texto libre de terceros es no leerlo.
 */

// "Fecha y Hora: martes 11 de agosto de 2026 17:08". El dia de la semana se
// salta sin capturarlo, y la hora es opcional por si algun correo no la trae.
var RE_FECHA_ESCRITA = new RegExp(
  'Fecha y Hora:?\\s*(?:[a-záéíóúñ]+\\s+)?' +
  '(\\d{1,2})\\s+de\\s+([a-záéíóúñ]+)\\s+de\\s+(\\d{4})' +
  '(?:\\s+(\\d{1,2}:\\d{2}))?',
  'i'
);

function leerTransferenciaEnviada(asunto, cuerpo) {
  if (!ASUNTOS.TRANSFERENCIA_ENVIADA.test(asunto)) return null;

  var texto = normalizarTexto(cuerpo);

  // Es el mismo patron que la transferencia recibida: la palabra "Monto"
  // seguida del simbolo y la cifra.
  var mMonto = RE_TRANSFERENCIA_MONTO.exec(texto);
  if (!mMonto) return null;

  var moneda = detectarMoneda(mMonto[1]);
  var monto = normalizarMonto(mMonto[2], moneda);
  if (monto === null) return null;

  var mFecha = RE_FECHA_ESCRITA.exec(texto);

  return {
    tipo: 'gasto',
    monto: monto,
    moneda: moneda,
    montoClp: moneda === 'CLP' ? monto : null,
    pendienteConversion: moneda !== 'CLP',
    medioPago: 'transferencia',
    comercio: COMERCIO_TRANSFERENCIA_ENVIADA,
    fechaHora: mFecha
      ? normalizarFechaLarga(mFecha[1], mFecha[2], mFecha[3], mFecha[4])
      : null,
  };
}

/** Quita espacios sobrantes y sufijos de sucursal que ensucian el aprendizaje. */
function limpiarComercio(bruto) {
  return String(bruto).trim().replace(/\s{2,}/g, ' ');
}

/**
 * Lo unico que un lector puede devolver. Cualquier otro campo se descarta.
 *
 * Esta lista es blanca y no negra, y esa es toda la idea. Antes habia una
 * funcion que tachaba lo que parecia sensible (RUT, correo, numero de cuenta)
 * con expresiones regulares. Se borro. Una lista negra solo bloquea lo que
 * alguien penso en escribir: los nombres de personas y las direcciones no
 * tienen forma reconocible, asi que pasaban enteros. Verificado corriendola:
 * "Nombre Apellido" salia intacto del censor.
 *
 * Con lista blanca, un lector nuevo que lea un dato de mas no lo filtra: lo
 * pierde. Para que un campo nuevo salga de este archivo hay que agregarlo aca a
 * mano, y ese es justo el momento en que alguien tiene que pensarlo.
 */
var CAMPOS_PERMITIDOS = [
  'tipo', 'monto', 'moneda', 'montoClp', 'pendienteConversion',
  'medioPago', 'comercio', 'fechaHora',
];

/**
 * El pago de la tarjeta tiene su propia lista porque devuelve otros campos
 * (dos montos, dos tasas). Vive aca, junto a la otra, para que quede un solo
 * lugar donde mirar que puede salir de un correo del banco.
 */
var CAMPOS_PERMITIDOS_PAGO = [
  'tipo', 'montoUsd', 'montoClp', 'tasaMostrada', 'tasaEfectiva',
  'saldaTodo', 'fechaHora',
];

function colar(lectura, permitidos) {
  if (!lectura) return null;

  var limpia = {};
  for (var i = 0; i < permitidos.length; i++) {
    var campo = permitidos[i];
    if (Object.prototype.hasOwnProperty.call(lectura, campo)) {
      limpia[campo] = lectura[campo];
    }
  }
  return limpia;
}

function soloCamposPermitidos(lectura) {
  return colar(lectura, CAMPOS_PERMITIDOS);
}

function soloCamposDelPago(lectura) {
  return colar(lectura, CAMPOS_PERMITIDOS_PAGO);
}

/**
 * Punto de entrada: prueba cada lector hasta que uno reconozca el correo.
 *
 * Todo pasa por soloCamposPermitidos antes de salir, y el colador va aca y no
 * dentro de cada lector para que un lector nuevo quede filtrado sin que su
 * autor tenga que acordarse.
 *
 * El pago de tarjeta no pasa por aca (procesarMensaje lo prueba antes, porque
 * hace algo distinto con el resultado), asi que tiene su propio colador dentro
 * de leerPagoTarjeta. Entre los dos no queda ningun camino sin guardia.
 */
function leerCorreo(asunto, cuerpo) {
  return soloCamposPermitidos(
    leerCompra(asunto, cuerpo) ||
    leerTransferenciaRecibida(asunto, cuerpo) ||
    leerTransferenciaEnviada(asunto, cuerpo) ||
    null
  );
}

// Apps Script no tiene modulos: alli estas funciones ya son globales y esta
// linea se ignora sola porque "module" no existe.
if (typeof module !== 'undefined') {
  module.exports = {
    leerCorreo, leerCompra, leerTransferenciaRecibida, leerTransferenciaEnviada,
    soloCamposPermitidos, soloCamposDelPago,
    CAMPOS_PERMITIDOS, CAMPOS_PERMITIDOS_PAGO,
    normalizarMonto, normalizarTexto, normalizarFecha, normalizarFechaLarga,
    detectarMoneda, MESES,
    COMERCIO_TRANSFERENCIA_ENVIADA, COMERCIO_TRANSFERENCIA_RECIBIDA,
  };
}
