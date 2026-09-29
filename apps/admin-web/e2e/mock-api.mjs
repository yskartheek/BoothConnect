// A stand-in for the BoothConnect API in the browser tests (CI runs them
// without the API or a database). It knows two synthetic people: an admin
// and a volunteer; the code is always 123456.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_API_PORT ?? 4100);
const CODE = '123456';
const PEOPLE = {
  '+919999900001': { id: 'u-admin', name: 'Test Admin', role: 'admin' },
  '+919999900002': { id: 'u-volunteer', name: 'Test Volunteer', role: 'volunteer' },
};
const tokens = new Map(); // access token -> person
let issued = 0;

// A small synthetic geography, like the development seed.
let nextId = 0;
let nodes = [];
/** The admin's AC: users and imports are scoped to it. */
let adminNode = null;
const add = (parent, type, code, name, extra = {}) => {
  const node = {
    id: `n-${(nextId += 1)}`,
    parentId: parent?.id ?? null,
    type,
    code,
    name,
    isAuxiliary: false,
    reservation: null,
    ...extra,
  };
  nodes.push(node);
  return node;
};
function seedGeography() {
  nodes = [];
  nextId = 0;
  const s99 = add(null, 'state', 'S99', 'Demo State');
  const pc1 = add(s99, 'pc', '1', 'Demo Parliamentary Constituency', { reservation: 'GEN' });
  const ac101 = add(pc1, 'ac', '101', 'Demo Assembly Constituency', { reservation: 'GENERAL' });
  const part1 = add(ac101, 'part', '1', 'Demo Nagar');
  const booth1 = add(part1, 'polling_station', '1', 'Demo Primary School, Room 1');
  add(part1, 'polling_station', '1A', 'Demo Primary School, Room 2', { isAuxiliary: true });
  // The same ids every time, so users and imports keep pointing at them.
  adminNode = ac101;
  return { ac101, part1, booth1 };
}

// Users and role assignments (#176). The admin manages AC 101 and below.
let users = [];
let assignments = [];
function seedUsers({ ac101: ac, part1: part, booth1: booth }) {
  users = [
    { id: 'u-admin', name: 'Test Admin', phone: '+919999900001' },
    { id: 'u-volunteer', name: 'Test Volunteer', phone: '+919999900002' },
    { id: 'u-manager', name: 'Demo Manager', phone: '+919999900003' },
    { id: 'u-former', name: 'Former Volunteer', phone: '+919999900004' },
  ].map((u) => ({ ...u, status: 'active', preferredLanguage: 'en' }));
  const admin = { id: 'u-admin', name: 'Test Admin' };
  assignments = [
    { id: 'ra-1', userId: 'u-admin', role: 'admin', nodeId: ac.id, grantedBy: null },
    { id: 'ra-2', userId: 'u-volunteer', role: 'volunteer', nodeId: booth.id, grantedBy: admin },
    {
      id: 'ra-3',
      userId: 'u-manager',
      role: 'campaign_manager',
      nodeId: part.id,
      grantedBy: admin,
    },
    {
      id: 'ra-4',
      userId: 'u-former',
      role: 'volunteer',
      nodeId: booth.id,
      grantedBy: admin,
      validUntil: '2026-02-01T00:00:00.000Z',
    },
  ].map((a) => ({ validFrom: '2026-01-01T00:00:00.000Z', validUntil: null, ...a }));
}
let nextUser = 0;
/** From the State down to the node. */
const pathOf = (nodeId) => {
  const path = [];
  for (let n = nodes.find((x) => x.id === nodeId); n; n = nodes.find((x) => x.id === n.parentId)) {
    path.unshift({ id: n.id, type: n.type, code: n.code, name: n.name });
  }
  return path;
};
/** At or below `ancestorId`. */
const below = (nodeId, ancestorId) => {
  for (let n = nodes.find((x) => x.id === nodeId); n; n = nodes.find((x) => x.id === n.parentId)) {
    if (n.id === ancestorId) return true;
  }
  return false;
};
const isActive = (a, now = new Date()) =>
  new Date(a.validFrom) <= now && (!a.validUntil || new Date(a.validUntil) > now);
