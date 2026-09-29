import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import { notFound } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  escapeLike,
  type Page,
  toPage,
} from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { GeographyNodeType, Role, UserStatus } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/** Roles an admin can give (the voter app's role isn't granted here). */
export const GRANTABLE_ROLES = ['admin', 'campaign_manager', 'volunteer'] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export interface AssignedNode {
  id: string;
  type: GeographyNodeType;
  code: string;
  name: string;
}

export interface RoleAssignmentView {
  id: string;
  userId: string;
  role: Role;
  node: AssignedNode;
  validFrom: Date;
  /** Null: open-ended. The assignment stops being active at this time. */
  validUntil: Date | null;
  /** Active now: started, and not ended. */
  active: boolean;
  grantedBy: { id: string; name: string } | null;
}

export interface UserSummary {
  id: string;
  name: string;
  phone: string;
  status: UserStatus;
  preferredLanguage: string;
  /** Only the assignments in the caller's area, newest first. */
  assignments: RoleAssignmentView[];
}

export interface UserCreated {
  user: UserSummary;
  assignment: RoleAssignmentView;
  /** False when the phone already belonged to a user of the organization, who got the new role. */
  created: boolean;
}

export interface UsersQuery {
  /** Users with an assignment at or below this node. */
  nodeId?: string;
  role?: Role;
  /** Part of the name, or the start of the phone number. */
  q?: string;
  /** true: only users with an active assignment in the area. */
  active?: boolean;
  limit?: number;
  cursor?: string;
}

export interface GrantInput {
  role: GrantableRole;
  geographyNodeId: string;
  validFrom?: Date;
  validUntil?: Date | null;
}

interface UserCursor extends Record<string, unknown> {
  name: string;
  id: string;
}
const isUserCursor = (v: Record<string, unknown>): v is UserCursor =>
  typeof v.name === 'string' && typeof v.id === 'string';

const unprocessable = (message: string) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, message);

const assignmentInclude = {
  geographyNode: { select: { id: true, type: true, code: true, name: true } },
  grantedBy: { select: { id: true, name: true } },
} as const;

