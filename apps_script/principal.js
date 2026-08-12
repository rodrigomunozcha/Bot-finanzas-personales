/**
 * Puntos de entrada del sistema.
 *
 *   revisarCorreo()          lo dispara el activador cada 5 minutos
 *   revisarTelegram()        lo dispara el activador cada minuto
 *   instalar()               se corre una sola vez, al empezar
 *   usarConsultaPeriodica()  reconecta el bot si algo se desconfiguro
 *
 * Las funciones de revision y ayuda estan en diagnostico.js.
 */

var ETIQUETA_PENDIENTE = 'Finanzas/Pendiente';
var ETIQUETA_PROCESADO = 'Finanzas/Procesado';

// --- Revision del correo ---------------------------------------------------

/**
 * Corre cada 5 minutos. Solo mira los correos que el filtro de Gmail dejo en
 * la etiqueta de pendientes, asi que en la enorme mayoria de las pasadas no
 * encuentra nada y termina en un par de segundos.
 */
function revisarCorreo() {
  var pendiente = GmailApp.getUserLabelByName(ETIQUETA_PENDIENTE);
  var procesado = GmailApp.getUserLabelByName(ETIQUETA_PROCESADO);
  if (!pendiente || !procesado) throw new Error('Faltan las etiquetas. Corre instalar().');

  // De a 10 por pasada: si se acumulo mucho (por ejemplo tras unos dias sin
  // correr) es preferible varias pasadas cortas que una que choque con el
  // limite de 6 minutos por ejecucion y no alcance a marcar nada como leido.
  pendiente.getThreads(0, 10).forEach(function (hilo) {
    hilo.getMessages().forEach(function (mensaje) {
      try {
        procesarMensaje(mensaje);
      } catch (error) {
        console.error('Error con "' + mensaje.getSubject() + '": ' + error);
      }
    });
    hilo.removeLabel(pendiente).addLabel(procesado);
  });
}

/**
 * Enlace para abrir el correo en Gmail, sin copiar nada de su contenido.
 *
 * getPermalink() vive en el hilo, no en el mensaje. Va con try porque en las
 * pruebas los correos son objetos simulados y porque un enlace que falta no
 * puede costar el registro entero: en ese caso queda el identificador, que
 * tambien sirve para buscarlo.
 */
function enlaceAlCorreo(mensaje) {
  try {
    return mensaje.getThread().getPermalink();
  } catch (error) {
    return 'Búscalo en Gmail por su asunto.';
  }
}

function procesarMensaje(mensaje) {
  var correoId = mensaje.getId();
  if (correoYaRegistrado(correoId)) return;

  var asunto = mensaje.getSubject();
  var cuerpo = mensaje.getPlainBody();

  var pago = leerPagoTarjeta(asunto, cuerpo);
  if (pago) return procesarPagoTarjeta(pago, correoId);

  var lectura = leerCorreo(asunto, cuerpo);
  if (!lectura) {
    // Nunca se descarta en silencio, pero tampoco se guarda el cuerpo.
    //
    // Antes se guardaba un extracto de 400 caracteres, pasado por un censor de
    // expresiones regulares. No servia: el censor tachaba RUT, correos y
    // numeros de cuenta, pero los nombres de personas y las direcciones no
    // tienen forma reconocible y salian intactos. Verificado corriendolo.
    //
    // Ese extracto existia solo para escribir despues el lector que falta, o
    // sea para comodidad de quien programa, no para que el sistema funcione. No
    // vale guardar el correo de nadie por eso. Ahora queda el asunto y un
    // enlace: quien instalo esto abre su propio correo, mira lo que hay, y
    // decide que comparte.
    registrarNoEntendido(asunto, correoId, enlaceAlCorreo(mensaje));
    return;
  }

  // Recien anunciado un gasto viene la respuesta del usuario, asi que se
  // marca conversacion para que la proxima consulta entre en modo rapido.
  if (lectura.tipo === 'gasto') {
    var idGasto = anunciarGasto(lectura, correoId);
    marcarConversacion();
    return idGasto;
  }
  if (lectura.tipo === 'entrada') {
    var idEntrada = anunciarEntrada(lectura, correoId);
    marcarConversacion();
    return idEntrada;
  }
}

