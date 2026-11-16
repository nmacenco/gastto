import { CANCEL_EXIT_HINT, composeMessage } from './compose-message';
import type { SettingsSummary } from '../use-cases/spreadsheet/GetSpreadsheetSettings';

const credentialLabels = {
  missing: 'Sin conexión guardada',
  revoked: 'Conexión revocada',
  available: 'Conexión guardada',
} as const;

export const settingsCopies = {
  accountConnectedChooseFile: () =>
    composeMessage({
      explanation: 'Google se conectó.',
      action: 'Escribí buscar para elegir una planilla nueva.',
      exit: CANCEL_EXIT_HINT,
    }),
  paymentDraft: (methods: string[], mapped: boolean) =>
    composeMessage({
      explanation: `Borrador de medios de pago:\n${methods.join('\n') || '(sin medios de pago)'}${mapped ? '' : '\n\nLos medios de pago se conservarán en Gastto, pero no se escribirán en la planilla porque no hay una columna mapeada.'}`,
      action:
        'Ejemplos:\n• detectar\n• agregar Efectivo\n• renombrar Efectivo a Dinero\n• quitar Dinero\n\nEscribí confirmar para guardar este catálogo, incluso si está vacío.',
      exit: `Los cambios sin confirmar se descartarán al salir.\n\n${CANCEL_EXIT_HINT}`,
    }),
  categoryDraft: (lines: string[], mapped: boolean) =>
    composeMessage({
      explanation: `Borrador de categorías y subcategorías:\n${lines.join('\n') || '(sin categorías activas)'}${mapped ? '' : '\n\nLas subcategorías se conservarán en Gastto, pero no se escribirán en la planilla porque no hay una columna mapeada.'}`,
      action:
        'Ejemplos:\n• agregar categoría Comida\n• Comida se llama Alimentación\n• quitar Comida\n• agregar subcategoría Café a Comida\n• en Comida renombrar Café a Cafetería\n• mover Café de Comida a Ocio\n• quitar Café de Comida\n\nEscribí confirmar para guardar todos los cambios.',
      exit: `Los cambios sin confirmar se descartarán al salir.\n\n${CANCEL_EXIT_HINT}`,
    }),

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
      action: 'Escribí al menos dos letras para buscar una planilla.',
      exit: CANCEL_EXIT_HINT,
    }),
  searchName: () =>
    composeMessage({
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
    composeMessage({
      action: 'Respondé sí o no sobre las posiciones de las columnas.',
      exit: CANCEL_EXIT_HINT,
    }),
  headersUnavailable: () =>
    composeMessage({
      explanation: 'No pudimos encontrar los encabezados de esa hoja.',
      action: 'Elegí el número de otra hoja de la lista anterior.',
      exit: CANCEL_EXIT_HINT,
    }),
  mappingUnavailable: () =>
    composeMessage({
      explanation: 'No pudimos proponer un mapeo.',
      action: 'Elegí el número de otra hoja de la lista anterior.',
      exit: CANCEL_EXIT_HINT,
    }),
  paymentDetectionUnavailable: () =>
    composeMessage({
      explanation: 'No se puede detectar el medio de pago ahora.',
      action: 'Escribí confirmar para reintentar.',
      exit: CANCEL_EXIT_HINT,
    }),
  categoryRequired: () =>
    composeMessage({
      explanation: 'Debe quedar al menos una categoría activa.',
      action: 'Escribí agregar seguido del nombre de la categoría.',
      exit: CANCEL_EXIT_HINT,
    }),
  manualPayment: () =>
    composeMessage({
      explanation: 'La detección no está disponible.',
      action: 'Escribí agregar seguido del nombre del medio de pago.',
      exit: CANCEL_EXIT_HINT,
    }),
  paymentDetectionFailed: () =>
    composeMessage({
      explanation: 'No pudimos leer los medios de pago.',
      action: 'Escribí detectar para reintentar o agregar seguido del nombre.',
      exit: CANCEL_EXIT_HINT,
    }),
  configurationChanged: () =>
    composeMessage({
      explanation: 'La configuración cambió.',
      action: '1. Escribí cancelar para salir.\n2. Escribí configuración para abrirla de nuevo.',
    }),
  menu: () =>
    composeMessage({
      explanation:
        'Configuración de planilla:\n1. Ver estado\n2. Volver a autorizar Google\n3. Cambiar planilla\n4. Cambiar hoja\n5. Categorías y subcategorías\n6. Medios de pago\n7. Cambiar email de Google',
      action: 'Escribí el número de una opción.',
      exit: CANCEL_EXIT_HINT,
    }),
  status: (summary: SettingsSummary) =>
    `Conexión: ${credentialLabels[summary.credentialStatus]}\nProveedor: ${summary.provider === 'google' ? 'Google' : summary.provider === 'microsoft' ? 'Microsoft' : 'Sin configurar'}\nPlanilla: ${summary.fileName ?? 'Sin seleccionar'}\nHoja: ${summary.sheetName ?? 'Sin seleccionar'}\n\n\nEl acceso actual no se verificó.${!summary.fileName || !summary.sheetName ? '\n\nCompletá la configuración inicial para elegir una planilla y una hoja.' : ''}`,
  unavailable: () =>
    composeMessage({
      explanation: 'Esta opción estará disponible próximamente.',
      action: 'Elegí 1 para ver el estado o 2 para autorizar Google.',
      exit: CANCEL_EXIT_HINT,
    }),
  choose: () => composeMessage({ action: 'Elegí una opción del 1 al 7.', exit: CANCEL_EXIT_HINT }),
  cancelled: () => 'Saliste de configuración.',
  expired: () =>
    composeMessage({
      explanation: 'La configuración expiró por inactividad.',
      action: 'Escribí configuración para abrirla de nuevo.',
    }),
  finishExpense: () => 'Terminá o cancelá el gasto actual antes de abrir configuración.',
  finishOnboarding: () =>
    'Terminá o cancelá la configuración inicial antes de abrir configuración.',
  destinationRequired: () =>
    composeMessage({
      explanation: 'Primero completá la configuración de una planilla y una hoja de Google.',
      action: '1. Escribí cancelar para salir.\n2. Escribí empezar.',
    }),
  authUnavailable: () =>
    composeMessage({
      explanation: 'La autorización de Google no está disponible en este momento.',
      action: 'Intentá más tarde.',
      exit: CANCEL_EXIT_HINT,
    }),
  authLink: (url: string) =>
    composeMessage({
      explanation: 'Tu planilla actual sigue activa hasta confirmar el acceso.',
      action: `Para volver a autorizar Google, abrí este enlace: ${url}`,
      exit: CANCEL_EXIT_HINT,
    }),
  accountChangeAuthLink: (url: string) =>
    composeMessage({
      explanation:
        'Tu cuenta y planilla anteriores siguen activas hasta confirmar una nueva planilla.',
      action: `Para conectar tu nueva cuenta de Google, abrí este enlace: ${url}`,
      exit: CANCEL_EXIT_HINT,
    }),
  waitForAuth: () =>
    composeMessage({
      explanation: 'Esperando la autorización de Google.',
      action: 'Abrí el enlace anterior.',
      exit: CANCEL_EXIT_HINT,
    }),
  reminder: (url: string) =>
    composeMessage({
      action: `Todavía podés autorizar Google desde este enlace: ${url}`,
      exit: CANCEL_EXIT_HINT,
    }),
  reauthorized: () => 'Google se volvió a autorizar. Tu planilla y hoja siguen configuradas.',
  denied: () => 'No se autorizó Google. Tu conexión y planilla anteriores siguen activas.',
  accessFailed: () =>
    'No pudimos confirmar acceso de lectura y escritura a tu planilla y hoja actuales. Tu conexión anterior sigue activa.',
  retry: () =>
    composeMessage({
      explanation: 'No se pudo completar la autorización.',
      action: 'Podés intentar de nuevo con el enlace vigente.',
      exit: CANCEL_EXIT_HINT,
    }),
};
