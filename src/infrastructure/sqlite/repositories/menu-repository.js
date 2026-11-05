const toItem = r => r && ({
  id: r.id,
  buttonId: r.button_id,
  parentId: r.parent_id,
  ord: r.ord,
  name: r.name,
  label: r.label,
  iconId: r.icon_id,
  action: r.action,
  targetScreenId: r.target_screen_id,
  targetElementId: r.target_element_id ?? null,
  visible: r.visible === undefined || r.visible === null ? true : Boolean(r.visible),
  descriptionDev: r.description_dev
});

/** Persistence of the nested menu items of buttons. */
export class MenuRepository {
  constructor(db) { this.db = db; }

  list(buttonId) { return this.db.prepare('SELECT * FROM menu_items WHERE button_id = ? ORDER BY ord, id').all(buttonId).map(toItem); }
  listAll() { return this.db.prepare('SELECT * FROM menu_items ORDER BY button_id, ord, id').all().map(toItem); }
  get(id) { return toItem(this.db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id)); }

  create(buttonId, m) {
    const ord = m.ord ?? this.db.prepare('SELECT COALESCE(MAX(ord),0)+1 AS o FROM menu_items WHERE button_id = ? AND parent_id IS ?').get(buttonId, m.parentId ?? null).o;
    const r = this.db.prepare(`INSERT INTO menu_items (button_id,parent_id,ord,name,label,icon_id,action,target_screen_id,target_element_id,visible,description_dev) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(buttonId, m.parentId ?? null, ord, m.name ?? '', m.label ?? '', m.iconId ?? null, m.action ?? '', m.targetScreenId ?? null, m.targetElementId ?? null, m.visible === false || m.visible === 0 ? 0 : 1, m.descriptionDev ?? '');
    return this.get(Number(r.lastInsertRowid));
  }

  update(id, patch) {
    const map = {
      parentId: 'parent_id',
      ord: 'ord',
      name: 'name',
      label: 'label',
      iconId: 'icon_id',
      action: 'action',
      targetScreenId: 'target_screen_id',
      targetElementId: 'target_element_id',
      visible: 'visible',
      descriptionDev: 'description_dev'
    };
    const sets = [], args = [];
    for (const [k, col] of Object.entries(map)) {
      if (patch[k] !== undefined) {
        sets.push(`${col} = ?`);
        args.push(k === 'visible' ? (patch[k] ? 1 : 0) : patch[k]);
      }
    }
    if (sets.length) this.db.prepare(`UPDATE menu_items SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    return this.get(id);
  }

  delete(id) { return this.db.prepare('DELETE FROM menu_items WHERE id = ?').run(id).changes > 0; }

  /** Makes the menu of a button equal to `items` (ids are kept so a restore is exact; a missing icon or screen becomes null). */
  replaceAll(buttonId, items) {
    this.db.prepare('DELETE FROM menu_items WHERE button_id = ?').run(buttonId);
    const insert = this.db.prepare(`INSERT INTO menu_items (id,button_id,parent_id,ord,name,label,icon_id,action,target_screen_id,target_element_id,visible,description_dev)
      VALUES (?,?,?,?,?,?,(SELECT id FROM icons WHERE id = ?),?,(SELECT id FROM screens WHERE id = ?),(SELECT id FROM elements WHERE id = ?),?,?)`);
    const level = parent => items.filter(i => (i.parentId ?? null) === parent).sort((a, b) => a.ord - b.ord || a.id - b.id);
    const walk = parent => {
      for (const i of level(parent)) {
        insert.run(i.id, buttonId, i.parentId ?? null, i.ord, i.name ?? '', i.label ?? '', i.iconId ?? null, i.action ?? '', i.targetScreenId ?? null, i.targetElementId ?? null, i.visible === false || i.visible === 0 ? 0 : 1, i.descriptionDev ?? '');
        walk(i.id);
      }
    };
    walk(null);
  }

  /** Copies the whole menu tree of one button to another (used when a button is cloned). */
  copyAll(fromButtonId, toButtonId) {
    const rows = this.list(fromButtonId), idMap = new Map();
    const copy = parent => { for (const r of rows.filter(x => (x.parentId ?? null) === parent)) { idMap.set(r.id, this.create(toButtonId, { ...r, parentId: parent == null ? null : idMap.get(parent), ord: r.ord }).id); copy(r.id); } };
    copy(null);
  }
}
