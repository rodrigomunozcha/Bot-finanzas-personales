/**
 * Capa de Telegram: envio de mensajes, teclados y formato.
 *
 * Sobre los callback_data: Telegram los limita a 64 bytes. Los nombres de
 * categoria llevan emoji, y un emoji ocupa cuatro bytes, asi que mandar
 * "🍴 Alimentación" dentro del boton se pasaria del limite en cuanto se le sume
 * el identificador del movimiento. Por eso los botones viajan con indices
 * numericos y el nombre se resuelve al recibirlos.
 */

var TG_API = 'https://api.telegram.org/bot';

function tgToken() {
  return PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
}

function tgChatId() {
  return PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
}

function tgLlamar(metodo, cuerpo) {
  var respuesta = UrlFetchApp.fetch(TG_API + tgToken() + '/' + metodo, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(cuerpo),
    muteHttpExceptions: true,
  });
  var datos = JSON.parse(respuesta.getContentText());
  if (!datos.ok) {
    console.error('Telegram ' + metodo + ': ' + datos.description);
  }
  return datos;
}


// --- Menu de comandos ------------------------------------------------------

/**
 * Los comandos que Telegram muestra en el menu.
 *
 * Sin esto hay que acordarse de memoria de que existe /pendientes o /olvidar, y
 * un comando que no se recuerda no existe. Registrandolos, al escribir "/" en
 * el chat aparece la lista con su descripcion, y ademas Telegram pone un boton
 * de menu al lado del campo de texto.
 *
 * Se registra una sola vez, desde instalar().
 */
var COMANDOS = [
  { command: 'saldo', description: '🏦 Cuánta plata me queda en la cuenta' },
  { command: 'ingreso', description: '💰 Anotar plata que me entró' },
  { command: 'semana', description: '📊 Cuánto gasté en los últimos 7 días' },
  { command: 'mes', description: '📊 Cuánto llevo gastado este mes' },
  { command: 'efectivo', description: '💵 Cuánto efectivo me queda sin anotar' },
  { command: 'ultimos', description: '✏️ Ver y corregir mis últimos gastos' },
  { command: 'pendientes', description: '⚠️ Qué me falta clasificar' },
  { command: 'datos', description: '📁 Abrir mi planilla y respaldarla' },
  { command: 'ayuda', description: '❓ Cómo anotar un gasto y qué más puedo hacer' },
];

function tgRegistrarComandos() {
  return tgLlamar('setMyCommands', { commands: COMANDOS });
}

// --- Freno de emergencia ---------------------------------------------------

/**
 * Tope de mensajes nuevos por hora.
 *
 * Existe porque ya pasó: una falla mía dejó al bot mandando el mismo mensaje
 * cada 61 minutos durante toda una noche. Ninguna cantidad de pruebas garantiza
 * que no vuelva a haber un error no previsto, pero un tope duro garantiza que
 * el daño sea un puñado de mensajes y no cien.
 *
 * Se cuentan solo los mensajes nuevos. Editar uno existente no genera
 * notificación en el teléfono, así que no molesta ni necesita límite.
 */
var TOPE_MENSAJES_POR_HORA = 25;
var VENTANA_FRENO_MS = 3600000;

function tgTope() {
  var configurado = Number(
    PropertiesService.getScriptProperties().getProperty('TOPE_MENSAJES_POR_HORA')
  );
  return configurado > 0 ? configurado : TOPE_MENSAJES_POR_HORA;
}

/**
 * Registra un mensaje y dice en qué estado quedó el freno.
 *   'libre'     se puede enviar
 *   'ultimo'    este es el aviso de que se acabó la cuota, se envía igual
 *   'frenado'   silencio hasta que pase la hora o el usuario lo reanude
 */
function tgEstadoFreno() {
  var propiedades = PropertiesService.getScriptProperties();
  var ahora = Date.now();
  var inicio = Number(propiedades.getProperty('FRENO_INICIO') || 0);
  var cuenta = Number(propiedades.getProperty('FRENO_CUENTA') || 0);

  if (!inicio || ahora - inicio > VENTANA_FRENO_MS) {
    inicio = ahora;
    cuenta = 0;
  }
  cuenta++;
  propiedades.setProperties({
    FRENO_INICIO: String(inicio),
    FRENO_CUENTA: String(cuenta),
  });

  var tope = tgTope();
  if (cuenta <= tope) return 'libre';
  if (cuenta === tope + 1) return 'ultimo';
  return 'frenado';
}

