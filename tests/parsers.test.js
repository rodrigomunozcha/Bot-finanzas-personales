const test = require('node:test');
const assert = require('node:assert');
const p = require('../apps_script/parsers.js');

// Estructura del correo real, con todos los valores inventados.
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

test('compra con debito: extrae los cinco campos', () => {
  const r = p.leerCorreo(COMPRA_DEBITO.asunto, COMPRA_DEBITO.cuerpo);
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.monto, 12500);
  assert.equal(r.moneda, 'CLP');
  assert.equal(r.montoClp, 12500);
  assert.equal(r.pendienteConversion, false);
  assert.equal(r.medioPago, 'debito');
  assert.equal(r.cuenta, '1234');
  assert.equal(r.comercio, 'JUMBO CENTRAL');
  assert.equal(r.fechaHora, '2026-08-01T13:20');
});

test('el asunto distingue credito de debito con el mismo cuerpo', () => {
  const r = p.leerCorreo('Compra con Tarjeta de Crédito', COMPRA_DEBITO.cuerpo);
  assert.equal(r.medioPago, 'credito');
  assert.equal(r.monto, 12500);
});

test('compra en dolares queda pendiente de conversion, sin estimar pesos', () => {
  const cuerpo = 'Te informamos que se ha realizado una compra por US$49,00 con cargo a ' +
    'Tarjeta de Crédito ****1234 en OPENAI el 01/08/2026 03:22.';
  const r = p.leerCorreo('Compra con Tarjeta de Crédito', cuerpo);
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

test('transferencia recibida: monto, remitente y glosa', () => {
  const r = p.leerCorreo(TRANSFERENCIA.asunto, TRANSFERENCIA.cuerpo);
  assert.equal(r.tipo, 'entrada', 'no se asume que sea ingreso hasta que el usuario lo diga');
  assert.equal(r.monto, 185000);
  assert.equal(r.moneda, 'CLP');
  assert.equal(r.remitente, 'Jessica');
  assert.equal(r.glosa, 'Maleta y taxi');
  assert.equal(r.fechaHora, '2026-08-01');
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
  assert.equal(r.remitente, 'Jessica');
  assert.equal(r.glosa, 'Maleta y taxi');
  assert.equal(r.fechaHora, '2026-08-01');
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

test('el número de comprobante se tacha al guardar un correo no entendido', () => {
  const censurado = p.censurarDatosPersonales(
    'Número de comprobante TEFMBCO0000000000000000000000 y monto $185.000');
  assert.equal(censurado.includes('TEFMBCO0000000000000000000000'), false);
  assert.match(censurado, /\$185\.000/);
});
