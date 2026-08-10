const test = require('node:test');
const assert = require('node:assert');
const { crearEntorno } = require('./ayuda/entorno.js');

const hoy = () => new Date().toISOString().substring(0, 10);
const haceDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
};

function conGastos(e, gastos) {
  gastos.forEach(([comercio, monto, dia, categoria], i) => {
    e.hojas.movimientos._filas.push([
      'g' + i, dia + 'T12:00', 'gasto', comercio, monto, 'CLP', monto,
      'debito', categoria || '🍴 Alimentación', '', '', 'cerrado', '', '', '',
    ]);
  });
  return e;
}

test('la torta usa los mismos números que el texto del informe', () => {
  const e = conGastos(crearEntorno(), [
    ['JUMBO', 10000, hoy()],
    ['COPEC', 30000, hoy(), '🚖 Transporte'],
  ]);

  e.contexto.informeSemana();

  const torta = e.graficos.find((g) => g._tipo === 'torta');
  const total = torta._datos._filas.reduce((s, f) => s + f[1], 0);
  assert.equal(total, 40000, 'la torta y el texto tienen que sumar lo mismo');
});

// El motor de gráficos de Google no trae fuentes de emoji: "🍴 Alimentación"
// sale como un cuadrito seguido del texto.
test('las etiquetas del gráfico van sin emoji', () => {
  const e = crearEntorno();
  assert.equal(e.contexto.etiquetaLimpia('🍴 Alimentación'), 'Alimentación');
  assert.equal(e.contexto.etiquetaLimpia('🎮 Juegos / Subcripciones / Digital'),
    'Juegos / Subcripciones / Digital');
  assert.equal(e.contexto.etiquetaLimpia('⚡Electricidad'), 'Electricidad');
});

test('una etiqueta que era solo emoji no queda vacía', () => {
  const e = crearEntorno();
  assert.equal(e.contexto.etiquetaLimpia('🍴'), 'Sin categoría');
});

// Una torta con quince gajos no se entiende y los de menos del 1% ni se ven.
test('las categorías chicas se juntan en "Otras"', () => {
  const e = crearEntorno();
  const categorias = [];
  for (let i = 0; i < 12; i++) categorias.push({ nombre: 'Cat ' + i, total: 1000 * (12 - i) });

  const resumen = { categorias, total: 78000, cuenta: 12 };
  e.contexto.graficoCategorias(resumen, 'Prueba');

  const torta = e.graficos[e.graficos.length - 1];
  const etiquetas = torta._datos._filas.map((f) => f[0]);
  assert.equal(etiquetas.length, 8, '7 categorías más "Otras"');
  assert.equal(etiquetas[7], 'Otras');
});

test('con un solo día no dibuja el gráfico de barras', () => {
  const e = crearEntorno();
  const resumen = { gastos: [{ fechaHora: hoy() + 'T12:00', montoClp: 5000 }] };
  assert.equal(e.contexto.graficoPorDia(resumen), null);
});

test('el informe semanal manda el texto y después las imágenes', () => {
  const e = conGastos(crearEntorno(), [
    ['JUMBO', 10000, hoy()],
    ['COPEC', 30000, haceDias(2), '🚖 Transporte'],
  ]);

  e.contexto.informeSemana();

  assert.equal(e.enviados[0].metodo, 'sendMessage', 'el texto va primero');
  assert.equal(e.fotos().length, 2, 'torta y barras por día');
  assert.match(e.fotos()[0].cuerpo.caption, /En qué se fue la plata/);
});

// Un gráfico es un adorno útil, no el dato. Perder el gráfico es molesto,
// perder el informe es perder el mes.
test('si el gráfico revienta, el informe de texto llega igual', () => {
  const e = conGastos(crearEntorno(), [['JUMBO', 10000, hoy()]]);
  e.contexto.Charts.newPieChart = () => { throw new Error('el servicio se cayó'); };

  e.contexto.informeSemana();

  assert.match(e.ultimoTexto(), /\$10\.000/, 'el informe tiene que llegar');
});

test('sin gastos no manda ninguna imagen', () => {
  const e = crearEntorno();
  e.contexto.informeSemana();

  assert.match(e.ultimoTexto(), /No hay gastos registrados/);
  assert.equal(e.fotos().length, 0);
});

// El día 1 el mes en curso tiene cero gastos: informar ese sería informar nada.
test('el informe mensual automático mira el mes que cerró', () => {
  const e = crearEntorno();
  const mesPasado = new Date();
  mesPasado.setDate(0);
  const dia = mesPasado.toISOString().substring(0, 10);

  conGastos(e, [['JUMBO', 50000, dia]]);
  e.contexto.informeMensualAutomatico();

  assert.match(e.ultimoTexto(), /mes cerrado/);
  assert.match(e.ultimoTexto(), /\$50\.000/);
});

test('las imágenes también respetan el freno de emergencia', () => {
  const e = conGastos(crearEntorno({ TOPE_MENSAJES_POR_HORA: '1' }),
    [['JUMBO', 10000, hoy()], ['COPEC', 30000, haceDias(2)]]);

  e.contexto.informeSemana();
  assert.equal(e.fotos().length, 0, 'con el freno puesto no salen imágenes');
});
