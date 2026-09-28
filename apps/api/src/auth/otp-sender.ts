import { Logger } from '@nestjs/common';

/** Delivers a one-time sign-in code to a phone (SMS in production). */
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

/** Injection token: `@Inject(OTP_SENDER) sender: OtpSender`. */
export const OTP_SENDER = Symbol('OTP_SENDER');

/**
 * OTP_DEV_MODE=true: writes the code to the API log so you can sign in
 * locally. The environment check refuses this mode in production.
 */
export class LogOtpSender implements OtpSender {
  private readonly logger = new Logger('OtpSender');

  send(phone: string, code: string): Promise<void> {
    this.logger.warn(`Development sign-in code for ${phone}: ${code}`);
    return Promise.resolve();
  }
}

/**
 * Used until an SMS provider is integrated. The request still gets 202 (the
 * response must not depend on whether the phone is known), so the failure is
 * only logged, without the code.
 */
export class UnconfiguredOtpSender implements OtpSender {
  private readonly logger = new Logger('OtpSender');

  send(): Promise<void> {
    this.logger.error('No SMS provider is configured; a sign-in code was not delivered');
    return Promise.resolve();
  }
}