/**
 * El pago de la tarjeta cierra las compras en dolares que estaban esperando y
 * queda registrado como movimiento interno, no como gasto: lo que ese pago
 * cubre ya se conto compra por compra cuando ocurrio.
 */
function procesarPagoTarjeta(pago, correoId) {
  var pendientes = comprasPendientesConversion().filter(function (p) {
    return p.moneda === 'USD';
  });

  var reparto = repartirPago(pago, pendientes);
  reparto.cerradas.forEach(function (c) {
    var mov = obtenerMovimiento(c.id);
    if (mov) {
      mov.montoClp = c.montoClp;
      guardarMovimiento(mov);
    }
  });

  registrarMovimiento({
    fechaHora: pago.fechaHora,
    tipo: 'interno',
    comercio: 'Pago tarjeta de crédito internacional',
    monto: pago.montoUsd,
    moneda: 'USD',
    montoClp: pago.montoClp,
    medioPago: 'transferencia',
    estado: ESTADOS.INTERNO,
    correoId: correoId,
  });

  if (!reparto.cerradas.length) {
    tgEnviar('💳 Pagaste la tarjeta internacional: ' +
      formatearMonto(pago.montoClp, 'CLP') +
      '\n<i>No había compras esperando conversión.</i>');
    return;
  }

  var detalle = reparto.cerradas.map(function (c) {
    var mov = obtenerMovimiento(c.id);
    return '· ' + tgEscapar(mov.comercio) + ' ' +
      formatearMonto(mov.monto, mov.moneda) + ' → ' + formatearMonto(c.montoClp, 'CLP');
  });

  var texto = '💳 <b>Pago de tarjeta internacional</b>\n' +
    formatearMonto(pago.montoUsd, 'USD') + ' → ' + formatearMonto(pago.montoClp, 'CLP') +
    '\nCambio real: ' + pago.tasaEfectiva.toFixed(2).replace('.', ',') +
    '\n\nCerré ' + reparto.cerradas.length +
    (reparto.cerradas.length === 1 ? ' compra:' : ' compras:') + '\n' + detalle.join('\n');

  if (reparto.siguenPendientes.length) {
    texto += '\n\n<i>Quedan ' + reparto.siguenPendientes.length +
      ' esperando el próximo pago.</i>';
  }
  tgEnviar(texto);
}


// --- Latido diario ---------------------------------------------------------

/** Dias sin respaldar antes de empezar a insistir. */
var DIAS_SIN_RESPALDO = 7;

/**
 * Corre una vez al dia y habla SOLO si hay algo que arreglar.
 *
 * Existe porque el sistema puede morirse en silencio: si el activador se
 * detiene, si se agota la cuota, o si un correo deja de reconocerse, no pasa
 * nada visible. Simplemente dejarian de llegar mensajes, y eso se confunde con
 * una racha sin compras. Podrias pasar una semana creyendo que todo anda bien.
 *
 * Si no hay nada que reportar no manda nada. Un aviso diario de "todo bien" se
 * vuelve ruido en tres dias y se deja de leer, que es peor que no tenerlo.
 */
