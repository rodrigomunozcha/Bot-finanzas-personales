/**
 * La conversacion con el bot.
 *
 * Cada movimiento avanza por estados, y en cada uno hay un mensaje en Telegram
 * esperando respuesta. Los botones editan ese mismo mensaje en vez de mandar
 * uno nuevo, asi que el chat queda como un registro limpio de gastos cerrados y
 * no como una pila de preguntas viejas.
 *
 * Cuanto se pregunta depende de lo que el sistema ya sepa del comercio:
 *   desconocido  -> lista completa de categorias
 *   propuesto    -> un toque para confirmar
 *   3 confirmado -> no pregunta nada, solo avisa
 */

function arbolDe(tipo) {
  return tipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS_GASTO;
}

/** Encabezado comun: comercio, monto y cuando. */
function encabezado(mov) {
  var lineas = [];

  if (mov.tipo === 'entrada' || mov.tipo === 'ingreso') {
    lineas.push('💸 <b>Transferencia recibida</b>');
    lineas.push(formatearMonto(mov.monto, mov.moneda) +
      (mov.remitente ? ' de ' + tgEscapar(mov.remitente) : ''));
    if (mov.nota) lineas.push('<i>' + tgEscapar(mov.nota) + '</i>');
  } else {
    lineas.push('<b>' + tgEscapar(mov.comercio) + '</b>');
    var detalle = formatearMonto(mov.monto, mov.moneda);
    if (mov.medioPago) detalle += ' · ' + mov.medioPago;
    if (mov.fechaHora) detalle += ' · ' + formatearFecha(mov.fechaHora);
    lineas.push(detalle);
  }

  if (mov.moneda && mov.moneda !== 'CLP') {
    lineas.push('<i>en pesos: pendiente hasta que pagues la tarjeta</i>');
  }
  return lineas.join('\n');
}

/**
 * Anuncia un gasto recien leido y abre la conversacion que corresponda.
 * Devuelve el id del movimiento registrado.
 */
function anunciarGasto(lectura, correoId) {
  var propuesta = proponerClasificacion(lectura.comercio, cargarAprendizaje());

  // El identificador se genera antes de escribir nada. Asi los botones ya lo
  // llevan, el mensaje se manda primero, y la fila se agrega una sola vez con
  // todo adentro. Antes se guardaba la fila, se mandaba el mensaje, y despues
  // habia que buscar la fila de nuevo para anotarle el numero de mensaje.
  var id = nuevoId();
  var mov = {
    id: id,
    fechaHora: lectura.fechaHora,
    tipo: 'gasto',
    comercio: lectura.comercio,
    monto: lectura.monto,
    moneda: lectura.moneda,
    montoClp: lectura.montoClp,
    medioPago: lectura.medioPago,
    correoId: correoId,
  };

  var texto, teclado;

  if (propuesta && propuesta.automatico) {
    mov.categoria = propuesta.categoria;
    mov.subcategoria = propuesta.subcategoria;
    mov.estado = ESTADOS.CERRADO;
    texto = '✅ ' + encabezado(mov) + '\n' +
      rutaCategoria(propuesta.categoria, propuesta.subcategoria);
    teclado = tecladoCerrado(id);
  } else if (propuesta) {
    // Se guarda la propuesta en las columnas de categoria aunque no este
    // confirmada. Si el usuario aprieta "Correcto" no hay nada que recalcular,
    // y si nunca responde, queda igual un dato razonable en vez de un vacio.
    mov.categoria = propuesta.categoria;
    mov.subcategoria = propuesta.subcategoria;
    mov.estado = ESTADOS.ESPERANDO_CATEGORIA;
    texto = encabezado(mov) + '\n\n' +
      rutaCategoria(propuesta.categoria, propuesta.subcategoria) + '?';
    teclado = tecladoConfirmar(id);
  } else {
    mov.estado = ESTADOS.ESPERANDO_CATEGORIA;
    texto = encabezado(mov) + '\n\n¿Qué categoría?';
    teclado = tecladoCategorias(id, CATEGORIAS_GASTO);
  }

  mov.mensajeId = tgEnviar(texto, teclado);
  registrarMovimiento(mov);
  return id;
}

