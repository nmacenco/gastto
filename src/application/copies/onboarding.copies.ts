import { CANCEL_EXIT_HINT, composeMessage } from './compose-message';
import { spreadsheetRecoveryCopies } from './spreadsheet-recovery.copies';
import type { CloudFile } from '../../domain/entities/CloudFile';
import type { SheetInfo } from '../../domain/entities/SheetInfo';
import type { ColumnInferenceMapping } from '../../domain/ports/columnInference';
import { SUPPORTED_GASTTO_FIELDS, type GasttoField } from '../../domain/entities/SpreadsheetConfig';
import type { CategoryOnboardingCategory } from '../dtos/CategoryOnboardingState';

export const onboardingCopies = {
  welcomePrompt: () =>
    composeMessage({
      explanation: '¡Hola! Bienvenido a Gastto. Soy tu asistente financiero conversacional.',
      action: 'Para empezar, ¿dónde tenés tu planilla?\n1. Google Drive\n2. OneDrive',
    }),
  providerPrompt: () => '¿Dónde tenés tu planilla?\n1. Google Drive\n2. OneDrive',
  invalidRePrompt: () =>
    composeMessage({
      explanation: 'No entendí.',
      action: 'Escribí _1_ para Google Drive o _2_ para OneDrive.',
      exit: CANCEL_EXIT_HINT,
    }),
  comingSoon: (provider: string) =>
    composeMessage({
      explanation: `${provider} está en camino 🚧.`,
      action: '1. Escribí cancelar para salir.\n2. Escribí empezar para elegir Google Drive.',
    }),
  authLink: (url: string) =>
    composeMessage({
      explanation: 'Tenés 10 minutos.',
      action: `Hacé clic en este enlace para autorizar a Gastto: ${url}`,
    }),
  onboardingPlaceholder: () =>
    composeMessage({
      explanation: 'Estamos configurando tu cuenta.',
      action: 'Seguí las instrucciones del último paso.',
      exit: CANCEL_EXIT_HINT,
    }),
  googleConnectedSuccess: () => '¡Google Drive conectado! Ahora elegí el archivo de tu planilla.',
  googleReconnectedSuccess: () =>
    '¡Google Drive reconectado! Conservé tu planilla y columnas. Enviá el gasto nuevamente para registrarlo.',
  onedriveConnectedSuccess: () => '¡OneDrive conectado! Ahora elegí el archivo de tu planilla.',
  oauthConnectionFailed: (canRetry: boolean) =>
    canRetry
      ? composeMessage({
          explanation: 'No se pudo conectar con Google Drive.',
          action: 'Hacé clic en el enlace de arriba para intentar de nuevo.',
        })
      : composeMessage({
          explanation: 'No se pudo conectar.',
          action: 'Podés contactar a soporte.',
          exit: CANCEL_EXIT_HINT,
        }),
  fileDiscoveryFailed: () =>
    composeMessage({
      explanation: 'No pude consultar tus archivos de Google Drive.',
      action: 'Enviá parte del nombre para buscar de nuevo.',
      exit: CANCEL_EXIT_HINT,
    }),
  fileAccessFailed: () =>
    composeMessage({
      explanation: 'No pude acceder a ese archivo en Google Drive.',
      action: `Verificá los permisos. ${spreadsheetRecoveryCopies.chooseAnotherFile('onboarding')}`,
    }),
  sheetDiscoveryFailed: () =>
    composeMessage({
      explanation: 'No pude consultar la planilla.',
      action: 'Enviá reintentar para volver a consultar.',
      exit: CANCEL_EXIT_HINT,
    }),
  cancelledMessage: () =>
    composeMessage({
      explanation: 'Conexión cancelada.',
      action: 'Escribí *empezar* cuando quieras intentar de nuevo.',
    }),
  flowCancelled: (configured: boolean) =>
    configured
      ? composeMessage({
          explanation: 'Configuración cancelada. Tu planilla anterior sigue activa.',
          action: 'Escribí *configuración* para verla o cambiarla.',
        })
      : composeMessage({
          explanation: 'Configuración cancelada.',
          action: 'Escribí *empezar* cuando quieras elegir una planilla de nuevo.',
        }),
  setupRequired: () =>
    composeMessage({
      explanation: 'Tu planilla todavía no está configurada.',
      action: 'Escribí *empezar* para continuar con la configuración.',
    }),
  alreadyConfigured: () =>
    composeMessage({
      explanation: 'Tu planilla ya está configurada.',
      action: 'Escribí *configuración* para verla o cambiarla.',
    }),
  waitForAuthPrompt: () =>
    composeMessage({ action: 'Completá la autorización en tu navegador.', exit: CANCEL_EXIT_HINT }),
  reminderMessage: (url: string) =>
    composeMessage({
      explanation: 'Todavía no completaste la autorización. Tenés 10 minutos.',
      action: `Hacé clic acá para continuar: ${url}`,
    }),
  fileListPrompt: (files: CloudFile[]) => {
    const lines = files.map((f, i) => `${i + 1}. ${f.name}`);
    lines.push(`${files.length + 1}. Ninguno de estos / buscar por nombre`);
    return composeMessage({
      explanation: 'Encontré estos archivos recientes:',
      action: lines.join('\n'),
    });
  },
  noFilesFoundPrompt: () =>
    composeMessage({
      explanation: 'No encontré planillas.',
      action:
        'Escribí parte del nombre para buscar o pegá un enlace HTTPS de Google Sheets o Drive.',
      exit: CANCEL_EXIT_HINT,
    }),
  fileSelectedConfirmation: (fileName: string) =>
    `Elegiste *${fileName}*. Ahora vamos a seleccionar la hoja dentro del archivo.`,
  invalidSelectionRePrompt: (fileCount: number) =>
    fileCount === 0
      ? onboardingCopies.searchByNamePrompt()
      : composeMessage({
          explanation: 'No entendí.',
          action: `Escribí un número del *1* al *${fileCount}*, o *${fileCount + 1}* para buscar por nombre.`,
          exit: CANCEL_EXIT_HINT,
        }),
  ambiguousFileReference: () =>
    composeMessage({
      explanation: 'Encontré más de una opción con esa referencia.',
      action: 'Elegí el número exacto de la lista.',
    }),
  fileReferenceNotFound: () =>
    composeMessage({
      explanation: 'No encontré esa opción en la lista actual.',
      action: 'Elegí el número exacto de la lista.',
    }),
  staleFileReference: () =>
    composeMessage({
      explanation: 'La lista de archivos cambió.',
      action: 'Revisá la lista actual y elegí nuevamente.',
    }),
  searchByNamePrompt: () =>
    composeMessage({
      action:
        'Escribí parte del nombre para buscar o pegá un enlace HTTPS de Google Sheets o Drive.',
      exit: CANCEL_EXIT_HINT,
    }),
  unsupportedFileLink: () =>
    composeMessage({
      explanation: 'Ese enlace no corresponde a una planilla compatible.',
      action:
        'Pegá un enlace HTTPS de Google Sheets o Drive o escribí parte del nombre para buscar.',
      exit: CANCEL_EXIT_HINT,
    }),
  urlValidationFailed: () =>
    composeMessage({
      explanation: 'No pude acceder a ese archivo.',
      action: 'Verificá que el enlace sea correcto y que tengas permisos.',
      exit: CANCEL_EXIT_HINT,
    }),
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
    return composeMessage({
      explanation: `El archivo tiene ${sheets.length} hojas. ¿Cuál querés usar?`,
      action: lines.join('\n'),
    });
  },
  sheetSelectedConfirmation: (sheetName: string) =>
    `Elegiste la hoja *${sheetName}*. Ahora vamos a analizar la estructura.`,
  configuredDestinationConflict: () =>
    composeMessage({
      explanation: 'Tu planilla actual ya está configurada.',
      action:
        '1. Escribí cancelar para salir de este flujo.\n2. Escribí configuración.\n3. Elegí la opción para cambiar el destino sin perder el historial.',
    }),
  invalidSheetRePrompt: (sheetCount: number) =>
    composeMessage({
      explanation: 'No encontré esa hoja.',
      action: `Escribí un número del *1* al *${sheetCount}*, o el nombre exacto.`,
      exit: CANCEL_EXIT_HINT,
    }),
  sheetNotFoundRePrompt: (sheets: SheetInfo[]) => {
    if (sheets.length === 0) return onboardingCopies.fileAccessFailed();
    const lines = sheets.map((s, i) => `${i + 1}. ${s.name}`);
    return composeMessage({
      explanation: 'No encontré esa hoja.',
      action: `Elegí una de estas:\n${lines.join('\n')}`,
      exit: CANCEL_EXIT_HINT,
    });
  },
  ambiguousSheetReference: () =>
    composeMessage({
      explanation: 'Encontré más de una hoja con esa referencia.',
      action: 'Elegí el número exacto de la lista.',
    }),
  sheetReferenceNotFound: () =>
    composeMessage({
      explanation: 'No encontré esa hoja en la lista actual.',
      action: 'Elegí el número exacto de la lista.',
    }),
  staleSheetReference: () =>
    composeMessage({
      explanation: 'La lista de hojas cambió.',
      action: 'Revisá la lista actual y elegí nuevamente.',
    }),
  sheetHeadersDescription: (sheetName: string, headers: string[]) =>
    `Hoja *${sheetName}*: tiene las columnas ${headers.join(', ')}`,
  sheetHeaderDescription: (descriptions: { sheetName: string; headers: string[] }[]) =>
    descriptions
      .map((d) => `Hoja *${d.sheetName}*: tiene las columnas ${d.headers.join(', ')}`)
      .join('\n'),
  sheetIdkPrompt: () => `No te preocupes. Te describo las hojas para que elijas:`,
  sheetMappingTransition: () => `Ahora vamos a analizar la estructura.`,

  readOnlyWarning: () =>
    composeMessage({
      explanation: 'Puedo ver tu planilla pero no tengo permiso para escribir en ella.',
      action:
        'Para corregirlo:\n• *Google Drive:* Abrí el archivo → Compartir → Dale a la cuenta de Google conectada el rol *Editor*.\n• *OneDrive:* Abrí el archivo → Compartir → Dale permisos de *Edición*.\n\nCuando lo hayas hecho, escribí *reintentar* para volver a verificar.',
      exit: CANCEL_EXIT_HINT,
    }),
  emptySheetConfirm: (sheetName: string) =>
    composeMessage({
      explanation: `La hoja *${sheetName}* parece estar vacía. ¿Es la correcta?`,
      action: 'Respondé *sí* para confirmar o escribí *otra hoja* para ver las opciones.',
      exit: CANCEL_EXIT_HINT,
    }),
  emptySheetConfirmedOutOfMvp: () =>
    composeMessage({
      explanation:
        'Entendido. La funcionalidad de planillas vacías estará disponible próximamente.',
      action: 'Por ahora, escribí otra hoja para elegir una que tenga datos.',
      exit: CANCEL_EXIT_HINT,
    }),
  reconnectAccount: () =>
    composeMessage({
      explanation:
        'No pude acceder a tu planilla. Puede que la conexión con tu cuenta se haya vencido.',
      action: 'Escribí *empezar* para reconectar tu cuenta e intentar de nuevo.',
      exit: CANCEL_EXIT_HINT,
    }),
  mappingProposalHighConfidence: (
    mappings: ColumnInferenceMapping[],
    unmappedFields: GasttoField[],
  ) => {
    const lines = mappings.map(
      (m) =>
        `${GASTTO_FIELD_EMOJI[m.gasttoField]} ${GASTTO_FIELD_LABELS[m.gasttoField]} → columna ${columnIndexToLetter(m.columnIndex)} (${m.columnHeader})`,
    );
    let message = `Esto encontré en tu planilla:\n${lines.join('\n')}\n\n¿Está correcto?`;
    if (unmappedFields.length > 0) {
      message += `\n\n${formatUnmappedFields(unmappedFields)}`;
    }
    return message;
  },

  mappingProposalLowConfidence: (
    mappings: ColumnInferenceMapping[],
    unmappedFields: GasttoField[],
  ) => {
    const lines = mappings.map(
      (m) =>
        `${GASTTO_FIELD_EMOJI[m.gasttoField]} ${GASTTO_FIELD_LABELS[m.gasttoField]} → columna ${columnIndexToLetter(m.columnIndex)} (${m.columnHeader})`,
    );
    let message = `No estoy seguro de algunos campos, este es mi mejor intento:\n${lines.join('\n')}`;
    if (unmappedFields.length > 0) {
      message += `\n\n${formatUnmappedFields(unmappedFields)}`;
    }
    message += '\n\n¿Está correcto?';
    return message;
  },

  noHeaderPrompt: () =>
    composeMessage({
      explanation: 'No pude reconocer una fila de encabezados en esta hoja.',
      action:
        'Si hay encabezados antes de los datos, escribí el número de la primera fila de datos.\n\nTambién podés escribir *otra hoja* para elegir una distinta.',
      exit: CANCEL_EXIT_HINT,
    }),
  invalidDataStartRowPrompt: () =>
    composeMessage({
      explanation: 'No entendí la fila.',
      action:
        'Si hay encabezados antes de los datos, escribí el número de fila donde comienzan los datos (mayor a 1).\n\nTambién podés escribir *otra hoja*.',
      exit: CANCEL_EXIT_HINT,
    }),
  mappingConfirmedNextStep: () =>
    `¡Listo! El mapeo de columnas quedó confirmado. Ahora vamos a revisar las categorías de tu planilla.`,

  categoryConfirmationPrompt: (categories: string[]) => {
    const list = categories.map((c) => `• ${c}`).join('\n');
    return `Encontré estas categorías en tu planilla:\n${list}\n\n¿Las usamos tal cual? Respondé *sí* o decime si querés agregar/quitar alguna.`;
  },

  categoryHierarchyConfirmationPrompt: (
    categories: CategoryOnboardingCategory[],
    orphanSubcategories: string[],
  ) => {
    const hierarchy = categories
      .flatMap((category) => [
        `• ${category.name}`,
        ...category.subcategories.map((subcategory) => `  ◦ ${subcategory}`),
      ])
      .join('\n');
    const orphanWarning = onboardingCopies.orphanSubcategoriesWarning(orphanSubcategories);
    return `Encontré estas categorías y subcategorías en tu planilla:\n${hierarchy}${orphanWarning}\n\n¿Las usamos tal cual? Respondé *sí* o decime si querés agregar/quitar alguna.`;
  },

  orphanSubcategoriesWarning: (orphanSubcategories: string[]) => {
    if (orphanSubcategories.length === 0) return '';
    const values = orphanSubcategories.map((subcategory) => `• ${subcategory}`).join('\n');
    return `\n\n⚠️ Excluí estas subcategorías porque no tenían una categoría padre asignada:\n${values}`;
  },

  noMappingToConfirm: () =>
    composeMessage({
      explanation: 'Todavía no tengo una propuesta de mapeo para confirmar.',
      action:
        '1. Escribí cancelar para salir.\n2. Escribí empezar para configurar la planilla de nuevo.',
    }),
  categoryProposalUnavailable: () =>
    composeMessage({
      explanation: 'No pude validar la propuesta de categorías.',
      action: 'Enviá confirmar para detectarla de nuevo antes de completar la configuración.',
      exit: CANCEL_EXIT_HINT,
    }),
  unmappedFieldsNote: (fields: GasttoField[]) => formatUnmappedFields(fields),

  // Mapping correction copies (HU-4.06)
  mappingUpdatedConfirmation: (
    mappings: { gasttoField: GasttoField; columnIndex: number; columnHeader: string }[],
    unmappedFields: GasttoField[],
    displacedFields: GasttoField[] = [],
  ) => {
    const lines = mappings.map(
      (m) =>
        `${GASTTO_FIELD_EMOJI[m.gasttoField]} ${GASTTO_FIELD_LABELS[m.gasttoField]} → columna ${columnIndexToLetter(m.columnIndex)} (${m.columnHeader})`,
    );
    let message = `Actualicé el mapeo:
${lines.join('\n')}\n\n¿Está correcto ahora?`;
    if (unmappedFields.length > 0) {
      message += `\n\n${formatUnmappedFields(unmappedFields)}`;
    }
    if (displacedFields.length > 0) {
      const labels = displacedFields.map((field) => GASTTO_FIELD_LABELS[field]).join(', ');
      message += `\n\nLa columna indicada queda reservada para el nuevo campo. ${labels} queda sin asignar.`;
    }
    return message;
  },

  categoryReviewRequired: () =>
    'Antes de confirmar, revisá esta propuesta de categorías y subcategorías. Cuando la hayas revisado, enviá confirmar de nuevo.',

  categoryMappingRecovery: () =>
    composeMessage({
      explanation: 'No pude validar las columnas confirmadas para esta planilla.',
      action:
        'Escribí revisar para generar y revisar un nuevo mapeo antes de continuar con las categorías y medios de pago.',
      exit: CANCEL_EXIT_HINT,
    }),

  mappingProposalRecoveryPrompt: () =>
    composeMessage({
      explanation: 'No pude validar el mapeo que estabas revisando.',
      action: 'Voy a generar una propuesta nueva antes de guardarlo.',
      exit: CANCEL_EXIT_HINT,
    }),
  invalidColumnPrompt: (
    columnRef: string,
    availableColumns: { index: number; columnHeader: string }[],
  ) => {
    const lines = availableColumns.map(
      (c) => `${columnIndexToLetter(c.index)} - ${c.columnHeader}`,
    );
    return composeMessage({
      explanation: `No encontré la columna *${columnRef}* en tu planilla.\n\nLas columnas disponibles son:\n${lines.join('\n')}`,
      action: 'Escribí la letra, número o nombre correcto.',
      exit: CANCEL_EXIT_HINT,
    });
  },

  mappingRejectionPrompt: (availableColumns: { index: number; columnHeader: string }[]) => {
    const lines = availableColumns.map((c) => {
      const label =
        c.columnHeader.trim().length > 0 ? formatColumnHeader(c.columnHeader) : '(vacía)';
      return `${columnIndexToLetter(c.index)} - ${label}`;
    });
    const fieldLines = SUPPORTED_GASTTO_FIELDS.map((f) => `• ${GASTTO_FIELD_LABELS[f]}`);
    return composeMessage({
      explanation: `Entendido. Las columnas disponibles son:\n${lines.join('\n')}\n\nLos campos que podés indicar son:\n${fieldLines.join('\n')}`,
      action:
        'Indicame un solo campo por mensaje. Por ejemplo: "la categoría está en la columna E".',
      exit: CANCEL_EXIT_HINT,
    });
  },

  correctionParseFailurePrompt: () =>
    composeMessage({
      explanation: 'No entendí la corrección.',
      action:
        'Enviá una sola corrección por mensaje, por ejemplo: "la categoría está en la columna E" o "el monto va en B".',
      exit: CANCEL_EXIT_HINT,
    }),
  multipleMappingCorrectionsPrompt: () =>
    composeMessage({
      explanation: 'Detecté varios campos en el mismo mensaje.',
      action:
        'Para evitar cambios parciales, enviá una sola corrección por mensaje. Por ejemplo: "medio de pago en A".',
      exit: CANCEL_EXIT_HINT,
    }),
  onboardingComplete: () =>
    composeMessage({
      explanation: '¡Todo listo! Ya podés empezar a registrar gastos.',
      action:
        'Escribí algo como "Cafe 850" y lo guardo en tu planilla.\n\nCuando quieras cambiar categorías o subcategorías, escribí "configuración" y elegí la opción 5.',
    }),

  categoryUpdatedPrompt: (categories: string[]) => {
    const list = categories.map((c) => `• ${c}`).join('\n');
    return `Estas son las categorías actualizadas:\n${list}\n\n¿Están bien ahora? Respondé *sí* o decime si querés cambiar algo más.`;
  },

  categoryNotFoundForRename: (from: string, categories: string[]) => {
    const list = categories.map((c) => `• ${c}`).join('\n');
    return composeMessage({
      explanation: `No encontré la categoría "${from}".\n\nLas categorías actuales son:\n${list}`,
      action: 'Escribí el nombre exacto de la categoría que querés cambiar.',
      exit: CANCEL_EXIT_HINT,
    });
  },

  categoryNotFoundForRemoval: (name: string, categories: string[]) => {
    const list = categories.map((c) => `• ${c}`).join('\n');
    return composeMessage({
      explanation: `No encontré la categoría "${name}".\n\nLas categorías actuales son:\n${list}`,
      action: 'Escribí el nombre exacto de la categoría que querés quitar.',
      exit: CANCEL_EXIT_HINT,
    });
  },

  categoryUpdateError: (_errorMessage: string, categories: string[]) => {
    const list = categories.map((c) => `• ${c}`).join('\n');
    return composeMessage({
      explanation: `No pude actualizar la categoría.\n\nLas categorías actuales son:\n${list}`,
      action: '¿Están bien? Respondé *sí* o intentá de nuevo.',
      exit: CANCEL_EXIT_HINT,
    });
  },

  hierarchyUpdatedPrompt: (state: {
    categories: CategoryOnboardingCategory[];
    orphanSubcategories: string[];
  }) =>
    `Actualicé la jerarquía:\n${formatCategoryHierarchy(state.categories)}${onboardingCopies.orphanSubcategoriesWarning(state.orphanSubcategories)}\n\n¿Está bien ahora? Respondé *sí* o decime si querés cambiar algo más.`,

  hierarchyUpdateGuidance: (state: {
    categories: CategoryOnboardingCategory[];
    orphanSubcategories: string[];
  }) =>
    composeMessage({
      explanation: `No entendí el cambio.`,
      action: `Indicá siempre la categoría padre de una subcategoría. Por ejemplo: "agregar Peajes a Transporte".\n\nJerarquía actual:\n${formatCategoryHierarchy(state.categories)}${onboardingCopies.orphanSubcategoriesWarning(state.orphanSubcategories)}`,
      exit: CANCEL_EXIT_HINT,
    }),

  hierarchyParentNotFound: (
    parent: string,
    state: { categories: CategoryOnboardingCategory[]; orphanSubcategories: string[] },
  ) =>
    composeMessage({
      explanation: `No encontré la categoría padre "${parent}".`,
      action: `Podés elegir una de estas categorías:\n${formatCategoryNames(state.categories)}\n\nJerarquía actual:\n${formatCategoryHierarchy(state.categories)}${onboardingCopies.orphanSubcategoriesWarning(state.orphanSubcategories)}`,
      exit: CANCEL_EXIT_HINT,
    }),

  hierarchyParentAmbiguous: (
    parent: string,
    candidates: string[],
    state: { categories: CategoryOnboardingCategory[]; orphanSubcategories: string[] },
  ) =>
    composeMessage({
      explanation: `La categoría padre "${parent}" es ambigua. Coincide con:\n${candidates.map((candidate) => `• ${candidate}`).join('\n')}`,
      action: `Elegí un nombre de categoría padre inequívoco.\n\nJerarquía actual:\n${formatCategoryHierarchy(state.categories)}${onboardingCopies.orphanSubcategoriesWarning(state.orphanSubcategories)}`,
      exit: CANCEL_EXIT_HINT,
    }),

  hierarchyChildNotFound: (
    child: string,
    parent: string,
    state: { categories: CategoryOnboardingCategory[]; orphanSubcategories: string[] },
  ) =>
    composeMessage({
      explanation: `No encontré la subcategoría "${child}" dentro de "${parent}".`,
      action: `Revisá el nombre y la categoría padre.\n\nJerarquía actual:\n${formatCategoryHierarchy(state.categories)}${onboardingCopies.orphanSubcategoriesWarning(state.orphanSubcategories)}`,
      exit: CANCEL_EXIT_HINT,
    }),

  hierarchyDuplicateOrCollision: (
    _errorMessage: string,
    state: { categories: CategoryOnboardingCategory[]; orphanSubcategories: string[] },
  ) =>
    composeMessage({
      explanation: `No pude aplicar el cambio porque generaría un nombre duplicado o una colisión en esa categoría padre.`,
      action: `Probá con un nombre diferente.\n\nJerarquía actual:\n${formatCategoryHierarchy(state.categories)}${onboardingCopies.orphanSubcategoriesWarning(state.orphanSubcategories)}`,
      exit: CANCEL_EXIT_HINT,
    }),

  mappingResumePrompt: (
    mappings: { gasttoField: GasttoField; columnIndex: number; columnHeader: string }[],
  ) => {
    const lines = mappings.map(
      (m) =>
        `${GASTTO_FIELD_EMOJI[m.gasttoField]} ${GASTTO_FIELD_LABELS[m.gasttoField]} → columna ${columnIndexToLetter(m.columnIndex)} (${m.columnHeader})`,
    );
    return composeMessage({
      explanation: `Encontré una corrección en progreso:\n${lines.join('\n')}`,
      action:
        '¿Querés continuar desde donde la dejaste? Respondé *sí* para continuar o *no* para empezar de nuevo.',
      exit: CANCEL_EXIT_HINT,
    });
  },
};

