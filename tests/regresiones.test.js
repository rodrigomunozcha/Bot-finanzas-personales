const test = require('node:test');
const assert = require('node:assert');
const tg = require('../apps_script/telegram.js');
const { crearEntorno } = require('./ayuda/entorno.js');

const COMPRA = {
  asunto: 'Cargo en cuenta',
  cuerpo: 'Te informamos que se ha realizado una compra por $12.500 con cargo a ' +
    'Cuenta ****1234 en JUMBO CENTRAL el 01/08/2026 13:20.',
};

function entra(e, correoId = 'm' + Math.random()) {
  e.contexto.procesarMensaje({
    getId: () => correoId,
    getSubject: () => COMPRA.asunto,
    getPlainBody: () => COMPRA.cuerpo,
  });
}

// Sheets convierte el texto "2026-08-01T13:20" en un objeto Date al guardarlo.
// La version anterior suponia siempre texto y mostraba "undefined NaN undefined".
test('la fecha se formatea igual venga como texto o como objeto Date', () => {
  const esperado = 'sáb 1 ago 13:20';
  assert.equal(tg.formatearFecha('2026-08-01T13:20'), esperado);
  assert.equal(tg.formatearFecha(new Date(2026, 7, 1, 13, 20)), esperado);
});

test('una fecha sin hora no inventa las 00:00', () => {
  assert.equal(tg.formatearFecha(new Date(2026, 7, 1)), 'sáb 1 ago');
  assert.equal(tg.formatearFecha('2026-08-01'), 'sáb 1 ago');
});

test('una fecha inválida da vacío, no basura', () => {
  assert.equal(tg.formatearFecha(new Date('nada')), '');
  assert.equal(tg.formatearFecha('cualquier cosa'), '');
  assert.equal(tg.formatearFecha(''), '');
});

// Esta es la prueba que faltaba: el mensaje que se edita despues de apretar un
// boton lee la fecha desde la hoja, no desde el correo.
test('el mensaje editado muestra la fecha bien, no "undefined NaN"', () => {
  const e = crearEntorno();
  entra(e);
  e.apretar('Sí, guardar así');

  const texto = e.ultimoTexto();
  assert.equal(/undefined|NaN/.test(texto), false, `salió: ${texto}`);
  assert.match(texto, /sáb 1 ago 13:20/);
});



test('/olvidar borra lo aprendido de un comercio', () => {
  const e = crearEntorno();
  entra(e);
  e.apretar('Sí, guardar así');
  assert.equal(e.aprendizaje().length, 1);

  e.contexto.manejarTexto('/olvidar jumbo central');

  assert.equal(e.aprendizaje().length, 0);
  assert.match(e.ultimoTexto(), /Olvidé lo que sabía/);
});

test('/olvidar de un comercio desconocido lo dice sin romperse', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('/olvidar UN LUGAR CUALQUIERA');
  assert.match(e.ultimoTexto(), /No tenía nada aprendido/);
});

test('el comando se reconoce con mayúsculas, con @bot y con espacios raros', () => {
  const e = crearEntorno();

  const variantes = [
    '/olvidar JUMBO CENTRAL',
    '/OLVIDAR jumbo central',
    '/olvidar@mis_gastos_bot JUMBO CENTRAL',
    '  /olvidar   JUMBO CENTRAL  ',
    '/olvidar JUMBO CENTRAL',        // espacio duro del teclado
    '/olvidar ​JUMBO CENTRAL',        // espacio de ancho cero
  ];

  for (const variante of variantes) {
    e.contexto.manejarTexto(variante);
    assert.match(e.ultimoTexto(), /aprendido de|Olvidé lo que sabía/,
      `no reconoció: ${JSON.stringify(variante)}`);
  }
});

test('lo que no se entiende se repite para poder diagnosticarlo', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('/inventado algo');

  assert.match(e.ultimoTexto(), /No entendí/);
  assert.match(e.ultimoTexto(), /inventado/, 'debe mostrar qué llegó');
});


// Apretar "Agregar nota" y no escribir dejaba al bot esperando para siempre: al
// día siguiente, un "hola" cualquiera terminaba guardado como nota del gasto.
test('la espera de nota caduca a los 10 minutos', () => {
  const e = crearEntorno();
  entra(e);
  e.apretar('Sí, guardar así');
  e.apretar('Agregar nota');

  e.adelantarReloj(11 * 60 * 1000);
  e.contexto.manejarTexto('hola');

  assert.equal(e.movimiento().nota, '', 'no debe guardarse como nota');
  assert.match(e.ultimoTexto(), /No entendí/, 'se trata como texto normal');
});

test('dentro de los 10 minutos la nota sí se guarda', () => {
  const e = crearEntorno();
  entra(e);
  e.apretar('Sí, guardar así');
  e.apretar('Agregar nota');

  e.adelantarReloj(5 * 60 * 1000);
  e.contexto.manejarTexto('250gr café');

  assert.equal(e.movimiento().nota, '250gr café');
});

