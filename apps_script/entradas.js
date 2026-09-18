/**
 * Lo que el usuario anota a mano.
 *
 * Las compras con tarjeta llegan solas por correo. Aca vive lo otro: el
 * efectivo, los giros por cajero y los ingresos, que nadie avisa por correo y
 * hay que escribir.
 */

/**
 * Reconoce un gasto escrito a mano: un monto y despues la descripcion.
 *
 *   "12000 efectivo almuerzo"  -> $12.000 en efectivo, "almuerzo"
 *   "3.500 micro"              -> $3.500, "micro"
 *
 * Se exige que empiece con el monto para no confundir un gasto con cualquier
 * frase suelta. Los puntos de miles se aceptan porque asi se escriben los pesos
 * en Chile.
 */
function leerGastoEscrito(texto) {
  var m = /^\$?\s*([\d.]{2,})\s*(.*)$/.exec(String(texto).trim());
  if (!m) return null;

  var monto = normalizarMonto(m[1], 'CLP');
  if (!monto || monto < 1) return null;

  var resto = m[2].trim();
  var esGiro = /\bgiro\b|\bcajero\b/i.test(resto);
  var esEfectivo = /efectivo/i.test(resto);
  var descripcion = resto.replace(/efectivo|giro|cajero/ig, '')
    .replace(/\s{2,}/g, ' ').trim();

  return {
    monto: monto,
    esGiro: esGiro,
    medioPago: esEfectivo || esGiro ? 'efectivo' : 'a mano',
    descripcion: descripcion,
  };
}

/**
 * Un giro por cajero no es un gasto: es plata que se mueve de la cuenta al
 * bolsillo y sigue siendo tuya. El gasto ocurre despues, cuando compras algo
 * con esos billetes y lo anotas con "12000 efectivo".
 *
 * Contarlo como gasto y ademas anotar el efectivo seria contar dos veces la
 * misma plata, por eso se registra como movimiento interno y queda fuera de
 * los informes.
 */
function registrarGiro(datos) {
  registrarMovimiento({
    id: nuevoId(),
    fechaHora: ahoraComoTexto(),
    tipo: 'giro',
    comercio: datos.descripcion || 'Giro por cajero',
    monto: datos.monto,
    moneda: 'CLP',
    montoClp: datos.monto,
    medioPago: 'efectivo',
    estado: ESTADOS.INTERNO,
  });

  var saldo = calcularEfectivo();
  tgEnviar([
    '💵 <b>Giro anotado: ' + formatearMonto(datos.monto, 'CLP') + '</b>',
    '',
    'No lo cuento como gasto, porque esa plata sigue siendo tuya: solo pasó de',
    'la cuenta a tu bolsillo. El gasto ocurre cuando la uses.',
    '',
    'A medida que gastes ese efectivo, anótalo:',
    '<code>12000 efectivo</code>',
    '',
    'Tienes <b>' + formatearMonto(saldo.disponible, 'CLP') + '</b> en efectivo sin anotar.',
  ].join('\n'));
}

/**
 * Cuanto efectivo giraste y todavia no explicaste en que se fue.
 * Es la unica forma de que el hueco sea visible en vez de un descuadre mudo.
 */
function calcularEfectivo() {
  var girado = 0;
  var gastado = 0;

  todosLosMovimientos().forEach(function (m) {
    var clp = Number(m.montoClp) || 0;
    if (m.tipo === 'giro') girado += clp;
    else if (m.tipo === 'gasto' && m.medioPago === 'efectivo') gastado += clp;
  });

  return { girado: girado, gastado: gastado, disponible: girado - gastado };
}

