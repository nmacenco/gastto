import { CANCEL_EXIT_HINT, composeMessage } from './compose-message';
import type { SettingsSummary } from '../use-cases/spreadsheet/GetSpreadsheetSettings';

const credentialLabels = {
  missing: 'Sin conexión guardada',
  revoked: 'Conexión revocada',
  available: 'Conexión guardada',
} as const;

export const settingsCopies = {
  filePrompt: (files: ReadonlyArray<{ name: string }>) =>
    composeMessage({
      explanation: files.length
        ? `Elegí una planilla:\n${files.map((file, index) => `${index + 1}. ${file.name}`).join('\n')}`
        : 'No encontramos planillas recientes.',
      action: 'Escribí el número, buscar, buscar seguido del nombre o un enlace de Google Sheets.',
      exit: CANCEL_EXIT_HINT,
    }),
  sheetPrompt: (sheets: ReadonlyArray<{ name: string }>) =>
    composeMessage({
      explanation: `Elegí una hoja:\n${sheets.map((sheet, index) => `${index + 1}. ${sheet.name}`).join('\n')}`,
      action: 'Escribí el número.',
      exit: CANCEL_EXIT_HINT,
    }),
  fileAccessFailed: () =>
    composeMessage({
      explanation: 'No tenés acceso a esa planilla.',
      action: 'Elegí otra.',
      exit: CANCEL_EXIT_HINT,
    }),
  sheetAccessFailed: () =>
    composeMessage({
      explanation: 'No pudimos confirmar lectura y escritura de esa hoja.',
      action: 'Elegí otra hoja.',
      exit: CANCEL_EXIT_HINT,
    }),

  searchTooShort: () =>
    composeMessage({
      explanation: '',
      action: 'Escribí al menos dos letras para buscar una planilla.',
      exit: CANCEL_EXIT_HINT,
    }),
  searchName: () =>
    composeMessage({
      explanation: '',
      action: 'Escribí el nombre de la planilla que querés buscar.',
      exit: CANCEL_EXIT_HINT,
    }),
  emptyCandidate: () =>
    composeMessage({
      explanation: 'La planilla no tiene hojas disponibles.',
      action: 'Elegí otro número o pegá otro enlace.',
      exit: CANCEL_EXIT_HINT,
    }),
  emptyCurrent: () =>
    composeMessage({
      explanation: 'No encontramos hojas en la planilla actual.',
      action: 'Elegí 3 para cambiar de archivo.',
      exit: CANCEL_EXIT_HINT,
    }),
  columnPositions: () =>
    'Respondé sí o no sobre las posiciones de las columnas. Escribí cancelar para salir.',
  headersUnavailable: () =>
    'No pudimos encontrar los encabezados de esa hoja. Elegí el número de otra hoja de la lista anterior. Escribí cancelar para salir.',
  mappingUnavailable: () =>
    'No pudimos proponer un mapeo. Elegí el número de otra hoja de la lista anterior. Escribí cancelar para salir.',
  paymentDetectionUnavailable: () =>
    'No se puede detectar el medio de pago ahora. Escribí confirmar para reintentar. Escribí cancelar para salir.',
  categoryRequired: () =>
    'Debe quedar al menos una categoría activa. Escribí agregar seguido del nombre de la categoría. Escribí cancelar para salir.',
  manualPayment: () =>
    'La detección no está disponible. Escribí agregar seguido del nombre del medio de pago. Escribí cancelar para salir.',
  paymentDetectionFailed: () =>
    'No pudimos leer los medios de pago. Escribí detectar para reintentar o agregar seguido del nombre. Escribí cancelar para salir.',
  configurationChanged: () =>
    'La configuración cambió. Escribí cancelar para salir y después configuración para abrirla de nuevo.',

  menu: () =>
    'Configuración de planilla:\n1. Ver estado\n2. Volver a autorizar Google\n3. Cambiar planilla\n4. Cambiar hoja\n5. Categorías y subcategorías\n6. Medios de pago\n7. Cambiar email de Google\nEscribí el número de una opción o cancelar.',
  status: (summary: SettingsSummary) =>
    `Conexión: ${credentialLabels[summary.credentialStatus]}\nProveedor: ${summary.provider === 'google' ? 'Google' : summary.provider === 'microsoft' ? 'Microsoft' : 'Sin configurar'}\nPlanilla: ${summary.fileName ?? 'Sin seleccionar'}\nHoja: ${summary.sheetName ?? 'Sin seleccionar'}\nEl acceso actual no se verificó.${!summary.fileName || !summary.sheetName ? '\nCompletá la configuración inicial para elegir una planilla y una hoja.' : ''}`,
  unavailable: () =>
    'Esta opción estará disponible próximamente. Elegí 1 para ver el estado, 2 para autorizar Google o escribí cancelar.',
  choose: () => 'Elegí una opción del 1 al 7 o escribí cancelar.',
  cancelled: () => 'Saliste de configuración.',
  expired: () =>
    'La configuración expiró por inactividad. Escribí configuración para abrirla de nuevo.',
  finishExpense: () => 'Terminá o cancelá el gasto actual antes de abrir configuración.',
  finishOnboarding: () =>
    'Terminá o cancelá la configuración inicial antes de abrir configuración.',
  destinationRequired: () =>
    'Primero completá la configuración de una planilla y una hoja de Google. Escribí cancelar para salir y después empezar.',
  authUnavailable: () =>
    'La autorización de Google no está disponible en este momento. Intentá más tarde. Escribí cancelar para salir.',
  authLink: (url: string) =>
    `Para volver a autorizar Google, abrí este enlace: ${url}\nTu planilla actual sigue activa hasta confirmar el acceso. Escribí cancelar para salir.`,
  accountChangeAuthLink: (url: string) =>
    `Para conectar tu nueva cuenta de Google, abrí este enlace: ${url}\nTu cuenta y planilla anteriores siguen activas hasta confirmar una nueva planilla. Escribí cancelar para salir.`,
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
