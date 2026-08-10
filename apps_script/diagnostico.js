/**
 * Funciones para revisar el sistema desde el editor de Apps Script.
 *
 * Ninguna corre sola: todas se ejecutan a mano cuando algo se ve raro. Viven
 * aparte para que principal.js quede solo con lo que de verdad hace funcionar
 * el sistema.
 *
 *   revisarSalud()           todo el estado en una pantalla
 *   verUltimosMovimientos()  que quedo escrito en la hoja
 *   mostrarMiChatId()        solo hace falta al instalar
 *   reanudar()               levanta el freno si el bot quedo mudo
 */

/**
 * Muestra el resultado como excepcion.
 *
 * Es deliberado y no es un error real: el registro de ejecucion queda en un
 * panel que cuesta encontrar, mientras que una excepcion aparece en un cuadro
 * rojo en medio del editor. Para funciones que se usan tres veces en la vida,
 * que el mensaje se vea le gana a la elegancia.
 */
function reportar(lineas) {
  var texto = lineas.join('\n');
  console.log(texto);
  throw new Error('\n\n===== RESULTADO (no es una falla) =====\n' + texto + '\n');
}

/**
 * Bitacora de los ultimos avisos recibidos de Telegram.
 *
 * Existe porque hubo mensajes que no obtuvieron respuesta y no habia forma de
 * saber si habian llegado al script, si se habian descartado por repetidos, o
 * si se habian caido. Sin este registro solo quedaba especular.
 *
 * Se guarda en las propiedades y no en la planilla: escribir en Sheets cuesta
 * cerca de un segundo y eso es justo lo que no conviene agregar al camino que
 * el usuario espera.
 */
var AVISOS_EN_BITACORA = 12;

function anotarEnBitacora(updateId, resumen, resultado) {
  try {
    var propiedades = PropertiesService.getScriptProperties();
    var previos = JSON.parse(propiedades.getProperty('BITACORA') || '[]');
    previos.push({
      cuando: new Date().toISOString().substring(11, 19),
      id: updateId,
      que: String(resumen).substring(0, 80),
      resultado: String(resultado).substring(0, 120),
    });
    propiedades.setProperty('BITACORA',
      JSON.stringify(previos.slice(-AVISOS_EN_BITACORA)));
  } catch (error) {
    console.error('bitacora: ' + error);
  }
}

/**
 * Todo el estado del sistema en una sola pantalla.
 *
 * Antes esto eran tres funciones separadas (propiedades, conexion, bitacora) y
 * habia que acordarse de cual correr segun el sintoma. Ver todo junto es mas
 * util, porque los problemas casi siempre se explican cruzando las tres cosas.
 */
