export const accessCopies = {
  welcome: () => '¡Bienvenido a Gastto! Para empezar, necesitamos autorizar tu cuenta de Google.',
  askEmail: () => 'Escribí el email de la cuenta de Google que vas a usar.',
  invalidEmail: () => 'Ese email no parece válido. Revisalo y volvé a escribirlo.',
  pending: () => 'Recibimos tu solicitud. Te avisaremos por Telegram cuando esté autorizada.',
  pendingAgain: () =>
    'Tu solicitud sigue pendiente. Te avisaremos por Telegram cuando esté autorizada.',
  approved: () => 'Tu cuenta ya está autorizada. Escribí continuar para conectar Google.',
  approvedNotice: () => 'Tu acceso fue aprobado. Escribí continuar para conectar Google.',
  replacementApprovedNotice: () =>
    'El nuevo email fue aprobado. Abrí configuración, elegí 7 y escribí continuar para conectar la nueva cuenta.',
  replacementPrompt: () =>
    'Escribí el nuevo email de Google. Tu cuenta y planilla actuales seguirán funcionando hasta que completes la nueva conexión.',
  replacementReady: () =>
    'El nuevo email está aprobado. Escribí continuar para conectar Google o cancelar para salir.',
  replacementPending: () =>
    'El cambio de email está pendiente. Si querés corregirlo, escribí el nuevo email en configuración.',
  continue: () => 'Escribí continuar para conectar Google.',
  oauthUnavailable: () =>
    'La conexión con Google no está disponible en este momento. Intentá más tarde.',
};
