import type { SettingsSummary } from '../use-cases/spreadsheet/GetSpreadsheetSettings';

const credentialLabels = {
  missing: 'Sin conexión guardada',
  revoked: 'Conexión revocada',
  available: 'Conexión guardada',
} as const;

export const settingsCopies = {
  menu: () =>
    'Configuración de planilla:\n1. Ver estado\n2. Volver a autorizar Google (próximamente)\n3. Cambiar planilla (próximamente)\n4. Cambiar hoja (próximamente)\nEscribí el número de una opción o cancelar.',
  status: (summary: SettingsSummary) =>
    `Conexión: ${credentialLabels[summary.credentialStatus]}\nProveedor: ${summary.provider === 'google' ? 'Google' : summary.provider === 'microsoft' ? 'Microsoft' : 'Sin configurar'}\nPlanilla: ${summary.fileName ?? 'Sin seleccionar'}\nHoja: ${summary.sheetName ?? 'Sin seleccionar'}\nEl acceso actual no se verificó.${!summary.fileName || !summary.sheetName ? '\nCompletá la configuración inicial para elegir una planilla y una hoja.' : ''}`,
  unavailable: () =>
    'Esta opción estará disponible próximamente. Elegí 1 para ver el estado o escribí cancelar.',
  choose: () => 'Elegí una opción del 1 al 4 o escribí cancelar.',
  cancelled: () => 'Saliste de configuración.',
  expired: () =>
    'La configuración expiró por inactividad. Escribí configuración para abrirla de nuevo.',
  finishExpense: () => 'Terminá o cancelá el gasto actual antes de abrir configuración.',
  finishOnboarding: () => 'Terminá o cancelá la configuración inicial antes de abrir configuración.',
};