/** Anuncia una transferencia recibida. Primero hay que saber si es ingreso. */
function anunciarEntrada(lectura, correoId) {
  var id = nuevoId();
  var mov = {
    id: id,
    fechaHora: lectura.fechaHora,
    tipo: 'entrada',
    comercio: lectura.remitente || 'Transferencia',
    monto: lectura.monto,
    moneda: lectura.moneda,
    montoClp: lectura.montoClp,
    medioPago: 'transferencia',
    nota: lectura.glosa,
    estado: ESTADOS.ESPERANDO_TIPO_ENTRADA,
    correoId: correoId,
  };
  mov.remitente = lectura.remitente;

  mov.mensajeId = tgEnviar(
    encabezado(mov) + '\n\n¿Es plata que ganaste, o te están devolviendo algo?',
    tecladoEntrada(id)
  );
  // remitente no es columna de la hoja: solo sirve para redactar el mensaje.
  delete mov.remitente;
  registrarMovimiento(mov);
  return id;
}

/**
 * Cerrar un gasto se parte en dos, y el orden importa para la velocidad.
 *
 * Primero se calcula todo lo necesario para redactar la respuesta, que sale de
 * la cache y no cuesta nada. Con eso se edita el mensaje y el usuario ya ve el
 * resultado. Recien despues se escribe en la planilla, que es lo lento.
 *
 * Antes se escribia primero y se respondia despues, asi que la espera del
 * usuario incluia toda la escritura.
 */

/** Calcula como quedaria el aprendizaje, sin escribir nada todavia. */
function calcularCierre(mov, categoria, subcategoria) {
  // Solo los gastos alimentan el aprendizaje por comercio. Un ingreso viene de
  // una persona, no de un comercio que se repita con la misma categoria.
  if (mov.tipo !== 'gasto' || !mov.comercio) return null;
  return registrarRespuesta(cargarAprendizaje(), mov.comercio, categoria, subcategoria);
}

/** Escribe el cierre en la planilla. Se llama despues de haber respondido. */
function persistirCierre(mov, categoria, subcategoria, registro) {
  mov.categoria = categoria;
  mov.subcategoria = subcategoria || '';
  mov.estado = ESTADOS.CERRADO;
  guardarMovimiento(mov);
  if (registro) guardarAprendizaje(registro);
}

/** Texto del mensaje ya cerrado, con el aviso de aprendizaje si corresponde. */
function textoCerrado(mov, categoria, subcategoria, registro) {
  var texto = '✅ ' + encabezado(mov) + '\n' + rutaCategoria(categoria, subcategoria);

  if (registro) {
    var faltan = faltanParaAutomatico(registro.confirmaciones);
    if (faltan === 0) {
      texto += '\n<i>Aprendido: las próximas compras en este comercio las ' +
        'clasifico solo, sin preguntarte.</i>';
    } else {
      texto += '\n<i>Si eliges lo mismo ' + faltan +
        (faltan === 1 ? ' vez más' : ' veces más') +
        ', empiezo a clasificar este comercio solo.</i>';
    }
  }
  return texto;
}

/**
 * Procesa la pulsacion de un boton.
 * El callback_data viene como "accion:idMovimiento:argumentos".
 */
