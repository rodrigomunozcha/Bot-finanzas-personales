const test = require('node:test');
const assert = require('node:assert');
const tg = require('../apps_script/telegram.js');
const arbol = require('../datos/categorias_gasto.json');

/**
 * Un botón tiene que decir qué hace, no solo insinuarlo. "Nota" no aclara si
 * muestra o agrega; "Terminar" no aclara qué termina; "Correcto" no aclara qué
 * pasa después. Los nombres de categoría son la excepción legítima: ahí el
 * botón es la opción misma, no una acción.
 */
const VERBOS_SUELTOS = [
  'nota', 'terminar', 'cambiar', 'correcto', 'listo', 'ok', 'sí', 'no',
  'guardar', 'aceptar', 'continuar', 'seguir', 'volver',
];

function sinEmoji(texto) {
  return texto.replace(/[^\p{L}\p{N}\s,]/gu, '').trim().toLowerCase();
}

function todosLosBotonesDeAccion() {
  const teclados = [
    tg.tecladoConfirmar('id'),
    tg.tecladoCerrado('id'),
    tg.tecladoEntrada('id'),
    ...arbol.map((_, i) => tg.tecladoSubcategorias('id', arbol, i)),
  ];
  // De los teclados de subcategoría solo interesa el botón de acción final:
  // el resto son nombres de subcategoría, que son opciones y no acciones.
  return teclados.flat(2).filter((b) => !b.callback_data.startsWith('sub:'));
}

test('ningún botón es un verbo suelto sin decir sobre qué actúa', () => {
  for (const boton of todosLosBotonesDeAccion()) {
    const limpio = sinEmoji(boton.text);
    assert.equal(VERBOS_SUELTOS.includes(limpio), false,
      `"${boton.text}" no dice sobre qué actúa`);
    assert.ok(limpio.split(/\s+/).length >= 2,
      `"${boton.text}" es demasiado escueto para saber qué hace`);
  }
});

test('los botones caben en la pantalla de un teléfono', () => {
  for (const boton of todosLosBotonesDeAccion()) {
    assert.ok(boton.text.length <= 28, `"${boton.text}" mide ${boton.text.length}`);
  }
});