function latidoDiario() {
  var propiedades = PropertiesService.getScriptProperties();
  var avisos = [];

  var sinClasificar = contarSinClasificar();
  if (sinClasificar) {
    avisos.push('· <b>' + sinClasificar + '</b> ' +
      (sinClasificar === 1 ? 'gasto sin categoría' : 'gastos sin categoría') +
      '\n  Escribe <code>/pendientes</code> para verlos.');
  }

  var noEntendidos = Math.max(0, hoja(HOJA_NO_ENTENDIDOS).getLastRow() - 1);
  var yaAvisados = Number(propiedades.getProperty('NO_ENTENDIDOS_AVISADOS') || 0);
  if (noEntendidos > yaAvisados) {
    avisos.push('· <b>' + (noEntendidos - yaAvisados) + '</b> correos del banco que ' +
      'no supe leer\n' +
      '  Son movimientos que no se están registrando, así que tus totales ' +
      'quedan cortos.\n' +
      '  De esos correos no guardé nada más que el asunto y un enlace. ' +
      'Ábrelos con <code>/datos</code> y pásale el formato a quien mantenga ' +
      'esto para que lo agregue.');
    propiedades.setProperty('NO_ENTENDIDOS_AVISADOS', String(noEntendidos));
  }

  var usado = Number(propiedades.getProperty('PRESUPUESTO_USADO') || 0);
  if (usado > TOPE_DIARIO_SEGUNDOS * 0.9) {
    avisos.push('· Cuota diaria al <b>' +
      Math.round(usado * 100 / TOPE_DIARIO_SEGUNDOS) + '%</b>\n' +
      '  Hoy voy a responder más lento, hasta un minuto por toque. ' +
      'Mañana se reinicia sola.');
  }

  // Un giro grande sin anotar en que se fue deja los informes cojos y no se
  // nota, porque el gasto simplemente no existe en ninguna parte.
  var efectivo = calcularEfectivo();
  if (efectivo.disponible > 30000) {
    avisos.push('· <b>' + formatearMonto(efectivo.disponible, 'CLP') +
      '</b> en efectivo sin explicar\n' +
      '  Giraste esa plata y no has dicho en qué se fue.\n' +
      '  Anótalo así: <code>12000 efectivo</code>');
  }

  var dias = diasSinRespaldo(propiedades);
  if (dias >= DIAS_SIN_RESPALDO) {
    avisos.push('· Hace <b>' + dias + ' días</b> que no respaldas\n' +
      '  Todo vive solo en Google. Si esa hoja se pierde, se pierde todo.\n' +
      '  1. Abre tu hoja Finanzas\n' +
      '  2. Archivo → Descargar → Microsoft Excel\n' +
      '  3. En el Mac: <code>cd la carpeta del proyecto && ' +
      'python3 herramientas/respaldar.py</code>\n' +
      '  4. Vuelve y escríbeme <code>/respaldado</code>');
  }

  if (!avisos.length) return;
  tgEnviar('🩺 <b>Revisión del día</b>\n\n' + avisos.join('\n\n'));
}

function diasSinRespaldo(propiedades) {
  var ultimo = Number(propiedades.getProperty('ULTIMO_RESPALDO') || 0);
  // Sin ningun respaldo registrado se cuenta desde la instalacion, para no
  // reclamar el primer dia ni quedarse callado para siempre.
  if (!ultimo) {
    ultimo = Number(propiedades.getProperty('INSTALADO_EN') || Date.now());
    propiedades.setProperty('INSTALADO_EN', String(ultimo));
  }
  return Math.floor((Date.now() - ultimo) / 86400000);
}

// --- Consulta periodica a Telegram -----------------------------------------

/**
 * Le pregunta a Telegram si hay avisos nuevos. Lo dispara el activador cada
 * minuto.
 *
 * Antes esto funcionaba al reves: Telegram llamaba a una direccion publica del
 * script. No sirvio. Apps Script no responde con un 200 limpio sino con una
 * redireccion, y Telegram la rechaza textualmente:
 *   "Wrong response from the webhook: 302 Found"
 * Como nunca daba por entregado ningun aviso, los acumulaba en su cola, los
 * reintentaba con espera creciente, y los nuevos quedaban atrapados detras. De
 * ahi venian las demoras de media hora, los mensajes sin respuesta, y el que se
 * repetia cada 61 minutos.
 *
 * Consultando nosotros el problema desaparece: el "offset" le confirma a
 * Telegram que puede descartar lo ya entregado, y la cola nunca se acumula.
 */
var ESPERA_ENTRE_CONSULTAS_MS = 2500;
var DURACION_TANDA_MS = 50000;      // se corta antes del minuto siguiente
var VENTANA_ACTIVIDAD_MS = 120000;  // dos minutos sin nada y vuelve al ritmo lento

// Tope diario de segundos gastados consultando rapido. Google regala 90 minutos
// de ejecucion al dia y la revision del correo tambien consume: 45 minutos para
// las consultas rapidas dejan margen de sobra para todo lo demas.
var TOPE_DIARIO_SEGUNDOS = 2700;