/** Levanta el freno y vuelve a permitir mensajes de inmediato. */
function tgReanudar() {
  PropertiesService.getScriptProperties().setProperties({
    FRENO_INICIO: String(Date.now()),
    FRENO_CUENTA: '0',
  });
}

function tgEnviar(texto, teclado) {
  var estado = tgEstadoFreno();

  if (estado === 'frenado') {
    // Silencio deliberado. El mensaje se pierde, y eso es preferible a
    // seguir alimentando lo que sea que esté fallando.
    console.error('Freno activo, mensaje no enviado: ' + String(texto).substring(0, 120));
    return null;
  }

  if (estado === 'ultimo') {
    // El aviso dice las tres cosas que el usuario necesita: que se detuvo, que
    // sigue funcionando y que no, y que puede hacer al respecto. Un "me callo,
    // escribe /reanudar para que siga" no aclara que es lo que seguiria.
    texto = '🛑 <b>Dejé de mandarte mensajes</b>\n\n' +
      'Iba a enviarte más de ' + tgTope() + ' mensajes en una hora. ' +
      'Eso no es normal, así que lo más probable es que algo esté fallando.\n\n' +
      '<b>Qué sigue pasando:</b>\n' +
      '· Tus compras se siguen leyendo del correo y guardando en la hoja\n' +
      '· No se pierde ningún gasto\n\n' +
      '<b>Qué no va a pasar:</b>\n' +
      '· No te voy a avisar de las compras nuevas durante una hora\n' +
      '· Las que lleguen en ese rato quedan sin categoría, porque no vas a ' +
      'recibir la pregunta\n\n' +
      'Escribe <code>/reanudar</code> para que vuelva a avisarte de tus gastos ' +
      'ahora mismo, sin esperar la hora.';
    teclado = null;
  }

  var cuerpo = { chat_id: tgChatId(), text: texto, parse_mode: 'HTML' };
  if (teclado) cuerpo.reply_markup = { inline_keyboard: teclado };
  var r = tgLlamar('sendMessage', cuerpo);
  return r.ok ? r.result.message_id : null;
}

/**
 * Reemplaza el mensaje en el mismo lugar del chat en vez de mandar uno nuevo.
 * Es lo que hace que responder no llene la conversacion de mensajes sueltos:
 * la pregunta se transforma en la respuesta.
 */
function tgEditar(messageId, texto, teclado) {
  var cuerpo = {
    chat_id: tgChatId(), message_id: messageId, text: texto, parse_mode: 'HTML',
  };
  cuerpo.reply_markup = { inline_keyboard: teclado || [] };
  return tgLlamar('editMessageText', cuerpo);
}

/**
 * Telegram deja el boton con un reloj girando hasta que se le avisa que la
 * pulsacion llego. Sin esto la interfaz se ve colgada aunque todo haya salido
 * bien.
 */
function tgConfirmarBoton(callbackQueryId, aviso) {
  return tgLlamar('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: aviso || '',
  });
}

// --- Formato ---------------------------------------------------------------

