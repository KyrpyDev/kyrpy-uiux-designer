import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { ValidationError } from '../../domain/errors.js';

/** Writes an in-memory bundle ([{path, content}]) into a folder; refuses paths that would escape it. */
export class FsBundleWriter {
  write(files, folder) {
    if (!isAbsolute(folder)) throw new ValidationError('export folder must be an absolute path');
    const root = resolve(folder);
    // EXPORT_ROOT (when set) confines server-side exports to one folder tree
    const base = process.env.EXPORT_ROOT ? resolve(process.env.EXPORT_ROOT) : null;
    if (base && root !== base && !root.startsWith(base + sep)) throw new ValidationError(`export folder must be inside ${base}`);
    mkdirSync(root, { recursive: true });
    for (const f of files) {
      const rel = normalize(f.path);
      if (isAbsolute(rel) || rel.startsWith('..') || rel.includes(`..${sep}`)) throw new ValidationError(`unsafe file path: ${f.path}`);
      const target = join(root, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content, 'utf8');
    }
    return { folder: root, count: files.length };
  }
}