function informeEfectivo() {
  var saldo = calcularEfectivo();

  if (!saldo.girado && !saldo.gastado) {
    tgEnviar([
      '💵 <b>Efectivo</b>',
      '',
      'No hay ningún giro ni gasto en efectivo registrado.',
      '',
      'Cuando saques plata del cajero, anótalo:',
      '<code>50000 giro</code>',
      '',
      'Y a medida que la gastes:',
      '<code>12000 efectivo</code>',
      '',
      'Así sé cuánto te queda sin explicar.',
    ].join('\n'));
    return;
  }

  var lineas = [
    '💵 <b>Efectivo</b>',
    '',
    'Giraste: ' + formatearMonto(saldo.girado, 'CLP'),
    'Anotaste como gasto: ' + formatearMonto(saldo.gastado, 'CLP'),
    '',
    '<b>Sin explicar: ' + formatearMonto(saldo.disponible, 'CLP') + '</b>',
  ];

  if (saldo.disponible < 0) {
    lineas.push('');
    lineas.push('<i>Anotaste más gasto en efectivo del que giraste. Puede que ' +
      'falte registrar un giro, o que hayas pagado con efectivo que ya tenías.</i>');
  } else if (saldo.disponible > 0) {
    lineas.push('');
    lineas.push('<i>Es plata que sacaste y todavía no dijiste en qué se fue. ' +
      'Puede estar en tu bolsillo, o pueden ser gastos que no anotaste.</i>');
  }
  tgEnviar(lineas.join('\n'));
}

/** Un gasto que el usuario escribio a mano. */
function registrarGastoEscrito(datos) {
  // Sin descripcion el comercio queda como "Efectivo" a secas. Basta: la
  // categoria la elige el usuario enseguida con los botones.
  return abrirGasto({
    id: nuevoId(),
    fechaHora: ahoraComoTexto(),
    tipo: 'gasto',
    comercio: datos.descripcion ||
      (datos.medioPago === 'efectivo' ? 'Efectivo' : 'Gasto a mano'),
    monto: datos.monto,
    moneda: 'CLP',
    montoClp: datos.monto,
    medioPago: datos.medioPago,
    correoId: '',
  });
}

/**
 * Un movimiento como texto ordenable "YYYY-MM-DDTHH:MM", venga como sea.
 * Sheets a veces devuelve Date y a veces texto, y comparar peras con manzanas
 * hace que el saldo cuente o descarte movimientos al azar.
 */
function momentoDe(valor) {
  if (!valor) return '';
  if (typeof valor.getMonth === 'function') {
    return valor.getFullYear() + '-' + dos(valor.getMonth() + 1) + '-' +
      dos(valor.getDate()) + 'T' + dos(valor.getHours()) + ':' + dos(valor.getMinutes());
  }
  return String(valor).substring(0, 16);
}

/** La hora local en el formato que usa la planilla. */
function ahoraComoTexto() {
  var d = new Date();
  return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()) +
    'T' + dos(d.getHours()) + ':' + dos(d.getMinutes());
}

/**
 * Los ultimos gastos, con un boton para corregir cada uno.
 *
 * Hacia falta: una vez que el mensaje original queda atras en el chat, no habia
 * forma de cambiarle la categoria a un gasto de ayer.
 */
function mostrarUltimos() {
  var movimientos = todosLosMovimientos()
    .filter(function (m) { return m.tipo === 'gasto'; })
    .slice(-5).reverse();

  if (!movimientos.length) {
    tgEnviar('Todavía no hay gastos registrados.');
    return;
  }

  tgEnviar('<b>Tus últimos ' + movimientos.length + ' gastos</b>\n' +
    '<i>Toca el que quieras corregir.</i>');

  movimientos.forEach(function (m) {
    tgEnviar('✅ ' + encabezado(m) + '\n' + rutaCategoria(m.categoria, m.subcategoria) +
      (m.nota ? '\n📝 ' + tgEscapar(m.nota) : ''), tecladoCerrado(m.id));
  });
}

