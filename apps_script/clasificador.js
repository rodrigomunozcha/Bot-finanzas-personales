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
 * Nombres que NO son un comercio, sino una etiqueta puesta por el sistema.
 *
 * El aprendizaje da por hecho que un mismo nombre significa un mismo tipo de
 * gasto. Con "JUMBO CENTRAL" eso es cierto. Con "Transferencia enviada" es falso
 * y ademas peligroso: a la tercera transferencia clasificada igual, todas las
 * siguientes se clasificarian solas con esa categoria, sin preguntar y sin que
 * se note. Una transferencia al arriendo y una a un amigo quedarian juntas, en
 * silencio, y eso es peor que preguntar de mas.
 *
 * La forma obvia de arreglarlo seria distinguirlas por el mensaje que trae el
 * correo. No se puede: ese mensaje es texto libre escrito para la persona que
 * recibe la plata, y suele traer direcciones o nombres. Ver el comentario largo
 * de leerTransferenciaEnviada en parsers.js.
 *
 * Entonces estas preguntan siempre. Son pocas al mes y son tres toques.
 */
var COMERCIOS_GENERICOS = [
  'TRANSFERENCIA ENVIADA',
  'TRANSFERENCIA RECIBIDA',
];

/** true si este nombre es una etiqueta del sistema y no un comercio real. */
function esComercioGenerico(comercioBruto) {
  return COMERCIOS_GENERICOS.indexOf(normalizarComercio(comercioBruto)) >= 0;
}

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

  // Sin propuesta, para que salga la lista completa de categorias. Cualquier
  // otra cosa seria adivinar a partir de transferencias que no tienen nada que
  // ver entre si.
  if (esComercioGenerico(comercio)) return null;

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

  // Devolver null es lo que hace que no se guarde nada: quien llama solo
  // escribe si recibe un registro. Se corta aca ademas de en
  // proponerClasificacion porque son dos caminos distintos, y bloquear solo la
  // propuesta dejaria la tabla llenandose igual.
  if (esComercioGenerico(comercio)) return null;

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

// --- Categorias que el usuario agrega desde el bot --------------------------
//
// Las categorias de datos/categorias_gasto.json vienen con el codigo: se
// despliegan igual para cualquiera que instale esto. Las que el usuario agrega
// con "Añadir categoria" son suyas, viven en su planilla y nunca en el
// repositorio, igual que el aprendizaje por comercio.

/** Nombre mas largo que se acepta. Mas que eso no entra bien en un boton. */
var MAX_LARGO_CATEGORIA = 40;

/** Espacios sobrantes fuera y adentro, sin forzar mayusculas ni sacar emojis. */
function limpiarNombreCategoria(texto) {
  return String(texto == null ? '' : texto).trim().replace(/\s+/g, ' ');
}

/** El nombre limpio, o null si esta vacio o es mas largo de lo que entra. */
function nombreDeCategoriaValido(texto) {
  var limpio = limpiarNombreCategoria(texto);
  if (!limpio || limpio.length > MAX_LARGO_CATEGORIA) return null;
  return limpio;
}

/**
 * Para comparar sin que "Mascotas", "mascotas" y " Mascotas " cuenten como
 * tres categorias distintas. No compara sin el emoji: si el usuario le pone
 * uno distinto, es a proposito una categoria distinta.
 */
function claveDeCategoria(nombre) {
  return limpiarNombreCategoria(nombre).toLowerCase();
}

/**
 * Junta el arbol que trae el codigo con las filas que el usuario agrego desde
 * el bot. No modifica el arbol que recibe.
 *
 * Las categorias nuevas quedan al final, en el orden en que se agregaron. Eso
 * no es solo prolijidad: los botones de categoria le indican al bot cual se
 * eligio por su posicion en este arbol (0, 1, 2...), y esos numeros ya estan
 * escritos en mensajes de Telegram viejos. Agregar solo al final asegura que
 * un boton de ayer siga apuntando a la categoria de ayer.
 */
function arbolConPersonalizadas(base, filas) {
  var arbol = base.map(function (c) {
    return { nombre: c.nombre, subcategorias: c.subcategorias.slice() };
  });

  (filas || []).forEach(function (fila) {
    var indice = indiceDeCategoria(arbol, fila.categoria);
    var categoria;
    if (indice < 0) {
      categoria = { nombre: fila.categoria, subcategorias: [] };
      arbol.push(categoria);
    } else {
      categoria = arbol[indice];
    }

    if (!fila.subcategoria) return;
    var clave = claveDeCategoria(fila.subcategoria);
    var yaEsta = categoria.subcategorias.some(function (s) {
      return claveDeCategoria(s) === clave;
    });
    if (!yaEsta) categoria.subcategorias.push(fila.subcategoria);
  });

  return arbol;
}

/** Indice de una categoria por nombre, o -1 si no esta en el arbol. */
function indiceDeCategoria(arbol, nombre) {
  var clave = claveDeCategoria(nombre);
  for (var i = 0; i < arbol.length; i++) {
    if (claveDeCategoria(arbol[i].nombre) === clave) return i;
  }
  return -1;
}

if (typeof module !== 'undefined') {
  // En Node hay que traer la semilla que en Apps Script ya es global.
  if (typeof COMERCIOS_SEMILLA === 'undefined') {
    globalThis.COMERCIOS_SEMILLA =
      require('../datos/comercios_semilla.json').reglas;
  }
  module.exports = {
    normalizarComercio, proponerClasificacion, registrarRespuesta,
    faltanParaAutomatico, esComercioGenerico,
    CONFIRMACIONES_PARA_AUTOMATICO, COMERCIOS_GENERICOS,
    nombreDeCategoriaValido, limpiarNombreCategoria, claveDeCategoria,
    arbolConPersonalizadas, indiceDeCategoria, MAX_LARGO_CATEGORIA,
  };
}
