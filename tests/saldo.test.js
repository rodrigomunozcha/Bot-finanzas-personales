const test = require('node:test');
const assert = require('node:assert');
const { crearEntorno } = require('./ayuda/entorno.js');
const { MESES } = require('../apps_script/parsers.js');

const nuevos = (e) => e.enviados.filter((x) => x.metodo === 'sendMessage');

/** Fecha de mañana en el formato del banco, para que sea posterior al saldo. */
function manana() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const dd = (n) => String(n).padStart(2, '0');
  return `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// El nombre del mes en letras, para el formato de fecha de la transferencia
// enviada ("11 de agosto de 2026"). Se saca de la misma tabla que usa el
// lector, en vez de escribirlo aparte, para no desviarse si mañana cae en otro
// mes: fijar "agosto" a mano habría hecho fallar la prueba el día que alguien
// la corriera un 31 de un mes distinto.
function nombreDelMes(d) {
  const numero = String(d.getMonth() + 1).padStart(2, '0');
  return Object.keys(MESES).find((nombre) => MESES[nombre] === numero);
}

/** Fecha de mañana en el formato escrito de la transferencia enviada. */
function mananaEscrita() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getDate()} de ${nombreDelMes(d)} de ${d.getFullYear()}`;
}

function conSaldo(monto = 1000000) {
  const e = crearEntorno();
  e.contexto.manejarTexto('/saldo ' + monto);
  return e;
}

test('"+900000 sueldo" queda como ingreso y pregunta el tipo', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('+900000 sueldo');

  const mov = e.movimiento();
  assert.equal(mov.tipo, 'ingreso');
  assert.equal(mov.monto, 900000);
  assert.equal(mov.comercio, 'sueldo');

  const botones = (e.ultimoTeclado() || []).flat().map((b) => b.text);
  assert.ok(botones.includes('💼 Trabajo'), 'usa el árbol de ingresos');
  assert.equal(botones.includes('🍴 Alimentación'), false);
});

// Confundirse en el signo arruina el balance entero.
test('sin el signo más es un gasto, no un ingreso', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('900000 sueldo');
  assert.equal(e.movimiento().tipo, 'gasto');
});

test('/saldo fija el monto y después lo muestra', () => {
  const e = conSaldo(1055792);
  assert.match(e.ultimoTexto(), /Saldo fijado en <b>\$1\.055\.792/);

  e.contexto.manejarTexto('/saldo');
  assert.match(e.ultimoTexto(), /\$1\.055\.792<\/b> en la cuenta/);
});

test('sin saldo declarado explica cómo declararlo', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('/saldo');
  assert.match(e.ultimoTexto(), /\/saldo 1055792/);
});

// Estas reglas son la parte delicada: cada tipo de movimiento toca la cuenta de
// forma distinta, y equivocarse hace que el saldo se desvíe sin avisar.
test('una compra con débito descuenta de la cuenta', () => {
  const e = conSaldo(1000000);
  e.contexto.procesarMensaje({
    getId: () => 'x1', getSubject: () => 'Cargo en cuenta',
    getPlainBody: () => 'Te informamos que se ha realizado una compra por $12.500 ' +
      'con cargo a Cuenta ****1234 en JUMBO CENTRAL el ' + manana() + ' 13:20.',
  });
  e.apretar('Sí, guardar así');

  assert.equal(e.contexto.calcularSaldo().actual, 987500);
});

// La primera versión de calcularSaldo solo restaba el débito, y una
// transferencia enviada de verdad no se contaba: /saldo daba un número
// mayor al real hasta que se corregía a mano. Sale de la cuenta al instante,
// igual que el débito.
test('una transferencia enviada descuenta de la cuenta, igual que el débito', () => {
  const e = conSaldo(1000000);
  e.contexto.procesarMensaje({
    getId: () => 'x1', getSubject: () => 'Transferencia a Terceros',
    getPlainBody: () => 'Monto $40.000 Fecha y Hora: ' + mananaEscrita() + ' 13:20',
  });
  e.apretar('🏠 Hogar');
  e.apretar('Guardar sin subcategoría');

  assert.equal(e.contexto.calcularSaldo().actual, 960000);
});

// Contar la compra Y el pago de la tarjeta restaría dos veces la misma plata.
test('una compra con crédito no descuenta hasta que se paga la tarjeta', () => {
  const e = conSaldo(1000000);
  e.contexto.procesarMensaje({
    getId: () => 'x1', getSubject: () => 'Compra con Tarjeta de Crédito',
    getPlainBody: () => 'Te informamos que se ha realizado una compra por $50.000 ' +
      'con cargo a Tarjeta de Crédito ****1234 en SODIMAC el 01/08/2026 13:20.',
  });
  e.apretar('Sí, guardar así');

  assert.equal(e.contexto.calcularSaldo().actual, 1000000, 'la cuenta no se mueve');
});

test('el giro descuenta, pero el efectivo que se gasta después no', () => {
  const e = conSaldo(1000000);
  e.contexto.manejarTexto('50000 giro');
  assert.equal(e.contexto.calcularSaldo().actual, 950000);

  e.contexto.manejarTexto('12000 efectivo almuerzo');
  e.apretar('🍴 Alimentación');
  e.apretar('Guardar sin subcategoría');

  assert.equal(e.contexto.calcularSaldo().actual, 950000,
    'esa plata ya había salido de la cuenta al girarla');
});

test('un ingreso suma a la cuenta', () => {
  const e = conSaldo(1000000);
  e.contexto.manejarTexto('+900000 sueldo');
  e.apretar('💼 Trabajo');
  e.apretar('Guardar sin subcategoría');

  assert.equal(e.contexto.calcularSaldo().actual, 1900000);
});

test('lo anterior a la fecha del saldo no se vuelve a contar', () => {
  const e = crearEntorno();
  e.contexto.procesarMensaje({
    getId: () => 'viejo', getSubject: () => 'Cargo en cuenta',
    getPlainBody: () => 'Te informamos que se ha realizado una compra por $99.999 ' +
      'con cargo a Cuenta ****1234 en ANTIGUO el 01/01/2020 10:00.',
  });
  e.apretar('🍴 Alimentación');
  e.apretar('Guardar sin subcategoría');

  e.contexto.manejarTexto('/saldo 1000000');
  assert.equal(e.contexto.calcularSaldo().actual, 1000000,
    'el saldo declarado ya incluye lo de antes');
});

test('el saldo advierte que es un cálculo, no el dato del banco', () => {
  const e = conSaldo();
  e.contexto.manejarTexto('/saldo');
  assert.match(e.ultimoTexto(), /Es un cálculo, no el saldo del banco/);
});

test('/ingreso enseña el signo más antes que nada', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('/ingreso');
  assert.match(e.ultimoTexto(), /\+900000 sueldo/);
  assert.match(e.ultimoTexto(), /Sin él lo anoto como gasto/);
});
