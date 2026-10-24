import { createTransport, Transporter } from 'nodemailer';
import { MailMessage, MailPort } from './mail.port';

// MAIL_TRANSPORT=smtp: sends through the server in SMTP_URL, for example
// `smtps://treklink.team%40gmail.com:<app password>@smtp.gmail.com:465` (auth task 1.3, D-063 rules
// 3 and 10).
// The URL carries the credential, so it lives only in the environment, never in a repository.
export class SmtpMailTransport implements MailPort {
  private readonly transporter: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transporter = createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
