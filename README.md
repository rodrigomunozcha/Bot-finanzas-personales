# Bot finanzas personales

Clasificación de gastos por Telegram, a partir de los correos de tu banco.

> ## ⚠️ Solo funciona con Banco de Chile
>
> **Este bot lee los correos de aviso de Banco de Chile y solo entiende su
> redacción exacta.** Con otro banco no va a reconocer ni un movimiento: los
> correos van a quedar todos en la bandeja de no entendidos y el bot no te va a
> escribir nunca.
>
> No es un defecto que se arregle con configuración. Cada banco escribe sus
> avisos distinto, así que adaptarlo significa escribir lectores nuevos en
> `apps_script/parsers.js`, con un ejemplo real de cada formato a la vista. Se
> puede hacer y el código está preparado para eso, pero es trabajo de
> programación, no un ajuste.

**Todos los comandos de este README y de la guía de instalación se corren desde
la carpeta del proyecto**, la que queda al clonar este repositorio, donde sea que
la hayas puesto. Entra a ella con `cd` una vez y desde ahí los comandos funcionan
tal cual están escritos.

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
hasta que llega el correo "Pago de Tarjeta de Crédito Internacional",
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

**De una transferencia, propia o recibida, no se lee el texto libre.** El
correo trae todos los datos del destinatario o del remitente, más el mensaje
que se escribió al transferir, y de ahí solo se toman el monto y la fecha. Una
versión anterior sí usaba ese mensaje como nombre de comercio, y en un caso
real ese mensaje era una dirección: iba a terminar en la hoja, en el
aprendizaje, en Telegram y en el respaldo. El texto libre de un correo lo
escribe una persona para otra persona, y ahí cabe cualquier cosa. Por eso todas
las transferencias comparten un nombre fijo ("Transferencia enviada" o
"Transferencia recibida") y nunca se aprenden solas: siempre preguntan la
categoría. La regla completa está en [CLAUDE.md](CLAUDE.md).

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

**El informe semanal es además la prueba de vida.** El latido diario avisa
cuando algo se rompe, pero no puede avisar de su propia muerte: es un activador
más, y si Google los desactiva se apaga con todo lo demás. Entonces dejan de
llegar mensajes, que se ve exactamente igual que una racha sin compras. El
informe del domingo sale aunque la semana venga en cero, y lo dice en el propio
mensaje, así que su ausencia significa algo. No es un vigilante de verdad: si
el activador muere un lunes, el aviso tarda hasta seis días. Un vigilante real
vive fuera del sistema que vigila, y eso pedía un servicio externo.

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
  categorias_gasto.json      12 categorías, 38 subcategorías
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

**No hay que hacer nada.** Cada domingo a las 18:00, un activador exporta la
planilla como Excel a la carpeta **Finanzas - Respaldos** de tu Google Drive. El
bot solo te escribe si eso falla, y te dice la causa y cómo reintentar.

Para respaldar en el momento, sin esperar al domingo: en el editor de Apps
Script elige `respaldarAhora` y aprieta Ejecutar.

Tres detalles de cómo está hecho:

- **Solo toca sus propios archivos.** Usa el permiso `drive.file`, que alcanza
  únicamente a lo que crea este script, no al resto de tu Drive.
- **Comprueba que lo guardado sea de verdad un Excel.** Si a Google le falta un
  permiso, a veces responde una página de inicio de sesión en vez de un error, y
  sin esa comprobación se guardaría la página con nombre de respaldo.
- **Nunca borra un respaldo viejo.** Los que cumplen seis meses se mueven a la
  subcarpeta **Antiguos**. Mover no libera espacio, porque en Drive un archivo
  ocupa lo mismo esté donde esté. Lo que hace es que borrar deje de ser mirar
  cincuenta archivos y decidir uno por uno: todo lo que está en Antiguos tiene
  más de seis meses y se puede borrar entero. El borrado lo haces tú.

### Copia en el Mac

Opcional. No es seguridad, que ya la da el respaldo en Drive, sino comodidad:
deja los datos en SQLite para analizarlos. Un comando:

```bash
bash herramientas/copia_local.sh
```

Le pide el Excel a Google por el navegador, donde la sesión ya está iniciada,
espera a que caiga en Descargas y lo importa. La primera vez pregunta cuál es la
planilla y lo guarda en `config.local.json`, que no se versiona.

El importador lo mete en `datos/finanzas.db` y deja un CSV listo para abrir en
Excel. **Nunca borra nada**: si una fila desaparece de la hoja, en la base local
sigue estando.

**Por qué no lee la carpeta de Google Drive del Mac.** Drive para escritorio la
deja en `~/Library/CloudStorage`, que macOS protege. Leerla desde una terminal
exige "Acceso total al disco", que es permiso sobre todo el disco, para siempre
y para cualquier cosa que se corra desde ahí. macOS no ofrece una versión
acotada a esa sola carpeta. Un permiso de ese tamaño para leer un archivo de
40 KB no sale a cuenta, así que el archivo se pide por el navegador.

## Estado

- [x] Árbol de categorías recuperado del respaldo de Money Manager
- [x] Lector de correos de Banco de Chile: compra con débito, compra con
      crédito, transferencia recibida, transferencia enviada a terceros, pago de
      tarjeta internacional
- [x] Cierre automático de compras en dólares al pagar la tarjeta
- [x] Semilla de comercios chilenos
- [x] Bot de Telegram: categoría, subcategoría opcional y nota
- [x] Aprendizaje por comercio, con reinicio al corregir
- [x] Instalación en la cuenta de Google (ver [INSTALACION.md](INSTALACION.md))
- [x] Freno de emergencia contra mensajes en bucle
- [x] Respaldo automático semanal en Google Drive, sin intervención
- [x] Respaldo local a SQLite, con CSV para Excel
- [x] Copia en el Mac en un comando, sin permisos especiales de macOS
- [x] Latido diario: avisa solo cuando hay algo que arreglar
- [x] Informes de semana y mes, con detalle gasto por gasto
- [x] Prueba de vida: el informe del domingo llega aunque no haya gastos
- [x] Entrada manual: gastos, efectivo, giros e ingresos
- [x] Saldo de la cuenta corriente
- [x] Añadir categoría o subcategoría desde el bot, sin tocar el código
- [x] Respaldar en el momento desde el menú de Telegram, con `/respaldar`
- [ ] Presupuesto por categoría, para que las cifras tengan veredicto
- [ ] Formatos de correo que faltan: anulación o reverso de una compra
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

- Anulación o reverso de una compra

## Licencia

MIT. Úsalo, cópialo y modifícalo como quieras. Sin garantía de ninguna clase:
lee tus propios números antes de confiar en ellos.