/**
 * El activador la dispara cada minuto.
 *
 * Consultar una sola vez por minuto hace que cada toque de boton tarde hasta un
 * minuto, y clasificar un gasto son tres toques. Por eso cuando hay
 * conversacion en curso esta funcion se queda dando vueltas casi un minuto,
 * consultando cada dos segundos y medio, y la respuesta baja a un par de
 * segundos.
 *
 * Cuando no pasa nada, que es la mayor parte del dia, consulta una vez y sale.
 * Ese es el caso que hay que mantener barato para no agotar la cuota gratis.
 */
function revisarTelegram() {
  var hubo = procesarTanda();

  if (!hubo && !hayConversacionEnCurso()) return;
  if (!quedaPresupuesto()) return;

  var comienzo = Date.now();
  var limite = comienzo + DURACION_TANDA_MS;

  while (Date.now() < limite && hayConversacionEnCurso()) {
    Utilities.sleep(ESPERA_ENTRE_CONSULTAS_MS);
    procesarTanda();
  }

  anotarConsumo(Math.round((Date.now() - comienzo) / 1000));
}

/** Una consulta. Devuelve true si llego algo. */
function procesarTanda() {
  var propiedades = PropertiesService.getScriptProperties();
  var desde = Number(propiedades.getProperty('TELEGRAM_OFFSET') || 0);

  var r = tgLlamar('getUpdates', {
    offset: desde,
    timeout: 0,
    allowed_updates: ['message', 'callback_query'],
  });

  if (!r.ok) {
    console.error('getUpdates: ' + r.description);
    return false;
  }
  if (!r.result.length) return false;

  var mayor = desde - 1;
  r.result.forEach(function (update) {
    if (update.update_id > mayor) mayor = update.update_id;
    try {
      atenderAviso(update);
    } catch (error) {
      // El offset avanza igual aunque este aviso falle. Uno que reviente no
      // puede quedar reintentandose para siempre: seria volver justo al
      // problema que estamos arreglando.
      console.error('atenderAviso: ' + error);
      anotarEnBitacora(update.update_id, 'aviso con falla', 'ERROR: ' + error);
      try {
        tgEnviar('⚠️ Se cayó algo al procesar eso.\n<code>' +
          tgEscapar(String(error && error.stack ? error.stack : error)).substring(0, 900) +
          '</code>');
      } catch (nada) {
        // Si ni siquiera se puede escribir a Telegram no queda nada por hacer.
      }
    }
  });

  propiedades.setProperty('TELEGRAM_OFFSET', String(mayor + 1));
  marcarConversacion();
  return true;
}

/**
 * Deja constancia de que hay alguien conversando.
 *
 * La llama tanto quien atiende un aviso como quien anuncia un gasto nuevo: en
 * los dos casos es probable que venga una respuesta enseguida, y conviene estar
 * consultando rapido cuando llegue.
 */
function marcarConversacion() {
  PropertiesService.getScriptProperties()
    .setProperty('ULTIMA_CONVERSACION', String(Date.now()));
}

function hayConversacionEnCurso() {
  var ultima = Number(PropertiesService.getScriptProperties()
    .getProperty('ULTIMA_CONVERSACION') || 0);
  return Date.now() - ultima < VENTANA_ACTIVIDAD_MS;
}

// --- Presupuesto de ejecucion ----------------------------------------------

/**
 * Google corta el script cuando se pasa de 90 minutos diarios de ejecucion, y
 * lo hace sin aviso: dejaria de leer el correo y de responder hasta el dia
 * siguiente. Este tope propio se agota antes y solo desactiva las consultas
 * rapidas, no el sistema.
 */
function quedaPresupuesto() {
  var propiedades = PropertiesService.getScriptProperties();
  var hoy = new Date().toISOString().substring(0, 10);

  if (propiedades.getProperty('PRESUPUESTO_DIA') !== hoy) {
    propiedades.setProperties({ PRESUPUESTO_DIA: hoy, PRESUPUESTO_USADO: '0' });
    return true;
  }
  return Number(propiedades.getProperty('PRESUPUESTO_USADO') || 0) < TOPE_DIARIO_SEGUNDOS;
}

function anotarConsumo(segundos) {
  var propiedades = PropertiesService.getScriptProperties();
  var usado = Number(propiedades.getProperty('PRESUPUESTO_USADO') || 0);
  propiedades.setProperty('PRESUPUESTO_USADO', String(usado + segundos));
}

