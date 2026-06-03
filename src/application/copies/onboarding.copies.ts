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
  reminderMessage: (url: string) =>
    `Todavía no completaste la autorización. Hacé clic acá para continuar: ${url}\nTenés 10 minutos.`,
};
