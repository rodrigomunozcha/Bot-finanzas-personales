/**
 * Informes de gasto.
 *
 * El calculo es logica pura sobre una lista de movimientos, separado de la
 * lectura de la planilla y del formato del mensaje. Asi se puede probar de
 * verdad, que es lo que importa cuando los numeros van a guiar decisiones.
 *
 * Que cuenta y que no:
 *   · Solo los movimientos de tipo "gasto". Los reembolsos, los ingresos y los
 *     movimientos internos (pago de tarjeta) quedan fuera a proposito.
 *   · Solo los que tienen monto en pesos. Una compra en dolares sin pagar aun
 *     no tiene costo real conocido, asi que no se suma: se cuenta aparte y se
 *     avisa, porque si no el total del mes mentiria hacia abajo.
 */

/** Corta la fecha de un movimiento a "YYYY-MM-DD", venga como texto o Date. */
function diaDe(valor) {
  if (!valor) return '';
  if (typeof valor.getMonth === 'function') {
    return valor.getFullYear() + '-' +
      ('0' + (valor.getMonth() + 1)).slice(-2) + '-' +
      ('0' + valor.getDate()).slice(-2);
  }
  return String(valor).substring(0, 10);
}

/** "YYYY-MM-DD" de hace n dias. */
function haceDias(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return diaDe(d);
}

function primerDiaDelMes() {
  var d = new Date();
  return diaDe(new Date(d.getFullYear(), d.getMonth(), 1));
}

/**
 * Resume los gastos de un rango de dias, ambos extremos incluidos.
 * Devuelve totales, desglose por categoria, comercios repetidos y los gastos
 * que quedaron fuera del calculo.
 */
function calcularResumen(movimientos, desde, hasta) {
  var total = 0;
  var cuenta = 0;
  var porCategoria = {};
  var porComercio = {};
  var montos = [];
  var incluidos = [];
  var sinConvertir = 0;
  var sinClasificar = 0;

  movimientos.forEach(function (m) {
    var dia = diaDe(m.fechaHora);
    if (!dia || dia < desde || dia > hasta) return;
    // Basta con el tipo: los giros, los ingresos, los reembolsos y el pago de
    // la tarjeta no son "gasto". Antes tambien se filtraba por una categoria
    // llamada "Balance (NO CONSIDERAR)", heredada de Money Manager, que hacia
    // lo mismo por otro camino. Dos mecanismos para una cosa confunden.
    if (m.tipo !== 'gasto') return;

    if (!m.categoria) sinClasificar++;

    var clp = Number(m.montoClp);
    if (!clp) {
      // Compra en moneda extranjera todavia sin pagar: su costo real no existe.
      if (m.moneda && m.moneda !== 'CLP') sinConvertir++;
      return;
    }

    total += clp;
    cuenta++;
    montos.push(clp);
    incluidos.push(m);

    var cat = m.categoria || 'Sin categoría';
    porCategoria[cat] = (porCategoria[cat] || 0) + clp;

    var com = m.comercio || 'Sin comercio';
    if (!porComercio[com]) porComercio[com] = { veces: 0, total: 0 };
    porComercio[com].veces++;
    porComercio[com].total += clp;
  });

  return {
    desde: desde,
    hasta: hasta,
    total: total,
    cuenta: cuenta,
    promedio: cuenta ? total / cuenta : 0,
    categorias: ordenarPorTotal(porCategoria),
    // Los gastos que entraron al total, del mas nuevo al mas viejo. Ver los
    // montos sueltos dice mas que el total: un promedio esconde de donde sale.
    gastos: incluidos.sort(function (a, b) {
      return String(diaDe(b.fechaHora) + b.fechaHora).localeCompare(
        String(diaDe(a.fechaHora) + a.fechaHora));
    }),
    comercios: Object.keys(porComercio).map(function (nombre) {
      return {
        nombre: nombre,
        veces: porComercio[nombre].veces,
        total: porComercio[nombre].total,
      };
    }).sort(function (a, b) { return b.total - a.total; }),
    atipicos: detectarAtipicos(movimientos, desde, hasta, montos),
    sinConvertir: sinConvertir,
    sinClasificar: sinClasificar,
  };
}

function ordenarPorTotal(mapa) {
  return Object.keys(mapa)
    .map(function (nombre) { return { nombre: nombre, total: mapa[nombre] }; })
    .sort(function (a, b) { return b.total - a.total; });
}

/**
 * Gastos que se salen de lo normal del periodo.
 *
 * Se usa la mediana y no el promedio porque un solo gasto grande arrastra el
 * promedio hacia arriba y termina escondiendose a si mismo. Con la mediana, un
 * arriendo entre veinte cafes sigue destacando.
 *
 * El umbral es cuatro veces la mediana, y solo aplica con al menos cinco gastos
 * en el periodo: con menos, cualquier cosa parece atipica.
 */
function detectarAtipicos(movimientos, desde, hasta, montos) {
  if (montos.length < 5) return [];

  var ordenados = montos.slice().sort(function (a, b) { return a - b; });
  var mediana = ordenados[Math.floor(ordenados.length / 2)];
  var umbral = mediana * 4;

  return movimientos.filter(function (m) {
    var dia = diaDe(m.fechaHora);
    return dia >= desde && dia <= hasta && m.tipo === 'gasto' &&
      Number(m.montoClp) > umbral;
  }).sort(function (a, b) {
    return Number(b.montoClp) - Number(a.montoClp);
  }).slice(0, 3);
}

/** Variacion porcentual entre dos periodos. Null si no hay con que comparar. */
function variacion(actual, anterior) {
  if (!anterior) return null;
  return Math.round((actual - anterior) * 100 / anterior);
}