/** Atiende un aviso ya recibido: una pulsacion de boton o un texto. */
function atenderAviso(update) {
  var resumen = update.callback_query
    ? 'botón ' + update.callback_query.data
    : (update.message && update.message.text
      ? 'texto "' + update.message.text + '"'
      : 'otro tipo de aviso');

  if (update.update_id && avisoRepetido(update.update_id)) {
    anotarEnBitacora(update.update_id, resumen, 'descartado por repetido');
    return;
  }

  // El bot es de una sola persona. Cualquiera puede encontrarlo por su nombre y
  // escribirle, asi que todo lo que venga de otro chat se ignora.
  var chat = update.callback_query
    ? update.callback_query.message.chat.id
    : (update.message ? update.message.chat.id : null);
  if (String(chat) !== String(tgChatId())) {
    anotarEnBitacora(update.update_id, resumen, 'ignorado: viene de otro chat');
    return;
  }

  if (update.callback_query) {
    manejarBoton({
      id: update.callback_query.id,
      data: update.callback_query.data,
    });
  } else if (update.message && update.message.text) {
    manejarTexto(update.message.text.trim());
  }

  anotarEnBitacora(update.update_id, resumen, 'atendido');
}

/**
 * Devuelve true si este aviso de Telegram ya se atendio.
 *
 * Los update_id de Telegram son crecientes, asi que basta recordar el ultimo
 * atendido: cualquier numero igual o menor ya paso por aca.
 *
 * La version anterior guardaba cada id en la cache con una hora de vencimiento,
 * y eso creo un despertador. Telegram reintenta un aviso atascado
 * indefinidamente; durante una hora el filtro lo descartaba, la cache vencia, y
 * el siguiente reintento entraba como nuevo. Resultado: un mensaje repetido
 * cada 61 minutos, toda la noche. Una marca sin vencimiento no puede hacer eso.
 */
function avisoRepetido(updateId) {
  var propiedades = PropertiesService.getScriptProperties();
  var ultimo = Number(propiedades.getProperty('ULTIMO_UPDATE_ID') || 0);

  if (updateId <= ultimo) return true;

  propiedades.setProperty('ULTIMO_UPDATE_ID', String(updateId));
  return false;
}

/**
 * Bitacora de los ultimos avisos recibidos de Telegram.
 *
 * Existe porque hubo mensajes que no obtuvieron respuesta y no habia forma de
 * saber si habian llegado al script, si se habian descartado por repetidos, o
 * si se habian caido. Sin este registro solo quedaba especular.
 *
 * Se guarda en las propiedades del script y no en la planilla: escribir en
 * Sheets cuesta cerca de un segundo y eso es justo lo que no se quiere agregar
 * al camino rapido.
 */
var AVISOS_EN_BITACORA = 12;

// --- Instalacion -----------------------------------------------------------

