export const DEFAULT_SETTINGS = {
  theme: 'liquid',
  grid: 24,
  snapToGrid: true,
  snapToAnchors: true,   // 9 reference points of the device / parent
  showGrid: true,
  device: 'iphone-15',
  leftPanelWidth: 360,
  exportFolder: ''
};

export class SettingsService {
  constructor({ settings }) { this.settings = settings; }
  get() { return { ...DEFAULT_SETTINGS, ...this.settings.all() }; }
  update(patch) {
    for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) this.settings.set(k, v);
    return this.get();
  }
}
