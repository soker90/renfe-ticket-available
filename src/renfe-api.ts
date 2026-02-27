import JSON5 from "json5";
import type { Station, SearchConfig, TrainResult, SearchResult, TimeRange } from "./types.js";
import { STATIONS } from "./types.js";

// --- URLs ---
const SEARCH_URL = "https://venta.renfe.com/vol/buscarTren.do?Idioma=es&Pais=ES";
const DWR_ENDPOINT = "https://venta.renfe.com/vol/dwr/call/plaincall/";
const SYSTEM_ID_URL = `${DWR_ENDPOINT}__System.generateId.dwr`;
const UPDATE_SESSION_URL = `${DWR_ENDPOINT}buyEnlacesManager.actualizaObjetosSesion.dwr`;
const TRAIN_LIST_URL = `${DWR_ENDPOINT}trainEnlacesManager.getTrainsList.dwr`;

// --- Headers ---
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Encoding": "gzip, deflate",
  Accept: "*/*",
  Connection: "keep-alive",
};

// --- Utilidades DWR ---

/** Codifica un entero en base-64 usando el charset de DWR */
function tokenify(number: number): string {
  const charmap = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ*$";
  const tokenbuf: string[] = [];
  let remainder = number;
  while (remainder > 0) {
    tokenbuf.push(charmap[remainder & 0x3f]);
    remainder = Math.floor(remainder / 64);
  }
  return tokenbuf.join("");
}

/** Genera un ID de búsqueda aleatorio: "_" + 4 chars alfanuméricos */
function createSearchId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "_";
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/** Crea el scriptSessionId a partir del token DWR */
function createScriptSessionId(dwrToken: string): string {
  const dateToken = tokenify(Date.now());
  const randomToken = tokenify(Math.floor(Math.random() * 1e16));
  return `${dwrToken}/${dateToken}-${randomToken}`;
}

/** Extrae el token DWR de la respuesta */
function extractDwrToken(responseText: string): string {
  const match = responseText.match(/r\.handleCallback\("[^"]+","[^"]+","([^"]+)"\)/);
  if (!match) {
    throw new Error(`No se pudo extraer el token DWR. Respuesta: ${responseText.substring(0, 200)}`);
  }
  return match[1];
}

/** Extrae la lista de trenes de la respuesta DWR */
function extractTrainList(responseText: string): Record<string, unknown> {
  // Comprobar si hay un error de sesión
  const exceptionMatch = responseText.match(/r\.handleException\([^,]+,\s*[^,]+,\s*(\{.*?\})\);/s);
  if (exceptionMatch) {
    const errorData = JSON5.parse(exceptionMatch[1]);
    throw new Error(`Error de Renfe: ${errorData.message || errorData.localizedMessage || "Error desconocido"}`);
  }

  const match = responseText.match(/r\.handleCallback\([^,]+,\s*[^,]+,\s*(\{.*\})\);/s);
  if (!match) {
    throw new Error(`No se pudo extraer la lista de trenes. Respuesta: ${responseText.substring(0, 500)}`);
  }
  return JSON5.parse(match[1]);
}

/** Determina si un tren tiene plazas disponibles */
function isTrainAvailable(train: Record<string, unknown>): boolean {
  return (
    !train["completo"] &&
    ((train["razonNoDisponible"] as string) === "" || (train["razonNoDisponible"] as string) === "8") &&
    train["tarifaMinima"] !== null &&
    train["tarifaMinima"] !== undefined &&
    !train["soloPlazaH"]
  );
}

/** Parsea el precio de Renfe (formato español: "16,65") a número */
function parsePrice(price: unknown): number | null {
  if (price === null || price === undefined) return null;
  const priceStr = String(price);
  if (priceStr === "NaN" || priceStr === "") return null;
  return parseFloat(priceStr.replace(",", "."));
}

/** Filtra trenes por franja horaria */
function filterByTimeRange(trains: TrainResult[], range: TimeRange): TrainResult[] {
  return trains.filter((train) => {
    return train.horaSalida >= range.from && train.horaSalida <= range.to;
  });
}

// --- Clase principal ---

export class RenfeAPI {
  private cookies: Map<string, string> = new Map();
  private searchId: string = "";
  private dwrToken: string = "";
  private scriptSessionId: string = "";
  private batchId: number = 0;

  private nextBatchId(): number {
    return this.batchId++;
  }