const GASTTO_FIELD_LABELS: Record<GasttoField, string> = {
  fecha: 'Fecha',
  monto: 'Monto',
  categoria: 'Categoría',
  subcategoria: 'Subcategoría',
  concepto: 'Concepto',
  medio_pago: 'Medio de pago',
  moneda: 'Moneda',
};

const GASTTO_FIELD_EMOJI: Record<GasttoField, string> = {
  fecha: '📅',
  monto: '💰',
  categoria: '🏷️',
  subcategoria: '🔖',
  concepto: '📝',
  medio_pago: '💳',
  moneda: '💱',
};

function columnIndexToLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function formatColumnHeader(header: string): string {
  const MAX_HEADER_LENGTH = 40;
  const trimmed = header.trim();
  if (trimmed.length <= MAX_HEADER_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_HEADER_LENGTH)}…`;
}

function formatUnmappedFields(fields: GasttoField[]): string {
  const requiredFields = fields.filter((field) => field !== 'subcategoria');
  const messages: string[] = [];

  if (requiredFields.length > 0) {
    const labels = requiredFields.map((field) => GASTTO_FIELD_LABELS[field]).join(', ');
    messages.push(`No encontré columnas para: ${labels}. Estos campos se omitirán al registrar.`);
  }

  if (fields.includes('subcategoria')) {
    messages.push(
      'No encontré una columna de Subcategoría. Es opcional y podés continuar solo con Categoría.',
    );
  }

  return messages.join('\n\n');
}

function formatCategoryHierarchy(categories: CategoryOnboardingCategory[]): string {
  return categories
    .flatMap((category) => [
      `• ${category.name}`,
      ...category.subcategories.map((subcategory) => `  ◦ ${subcategory}`),
    ])
    .join('\n');
}

function formatCategoryNames(categories: CategoryOnboardingCategory[]): string {
  return categories.map((category) => `• ${category.name}`).join('\n');
}
