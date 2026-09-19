const test = require('node:test');
const assert = require('node:assert');
const p = require('../apps_script/parsers.js');

// Estructura del correo real. El monto, el comercio, los dígitos de la
// cuenta y la hora son inventados: la forma del texto es lo único que estas
// pruebas necesitan, y publicar una compra de verdad no aporta nada.
const COMPRA_DEBITO = {
  asunto: 'Cargo en cuenta',
  cuerpo: 'Te informamos que se ha realizado una compra por $12.500 con cargo a ' +
    'Cuenta ****1234 en JUMBO CENTRAL el 01/08/2026 13:20.\n' +
    'Revisa Saldos y Movimientos en App Mi Banco o Banco en Línea.',
};

// Estructura del correo real, con los datos identificatorios reemplazados por
// valores inventados. Las pruebas necesitan que el cuerpo CONTENGA datos
// sensibles para verificar que el lector no los extrae, pero no hay ninguna
// razon para que sean los verdaderos.
const TRANSFERENCIA = {
  asunto: 'Aviso de transferencia de fondos',
  cuerpo: 'Comprobante de transferencia electrónica de fondos Estimado(a): Nombre Apellido ' +
    'Te informamos que nuestro(a) cliente Jessica Veronica Perez ha efectuado una ' +
    'transferencia de fondos a tu cuenta con el siguiente detalle: Datos de cuenta ' +
    'Fecha Asunto 01/08/2026 Maleta y taxi Datos de destinatario Nombre y Apellido Rut ' +
    'Email Banco Cuenta destino Nombre Apellido 11111111-1 correo.falso@example.com ' +
    'Banco Chile/Edwards Cuenta Corriente 00-000-00000-00 Monto $185.000',
};

test('compra con debito: extrae los campos que se usan', () => {
  const r = p.leerCorreo(COMPRA_DEBITO.asunto, COMPRA_DEBITO.cuerpo);
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.monto, 12500);
  assert.equal(r.moneda, 'CLP');
  assert.equal(r.montoClp, 12500);
  assert.equal(r.pendienteConversion, false);
  assert.equal(r.medioPago, 'debito');
  assert.equal(r.comercio, 'JUMBO CENTRAL');
  assert.equal(r.fechaHora, '2026-08-01T13:20');
});

// Se devolvian y no los usaba nadie. Un dato de la cuenta que el sistema no
// necesita no tiene por que salir del lector.
test('los cuatro dígitos de la cuenta no salen del lector', () => {
  const r = p.leerCorreo(COMPRA_DEBITO.asunto, COMPRA_DEBITO.cuerpo);
  assert.equal(r.cuenta, undefined);
  assert.equal(JSON.stringify(r).includes('1234'), false);
});

test('el asunto distingue credito de debito con el mismo cuerpo', () => {
  const r = p.leerCorreo('Compra con Tarjeta de Crédito', COMPRA_DEBITO.cuerpo);
  assert.equal(r.medioPago, 'credito');
  assert.equal(r.monto, 12500);
});

// Estructura del correo real de una compra con tarjeta de credito, con los
// valores cambiados. La redaccion es distinta a la del debito: aca NO dice
// "cargo a". La version anterior de esta prueba lo inventaba por analogia con
// el correo de debito, pasaba, y no probaba nada: en produccion ninguna compra
// con credito se leyo jamas.
const COMPRA_CREDITO = {
  asunto: 'Compra con Tarjeta de Crédito',
  cuerpo: 'Te informamos que se ha realizado una compra por US$49,00 con Tarjeta de ' +
    'Crédito ****1234 en TIENDA* SUSCRIPCION el 01/08/2026 03:22.\n' +
    'Revisa Saldos y Movimientos en App Mi Banco o Banco en Línea.\n' +
    'Más información 600 000 0000.',
};

