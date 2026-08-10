const test = require('node:test');
const assert = require('node:assert');
const { crearEntorno } = require('./ayuda/entorno.js');

const hoy = () => new Date().toISOString().substring(0, 10);
const haceDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
};

const gasto = (comercio, clp, dia, categoria = '🍴 Alimentación', extra = {}) =>
  Object.assign({
    tipo: 'gasto', comercio, monto: clp, moneda: 'CLP', montoClp: clp,
    fechaHora: dia + 'T12:00', categoria,
  }, extra);

test('suma los gastos del período y los reparte por categoría', () => {
  const e = crearEntorno();
  const r = e.contexto.calcularResumen([
    gasto('JUMBO', 10000, hoy()),
    gasto('COPEC', 30000, hoy(), '🚖 Transporte'),
    gasto('LIDER', 5000, hoy()),
  ], haceDias(6), hoy());

  assert.equal(r.total, 45000);
  assert.equal(r.cuenta, 3);
  assert.equal(r.categorias[0].nombre, '🚖 Transporte');
  assert.equal(r.categorias[0].total, 30000);
  assert.equal(r.categorias[1].total, 15000);
});

test('lo que quedó fuera del período no se cuenta', () => {
  const e = crearEntorno();
  const r = e.contexto.calcularResumen([
    gasto('JUMBO', 10000, hoy()),
    gasto('VIEJO', 99999, haceDias(40)),
  ], haceDias(6), hoy());

  assert.equal(r.total, 10000);
});

// Los reembolsos, los ingresos y el pago de la tarjeta no son gasto nuevo.
test('solo cuentan los gastos, no los otros movimientos', () => {
  const e = crearEntorno();
  const r = e.contexto.calcularResumen([
    gasto('JUMBO', 10000, hoy()),
    gasto('Pago tarjeta', 142403, hoy(), '⛔ Balance (NO CONSIDERAR)', { tipo: 'interno' }),
    gasto('Jessica', 185000, hoy(), '', { tipo: 'reembolso' }),
    gasto('Sueldo', 900000, hoy(), '💼 Trabajo', { tipo: 'ingreso' }),
  ], haceDias(6), hoy());

  assert.equal(r.total, 10000);
  assert.equal(r.cuenta, 1);
});

// Una compra en dólares sin pagar no tiene costo real conocido. Sumarla con
// cualquier número inventado haría mentir al total.
test('las compras en dólares sin pagar no se suman, se advierten', () => {
  const e = crearEntorno();
  const r = e.contexto.calcularResumen([
    gasto('JUMBO', 10000, hoy()),
    { tipo: 'gasto', comercio: 'OPENAI', monto: 49, moneda: 'USD', montoClp: '',
      fechaHora: hoy() + 'T03:00', categoria: '🎮 Juegos / Subcripciones / Digital' },
  ], haceDias(6), hoy());

  assert.equal(r.total, 10000);
  assert.equal(r.sinConvertir, 1);
});

test('detecta los gastos que se salen de lo normal', () => {
  const e = crearEntorno();
  const movimientos = [
    gasto('CAFE', 3000, hoy()), gasto('CAFE', 3500, hoy()),
    gasto('CAFE', 3200, hoy()), gasto('CAFE', 2800, hoy()),
    gasto('CAFE', 3100, hoy()),
    gasto('NOTEBOOK', 800000, hoy(), '🛍️ Compras online'),
  ];
  const r = e.contexto.calcularResumen(movimientos, haceDias(6), hoy());

  assert.equal(r.atipicos.length, 1);
  assert.equal(r.atipicos[0].comercio, 'NOTEBOOK');
});

// Con el promedio, un solo gasto enorme se esconde a sí mismo porque arrastra
// el umbral hacia arriba. Con la mediana no.
test('un gasto enorme no se esconde a sí mismo', () => {
  const e = crearEntorno();
  const r = e.contexto.calcularResumen([
    gasto('A', 1000, hoy()), gasto('B', 1000, hoy()), gasto('C', 1000, hoy()),
    gasto('D', 1000, hoy()), gasto('E', 1000, hoy()),
    gasto('ENORME', 500000, hoy()),
  ], haceDias(6), hoy());

  assert.equal(r.atipicos[0].comercio, 'ENORME');
});

