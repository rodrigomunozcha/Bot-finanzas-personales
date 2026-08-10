/**
 * Pago de la tarjeta de credito internacional.
 *
 * Este correo cumple dos funciones a la vez:
 *   1. Cierra las compras en dolares que estaban esperando su valor en pesos.
 *   2. Se marca como movimiento interno, no como gasto. Si se contara como
 *      gasto, el mes quedaria inflado, porque las compras que ese pago cubre ya
 *      se registraron una por una cuando ocurrieron.
 *
 * Logica pura: corre igual bajo Node y bajo Apps Script.
 */

// En Apps Script todos los archivos comparten un mismo ambito global, asi que
// las funciones de parsers.js ya estan disponibles. En Node hay que traerlas, y
// se publican en el ambito global en vez de en una variable local: un "var" a
// nivel de archivo se izaria tambien en Apps Script y taparia las globales
// reales dejandolas en undefined.
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  var _parsers = require('./parsers.js');
  globalThis.normalizarTexto = _parsers.normalizarTexto;
  globalThis.normalizarMonto = _parsers.normalizarMonto;
}

var ASUNTO_PAGO_TARJETA = /comprobante pago tarjeta de cr[eé]dito internacional/i;

var MESES = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11',
  diciembre: '12',
};

// "Utilizado" es cuanto queda usado en la tarjeta DESPUES del pago. En cero
// significa que se salda todo, y por lo tanto se pueden cerrar todas las
// compras pendientes. Distinto de cero significa pago parcial.
var RE_UTILIZADO = /Utilizado\s*US?D?\$\s*([\d.,]+)/i;
var RE_MONTO_PAGADO = /Monto pagado\s*US?D?\$\s*([\d.,]+)/i;
// El monto en pesos va inmediatamente despues del tipo de cambio. Hay que
// anclarlo asi porque la palabra "Monto" tambien aparece en "Monto pagado".
var RE_CAMBIO_Y_MONTO = /Tipo de cambio\s*\$\s*([\d.,]+)\s*Monto\s*\$\s*([\d.,]+)/i;
var RE_FECHA_LARGA = /(\d{1,2}) de ([a-zé]+) de (\d{4})\s*(\d{2}:\d{2})/i;

function leerPagoTarjeta(asunto, cuerpo) {
  if (!ASUNTO_PAGO_TARJETA.test(asunto)) return null;

  var texto = normalizarTexto(cuerpo);
  var mCambio = RE_CAMBIO_Y_MONTO.exec(texto);
  var mPagado = RE_MONTO_PAGADO.exec(texto);
  if (!mCambio || !mPagado) return null;

  var montoUsd = normalizarMonto(mPagado[1], 'USD');
  var montoClp = normalizarMonto(mCambio[2], 'CLP');
  if (!montoUsd || !montoClp) return null;

  var mUtilizado = RE_UTILIZADO.exec(texto);
  var utilizado = mUtilizado ? normalizarMonto(mUtilizado[1], 'USD') : null;

  return {
    tipo: 'movimiento_interno',
    montoUsd: montoUsd,
    montoClp: montoClp,

    // El tipo de cambio que muestra el correo viene redondeado a peso entero, y
    // usarlo da un resultado equivocado: 150 x 949 son $142.350, pero del
    // bolsillo salieron $142.403. La tasa buena se deduce de los dos montos.
    tasaMostrada: normalizarMonto(mCambio[1], 'CLP'),
    tasaEfectiva: montoClp / montoUsd,

    saldaTodo: utilizado === 0,
    fechaHora: fechaLargaAIso(texto),
  };
}

function fechaLargaAIso(texto) {
  var m = RE_FECHA_LARGA.exec(texto);
  if (!m) return null;
  var mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  var dia = m[1].length === 1 ? '0' + m[1] : m[1];
  return m[3] + '-' + mes + '-' + dia + 'T' + m[4];
}

/**
 * Reparte el pago entre las compras en dolares que estaban pendientes.
 *
 * El banco no dice cuanto costo cada compra por separado, solo el total pagado
 * y lo que salio en pesos. Asi que se reparte a prorrata, que es la unica
 * asignacion defendible con esa informacion, y ademas hace que la suma calce
 * exactamente con la plata que salio de la cuenta.
 *
 * Si el pago es parcial se cierran las mas antiguas primero, hasta donde
 * alcance, y el resto sigue esperando el proximo pago.
 */
function repartirPago(pago, pendientes) {
  var orden = pendientes.slice().sort(function (a, b) {
    return String(a.fechaHora).localeCompare(String(b.fechaHora));
  });

  var cubiertas = [];
  var siguenPendientes = [];

  if (pago.saldaTodo) {
    cubiertas = orden;
  } else {
    var acumulado = 0;
    for (var i = 0; i < orden.length; i++) {
      if (acumulado + orden[i].monto <= pago.montoUsd + 1e-9) {
        acumulado += orden[i].monto;
        cubiertas.push(orden[i]);
      } else {
        siguenPendientes.push(orden[i]);
      }
    }
  }

  var cerradas = cubiertas.map(function (c) {
    return { id: c.id, montoClp: Math.round(c.monto * pago.tasaEfectiva) };
  });

  // Redondear cada compra por separado deja una diferencia de unos pocos pesos
  // contra el total real. Se ajusta en la compra mas grande, que es donde menos
  // se nota, para que el total cuadre al peso con el cargo del banco.
  if (pago.saldaTodo && cerradas.length) {
    var suma = cerradas.reduce(function (t, c) { return t + c.montoClp; }, 0);
    var diferencia = pago.montoClp - suma;
    if (diferencia !== 0) {
      var mayor = 0;
      for (var j = 1; j < cerradas.length; j++) {
        if (cerradas[j].montoClp > cerradas[mayor].montoClp) mayor = j;
      }
      cerradas[mayor].montoClp += diferencia;
    }
  }

  return { cerradas: cerradas, siguenPendientes: siguenPendientes };
}

if (typeof module !== 'undefined') {
  module.exports = { leerPagoTarjeta, repartirPago, fechaLargaAIso };
}