test('compra en dolares queda pendiente de conversion, sin estimar pesos', () => {
  const r = p.leerCorreo(COMPRA_CREDITO.asunto, COMPRA_CREDITO.cuerpo);
  assert.equal(r.moneda, 'USD');
  assert.equal(r.monto, 49);
  assert.equal(r.montoClp, null, 'no se debe inventar un tipo de cambio');
  assert.equal(r.pendienteConversion, true);
});

test('comercio que contiene la palabra "el" no corta el nombre', () => {
  const cuerpo = 'Te informamos que se ha realizado una compra por $8.990 con cargo a ' +
    'Cuenta ****1234 en RESTAURANT EL BOSQUE el 02/08/2026 21:15.';
  const r = p.leerCorreo('Cargo en cuenta', cuerpo);
  assert.equal(r.comercio, 'RESTAURANT EL BOSQUE');
  assert.equal(r.fechaHora, '2026-08-02T21:15');
});

test('transferencia recibida: solo monto y fecha', () => {
  const r = p.leerCorreo(TRANSFERENCIA.asunto, TRANSFERENCIA.cuerpo);
  assert.equal(r.tipo, 'entrada', 'no se asume que sea ingreso hasta que el usuario lo diga');
  assert.equal(r.monto, 185000);
  assert.equal(r.moneda, 'CLP');
  assert.equal(r.fechaHora, '2026-08-01');
  assert.equal(r.comercio, 'Transferencia recibida');
});

// Antes se guardaba el primer nombre de quien enviaba y la glosa que habia
// escrito. Los dos se sacaron: el nombre es de alguien que no eligio estar en
// este sistema, y la glosa es texto libre donde cabe cualquier cosa.
test('de quien envía no queda ni el primer nombre, ni lo que escribió', () => {
  const r = p.leerCorreo(TRANSFERENCIA.asunto, TRANSFERENCIA.cuerpo);
  assert.equal(r.remitente, undefined);
  assert.equal(r.glosa, undefined);
  const serializado = JSON.stringify(r);
  assert.equal(serializado.includes('Jessica'), false);
  assert.equal(serializado.includes('Maleta y taxi'), false);
});

test('transferencia: no se extrae ningun dato identificatorio', () => {
  const r = p.leerCorreo(TRANSFERENCIA.asunto, TRANSFERENCIA.cuerpo);
  const serializado = JSON.stringify(r);
  for (const dato of ['11111111-1', 'correo.falso@example.com', '00-000-00000-00', 'Perez']) {
    assert.equal(serializado.includes(dato), false, `se filtro un dato sensible: ${dato}`);
  }
});

test('el punto en pesos es separador de miles, nunca decimal', () => {
  assert.equal(p.normalizarMonto('12.500', 'CLP'), 12500);
  assert.equal(p.normalizarMonto('1.234.567', 'CLP'), 1234567);
  assert.equal(p.normalizarMonto('185.000', 'CLP'), 185000);
});

test('en moneda extranjera se distingue coma decimal de punto decimal', () => {
  assert.equal(p.normalizarMonto('49,00', 'USD'), 49);
  assert.equal(p.normalizarMonto('49.00', 'USD'), 49);
  assert.equal(p.normalizarMonto('1.234,56', 'USD'), 1234.56);
});

test('un correo desconocido no se inventa: devuelve null', () => {
  assert.equal(p.leerCorreo('Tu estado de cuenta está disponible', 'Ingresa a la app.'), null);
  assert.equal(p.leerCorreo('Cargo en cuenta', 'Texto que no calza con nada.'), null);
});

