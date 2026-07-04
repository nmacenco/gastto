// CAPA: Domain
// Entidad raíz de usuario. Sin dependencias externas — solo TypeScript puro.
// Derivada de la tabla `users` del esquema SQL.

export type UserStatus = 'onboarding' | 'active' | 'suspended';
export type Currency = 'ARS' | 'EUR' | 'USD' | 'MXN' | 'GBP' | 'BRL';

export interface User {
  userId: string; // UUID generado por el sistema (ADR-008)
  status: UserStatus;
  defaultCurrency: Currency | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessagingIdentity {
  id: string;
  userId: string; // FK → User.userId
  channel: 'telegram' | 'whatsapp';
  externalId: string; // chat_id de Telegram o número E.164 de WhatsApp
  linkedAt: Date;
}
