/** Translations of labels and descriptions (`TranslationService`). */
import { ValidationError } from '../domain/errors.js';

export class TranslationService {
  constructor({ translations }) { this.translations = translations; }
  list(filter = {}) { return this.translations.list(filter); }
  listForItem(itemType, itemId) {
    return this.translations.list({ tableName: itemType, recordId: Number(itemId) });
  }
  set({ itemType, itemId, locale, langCode, field, fieldName, value }) {
    return this.upsert({
      tableName: itemType,
      recordId: Number(itemId),
      fieldName: field || fieldName || 'label',
      langCode: locale || langCode || 'en',
      value: value ?? ''
    });
  }
  upsert(entry) {
    const tableName = entry.tableName || entry.itemType;
    const recordId = entry.recordId ?? entry.itemId;
    const fieldName = entry.fieldName || entry.field || 'label';
    const langCode = entry.langCode || entry.locale || entry.lang;
    const translatedText = entry.translatedText ?? entry.value ?? '';
    if (!tableName || !recordId || !fieldName || !langCode) {
      throw new ValidationError('tableName, recordId, fieldName and langCode are required');
    }
    return this.translations.upsert({ tableName, recordId: Number(recordId), fieldName, langCode, translatedText });
  }
  remove(id) { return this.translations.delete(Number(id)); }
  languages() { return this.translations.languages(); }
}
