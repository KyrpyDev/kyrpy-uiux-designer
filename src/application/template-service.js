/** Editable device and button templates (`TemplateService`). */
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { DEVICES, registerDevice, unregisterDevice, DEFAULT_BUTTON_TEMPLATES, designButtonTemplateNodes } from '../domain/entities.js';
import { isValidKey, slugify } from '../domain/naming.js';
import { fallbackOwnerId } from './default-owner.js';

export class TemplateService {
  constructor({ templates, services = {} }) {
    Object.assign(this, { templates, services });
  }

  /** Start-up write, called by the composition root: the built-in device and button templates. */
  seed() { this.seedDefaults(); return this; }

  /** Users repository of the design services (owner fallback). */
  get users() { return Object.values(this.services || {}).find(s => s?.users)?.users ?? null; }

  seedDefaults() {
    for (const [key, d] of Object.entries(DEVICES)) {
      const ex = this.templates.getDeviceByKey(key);
      const payload = {
        key,
        name: d.name,
        category: d.category || 'mobile',
        width: d.width,
        height: d.height,
        cornerRadius: d.cornerRadius ?? (key === 'web' || key === 'web-1080p' ? 8 : 44),
        grid: 24,
        locked: false,
        meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'liquid', lightTheme: 'liquid-light', ...(d.meta || {}) },
        builtin: true
      };
      if (!ex) {
        this.templates.createDevice(payload);
      } else if (ex.builtin && !ex.meta?.userEdited) {   // a built-in template somebody edited keeps the edit
        this.templates.updateDevice(ex.id, payload);
      }
    }
    for (const b of DEFAULT_BUTTON_TEMPLATES) {
      const ex = this.templates.getButtonByKey(b.key);
      const nodesTemplate = this.#buildButtonNodes(b);
      if (!ex) {
        this.templates.createButton({ ...b, meta: b.meta || { mode: 'dark' }, builtin: true, nodesTemplate });
      } else if (ex.builtin && !ex.meta?.userEdited) {
        this.templates.updateButton(ex.id, { ...b, meta: b.meta || ex.meta || { mode: 'dark' }, nodesTemplate });
      }
    }
    for (const d of this.templates.listDevices()) this.#register(d);   // custom and edited devices are known after a restart
  }

  #register(d) {
    registerDevice(d.key, { name: d.name, width: d.width, height: d.height, category: d.category, cornerRadius: d.cornerRadius, meta: d.meta });
  }

  /** Only the known device fields, with sane numbers (the request body is not passed on as is). */
  #devicePatch(patch = {}) {
    const out = {};
    if (patch.name !== undefined) { out.name = String(patch.name).trim(); if (!out.name) throw new ValidationError('Device template name is required'); }
    if (patch.key !== undefined) { out.key = String(patch.key).trim(); if (!isValidKey(out.key)) throw new ValidationError('Device key must be dashed lowercase words'); }
    if (patch.category !== undefined) out.category = String(patch.category || 'custom');
    if (patch.width !== undefined) out.width = Math.max(64, Number(patch.width) || 390);
    if (patch.height !== undefined) out.height = Math.max(64, Number(patch.height) || 844);
    if (patch.cornerRadius !== undefined) out.cornerRadius = Math.max(0, Number(patch.cornerRadius) || 0);
    if (patch.grid !== undefined) out.grid = Math.max(1, Number(patch.grid) || 24);
    if (patch.locked !== undefined) out.locked = !!patch.locked;
    if (patch.meta !== undefined && patch.meta && typeof patch.meta === 'object') out.meta = patch.meta;
    return out;
  }

  #buildButtonNodes(b) { return designButtonTemplateNodes(b); }

  /** Returns all devices as a `{ [key]: { name, width, height, ... } }` map for the UI and screen normalization. */
  devicesMap() {
    const out = { ...DEVICES };
    for (const d of this.templates.listDevices()) {
      out[d.key] = { id: d.id, key: d.key, name: d.name, category: d.category, width: d.width, height: d.height, cornerRadius: d.cornerRadius, grid: d.grid, locked: d.locked, builtin: d.builtin };
    }
    return out;
  }

  listDevices() { return this.templates.listDevices(); }

  createDevice(input) {
    const name = String(input.name || '').trim();
    if (!name) throw new ValidationError('Device template name is required');
    const key = input.key ? String(input.key).trim() : slugify(name);
    if (!isValidKey(key)) throw new ValidationError('Device key must be dashed lowercase words');
    if (this.templates.getDeviceByKey(key)) throw new ConflictError(`Device template "${key}" already exists`);
    const created = this.templates.createDevice({
      key,
      name,
      category: input.category || 'custom',
      width: Math.max(64, Number(input.width) || 390),
      height: Math.max(64, Number(input.height) || 844),
      cornerRadius: Number(input.cornerRadius ?? 32),
      grid: Math.max(1, Number(input.grid) || 24),
      locked: !!input.locked,
      meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'liquid', lightTheme: 'liquid-light', ...(input.meta || {}) },
      builtin: false
    });
    this.#register(created);
    return created;
  }

  updateDevice(id, patch) {
    const existing = this.templates.getDevice(id);
    if (!existing) throw new NotFoundError('template_device', id);
    patch = this.#devicePatch(patch);
    if (patch.key && patch.key !== existing.key) {
      if (existing.builtin) throw new ConflictError('The key of a built-in device template cannot be changed');
      if (this.templates.getDeviceByKey(patch.key)) throw new ConflictError(`Device template "${patch.key}" already exists`);
    }
    if (existing.builtin) patch = { ...patch, meta: { ...(existing.meta || {}), ...(patch.meta || {}), userEdited: true } };
    const updated = this.templates.updateDevice(existing.id, patch);
    if (updated.key !== existing.key) unregisterDevice(existing.key);
    this.#register(updated);
    return updated;
  }

  deleteDevice(id) {
    const existing = this.templates.getDevice(id);
    if (!existing) throw new NotFoundError('template_device', id);
    if (existing.builtin) throw new ConflictError('Built-in device templates cannot be deleted (edit or clone instead)');
    this.templates.deleteDevice(existing.id);
    unregisterDevice(existing.key);
    return { deleted: true, id: existing.id };
  }

  saveDevice(input = {}) {
    if (input.id && this.templates.getDevice(Number(input.id))) {
      return this.updateDevice(Number(input.id), input);
    }
    if (input.key && this.templates.getDeviceByKey(String(input.key))) {
      const ex = this.templates.getDeviceByKey(String(input.key));
      return this.updateDevice(ex.id, input);
    }
    return this.createDevice({
      ...input,
      cornerRadius: input.cornerRadius ?? input.radius ?? 32
    });
  }


  listButtons() { return this.templates.listButtons(); }
  listButtonTemplates() { return this.listButtons(); }

  saveButtonTemplate(input = {}) {
    if (input.id && this.templates.getButton(Number(input.id))) {
      return this.updateButton(Number(input.id), input);
    }
    if (input.key && this.templates.getButtonByKey(String(input.key))) {
      const ex = this.templates.getButtonByKey(String(input.key));
      return this.updateButton(ex.id, input);
    }
    return this.createButton(input);
  }

  removeButtonTemplate(id) { return this.deleteButton(id); }

  createButton(input) {
    const name = String(input.name || '').trim();
    if (!name) throw new ValidationError('Button template name is required');
    const key = input.key ? String(input.key).trim() : slugify(name);
    if (!isValidKey(key)) throw new ValidationError('Button template key must be dashed lowercase words');
    if (this.templates.getButtonByKey(key)) throw new ConflictError(`Button template "${key}" already exists`);
    const tpl = {
      key,
      name,
      category: input.category || 'custom',
      shape: input.shape || 'pill',
      width: Math.max(16, Number(input.width) || 160),
      height: Math.max(16, Number(input.height) || 48),
      rxRatio: Number(input.rxRatio ?? 0.3),
      marginRatio: Number(input.marginRatio ?? 0.15),
      strokeRatio: Number(input.strokeRatio ?? 1.0),
      role: input.role || 'button',
      hoverEffect: input.hoverEffect || 'glow',
      indicatorEffect: input.indicatorEffect || 'none',
      meta: input.meta || {},
      builtin: false
    };
    const customNodes = Array.isArray(input.nodesTemplate) && input.nodesTemplate.length
      ? input.nodesTemplate
      : (Array.isArray(input.nodes) && input.nodes.length ? input.nodes : null);
    tpl.nodesTemplate = customNodes || this.#buildButtonNodes(tpl);
    return this.templates.createButton(tpl);
  }

  updateButton(id, patch) {
    const existing = this.templates.getButton(id);
    if (!existing) throw new NotFoundError('template_button', id);
    patch = { ...patch };   // the caller's object is not changed
    if (existing.builtin) patch.meta = { ...(existing.meta || {}), ...(patch.meta || {}), userEdited: true };
    const merged = { ...existing, ...patch };
    if (!patch.nodesTemplate && Array.isArray(patch.nodes) && patch.nodes.length) patch.nodesTemplate = patch.nodes;
    if (!patch.nodesTemplate) patch.nodesTemplate = this.#buildButtonNodes(merged);
    return this.templates.updateButton(existing.id, patch);
  }

  deleteButton(id) {
    const existing = this.templates.getButton(id);
    if (!existing) throw new NotFoundError('template_button', id);
    if (existing.builtin) throw new ConflictError('Built-in button templates cannot be deleted');
    this.templates.deleteButton(existing.id);
    return { deleted: true, id: existing.id };
  }

  /** Creates a new library button (or element) from an editable button template. */
  instantiateButton(idOrKey, { name, projectId = 1, visibility = 'public', creatorId = fallbackOwnerId(this), iconId = null } = {}) {
    const tpl = /^\d+$/.test(String(idOrKey)) ? this.templates.getButton(Number(idOrKey)) : this.templates.getButtonByKey(String(idOrKey));
    if (!tpl) throw new NotFoundError('template_button', idOrKey);
    const btnSvc = this.services.button;
    if (!btnSvc) throw new Error('button service not bound');
    const nodes = JSON.parse(JSON.stringify(tpl.nodesTemplate?.length ? tpl.nodesTemplate : this.#buildButtonNodes(tpl)));
    if (iconId && this.services.icon) {
      const margin = Math.round(Math.min(tpl.width, tpl.height) * (tpl.marginRatio || 0.2));
      const sz = Math.max(16, Math.min(tpl.width, tpl.height) - margin * 2);
      nodes.push({
        tag: 'use',
        kind: 'instance',
        refType: 'icon',
        refId: Number(iconId),
        name: 'icon',
        attrs: { x: tpl.shape === 'circle' ? Math.round((tpl.width - sz) / 2) : margin, y: Math.round((tpl.height - sz) / 2), width: sz, height: sz }
      });
    }
    return btnSvc.create({
      name: name || tpl.name,
      category: tpl.category || 'template',
      width: tpl.width,
      height: tpl.height,
      projectId,
      visibility,
      creatorId,
      meta: { templateKey: tpl.key, shape: tpl.shape, rxRatio: tpl.rxRatio, marginRatio: tpl.marginRatio, strokeRatio: tpl.strokeRatio, hoverEffect: tpl.hoverEffect, indicatorEffect: tpl.indicatorEffect }
    }, { nodes });
  }


}
