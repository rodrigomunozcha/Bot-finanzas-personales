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

/** Los tres formatos que sabemos leer hoy, identificados por el asunto. */
var ASUNTOS = {
  COMPRA_DEBITO: /cargo en cuenta/i,
  COMPRA_CREDITO: /compra con tarjeta de cr[eé]dito/i,
  TRANSFERENCIA_RECIBIDA: /aviso de transferencia de fondos/i,
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
    cuenta: m[4],
    comercio: limpiarComercio(m[5]),
    fechaHora: normalizarFecha(m[6], m[7]),
  };
}

/**
 * Transferencias que te llegan.
 *
 * El correo original trae RUT, nombre completo, correo y numero de cuenta del
 * destinatario. Nada de eso se extrae: no se guarda ni viaja a Telegram. Solo
 * se toma monto, quien envia, el asunto que escribio y la fecha.
 *
 * El monto queda al final del cuerpo, despues de la palabra "Monto".
 */
var RE_TRANSFERENCIA_REMITENTE = /cliente\s+(.+?)\s+ha efectuado una transferencia/i;
var RE_TRANSFERENCIA_DETALLE = /Fecha\s+Asunto\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+Datos de destinatario/i;
var RE_TRANSFERENCIA_MONTO = /Monto\s*(US\$|USD|EUR|€|\$)\s*([\d.,]+)\s*$/i;

function leerTransferenciaRecibida(asunto, cuerpo) {
  if (!ASUNTOS.TRANSFERENCIA_RECIBIDA.test(asunto)) return null;

  var texto = normalizarTexto(cuerpo);
  var mMonto = RE_TRANSFERENCIA_MONTO.exec(texto);
  if (!mMonto) return null;

  var moneda = detectarMoneda(mMonto[1]);
  var monto = normalizarMonto(mMonto[2], moneda);
  if (monto === null) return null;

  var mRemitente = RE_TRANSFERENCIA_REMITENTE.exec(texto);
  var mDetalle = RE_TRANSFERENCIA_DETALLE.exec(texto);

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
    remitente: mRemitente ? primerNombre(mRemitente[1]) : null,
    glosa: mDetalle ? mDetalle[2].trim() : null,
    fechaHora: mDetalle ? normalizarFecha(mDetalle[1], null) : null,
  };
}

/** Del nombre completo del remitente se conserva solo el primer nombre. */
function primerNombre(nombreCompleto) {
  return String(nombreCompleto).trim().split(/\s+/)[0];
}

/** Quita espacios sobrantes y sufijos de sucursal que ensucian el aprendizaje. */
function limpiarComercio(bruto) {
  return String(bruto).trim().replace(/\s{2,}/g, ' ');
}

/**
 * Tacha datos personales de un texto libre.
 *
 * Se usa antes de guardar el extracto de un correo que ningun lector reconocio.
 * Ese extracto existe para poder escribir despues el lector que falta, y para
 * eso basta la forma del texto: los montos y las etiquetas se conservan, pero
 * RUT, correos y numeros de cuenta no tienen para que quedar escritos.
 */
function censurarDatosPersonales(texto) {
  return String(texto == null ? '' : texto)
    // Numero de cuenta o tarjeta por tramos: 00-000-00000-00
    .replace(/\b\d{2,}(?:-\d{2,}){2,}\b/g, '[cuenta]')
    // RUT con o sin puntos: 12.345.678-9 y 12345678-9
    .replace(/\b\d{1,3}(?:\.?\d{3}){1,2}-[\dkK]\b/g, '[RUT]')
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '[correo]')
    // Cualquier corrida larga de digitos. Los montos chilenos llevan puntos
    // de miles, asi que "185.000" sobrevive y "900000000" no.
    .replace(/\b\d{7,}\b/g, '[número]');
}

/** Punto de entrada: prueba cada lector hasta que uno reconozca el correo. */
function leerCorreo(asunto, cuerpo) {
  return leerCompra(asunto, cuerpo) || leerTransferenciaRecibida(asunto, cuerpo) || null;
}

// Apps Script no tiene modulos: alli estas funciones ya son globales y esta
// linea se ignora sola porque "module" no existe.
if (typeof module !== 'undefined') {
  module.exports = {
    leerCorreo, leerCompra, leerTransferenciaRecibida, censurarDatosPersonales,
    normalizarMonto, normalizarTexto, normalizarFecha, detectarMoneda,
  };
}
