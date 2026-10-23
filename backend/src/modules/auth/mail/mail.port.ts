// Outbound email (auth task 1.3). `auth` sends codes through it; other modules (the incidents email
// channel) reuse it. The transport is chosen by MAIL_TRANSPORT.
export const MAIL_PORT = Symbol('MAIL_PORT');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailPort {
  send(message: MailMessage): Promise<void>;
}
