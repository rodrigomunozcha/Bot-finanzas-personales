/**
 * Decide que categoria proponer para un comercio, y aprende de las respuestas.
 *
 * El objetivo es que el sistema deje de preguntar. La progresion es:
 *
 *   comercio nuevo          -> pregunta todo, lista completa de categorias
 *   1 o 2 confirmaciones    -> propone y pide confirmar de un toque
 *   3 confirmaciones o mas  -> clasifica solo y solo avisa
 *
 * Basta una correccion para volver a cero: si cambiaste la categoria de un
 * comercio, el sistema no debe seguir insistiendo con la anterior.
 *
 * Logica pura: corre igual bajo Node y bajo Apps Script.
 */

/** Confirmaciones necesarias antes de dejar de preguntar. */
var CONFIRMACIONES_PARA_AUTOMATICO = 3;

/**
 * Los comercios llegan del banco con sufijos que cambian entre compras y que
 * romperian el aprendizaje: numero de local, ciudad, codigos internos.
 * "JUMBO CENTRAL 0111" y "JUMBO CENTRAL" deben contar como el mismo comercio.
 */
function normalizarComercio(bruto) {
  return String(bruto || '')
    .toUpperCase()
    .replace(/[^A-Z0-9ÑÁÉÍÓÚÜ&. ]/g, ' ')  // simbolos raros del banco
    .replace(/\s+\d{2,}\s*$/, '')          // numero de local al final
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Busca que proponer para un comercio.
 *
 * Lo aprendido siempre gana sobre la semilla: la semilla es un supuesto mio
 * sobre comercios chilenos, y una correccion tuya es un hecho.
 */
function proponerClasificacion(comercioBruto, aprendizaje) {
  var comercio = normalizarComercio(comercioBruto);

  var aprendido = aprendizaje[comercio];
  if (aprendido) {
    return {
      categoria: aprendido.categoria,
      subcategoria: aprendido.subcategoria || null,
      origen: 'aprendido',
      confirmaciones: aprendido.confirmaciones,
      automatico: aprendido.confirmaciones >= CONFIRMACIONES_PARA_AUTOMATICO,
    };
  }

  for (var i = 0; i < COMERCIOS_SEMILLA.length; i++) {
    if (comercio.indexOf(COMERCIOS_SEMILLA[i].patron) >= 0) {
      return {
        categoria: COMERCIOS_SEMILLA[i].categoria,
        subcategoria: COMERCIOS_SEMILLA[i].subcategoria,
        origen: 'semilla',
        confirmaciones: 0,
        // Nunca automatico: la semilla la escribi yo adivinando, no la
        // confirmaste tu. Se propone, se pregunta, y recien ahi cuenta.
        automatico: false,
      };
    }
  }

  return null;
}

/**
 * Devuelve como queda el aprendizaje de un comercio despues de una respuesta.
 * No modifica el objeto recibido: quien llama decide si lo guarda.
 */
function registrarRespuesta(aprendizaje, comercioBruto, categoria, subcategoria) {
  var comercio = normalizarComercio(comercioBruto);
  var previo = aprendizaje[comercio];

  var mismaEleccion = previo &&
    previo.categoria === categoria &&
    (previo.subcategoria || null) === (subcategoria || null);

  return {
    comercio: comercio,
    categoria: categoria,
    subcategoria: subcategoria || null,
    // Cambiar de opinion reinicia la cuenta. Si no, un comercio con 5
    // confirmaciones viejas seguiria clasificandose solo con la categoria
    // equivocada pese a que ya la corregiste.
    confirmaciones: mismaEleccion ? previo.confirmaciones + 1 : 1,
  };
}

/** Cuantas confirmaciones faltan para que el comercio deje de preguntar. */
function faltanParaAutomatico(confirmaciones) {
  return Math.max(0, CONFIRMACIONES_PARA_AUTOMATICO - confirmaciones);
}

if (typeof module !== 'undefined') {
  // En Node hay que traer la semilla que en Apps Script ya es global.
  if (typeof COMERCIOS_SEMILLA === 'undefined') {
    globalThis.COMERCIOS_SEMILLA =
      require('../datos/comercios_semilla.json').reglas;
  }
  module.exports = {
    normalizarComercio, proponerClasificacion, registrarRespuesta,
    faltanParaAutomatico, CONFIRMACIONES_PARA_AUTOMATICO,
  };
}
