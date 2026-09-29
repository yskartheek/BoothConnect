import { Module } from '@nestjs/common';

import { MeController } from './me.controller';
import { MeService } from './me.service';
import { RoleAssignmentsController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [MeController, UsersController, RoleAssignmentsController],
  providers: [MeService, UsersService],
})
export class UsersModule {}
