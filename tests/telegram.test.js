const test = require('node:test');
const assert = require('node:assert');
const tg = require('../apps_script/telegram.js');
const arbol = require('../datos/categorias_gasto.json');

test('los pesos van con punto de miles y sin decimales', () => {
  assert.equal(tg.formatearMonto(12500, 'CLP'), '$12.500');
  assert.equal(tg.formatearMonto(185000, 'CLP'), '$185.000');
  assert.equal(tg.formatearMonto(1234567, 'CLP'), '$1.234.567');
  assert.equal(tg.formatearMonto(950, 'CLP'), '$950');
});

test('los dolares van con coma decimal', () => {
  assert.equal(tg.formatearMonto(49, 'USD'), 'US$49,00');
  assert.equal(tg.formatearMonto(1234.5, 'USD'), 'US$1234,50');
});

test('la fecha se muestra corta y en español', () => {
  assert.equal(tg.formatearFecha('2026-08-01T13:20'), 'sáb 1 ago 13:20');
  assert.equal(tg.formatearFecha('2026-08-01'), 'sáb 1 ago');
  assert.equal(tg.formatearFecha(null), '');
});

test('un comercio con & no rompe el HTML del mensaje', () => {
  assert.equal(tg.tgEscapar('PULL&BEAR'), 'PULL&amp;BEAR');
  assert.equal(tg.tgEscapar('<b>'), '&lt;b&gt;');
});

// Telegram rechaza el mensaje entero si un solo callback_data se pasa de 64
// bytes, y con emoji se llega rapido: cada uno ocupa cuatro.
test('ningun callback_data supera los 64 bytes', () => {
  const teclados = [
    tg.tecladoCategorias('abc123', arbol),
    tg.tecladoConfirmar('abc123'),
    tg.tecladoCerrado('abc123'),
    tg.tecladoEntrada('abc123'),
    ...arbol.map((_, i) => tg.tecladoSubcategorias('abc123', arbol, i)),
  ];

  for (const teclado of teclados) {
    for (const fila of teclado) {
      for (const boton of fila) {
        const bytes = Buffer.byteLength(boton.callback_data, 'utf8');
        assert.ok(bytes <= 64, `"${boton.callback_data}" mide ${bytes} bytes`);
      }
    }
  }
});

test('el teclado de subcategorias siempre deja salir sin elegir una', () => {
  arbol.forEach((categoria, i) => {
    const teclado = tg.tecladoSubcategorias('abc123', arbol, i);
    const ultima = teclado[teclado.length - 1];
    assert.equal(ultima.length, 1);
    assert.ok(ultima[0].callback_data.startsWith('solo:'), categoria.nombre);
  });
});

test('las categorias se reparten en dos columnas', () => {
  const teclado = tg.tecladoCategorias('abc123', arbol);
  assert.equal(teclado.length, 6, '12 categorias en 6 filas');
  teclado.forEach((fila) => assert.ok(fila.length <= 2));
});
