import type { SettingsSummary } from '../use-cases/spreadsheet/GetSpreadsheetSettings';

const credentialLabels = {
  missing: 'Sin conexión guardada',
  revoked: 'Conexión revocada',
  available: 'Conexión guardada',
} as const;

export const settingsCopies = {
  menu: () =>
    'Configuración de planilla:\n1. Ver estado\n2. Volver a autorizar Google\n3. Cambiar planilla (próximamente)\n4. Cambiar hoja (próximamente)\nEscribí el número de una opción o cancelar.',
  status: (summary: SettingsSummary) =>
    `Conexión: ${credentialLabels[summary.credentialStatus]}\nProveedor: ${summary.provider === 'google' ? 'Google' : summary.provider === 'microsoft' ? 'Microsoft' : 'Sin configurar'}\nPlanilla: ${summary.fileName ?? 'Sin seleccionar'}\nHoja: ${summary.sheetName ?? 'Sin seleccionar'}\nEl acceso actual no se verificó.${!summary.fileName || !summary.sheetName ? '\nCompletá la configuración inicial para elegir una planilla y una hoja.' : ''}`,
  unavailable: () =>
    'Esta opción estará disponible próximamente. Elegí 1 para ver el estado, 2 para autorizar Google o escribí cancelar.',
  choose: () => 'Elegí una opción del 1 al 4 o escribí cancelar.',
  cancelled: () => 'Saliste de configuración.',
  expired: () =>
    'La configuración expiró por inactividad. Escribí configuración para abrirla de nuevo.',
  finishExpense: () => 'Terminá o cancelá el gasto actual antes de abrir configuración.',
  finishOnboarding: () =>
    'Terminá o cancelá la configuración inicial antes de abrir configuración.',
  destinationRequired: () =>
    'Primero completá la configuración de una planilla y una hoja de Google.',
  authUnavailable: () =>
    'La autorización de Google no está disponible en este momento. Intentá más tarde.',
  authLink: (url: string) =>
    `Para volver a autorizar Google, abrí este enlace: ${url}\nTu planilla actual sigue activa hasta confirmar el acceso. Escribí cancelar para salir.`,
  waitForAuth: () =>
    'Esperando la autorización de Google. Abrí el enlace anterior o escribí cancelar.',
  reminder: (url: string) =>
    `Todavía podés autorizar Google desde este enlace: ${url}\nEscribí cancelar para salir.`,
  reauthorized: () => 'Google se volvió a autorizar. Tu planilla y hoja siguen configuradas.',
  denied: () => 'No se autorizó Google. Tu conexión y planilla anteriores siguen activas.',
  accessFailed: () =>
    'No pudimos confirmar acceso de lectura y escritura a tu planilla y hoja actuales. Tu conexión anterior sigue activa.',
  retry: () =>
    'No se pudo completar la autorización. Podés intentar de nuevo con el enlace vigente o escribir cancelar.',
};
