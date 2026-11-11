import { ValidationError } from '../../domain/errors.js';

/**
 * Types of request-body fields, checked before a body reaches a service (STRUCT-05). Services still decide which
 * fields they use and what the values mean; this only guarantees the shape: a name is a string, a list is a list,
 * an id is a whole number. `null` is "no value" for every field. Unknown fields are left to the service.
 */
const isNum = v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const KINDS = {
  str: (v, max) => (typeof v === 'string' && v.length <= max ? null : `a text of at most ${max} characters`),
  num: v => (isNum(v) ? null : 'a number'),
  int: v => (isNum(v) && Number.isSafeInteger(Number(v)) ? null : 'a whole number'),
  bool: v => (typeof v === 'boolean' || v === 0 || v === 1 ? null : 'true or false'),
  arr: (v, max) => (Array.isArray(v) && v.length <= max ? null : `a list of at most ${max} entries`),
  obj: v => (v !== null && typeof v === 'object' && !Array.isArray(v) ? null : 'an object'),
  list: (v, max) => ((Array.isArray(v) && v.length <= max) || (typeof v === 'string' && v.length <= 2000) ? null : 'a list'),
  ints: (v, max) => (Array.isArray(v) && v.length <= max && v.every(x => isNum(x) && Number.isSafeInteger(Number(x))) ? null : `a list of at most ${max} whole numbers`)
};
const f = (kind, max) => ({ kind, max });

/** Fields that mean the same in every route. */
export const COMMON_FIELDS = {
  name: f('str', 200), key: f('str', 200), label: f('str', 500), category: f('str', 200), displayName: f('str', 200),
  description: f('str', 20000), descriptionDev: f('str', 20000), comment: f('str', 5000), reviewNote: f('str', 5000),
  username: f('str', 80), email: f('str', 320), usernameOrEmail: f('str', 320), identifier: f('str', 320),
  password: f('str', 1024), currentPassword: f('str', 1024), newPassword: f('str', 1024),
  role: f('str', 40), status: f('str', 40), visibility: f('str', 40), scope: f('str', 40), action: f('str', 40),
  avatarColor: f('str', 40), buttonStyle: f('str', 40),
  projectId: f('int'), userId: f('int'), iconId: f('int'), screenId: f('int'), targetId: f('int'),
  fromScreenId: f('int'), toScreenId: f('int'),
  width: f('num'), height: f('num'), x: f('num'), y: f('num'), zoom: f('num'), position: f('num'), buttonIconSizePct: f('num'),
  force: f('bool'), locked: f('bool'), collapsed: f('bool'), requireApproval: f('bool'), signOutOthers: f('bool'),
  nodes: f('arr', 20000), animations: f('arr', 5000), items: f('arr', 20000), links: f('arr', 20000), waypoints: f('arr', 2000),
  tags: f('list', 200), ids: f('ints', 20000), projectIds: f('list', 2000),
  meta: f('obj'), settings: f('obj'), attrs: f('obj'), tokens: f('obj'), surfaces: f('obj')
};

/** Fields a route cannot work without (`METHOD pattern` as registered). */
export const REQUIRED_FIELDS = {
  'POST /api/auth/login': ['password'],
  'POST /api/auth/register': ['username', 'email', 'password'],
  'POST /api/users': ['username', 'email', 'password'],
  'POST /api/projects': ['name'],
  'POST /api/auth/profile/password': ['currentPassword', 'newPassword']
};

/** Throws ValidationError (422) naming the first field with a wrong shape or a missing required one. */
export function checkBodyShape(method, pattern, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  for (const [name, value] of Object.entries(body)) {
    const spec = COMMON_FIELDS[name];
    if (!spec || value === null || value === undefined) continue;
    const wrong = KINDS[spec.kind](value, spec.max);
    if (wrong) throw new ValidationError(`"${name}" must be ${wrong}`);
  }
  for (const name of REQUIRED_FIELDS[`${method} ${pattern}`] || []) {
    if (body[name] === undefined || body[name] === null || body[name] === '') throw new ValidationError(`"${name}" is required`);
  }
  return body;
}
