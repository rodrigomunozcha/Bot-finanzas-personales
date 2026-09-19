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
  assert.match(e.ultimoTexto(), /\$12\.500/);
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

  entra(e, 'Pago de Tarjeta de Crédito Internacional',
    'Utilizado USD$0,00 Monto pagado USD$49,00 Tipo de cambio $949 Monto $46.518 ' +
    'sábado 01 de agosto de 2026 08:47');

  assert.equal(e.movimiento().montoClp, 46518, 'se cierra con el peso real del banco');
  assert.match(e.ultimoTexto(), /Cambio real: 949,35/);

  const pago = e.movimiento(1);
  assert.equal(pago.tipo, 'interno', 'el pago no se cuenta como gasto nuevo');
});

test('un formato de movimiento que no conocemos se guarda en vez de perderse', () => {
  const e = crearEntorno();
  entra(e, 'Giro con Tarjeta de Débito',
    'Te informamos de un giro por $40.000 el 01/08/2026 10:00.');

  assert.equal(e.movimiento(), null, 'no se inventa un movimiento');
  const [, ...noEntendidos] = e.hojas.no_entendidos._filas;
  assert.equal(noEntendidos.length, 1);
  assert.equal(noEntendidos[0][1], 'Giro con Tarjeta de Débito');
});

