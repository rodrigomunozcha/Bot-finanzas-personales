const test = require('node:test');
const assert = require('node:assert');
const { crearEntorno } = require('./ayuda/entorno.js');

const COMPRA = {
  asunto: 'Cargo en cuenta',
  cuerpo: 'Te informamos que se ha realizado una compra por $12.500 con cargo a ' +
    'Cuenta ****1234 en JUMBO CENTRAL el 01/08/2026 13:20.',
};

/** Simula un correo entrando por el flujo real de procesarMensaje. */
function entra(e, asunto, cuerpo, correoId = 'm' + Math.random()) {
  e.contexto.procesarMensaje({
    getId: () => correoId,
    getSubject: () => asunto,
    getPlainBody: () => cuerpo,
  });
}

test('comercio de la semilla: propone y se confirma de un toque', () => {
  const e = crearEntorno();
  entra(e, COMPRA.asunto, COMPRA.cuerpo);

  assert.match(e.ultimoTexto(), /JUMBO CENTRAL/);
  assert.match(e.ultimoTexto(), /\$11\.680/);
  assert.match(e.ultimoTexto(), /🍴 Alimentación › 🛒 Supermercado\?/);

  e.apretar('Sí, guardar así');

  const mov = e.movimiento();
  assert.equal(mov.categoria, '🍴 Alimentación');
  assert.equal(mov.subcategoria, '🛒 Supermercado');
  assert.equal(mov.estado, 'cerrado');
  assert.match(e.ultimoTexto(), /2 veces más, empiezo a clasificar este comercio solo/);
});

test('comercio desconocido: categoría, subcategoría y cierre', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  assert.match(e.ultimoTexto(), /¿Qué categoría\?/);
  e.apretar('🍴 Alimentación');

  assert.match(e.ultimoTexto(), /¿Cuál\?/);
  e.apretar('🥗 Feria');

  const mov = e.movimiento();
  assert.equal(mov.categoria, '🍴 Alimentación');
  assert.equal(mov.subcategoria, '🥗 Feria / Mercado');
  assert.equal(mov.estado, 'cerrado');
});

test('se puede cerrar sin elegir subcategoría', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('🍴 Alimentación');
  e.apretar('Guardar sin subcategoría');

  const mov = e.movimiento();
  assert.equal(mov.categoria, '🍴 Alimentación');
  assert.equal(mov.subcategoria, '');
  assert.equal(mov.estado, 'cerrado');
});

test('a la tercera confirmación deja de preguntar y clasifica solo', () => {
  const e = crearEntorno();

  for (let i = 0; i < 3; i++) {
    entra(e, COMPRA.asunto, COMPRA.cuerpo, 'correo-' + i);
    e.apretar('Sí, guardar así');
  }
  assert.match(e.ultimoTexto(), /las clasifico solo, sin preguntarte/);

  entra(e, COMPRA.asunto, COMPRA.cuerpo, 'correo-4');
  const texto = e.ultimoTexto();
  assert.match(texto, /^✅/, 'llega ya clasificado');
  assert.equal(/¿Qué categoría\?/.test(texto), false);

  const mov = e.movimiento(3);
  assert.equal(mov.estado, 'cerrado');
  assert.equal(mov.categoria, '🍴 Alimentación');
});

test('corregir un comercio ya aprendido lo devuelve a preguntar', () => {
  const e = crearEntorno();
  for (let i = 0; i < 3; i++) {
    entra(e, COMPRA.asunto, COMPRA.cuerpo, 'correo-' + i);
    e.apretar('Sí, guardar así');
  }

  entra(e, COMPRA.asunto, COMPRA.cuerpo, 'correo-x');
  e.apretar('✏️ Cambiar');
  e.apretar('🎁 Regalos');

  const aprendido = e.aprendizaje().find((a) => a.comercio === 'JUMBO CENTRAL');
  assert.equal(aprendido.categoria, '🎁 Regalos');
  assert.equal(aprendido.confirmaciones, 1, 'la corrección reinicia la cuenta');

  entra(e, COMPRA.asunto, COMPRA.cuerpo, 'correo-y');
  assert.match(e.ultimoTexto(), /🎁 Regalos\?/, 'vuelve a proponer y preguntar');
});

