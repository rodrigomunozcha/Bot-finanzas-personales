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
    // Las dos ultimas filas son fijas: primero salir sin elegir, despues
    // agregar una subcategoria. En ese orden, para que "Guardar sin
    // subcategoria" siga siendo el primer botón después de la lista, como ya
    // era antes de que existiera "Añadir subcategoría".
    const [salir, agregar] = teclado.slice(-2);
    assert.equal(salir.length, 1);
    assert.ok(salir[0].callback_data.startsWith('solo:'), categoria.nombre);
    assert.equal(agregar.length, 1);
    assert.equal(agregar[0].callback_data, 'nuevasub:abc123', categoria.nombre);
  });
});

test('las categorias se reparten en dos columnas, y "Añadir categoría" va aparte', () => {
  const teclado = tg.tecladoCategorias('abc123', arbol);
  assert.equal(teclado.length, 7, '12 categorias en 6 filas de a dos, más la de agregar');
  teclado.slice(0, -1).forEach((fila) => assert.ok(fila.length <= 2));

  const ultima = teclado[teclado.length - 1];
  assert.equal(ultima.length, 1);
  assert.equal(ultima[0].callback_data, 'nuevacat:abc123');
});

// El indice de una categoria agregada despues no puede correr los indices de
// las que ya estaban: esos numeros ya estan escritos en botones viejos.
test('"Añadir categoría" y "Añadir subcategoría" no corren los índices existentes', () => {
  const categorias = tg.tecladoCategorias('abc123', arbol)
    .flat().filter((b) => b.callback_data.startsWith('cat:'));
  categorias.forEach((boton, i) => {
    assert.equal(boton.callback_data, 'cat:abc123:' + i);
  });

  const subcategorias = tg.tecladoSubcategorias('abc123', arbol, 0)
    .flat().filter((b) => b.callback_data.startsWith('sub:'));
  subcategorias.forEach((boton, j) => {
    assert.equal(boton.callback_data, 'sub:abc123:0:' + j);
  });
});