function manejarBoton(callback) {
  var partes = String(callback.data).split(':');
  var accion = partes[0];
  var id = partes[1];

  // Lo primero de todo, antes de tocar la hoja de calculo. Telegram deja el
  // boton con el reloj girando hasta recibir esta confirmacion, y si se manda
  // al final el telefono se ve congelado durante todo el trabajo. Asi la
  // interfaz responde de inmediato aunque el resto tome un segundo mas.
  tgConfirmarBoton(callback.id);

  var mov = obtenerMovimiento(id);
  if (!mov) {
    tgEnviar('No encuentro ese gasto en la hoja. Puede que lo hayas borrado a mano.');
    return;
  }
  var arbol = arbolDe(mov.tipo);

  if (accion === 'fin') {
    tgEditar(mov.mensajeId,
      '✅ ' + encabezado(mov) + '\n' + rutaCategoria(mov.categoria, mov.subcategoria) +
      (mov.nota ? '\n📝 ' + tgEscapar(mov.nota) : ''), []);
    return;
  }

  if (accion === 'ok') {
    var reg = calcularCierre(mov, mov.categoria, mov.subcategoria);
    tgEditar(mov.mensajeId,
      textoCerrado(mov, mov.categoria, mov.subcategoria, reg),
      tecladoCerrado(id));
    persistirCierre(mov, mov.categoria, mov.subcategoria, reg);
    return;
  }

  if (accion === 'edit') {
    tgEditar(mov.mensajeId, encabezado(mov) + '\n\n¿Qué categoría?',
      tecladoCategorias(id, arbol));
    return;
  }

  if (accion === 'cat') {
    var i = Number(partes[2]);
    var categoria = arbol[i];
    // Sin subcategorias no hay nada que preguntar: se cierra de una.
    if (!categoria.subcategorias.length) {
      var regC = calcularCierre(mov, categoria.nombre, null);
      tgEditar(mov.mensajeId, textoCerrado(mov, categoria.nombre, null, regC),
        tecladoCerrado(id));
      persistirCierre(mov, categoria.nombre, null, regC);
      return;
    }
    mov.categoria = categoria.nombre;
    mov.estado = ESTADOS.ESPERANDO_SUBCATEGORIA;
    guardarMovimiento(mov);
    tgEditar(mov.mensajeId,
      encabezado(mov) + '\n\n' + categoria.nombre + '\n¿Cuál?',
      tecladoSubcategorias(id, arbol, i));
    return;
  }

  if (accion === 'sub' || accion === 'solo') {
    var iCat = Number(partes[2]);
    var nombreCat = arbol[iCat].nombre;
    var nombreSub = accion === 'sub' ? arbol[iCat].subcategorias[Number(partes[3])] : null;

    var regS = calcularCierre(mov, nombreCat, nombreSub);
    tgEditar(mov.mensajeId, textoCerrado(mov, nombreCat, nombreSub, regS),
      tecladoCerrado(id));
    persistirCierre(mov, nombreCat, nombreSub, regS);
    return;
  }

  if (accion === 'nota') {
    // Se guarda tambien el momento: sin eso el bot quedaba esperando la nota
    // para siempre y se comia cualquier texto que se le escribiera dias despues.
    PropertiesService.getScriptProperties()
      .setProperty('NOTA_PARA', id + '|' + Date.now());
    tgEnviar('📝 Escribe ahora la nota para <b>' + tgEscapar(mov.comercio) + '</b>.\n'
      + 'Tu próximo mensaje se guarda como nota de ese gasto. '
      + 'Si no escribes nada en ' + Math.round(VENTANA_NOTA_MS / 60000)
      + ' minutos, se cancela sola y vuelvo a entender comandos normales.');
    return;
  }

  if (accion === 'ing') {
    actualizarMovimiento(id, { tipo: 'ingreso', estado: ESTADOS.ESPERANDO_CATEGORIA });
    mov.tipo = 'ingreso';
    tgEditar(mov.mensajeId, encabezado(mov) + '\n\n¿Qué tipo de ingreso?',
      tecladoCategorias(id, CATEGORIAS_INGRESO));
    return;
  }

  if (accion === 'reem') {
    // Un reembolso no es ingreso: te devolvieron plata que ya habias puesto.
    // Contarlo como ingreso inflaria tus entradas del mes.
    actualizarMovimiento(id, { tipo: 'reembolso', estado: ESTADOS.REEMBOLSO });
    tgEditar(mov.mensajeId,
      '🔄 ' + encabezado(mov) + '\n<i>Reembolso. No cuenta como ingreso.</i>', []);
    return;
  }

  // Puede pasar si queda un mensaje viejo en el chat con botones de una version
  // anterior del codigo. Mejor decirlo que no hacer nada.
  tgEnviar('Ese botón es de una versión anterior del bot y ya no funciona. '
      + 'Los mensajes nuevos sí van a responder.');
}

/**
 * Separa un mensaje en comando y resto.
 *
 * Es deliberadamente tolerante. Telegram puede entregar el comando con el
 * nombre del bot pegado ("/olvidar@mis_gastos_bot"), con mayusculas, o con
 * espacios invisibles que deja el autocompletado del teclado. Comparar el
 * texto crudo contra "/olvidar" falla en todos esos casos sin decir por que.
 */
function comando(texto) {
  // Escritos como escapes y no como los caracteres mismos: un invisible literal
  // en el codigo es imposible de revisar, y cualquier herramienta que reescriba
  // el archivo puede alterarlo sin que se note.
  var limpio = String(texto)
    .replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ')
    .trim();
  var m = /^\/\s*([a-záéíóúüñ_]+)(?:@\S+)?\s*([\s\S]*)$/i.exec(limpio);
  if (!m) return null;
  return { nombre: m[1].toLowerCase(), resto: m[2].trim() };
}


/** Cuanto tiempo se espera la nota antes de cancelarla sola. */
var VENTANA_NOTA_MS = 600000;   // 10 minutos

