import type { Station, SearchConfig, RawTrainData, TrainResult, SearchResult } from "../types.js";
import { STATIONS } from "../types.js";
import { CookieClient } from "./http.js";
import { createSearchId, createScriptSessionId, extractDwrToken, extractTrainList } from "./dwr.js";
import { isTrainAvailable, parsePrice, filterByTimeRange } from "./parser.js";

// ---------------------------------------------------------------------------
// URLs de la API de Renfe
// ---------------------------------------------------------------------------

const SEARCH_URL = "https://venta.renfe.com/vol/buscarTren.do?Idioma=es&Pais=ES";
const DWR_ENDPOINT = "https://venta.renfe.com/vol/dwr/call/plaincall/";
const SYSTEM_ID_URL = `${DWR_ENDPOINT}__System.generateId.dwr`;
const UPDATE_SESSION_URL = `${DWR_ENDPOINT}buyEnlacesManager.actualizaObjetosSesion.dwr`;
const TRAIN_LIST_URL = `${DWR_ENDPOINT}trainEnlacesManager.getTrainsList.dwr`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyResult = (origin: Station, destination: Station, fecha: string): SearchResult => ({
  origen: origin.name,
  destino: destination.name,
  fecha,
  trenes: [],
  trenesDisponibles: 0,
  totalTrenes: 0,
});

// ---------------------------------------------------------------------------
// Clase principal de la API de Renfe
// ---------------------------------------------------------------------------

export class RenfeAPI {
  private client = new CookieClient();
  private searchId = "";
  private dwrToken = "";
  private scriptSessionId = "";
  private batchId = 0;

  private nextBatchId(): number {
    return this.batchId++;
  }

  /** Paso 1: Inicializar búsqueda en Renfe */
  private async doSearch(origin: Station, destination: Station, config: SearchConfig): Promise<void> {
    const searchCookie = JSON.stringify({
      origen: { code: origin.code, name: origin.name },
      destino: { code: destination.code, name: destination.name },
      pasajerosAdultos: 1,
      pasajerosNinos: 0,
      pasajerosSpChild: 0,
    });
    this.client.setCookie("Search", searchCookie);

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

    const response = await this.client.request(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new Error(`Error en búsqueda inicial: ${response.status} ${response.statusText}`);
    }

    await response.text();
  }

  /** Paso 2: Obtener token DWR */
  private async getDwrToken(): Promise<void> {
    this.searchId = createSearchId();

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

    const resp1 = await this.client.request(SYSTEM_ID_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload1,
    });
    await resp1.text();

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

    const resp2 = await this.client.request(SYSTEM_ID_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload2,
    });

    const text = await resp2.text();
    this.dwrToken = extractDwrToken(text);

    this.client.setCookie("DWRSESSIONID", this.dwrToken);
    this.scriptSessionId = createScriptSessionId(this.dwrToken);
  }

  /** Paso 3: Actualizar objetos de sesión */
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

    const response = await this.client.request(UPDATE_SESSION_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`Error actualizando sesión: ${response.status}`);
    }
    await response.text();
  }

  /** Paso 4: Obtener lista de trenes */
  private async getTrainList(config: SearchConfig): Promise<{ listadoTrenes?: Array<{ listviajeViewEnlaceBean?: RawTrainData[] }> }> {
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

    const response = await this.client.request(TRAIN_LIST_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`Error obteniendo trenes: ${response.status}`);
    }

    const text = await response.text();
    return extractTrainList(text);
  }

  /** Método principal: busca trenes disponibles */
  async searchTrains(config: SearchConfig): Promise<SearchResult> {
    const origin = STATIONS[config.origenKey];
    const destination = STATIONS[config.destinoKey];

    // Ejecutar los 4 pasos
    await this.doSearch(origin, destination, config);
    await this.getDwrToken();
    await this.updateSessionObjects();
    const data = await this.getTrainList(config);

    // Parsear los trenes
    const listadoTrenes = data.listadoTrenes;
    if (!listadoTrenes || listadoTrenes.length === 0) {
      return emptyResult(origin, destination, config.fecha);
    }

    const trenesIda = listadoTrenes[0];
    const listViajes = trenesIda.listviajeViewEnlaceBean;

    if (!listViajes) {
      return emptyResult(origin, destination, config.fecha);
    }

    let trenes: TrainResult[] = listViajes.map((train: RawTrainData) => ({
      horaSalida: String(train.horaSalida ?? ""),
      horaLlegada: String(train.horaLlegada ?? ""),
      duracionMinutos: Number(train.duracionViajeTotalEnMinutos ?? 0),
      tipoTren: String(train.tipoTrenUno ?? ""),
      precio: parsePrice(train.tarifaMinima),
      disponible: isTrainAvailable(train),
      completo: Boolean(train.completo),
    }));

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