/** Se corre una vez desde el editor, despues de poner TELEGRAM_TOKEN. */
function instalar() {
  var propiedades = PropertiesService.getScriptProperties();
  if (!propiedades.getProperty('TELEGRAM_TOKEN')) {
    throw new Error('Falta la propiedad TELEGRAM_TOKEN.');
  }

  if (!propiedades.getProperty('HOJA_ID')) {
    var libro = SpreadsheetApp.create('Finanzas');
    crearHoja(libro, HOJA_MOVIMIENTOS, COLUMNAS);
    crearHoja(libro, HOJA_APRENDIZAJE,
      ['comercio', 'categoria', 'subcategoria', 'confirmaciones', 'actualizado']);
    // La cuarta columna guarda un enlace al correo, nunca su contenido.
    crearHoja(libro, HOJA_NO_ENTENDIDOS, ['fecha', 'asunto', 'correoId', 'enlace']);
    libro.deleteSheet(libro.getSheetByName('Hoja 1') || libro.getSheets()[0]);
    propiedades.setProperty('HOJA_ID', libro.getId());
  }

  [ETIQUETA_PENDIENTE, ETIQUETA_PROCESADO].forEach(function (nombre) {
    if (!GmailApp.getUserLabelByName(nombre)) GmailApp.createLabel(nombre);
  });

  if (!propiedades.getProperty('WEBHOOK_SECRETO')) {
    propiedades.setProperty('WEBHOOK_SECRETO', Utilities.getUuid());
  }

  var existentes = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction();
  });
  if (existentes.indexOf('revisarCorreo') < 0) {
    ScriptApp.newTrigger('revisarCorreo').timeBased().everyMinutes(5).create();
  }
  if (existentes.indexOf('revisarTelegram') < 0) {
    ScriptApp.newTrigger('revisarTelegram').timeBased().everyMinutes(1).create();
  }
  if (existentes.indexOf('latidoDiario') < 0) {
    ScriptApp.newTrigger('latidoDiario').timeBased().atHour(20).everyDays(1).create();
  }
  if (existentes.indexOf('informeSemanalAutomatico') < 0) {
    ScriptApp.newTrigger('informeSemanalAutomatico').timeBased()
      .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(19).create();
  }
  // El dia 1 el mes recien empezado no tiene nada: se informa el que cerro.
  if (existentes.indexOf('informeMensualAutomatico') < 0) {
    ScriptApp.newTrigger('informeMensualAutomatico').timeBased()
      .onMonthDay(1).atHour(10).create();
  }
  if (!propiedades.getProperty('INSTALADO_EN')) {
    propiedades.setProperty('INSTALADO_EN', String(Date.now()));
  }

  tgRegistrarComandos();

  // Se reporta con reportar() y no con console.log por lo mismo que en
  // mostrarMiChatId: el registro de ejecucion cuesta encontrarlo y estos datos
  // hay que verlos si o si.
  // El chat id se responde con si o no, no con el numero. Aca solo hace falta
  // saber si el paso 7 ya se hizo, y este texto es de los que uno pega cuando
  // pide ayuda porque algo no anda. La direccion de la planilla si va entera:
  // es la unica forma de encontrarla la primera vez, porque los comandos del
  // bot todavia no funcionan en este punto de la instalacion.
  reportar([
    'Instalación lista.',
    '',
    'Tu planilla: ' + SpreadsheetApp.openById(propiedades.getProperty('HOJA_ID')).getUrl(),
    '  (esa dirección es tuya: guárdala, no la pegues por ahí)',
    'Etiquetas de Gmail: ' + ETIQUETA_PENDIENTE + ' y ' + ETIQUETA_PROCESADO,
    'Chat id guardado: ' +
      (propiedades.getProperty('TELEGRAM_CHAT_ID') ? 'sí' : 'FALTA (paso 7)'),
    '',
    'Activadores (leídos del proyecto, no una lista escrita a mano):',
  ].concat(ScriptApp.getProjectTriggers().map(function (t) {
    return '  ' + t.getHandlerFunction();
  })).concat([
    '',
    'Menú de comandos registrado en Telegram.',
  ]));
}

function crearHoja(libro, nombre, encabezados) {
  var h = libro.insertSheet(nombre);
  h.appendRow(encabezados);
  h.setFrozenRows(1);
  return h;
}

/**
 * Pasa el bot de webhook a consulta periodica. Se corre una sola vez.
 *
 * Desconecta la direccion publica, descarta los avisos que Telegram tenia
 * atascados, borra las propiedades que solo servian para el webhook, y deja
 * programada la consulta cada minuto.
 */
function usarConsultaPeriodica() {
  var propiedades = PropertiesService.getScriptProperties();

  var r = tgLlamar('deleteWebhook', { drop_pending_updates: true });

  ['WEBHOOK_SECRETO', 'WEBAPP_URL', 'ULTIMO_UPDATE_ID', 'TELEGRAM_OFFSET']
    .forEach(function (clave) { propiedades.deleteProperty(clave); });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'revisarTelegram') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('revisarTelegram').timeBased().everyMinutes(1).create();

  reportar([
    'Webhook desconectado: ok=' + r.ok + (r.description ? ' ' + r.description : ''),
    'Cola de Telegram vaciada.',
    'Activador creado: revisarTelegram cada 1 minuto.',
    '',
    'Ya no hace falta ninguna dirección pública.',
    'Puedes archivar la implementación de aplicación web:',
    'Implementar -> Administrar implementaciones -> Archivar.',
    '',
    'Escríbele algo al bot y responde en menos de un minuto.',
  ]);
}

