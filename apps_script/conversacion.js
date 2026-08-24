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

/**
 * El arbol de categorias que trae el codigo, mas las que el usuario agrego
 * desde el bot para ese mismo tipo. Las agregadas quedan al final: ver el
 * porque en arbolConPersonalizadas, en clasificador.js.
 */
function arbolDe(tipo) {
  var base = tipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS_GASTO;
  var personalizadas = cargarCategoriasPersonalizadas().filter(function (f) {
    return f.tipo === tipo;
  });
  return arbolConPersonalizadas(base, personalizadas);
}

/**
 * Abre la conversacion de un gasto y lo guarda.
 *
 * Es el unico camino: da lo mismo si el gasto vino de un correo del banco o de
 * un texto escrito a mano. Antes habia dos funciones casi identicas y el riesgo
 * real era arreglar una y olvidar la otra, que ya paso con el manejo de fechas.
 *
 * El identificador se genera antes de escribir nada, para que los botones ya lo
 * lleven, el mensaje salga primero y la fila se agregue una sola vez completa.
 */
function abrirGasto(mov) {
  var propuesta = proponerClasificacion(mov.comercio, cargarAprendizaje());
  var texto, teclado;

  if (propuesta && propuesta.automatico) {
    mov.categoria = propuesta.categoria;
    mov.subcategoria = propuesta.subcategoria;
    mov.estado = ESTADOS.CERRADO;
    texto = '✅ ' + encabezado(mov) + '\n' +
      rutaCategoria(propuesta.categoria, propuesta.subcategoria);
    teclado = tecladoCerrado(mov.id);
  } else if (propuesta) {
    // La propuesta se guarda aunque no este confirmada: si el usuario aprieta
    // "Sí, guardar así" no hay nada que recalcular, y si nunca responde queda
    // un dato razonable en vez de un vacio.
    mov.categoria = propuesta.categoria;
    mov.subcategoria = propuesta.subcategoria;
    mov.estado = ESTADOS.ESPERANDO_CATEGORIA;
    texto = encabezado(mov) + '\n\n' +
      rutaCategoria(propuesta.categoria, propuesta.subcategoria) + '?';
    teclado = tecladoConfirmar(mov.id);
  } else {
    mov.estado = ESTADOS.ESPERANDO_CATEGORIA;
    texto = encabezado(mov) + '\n\n¿Qué categoría?';
    teclado = tecladoCategorias(mov.id, arbolDe(mov.tipo));
  }

  mov.mensajeId = tgEnviar(texto, teclado);
  registrarMovimiento(mov);
  marcarConversacion();
  return mov.id;
}

/** Un gasto que llego por correo del banco. */
function anunciarGasto(lectura, correoId) {
  return abrirGasto({
    id: nuevoId(),
    fechaHora: lectura.fechaHora,
    tipo: 'gasto',
    comercio: lectura.comercio,
    monto: lectura.monto,
    moneda: lectura.moneda,
    montoClp: lectura.montoClp,
    medioPago: lectura.medioPago,
    correoId: correoId,
  });
}

/**
 * Anuncia una transferencia recibida. Primero hay que saber si es ingreso.
 *
 * Antes este mensaje decia de quien venia la plata y para que era, sacados del
 * correo. Los dos datos se dejaron de leer: el nombre es de una persona que no
 * eligio estar aca, y el texto que escribio es libre. Ahora solo se ve el monto
 * y la fecha, y quien reconoce la transferencia eres tu.
 */