/**
 * Devuelve el id del gasto que espera nota, o null si no hay o ya caduco.
 *
 * La caducidad no es un detalle: sin ella, apretar "Agregar nota" y no escribir
 * dejaba al bot esperando indefinidamente, y el siguiente texto que se le
 * mandara, aunque fuera al dia siguiente, terminaba guardado como nota.
 */
function notaPendiente(propiedades) {
  var guardado = propiedades.getProperty('NOTA_PARA');
  if (!guardado) return null;

  var partes = String(guardado).split('|');
  var cuando = Number(partes[1] || 0);

  if (!cuando || Date.now() - cuando > VENTANA_NOTA_MS) {
    propiedades.deleteProperty('NOTA_PARA');
    return null;
  }
  return partes[0];
}


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
  var esEfectivo = /efectivo/i.test(resto);
  var descripcion = resto.replace(/efectivo/ig, '').replace(/\s{2,}/g, ' ').trim();

  return {
    monto: monto,
    medioPago: esEfectivo ? 'efectivo' : 'a mano',
    descripcion: descripcion,
  };
}

/** Registra el gasto escrito y abre la conversacion para clasificarlo. */
function registrarGastoEscrito(datos) {
  var comercio = datos.descripcion || (datos.medioPago === 'efectivo'
    ? 'Efectivo' : 'Gasto a mano');

  var ahora = new Date();
  var id = nuevoId();
  var mov = {
    id: id,
    fechaHora: ahora.getFullYear() + '-' + dos(ahora.getMonth() + 1) + '-' +
      dos(ahora.getDate()) + 'T' + dos(ahora.getHours()) + ':' + dos(ahora.getMinutes()),
    tipo: 'gasto',
    comercio: comercio,
    monto: datos.monto,
    moneda: 'CLP',
    montoClp: datos.monto,
    medioPago: datos.medioPago,
    estado: ESTADOS.ESPERANDO_CATEGORIA,
    correoId: '',
  };

  // Un gasto a mano tambien aprende: si siempre anotas "micro" como Transporte,
  // a la tercera deja de preguntarte igual que con los comercios del banco.
  var propuesta = proponerClasificacion(comercio, cargarAprendizaje());
  var texto, teclado;

  if (propuesta && propuesta.automatico) {
    mov.categoria = propuesta.categoria;
    mov.subcategoria = propuesta.subcategoria;
    mov.estado = ESTADOS.CERRADO;
    texto = '✅ ' + encabezado(mov) + '\n' +
      rutaCategoria(propuesta.categoria, propuesta.subcategoria);
    teclado = tecladoCerrado(id);
  } else if (propuesta) {
    mov.categoria = propuesta.categoria;
    mov.subcategoria = propuesta.subcategoria;
    texto = encabezado(mov) + '\n\n' +
      rutaCategoria(propuesta.categoria, propuesta.subcategoria) + '?';
    teclado = tecladoConfirmar(id);
  } else {
    texto = encabezado(mov) + '\n\n¿Qué categoría?';
    teclado = tecladoCategorias(id, CATEGORIAS_GASTO);
  }

  mov.mensajeId = tgEnviar(texto, teclado);
  registrarMovimiento(mov);
  marcarConversacion();
  return id;
}

