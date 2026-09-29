import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { CurrentScope, Roles } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { actorOf } from '../common/actor';
import type { Page } from '../common/pagination';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { ApiResult } from '../openapi/api-result';
import { CreateRoleAssignmentDto, CreateUserDto, UsersQueryDto } from './dto';
import {
  type RoleAssignmentView,
  type UserCreated,
  type UserSummary,
  UsersService,
} from './users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Users with an assignment in your area, by name; only those assignments are shown. */
  @ApiResult('UserPage')
  @Get()
  @Roles('admin')
  list(@CurrentScope() scope: Scope, @Query() query: UsersQueryDto): Promise<Page<UserSummary>> {
    return this.users.list(scope, query);
  }

  /** One user in your area, with their assignments there (active and ended). */
  @ApiResult('UserSummary')
  @Get(':id')
  @Roles('admin')
  get(@CurrentScope() scope: Scope, @Param('id', ParseUUIDPipe) id: string): Promise<UserSummary> {
    return this.users.get(scope, id);
  }

  /**
   * Adds a user with their first role. A phone already used in your
   * organization gets the role on that user (`created: false`).
   */
  @ApiResult('UserCreated', 201)
  @Post()
  @Roles('admin')
  @Idempotent()
  create(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: CreateUserDto,
  ): Promise<UserCreated> {
    return this.users.create(scope, actorOf(user, req), dto);
  }
}

@ApiTags('Users')
@Controller('role-assignments')
export class RoleAssignmentsController {
  constructor(private readonly users: UsersService) {}

  /** Gives a user in your area a role on a node in your area. */
  @ApiResult('RoleAssignmentView', 201)
  @Post()
  @Roles('admin')
  @Idempotent()
  grant(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: CreateRoleAssignmentDto,
  ): Promise<RoleAssignmentView> {
    return this.users.grant(scope, actorOf(user, req), dto);
  }

  /** Ends the assignment now. It stays in the user's history. */
  @ApiResult('RoleAssignmentView')
  @Delete(':id')
  @Roles('admin')
  @Idempotent()
  end(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoleAssignmentView> {
    return this.users.end(scope, actorOf(user, req), id);
  }
}