/** Enlace a la planilla y estado del respaldo automatico. */
function mostrarDatos() {
  var id = PropertiesService.getScriptProperties().getProperty('HOJA_ID');
  tgEnviar([
    '<b>Tu planilla en Google</b>',
    'https://docs.google.com/spreadsheets/d/' + id + '/edit',
    'Ahí está todo lo que el bot ha registrado, y puedes editarlo a mano.',
    '',
    '<b>Tu respaldo</b>',
    'Cada domingo guardo automáticamente una copia en tu Google Drive, en la ' +
      'carpeta <b>' + RESPALDO_CARPETA + '</b>. No tienes que hacer nada.',
    'Último respaldo: ' + textoUltimoRespaldo() + '.',
    '',
    '<b>Si además quieres la copia en el Mac</b>',
    'Descarga a tu carpeta Descargas el archivo más reciente de esa carpeta, y corre:',
    '<code>python3 herramientas/respaldar.py</code>',
    'Eso deja los datos en <code>datos/finanzas.db</code> (base SQLite, para',
    'análisis) y en <code>datos/movimientos.csv</code> (se abre en Excel).',
    'La copia local nunca borra nada, aunque la planilla se pierda.',
  ].join('\n'));
}


// --- Ingresos y saldo ------------------------------------------------------

/**
 * Un ingreso escrito a mano: "+900000 sueldo".
 *
 * El signo mas es lo que lo distingue de un gasto. Sin el, "900000 sueldo"
 * seria un gasto, y confundirse en el signo arruina el balance entero.
 */
function leerIngresoEscrito(texto) {
  var m = /^\+\s*\$?\s*([\d.]{2,})\s*(.*)$/.exec(String(texto).trim());
  if (!m) return null;

  var monto = normalizarMonto(m[1], 'CLP');
  if (!monto || monto < 1) return null;

  return { monto: monto, descripcion: m[2].trim() };
}

/** Registra el ingreso y pregunta de que tipo es. */
function registrarIngreso(datos) {
  var id = nuevoId();
  var mov = {
    id: id,
    fechaHora: ahoraComoTexto(),
    tipo: 'ingreso',
    comercio: datos.descripcion || 'Ingreso',
    monto: datos.monto,
    moneda: 'CLP',
    montoClp: datos.monto,
    medioPago: 'transferencia',
    estado: ESTADOS.ESPERANDO_CATEGORIA,
    correoId: '',
  };

  mov.mensajeId = tgEnviar(
    '💰 <b>Ingreso de ' + formatearMonto(datos.monto, 'CLP') + '</b>' +
    (datos.descripcion ? '\n' + tgEscapar(datos.descripcion) : '') +
    '\n\n¿De qué tipo?',
    tecladoCategorias(id, CATEGORIAS_INGRESO)
  );
  registrarMovimiento(mov);
  marcarConversacion();
  return id;
}

function explicarIngreso() {
  tgEnviar([
    '💰 <b>Anotar un ingreso</b>',
    '',
    'Escríbeme el monto con un <b>+</b> adelante:',
    '<code>+900000 sueldo</code>',
    '<code>+50000 clase particular</code>',
    '',
    'El signo más es lo que lo separa de un gasto. Sin él lo anoto como gasto.',
    '',
    'Después te pregunto de qué tipo de ingreso se trata.',
    '',
    '<i>Las transferencias que te llegan al banco no las anotas tú: llegan',
    'solas por correo y ahí eliges si son ingreso o reembolso.</i>',
  ].join('\n'));
}

/**
 * Cuanta plata queda en la cuenta corriente.
 *
 * Se parte de un saldo que el usuario declara y se le suman y restan los
 * movimientos que de verdad tocan la cuenta. Las reglas no son obvias:
 *
 *   compra con debito       sale de la cuenta al instante        resta
 *   transferencia que envias sale de la cuenta al instante       resta
 *   compra con credito      NO sale hasta que se paga la tarjeta  no mueve nada
 *   pago de la tarjeta      ahi si sale                           resta
 *   giro por cajero         sale de la cuenta, va al bolsillo     resta
 *   gasto en efectivo       ya habia salido en el giro            no mueve nada
 *   ingreso o reembolso     entra                                 suma
 *
 * Contar la compra con credito Y el pago de la tarjeta seria restar dos veces
 * la misma plata, que es el error clasico al llevar cuentas a mano.
 *
 * La transferencia que envias se agrego despues del lector de transferencias
 * enviadas, y quedo afuera la primera vez: solo se restaba el debito, y una
 * transferencia enviada de verdad no se conto en su saldo hasta que el mismo
 * lo noto pidiendo /saldo y viendo el numero mal. Las dos salen de la cuenta
 * en el momento, asi que las dos restan igual.
 */
