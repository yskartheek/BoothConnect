import { Controller, Get } from '@nestjs/common';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { type Me, MeService } from './me.service';
import { ApiTags } from '@nestjs/swagger';
import { ApiResult } from '../openapi/api-result';

@ApiTags('Me')
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /** The signed-in user's profile and their currently active role assignments. */
  @ApiResult('Me')
  @Get()
  get(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.me.get(user.userId);
  }
}
