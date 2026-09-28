import { IsString, Length, Matches } from 'class-validator';

// E.164: "+", country code, subscriber number; 8 to 15 digits in total.
const E164 = /^\+[1-9]\d{7,14}$/;
const E164_MESSAGE = 'phone must be in international format, e.g. +919876543210';

export class RequestOtpDto {
  @Matches(E164, { message: E164_MESSAGE })
  phone!: string;
}

export class VerifyOtpDto {
  @Matches(E164, { message: E164_MESSAGE })
  phone!: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  /** A stable identifier of the app installation; one session per device. */
  @IsString()
  @Length(1, 128)
  deviceId!: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}
