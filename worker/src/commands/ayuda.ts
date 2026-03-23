// ---------------------------------------------------------------------------
// Comando /ayuda (/start, /help)
// ---------------------------------------------------------------------------

export const getHelpMessage = (): string => {
  return [
    "<b>Renfe Ticket Checker</b>",
    "",
    "<b>--- Búsqueda puntual ---</b>",
    "",
    "<b>Modo guiado:</b>",
    "Escribe /buscar y sigue los pasos con los botones.",
    "",
    "<b>Modo directo:</b>",
    "<code>/buscar &lt;fecha&gt; &lt;ruta&gt; [HH:MM-HH:MM]</code>",
    "",
    "<b>--- Monitorización ---</b>",
    "",
    "/monitor — Vigilar disponibilidad de trenes (se comprueba cada 10 min)",
    "/monitores — Ver y gestionar monitorizaciones activas",
    "",
    "<b>--- Rutas disponibles ---</b>",
    "• <code>ida</code> — Alcázar → Madrid",
    "• <code>vuelta</code> — Madrid → Alcázar",
    "• <code>alcazar-aranjuez</code> — Alcázar → Aranjuez",
    "• <code>aranjuez-alcazar</code> — Aranjuez → Alcázar",
    "",
    "<b>Fecha:</b> DD/MM/YYYY, DD/MM, hoy, mañana, pasado",
    "",
    "<b>Ejemplos:</b>",
    "<code>/buscar 15/03/2026 ida</code>",
    "<code>/buscar mañana vuelta 08:00-14:00</code>",
    "<code>/buscar 20/03 alcazar-aranjuez 06:00-10:00</code>",
    "",
    "/cancelar — Cancela una búsqueda/monitorización en curso",
  ].join("\n");
};