test('transferencia recibida: reembolso no cuenta como ingreso', () => {
  const e = crearEntorno();
  entra(e, 'Aviso de transferencia de fondos',
    'Te informamos que nuestro(a) cliente Jessica Veronica Perez ha efectuado una ' +
    'transferencia de fondos a tu cuenta con el siguiente detalle: Datos de cuenta ' +
    'Fecha Asunto 01/08/2026 Maleta y taxi Datos de destinatario Nombre y Apellido Rut ' +
    'Email Banco Cuenta destino Nombre Apellido 11111111-1 correo@example.com ' +
    'Banco Chile/Edwards Cuenta Corriente 00-000-00000-00 Monto $185.000');

  // El mensaje dice el monto y la fecha, y nada más. Ni de quién viene, ni la
  // glosa que esa persona escribió: los dos son datos de un tercero.
  const texto = e.ultimoTexto();
  assert.match(texto, /\$185\.000/);
  assert.equal(texto.includes('Jessica'), false, 'no se nombra a quien envía');
  assert.equal(texto.includes('Maleta y taxi'), false, 'no se muestra su glosa');
  assert.equal(texto.includes('11111111-1'), false, 'no se filtra el RUT al chat');

  e.apretar('🔄 Es un reembolso');
  assert.equal(e.movimiento().tipo, 'reembolso');
});

test('transferencia marcada como ingreso pregunta con el árbol de ingresos', () => {
  const e = crearEntorno();
  entra(e, 'Aviso de transferencia de fondos',
    'nuestro(a) cliente Ana Perez ha efectuado una transferencia de fondos a tu cuenta ' +
    'con el siguiente detalle: Datos de cuenta Fecha Asunto 01/08/2026 Pago clase ' +
    'Datos de destinatario Monto $50.000');

  e.apretar('💰 Es un ingreso');
  const textos = (e.ultimoTeclado() || []).flat().map((b) => b.text);
  assert.ok(textos.includes('💼 Trabajo'), 'usa categorías de ingreso, no de gasto');
  assert.equal(textos.includes('🍴 Alimentación'), false);
});

test('compra en dólares: queda pendiente y la cierra el pago de la tarjeta', () => {
  const e = crearEntorno();
  entra(e, 'Compra con Tarjeta de Crédito',
    'Te informamos que se ha realizado una compra por US$49,00 con cargo a ' +
    'Tarjeta de Crédito ****1234 en OPENAI el 15/07/2026 03:22.');

  assert.match(e.ultimoTexto(), /US\$49,00/);
  assert.match(e.ultimoTexto(), /pendiente hasta que pagues la tarjeta/);
  e.apretar('Sí, guardar así');
  assert.equal(e.movimiento().montoClp, '');

  entra(e, 'Comprobante pago Tarjeta de Crédito Internacional',
    'Utilizado USD$0,00 Monto pagado USD$49,00 Tipo de cambio $949 Monto $46.518 ' +
    'sábado 01 de agosto de 2026 08:47');

  assert.equal(e.movimiento().montoClp, 46518, 'se cierra con el peso real del banco');
  assert.match(e.ultimoTexto(), /Cambio real: 949,35/);

  const pago = e.movimiento(1);
  assert.equal(pago.tipo, 'interno', 'el pago no se cuenta como gasto nuevo');
});

test('un correo desconocido se guarda en vez de perderse', () => {
  const e = crearEntorno();
  entra(e, 'Tu estado de cuenta está disponible', 'Ingresa a la app para revisarlo.');

  assert.equal(e.movimiento(), null, 'no se inventa un movimiento');
  const [, ...noEntendidos] = e.hojas.no_entendidos._filas;
  assert.equal(noEntendidos.length, 1);
  assert.equal(noEntendidos[0][1], 'Tu estado de cuenta está disponible');
});

