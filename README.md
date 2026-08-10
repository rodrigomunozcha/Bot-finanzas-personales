# Finanzas

Clasificación de gastos por Telegram, a partir de los correos de Banco de Chile.

Cada vez que llega un aviso de compra, el sistema lo lee, pregunta por Telegram a
qué categoría corresponde, y guarda la respuesta. Con el tiempo aprende de los
comercios que se repiten y deja de preguntar.

## Cómo está armado

El cerebro vive en **Google Apps Script**, dentro de la cuenta de Gmail que
recibe los correos. Eso resuelve tres cosas de una vez: está siempre encendido
sin computador prendido ni consumo eléctrico, es gratis, y accede al correo sin
necesidad de una contraseña de aplicación que pueda filtrarse.

```
Correo de Banco de Chile
        ↓  (Apps Script revisa cada 5 minutos)
   Lector de correos          apps_script/parsers.js
        ↓
   Pregunta por Telegram      botones, respuesta en menos de un minuto
        ↓
   Hoja de cálculo en Drive   registro vivo
        ↓  (cuando el Mac está encendido)
   SQLite local + Excel       archivo histórico y análisis
```

No hay ninguna dirección pública: el script le pregunta a Telegram cada minuto
si hay algo nuevo, en vez de exponer un punto de entrada al que Telegram llame.

La captura vive en la nube porque tiene que estar despierta siempre. El archivo
y el análisis viven en el Mac, que es donde conviene tener los datos.

### Decisiones que vale la pena recordar

**Los montos en moneda extranjera no se convierten solos.** El tipo de cambio
que manda es el que Banco de Chile aplica cuando se paga la tarjeta, no el del
día de la compra. La compra se registra en su moneda original y queda pendiente
hasta que llega el correo "Comprobante pago Tarjeta de Crédito Internacional",
que trae el monto real en pesos. Ahí se cierra sola.

**El tipo de cambio que muestra ese correo viene redondeado y no sirve para
calcular.** En el correo del 01/08/2026 dice `$949`, pero el pago de US$150
costó $142.403, o sea una tasa real de 949,3533. Multiplicar por la tasa
mostrada erraría por $53 en un solo pago. La tasa se deduce dividiendo los dos
montos que el correo sí trae exactos.

**El reparto entre compras es a prorrata.** El correo da el total pagado y el
total en pesos, no el desglose por compra. Repartir en proporción es la única
asignación defendible con esa información, y garantiza que la suma calce al peso
con lo que salió de la cuenta.

**Las transferencias recibidas no se asumen como ingreso.** Pueden ser una
devolución de plata adelantada. El bot pregunta primero si es ingreso o
reembolso.

**De los correos de transferencia no se extrae ningún dato identificatorio.**
Traen RUT, nombre completo, correo y número de cuenta. El lector toma solo monto,
primer nombre del remitente, glosa y fecha. Hay una prueba que lo verifica.

**Un correo que no se reconoce nunca se descarta.** Queda en la bandeja de no
entendidos para agregar su formato después, con el extracto censurado: se
conservan los montos y la redacción, que es lo que sirve para escribir el lector
que falta, pero RUT, correos y números de cuenta se tachan antes de guardar.

**El bot consulta a Telegram, no al revés.** La primera versión usaba un
webhook y no funcionó: Apps Script no responde con un 200 limpio sino con una
redirección, y Telegram la rechaza textualmente con *"Wrong response from the
webhook: 302 Found"*. Como nunca daba por entregado ningún aviso, los acumulaba
en su cola y los reintentaba durante horas, mientras los nuevos quedaban
atrapados detrás. De ahí venían las demoras de media hora, los mensajes sin
respuesta y uno que se repetía cada 61 minutos.

Consultando nosotros, el `offset` le confirma a Telegram que puede descartar lo
entregado y la cola nunca se acumula. El costo es la latencia, hasta un minuto,
que es el intervalo más frecuente que cabe en los 90 minutos diarios de
ejecución que Google regala.

**Cada lectura o escritura en Sheets cuesta cerca de un segundo**, y es casi
toda la demora que se siente en el teléfono. Hay pruebas que fijan el techo:
2 lecturas y 1 escritura por gasto entrante, 3 y 2 por pulsación de botón.