function calcularSaldo() {
  var propiedades = PropertiesService.getScriptProperties();
  var inicial = Number(propiedades.getProperty('SALDO_INICIAL') || 0);
  var desde = propiedades.getProperty('SALDO_DESDE') || '';

  var entradas = 0;
  var salidas = 0;

  todosLosMovimientos().forEach(function (m) {
    // Se compara con hora, no solo con fecha. El saldo que declaras lo lees del
    // banco, y ese numero ya incluye las compras de mas temprano ese mismo dia:
    // volver a restarlas dejaria el calculo corrido desde el primer minuto.
    //
    // Lo del mismo minuto si cuenta. Con precision de minuto hay que elegir
    // hacia donde equivocarse, y es preferible contar de mas: el saldo se nota
    // desviado y se corrige, mientras que un gasto que nunca se resta pasa
    // inadvertido.
    if (desde && momentoDe(m.fechaHora) < desde) return;

    var clp = Number(m.montoClp) || 0;
    if (!clp) return;

    if (m.tipo === 'ingreso') entradas += clp;
    else if (m.tipo === 'giro') salidas += clp;
    else if (m.tipo === 'interno') salidas += clp;    // pago de la tarjeta
    else if (m.tipo === 'gasto' &&
      (m.medioPago === 'debito' || m.medioPago === 'transferencia')) {
      salidas += clp;
    }
    // credito, efectivo, entrada sin resolver y reembolso no mueven la cuenta
  });

  return {
    inicial: inicial,
    desde: desde,
    entradas: entradas,
    salidas: salidas,
    actual: inicial + entradas - salidas,
  };
}

/** Muestra el saldo, o lo fija si viene un monto. */
function informeSaldo(monto) {
  var propiedades = PropertiesService.getScriptProperties();

  if (monto) {
    propiedades.setProperties({
      SALDO_INICIAL: String(monto),
      SALDO_DESDE: ahoraComoTexto(),
    });
    tgEnviar('🏦 Saldo fijado en <b>' + formatearMonto(monto, 'CLP') + '</b>.\n' +
      'Desde hoy lo voy actualizando con cada movimiento.');
    return;
  }

  var saldo = calcularSaldo();
  if (!saldo.inicial) {
    tgEnviar([
      '🏦 <b>Saldo</b>',
      '',
      'Todavía no me has dicho cuánto tienes en la cuenta.',
      '',
      'Míralo en tu banco y escríbeme:',
      '<code>/saldo 1055792</code>',
      '',
      'Desde ahí lo voy siguiendo con cada compra e ingreso.',
    ].join('\n'));
    return;
  }

  tgEnviar([
    '🏦 <b>' + formatearMonto(saldo.actual, 'CLP') + '</b> en la cuenta',
    '',
    'Partiste con ' + formatearMonto(saldo.inicial, 'CLP') +
      ' el ' + formatearFecha(saldo.desde),
    'Entró: ' + formatearMonto(saldo.entradas, 'CLP'),
    'Salió: ' + formatearMonto(saldo.salidas, 'CLP'),
    '',
    '<i>Es un cálculo, no el saldo del banco. Las compras con tarjeta de',
    'crédito no se descuentan hasta que pagas la tarjeta. Si se desvía,',
    'corrígelo con /saldo y el monto que diga tu banco.</i>',
  ].join('\n'));
}
