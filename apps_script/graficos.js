/**
 * Graficos de los informes, como imagen.
 *
 * Apps Script sabe dibujar graficos y devolverlos como PNG, y Telegram sabe
 * recibir imagenes. Con eso el informe semanal llega con su grafico adjunto,
 * sin abrir ninguna herramienta ni salir del chat.
 *
 * Se eligio esto por sobre un panel externo por una razon de fondo: los numeros
 * salen del mismo calculo que el texto del informe, con las mismas reglas
 * (las compras en dolares sin pagar no suman, los giros no son gasto, los
 * reembolsos no son ingreso). Un panel armado aparte sumaria columnas sin
 * conocer esas reglas y daria otro total para el mismo mes, y dos numeros
 * distintos para lo mismo es peor que no tener grafico.
 */

/** Cuantas categorias entran en la torta antes de agrupar el resto. */
var MAXIMO_EN_TORTA = 7;

/**
 * Las etiquetas van sin emoji.
 *
 * El motor de graficos de Google no trae las fuentes de emoji, asi que
 * "🍴 Alimentación" sale como un cuadrito seguido del texto. Sacarlos deja la
 * etiqueta limpia sin perder informacion.
 */
function etiquetaLimpia(nombre) {
  return String(nombre)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'Sin categoría';
}

/**
 * Torta del gasto por categoria.
 * Las categorias chicas se juntan en "Otras": una torta con quince gajos no se
 * entiende, y las de menos del uno por ciento no se alcanzan ni a ver.
 */
function graficoCategorias(resumen, titulo) {
  if (!resumen.categorias.length) return null;

  var visibles = resumen.categorias.slice(0, MAXIMO_EN_TORTA);
  var resto = resumen.categorias.slice(MAXIMO_EN_TORTA)
    .reduce(function (suma, c) { return suma + c.total; }, 0);

  var tabla = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, 'Categoría')
    .addColumn(Charts.ColumnType.NUMBER, 'Monto');

  visibles.forEach(function (c) {
    tabla.addRow([etiquetaLimpia(c.nombre), c.total]);
  });
  if (resto > 0) tabla.addRow(['Otras', resto]);

  return Charts.newPieChart()
    .setDataTable(tabla.build())
    .setTitle(titulo + ': ' + formatearMonto(resumen.total, 'CLP'))
    .setDimensions(900, 560)
    .set3D()
    .build()
    .getAs('image/png');
}

/**
 * Barras del gasto dia por dia.
 * Sirve para lo que la torta no muestra: si hubo un dia que se disparo, o si el
 * gasto se reparte parejo.
 */
function graficoPorDia(resumen) {
  var porDia = {};
  resumen.gastos.forEach(function (m) {
    var dia = diaDe(m.fechaHora);
    porDia[dia] = (porDia[dia] || 0) + Number(m.montoClp);
  });

  var dias = Object.keys(porDia).sort();
  if (dias.length < 2) return null;   // con un solo dia no hay nada que comparar

  var tabla = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, 'Día')
    .addColumn(Charts.ColumnType.NUMBER, 'Gasto');

  dias.forEach(function (dia) {
    tabla.addRow([formatearFecha(dia), porDia[dia]]);
  });

  return Charts.newColumnChart()
    .setDataTable(tabla.build())
    .setTitle('Gasto por día')
    .setDimensions(900, 500)
    .setLegendPosition(Charts.Position.NONE)
    .build()
    .getAs('image/png');
}

/**
 * Barras comparadas de este periodo contra el anterior, por categoria.
 * Es donde se ven las tendencias: no cuanto gastaste, sino en que cambiaste.
 */
function graficoComparado(resumen, previo, etiquetaActual, etiquetaPrevia) {
  if (!previo || !previo.cuenta) return null;

  var previoPorCategoria = {};
  previo.categorias.forEach(function (c) { previoPorCategoria[c.nombre] = c.total; });

  var tabla = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, 'Categoría')
    .addColumn(Charts.ColumnType.NUMBER, etiquetaPrevia)
    .addColumn(Charts.ColumnType.NUMBER, etiquetaActual);

  resumen.categorias.slice(0, 8).forEach(function (c) {
    tabla.addRow([etiquetaLimpia(c.nombre), previoPorCategoria[c.nombre] || 0, c.total]);
  });

  return Charts.newBarChart()
    .setDataTable(tabla.build())
    .setTitle('En qué cambiaste')
    .setDimensions(900, 620)
    .build()
    .getAs('image/png');
}

/**
 * Manda los graficos que se puedan armar, sin arruinar el informe si fallan.
 *
 * Un grafico es un adorno util, no el dato. Si el servicio de graficos se cae o
 * cambia, el informe de texto tiene que llegar igual: perder el grafico es
 * molesto, perder el informe es perder el mes.
 */
function enviarGraficos(imagenes) {
  imagenes.forEach(function (imagen) {
    if (!imagen || !imagen.blob) return;
    try {
      tgEnviarFoto(imagen.blob, imagen.pie);
    } catch (error) {
      console.error('No se pudo enviar el gráfico: ' + error);
    }
  });
}

/** Arma un grafico atrapando cualquier falla, para no cortar el informe. */
function graficoSeguro(construir) {
  try {
    return construir();
  } catch (error) {
    console.error('No se pudo armar el gráfico: ' + error);
    return null;
  }
}