const assignmentView = (a) => {
  const node = nodes.find((n) => n.id === a.nodeId);
  return {
    id: a.id,
    userId: a.userId,
    role: a.role,
    node: { id: node.id, type: node.type, code: node.code, name: node.name },
    validFrom: a.validFrom,
    validUntil: a.validUntil,
    active: isActive(a),
    grantedBy: a.grantedBy,
  };
};
const userView = (u) => ({
  ...u,
  assignments: assignments
    .filter((a) => a.userId === u.id && below(a.nodeId, adminNode.id))
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.id.localeCompare(a.id))
    .map(assignmentView),
});
/** The role's rules, as the API checks them; an error to send, or null. */
function grantProblem(body) {
  const node = nodes.find((n) => n.id === body.geographyNodeId);
  if (!node || !below(node.id, adminNode.id)) return [404, 'NOT_FOUND', 'Geography node not found'];
  if (body.role === 'volunteer' && node.type !== 'polling_station') {
    return [422, 'UNPROCESSABLE', 'A volunteer is assigned to a polling station'];
  }
  if (
    assignments.some(
      (a) =>
        a.userId === body.userId && a.role === body.role && a.nodeId === node.id && isActive(a),
    )
  ) {
    return [422, 'UNPROCESSABLE', 'The user already has this role on this node then'];
  }
  return null;
}
const grant = (userId, body) => {
  const a = {
    id: `ra-new-${(nextUser += 1)}`,
    userId,
    role: body.role,
    nodeId: body.geographyNodeId,
    validFrom: body.validFrom ?? new Date().toISOString(),
    validUntil: body.validUntil ?? null,
    grantedBy: { id: 'u-admin', name: 'Test Admin' },
  };
  assignments.push(a);
  return a;
};

seedUsers(seedGeography());
const keyOf = (node) =>
  node.parentId ? `${keyOf(nodes.find((n) => n.id === node.parentId))}/${node.code}` : node.code;

/** The master-data CSV (simple: no quoted commas), planned like the API does. */
function plan(csv) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const columns = header.split(',').map((c) => c.trim());
  const at = (cells, name) => (cells[columns.indexOf(name)] ?? '').trim() || null;
  const planned = new Map();
  const rows = lines.map((line, i) => {
    const cells = line.split(',');
    const level = at(cells, 'level');
    const code = at(cells, 'code');
    const name = at(cells, 'name');
    const reservation = at(cells, 'reservation');
    const parentCode = at(cells, 'parent_code');
    const stateCode = at(cells, 'state_code');
    const row = { line: i + 2, level, code, name, parentCode, action: 'create', errors: [] };
    let parentKey = null;
    if (level === 'pc' || level === 'ac') {
      const known = [...nodes.map(keyOf), ...planned.keys()];
      const depth = level === 'pc' ? 1 : 2;
      parentKey =
        known.find(
          (k) =>
            k.split('/').length === depth &&
            k.endsWith(parentCode) &&
            (!stateCode || k.startsWith(stateCode)),
        ) ?? null;
      if (!parentKey) row.errors.push(`Unknown ${level === 'pc' ? 'State' : 'PC'} ${parentCode}`);
    } else if (level !== 'state') {
      row.errors.push('level must be state, pc or ac');
    }
    if (row.errors.length > 0) return { ...row, action: 'error' };
    const key = parentKey ? `${parentKey}/${code}` : code;
    const existing = nodes.find((n) => keyOf(n) === key);
    if (existing) {
      row.action =
        existing.name === name && existing.reservation === reservation ? 'unchanged' : 'update';
    } else {
      planned.set(key, row);
    }
    return { ...row, key, parentKey, reservation, existing };
  });
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const row of rows) counts[row.action] += 1;
  return { rows, counts };
}
const report = ({ rows, counts }, applied) => ({
  programId: 'program-1',
  applied,
  counts,
  rows: rows.map(({ line, level, code, name, parentCode, action, errors }) => ({
    line,
    level,
    code,
    name,
    parentCode,
    action,
    errors,
  })),
});

const send = (res, status, body) => {
  res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};
const error = (res, status, code, message = code) =>
  send(res, status, { requestId: `mock-${Date.now()}`, code, message });

// Roll imports (#71): batches, uploads, and a stand-in for object storage
// (presigned part URLs point at /__s3 here, from the browser).
let batches = new Map();
let uploads = new Map();
let checksums = new Map(); // sha256 -> first file id
let nextImport = 0;
const PART_SIZE = 16 * 1024 * 1024;
const STORAGE_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'PUT',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'ETag',
};
function resetImports() {
  batches = new Map();
  uploads = new Map();
  checksums = new Map();
}
const nodeView = (n) => ({ id: n.id, type: n.type, code: n.code, name: n.name });
/** How long the stand-in takes to extract or commit a file. */
const WORK_MS = 1500;
/**
 * Extraction, simulated from the file name (synthetic files only): "other-ac"
 * is rejected, "review" needs review (totals off), anything else is ready.
 * Confirming takes a moment too.
 */