function revisarSalud() {
  var propiedades = PropertiesService.getScriptProperties();
  var guardadas = propiedades.getProperties();
  var lineas = [];

  // --- Configuracion ---
  lineas.push('CONFIGURACIÓN');
  var secretas = { TELEGRAM_TOKEN: true };
  ['TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID', 'HOJA_ID'].forEach(function (clave) {
    var v = guardadas[clave];
    if (!v) {
      lineas.push('  FALTA: ' + clave);
    } else {
      lineas.push('  ' + clave + ' = ' +
        (secretas[clave] ? v.substring(0, 4) + '… (' + v.length + ' caracteres)' : v));
      if (v !== v.trim()) lineas.push('    OJO: tiene espacios sobrantes.');
    }
  });

  // --- Activadores ---
  lineas.push('');
  lineas.push('ACTIVADORES');
  var disparadores = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction();
  });
  ['revisarCorreo', 'revisarTelegram'].forEach(function (esperado) {
    lineas.push('  ' + esperado + ': ' +
      (disparadores.indexOf(esperado) >= 0 ? 'activo' : 'NO ESTÁ, corre instalar()'));
  });

  // --- Conexion con Telegram ---
  lineas.push('');
  lineas.push('TELEGRAM');
  var info = tgLlamar('getWebhookInfo', {});
  if (!info.ok) {
    lineas.push('  no responde: ' + info.description);
  } else {
    // Con consulta periodica no debe haber ninguna direccion conectada: los dos
    // modos son excluyentes y un webhook viejo se lleva todos los avisos.
    lineas.push('  webhook conectado: ' + (info.result.url ? 'SÍ, y no debería' : 'no'));
    lineas.push('  avisos en cola: ' + (info.result.pending_update_count || 0));
    if (info.result.last_error_message) {
      lineas.push('  último error: ' + info.result.last_error_message);
    }
  }

  // --- Freno y presupuesto ---
  lineas.push('');
  lineas.push('LÍMITES');
  var cuenta = Number(guardadas.FRENO_CUENTA || 0);
  lineas.push('  mensajes esta hora: ' + cuenta + ' de ' + tgTope() +
    (cuenta > tgTope() ? '  (FRENADO, escribe /reanudar)' : ''));
  lineas.push('  segundos de consulta rápida hoy: ' +
    (guardadas.PRESUPUESTO_USADO || 0) + ' de ' + TOPE_DIARIO_SEGUNDOS);

  // --- Datos ---
  lineas.push('');
  lineas.push('DATOS');
  var movimientos = hoja(HOJA_MOVIMIENTOS);
  var pendientes = contarSinClasificar();
  lineas.push('  movimientos guardados: ' + Math.max(0, movimientos.getLastRow() - 1));
  lineas.push('  sin categoría: ' + pendientes +
    (pendientes ? '  (usa /pendientes en el bot)' : ''));
  lineas.push('  comercios aprendidos: ' +
    Math.max(0, hoja(HOJA_APRENDIZAJE).getLastRow() - 1));
  lineas.push('  correos no entendidos: ' +
    Math.max(0, hoja(HOJA_NO_ENTENDIDOS).getLastRow() - 1));

  // --- Bitacora ---
  lineas.push('');
  lineas.push('ÚLTIMOS AVISOS (hora UTC)');
  var bitacora = JSON.parse(guardadas.BITACORA || '[]');
  if (!bitacora.length) {
    lineas.push('  ninguno. Si le escribiste al bot, no está llegando nada.');
  } else {
    bitacora.slice(-6).forEach(function (a) {
      lineas.push('  ' + a.cuando + '  ' + a.que);
      lineas.push('      -> ' + a.resultado);
    });
  }

  reportar(lineas);
}

/**
 * Muestra los ultimos movimientos tal como quedaron en la hoja.
 * Sirve para comprobar que lo que se ve en Telegram es lo que de verdad se
 * escribio, sin tener que abrir la planilla.
 */
function verUltimosMovimientos() {
  var h = hoja(HOJA_MOVIMIENTOS);
  if (h.getLastRow() < 2) reportar(['La hoja de movimientos está vacía.']);

  var cuantos = Math.min(8, h.getLastRow() - 1);
  var filas = h.getRange(h.getLastRow() - cuantos + 1, 1, cuantos, COLUMNAS.length)
    .getValues();

  var col = {};
  COLUMNAS.forEach(function (c, i) { col[c] = i; });

  var lineas = ['Últimos ' + cuantos + ' movimientos, del más nuevo al más viejo:', ''];
  filas.reverse().forEach(function (f) {
    lineas.push(formatearFecha(f[col.fechaHora]) + '   ' + f[col.comercio]);
    lineas.push('   ' + formatearMonto(f[col.monto], f[col.moneda]) +
      (f[col.moneda] !== 'CLP' && f[col.montoClp]
        ? ' = ' + formatearMonto(f[col.montoClp], 'CLP') : '') +
      '   [' + (f[col.estado] || 'sin estado') + ']');
    lineas.push('   ' + (f[col.categoria] || 'SIN CATEGORÍA') +
      (f[col.subcategoria] ? ' > ' + f[col.subcategoria] : ''));
    lineas.push('   nota: ' + (f[col.nota] || '(ninguna)'));
    lineas.push('');
  });
  reportar(lineas);
}

/**
 * Manda un mensaje al bot y corre esto para saber tu chat id.
 * Solo hace falta al instalar.
 */
