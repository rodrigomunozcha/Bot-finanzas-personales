const test = require('node:test');
const assert = require('node:assert');
const t = require('../apps_script/tarjeta.js');

// Estructura del correo real del 01/08/2026. El numero de cuenta y el de
// tarjeta ya vienen enmascarados por el propio banco.
const PAGO = {
  asunto: 'Comprobante pago Tarjeta de Crédito Internacional',
  cuerpo: `Estimado(a): Nombre
Te informamos que se ha efectuado el pago de la tarjeta de crédito internacional en forma exitosa con el siguiente detalle:

Origen
Tipo de cuenta 	Cuenta Corriente
Nº de cuenta

Destino
Tipo de tarjeta 	Tarjeta de Crédito
Nº de tarjeta 	************
Utilizado 	USD$0,00

Detalle
Monto pagado 	USD$150,00
Tipo de cambio 	$949
Monto 	$142.403

Fecha y Hora:

sábado 01 de agosto de 2026 08:47`,
};

test('lee el pago de tarjeta internacional', () => {
  const r = t.leerPagoTarjeta(PAGO.asunto, PAGO.cuerpo);
  assert.equal(r.tipo, 'movimiento_interno', 'el pago no es un gasto nuevo');
  assert.equal(r.montoUsd, 150);
  assert.equal(r.montoClp, 142403);
  assert.equal(r.saldaTodo, true, 'Utilizado en 0 significa que quedo al dia');
  assert.equal(r.fechaHora, '2026-08-01T08:47');
});

// 150 x 949 = 142.350, pero del bolsillo salieron 142.403. El tipo de cambio
// que muestra el correo viene redondeado a peso entero y no sirve para calcular.
test('la tasa se deduce de los montos, no del tipo de cambio mostrado', () => {
  const r = t.leerPagoTarjeta(PAGO.asunto, PAGO.cuerpo);
  assert.equal(r.tasaMostrada, 949);
  assert.ok(Math.abs(r.tasaEfectiva - 949.3533) < 0.001);

  const conTasaMostrada = Math.round(r.montoUsd * r.tasaMostrada);
  assert.equal(conTasaMostrada, 142350);
  assert.equal(r.montoClp - conTasaMostrada, 53, 'usar la tasa mostrada erraria por $53');
});

test('pago total: cierra todas las pendientes y la suma calza al peso', () => {
  const pago = t.leerPagoTarjeta(PAGO.asunto, PAGO.cuerpo);
  const pendientes = [
    { id: 'a', monto: 20, fechaHora: '2026-07-10T10:00' },
    { id: 'b', monto: 100, fechaHora: '2026-07-15T10:00' },
    { id: 'c', monto: 30, fechaHora: '2026-07-20T10:00' },
  ];

  const { cerradas, siguenPendientes } = t.repartirPago(pago, pendientes);
  assert.equal(siguenPendientes.length, 0);
  assert.equal(cerradas.length, 3);

  const suma = cerradas.reduce((n, c) => n + c.montoClp, 0);
  assert.equal(suma, 142403, 'el total debe ser exactamente lo que cobro el banco');
});

test('pago parcial: cierra las mas antiguas hasta donde alcanza', () => {
  const pago = { montoUsd: 50, montoClp: 47468, tasaEfectiva: 949.36, saldaTodo: false };
  const pendientes = [
    { id: 'b', monto: 100, fechaHora: '2026-07-15T10:00' },
    { id: 'a', monto: 20, fechaHora: '2026-07-10T10:00' },
    { id: 'c', monto: 30, fechaHora: '2026-07-20T10:00' },
  ];

  const { cerradas, siguenPendientes } = t.repartirPago(pago, pendientes);
  assert.deepEqual(cerradas.map((c) => c.id), ['a', 'c'], 'las dos mas antiguas que caben');
  assert.deepEqual(siguenPendientes.map((c) => c.id), ['b'], 'la de US$100 no cabia');
});

test('del correo de pago no se extrae ningun dato de tarjeta ni de cuenta', () => {
  const r = t.leerPagoTarjeta(PAGO.asunto, PAGO.cuerpo);
  const serializado = JSON.stringify(r);
  assert.equal(serializado.includes('*'), false);
  assert.equal(/cuenta/i.test(serializado), false);
});

test('otro correo del banco no se confunde con un pago de tarjeta', () => {
  assert.equal(t.leerPagoTarjeta('Cargo en cuenta', 'compra por $1.000'), null);
});