test('el mismo correo dos veces no duplica el gasto', () => {
  const e = crearEntorno();
  entra(e, COMPRA.asunto, COMPRA.cuerpo, 'el-mismo');
  entra(e, COMPRA.asunto, COMPRA.cuerpo, 'el-mismo');

  const [, ...filas] = e.hojas.movimientos._filas;
  assert.equal(filas.length, 1);
});

test('la nota se pide por botón y se guarda con el siguiente mensaje', () => {
  const e = crearEntorno();
  entra(e, COMPRA.asunto, COMPRA.cuerpo);
  e.apretar('Sí, guardar así');
  e.apretar('Agregar nota');

  e.contexto.manejarTexto('el asado del domingo');
  assert.equal(e.movimiento().nota, 'el asado del domingo');
});

// Estructura del correo real, con los datos del destinatario inventados.
const TRANSFERENCIA_ENVIADA = `Comprobante de Transferencia a terceros
Estimado(a): Nombre Apellido
Te informamos que has realizado una Transferencia a terceros en forma exitosa con el siguiente detalle:
Origen
Tipo de Cuenta 	Cuenta Corriente
Nº de Cuenta 	00-000-00000-00
Destino
Nombre y Apellido 	Otra Persona Inventada
Rut 	11111111-1
Tipo de Cuenta 	Cuenta Vista
Nº de Cuenta 	00-999-99999-99
Banco 	Banco Ejemplo
Email 	
Monto 	$40.000
Mensaje 	Arriendo depto

 Fecha y Hora:

martes 11 de agosto de 2026 17:08`;

test('transferencia enviada: se pregunta como gasto y se guarda', () => {
  const e = crearEntorno();
  entra(e, 'Comprobante de Transferencia a terceros', TRANSFERENCIA_ENVIADA);

  assert.match(e.ultimoTexto(), /Transferencia enviada/);
  assert.match(e.ultimoTexto(), /\$40\.000/);
  assert.match(e.ultimoTexto(), /¿Qué categoría\?/,
    'sin nombre real de comercio, siempre sale la lista completa');

  e.apretar('🏠 Hogar');
  e.apretar('Guardar sin subcategoría');

  const mov = e.movimiento();
  assert.equal(mov.tipo, 'gasto', 'la plata sale, no es una entrada');
  assert.equal(mov.monto, 40000);
  assert.equal(mov.medioPago, 'transferencia');
  assert.equal(mov.categoria, '🏠 Hogar');
  assert.equal(mov.estado, 'cerrado');
});

// Todas las transferencias comparten nombre, así que sin este bloqueo la
// tercera y todas las siguientes se clasificarían solas con la categoría de las
// anteriores. Una al arriendo y una a un amigo quedarían juntas, en silencio.
test('una transferencia nunca se aprende: pregunta siempre', () => {
  const e = crearEntorno();

  for (let i = 1; i <= 4; i++) {
    entra(e, 'Comprobante de Transferencia a terceros', TRANSFERENCIA_ENVIADA,
      'transferencia-' + i);
    assert.match(e.ultimoTexto(), /¿Qué categoría\?/,
      `la transferencia ${i} dejó de preguntar`);
    e.apretar('🏠 Hogar');
    e.apretar('Guardar sin subcategoría');
  }

  const aprendidos = e.hojas.aprendizaje._filas.slice(1);
  assert.equal(aprendidos.length, 0,
    'no puede quedar ninguna fila de aprendizaje para una transferencia');
});

test('del destinatario de una transferencia no queda nada en la hoja', () => {
  const e = crearEntorno();
  entra(e, 'Comprobante de Transferencia a terceros', TRANSFERENCIA_ENVIADA);
  e.apretar('🏠 Hogar');
  e.apretar('Guardar sin subcategoría');

  const escrito = JSON.stringify(e.hojas.movimientos._filas);
  for (const dato of ['11111111-1', '00-999-99999-99', 'Otra', 'Inventada',
    'Banco Ejemplo']) {
    assert.equal(escrito.includes(dato), false, `quedó guardado en la hoja: ${dato}`);
  }
});