// El banco manda el mismo correo con la tabla aplanada de dos formas. Con la
// segunda, el lector anterior fallaba entero y la transferencia se perdía.
// Todos los datos de abajo son inventados.
const TRANSFERENCIA_ETIQUETADA = {
  asunto: 'Aviso de transferencia de fondos',
  cuerpo: `Comprobante de transferencia electrónica de fondos
Estimado(a): Nombre Apellido
Te informamos que nuestro(a) cliente Jessica Veronica Perez ha efectuado una transferencia de fondos a tu cuenta con el siguiente detalle:
Datos de cuenta
Fecha 	01/08/2026
Asunto 	Maleta y taxi
Datos de destinatario
Nombre y Apellido 	Nombre Apellido
Rut 	12345678-9
Email 	alguien@example.com
Banco 	Banco Chile/Edwards
Cuenta destino 	Cuenta Corriente
00-000-00000-00
Monto 	$185.000
Número de comprobante 	TEFMBCO0000000000000000000000

Fecha y Hora:

sábado 01 de agosto de 2026 08:13`,
};

test('lee la transferencia con la tabla etiquetada valor por valor', () => {
  const r = p.leerCorreo(TRANSFERENCIA_ETIQUETADA.asunto, TRANSFERENCIA_ETIQUETADA.cuerpo);
  assert.ok(r, 'no reconoció el correo');
  assert.equal(r.tipo, 'entrada');
  assert.equal(r.monto, 185000);
  assert.equal(r.fechaHora, '2026-08-01', 'el patrón de detalle sigue dando la fecha');
});

test('el monto se lee aunque después venga el número de comprobante', () => {
  const r = p.leerCorreo(TRANSFERENCIA_ETIQUETADA.asunto, TRANSFERENCIA_ETIQUETADA.cuerpo);
  assert.equal(r.monto, 185000, 'anclar el monto al final rompía este formato');
});

test('de la tabla etiquetada tampoco se extrae ningún dato identificatorio', () => {
  const r = p.leerCorreo(TRANSFERENCIA_ETIQUETADA.asunto, TRANSFERENCIA_ETIQUETADA.cuerpo);
  const serializado = JSON.stringify(r);
  for (const dato of ['12345678-9', 'alguien@example.com', '00-000-00000-00',
    'TEFMBCO0000000000000000000000', 'Perez']) {
    assert.equal(serializado.includes(dato), false, `se filtró: ${dato}`);
  }
});


// --- Transferencia enviada a terceros --------------------------------------
//
// Estructura del correo real, con TODOS los valores identificatorios
// reemplazados por inventados. El cuerpo tiene que traer datos sensibles para
// poder verificar que el lector no los extrae, pero ninguno es el verdadero.
const TRANSFERENCIA_ENVIADA = {
  asunto: 'Comprobante de Transferencia a terceros',
  cuerpo: `Comprobante de Transferencia a terceros
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

martes 11 de agosto de 2026 17:08`,
};

test('transferencia enviada: monto, mensaje y fecha', () => {
  const r = p.leerCorreo(TRANSFERENCIA_ENVIADA.asunto, TRANSFERENCIA_ENVIADA.cuerpo);
  assert.ok(r, 'no reconoció el correo');
  assert.equal(r.tipo, 'gasto', 'la plata sale de la cuenta, es un gasto');
  assert.equal(r.monto, 40000);
  assert.equal(r.moneda, 'CLP');
  assert.equal(r.montoClp, 40000);
  assert.equal(r.medioPago, 'transferencia');
  assert.equal(r.fechaHora, '2026-08-11T17:08');
});

// Esta prueba existe por un error real de este proyecto. Una versión anterior
// del lector tomaba el campo Mensaje y lo usaba como nombre de comercio, y en
// un correo real ese mensaje era la dirección de una vivienda, escrita
// para que quien recibía el pago supiera quién le había pagado: iba a
// escribirse en la hoja, en el aprendizaje, en Telegram y en el respaldo.
// El mensaje es texto libre escrito para un tercero. No se lee, nunca.
test('el mensaje de la transferencia no se lee jamás', () => {
  const conDireccion = TRANSFERENCIA_ENVIADA.cuerpo
    .replace('Arriendo depto', 'Depto 000 Calle Inventada, Juan Perez, +56900000000');
  const r = p.leerCorreo(TRANSFERENCIA_ENVIADA.asunto, conDireccion);

  assert.equal(r.comercio, 'Transferencia enviada');
  const serializado = JSON.stringify(r);
  for (const dato of ['Depto', 'Calle Inventada', 'Juan', 'Perez', '56900000000']) {
    assert.equal(serializado.includes(dato), false, `se filtró del mensaje: ${dato}`);
  }
});