test('con pocos gastos no inventa gastos atípicos', () => {
  const e = crearEntorno();
  const r = e.contexto.calcularResumen(
    [gasto('A', 1000, hoy()), gasto('B', 90000, hoy())], haceDias(6), hoy());

  assert.deepEqual(r.atipicos, []);
});

test('cuenta las veces que fuiste a cada comercio', () => {
  const e = crearEntorno();
  const r = e.contexto.calcularResumen([
    gasto('JUMBO', 10000, hoy()),
    gasto('JUMBO', 8000, haceDias(2)),
    gasto('COPEC', 30000, hoy()),
  ], haceDias(6), hoy());

  assert.equal(r.comercios[0].nombre, 'COPEC');
  const jumbo = r.comercios.find((c) => c.nombre === 'JUMBO');
  assert.equal(jumbo.veces, 2);
  assert.equal(jumbo.total, 18000);
});

test('el informe compara contra el período anterior', () => {
  const e = crearEntorno();
  const actual = e.contexto.calcularResumen([gasto('A', 15000, hoy())], haceDias(6), hoy());
  const previo = e.contexto.calcularResumen(
    [gasto('A', 10000, haceDias(10))], haceDias(13), haceDias(7));

  const texto = e.contexto.redactarInforme('Últimos 7 días', actual, previo);
  assert.match(texto, /\$15\.000/);
  assert.match(texto, /▲ 50%/);
  assert.match(texto, /Período anterior: \$10\.000/);
});

test('el informe avisa cuando el total podría estar incompleto', () => {
  const e = crearEntorno();
  const r = e.contexto.calcularResumen([
    gasto('JUMBO', 10000, hoy()),
    { tipo: 'gasto', comercio: 'OPENAI', monto: 49, moneda: 'USD', montoClp: '',
      fechaHora: hoy() + 'T03:00', categoria: '💻 Software' },
  ], haceDias(6), hoy());

  const texto = e.contexto.redactarInforme('Semana', r, null);
  assert.match(texto, /1 compra en dólares sin pagar/);
});

test('sin gastos lo dice en vez de mostrar ceros', () => {
  const e = crearEntorno();
  const r = e.contexto.calcularResumen([], haceDias(6), hoy());
  assert.match(e.contexto.redactarInforme('Semana', r, null), /No hay gastos registrados/);
});

// --- Gasto escrito a mano --------------------------------------------------

test('"12000 efectivo almuerzo" queda como gasto en efectivo', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('12000 efectivo almuerzo');

  const mov = e.movimiento();
  assert.equal(mov.monto, 12000);
  assert.equal(mov.montoClp, 12000);
  assert.equal(mov.medioPago, 'efectivo');
  assert.equal(mov.comercio, 'almuerzo');
  assert.equal(mov.tipo, 'gasto');
});

test('acepta el monto con puntos de miles', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('3.500 efectivo micro');
  assert.equal(e.movimiento().monto, 3500);
});

test('el gasto a mano pide categoría igual que uno del banco', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('12000 efectivo almuerzo');

  assert.match(e.ultimoTexto(), /¿Qué categoría\?/);
  e.apretar('🍴 Alimentación');
  e.apretar('Guardar sin subcategoría');

  assert.equal(e.movimiento().categoria, '🍴 Alimentación');
  assert.equal(e.movimiento().estado, 'cerrado');
});

test('un gasto a mano repetido también se aprende', () => {
  const e = crearEntorno();
  for (let i = 0; i < 3; i++) {
    e.contexto.manejarTexto('3500 efectivo micro');
    e.apretar('🚖 Transporte');
    e.apretar('Guardar sin subcategoría');
  }
  e.contexto.manejarTexto('3500 efectivo micro');

  assert.match(e.ultimoTexto(), /^✅/, 'la cuarta vez ya no pregunta');
  assert.equal(e.movimiento(3).categoria, '🚖 Transporte');
});

