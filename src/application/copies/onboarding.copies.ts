import type { CloudFile } from '../../domain/entities/CloudFile';
import type { SheetInfo } from '../../domain/entities/SheetInfo';
import type { ColumnInferenceMapping } from '../../domain/ports/columnInference';
import type { GasttoField } from '../../domain/entities/SpreadsheetConfig';

export const onboardingCopies = {
  welcomePrompt: () =>
    '¡Hola! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Para empezar, ¿dónde tenés tu planilla?\n1. Google Drive\n2. OneDrive',
  providerPrompt: () => '¿Dónde tenés tu planilla?\n1. Google Drive\n2. OneDrive',
  invalidRePrompt: () => 'No entendí. Escribí _1_ para Google Drive o _2_ para OneDrive.',
  comingSoon: (provider: string) =>
    `${provider} está en camino 🚧. Escribí _1_ para usar Google Drive por ahora.`,
  authLink: (url: string) =>
    `Hacé clic en este enlace para autorizar a Gastto: ${url}\nTenés 10 minutos.`,
  onboardingPlaceholder: () =>
    'Estamos configurando tu cuenta. Por favor sigue las instrucciones anteriores.',
  googleConnectedSuccess: () => '¡Google Drive conectado! Ahora elegí el archivo de tu planilla.',
  onedriveConnectedSuccess: () => '¡OneDrive conectado! Ahora elegí el archivo de tu planilla.',
  oauthConnectionFailed: (canRetry: boolean) =>
    canRetry
      ? 'No se pudo conectar con Google Drive. Hacé clic en el enlace de arriba para intentar de nuevo.'
      : 'No se pudo conectar. Escribí *cancelar* para salir o contactá a soporte.',
  fileDiscoveryFailed: () =>
    'No pude consultar tus archivos de Google Drive. Intentá de nuevo en unos segundos.',
  fileAccessFailed: () =>
    'No pude acceder a ese archivo en Google Drive. Verificá los permisos o intentá con otro.',
  sheetDiscoveryFailed: () =>
    'No pude leer las hojas del archivo. Intentá de nuevo en unos segundos.',
  cancelledMessage: () => 'Conexión cancelada. Escribí *empezar* cuando quieras intentar de nuevo.',
  waitForAuthPrompt: () =>
    'Please complete the authorization in your browser or type cancel to abort',
  reminderMessage: (url: string) =>
    `Todavía no completaste la autorización. Hacé clic acá para continuar: ${url}\nTenés 10 minutos.`,
  fileListPrompt: (files: CloudFile[]) => {
    const lines = files.map((f, i) => `${i + 1}. ${f.name}`);
    lines.push(`${files.length + 1}. Ninguno de estos / buscar por nombre`);
    return `Encontré estos archivos recientes:\n${lines.join('\n')}`;
  },
  noFilesFoundPrompt: () =>
    'No encontré archivos de planilla en tu cuenta. Verificá que tengas archivos en Google Drive y probá de nuevo, o escribí parte del nombre para buscar.',
  fileSelectedConfirmation: (fileName: string) =>
    `Elegiste *${fileName}*. Ahora vamos a seleccionar la hoja dentro del archivo.`,
  invalidSelectionRePrompt: (fileCount: number) =>
    `No entendí. Escribí un número del *1* al *${fileCount}*, o *${fileCount + 1}* para buscar por nombre.`,
  searchByNamePrompt: () => 'Escribí parte del nombre del archivo que querés usar:',
  urlValidationFailed: () =>
    'No pude acceder a ese archivo. Verificá que el enlace sea correcto y que tengas permisos.',
  urlValidationSuccess: (fileName: string) =>
    `Elegiste *${fileName}*. Ahora vamos a seleccionar la hoja dentro del archivo.`,

  // Sheet selection copies (HU-4.03)
  singleSheetAutoConfirm: (sheetName: string) =>
    `Solo encontré una hoja: *${sheetName}*. La usaré para registrar tus gastos.`,
  singleSheetConfirmation: (sheetName: string) =>
    `Solo encontré una hoja: *${sheetName}*. La usaré para registrar tus gastos.`,
  sheetListPrompt: (sheets: SheetInfo[]) => {
    const lines = sheets.map((s, i) => `${i + 1}. ${s.name}`);
    lines.push(`${sheets.length + 1}. No sé / ninguna de estas`);
    return `El archivo tiene ${sheets.length} hojas. ¿Cuál querés usar?\n${lines.join('\n')}`;
  },
  sheetSelectedConfirmation: (sheetName: string) =>
    `Elegiste la hoja *${sheetName}*. Ahora vamos a analizar la estructura.`,
  invalidSheetRePrompt: (sheetCount: number) =>
    `No encontré esa hoja. Escribí un número del *1* al *${sheetCount}*, o el nombre exacto.`,
  sheetNotFoundRePrompt: (sheets: SheetInfo[]) => {
    const lines = sheets.map((s, i) => `${i + 1}. ${s.name}`);
    return `No encontré esa hoja. Elegí una de estas:\n${lines.join('\n')}`;
  },
  sheetHeadersDescription: (sheetName: string, headers: string[]) =>
    `Hoja *${sheetName}*: tiene las columnas ${headers.join(', ')}`,
  sheetHeaderDescription: (descriptions: { sheetName: string; headers: string[] }[]) =>
    descriptions
      .map((d) => `Hoja *${d.sheetName}*: tiene las columnas ${d.headers.join(', ')}`)
      .join('\n'),
  sheetIdkPrompt: () => `No te preocupes. Te describo las hojas para que elijas:`,
  sheetMappingTransition: () => `Ahora vamos a analizar la estructura.`,

  readOnlyWarning: () =>
    `Puedo ver tu planilla pero no tengo permiso para escribir en ella.\n\nPara corregirlo:\n• *Google Drive:* Abrí el archivo → Compartir → Agregá tu cuenta de Gastto con rol *Editor*.\n• *OneDrive:* Abrí el archivo → Compartir → Dale permisos de *Edición*.\n\nCuando lo hayas hecho, escribí *reintentar* para volver a verificar.`,

  emptySheetConfirm: (sheetName: string) =>
    `La hoja *${sheetName}* parece estar vacía. ¿Es la correcta?\n\nRespondé *sí* para confirmar o escribí el nombre/número de otra hoja.`,

  emptySheetConfirmedOutOfMvp: () =>
    `Entendido. La funcionalidad de planillas vacías estará disponible próximamente. Por ahora, elegí una hoja que tenga datos para continuar.`,

  reconnectAccount: () =>
    `No pude acceder a tu planilla. Puede que la conexión con tu cuenta se haya vencido.\n\nEscribí *empezar* para reconectar tu cuenta e intentar de nuevo.`,

  // Column mapping copies (HU-4.05)
  mappingProposalHighConfidence: (mappings: ColumnInferenceMapping[], unmappedFields: GasttoField[]) => {
    const lines = mappings.map(
      (m) => `${GASTTO_FIELD_EMOJI[m.gasttoField]} ${GASTTO_FIELD_LABELS[m.gasttoField]} → columna ${columnIndexToLetter(m.columnIndex)} (${m.columnHeader})`,
    );
    let message = `Esto encontré en tu planilla:\n${lines.join('\n')}\n\n¿Está correcto?`;
    if (unmappedFields.length > 0) {
      message += `\n\n${formatUnmappedFields(unmappedFields)}`;
    }
    return message;
  },

  mappingProposalLowConfidence: (mappings: ColumnInferenceMapping[], unmappedFields: GasttoField[]) => {
    const lines = mappings.map(
      (m) => `${GASTTO_FIELD_EMOJI[m.gasttoField]} ${GASTTO_FIELD_LABELS[m.gasttoField]} → columna ${columnIndexToLetter(m.columnIndex)} (${m.columnHeader})`,
    );
    let message = `No estoy seguro de algunos campos, este es mi mejor intento:\n${lines.join('\n')}`;
    if (unmappedFields.length > 0) {
      message += `\n\n${formatUnmappedFields(unmappedFields)}`;
    }
    message += '\n\n¿Está correcto?';
    return message;
  },

  noHeaderPrompt: () =>
    `Parece que tu planilla no tiene una fila de encabezados.\n\n¿En qué fila comienzan los datos? Escribí el número de fila.`,

  unmappedFieldsNote: (fields: GasttoField[]) => formatUnmappedFields(fields),
};

const GASTTO_FIELD_LABELS: Record<GasttoField, string> = {
  fecha: 'Fecha',
  monto: 'Monto',
  categoria: 'Categoría',
  concepto: 'Concepto',
  medio_pago: 'Medio de pago',
  moneda: 'Moneda',
};

const GASTTO_FIELD_EMOJI: Record<GasttoField, string> = {
  fecha: '📅',
  monto: '💰',
  categoria: '🏷️',
  concepto: '📝',
  medio_pago: '💳',
  moneda: '💱',
};

function columnIndexToLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function formatUnmappedFields(fields: GasttoField[]): string {
  const labels = fields.map((f) => GASTTO_FIELD_LABELS[f]).join(', ');
  return `No encontré columnas para: ${labels}. Estos campos se omitirán al registrar.`;
}