**Hay un tope de 25 mensajes nuevos por hora.** Al superarlo el bot avisa una
vez y se calla hasta que pase la hora o hasta que se le escriba `/reanudar`.
Existe porque ninguna cantidad de pruebas garantiza que no aparezca otro error
no previsto, y un tope duro convierte cualquier falla futura en un puñado de
mensajes en vez de una noche entera. Editar un mensaje no consume cuota, porque
no genera notificación.

## Estructura

```
apps_script/    código que corre en Google
  parsers.js    lectura de correos (lógica pura, sin APIs de Google)
datos/
  categorias_gasto.json      12 categorías, 39 subcategorías (de Money Manager)
  categorias_ingreso.json    propuesta nueva para Chile
  comercios_semilla.json     clasificación inicial por comercio
herramientas/   utilidades locales de un solo uso
tests/          pruebas, corren con Node
muestras/       respaldos reales (fuera del repositorio)
```

`parsers.js` está escrito para funcionar igual bajo Node y bajo Apps Script, así
que lo que se prueba acá es exactamente lo que corre en producción.

## Pruebas

```bash
npm test
```

Corre las dos suites: las de Apps Script bajo Node y las del respaldo bajo
Python. Ninguna necesita instalar dependencias.

## Respaldar

Todo vive en una hoja de Google. Si esa hoja se pierde, se pierde todo, así que
conviene bajarla cada tanto:

1. Abre tu hoja **Finanzas** en Google Sheets
2. **Archivo → Descargar → Microsoft Excel (.xlsx)**
3. En el Mac:

```bash
cd la carpeta del proyecto && python3 herramientas/respaldar.py
```

4. Escríbele `/respaldado` al bot para que deje de recordártelo

El importador toma el Excel más reciente de tu carpeta de Descargas, lo mete en
`datos/finanzas.db` y deja un CSV listo para abrir en Excel. **Nunca borra
nada**: si una fila desaparece de la hoja, en la base local sigue estando. Esa
es toda la gracia.

No queda ningún proceso corriendo en el Mac. El comando tarda un segundo y
termina. El bot se encarga de recordarte cuando pasa una semana.

## Estado

- [x] Árbol de categorías recuperado del respaldo de Money Manager
- [x] Lector de correos de Banco de Chile: compra con débito, compra con
      crédito, transferencia recibida, pago de tarjeta internacional
- [x] Cierre automático de compras en dólares al pagar la tarjeta
- [x] Semilla de comercios chilenos
- [x] Bot de Telegram: categoría, subcategoría opcional y nota
- [x] Aprendizaje por comercio, con reinicio al corregir
- [x] Instalación en la cuenta de Google (ver [INSTALACION.md](INSTALACION.md))
- [x] Freno de emergencia contra mensajes en bucle
- [x] Respaldo local a SQLite, con CSV para Excel
- [x] Latido diario: avisa solo cuando hay algo que arreglar
- [x] Informes de semana y mes, con detalle gasto por gasto
- [x] Entrada manual: gastos, efectivo, giros e ingresos
- [x] Saldo de la cuenta corriente
- [ ] Presupuesto por categoría, para que las cifras tengan veredicto
- [ ] Formatos de correo que faltan: transferencia enviada, giro, anulación
- [ ] Poda de subcategorías que no aplican en Chile
- [x] Gráficos en los informes, enviados por Telegram
- [ ] Narración con Ollama, cuando haya meses de datos

### Sobre Looker Studio

Se probó y se descartó como panel principal, aunque quedó conectado a la hoja
(no consume nada mientras nadie lo abra, así que se dejó ahí).

La razón de fondo no fue la comodidad sino la coherencia: los informes del bot
aplican reglas que un panel externo no conoce. Las compras en dólares sin pagar
no suman al total, los giros no son gasto y los reembolsos no son ingreso.
Looker suma las columnas que le pongas, así que habría dado otro número para el
mismo mes. Dos totales distintos para lo mismo es peor que no tener panel.

Sirve para hurgar en una pregunta puntual cuando haya meses de datos, no para
el seguimiento semanal.

### Formatos de correo que faltan

Se agregan a medida que aparezca un ejemplo real de cada uno:

- Transferencia enviada
- Giro por cajero automático
- Anulación o reverso de una compra
