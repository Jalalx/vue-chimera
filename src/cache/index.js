import MemoryCache from './MemoryCache'
import { isPlainObject } from '../utils'

export default class Cache {
  static from (options) {
    if (!options) return null
    if (isPlainObject(options)) {
      return new Cache(options.strategy || 'stale', options.store)
    }
    return new Cache('stale', options)
  }

  constructor (strategy, store) {
    this.strategy = strategy
    this.store = store
  }

  get (r) {
    return this.store.getItem(this.getCacheKey(r))
  }

  set (r, value) {
    value = value || r.toJSON()
    delete value.ssrPrefetched
    this.store.setItem(this.getCacheKey(r), value)
  }

  assignCache (r, value) {
    if (!value) value = this.get(r)

    const strategy = (r.cacheOptions || {}).strategy || this.strategy
    const assign = () => {
      Object.assign(r, value)
    }

    if (value) {
      if (strategy === 'cache-first') {
        assign()
        return r
      } else if (this.strategy === 'network-first') {
        if ((typeof navigator !== 'undefined' && !navigator.onLine) || r.error === true) {
          assign()
          return r
        }
      } else if (this.strategy === 'stale') {
        assign()
      }
    }
  }

  clear () {
    this.store && this.store.clear()
  }

  getCacheKey (r) {
    const hash = typeof window !== 'undefined' ? window.btoa : x => x
    return '$_chimera_' + (r.id || 'r') + '_' + hash([
      r.requestConfig.url,
      r.requestConfig.params,
      r.requestConfig.data,
      r.requestConfig.method
    ].join('|'))
  }

  set store (x) {
    if (!x || typeof x !== 'object') {
      this._store = new MemoryCache()
    } else {
      this._store = x
    }
  }

  get store () {
    return this._store
  }
}