test('un comando escrito cuando la espera caducó se ejecuta como comando', () => {
  const e = crearEntorno();
  entra(e);
  e.apretar('Sí, guardar así');
  e.apretar('Agregar nota');

  e.adelantarReloj(11 * 60 * 1000);
  e.contexto.manejarTexto('/olvidar JUMBO CENTRAL');

  assert.match(e.ultimoTexto(), /Olvidé lo que sabía/);
  assert.equal(e.movimiento().nota, '');
});

// La caché convertía las fechas a texto UTC y el lector las tomaba como locales:
// una compra de las 14:49 en Chile aparecía como "18:49:00.000Z".
test('una fecha ISO en UTC se muestra en hora local y sin segundos', () => {
  const utc = new Date(Date.UTC(2026, 7, 3, 18, 49)).toISOString();
  const local = tg.formatearFecha(utc);

  assert.equal(/Z|\.\d{3}/.test(local), false, `quedó con formato ISO: ${local}`);
  assert.match(local, /^\w{3} 3 ago \d{2}:\d{2}$/, `salió: ${local}`);
});

test('el gasto guardado conserva su hora al pasar por la caché', () => {
  const e = crearEntorno();
  entra(e);
  const antes = e.ultimoTexto();

  e.apretar('Sí, guardar así');

  assert.match(antes, /13:20/);
  assert.match(e.ultimoTexto(), /13:20/, 'la hora no puede cambiar al guardar');
});

// Un gasto que nunca se clasificó no aparece por ningún lado: no molesta, pero
// deja los informes incompletos sin que nadie se entere.
test('/pendientes lista los gastos que quedaron sin categoría', () => {
  const e = crearEntorno();
  entra(e);   // llega y nadie responde

  e.contexto.manejarTexto('/pendientes');

  assert.match(e.ultimoTexto(), /Sin categoría \(1\)/);
  assert.match(e.ultimoTexto(), /JUMBO CENTRAL/);
});

test('/pendientes no reporta nada cuando todo está clasificado', () => {
  const e = crearEntorno();
  entra(e);
  e.apretar('Sí, guardar así');

  e.contexto.manejarTexto('/pendientes');

  assert.match(e.ultimoTexto(), /Nada pendiente/);
});

test('un gasto ya cerrado deja de contar como pendiente', () => {
  const e = crearEntorno();
  entra(e);
  assert.equal(e.contexto.contarSinClasificar(), 1);

  e.apretar('Sí, guardar así');
  assert.equal(e.contexto.contarSinClasificar(), 0);
});

// Sheets guardaba "2026-08-01T13:20" como texto, porque la T no calza con
// ningún formato que reconozca. Una columna de texto con forma de fecha deja
// inservible cualquier gráfico de tiempo que se conecte después.
test('la fecha se guarda en la hoja como fecha, no como texto', () => {
  const e = crearEntorno();
  entra(e);

  const [encabezados, fila] = e.hojas.movimientos._filas;
  const guardada = fila[encabezados.indexOf('fechaHora')];

  assert.ok(guardada instanceof Date, `quedó como ${typeof guardada}: ${guardada}`);
  assert.equal(guardada.getHours(), 13);
  assert.equal(guardada.getMinutes(), 20);
});

test('un gasto escrito a mano también guarda fecha de verdad', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('12000 efectivo almuerzo');

  const [encabezados, fila] = e.hojas.movimientos._filas;
  assert.ok(fila[encabezados.indexOf('fechaHora')] instanceof Date);
});

test('editar un gasto no lo devuelve a texto', () => {
  const e = crearEntorno();
  entra(e);
  e.apretar('Sí, guardar así');

  const [encabezados, fila] = e.hojas.movimientos._filas;
  assert.ok(fila[encabezados.indexOf('fechaHora')] instanceof Date,
    'la caché devuelve texto y al reescribir hay que volver a convertirlo');
});

test('una transferencia sin hora se guarda igual como fecha', () => {
  const e = crearEntorno();
  e.contexto.procesarMensaje({
    getId: () => 't1',
    getSubject: () => 'Aviso de transferencia de fondos',
    getPlainBody: () => 'nuestro(a) cliente Nombre Apellido ha efectuado una transferencia ' +
      'de fondos a tu cuenta con el siguiente detalle: Datos de cuenta ' +
      'Fecha Asunto 01/08/2026 Pago clase Datos de destinatario Monto $50.000',
  });

  const [encabezados, fila] = e.hojas.movimientos._filas;
  const guardada = fila[encabezados.indexOf('fechaHora')];
  assert.ok(guardada instanceof Date);
  assert.equal(guardada.getHours(), 0, 'sin hora queda a medianoche');
});