/** El HTML de Telegram se rompe con estos tres caracteres en el texto. */
function tgEscapar(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 12500 -> "$12.500"   49 USD -> "US$49,00" */
function formatearMonto(monto, moneda) {
  if (moneda === 'CLP' || !moneda) {
    return '$' + Math.round(monto).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  var simbolo = moneda === 'USD' ? 'US$' : '€';
  return simbolo + monto.toFixed(2).replace('.', ',');
}

var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
var MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * "2026-08-01T13:20" -> "vie 1 ago 13:20"
 *
 * Acepta tambien un objeto Date, porque Google Sheets convierte por su cuenta
 * el texto con forma de fecha al guardarlo, y al leerlo de vuelta ya no llega
 * como cadena. Suponer solo texto producia "undefined NaN undefined".
 */
function formatearFecha(valor) {
  if (!valor) return '';

  var anio, mes, dia, hora = '';

  if (valor && typeof valor.getMonth === 'function') {
    if (isNaN(valor.getTime())) return '';
    anio = valor.getFullYear();
    mes = valor.getMonth() + 1;
    dia = valor.getDate();
    // Medianoche exacta se toma como fecha sin hora: es lo que queda cuando el
    // dato original no traia hora, por ejemplo en las transferencias.
    if (valor.getHours() || valor.getMinutes()) {
      hora = dos(valor.getHours()) + ':' + dos(valor.getMinutes());
    }
  } else {
    var t = String(valor);

    // La cache guarda las fechas como texto ISO en UTC ("...T18:49:00.000Z").
    // Leerlo como hora local corre el reloj: una compra de las 14:49 en Chile
    // se mostraba como 18:49. Si el texto trae zona horaria hay que convertirlo
    // de verdad, no partirlo por la letra T.
    if (/Z$|[+-]\d{2}:\d{2}$/.test(t)) return formatearFecha(new Date(t));

    var p = t.split('T');
    var f = p[0].split('-');
    if (f.length !== 3) return '';
    anio = Number(f[0]);
    mes = Number(f[1]);
    dia = Number(f[2]);
    if (isNaN(anio) || isNaN(mes) || isNaN(dia)) return '';
    hora = p[1] ? p[1].substring(0, 5) : '';   // sin segundos ni milisegundos
  }

  var d = new Date(anio, mes - 1, dia);
  var texto = DIAS[d.getDay()] + ' ' + dia + ' ' + MESES_CORTOS[mes - 1];
  return hora ? texto + ' ' + hora : texto;
}

function dos(n) {
  return (n < 10 ? '0' : '') + n;
}

/** "🍴 Alimentación" + "🛒 Supermercado" -> "🍴 Alimentación › 🛒 Supermercado" */
function rutaCategoria(categoria, subcategoria) {
  return subcategoria ? categoria + ' › ' + subcategoria : categoria;
}

// --- Teclados --------------------------------------------------------------

/** Dos columnas: entran los nombres largos sin cortarse en pantalla de telefono. */
function enFilas(botones, porFila) {
  var filas = [];
  for (var i = 0; i < botones.length; i += porFila) {
    filas.push(botones.slice(i, i + porFila));
  }
  return filas;
}

function tecladoCategorias(txId, arbol) {
  var botones = arbol.map(function (c, i) {
    return { text: c.nombre, callback_data: 'cat:' + txId + ':' + i };
  });
  return enFilas(botones, 2);
}

function tecladoSubcategorias(txId, arbol, indiceCategoria) {
  var categoria = arbol[indiceCategoria];
  var botones = categoria.subcategorias.map(function (s, j) {
    return { text: s, callback_data: 'sub:' + txId + ':' + indiceCategoria + ':' + j };
  });
  var filas = enFilas(botones, 2);
  // Salida siempre disponible: no toda compra necesita subcategoria, y obligar
  // a elegir una seria justo la friccion que hace abandonar estos sistemas.
  filas.push([{
    text: '✓ Guardar sin subcategoría',
    callback_data: 'solo:' + txId + ':' + indiceCategoria,
  }]);
  return filas;
}

function tecladoConfirmar(txId) {
  return [[
    { text: '✓ Sí, guardar así', callback_data: 'ok:' + txId },
    { text: '✏️ Cambiar categoría', callback_data: 'edit:' + txId },
  ]];
}

/**
 * Teclado del movimiento ya guardado.
 *
 * Las etiquetas dicen la accion y su objeto, no solo el verbo: "Nota" no deja
 * claro si muestra o agrega, y "Terminar" no deja claro que es lo que termina.
 */
function tecladoCerrado(txId) {
  return [
    [
      { text: '📝 Agregar nota', callback_data: 'nota:' + txId },
      { text: '✏️ Cambiar categoría', callback_data: 'edit:' + txId },
    ],
    [{ text: '✓ Listo, quitar botones', callback_data: 'fin:' + txId }],
  ];
}

function tecladoEntrada(txId) {
  return [[
    { text: '💰 Es un ingreso', callback_data: 'ing:' + txId },
    { text: '🔄 Es un reembolso', callback_data: 'reem:' + txId },
  ]];
}

if (typeof module !== 'undefined') {
  module.exports = {
    tgEscapar, formatearMonto, formatearFecha, rutaCategoria, enFilas,
    tecladoCategorias, tecladoSubcategorias, tecladoConfirmar, tecladoCerrado,
    tecladoEntrada,
  };
}