/** Procesa un mensaje de texto: notas, comandos y ayuda. */
function manejarTexto(texto) {
  var propiedades = PropertiesService.getScriptProperties();
  var esperandoNota = notaPendiente(propiedades);

  if (esperandoNota) {
    propiedades.deleteProperty('NOTA_PARA');

    var mov = obtenerMovimiento(esperandoNota);
    if (mov) {
      mov.nota = texto;
      guardarMovimiento(mov);
    }

    // Se actualiza el mensaje del gasto para que la nota quede donde
    // corresponde, PERO ademas se manda una respuesta nueva. Editar un mensaje
    // no genera notificacion y queda mas arriba en el chat: desde el telefono
    // se ve como si escribir la nota no hubiera hecho nada.
    if (mov && mov.mensajeId) {
      tgEditar(mov.mensajeId,
        '✅ ' + encabezado(mov) + '\n' + rutaCategoria(mov.categoria, mov.subcategoria) +
        '\n📝 ' + tgEscapar(texto),
        tecladoCerrado(esperandoNota));
    }

    tgEnviar(mov
      ? '📝 Nota guardada en <b>' + tgEscapar(mov.comercio) + '</b>:\n' + tgEscapar(texto)
      : '📝 Nota guardada, pero no encontré el gasto para mostrarla.');
    return;
  }

  var cmd = comando(texto);

  if (cmd && cmd.nombre === 'reanudar') {
    // Se levanta el freno antes de responder: si no, la propia respuesta
    // quedaria bloqueada por el freno que se acaba de pedir levantar.
    tgReanudar();
    tgEnviar('▶️ Freno levantado. Vuelvo a avisarte cuando llegue una compra nueva.');
    return;
  }

  // Gasto escrito a mano: "12000 efectivo almuerzo". Se da por hecho que es un
  // gasto, porque es lo unico que uno anota a mano: los ingresos y las
  // transferencias llegan por correo.
  var aMano = leerGastoEscrito(texto);
  if (aMano) return registrarGastoEscrito(aMano);

  if (cmd && cmd.nombre === 'semana') return informeSemana();
  if (cmd && cmd.nombre === 'mes') return informeMes();

  if (cmd && cmd.nombre === 'gasto') {
    tgEnviar('Para anotar un gasto escríbeme el monto y en qué fue.\n\n' +
      'Por ejemplo:\n' +
      '<code>12000 efectivo almuerzo</code>\n' +
      '<code>3500 efectivo micro</code>\n\n' +
      'La palabra <b>efectivo</b> marca que fue en efectivo. Si no la pones, ' +
      'igual se anota y después eliges la categoría con los botones.');
    return;
  }

  if (cmd && cmd.nombre === 'respaldado') {
    PropertiesService.getScriptProperties()
      .setProperty('ULTIMO_RESPALDO', String(Date.now()));
    tgEnviar('💾 Anotado. Dejo de recordarte el respaldo por una semana.');
    return;
  }

  if (cmd && cmd.nombre === 'olvidar') {
    if (!cmd.resto) {
      tgEnviar('Falta el nombre del comercio. Escribe por ejemplo '
        + '<code>/olvidar JUMBO CENTRAL</code> y borro lo que aprendí de ese '
        + 'comercio, para que la próxima compra te la pregunte de nuevo.');
      return;
    }
    var normalizado = normalizarComercio(cmd.resto);
    if (borrarAprendizaje(normalizado)) {
      tgEnviar('Olvidé lo que sabía de <b>' + tgEscapar(normalizado) +
        '</b>. La próxima compra ahí te la vuelvo a preguntar desde cero.');
    } else {
      tgEnviar('No tenía nada aprendido de <b>' + tgEscapar(normalizado) + '</b>, '
        + 'así que no había nada que borrar. Revisa que el nombre esté igual '
        + 'que en el mensaje del gasto.');
    }
    return;
  }

  if (cmd && cmd.nombre === 'pendientes') {
    var bloques = [];

    // Gastos que nunca se clasificaron. Son los que en silencio dejan los
    // informes incompletos, asi que van primero.
    var sinClasificar = movimientosSinClasificar();
    if (sinClasificar.length) {
      bloques.push('<b>Sin categoría (' + sinClasificar.length + ')</b>\n' +
        sinClasificar.slice(-10).map(function (m) {
          return '· ' + formatearMonto(m.monto, m.moneda) + ' en ' +
            tgEscapar(m.comercio) + ' (' + formatearFecha(m.fechaHora) + ')';
        }).join('\n') +
        '\n<i>Búscalos en el chat y responde sus botones.</i>');
    }

    var enDolares = comprasPendientesConversion();
    if (enDolares.length) {
      bloques.push('<b>Esperando el pago de la tarjeta (' + enDolares.length + ')</b>\n' +
        enDolares.map(function (p) {
          return '· ' + formatearMonto(p.monto, p.moneda) + ' en ' +
            tgEscapar(p.comercio) + ' (' + formatearFecha(p.fechaHora) + ')';
        }).join('\n') +
        '\n<i>Se cierran solas cuando llegue el comprobante de pago.</i>');
    }

    tgEnviar(bloques.length ? bloques.join('\n\n')
      : '✅ Nada pendiente: todos tus gastos tienen categoría y monto en pesos.');
    return;
  }

  // Se repite el texto recibido a proposito. Cuando un comando no calza, saber
  // exactamente que llego es la diferencia entre arreglarlo y adivinar.
  tgEnviar('No entendí <code>' + tgEscapar(texto) + '</code>' +
    (cmd ? ' (comando leído: <code>' + tgEscapar(cmd.nombre) + '</code>)' : '') +
    '\n\nEntiendo los botones, <code>/pendientes</code>, ' +
    '<code>/olvidar COMERCIO</code>, <code>/respaldado</code> y ' +
    '<code>/reanudar</code>.');
}
