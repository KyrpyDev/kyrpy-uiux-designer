import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { validateTheme, BUILTIN_THEMES } from '../domain/theme.js';
import { slugify, uniqueKey } from '../domain/naming.js';

export class ThemeService {
  constructor({ themes }) { this.themes = themes; }

  list() { return this.themes.list(); }

  get(idOrKey) {
    const t = /^\d+$/.test(String(idOrKey)) ? this.themes.get(Number(idOrKey)) : this.themes.getByKey(String(idOrKey));
    if (!t) throw new NotFoundError('theme', idOrKey);
    return t;
  }

  create(input) {
    const theme = { surfaces: {}, ...input, key: input.key || slugify(input.name) };
    const errors = validateTheme(theme);
    if (errors.length) throw new ValidationError(errors.join('; '), errors);
    if (this.themes.getByKey(theme.key)) throw new ConflictError(`theme key "${theme.key}" exists`);
    return this.themes.create({ ...theme, builtin: false });
  }

  update(id, patch) {
    const t = this.get(id);
    const merged = { ...t, ...patch, tokens: { ...t.tokens, ...(patch.tokens || {}) }, surfaces: { ...t.surfaces, ...(patch.surfaces || {}) } };
    const errors = validateTheme(merged);
    if (errors.length) throw new ValidationError(errors.join('; '), errors);
    if (patch.key && patch.key !== t.key && this.themes.getByKey(patch.key)) throw new ConflictError(`theme key "${patch.key}" exists`);
    return this.themes.update(t.id, { key: merged.key, name: merged.name, kind: merged.kind, tokens: merged.tokens, surfaces: merged.surfaces });
  }

  clone(id, name) {
    const t = this.get(id);
    const key = uniqueKey(slugify(name || `${t.key}-copy`), k => !!this.themes.getByKey(k));
    return this.themes.create({ ...t, key, name: name || `${t.name} copy`, builtin: false });
  }

  remove(id) {
    const t = this.get(id);
    if (t.builtin) throw new ConflictError('built-in themes cannot be deleted (clone them instead)');
    if (this.themes.list().length <= 1) throw new ConflictError('at least one theme must remain');
    this.themes.delete(t.id);
    return { deleted: true, id: t.id };
  }

  /** Restores the four built-in themes (used by the importer). Existing built-ins are refreshed. */
  seedBuiltins() {
    for (const b of BUILTIN_THEMES) {
      const ex = this.themes.getByKey(b.key);
      if (ex) this.themes.update(ex.id, { name: b.name, kind: b.kind, tokens: b.tokens, surfaces: b.surfaces });
      else this.themes.create({ ...b, builtin: true });
    }
  }
}