function mostrarMiChatId() {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  if (!token) {
    reportar(['No hay ningún TELEGRAM_TOKEN guardado.',
      'Vuelve al paso 5 y acuérdate de apretar',
      '"Guardar propiedades de la secuencia de comandos".']);
  }

  var r = tgLlamar('getUpdates', {});
  if (!r.ok) {
    reportar(['Telegram rechazó la llamada: ' + r.description,
      String(r.description).indexOf('Not Found') >= 0
        ? '"Not Found" significa que el token está mal copiado.' : '']);
  }

  // Telegram tambien manda avisos sin conversacion (por ejemplo al apretar
  // Iniciar). Se busca hacia atras el primero que si traiga un chat.
  for (var i = r.result.length - 1; i >= 0; i--) {
    var u = r.result[i];
    var chat = (u.message && u.message.chat) ||
      (u.callback_query && u.callback_query.message.chat) ||
      (u.my_chat_member && u.my_chat_member.chat);
    if (chat) {
      reportar(['>>> TU CHAT ID ES: ' + chat.id + ' <<<',
        'Guárdalo en la propiedad TELEGRAM_CHAT_ID.']);
    }
  }

  reportar(['El token funciona, pero tu bot no ha recibido ningún mensaje.',
    'Abre el chat DE TU BOT, no el de BotFather.',
    'Aprieta Iniciar, mándale "hola", y vuelve a correr esto.']);
}

/**
 * Reescribe como fechas de verdad las que quedaron guardadas como texto.
 *
 * Se corre una sola vez. Las filas antiguas se escribieron antes de que
 * registrarMovimiento convirtiera el texto, asi que la columna quedo mezclada,
 * y una columna mezclada es peor que una toda de texto: las herramientas de
 * afuera no le aciertan el tipo y fallan de formas raras.
 */
function normalizarFechasDeLaHoja() {
  var h = hoja(HOJA_MOVIMIENTOS);
  if (h.getLastRow() < 2) reportar(['La hoja está vacía, no hay nada que convertir.']);

  var columna = COLUMNAS.indexOf('fechaHora') + 1;
  var rango = h.getRange(2, columna, h.getLastRow() - 1, 1);
  var valores = rango.getValues();

  var convertidas = 0;
  var yaEstaban = 0;
  var raras = [];

  var nuevos = valores.map(function (fila) {
    var v = fila[0];
    if (!v) return [''];
    if (typeof v.getMonth === 'function') {
      yaEstaban++;
      return [v];
    }
    var fecha = _comoFecha(v);
    if (typeof fecha.getMonth === 'function') {
      convertidas++;
      return [fecha];
    }
    raras.push(String(v));
    return [v];
  });

  rango.setValues(nuevos);

  var lineas = [
    convertidas + ' fechas convertidas de texto a fecha real.',
    yaEstaban + ' ya estaban bien.',
  ];
  if (raras.length) {
    lineas.push('');
    lineas.push('No pude convertir ' + raras.length + ':');
    raras.slice(0, 5).forEach(function (r) { lineas.push('  ' + r); });
  }
  lineas.push('');
  lineas.push('En Looker Studio: Recurso -> Gestionar fuentes de datos ->');
  lineas.push('Editar -> Actualizar campos. fechaHora debería quedar como fecha.');
  reportar(lineas);
}

/**
 * Registra en Telegram la lista de comandos del menu.
 *
 * Existe suelta para no tener que correr instalar() entero cada vez que cambia
 * un comando. Telegram guarda la lista en el telefono, asi que despues de
 * correrla conviene cerrar y volver a abrir el chat.
 */
function actualizarMenu() {
  var r = tgRegistrarComandos();
  reportar([
    r.ok ? 'Menú actualizado en Telegram.' : 'Falló: ' + r.description,
    '',
    'Comandos registrados:',
  ].concat(COMANDOS.map(function (c) {
    return '  /' + c.command + '  ' + c.description;
  })).concat([
    '',
    'Si en el teléfono sigues viendo el menú viejo, cierra el chat del bot y',
    'vuelve a abrirlo: Telegram guarda la lista y tarda en refrescarla.',
  ]));
}

/**
 * Levanta el freno de emergencia desde el editor.
 * Sirve si el bot quedo mudo y por alguna razon tampoco responde a /reanudar.
 */
function reanudar() {
  tgReanudar();
  reportar(['Freno levantado. El bot vuelve a mandar mensajes.']);
}