test('transferencia enviada: no queda ningún dato del destinatario', () => {
  const r = p.leerCorreo(TRANSFERENCIA_ENVIADA.asunto, TRANSFERENCIA_ENVIADA.cuerpo);
  const serializado = JSON.stringify(r);
  for (const dato of ['11111111-1', '00-000-00000-00', '00-999-99999-99',
    'Otra', 'Persona', 'Inventada', 'Banco Ejemplo', 'Cuenta Vista', 'Arriendo']) {
    assert.equal(serializado.includes(dato), false, `se filtró un dato sensible: ${dato}`);
  }
});

test('la fecha escrita con el mes en palabras se convierte a formato ordenable', () => {
  assert.equal(p.normalizarFechaLarga('11', 'agosto', '2026', '17:08'), '2026-08-11T17:08');
  assert.equal(p.normalizarFechaLarga('1', 'enero', '2027', '9:05'), '2027-01-01T09:05');
  assert.equal(p.normalizarFechaLarga('30', 'Septiembre', '2026', null), '2026-09-30');
  assert.equal(p.normalizarFechaLarga('30', 'setiembre', '2026', null), '2026-09-30');
  assert.equal(p.normalizarFechaLarga('5', 'nosequé', '2026', '10:00'), null);
});

// Los dos correos hablan de transferencias y traen la palabra "Monto". Si el
// asunto no los separara, una enviada se registraría como plata que entró.
test('no se confunde una transferencia enviada con una recibida', () => {
  const enviada = p.leerCorreo(TRANSFERENCIA_ENVIADA.asunto, TRANSFERENCIA_ENVIADA.cuerpo);
  assert.equal(enviada.tipo, 'gasto');

  const recibida = p.leerCorreo(TRANSFERENCIA.asunto, TRANSFERENCIA.cuerpo);
  assert.equal(recibida.tipo, 'entrada');

  assert.equal(p.leerTransferenciaEnviada(TRANSFERENCIA.asunto, TRANSFERENCIA.cuerpo), null);
  assert.equal(
    p.leerTransferenciaRecibida(TRANSFERENCIA_ENVIADA.asunto, TRANSFERENCIA_ENVIADA.cuerpo),
    null
  );
});

// --- Bug real: el asunto no era el que se asumió -----------------------
//
// El primer correo de ejemplo que se usó para escribir este lector traía como
// primera línea "Comprobante de Transferencia a terceros", y se asumió que
// esa era la línea de asunto de Gmail. Era el encabezado de ADENTRO del
// cuerpo. El asunto real, confirmado contra la hoja de no entendidos donde
// las transferencias reales quedaron sin reconocer, es "Transferencia a
// Terceros", sin "Comprobante de". Con el asunto viejo, ninguna transferencia
// enviada se reconocía nunca.
test('el asunto real de Gmail es "Transferencia a Terceros", sin "Comprobante de"', () => {
  const cuerpo = `Comprobante de Transferencia a terceros
Estimado(a): Nombre Inventado
Monto 	$8.950
Mensaje 	Algo

Fecha y Hora:

martes 11 de agosto de 2026 17:08`;

  const r = p.leerCorreo('Transferencia a Terceros', cuerpo);
  assert.ok(r, 'con el asunto real, el correo tiene que reconocerse');
  assert.equal(r.monto, 8950);
});

// --- Bug real: dos formatos de fecha, no uno --------------------------
//
// El banco manda la fecha de dos formas y las dos son reales: se vieron el
// mismo mes, en transferencias distintas.
test('fecha sin coma y en 24 horas', () => {
  const cuerpo = 'Monto $8.950 Fecha y Hora: martes 11 de agosto de 2026 17:08';
  const r = p.leerCorreo('Transferencia a Terceros', cuerpo);
  assert.equal(r.fechaHora, '2026-08-11T17:08');
});