  /** Construye la string de cookies para el header */
  private getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  /** Extrae cookies de los headers Set-Cookie de la respuesta */
  private extractCookies(response: Response): void {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      const parts = cookie.split(";")[0];
      const eqIdx = parts.indexOf("=");
      if (eqIdx > 0) {
        const name = parts.substring(0, eqIdx).trim();
        const value = parts.substring(eqIdx + 1).trim();
        this.cookies.set(name, value);
      }
    }
  }

  /**
   * Realiza una petición HTTP con cookies persistentes.
   * Maneja redirects manualmente para capturar cookies en cada paso.
   */
  private async request(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const headers: Record<string, string> = {
      ...DEFAULT_HEADERS,
      ...(options.headers as Record<string, string>),
    };

    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    // Siempre manejar redirects manualmente para capturar cookies
    const response = await fetch(url, {
      ...options,
      headers,
      redirect: "manual",
    });

    this.extractCookies(response);

    // Seguir redirects manualmente
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        const redirectUrl = new URL(location, url).toString();
        // Consumir body del redirect
        await response.text().catch(() => {});
        // Seguir el redirect con GET
        return this.request(redirectUrl, {
          method: "GET",
          headers: {},
        });
      }
    }

    return response;
  }

  /**
   * Paso 1: Inicializar búsqueda en Renfe
   * POST a buscarTren.do con los datos del formulario
   */
  private async doSearch(origin: Station, destination: Station, config: SearchConfig): Promise<void> {
    // Establecer cookie Search
    const searchCookie = JSON.stringify({
      origen: { code: origin.code, name: origin.name },
      destino: { code: destination.code, name: destination.name },
      pasajerosAdultos: 1,
      pasajerosNinos: 0,
      pasajerosSpChild: 0,
    });
    this.cookies.set("Search", searchCookie);

    const fechaVuelta = config.tipoViaje === "ida_vuelta" ? config.fecha : "";

    const formData = new URLSearchParams({
      tipoBusqueda: "autocomplete",
      currenLocation: "menuBusqueda",
      vengoderenfecom: "SI",
      desOrigen: origin.name,
      desDestino: destination.name,
      cdgoOrigen: origin.code,
      cdgoDestino: destination.code,
      idiomaBusqueda: "ES",
      FechaIdaSel: config.fecha,
      FechaVueltaSel: fechaVuelta,
      _fechaIdaVisual: config.fecha,
      _fechaVueltaVisual: fechaVuelta,
      adultos_: "1",
      ninos_: "0",
      ninosMenores: "0",
      codPromocional: "",
      plazaH: "false",
      sinEnlace: "false",
      asistencia: "false",
      franjaHoraI: "",
      franjaHoraV: "",
      Idioma: "es",
      Pais: "ES",
    });

    const response = await this.request(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new Error(`Error en búsqueda inicial: ${response.status} ${response.statusText}`);
    }

    // Consumir el body para liberar la conexión
    await response.text();
    console.log("[1/4] Búsqueda inicializada");
  }

  /**
   * Paso 2: Obtener token DWR
   * Se llama dos veces a __System.generateId.dwr
   */
  private async getDwrToken(): Promise<void> {
    this.searchId = createSearchId();

    // Primera llamada (sin search_id en page, se descarta)
    const payload1 = [
      "callCount=1",
      "c0-scriptName=__System",
      "c0-methodName=generateId",
      "c0-id=0",
      `batchId=${this.nextBatchId()}`,
      "instanceId=0",
      "page=%2Fvol%2FbuscarTrenEnlaces.do",
      "scriptSessionId=",
      "windowName=",
    ].join("\n");

    const resp1 = await this.request(SYSTEM_ID_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload1,
    });
    await resp1.text(); // descartar

    // Segunda llamada (con search_id en page)
    const payload2 = [
      "callCount=1",
      "c0-scriptName=__System",
      "c0-methodName=generateId",
      "c0-id=0",
      `batchId=${this.nextBatchId()}`,
      "instanceId=0",
      `page=%2Fvol%2FbuscarTrenEnlaces.do%3Fc%3D${this.searchId}`,
      "scriptSessionId=",
      "windowName=",
    ].join("\n");

    const resp2 = await this.request(SYSTEM_ID_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload2,
    });

    const text = await resp2.text();
    this.dwrToken = extractDwrToken(text);

    // Establecer cookie y scriptSessionId
    this.cookies.set("DWRSESSIONID", this.dwrToken);
    this.scriptSessionId = createScriptSessionId(this.dwrToken);

    console.log("[2/4] Token DWR obtenido");
  }

  /**
   * Paso 3: Actualizar objetos de sesión
   */
  private async updateSessionObjects(): Promise<void> {
    const payload = [
      "callCount=1",
      "windowName=",
      "c0-scriptName=buyEnlacesManager",
      "c0-methodName=actualizaObjetosSesion",
      "c0-id=0",
      `c0-e1=string:${this.searchId}`,
      "c0-e2=string:",
      "c0-param0=array:[reference:c0-e1,reference:c0-e2]",
      `batchId=${this.nextBatchId()}`,
      "instanceId=0",
      `page=%2Fvol%2FbuscarTrenEnlaces.do%3Fc%3D${this.searchId}`,
      `scriptSessionId=${this.scriptSessionId}`,
    ].join("\n");

    const response = await this.request(UPDATE_SESSION_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`Error actualizando sesión: ${response.status}`);
    }
    await response.text();

    console.log("[3/4] Sesión actualizada");
  }

  /**
   * Paso 4: Obtener lista de trenes
   */
  private async getTrainList(config: SearchConfig): Promise<Record<string, unknown>> {
    const fechaEncoded = encodeURIComponent(config.fecha);
    const fechaVuelta = config.tipoViaje === "ida_vuelta" ? encodeURIComponent(config.fecha) : "";
    const trayecto = config.tipoViaje === "ida_vuelta" ? "IV" : "I";

    const payload = [
      "callCount=1",
      "windowName=",
      "c0-scriptName=trainEnlacesManager",
      "c0-methodName=getTrainsList",
      "c0-id=0",
      "c0-e1=string:false",
      "c0-e2=string:false",
      "c0-e3=string:false",
      "c0-e4=string:",
      "c0-e5=string:",
      "c0-e6=string:",
      "c0-e7=string:",
      `c0-e8=string:${fechaEncoded}`,
      `c0-e9=string:${fechaVuelta}`,
      "c0-e10=string:1",
      "c0-e11=string:0",
      "c0-e12=string:0",
      `c0-e13=string:${trayecto}`,
      "c0-e14=string:",
      "c0-param0=Object_Object:{atendo:reference:c0-e1, sinEnlace:reference:c0-e2, plazaH:reference:c0-e3, tipoFranjaI:reference:c0-e4, tipoFranjaV:reference:c0-e5, horaFranjaIda:reference:c0-e6, horaFranjaVuelta:reference:c0-e7, fechaSalida:reference:c0-e8, fechaVuelta:reference:c0-e9, adultos:reference:c0-e10, ninos:reference:c0-e11, ninosMenores:reference:c0-e12, trayecto:reference:c0-e13, idaVuelta:reference:c0-e14}",
      `batchId=${this.nextBatchId()}`,
      "instanceId=0",
      `page=%2Fvol%2FbuscarTrenEnlaces.do%3Fc%3D${this.searchId}`,
      `scriptSessionId=${this.scriptSessionId}`,
    ].join("\n");

    const response = await this.request(TRAIN_LIST_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`Error obteniendo trenes: ${response.status}`);
    }

    const text = await response.text();
    const data = extractTrainList(text);

    console.log("[4/4] Lista de trenes obtenida");
    return data;
  }

  /**
   * Método principal: busca trenes disponibles
   */
  async searchTrains(config: SearchConfig): Promise<SearchResult> {
    // Determinar origen y destino según dirección
    const origin = config.direccion === "ida" ? STATIONS.ALCAZAR : STATIONS.MADRID;
    const destination = config.direccion === "ida" ? STATIONS.MADRID : STATIONS.ALCAZAR;

    console.log(`\nBuscando trenes: ${origin.name} → ${destination.name} | ${config.fecha}`);
    if (config.franjaHoraria) {
      console.log(`Franja horaria: ${config.franjaHoraria.from} - ${config.franjaHoraria.to}`);
    }
    console.log("");

    // Ejecutar los 4 pasos
    await this.doSearch(origin, destination, config);
    await this.getDwrToken();
    await this.updateSessionObjects();
    const data = await this.getTrainList(config);

    // Parsear los trenes
    const listadoTrenes = data["listadoTrenes"] as Array<Record<string, unknown>>;
    if (!listadoTrenes || listadoTrenes.length === 0) {
      return {
        origen: origin.name,
        destino: destination.name,
        fecha: config.fecha,
        trenes: [],
        trenesDisponibles: 0,
        totalTrenes: 0,
      };
    }

    // El primer elemento contiene los trenes de ida
    const trenesIda = listadoTrenes[0] as Record<string, unknown>;
    const listViajes = trenesIda["listviajeViewEnlaceBean"] as Array<Record<string, unknown>>;

    if (!listViajes) {
      return {
        origen: origin.name,
        destino: destination.name,
        fecha: config.fecha,
        trenes: [],
        trenesDisponibles: 0,
        totalTrenes: 0,
      };
    }

    let trenes: TrainResult[] = listViajes.map((train) => ({
      horaSalida: String(train["horaSalida"] ?? ""),
      horaLlegada: String(train["horaLlegada"] ?? ""),
      duracionMinutos: Number(train["duracionViajeTotalEnMinutos"] ?? 0),
      tipoTren: String(train["tipoTrenUno"] ?? ""),
      precio: parsePrice(train["tarifaMinima"]),
      disponible: isTrainAvailable(train),
      completo: Boolean(train["completo"]),
    }));

    // Filtrar por franja horaria si se especificó
    if (config.franjaHoraria) {
      trenes = filterByTimeRange(trenes, config.franjaHoraria);
    }

    const trenesDisponibles = trenes.filter((t) => t.disponible).length;

    return {
      origen: origin.name,
      destino: destination.name,
      fecha: config.fecha,
      trenes,
      trenesDisponibles,
      totalTrenes: trenes.length,
    };
  }
}
