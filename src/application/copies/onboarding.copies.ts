import type { CloudFile } from '../../domain/entities/CloudFile';

export const onboardingCopies = {
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
  connectionFailed: (canRetry: boolean) =>
    canRetry
      ? 'No se pudo conectar. Hacé clic en el enlace de arriba para intentar de nuevo.'
      : 'No se pudo conectar. Escribí *cancelar* para salir o contactá a soporte.',
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
};