function advance(file) {
  const now = Date.now();
  if (file.status === 'extracting' && now - file.since >= WORK_MS) {
    const partCode = /part-(\d+)/.exec(file.originalName)?.[1] ?? '1';
    const part = nodes.find((n) => n.type === 'part' && n.code === partCode);
    Object.assign(file, { since: now, extractedAt: new Date().toISOString() });
    if (file.originalName.includes('other-ac')) {
      Object.assign(file, {
        status: 'rejected',
        error: { code: 'header.outside_target', message: 'Part belongs to AC 41, not AC 101' },
        pageCount: 30,
      });
    } else {
      Object.assign(file, {
        status: file.originalName.includes('review') ? 'needs_review' : 'ready',
        part: part ? { id: part.id, code: part.code, name: part.name } : null,
        proposedPart: part ? null : { code: partCode, name: `Synthetic Part ${partCode}` },
        pageCount: 30,
        rowCount: 812,
        rows: { accepted: 800, warning: 12, rejected: 0 },
        voterCount: 810,
        qualityScore: 0.93,
        totalsMatch: !file.originalName.includes('review'),
      });
    }
  }
  if (file.status === 'confirming' && now - file.since >= WORK_MS) {
    Object.assign(file, { status: 'confirmed', confirmedAt: new Date().toISOString() });
  }
}
const fileDetail = (f) => ({
  id: f.id,
  originalName: f.originalName,
  sizeBytes: f.sizeBytes,
  status: f.status,
  duplicateOfId: f.duplicateOfId,
  error: f.error ?? null,
  part: f.part ?? null,
  proposedPart: f.proposedPart ?? null,
  pageCount: f.pageCount ?? null,
  rowCount: f.rowCount ?? 0,
  rows: f.rows ?? { accepted: 0, warning: 0, rejected: 0 },
  voterCount: f.voterCount ?? 0,
  qualityScore: f.qualityScore ?? null,
  totalsMatch: f.totalsMatch ?? null,
  extractedAt: f.extractedAt ?? null,
  confirmedAt: f.confirmedAt ?? null,
});
const batchDetail = (batch) => {
  batch.files.forEach(advance);
  const statusCounts = {};
  for (const f of batch.files) statusCounts[f.status] = (statusCounts[f.status] ?? 0) + 1;
  return {
    id: batch.id,
    targetNode: nodeView(batch.target),
    status: 'uploading',
    fileCount: batch.files.length,
    statusCounts,
    files: batch.files.map(fileDetail),
    createdAt: batch.createdAt,
  };
};
// The audit log (#76): a few synthetic events, newest first; ids and counts only.
const AUDIT = [
  ['auth.login', 'session', null, 'success', 'u-admin', {}],
  ['import.file.confirm', 'import_file', 'file-demo-1', 'success', 'u-admin', { voters: 40 }],
  [
    'import.file.committed',
    'import_file',
    'file-demo-1',
    'success',
    null,
    { voters: 40, householdsCreated: 33 },
  ],
  ['role.grant', 'role_assignment', 'ra-demo', 'success', 'u-admin', { role: 'volunteer' }],
  ['auth.login', 'session', null, 'failure', null, { reason: 'otp_invalid' }],
].map(([action, resourceType, resourceId, result, actor, metadata], i, all) => ({
  id: `audit-${i + 1}`,
  seq: String(all.length - i),
  at: new Date(Date.UTC(2026, 8, 29, 10, 0) - i * 60_000).toISOString(),
  action,
  resourceType,
  resourceId,
  result,
  actor: actor ? { id: actor, name: 'Test Admin' } : null,
  sessionId: actor ? 'session-demo' : null,
  requestId: `request-${i + 1}`,
  metadata,
  prevHash: `hash-${all.length - i - 1}`,
  hash: `hash-${all.length - i}`,
}));
function auditEvents(res, url) {
  const action = url.searchParams.get('action');
  if (action && !/^[a-z0-9_.]+\*?$/.test(action)) {
    return send(res, 400, {
      requestId: 'mock',
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: [{ field: 'action', errors: ['action must look like "auth.login" or "import.*"'] }],
    });
  }
  const matches = (e) =>
    (!action ||
      (action.endsWith('*') ? e.action.startsWith(action.slice(0, -1)) : e.action === action)) &&
    (!url.searchParams.get('result') || e.result === url.searchParams.get('result')) &&
    (!url.searchParams.get('actorId') || e.actor?.id === url.searchParams.get('actorId'));
  const items = AUDIT.filter(matches);
  const verify = url.searchParams.get('verify') === 'true';
  return send(res, 200, {
    items: items.slice(0, Number(url.searchParams.get('limit') ?? 50)),
    nextCursor: null,
    ...(verify
      ? { verification: { checked: AUDIT.length, intact: true, firstBrokenSeq: null } }
      : {}),
  });
}