// La idea es del usuario: los asuntos de movimiento se repiten, los de
// publicidad cambian en cada campaña, así que perseguirlos uno por uno no
// termina nunca. Lo que los separa de verdad es que un aviso de plata trae la
// cifra y una campaña no.
test('la publicidad del banco no ensucia la bandeja de no entendidos', () => {
  const e = crearEntorno();
  entra(e, 'En estas Fiestas Patrias, cuida tus tarjetas',
    'Revisa nuestros consejos de seguridad en la app.');

  const [, ...noEntendidos] = e.hojas.no_entendidos._filas;
  assert.equal(noEntendidos.length, 0);
  assert.equal(e.propiedades.CORREOS_SIN_MONTO, '1', 'pero queda contado');
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
  entra(e, 'Transferencia a Terceros', TRANSFERENCIA_ENVIADA);

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

// El banco manda la fecha de otra forma en algunos correos: con comas y en
// 12 horas con a. m. / p. m., en vez de sin comas y en 24 horas como el bloque
// de arriba. Las dos formas son reales, vistas el mismo mes en transferencias
// distintas, y la primera versión de este lector solo entendía la de arriba.
test('transferencia enviada: también se reconoce con fecha en 12 horas y comas', () => {
  const e = crearEntorno();
  const cuerpo = `Comprobante de Transferencia a terceros
Estimado(a): Nombre Inventado
Te informamos que has realizado una Transferencia a terceros en forma exitosa con el siguiente detalle:
Monto 	$8.950
Mensaje 	Algo

Fecha y Hora:

Sábado, 15 de agosto de 2026, 9:33 a. m.

Transacción

TEFMBCO0000000000000000000000`;

  entra(e, 'Transferencia a Terceros', cuerpo);
  assert.match(e.ultimoTexto(), /\$8\.950/);

  e.apretar('🏠 Hogar');
  e.apretar('Guardar sin subcategoría');

  const mov = e.movimiento();
  assert.equal(mov.monto, 8950);
  // La conversión exacta del texto a las 09:33 (y no a las 21:33) ya se prueba
  // en parsers.test.js sin pasar por un objeto Date, que interpreta la hora en
  // la zona del proceso que corre las pruebas y no en la del banco. Acá solo
  // importa que el correo se haya reconocido y guardado.
  assert.ok(mov.fechaHora, 'la fecha se guardó, no quedó vacía');
});

// Todas las transferencias comparten nombre, así que sin este bloqueo la
// tercera y todas las siguientes se clasificarían solas con la categoría de las
// anteriores. Una al arriendo y una a un amigo quedarían juntas, en silencio.
test('una transferencia nunca se aprende: pregunta siempre', () => {
  const e = crearEntorno();

  for (let i = 1; i <= 4; i++) {
    entra(e, 'Transferencia a Terceros', TRANSFERENCIA_ENVIADA,
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
  entra(e, 'Transferencia a Terceros', TRANSFERENCIA_ENVIADA);
  e.apretar('🏠 Hogar');
  e.apretar('Guardar sin subcategoría');

  const escrito = JSON.stringify(e.hojas.movimientos._filas);
  for (const dato of ['11111111-1', '00-999-99999-99', 'Otra', 'Inventada',
    'Banco Ejemplo']) {
    assert.equal(escrito.includes(dato), false, `quedó guardado en la hoja: ${dato}`);
  }
});

// El banco manda avisos de seguridad que no son un movimiento, como cuando se
// agrega un destinatario nuevo a quien transferir. No hay nada que registrar
// ahí, y no deben llenar la bandeja de no entendidos: esa bandeja es para
// avisar de formatos que faltan, y este correo nunca va a "faltar".
test('un aviso de seguridad del banco se ignora, no cae en no entendidos', () => {
  const e = crearEntorno();
  entra(e, 'Notificación por modificar o agregar un destinatario para transferencias',
    'Se agregó un nuevo destinatario a tu cuenta.');

  assert.equal(e.movimiento(), null, 'no es un movimiento');
  const [, ...noEntendidos] = e.hojas.no_entendidos._filas;
  assert.equal(noEntendidos.length, 0, 'tampoco debe quedar como no entendido');
});

// --- Añadir categoría y subcategoría desde el bot ---------------------------

test('el teclado de categorías trae el botón para añadir una nueva', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  const botones = (e.ultimoTeclado() || []).flat().map((b) => b.text);
  assert.ok(botones.includes('➕ Añadir categoría'));
});

test('añadir una categoría nueva: se pregunta, se guarda y ofrece subcategoría', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('➕ Añadir categoría');
  assert.match(e.ultimoTexto(), /Escribe el nombre de la categoría nueva/);

  e.contexto.manejarTexto('🐾 Mascotas');
  assert.match(e.ultimoTexto(), /🐾 Mascotas/);
  assert.match(e.ultimoTexto(), /categoría nueva/);

  const botones = (e.ultimoTeclado() || []).flat().map((b) => b.text);
  assert.ok(botones.includes('➕ Añadir subcategoría'));
  assert.ok(botones.includes('✓ Guardar sin subcategoría'));

  e.apretar('Guardar sin subcategoría');

  const mov = e.movimiento();
  assert.equal(mov.categoria, '🐾 Mascotas');
  assert.equal(mov.subcategoria, '');
  assert.equal(mov.estado, 'cerrado');

  const guardadas = e.categoriasPersonalizadas();
  assert.equal(guardadas.length, 1);
  assert.equal(guardadas[0].tipo, 'gasto');
  assert.equal(guardadas[0].categoria, '🐾 Mascotas');
  assert.equal(guardadas[0].subcategoria, '');
});

test('a esa categoría nueva se le puede agregar de una vez su primera subcategoría', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('🐾 Mascotas');
  e.apretar('➕ Añadir subcategoría');
  assert.match(e.ultimoTexto(), /subcategoría nueva para <b>🐾 Mascotas<\/b>/);

  e.contexto.manejarTexto('Veterinario');

  const mov = e.movimiento();
  assert.equal(mov.categoria, '🐾 Mascotas');
  assert.equal(mov.subcategoria, 'Veterinario');
  assert.equal(mov.estado, 'cerrado');

  // Quedan dos filas: la categoría se guardó al crearla (sin subcategoría), y
  // la subcategoría se guardó aparte al agregarla. arbolConPersonalizadas las
  // junta en una sola categoría igual, así que dos filas no es un problema.
  const guardadas = e.categoriasPersonalizadas();
  assert.equal(guardadas.length, 2);
  assert.ok(guardadas.some((g) => g.categoria === '🐾 Mascotas' && g.subcategoria === ''));
  assert.ok(guardadas.some((g) => g.categoria === '🐾 Mascotas' && g.subcategoria === 'Veterinario'));
});

test('una categoría agregada aparece en la lista del siguiente gasto', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');
  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('🐾 Mascotas');
  e.apretar('Guardar sin subcategoría');

  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $9.000 con cargo a ' +
    'Cuenta ****1234 en OTRO COMERCIO el 02/08/2026 10:00.', 'otro-comercio');

  const botones = (e.ultimoTeclado() || []).flat().map((b) => b.text);
  assert.ok(botones.includes('🐾 Mascotas'), 'la categoría agregada ya aparece en la lista');
});

