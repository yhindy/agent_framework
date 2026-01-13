import Store from 'electron-store'
import { AppSettings, DEFAULT_SETTINGS } from '../../shared/types/settings'

interface StoreSchema {
  settings: AppSettings
}

export class SettingsService {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store({
      name: 'settings',
      defaults: { settings: DEFAULT_SETTINGS }
    })
    this.migrateIfNeeded()
  }

  getSettings(): AppSettings {
    return this.store.get('settings', DEFAULT_SETTINGS)
  }

  updateSettings(updates: Partial<AppSettings>): AppSettings {
    const current = this.getSettings()
    const updated = this.deepMerge(current, updates)
    this.store.set('settings', updated)
    return updated
  }

  private migrateIfNeeded(): void {
    const settings = this.store.get('settings')
    if (!settings || settings.version < DEFAULT_SETTINGS.version) {
      const migrated = this.deepMerge(DEFAULT_SETTINGS, settings || {})
      migrated.version = DEFAULT_SETTINGS.version
      this.store.set('settings', migrated)
    }
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target }
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key])
      } else if (source[key] !== undefined) {
        result[key] = source[key]
      }
    }
    return result
  }
}
