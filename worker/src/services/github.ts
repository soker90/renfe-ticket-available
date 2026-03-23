import type { Env, DispatchParams } from "../types.js";
import { GITHUB_DEFAULT_REF } from "../types.js";

// ---------------------------------------------------------------------------
// Servicio de GitHub Actions — dispatch de workflows
// ---------------------------------------------------------------------------

export const triggerGitHubAction = async (env: Env, params: DispatchParams): Promise<boolean> => {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "renfe-telegram-bot",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: GITHUB_DEFAULT_REF,
      inputs: {
        fecha: params.fecha,
        origen: params.origen,
        destino: params.destino,
        hora_desde: params.horaDesde ?? "",
        hora_hasta: params.horaHasta ?? "",
      },
    }),
  });
  await response.text();
  return response.status === 204;
};