// A una categoría que YA trae el código, con subcategorías propias, también se
// le puede sumar una subcategoría nueva sin perder las que ya tenía.
test('se puede añadir una subcategoría a una categoría que ya existía', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('🍴 Alimentación');
  const botonesSub = (e.ultimoTeclado() || []).flat().map((b) => b.text);
  assert.ok(botonesSub.includes('🛒 Supermercado'), 'las subcategorías de siempre siguen ahí');
  assert.ok(botonesSub.includes('➕ Añadir subcategoría'));

  e.apretar('➕ Añadir subcategoría');
  e.contexto.manejarTexto('Vinos y licores');

  assert.equal(e.movimiento().subcategoria, 'Vinos y licores');

  const guardadas = e.categoriasPersonalizadas();
  assert.equal(guardadas.length, 1);
  assert.equal(guardadas[0].categoria, '🍴 Alimentación');
  assert.equal(guardadas[0].subcategoria, 'Vinos y licores');
});

test('un nombre vacío no se acepta, y se sigue esperando el nombre', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('   ');
  assert.match(e.ultimoTexto(), /Ese nombre no sirve/);

  // El intento invalido no toco el gasto: sigue esperando categoria, sin una
  // asignada todavia.
  assert.equal(e.movimiento().estado, 'esperando_categoria');
  assert.equal(e.movimiento().categoria, '');

  e.contexto.manejarTexto('🐾 Mascotas');
  e.apretar('Guardar sin subcategoría');
  assert.equal(e.movimiento().categoria, '🐾 Mascotas',
    'el segundo intento, ya válido, sí se tomó');
  assert.equal(e.movimiento().estado, 'cerrado');
});

test('un nombre demasiado largo tampoco se acepta', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('a'.repeat(50));
  assert.match(e.ultimoTexto(), /Ese nombre no sirve/);
});

// Caso real de este proyecto: se probó "Añadir categoría" y no funcionó,
// porque el nombre se escribió después de la ventana de espera (10 minutos,
// la misma que la nota), que ya había caducado en silencio.
test('la espera de categoría nueva dura más que la de la nota', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('➕ Añadir categoría');
  // Más de los 10 minutos de la nota, pero dentro de la ventana de categoría.
  e.adelantarReloj(20 * 60 * 1000);
  e.contexto.manejarTexto('💸 Carrete');

  assert.equal(e.movimiento().categoria, '💸 Carrete',
    'a los 20 minutos la nota ya habría caducado, pero la categoría no');
});

test('pasada su propia ventana, la espera de categoría también caduca', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('➕ Añadir categoría');
  e.adelantarReloj(31 * 60 * 1000);
  e.contexto.manejarTexto('💸 Carrete');

  assert.match(e.ultimoTexto(), /No entendí/, 'ya caducada, se trata como texto normal');
  assert.equal(e.movimiento().categoria, '', 'no quedó ninguna categoría puesta');
});

// El otro problema real: si en medio de la espera el usuario escribe un
// comando (por ejemplo para consultar el saldo mientras piensa el nombre),
// ese comando no se puede convertir en el nombre de la categoría.
test('un comando escrito durante la espera no se toma como nombre de categoría', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('/saldo');

  assert.notEqual(e.movimiento().categoria, '/saldo');
  assert.equal(e.categoriasPersonalizadas().length, 0,
    'no debe haber quedado guardada una categoría llamada "/saldo"');

  // La espera se cancela, no queda colgada esperando un nombre para siempre.
  e.contexto.manejarTexto('💸 Carrete');
  assert.match(e.ultimoTexto(), /No entendí/,
    'sin el botón de nuevo, el segundo texto ya no se toma como nombre');
});

test('lo mismo aplica a la espera de subcategoría nueva', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('💸 Carrete');
  e.apretar('➕ Añadir subcategoría');

  e.adelantarReloj(20 * 60 * 1000);
  e.contexto.manejarTexto('Asado');

  assert.equal(e.movimiento().subcategoria, 'Asado');
});