test('un texto que no empieza con monto no se confunde con un gasto', () => {
  const e = crearEntorno();
  for (const texto of ['hola', 'almuerzo 12000', '/pendientes']) {
    assert.equal(e.contexto.leerGastoEscrito(texto), null, texto);
  }
});

// --- Efectivo y giros ------------------------------------------------------

test('"34000 efectivo" sin descripción también funciona', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('34000 efectivo');

  const mov = e.movimiento();
  assert.equal(mov.monto, 34000);
  assert.equal(mov.medioPago, 'efectivo');
  assert.equal(mov.comercio, 'Efectivo');
  assert.match(e.ultimoTexto(), /¿Qué categoría\?/);
});

// Un giro no es gasto: la plata sigue siendo tuya, solo cambió de lugar.
test('un giro no cuenta como gasto en los informes', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('50000 giro');

  const mov = e.movimiento();
  assert.equal(mov.tipo, 'giro');
  assert.equal(mov.estado, 'interno');

  const r = e.contexto.calcularResumen([mov], haceDias(6), hoy());
  assert.equal(r.total, 0, 'el giro no puede sumar al gasto del período');
});

test('al girar recuerda que hay que anotar en qué se va', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('50000 giro');

  assert.match(e.ultimoTexto(), /No lo cuento como gasto/);
  assert.match(e.ultimoTexto(), /12000 efectivo/);
  assert.match(e.ultimoTexto(), /\$50\.000<\/b> en efectivo sin anotar/);
});

test('el saldo de efectivo es lo girado menos lo anotado', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('50000 giro');
  e.contexto.manejarTexto('12000 efectivo almuerzo');
  e.apretar('🍴 Alimentación');
  e.apretar('Guardar sin subcategoría');

  const saldo = e.contexto.calcularEfectivo();
  assert.equal(saldo.girado, 50000);
  assert.equal(saldo.gastado, 12000);
  assert.equal(saldo.disponible, 38000);
});

test('/efectivo explica el hueco en vez de solo mostrar un número', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('50000 giro');
  e.contexto.manejarTexto('/efectivo');

  assert.match(e.ultimoTexto(), /Sin explicar: \$50\.000/);
  assert.match(e.ultimoTexto(), /todavía no dijiste en qué se fue/);
});

test('sin giros ni efectivo, /efectivo enseña cómo se usa', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('/efectivo');

  assert.match(e.ultimoTexto(), /50000 giro/);
  assert.match(e.ultimoTexto(), /12000 efectivo/);
});

test('el latido avisa cuando queda mucho efectivo sin explicar', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now());
  e.contexto.manejarTexto('50000 giro');

  e.contexto.latidoDiario();
  assert.match(e.ultimoTexto(), /\$50\.000<\/b> en efectivo sin explicar/);
});

// --- Comandos nuevos -------------------------------------------------------

test('/ultimos muestra los gastos con botones para corregirlos', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('12000 efectivo almuerzo');
  e.apretar('🍴 Alimentación');
  e.apretar('Guardar sin subcategoría');

  e.contexto.manejarTexto('/ultimos');

  assert.match(e.ultimoTexto(), /almuerzo/);
  const botones = (e.ultimoTeclado() || []).flat().map((b) => b.text);
  assert.ok(botones.some((t) => t.includes('Cambiar categoría')));
});

test('/datos da el enlace a la planilla y cómo respaldarla', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('/datos');

  assert.match(e.ultimoTexto(), /docs\.google\.com\/spreadsheets/);
  assert.match(e.ultimoTexto(), /respaldar\.py/);
  assert.match(e.ultimoTexto(), /finanzas\.db/);
});

test('/ayuda explica cómo anotar antes que la lista de comandos', () => {
  const e = crearEntorno();
  e.contexto.manejarTexto('/ayuda');

  assert.match(e.ultimoTexto(), /34000 efectivo/);
  assert.match(e.ultimoTexto(), /no las anotas tú/);
});