// --- Redaccion del mensaje -------------------------------------------------

function flecha(pct) {
  if (pct === null) return '';
  if (pct > 0) return ' ▲ ' + pct + '%';
  if (pct < 0) return ' ▼ ' + Math.abs(pct) + '%';
  return ' = igual';
}

/**
 * Arma el mensaje de un informe.
 * Recibe el resumen del periodo y el del periodo anterior para comparar.
 */
function redactarInforme(titulo, resumen, previo) {
  if (!resumen.cuenta) {
    return '📊 <b>' + titulo + '</b>\n\nNo hay gastos registrados en este período.';
  }

  var lineas = ['📊 <b>' + titulo + '</b>', ''];

  lineas.push('<b>' + formatearMonto(resumen.total, 'CLP') + '</b> en ' +
    resumen.cuenta + (resumen.cuenta === 1 ? ' gasto' : ' gastos') +
    flecha(variacion(resumen.total, previo && previo.total)));

  if (previo && previo.total) {
    lineas.push('<i>Período anterior: ' + formatearMonto(previo.total, 'CLP') + '</i>');
  }

  // Por categoria, con su variacion. Es donde de verdad se ve que cambio.
  lineas.push('');
  lineas.push('<b>Por categoría</b>');
  var previoPorCategoria = {};
  if (previo) {
    previo.categorias.forEach(function (c) { previoPorCategoria[c.nombre] = c.total; });
  }
  resumen.categorias.slice(0, 8).forEach(function (c) {
    var parte = Math.round(c.total * 100 / resumen.total);
    lineas.push('· ' + c.nombre + '  ' + formatearMonto(c.total, 'CLP') +
      '  (' + parte + '%)' + flecha(variacion(c.total, previoPorCategoria[c.nombre])));
  });

  lineas.push('');
  lineas.push(detallePorDia(resumen.gastos));

  var repetidos = resumen.comercios.filter(function (c) { return c.veces > 1; });
  if (repetidos.length) {
    lineas.push('');
    lineas.push('<b>Donde más fuiste</b>');
    repetidos.slice(0, 4).forEach(function (c) {
      lineas.push('· ' + tgEscapar(c.nombre) + '  ' + c.veces + ' veces, ' +
        formatearMonto(c.total, 'CLP'));
    });
  }

  if (resumen.atipicos.length) {
    lineas.push('');
    lineas.push('<b>Se salieron de lo normal</b>');
    resumen.atipicos.forEach(function (m) {
      lineas.push('· ' + tgEscapar(m.comercio) + '  ' +
        formatearMonto(Number(m.montoClp), 'CLP') + '  (' + formatearFecha(m.fechaHora) + ')');
    });
  }

  // Las advertencias van al final y solo si aplican: son la letra chica que
  // dice por que el total podria estar incompleto.
  var avisos = [];
  if (resumen.sinConvertir) {
    avisos.push(resumen.sinConvertir + ' compra' +
      (resumen.sinConvertir === 1 ? '' : 's') + ' en dólares sin pagar, no van en el total');
  }
  if (resumen.sinClasificar) {
    avisos.push(resumen.sinClasificar + ' sin categoría');
  }
  if (avisos.length) {
    lineas.push('');
    lineas.push('<i>Ojo: ' + avisos.join(' · ') + '</i>');
  }

  return lineas.join('\n');
}

/**
 * Lista los gastos agrupados por dia.
 *
 * Un total no dice de donde sale, y para decidir algo hay que ver los montos
 * uno por uno. Se corta en 25 porque Telegram no acepta mensajes de mas de
 * cuatro mil caracteres, y el resto se mira en la planilla.
 */
var MAXIMO_EN_DETALLE = 25;

function detallePorDia(gastos) {
  var lineas = ['<b>Detalle</b>'];
  var diaActual = '';

  gastos.slice(0, MAXIMO_EN_DETALLE).forEach(function (m) {
    var dia = diaDe(m.fechaHora);
    if (dia !== diaActual) {
      diaActual = dia;
      lineas.push('<i>' + formatearFecha(dia) + '</i>');
    }
    lineas.push('  ' + formatearMonto(Number(m.montoClp), 'CLP') + '  ' +
      tgEscapar(m.comercio) +
      (m.categoria ? '  <i>' + m.categoria + '</i>' : '  <i>sin categoría</i>'));
  });

  if (gastos.length > MAXIMO_EN_DETALLE) {
    lineas.push('<i>… y ' + (gastos.length - MAXIMO_EN_DETALLE) +
      ' más. Están todos en la planilla, con /datos.</i>');
  }
  return lineas.join('\n');
}

// --- Puntos de entrada -----------------------------------------------------

function informeSemana() {
  var movimientos = todosLosMovimientos();
  var resumen = calcularResumen(movimientos, haceDias(6), diaDe(new Date()));
  var previo = calcularResumen(movimientos, haceDias(13), haceDias(7));
  tgEnviar(redactarInforme('Últimos 7 días', resumen, previo));
}

function informeMes() {
  var movimientos = todosLosMovimientos();
  var ahora = new Date();
  var inicioMes = primerDiaDelMes();
  var finMesPasado = diaDe(new Date(ahora.getFullYear(), ahora.getMonth(), 0));
  var inicioMesPasado = diaDe(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1));

  var resumen = calcularResumen(movimientos, inicioMes, diaDe(ahora));
  var previo = calcularResumen(movimientos, inicioMesPasado, finMesPasado);

  var nombreMes = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][ahora.getMonth()];
  tgEnviar(redactarInforme(nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1),
    resumen, previo));
}

/** Lo dispara el activador los domingos por la tarde. */
function informeSemanalAutomatico() {
  informeSemana();
}