/**
 * Users and their roles (#173). An admin manages the people of their own
 * area: they add users, give roles on nodes at or below their own admin
 * assignments, and end them. They see only users with an assignment in their
 * area, and only those assignments. Ended assignments stay as history; scopes
 * follow at the next request (and a volunteer's next sync starts over).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(scope: Scope, query: UsersQuery): Promise<Page<UserSummary>> {
    const area = await this.area(scope);
    let nodes = area;
    if (query.nodeId) {
      if (!(await this.within(area, query.nodeId))) throw notFound('Geography node');
      nodes = [query.nodeId];
    }
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const after = query.cursor ? decodeCursor(query.cursor, isUserCursor) : null;
    const now = new Date();
    const conditions: Prisma.Sql[] = [
      Prisma.sql`EXISTS (
        SELECT 1 FROM role_assignment ra
        JOIN geography_closure c ON c.descendant_id = ra.geography_node_id
        WHERE ra.user_id = u.id AND c.ancestor_id = ANY(${nodes}::uuid[])
          ${query.role ? Prisma.sql`AND ra.role = ${query.role}::role` : Prisma.empty}
          ${
            query.active
              ? Prisma.sql`AND ra.valid_from <= ${now} AND (ra.valid_until IS NULL OR ra.valid_until > ${now})`
              : Prisma.empty
          })`,
    ];
    if (query.q) {
      const q = escapeLike(query.q.trim());
      conditions.push(Prisma.sql`(u.name ILIKE ${`%${q}%`} OR u.phone LIKE ${`${q}%`})`);
    }
    if (after) conditions.push(Prisma.sql`(u.name, u.id) > (${after.name}, ${after.id}::uuid)`);
    const rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT u.id, u.name FROM app_user u
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY u.name, u.id
      LIMIT ${limit + 1}`;
    const page = toPage(rows, limit, (r) => encodeCursor({ name: r.name, id: r.id }));
    const users = await this.summaries(
      page.items.map((r) => r.id),
      area,
    );
    return { items: page.items.map((r) => users.get(r.id)!), nextCursor: page.nextCursor };
  }

  async get(scope: Scope, id: string): Promise<UserSummary> {
    const area = await this.area(scope);
    const user = (await this.summaries([id], area)).get(id);
    if (!user || user.assignments.length === 0) throw notFound('User');
    return user;
  }

  /**
   * Adds a user of the caller's organization with a first role (so they are
   * in the caller's area from the start). A phone already used in the
   * organization gets the role on the existing user instead; one used in
   * another organization can't be used.
   */
  async create(
    scope: Scope,
    actor: Actor,
    input: { name: string; phone: string; preferredLanguage?: string } & GrantInput,
  ): Promise<UserCreated> {
    const area = await this.area(scope);
    const caller = await this.prisma.appUser.findUniqueOrThrow({ where: { id: scope.userId } });
    return this.prisma.$transaction(async (tx) => {
      await this.checkGrant(tx, area, input);
      const existing = await tx.appUser.findUnique({ where: { phone: input.phone } });
      if (existing && existing.organizationId !== caller.organizationId) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'This phone number can’t be used',
        );
      }
      const user =
        existing ??
        (await tx.appUser.create({
          data: {
            organizationId: caller.organizationId,
            name: input.name,
            phone: input.phone,
            preferredLanguage: input.preferredLanguage ?? 'en',
          },
        }));
      if (!existing) {
        await this.audit.record(
          {
            ...auditActor(actor),
            action: 'user.create',
            resourceType: 'app_user',
            resourceId: user.id,
            result: 'success',
            metadata: {},
          },
          tx,
        );
      }
      const assignment = await this.insertGrant(tx, actor, user.id, input);
      const summary = (await this.summaries([user.id], area, tx)).get(user.id)!;
      return { user: summary, assignment, created: !existing };
    });
  }

  /** Gives a user in the caller's area a role on a node in the caller's area. */
  async grant(
    scope: Scope,
    actor: Actor,
    input: { userId: string } & GrantInput,
  ): Promise<RoleAssignmentView> {
    const area = await this.area(scope);
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.visible(tx, area, input.userId))) throw notFound('User');
      await this.checkGrant(tx, area, input);
      return this.insertGrant(tx, actor, input.userId, input);
    });
  }

  /** Ends an assignment now; it stays as history. */
  async end(scope: Scope, actor: Actor, id: string): Promise<RoleAssignmentView> {
    const area = await this.area(scope);
    return this.prisma.$transaction(async (tx) => {
      // Two admins ending the same assignment: one at a time.
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM role_assignment WHERE id = ${id}::uuid FOR UPDATE`;
      const assignment = row
        ? await tx.roleAssignment.findUnique({ where: { id }, include: assignmentInclude })
        : null;
      if (!assignment || !(await this.within(area, assignment.geographyNodeId, tx))) {
        throw notFound('Role assignment');
      }
      if (assignment.userId === scope.userId && assignment.role === 'admin') {
        throw unprocessable('You can’t end your own admin role; ask another admin');
      }
      const now = new Date();
      if (assignment.validUntil && assignment.validUntil <= now) {
        throw unprocessable('This assignment has already ended');
      }
      const ended = await tx.roleAssignment.update({
        where: { id },
        // A window must end after it starts, so one that hasn't started yet
        // shrinks to this instant: it never applies after now.
        data:
          assignment.validFrom > now
            ? { validFrom: now, validUntil: new Date(now.getTime() + 1) }
            : { validUntil: now },
        include: assignmentInclude,
      });
      await this.audit.record(
        {
          ...auditActor(actor),
          action: 'role.end',
          resourceType: 'role_assignment',
          resourceId: id,
          result: 'success',
          metadata: {
            userId: assignment.userId,
            role: assignment.role,
            nodeId: assignment.geographyNodeId,
          },
        },
        tx,
      );
      return view(ended, new Date());
    });
  }

  /**
   * Makes someone an admin of a node from the server (`pnpm --filter api
   * admin:grant`): how the first admin of a deployment is set up, or a new
   * State admin, since admins can only grant at or below their own node.
   * `nodePath` is the node's path of codes, e.g. `S29` or `S29/6/40`. Creates
   * the user in the program's organization if the phone is new.
   */
  async bootstrapAdmin(input: {
    phone: string;
    name: string;
    nodePath: string;
  }): Promise<{ userId: string; assignmentId: string | null; created: boolean }> {
    const codes = input.nodePath.split('/').map((c) => c.trim());
    const rows = await this.prisma.$queryRaw<{ id: string; organizationId: string }[]>`
      SELECT n.id, p.organization_id AS "organizationId"
      FROM geography_node n JOIN election_program p ON p.id = n.program_id
      WHERE (SELECT array_agg(a.code ORDER BY c.depth DESC)
             FROM geography_closure c JOIN geography_node a ON a.id = c.ancestor_id
             WHERE c.descendant_id = n.id) = ${codes}::text[]`;
    if (rows.length !== 1) {
      throw new Error(
        rows.length === 0
          ? `No node at ${input.nodePath}`
          : `${input.nodePath} is in ${rows.length} programs; ask a developer to grant it`,
      );
    }
    const node = rows[0]!;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.appUser.findUnique({ where: { phone: input.phone } });
      if (existing && existing.organizationId !== node.organizationId) {
        throw new Error('That phone belongs to a user of another organization');
      }
      const user =
        existing ??
        (await tx.appUser.create({
          data: { organizationId: node.organizationId, name: input.name, phone: input.phone },
        }));
      const system = { actorId: null, sessionId: null, requestId: null };
      if (!existing) {
        await this.audit.record(
          {
            ...system,
            action: 'user.create',
            resourceType: 'app_user',
            resourceId: user.id,
            result: 'success',
            metadata: { via: 'admin:grant' },
          },
          tx,
        );
      }
      const now = new Date();
      const active = await tx.roleAssignment.findFirst({
        where: {
          userId: user.id,
          role: 'admin',
          geographyNodeId: node.id,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
      });
      if (active) return { userId: user.id, assignmentId: null, created: !existing };
      const assignment = await tx.roleAssignment.create({
        data: { userId: user.id, role: 'admin', geographyNodeId: node.id, validFrom: now },
      });
      await this.audit.record(
        {
          ...system,
          action: 'role.grant',
          resourceType: 'role_assignment',
          resourceId: assignment.id,
          result: 'success',
          metadata: { userId: user.id, role: 'admin', nodeId: node.id, via: 'admin:grant' },
        },
        tx,
      );
      return { userId: user.id, assignmentId: assignment.id, created: !existing };
    });
  }

  private async insertGrant(
    tx: Tx,
    actor: Actor,
    userId: string,
    input: GrantInput,
  ): Promise<RoleAssignmentView> {
    const validFrom = input.validFrom ?? new Date();
    if (input.validUntil && input.validUntil <= validFrom) {
      throw unprocessable('validUntil must be after validFrom');
    }
    const now = new Date();
    const overlapping = await tx.roleAssignment.findFirst({
      where: {
        userId,
        role: input.role,
        geographyNodeId: input.geographyNodeId,
        OR: [{ validUntil: null }, { validUntil: { gt: validFrom } }],
        ...(input.validUntil ? { validFrom: { lt: input.validUntil } } : {}),
      },
    });
    if (overlapping) throw unprocessable('The user already has this role on this node then');
    const created = await tx.roleAssignment.create({
      data: {
        userId,
        role: input.role,
        geographyNodeId: input.geographyNodeId,
        validFrom,
        validUntil: input.validUntil ?? null,
        grantedById: actor.userId,
      },
      include: assignmentInclude,
    });
    await this.audit.record(
      {
        ...auditActor(actor),
        action: 'role.grant',
        resourceType: 'role_assignment',
        resourceId: created.id,
        result: 'success',
        metadata: { userId, role: input.role, nodeId: input.geographyNodeId },
      },
      tx,
    );
    return view(created, now);
  }

  /** The node is in the caller's area, and the role fits it. */
  private async checkGrant(tx: Tx, area: string[], input: GrantInput): Promise<void> {
    const node = await tx.geographyNode.findUnique({ where: { id: input.geographyNodeId } });
    if (!node || !(await this.within(area, node.id, tx))) throw notFound('Geography node');
    if (input.role === 'volunteer' && node.type !== 'polling_station') {
      throw unprocessable('A volunteer is assigned to a polling station');
    }
  }

  /** The caller's admin nodes: their area is these and everything below. */
  private async area(scope: Scope): Promise<string[]> {
    const now = new Date();
    const rows = await this.prisma.roleAssignment.findMany({
      where: {
        userId: scope.userId,
        role: 'admin',
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      select: { geographyNodeId: true },
    });
    return [...new Set(rows.map((r) => r.geographyNodeId))];
  }

  private async within(area: string[], nodeId: string, db: Tx | PrismaService = this.prisma) {
    if (area.length === 0) return false;
    const found = await db.geographyClosure.findFirst({
      where: { descendantId: nodeId, ancestorId: { in: area } },
      select: { ancestorId: true },
    });
    return found !== null;
  }

  /** The user has (or had) an assignment in the caller's area. */
  private async visible(tx: Tx, area: string[], userId: string): Promise<boolean> {
    if (area.length === 0) return false;
    const found = await tx.roleAssignment.findFirst({
      where: {
        userId,
        geographyNode: { ancestors: { some: { ancestorId: { in: area } } } },
      },
      select: { id: true },
    });
    return found !== null;
  }

  /** Users with only their assignments in the area. */
  private async summaries(
    ids: string[],
    area: string[],
    db: Tx | PrismaService = this.prisma,
  ): Promise<Map<string, UserSummary>> {
    if (ids.length === 0 || area.length === 0) return new Map();
    const users = await db.appUser.findMany({
      where: { id: { in: ids } },
      include: {
        roleAssignments: {
          where: { geographyNode: { ancestors: { some: { ancestorId: { in: area } } } } },
          include: assignmentInclude,
          orderBy: [{ validFrom: 'desc' }, { id: 'desc' }],
        },
      },
    });
    const now = new Date();
    return new Map(
      users.map((u) => [
        u.id,
        {
          id: u.id,
          name: u.name,
          phone: u.phone,
          status: u.status,
          preferredLanguage: u.preferredLanguage,
          assignments: u.roleAssignments.map((a) => view(a, now)),
        },
      ]),
    );
  }
}

function view(
  a: {
    id: string;
    userId: string;
    role: Role;
    validFrom: Date;
    validUntil: Date | null;
    geographyNode: AssignedNode;
    grantedBy: { id: string; name: string } | null;
  },
  now: Date,
): RoleAssignmentView {
  return {
    id: a.id,
    userId: a.userId,
    role: a.role,
    node: a.geographyNode,
    validFrom: a.validFrom,
    validUntil: a.validUntil,
    active: a.validFrom <= now && (a.validUntil === null || a.validUntil > now),
    grantedBy: a.grantedBy,
  };
}

function auditActor(actor: Actor) {
  return {
    actorId: actor.userId,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}