function anunciarEntrada(lectura, correoId) {
  var id = nuevoId();
  var mov = {
    id: id,
    fechaHora: lectura.fechaHora,
    tipo: 'entrada',
    comercio: lectura.comercio,
    monto: lectura.monto,
    moneda: lectura.moneda,
    montoClp: lectura.montoClp,
    medioPago: 'transferencia',
    estado: ESTADOS.ESPERANDO_TIPO_ENTRADA,
    correoId: correoId,
  };

  mov.mensajeId = tgEnviar(
    encabezado(mov) + '\n\n¿Es plata que ganaste, o te están devolviendo algo?',
    tecladoEntrada(id)
  );
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

  // El arbol se arma solo en las tres acciones que lo usan, no arriba para
  // todas. Armarlo cuesta leer la hoja de categorias personalizadas cuando la
  // cache esta fria, y el boton mas apretado de todos ("Sí, guardar así") no
  // necesita el arbol para nada: pagaba esa lectura, cerca de un segundo de
  // espera en el telefono, sin usarla.
  var arbol;

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
    arbol = arbolDe(mov.tipo);
    tgEditar(mov.mensajeId, encabezado(mov) + '\n\n¿Qué categoría?',
      tecladoCategorias(id, arbol));
    return;
  }

  if (accion === 'cat') {
    arbol = arbolDe(mov.tipo);
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
      encabezado(mov) + '\n\n' + tgEscapar(categoria.nombre) + '\n¿Cuál?',
      tecladoSubcategorias(id, arbol, i));
    return;
  }

  if (accion === 'sub' || accion === 'solo') {
    arbol = arbolDe(mov.tipo);
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
      + 'Si no escribes nada en ' + Math.round(VENTANA_RESPUESTA_MS / 60000)
      + ' minutos, se cancela sola y vuelvo a entender comandos normales.');
    return;
  }

  if (accion === 'nuevacat') {
    PropertiesService.getScriptProperties()
      .setProperty('CATEGORIA_NUEVA_PARA', id + '|' + Date.now());
    tgEnviar('🏷️ Escribe el nombre de la categoría nueva.\n'
      + 'Si quieres, ponle tú mismo un emoji delante, como las demás.\n'
      + 'Tu próximo mensaje se guarda como el nombre. Si no escribes nada en '
      + Math.round(VENTANA_CATEGORIA_MS / 60000) + ' minutos, se cancela sola.');
    return;
  }

  if (accion === 'nuevasub') {
    PropertiesService.getScriptProperties()
      .setProperty('SUBCATEGORIA_NUEVA_PARA', id + '|' + Date.now());
    tgEnviar('🏷️ Escribe el nombre de la subcategoría nueva para <b>'
      + tgEscapar(mov.categoria) + '</b>.\n'
      + 'Tu próximo mensaje se guarda como el nombre. Si no escribes nada en '
      + Math.round(VENTANA_CATEGORIA_MS / 60000) + ' minutos, se cancela sola.');
    return;
  }

  if (accion === 'ing') {
    mov.tipo = 'ingreso';
    mov.estado = ESTADOS.ESPERANDO_CATEGORIA;
    guardarMovimiento(mov);
    tgEditar(mov.mensajeId, encabezado(mov) + '\n\n¿Qué tipo de ingreso?',
      tecladoCategorias(id, arbolDe('ingreso')));
    return;
  }

  if (accion === 'reem') {
    // Un reembolso no es ingreso: te devolvieron plata que ya habias puesto.
    // Contarlo como ingreso inflaria tus entradas del mes.
    mov.tipo = 'reembolso';
    mov.estado = ESTADOS.REEMBOLSO;
    guardarMovimiento(mov);
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

/**
 * Cuanto tiempo se espera el proximo mensaje de texto antes de cancelar solo.
 *
 * La nota es una reaccion inmediata a un gasto que se esta mirando en ese
 * momento, y 10 minutos alcanza de sobra. Pensar el nombre de una categoria
 * nueva es otra cosa: es plausible que el usuario quiera pensarlo, revisar que
 * no tenga ya algo parecido, o simplemente lo interrumpan. Un caso real de
 * este proyecto: se probo "Añadir categoria" y no funciono porque el nombre se
 * escribio pasados los 10 minutos, y para entonces la espera ya habia caducado
 * en silencio. Por eso categoria y subcategoria tienen su propia ventana, mas
 * larga.
 */
var VENTANA_RESPUESTA_MS = 600000;    // 10 minutos: nota
var VENTANA_CATEGORIA_MS = 1800000;   // 30 minutos: categoria y subcategoria nuevas

/**
 * Devuelve el id guardado bajo "clave", o null si no hay nada o ya caduco.
 *
 * La comparten tres esperas: la nota, la categoria nueva y la subcategoria
 * nueva. Las tres guardan lo mismo (un id y el momento) bajo una propiedad
 * distinta, y cada una espera lo suyo: "ventanaMs" es cuanto le corresponde a
 * esta espera en particular, no un valor fijo para las tres.
 *
 * La caducidad no es un detalle: sin ella, apretar un boton y no escribir
 * nada dejaba al bot esperando indefinidamente, y el siguiente texto que se
 * le mandara, aunque fuera al dia siguiente, se comia como si fuera la
 * respuesta a ese boton.
 */
function _pendiente(propiedades, clave, ventanaMs) {
  var guardado = propiedades.getProperty(clave);
  if (!guardado) return null;

  var partes = String(guardado).split('|');
  var cuando = Number(partes[1] || 0);

  if (!cuando || Date.now() - cuando > ventanaMs) {
    propiedades.deleteProperty(clave);
    return null;
  }
  return partes[0];
}

function notaPendiente(propiedades) {
  return _pendiente(propiedades, 'NOTA_PARA', VENTANA_RESPUESTA_MS);
}

function categoriaNuevaPendiente(propiedades) {
  return _pendiente(propiedades, 'CATEGORIA_NUEVA_PARA', VENTANA_CATEGORIA_MS);
}

function subcategoriaNuevaPendiente(propiedades) {
  return _pendiente(propiedades, 'SUBCATEGORIA_NUEVA_PARA', VENTANA_CATEGORIA_MS);
}

/**
 * El usuario acaba de escribir el nombre de una categoria nueva.
 *
 * Se guarda en su planilla (no en el codigo) y se deja como categoria del
 * gasto. Se le ofrece de una vez la chance de agregarle tambien una
 * subcategoria, en vez de cerrar el gasto de inmediato: una categoria recien
 * creada siempre tiene cero subcategorias, y cerrarla solo porque tiene cero
 * (la regla que usan las categorias del codigo que son asi a proposito, como
 * "Regalos") le habria quitado a este el unico momento facil para agregar la
 * primera subcategoria.
 */
function resolverCategoriaNueva(propiedades, movId, texto) {
  propiedades.deleteProperty('CATEGORIA_NUEVA_PARA');

  var mov = obtenerMovimiento(movId);
  if (!mov) {
    tgEnviar('No encuentro ese gasto en la hoja. Puede que lo hayas borrado a mano.');
    return;
  }

  var limpio = nombreDeCategoriaValido(texto);
  if (!limpio) {
    // Se vuelve a marcar la espera: el usuario sigue en medio de escribir un
    // nombre, perder la conversacion aca por un nombre invalido seria mas
    // molesto que pedirlo de nuevo.
    propiedades.setProperty('CATEGORIA_NUEVA_PARA', movId + '|' + Date.now());
    tgEnviar('Ese nombre no sirve. Escribe uno de 1 a ' + MAX_LARGO_CATEGORIA +
      ' caracteres.');
    return;
  }

  // Se mira si ya existia ANTES de guardar. Escribir el nombre de una que ya
  // esta es facil (uno no se acuerda de memoria de las doce), y antes eso
  // guardaba una fila repetida y encima respondia "(categoría nueva)", que era
  // falso. Ahora no se guarda nada y se dice lo que de verdad paso: la
  // categoria se usa igual, que es lo que el usuario queria.
  var arbol = arbolDe(mov.tipo);
  var yaExistia = indiceDeCategoria(arbol, limpio) >= 0;

  if (!yaExistia) {
    guardarCategoriaPersonalizada(mov.tipo, limpio, '');
    arbol = arbolDe(mov.tipo);
  }

  var indice = indiceDeCategoria(arbol, limpio);
  if (indice < 0) {
    // No deberia pasar: se acaba de guardar y de releer. Si pasa, es que la
    // cache quedo pegada. Se avisa en vez de reventar con "arbol[-1] no tiene
    // subcategorias", que no le diria nada a nadie.
    tgEnviar('Guardé <b>' + tgEscapar(limpio) + '</b>, pero no la encuentro para '
      + 'seguir. Vuelve a apretar "Cambiar categoría" en el gasto y ahí debería '
      + 'aparecer en la lista.');
    return;
  }

  mov.categoria = limpio;
  mov.estado = ESTADOS.ESPERANDO_SUBCATEGORIA;
  guardarMovimiento(mov);

  tgEditar(mov.mensajeId,
    encabezado(mov) + '\n\n🏷️ <b>' + tgEscapar(limpio) + '</b> ' +
    (yaExistia ? '(esa ya la tenías, la uso igual)' : '(categoría nueva)') +
    '\n¿Le agregas una subcategoría, o la guardo así?',
    tecladoSubcategorias(movId, arbol, indice));
}

/** El usuario acaba de escribir el nombre de una subcategoria nueva. */
function resolverSubcategoriaNueva(propiedades, movId, texto) {
  propiedades.deleteProperty('SUBCATEGORIA_NUEVA_PARA');

  var mov = obtenerMovimiento(movId);
  if (!mov) {
    tgEnviar('No encuentro ese gasto en la hoja. Puede que lo hayas borrado a mano.');
    return;
  }

  var limpio = nombreDeCategoriaValido(texto);
  if (!limpio) {
    propiedades.setProperty('SUBCATEGORIA_NUEVA_PARA', movId + '|' + Date.now());
    tgEnviar('Ese nombre no sirve. Escribe uno de 1 a ' + MAX_LARGO_CATEGORIA +
      ' caracteres.');
    return;
  }

  guardarCategoriaPersonalizada(mov.tipo, mov.categoria, limpio);

  var registro = calcularCierre(mov, mov.categoria, limpio);
  tgEditar(mov.mensajeId, textoCerrado(mov, mov.categoria, limpio, registro),
    tecladoCerrado(movId));
  persistirCierre(mov, mov.categoria, limpio, registro);
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

  // Si lo que llega parece un comando ("/saldo", "/pendientes"), no se toma
  // como el nombre de la categoria: eso habria creado una categoria literal
  // llamada "/saldo". Se cancela la espera y el comando sigue su camino normal
  // mas abajo. La nota no necesita este resguardo porque cualquier texto,
  // incluido uno que empiece con "/", es una nota valida.
  var esperandoCategoriaNueva = categoriaNuevaPendiente(propiedades);
  if (esperandoCategoriaNueva && comando(texto)) {
    propiedades.deleteProperty('CATEGORIA_NUEVA_PARA');
    esperandoCategoriaNueva = null;
  }
  if (esperandoCategoriaNueva) {
    return resolverCategoriaNueva(propiedades, esperandoCategoriaNueva, texto);
  }

  var esperandoSubcategoriaNueva = subcategoriaNuevaPendiente(propiedades);
  if (esperandoSubcategoriaNueva && comando(texto)) {
    propiedades.deleteProperty('SUBCATEGORIA_NUEVA_PARA');
    esperandoSubcategoriaNueva = null;
  }
  if (esperandoSubcategoriaNueva) {
    return resolverSubcategoriaNueva(propiedades, esperandoSubcategoriaNueva, texto);
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
  var ingreso = leerIngresoEscrito(texto);
  if (ingreso) return registrarIngreso(ingreso);

  var aMano = leerGastoEscrito(texto);
  if (aMano) return aMano.esGiro ? registrarGiro(aMano) : registrarGastoEscrito(aMano);

  if (cmd && cmd.nombre === 'semana') return informeSemana();
  if (cmd && cmd.nombre === 'mes') return informeMes();

  if (cmd && cmd.nombre === 'ayuda' || cmd && cmd.nombre === 'start') {
    tgEnviar(textoDeAyuda());
    return;
  }

  if (cmd && cmd.nombre === 'ingreso') return explicarIngreso();
  if (cmd && cmd.nombre === 'saldo') {
    return informeSaldo(cmd.resto ? normalizarMonto(cmd.resto, 'CLP') : null);
  }
  if (cmd && cmd.nombre === 'efectivo') return informeEfectivo();
  if (cmd && cmd.nombre === 'ultimos') return mostrarUltimos();
  if (cmd && cmd.nombre === 'datos') return mostrarDatos();

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