// Telegram manda los mensajes con parse_mode HTML, así que un "&", "<" o ">"
// suelto hace que rechace el mensaje ENTERO con "can't parse entities". El
// síntoma no se parece a la causa: el gasto se queda sin respuesta y no hay
// nada escrito que apunte al nombre de la categoría.
//
// Antes esto no podía pasar, porque las categorías venían de un archivo
// nuestro. Desde que el usuario las escribe desde el bot, sí.
test('una categoría con & no rompe el mensaje que la muestra', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('Café & Bar');
  e.apretar('Guardar sin subcategoría');

  const texto = e.ultimoTexto();
  assert.match(texto, /Café &amp; Bar/, 'el & tiene que ir escapado');
  assert.equal(/&(?!amp;|lt;|gt;)/.test(texto), false,
    'no puede quedar ningún & suelto en el mensaje');

  // Y en la hoja se guarda el nombre de verdad, sin escapar: el escapado es
  // solo para mostrarlo, no parte del dato.
  assert.equal(e.movimiento().categoria, 'Café & Bar');
});

test('una subcategoría con < o > tampoco rompe el mensaje', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('🍴 Alimentación');
  e.apretar('➕ Añadir subcategoría');
  e.contexto.manejarTexto('Menú <10.000>');

  const texto = e.ultimoTexto();
  assert.equal(/<(?!\/?(b|i|code|u|s|a|pre)[ >])/.test(texto), false,
    'no puede quedar un < suelto que Telegram lea como etiqueta');
  assert.equal(e.movimiento().subcategoria, 'Menú <10.000>');
});

// El informe recorre otro camino distinto al del gasto, y también muestra
// nombres de categoría.
test('los informes tampoco rompen con una categoría con &', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el ' + hoyComoDdMmAaaa() + ' 10:00.');

  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('Café & Bar');
  e.apretar('Guardar sin subcategoría');

  e.contexto.manejarTexto('/semana');

  const informes = e.enviados
    .filter((x) => x.cuerpo && x.cuerpo.text)
    .map((x) => x.cuerpo.text)
    .filter((t) => t.includes('Café'));

  assert.ok(informes.length, 'el informe tiene que mencionar la categoría');
  for (const texto of informes) {
    assert.equal(/&(?!amp;|lt;|gt;)/.test(texto), false,
      'el informe dejó un & suelto');
  }
});

/**
 * Hoy en el formato del banco. El informe de la semana solo mira los últimos
 * 7 días, así que una fecha fija de agosto de 2026 quedaría fuera y el informe
 * saldría vacío sin que la prueba lo note.
 */
function hoyComoDdMmAaaa() {
  const d = new Date();
  const dd = (n) => String(n).padStart(2, '0');
  return `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Escribir el nombre de una categoría que ya existe es fácil: nadie se acuerda
// de memoria de las doce que trae el sistema. Antes eso guardaba una fila
// repetida y respondía "(categoría nueva)", que era falso.
test('escribir el nombre de una categoría que ya existe no la duplica', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');

  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('🍴 Alimentación');

  assert.match(e.ultimoTexto(), /ya la tenías/, 'no puede decir que es nueva');
  assert.equal(e.categoriasPersonalizadas().length, 0,
    'no debe guardar una fila para algo que ya estaba');

  // Y se usa igual, que es lo que el usuario quería.
  const botones = (e.ultimoTeclado() || []).flat().map((b) => b.text);
  assert.ok(botones.includes('🛒 Supermercado'),
    'muestra las subcategorías que esa categoría ya tenía');

  e.apretar('🛒 Supermercado');
  assert.equal(e.movimiento().categoria, '🍴 Alimentación');
  assert.equal(e.movimiento().subcategoria, '🛒 Supermercado');
});

test('la misma categoría creada dos veces solo se guarda una', () => {
  const e = crearEntorno();
  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $4.500 con cargo a ' +
    'Cuenta ****1234 en ALMACEN DON JOSE el 01/08/2026 10:00.');
  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('💸 Carrete');
  e.apretar('Guardar sin subcategoría');

  entra(e, 'Cargo en cuenta',
    'Te informamos que se ha realizado una compra por $9.000 con cargo a ' +
    'Cuenta ****1234 en OTRO LUGAR el 02/08/2026 10:00.', 'otro');
  e.apretar('➕ Añadir categoría');
  e.contexto.manejarTexto('💸 Carrete');

  assert.equal(e.categoriasPersonalizadas().length, 1,
    'la segunda vez no agrega una fila nueva');
  assert.match(e.ultimoTexto(), /ya la tenías/);
});
