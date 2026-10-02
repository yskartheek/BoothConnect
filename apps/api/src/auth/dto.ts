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

export class RefreshDto {
  @IsString()
  @Length(1, 256)
  refreshToken!: string;
}

/** A voter's voter ID card number (EPIC), as printed: letters and digits. */
const EPIC = /^\s*[A-Za-z0-9][A-Za-z0-9 ]{4,23}\s*$/;
const EPIC_MESSAGE = 'epic must be the voter ID number, e.g. ABC1234567';

/** A voter's sign-in (#223): their EPIC and the mobile number on their record. */
export class RequestVoterOtpDto {
  @Matches(EPIC, { message: EPIC_MESSAGE })
  epic!: string;

  @Matches(E164, { message: E164_MESSAGE })
  phone!: string;
}

export class VerifyVoterOtpDto extends RequestVoterOtpDto {
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  /** A stable identifier of the app installation. */
  @IsString()
  @Length(1, 128)
  deviceId!: string;
}
