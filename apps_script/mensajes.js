/**
 * Como se le habla al usuario.
 *
 * Todo lo que arma texto para Telegram vive aqui, separado de la logica que
 * decide que hacer. Asi, cambiar una palabra no obliga a leer la maquina de
 * estados, y al reves.
 */

/** Encabezado comun: comercio, monto y cuando. */
function encabezado(mov) {
  var lineas = [];

  if (mov.tipo === 'entrada' || mov.tipo === 'ingreso') {
    lineas.push('💸 <b>Transferencia recibida</b>');
    // Sin nombre de quien envia: ese dato ya no se lee del correo. La nota que
    // se muestra es la que escribiste tu, no la glosa que venia en el correo.
    lineas.push(formatearMonto(mov.monto, mov.moneda) +
      (mov.fechaHora ? ' · ' + formatearFecha(mov.fechaHora) : ''));
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

/** Que sabe hacer el bot, en el orden en que se usa. */
function textoDeAyuda() {
  return [
    '<b>Cómo anotar un gasto en efectivo</b>',
    'Escríbeme el monto y la palabra <b>efectivo</b>:',
    '<code>34000 efectivo</code>',
    'Después te pregunto la categoría con botones, igual que con las compras',
    'con tarjeta. Si quieres, puedes agregar de qué fue:',
    '<code>34000 efectivo almuerzo</code>',
    '',
    '<b>Cómo anotar plata que te entró</b>',
    'Con un <b>+</b> adelante del monto:',
    '<code>+900000 sueldo</code>',
    '',
    '<b>Las compras con tarjeta no las anotas tú.</b>',
    'Llegan solas desde el correo del banco, en menos de cinco minutos.',
    '',
    '<b>Comandos</b>',
    '/saldo  ·  cuánta plata queda en la cuenta',
    '/saldo 1055792  ·  corregirlo con lo que diga el banco',
    '/semana  ·  cuánto gasté en los últimos 7 días',
    '/mes  ·  cuánto llevo este mes',
    '/efectivo  ·  cuánto efectivo giraste y no has anotado',
    '/ultimos  ·  ver y corregir los últimos gastos',
    '/pendientes  ·  lo que falta clasificar',
    '/datos  ·  abrir la planilla y ver cuándo fue el último respaldo',
    '/respaldar  ·  guardar una copia ahora, sin esperar al domingo',
    '',
    '<b>Menos usados</b>',
    '/olvidar COMERCIO  ·  que vuelva a preguntarte por ese comercio',
    '/reanudar  ·  reactivarme si me froné por seguridad',
  ].join('\n');
}