test('fecha con comas y en 12 horas con a. m. / p. m.', () => {
  const manana = 'Monto $8.950 Fecha y Hora: Sábado, 15 de agosto de 2026, 9:33 a. m.';
  assert.equal(
    p.leerCorreo('Transferencia a Terceros', manana).fechaHora,
    '2026-08-15T09:33'
  );

  const tarde = 'Monto $8.950 Fecha y Hora: Sábado, 15 de agosto de 2026, 9:33 p. m.';
  assert.equal(
    p.leerCorreo('Transferencia a Terceros', tarde).fechaHora,
    '2026-08-15T21:33'
  );
});

test('el mediodía y la medianoche en 12 horas se convierten bien', () => {
  assert.equal(p.normalizarFechaLarga('1', 'enero', '2026', '12:00', 'p. m.'),
    '2026-01-01T12:00', 'las 12 p.m. son mediodía, no 24:00');
  assert.equal(p.normalizarFechaLarga('1', 'enero', '2026', '12:00', 'a. m.'),
    '2026-01-01T00:00', 'las 12 a.m. son medianoche, no 12:00');
});

test('sin a. m. / p. m. la hora se toma tal cual, como 24 horas', () => {
  assert.equal(p.normalizarFechaLarga('1', 'enero', '2026', '17:08', undefined),
    '2026-01-01T17:08');
});

test('el comercio de una compra con crédito sale entero, asterisco incluido', () => {
  const r = p.leerCorreo(COMPRA_CREDITO.asunto, COMPRA_CREDITO.cuerpo);
  assert.equal(r.comercio, 'TIENDA* SUSCRIPCION');
  assert.equal(r.medioPago, 'credito');
  assert.equal(r.fechaHora, '2026-08-01T03:22');
});

// La redacción del débito no puede romperse al aceptar la del crédito.
test('la compra con débito sigue leyéndose igual', () => {
  const r = p.leerCorreo(COMPRA_DEBITO.asunto, COMPRA_DEBITO.cuerpo);
  assert.equal(r.comercio, 'JUMBO CENTRAL');
  assert.equal(r.medioPago, 'debito');
  assert.equal(r.monto, 12500);
});

// El filtro que separa un movimiento de una campaña publicitaria.
test('un correo con monto parece movimiento, uno sin monto no', () => {
  assert.equal(p.pareceMovimiento('compra por $12.500 en JUMBO'), true);
  assert.equal(p.pareceMovimiento('una compra por US$49,00'), true);
  assert.equal(p.pareceMovimiento('Monto USD 150'), true);
  assert.equal(p.pareceMovimiento('Protege tus tarjetas en cada compra'), false);
  assert.equal(p.pareceMovimiento('Ingresa a la app para revisar tu estado'), false);
  assert.equal(p.pareceMovimiento(''), false);
});

// Si un formato nuevo dejara de llegar a la bandeja, dejaríamos de enterarnos
// de que existe. Los cuatro de hoy se descubrieron justo así.
test('todos los formatos que faltan siguen pasando el filtro', () => {
  ['Te informamos que se ha realizado un giro por $40.000 el 01/08/2026 10:00.',
    'Se ha efectuado el pago de tu tarjeta por $250.000.',
    'Te informamos que se ha realizado una compra por US$12,50.'].forEach((cuerpo) => {
    assert.equal(p.pareceMovimiento(cuerpo), true, cuerpo);
  });
});

// --- Giro por cajero -------------------------------------------------------
//
// Estructura del correo real, con los valores cambiados. Es la misma frase de
// una compra con una diferencia que importa: no hay comercio.
const GIRO = {
  asunto: 'Giro con Tarjeta de Débito',
  cuerpo: 'Te informamos que se ha realizado un giro en Cajero por $15.000 con ' +
    'cargo a Cuenta ****1234 el 14/09/2026 17:08.\n' +
    'Revisa Saldos y Movimientos en App Mi Banco o Banco en Línea.\n' +
    'Más información 600 000 0000.',
};