/** Answers an import request; false when it isn't one. */
function importRoute(req, res, url, body) {
  if (req.method === 'POST' && url.pathname === '/v1/imports/batches') {
    const target = nodes.find((n) => n.id === body.targetNodeId);
    if (!target || !below(target.id, adminNode.id)) return error(res, 404, 'NOT_FOUND');
    if (target.type === 'polling_station') {
      return error(res, 422, 'UNPROCESSABLE', 'Upload rolls at State, PC, AC or Part level');
    }
    const batch = {
      id: `batch-${(nextImport += 1)}`,
      target,
      files: [],
      uploads: 0,
      createdAt: new Date().toISOString(),
    };
    batches.set(batch.id, batch);
    const { files, ...view } = batchDetail(batch);
    return send(res, 201, { ...view, fileCount: files.length });
  }
  const one = /^\/v1\/imports\/batches\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && one) {
    const batch = batches.get(one[1]);
    return batch ? send(res, 200, batchDetail(batch)) : error(res, 404, 'NOT_FOUND');
  }
  const start = /^\/v1\/imports\/batches\/([^/]+)\/files$/.exec(url.pathname);
  if (req.method === 'POST' && start) {
    const batch = batches.get(start[1]);
    if (!batch) return error(res, 404, 'NOT_FOUND');
    if (batch.target.type === 'part' && (batch.uploads > 0 || body.files.length !== 1)) {
      return error(res, 422, 'UNPROCESSABLE', 'A part-level batch takes exactly one PDF');
    }
    const tickets = body.files.map((file) => {
      const id = `up-${(nextImport += 1)}`;
      const partCount = Math.max(1, Math.ceil(file.sizeBytes / PART_SIZE));
      uploads.set(id, { id, batch, name: file.name, size: file.sizeBytes, parts: new Map() });
      batch.uploads += 1;
      return {
        id,
        kind: file.name.toLowerCase().endsWith('.zip') ? 'zip' : 'pdf',
        originalName: file.name,
        sizeBytes: file.sizeBytes,
        partSizeBytes: PART_SIZE,
        parts: Array.from({ length: partCount }, (_, i) => ({
          partNumber: i + 1,
          url: `http://localhost:${PORT}/__s3/${id}/${i + 1}`,
        })),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
    });
    return send(res, 201, { uploads: tickets });
  }
  const complete = /^\/v1\/imports\/batches\/([^/]+)\/files\/([^/]+)\/complete$/.exec(url.pathname);
  if (req.method === 'POST' && complete) {
    const upload = uploads.get(complete[2]);
    if (!upload) return error(res, 404, 'NOT_FOUND');
    if (upload.result) return send(res, 200, upload.result);
    const bytes = Buffer.concat(
      body.parts.map((p) => upload.parts.get(p.partNumber) ?? Buffer.alloc(0)),
    );
    if (bytes.length !== upload.size) {
      return send(res, 422, {
        requestId: 'mock',
        code: 'UNPROCESSABLE',
        message: 'The upload is incomplete: every part must be uploaded first',
        details: { reason: 'InvalidPart' },
      });
    }
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      return error(res, 422, 'UNPROCESSABLE', 'The file is not a PDF');
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    const id = `file-${(nextImport += 1)}`;
    const file = {
      id,
      originalName: upload.name,
      sizeBytes: upload.size,
      status: checksums.has(sha) ? 'duplicate' : 'extracting',
      duplicateOfId: checksums.get(sha) ?? null,
      since: Date.now(),
    };
    if (!checksums.has(sha)) checksums.set(sha, id);
    upload.batch.files.push(file);
    upload.result = { uploadId: upload.id, files: [fileDetail(file)], skipped: [] };
    return send(res, 200, upload.result);
  }
  const confirmAll = /^\/v1\/imports\/batches\/([^/]+)\/confirm$/.exec(url.pathname);
  if (req.method === 'POST' && confirmAll) {
    const batch = batches.get(confirmAll[1]);
    if (!batch) return error(res, 404, 'NOT_FOUND');
    batch.files.forEach(advance);
    const ready = batch.files.filter((f) => f.status === 'ready');
    if (ready.length === 0) {
      return error(res, 422, 'UNPROCESSABLE', 'No file in this batch is ready to confirm');
    }
    for (const f of ready) Object.assign(f, { status: 'confirming', since: Date.now() });
    return send(res, 202, {
      queued: ready.map((f) => ({ id: f.id, status: 'confirming', voters: f.voterCount })),
      skipped: [],
    });
  }
  return false;
}

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const url = new URL(req.url, 'http://mock');

  // Object storage: a part of an upload, straight from the browser.
  const part = /^\/__s3\/([^/]+)\/(\d+)$/.exec(url.pathname);
  if (part) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, STORAGE_CORS);
      return res.end();
    }
    const upload = uploads.get(part[1]);
    if (req.method !== 'PUT' || !upload) {
      res.writeHead(404, STORAGE_CORS);
      return res.end();
    }
    const bytes = Buffer.concat(chunks);
    upload.parts.set(Number(part[2]), bytes);
    res.writeHead(200, {
      ...STORAGE_CORS,
      etag: `"${createHash('md5').update(bytes).digest('hex')}"`,
    });
    return res.end();
  }

  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : {};
  const person = tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''));

  // Tests only: back to the seed. Each spec resets only its own part
  // (`?only=geography|users|imports`), since specs run side by side.
  if (req.method === 'POST' && url.pathname === '/__reset') {
    const only = url.searchParams.get('only');
    const seeded = !only || only === 'geography' ? seedGeography() : null;
    if (!only || only === 'users') {
      const find = (id) => nodes.find((n) => n.id === id);
      seedUsers(seeded ?? { ac101: find('n-3'), part1: find('n-4'), booth1: find('n-5') });
    }
    if (!only || only === 'imports') resetImports();
    return send(res, 204);
  }
  if (req.method === 'POST' && url.pathname === '/v1/auth/otp/request') return send(res, 202);
  if (req.method === 'POST' && url.pathname === '/v1/auth/otp/verify') {
    const who = PEOPLE[body.phone];
    if (!who || body.code !== CODE || !body.deviceId) return error(res, 401, 'OTP_INVALID');
    const accessToken = `access-${(issued += 1)}`;
    tokens.set(accessToken, who);
    return send(res, 200, {
      accessToken,
      refreshToken: `refresh-${issued}`,
      tokenType: 'Bearer',
      expiresIn: 900,
    });
  }
  if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
    if (!person) return error(res, 401, 'UNAUTHENTICATED');
    // This session only, like the API: other sign-ins (other tests) stay.
    tokens.delete((req.headers.authorization ?? '').replace('Bearer ', ''));
    return send(res, 204);
  }
  if (req.method === 'POST' && url.pathname === '/v1/auth/refresh') {
    return error(res, 401, 'UNAUTHENTICATED');
  }
  if (req.method === 'GET' && url.pathname === '/v1/health')
    return send(res, 200, { status: 'ok', checks: {} });
  if (req.method === 'GET' && url.pathname === '/v1/me') {
    if (!person) return error(res, 401, 'UNAUTHENTICATED');
    return send(res, 200, {
      id: person.id,
      name: person.name,
      phone: '+91…',
      email: null,
      preferredLanguage: 'en',
      mfaState: 'not_enrolled',
      assignments: [
        {
          id: `a-${person.id}`,
          role: person.role,
          validFrom: '2026-01-01T00:00:00.000Z',
          validUntil: null,
          node: {
            ...assignmentView(assignments.find((a) => a.userId === person.id)).node,
            isAuxiliary: false,
          },
          path: pathOf(assignments.find((a) => a.userId === person.id).nodeId),
        },
      ],
    });
  }
  if (!person) return error(res, 401, 'UNAUTHENTICATED');
  if (person.role !== 'admin') return error(res, 403, 'FORBIDDEN');
  if (url.pathname.startsWith('/v1/imports/')) {
    const handled = importRoute(req, res, url, body);
    if (handled !== false) return;
  }
  if (req.method === 'GET' && url.pathname === '/v1/users') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const role = url.searchParams.get('role');
    const nodeId = url.searchParams.get('nodeId') ?? adminNode.id;
    const activeOnly = url.searchParams.get('active') === 'true';
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const start = Number(url.searchParams.get('cursor') ?? 0);
    const matching = users
      .filter((u) =>
        assignments.some(
          (a) =>
            a.userId === u.id &&
            below(a.nodeId, nodeId) &&
            (!role || a.role === role) &&
            (!activeOnly || isActive(a)),
        ),
      )
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.phone.startsWith(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    const page = matching.slice(start, start + limit);
    const more = start + limit < matching.length;
    return send(res, 200, {
      items: page.map(userView),
      nextCursor: more ? String(start + limit) : null,
    });
  }
  const oneUser = /^\/v1\/users\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && oneUser) {
    const user = users.find((u) => u.id === oneUser[1]);
    if (!user || userView(user).assignments.length === 0) return error(res, 404, 'NOT_FOUND');
    return send(res, 200, userView(user));
  }
  if (req.method === 'POST' && url.pathname === '/v1/users') {
    if (!/^\+[1-9]\d{7,14}$/.test(body.phone ?? '')) return error(res, 400, 'VALIDATION_FAILED');
    const problem = grantProblem(body);
    if (problem) return error(res, ...problem);
    // Synthetic: this number belongs to another organization.
    if (body.phone === '+919999900999') {
      return error(res, 409, 'CONFLICT', 'This phone number can’t be used');
    }
    let user = users.find((u) => u.phone === body.phone);
    const created = !user;
    if (!user) {
      user = {
        id: `u-new-${(nextUser += 1)}`,
        name: body.name,
        phone: body.phone,
        status: 'active',
        preferredLanguage: body.preferredLanguage ?? 'en',
      };
      users.push(user);
    }
    const assignment = grant(user.id, body);
    return send(res, 201, {
      user: userView(user),
      assignment: assignmentView(assignment),
      created,
    });
  }
  if (req.method === 'POST' && url.pathname === '/v1/role-assignments') {
    const user = users.find((u) => u.id === body.userId);
    if (!user || userView(user).assignments.length === 0) return error(res, 404, 'NOT_FOUND');
    const problem = grantProblem(body);
    if (problem) return error(res, ...problem);
    return send(res, 201, assignmentView(grant(user.id, body)));
  }
  const endOne = /^\/v1\/role-assignments\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && endOne) {
    const a = assignments.find((x) => x.id === endOne[1]);
    if (!a || !below(a.nodeId, adminNode.id)) return error(res, 404, 'NOT_FOUND');
    if (a.userId === person.id && a.role === 'admin') {
      return error(
        res,
        422,
        'UNPROCESSABLE',
        'You can’t end your own admin role; ask another admin',
      );
    }
    if (a.validUntil && new Date(a.validUntil) <= new Date()) {
      return error(res, 422, 'UNPROCESSABLE', 'This assignment has already ended');
    }
    a.validUntil = new Date().toISOString();
    return send(res, 200, assignmentView(a));
  }
  if (req.method === 'GET' && url.pathname === '/v1/audit-events') return auditEvents(res, url);
  if (req.method === 'GET' && url.pathname === '/v1/geographies') {
    const parentId = url.searchParams.get('parentId');
    const items = nodes
      .filter((n) => n.parentId === (parentId ?? null))
      .sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
    return send(res, 200, { items, nextCursor: null });
  }
  if (req.method === 'POST' && url.pathname === '/v1/geographies/imports') {
    const planned = plan(body.csv ?? '');
    if (!body.confirm) return send(res, 200, report(planned, false));
    if (planned.counts.error > 0) {
      return send(res, 422, {
        requestId: 'mock',
        code: 'UNPROCESSABLE',
        message: 'Some rows have errors; nothing was saved',
        details: report(planned, false),
      });
    }
    for (const level of ['state', 'pc', 'ac']) {
      for (const row of planned.rows.filter((r) => r.level === level)) {
        if (row.action === 'create') {
          const parent = row.parentKey ? nodes.find((n) => keyOf(n) === row.parentKey) : null;
          add(parent, level, row.code, row.name, { reservation: row.reservation });
        } else if (row.action === 'update') {
          Object.assign(row.existing, { name: row.name, reservation: row.reservation });
        }
      }
    }
    return send(res, 200, report(planned, true));
  }
  const edit = /^\/v1\/geographies\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'PATCH' && edit) {
    const node = nodes.find((n) => n.id === edit[1]);
    if (!node) return error(res, 404, 'NOT_FOUND');
    if (body.name !== undefined) node.name = body.name;
    if (body.reservation !== undefined) node.reservation = body.reservation;
    return send(res, 200, node);
  }
  return error(res, 404, 'NOT_FOUND');
}).listen(PORT);
