# Instalación

Son diez pasos y se hacen una sola vez. Los comandos van en la carpeta del
proyecto, y están verificados contra clasp 3.3.0.

El token del bot y los identificadores nunca se escriben en el código: viven en
las propiedades del script, dentro de tu cuenta de Google.

---

## 1. Habilitar la API de Apps Script

Entra a [script.google.com/home/usersettings](https://script.google.com/home/usersettings)
y activa la API. Sin esto el paso 3 falla.

## 2. Autorizar clasp

```bash
npx --yes @google/clasp@latest login
```

Se abre el navegador. Autoriza con la misma cuenta de Gmail que recibe los
correos del banco.

## 3. Crear el proyecto en Apps Script

```bash
npx --yes @google/clasp@latest create-script --type standalone --title "Finanzas" --rootDir apps_script
```

**Este comando pisa `apps_script/appsscript.json`** con una plantilla por
defecto: zona horaria de Nueva York, sin configuración de aplicación web y sin
los permisos declarados. Hay que restaurar el archivo antes de subir, o los
gastos quedarían registrados con horas corridas.

```bash
git checkout apps_script/appsscript.json
```

## 4. Subir el código

```bash
node herramientas/generar_datos_js.js && npx --yes @google/clasp@latest push
```

Este mismo comando sirve cada vez que cambiemos algo más adelante.

## 5. Guardar el token del bot

```bash
npx --yes @google/clasp@latest open-script
```

Ese comando abre tu proyecto en el navegador.

En la barra angosta del lado izquierdo hay cuatro iconos. El último, el
engranaje, es **Configuración del proyecto**:

```
</>   Editor
🕐    Activadores
☰     Ejecuciones
⚙️     Configuración del proyecto   ← este
```

Se abre una página de configuración. **Baja hasta el final**, pasando
"Configuración general" y "Proyecto de Google Cloud Platform". La última sección
se llama **Propiedades de la secuencia de comandos**, y a veces aparece traducida
como "Propiedades del script".

Aprieta **Agregar propiedad de secuencia de comandos** y llena las dos casillas:

| Propiedad | Valor |
|---|---|
| `TELEGRAM_TOKEN` | el token que te dio BotFather |

Después aprieta **Guardar propiedades de la secuencia de comandos**. Si sales de
la página sin guardar no queda nada, y el paso 6 va a fallar diciendo que falta
el token.

Los pasos 7 y 8 vuelven a esta misma pantalla para agregar dos propiedades más,
así que conviene tenerla ubicada.

## 6. Correr `instalar()`

En el editor, elige el archivo `principal.gs`, selecciona la función `instalar`
arriba y dale **Ejecutar**.

Google te va a pedir permisos y te va a mostrar una pantalla que dice que la
aplicación no está verificada. **Es lo esperado**: la aplicación eres tú mismo,
la escribiste tú y corre en tu cuenta. Nadie más la usa, así que no hay nada que
Google pueda verificar. Entra a **Configuración avanzada** → **Ir a Finanzas (no
seguro)** y acepta.

Los permisos que pide son los mínimos: leer y etiquetar correo, crear su hoja de
cálculo, programar su propio activador y hablar con Telegram.

Esto crea la hoja, las etiquetas de Gmail y el activador de 5 minutos. En el
registro queda la dirección de tu hoja.

## 7. Averiguar tu chat id

Abre en Telegram el chat **de tu bot**, no el de BotFather. BotFather es la
fábrica, tu bot es el que salió de ahí, y son dos conversaciones distintas. Si
no lo encuentras, escríbele `/mybots` a BotFather y te lo lista.

La primera vez aparece un botón **Iniciar**. Apriétalo: sin eso Telegram no
autoriza al bot a escribirte.

Mándale cualquier cosa, por ejemplo `hola`. No hay que escribir el nombre de
ninguna función, eso va en el editor.

Vuelve al editor, corre la función `mostrarMiChatId` y mira el registro. Copia
el número y agrégalo como propiedad:

| Propiedad | Valor |
|---|---|
| `TELEGRAM_CHAT_ID` | el número que salió en el registro |

Ese número es lo que hace que el bot te responda solo a ti. Cualquier otra
persona que encuentre tu bot queda ignorada.

## 8. Conectar el bot

En el editor, corre la función `usarConsultaPeriodica`.

Deja el bot preguntándole a Telegram cada minuto si hay algo nuevo. No hace
falta publicar nada ni exponer ninguna dirección: el script solo habla hacia
afuera, nunca recibe llamadas.

Si en algún momento ves una implementación de aplicación web publicada, puedes
archivarla desde **Implementar → Administrar implementaciones**. Ya no se usa.

## 9. Filtro de Gmail

Abre uno de los correos de aviso de compra del banco. En el menú de tres puntos
del correo elige **Filtrar mensajes como este**. Gmail rellena solo el remitente.

Dale **Crear filtro** y marca **Aplicar la etiqueta** → `Finanzas/Pendiente`.

Deja el correo llegando a tu bandeja como siempre. La etiqueta es solo la señal
para el script.

---

## Comprobar que quedó bien

Haz una compra cualquiera, o espera la siguiente. Dentro de 5 minutos debería
llegarte el mensaje al Telegram del iPhone.

Si no llega:

- **El registro del script**: editor → **Ejecuciones**. Ahí sale si `revisarCorreo`
  corrió y con qué error.
- **La hoja `no_entendidos`**: si el correo llegó pero el formato no calzaba,
  queda anotado ahí con un extracto. Pásamelo y agrego el formato.
- **La etiqueta**: revisa que el correo haya quedado con `Finanzas/Pendiente`.
  Si no, el filtro no está calzando con el remitente.

## Cambios posteriores

```bash
npm test && node herramientas/generar_datos_js.js && npx --yes @google/clasp@latest push
```