test('el giro se lee como giro y no como gasto', () => {
  const r = p.leerCorreo(GIRO.asunto, GIRO.cuerpo);
  assert.equal(r.tipo, 'giro');
  assert.equal(r.monto, 15000);
  assert.equal(r.moneda, 'CLP');
  assert.equal(r.montoClp, 15000);
  assert.equal(r.medioPago, 'efectivo');
  assert.equal(r.fechaHora, '2026-09-14T17:08');
});

// El correo dice "Cajero" sin dirección, pero aunque la trajera no se leería:
// dónde estuvo una persona a una hora concreta es justo lo que no se toma.
test('del giro no sale de dónde se sacó la plata', () => {
  const r = p.leerCorreo(GIRO.asunto, GIRO.cuerpo);
  assert.equal(r.comercio, 'Giro por cajero');
  assert.equal(JSON.stringify(r).includes('1234'), false, 'ni los dígitos de la cuenta');
});

// --- Pago de la tarjeta en pesos -------------------------------------------
const PAGO_NACIONAL = {
  asunto: 'Pago de Tarjeta de Crédito Nacional',
  cuerpo: `Comprobante pago Tarjeta de Crédito Nacional
Estimado(a): Nombre Apellido
Te informamos que se ha efectuado el pago de la tarjeta de crédito nacional en forma exitosa con el siguiente detalle:

Origen
Tipo de cuenta 	Cuenta Corriente
N° de cuenta 	00-000-00000-00

Destino
Tipo de tarjeta Tipo 	Tarjeta de Crédito
N° de tarjeta Número 	************1234
Usado 	$0

Monto 	$250.000

Fecha y Hora:

Sábado, 29 de agosto 14:56 de 2026,

Transacción:
TRANSACCION000000`,
};

test('el pago de la tarjeta en pesos es movimiento interno, no gasto', () => {
  const r = p.leerCorreo(PAGO_NACIONAL.asunto, PAGO_NACIONAL.cuerpo);
  assert.equal(r.tipo, 'interno');
  assert.equal(r.montoClp, 250000);
  assert.equal(r.comercio, 'Pago tarjeta de crédito nacional');
});

// Este correo escribe la hora ENTRE el mes y el año, al revés que el del pago
// internacional. Un patrón con el orden fijo se comía la fecha entera.
test('la fecha se lee aunque la hora venga en medio', () => {
  assert.equal(
    p.fechaDelBloqueHora('Fecha y Hora: Sábado, 29 de agosto 14:56 de 2026,'),
    '2026-08-29T14:56');
  assert.equal(
    p.fechaDelBloqueHora('Fecha y Hora: sábado 01 de agosto de 2026 08:47'),
    '2026-08-01T08:47');
});

// "Nacional" está contenido en "Internacional". Son dos correos, dos montos y
// dos movimientos distintos, y confundirlos descuadra el saldo.
test('el pago nacional y el internacional no se confunden', () => {
  assert.equal(p.leerPagoNacional('Pago de Tarjeta de Crédito Internacional',
    PAGO_NACIONAL.cuerpo), null);
  assert.ok(p.leerPagoNacional(PAGO_NACIONAL.asunto, PAGO_NACIONAL.cuerpo));
});

// El monto del pago está en una fila llamada "Monto". El correo internacional
// tiene además "Monto pagado", que es otra cifra y en otra moneda.
test('el monto no se confunde con "Monto pagado"', () => {
  const r = p.leerPagoNacional(PAGO_NACIONAL.asunto,
    'Monto pagado US$150,00 Utilizado $0 Monto $250.000 ' +
    'Fecha y Hora: Sábado, 29 de agosto 14:56 de 2026,');
  assert.equal(r.montoClp, 250000);
});
