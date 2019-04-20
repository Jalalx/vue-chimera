'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var Axios = _interopDefault(require('axios'));
var pDebounce = _interopDefault(require('p-debounce'));

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
}

function _objectSpread(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};
    var ownKeys = Object.keys(source);

    if (typeof Object.getOwnPropertySymbols === 'function') {
      ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) {
        return Object.getOwnPropertyDescriptor(source, sym).enumerable;
      }));
    }

    ownKeys.forEach(function (key) {
      _defineProperty(target, key, source[key]);
    });
  }

  return target;
}

function _objectWithoutPropertiesLoose(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;

  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }

  return target;
}

function _objectWithoutProperties(source, excluded) {
  if (source == null) return {};

  var target = _objectWithoutPropertiesLoose(source, excluded);

  var key, i;

  if (Object.getOwnPropertySymbols) {
    var sourceSymbolKeys = Object.getOwnPropertySymbols(source);

    for (i = 0; i < sourceSymbolKeys.length; i++) {
      key = sourceSymbolKeys[i];
      if (excluded.indexOf(key) >= 0) continue;
      if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
      target[key] = source[key];
    }
  }

  return target;
}

function isPlainObject(value) {
  const OBJECT_STRING = '[object Object]';
  return typeof value === 'object' && Object.prototype.toString(value) === OBJECT_STRING;
}
function createAxios(config) {
  if (config && typeof config.request === 'function') {
    return config;
  }

  if (isPlainObject(config)) {
    return Axios.create(config);
  }

  if (typeof config === 'function') {
    let axios = config();
    return createAxios(axios);
  }

  return Axios;
}

const {
  CancelToken
} = Axios;
const EVENT_SUCCESS = 'success';
const EVENT_ERROR = 'error';
const EVENT_CANCEL = 'cancel';
const EVENT_LOADING = 'loading';
const EVENT_TIMEOUT = 'timeout';
class Resource {
  static from(value, baseOptions = {}) {
    if (value == null) throw new Error('Cannot create resource from `null`');

    if (value instanceof Resource) {
      return value;
    }

    if (typeof value === 'string') {
      return new Resource(value, null, baseOptions);
    }

    if (isPlainObject(value)) {
      const {
        url,
        method
      } = value,
            options = _objectWithoutProperties(value, ["url", "method"]);

      if (options.cache) {
        if (!baseOptions.cache) throw new Error('Pre definition of cache should be on Chimera instance options');
        if (typeof options.cache !== 'object') throw Error('Cache should be an object');
        let cache = Object.create(baseOptions.cache);
        options.cache = Object.assign(cache, options.cache);
      }

      return new Resource(url, method, Object.assign({}, baseOptions, options));
    }
  }

  constructor(url, method, options) {
    options = options || {};
    method = method ? method.toLowerCase() : 'get';

    if (method && ['get', 'post', 'put', 'patch', 'delete'].indexOf(method) === -1) {
      throw new Error('Bad Method requested: ' + method);
    }

    this.axios = createAxios(options.axios);
    this.requestConfig = {
      url: url,
      method: method ? method.toLowerCase() : 'get',
      headers: options.headers || {},
      cancelToken: new CancelToken(c => {
        this._canceler = c;
      }),
      timeout: options.timeout || undefined
    };
    this.requestConfig[this.requestConfig.method === 'get' ? 'params' : 'data'] = options.params;
    this._loading = false;
    this._status = null;
    this._data = null;
    this._headers = null;
    this._error = null;
    this._lastLoaded = null;
    this._eventListeners = {};
    this.keepData = !!options.keepData;
    this.cache = options.cache;
    this.ssrPrefetched = false;
    this.cacheHit = false;
    this.prefetch = typeof options.prefetch === 'string' ? options.prefetch.toLowerCase() === method : Boolean(options.prefetch);
    this.ssrPrefetch = options.ssrPrefetch;
    this.fetchDebounced = pDebounce(this.fetch.bind(this), options.debounce || 80, {
      leading: true
    }); // Set Transformers

    if (options.transformer) {
      if (typeof options.transformer === 'function') {
        this.setTransformer(options.transformer);
      } else if (typeof options.transformer === 'object') {
        this.setResponseTransformer(options.transformer.response);
        this.setErrorTransformer(options.transformer.error);
      }
    }

    this.responseTransformer = this.responseTransformer || (r => r);

    this.errorTransformer = this.errorTransformer || (r => r); // Set interval.


    if (options.interval) {
      this.startInterval(options.interval);
    } // Set Events


    if (typeof options.on === 'object' && options.on) {
      for (let key in options.on) {
        this.on(key, options.on[key]);
      }
    }
  }

  setResponseTransformer(transformer) {
    this.responseTransformer = transformer;
  }

  setErrorTransformer(transformer) {
    this.errorTransformer = transformer;
  }

  setTransformer(transformer) {
    this.responseTransformer = transformer;
    this.errorTransformer = transformer;
  }

  startInterval(ms) {
    if (typeof process !== 'undefined' && process.server) return;
    if (ms) this._interval = ms;
    this.stopInterval();
    this._interval_id = setInterval(() => this.reload(true), this._interval);
  }

  stopInterval() {
    if (this._interval_id) clearInterval(this._interval_id);
  }

  on(event, handler) {
    let listeners = this._eventListeners[event] || [];
    listeners.push(handler);
    this._eventListeners[event] = listeners;
    return this;
  }

  bindListeners(obj) {
    Object.keys(this._eventListeners).forEach(key => {
      (this._eventListeners[key] || []).forEach((handler, i) => {
        this._eventListeners[key][i] = handler.bind(obj);
      });
    });
  }

  emit(event) {
    (this._eventListeners[event] || []).forEach(handler => {
      handler(this);
    });
  }

  fetch(force, extraData) {
    return new Promise((resolve, reject) => {
      if (this.cache && !force) {
        let cacheResult = this.cache.assignCache(this);

        if (cacheResult) {
          this.cacheHit = true;
          return resolve(cacheResult._data);
        }
      }

      this._loading = true;
      this.emit(EVENT_LOADING); // Assign Extra data

      let requestConfig = Object.assign({}, this.requestConfig, typeof extraData === 'object' ? {
        [this.requestConfig.method === 'get' ? 'params' : 'data']: extraData
      } : {});
      this.axios.request(requestConfig).then(res => {
        this._error = null;
        this._loading = false;
        this._lastLoaded = new Date();
        this._status = res.status;
        this._data = res.data ? this.responseTransformer(res.data) : null;
        this._headers = res.headers || {};
        this.cache && this.cache.set(this);
        this.emit(EVENT_SUCCESS);
        resolve(this._data);
      }).catch(err => {
        this._data = null;
        this._loading = false;
        const res = err.response;

        if (res) {
          this._status = res.status;
          this._error = res.data = res.data ? this.errorTransformer(res.data) : true;
          this._headers = res.headers || {};
        } else {
          this._status = 0;
          this._error = true;
          this._headers = {};
        }

        if (this.cache && this.cache.strategy === 'network-first') {
          this.cache.assignCache(this);
          this.cacheHit = true;
          return resolve(this._data);
        }

        if (err.message && !err.response && err.message.indexOf('timeout') !== -1) {
          err.timeout = true;
          this.emit(EVENT_TIMEOUT);
        } else if (Axios.isCancel(err)) {
          err.cancel = true;
          this.emit(EVENT_CANCEL);
        } else {
          this.emit(EVENT_ERROR);
        }

        reject(err);
      });
    });
  }

  reload(force) {
    return this.fetchDebounced(force);
  }

  execute() {
    return this.fetchDebounced(true);
  }

  send(extra) {
    return this.fetchDebounced(true, extra);
  }

  cancel(unload) {
    this.stopInterval();
    if (unload) this._data = null;
    if (typeof this._canceler === 'function') this._canceler();
    this.requestConfig.cancelToken = new CancelToken(c => {
      this._canceler = c;
    });
  }

  stop() {
    this.cancel();
  }

  toJSON() {
    const json = {};
    ['_loading', '_status', '_data', '_headers', '_error', '_lastLoaded', 'ssrPrefetched'].forEach(key => {
      json[key] = this[key];
    });
    return json;
  }

  get loading() {
    return this._loading;
  }

  get status() {
    return this._status;
  }

  get data() {
    return this._data;
  }

  get headers() {
    return this._headers;
  }

  get error() {
    return this._error;
  }

  get lastLoaded() {
    return this._lastLoaded;
  }

}

class NullResource extends Resource {
  fetch(force) {
    return Promise.reject(new Error('Null Resource'));
  }

  cancel() {}

  get loading() {
    return false;
  }

  get status() {
    return 0;
  }

  get data() {
    return null;
  }

  get error() {
    return null;
  }

  get lastLoaded() {
    return null;
  }

}

class WebStorageCache {
  constructor(options) {
    if (typeof window !== 'undefined') {
      const store = String(options.store).replace(/[\s-]/g).toLowerCase();
      this.storage = store === 'sessionstorage' ? window.sessionStorage : window.localStorage;
    }

    if (!this.storage) throw Error('LocalStorageCache: Local storage is not available.');
    this.defaultExpiration = options.defaultExpiration || 60000;
  }

  getObjectStore() {
    const store = this.storage.getItem('_chimera');
    return store ? JSON.parse(store) : {};
  }

  setObjectStore(x) {
    this.storage.setItem('_chimera', JSON.stringify(x));
  }

  clear() {
    this.storage.removeItem('_chimera');
  }
  /**
   *
   * @param key         Key for the cache
   * @param value       Value for cache persistence
   * @param expiration  Expiration time in milliseconds
   */


  setItem(key, value, expiration) {
    const store = this.getObjectStore();
    store[key] = {
      expiration: Date.now() + (expiration || this.defaultExpiration),
      value
    };
    this.setObjectStore(store);
  }
  /**
   * If Cache exists return the Parsed Value, If Not returns {null}
   *
   * @param key
   */


  getItem(key) {
    const store = this.getObjectStore();
    let item = store[key];

    if (item && item.value && Date.now() <= item.expiration) {
      return item.value;
    }

    this.removeItem(key);
    return null;
  }

  removeItem(key) {
    const store = this.getObjectStore();
    delete store[key];
    this.setObjectStore(store);
  }

  keys() {
    return Object.keys(this.getObjectStore());
  }

  length() {
    return this.keys().length;
  }

}

class Cache {
  static from(options, vm) {
    if (!options) return null;
    let {
      store
    } = options;
    return new Cache(vm, options.strategy || 'stale', store);
  }

  constructor(vm, strategy, store) {
    this.strategy = strategy;
    this.store = store;
    this.vm = vm;
  }

  get(r) {
    return this.store.getItem(this.getCacheKey(r));
  }

  set(r, value) {
    value = value || r.toJSON();
    delete value.ssrPrefetched;
    this.store.setItem(this.getCacheKey(r), value);
  }

  assignCache(r, value) {
    if (!value) value = this.get(r);
    const strategy = this.strategy;

    const assign = () => {
      Object.assign(r, value);
    };

    if (value) {
      if (strategy === 'cache-first') {
        assign();
        return r;
      } else if (this.strategy === 'network-first') {
        if (typeof navigator !== 'undefined' && !navigator.onLine || r.error === true) {
          assign();
          return r;
        }
      } else if (this.strategy === 'stale') {
        assign();
      }
    }
  }

  clear() {
    this.store && this.store.clear();
  }

  getCacheKey(r) {
    const hash = typeof window !== 'undefined' ? window.btoa : x => x;
    return '$_chimera_' + this.vm._uid + hash([r.requestConfig.url, r.requestConfig.params, r.requestConfig.data, r.requestConfig.method].join('|'));
  }

  set store(x) {
    if (!x || typeof x !== 'object') {
      this._store = new WebStorageCache({
        store: x
      });
    } else {
      this._store = x;
    }
  }

  get store() {
    return this._store;
  }

}

class VueChimera {
  constructor(vm, resources, options) {
    this._vm = vm;
    this._reactiveResources = {};
    this.options = options || {};
    this.axios = this.options.axios = !this.options.axios && this._vm.$axios ? this._vm.$axios : createAxios(this.options.axios);

    if (this.options.cache) {
      this.cache = this.options.cache = Cache.from(this.options.cache, this._vm);
    }

    const vmOptions = this._vm.$options;
    vmOptions.computed = vmOptions.computed || {};
    vmOptions.watch = vmOptions.watch || {};
    resources = Object.assign({}, resources);

    for (let key in resources) {
      if (key.charAt(0) === '$' || !resources.hasOwnProperty(key)) continue;
      let r = resources[key];

      if (typeof r === 'function') {
        r = r.bind(this._vm);
        resources[key] = new NullResource();
        this._reactiveResources[key] = r;
        vmOptions.computed['$_chimera__' + key] = r;

        vmOptions.watch['$_chimera__' + key] = t => this.updateReactiveResource(key, t);
      } else {
        resources[key] = Resource.from(r, this.options);
      }

      vmOptions.computed[key] = () => resources[key];

      resources[key].bindListeners(this._vm);
    }

    Object.defineProperty(resources, '$cancelAll', {
      value: this.cancelAll.bind(this)
    });
    Object.defineProperty(resources, '$axios', {
      get: () => this.axios
    });
    Object.defineProperty(resources, '$loading', {
      get() {
        for (let r in this) {
          if (r.loading) return true;
        }

        return false;
      }

    });
    this.resources = resources;
  }

  updateReactiveResources() {
    Object.keys(this._reactiveResources).forEach(key => {
      this.updateReactiveResource(key);
    });
  }

  updateReactiveResource(key) {
    const oldResource = this.resources[key];
    oldResource.stopInterval();
    let r = Resource.from(this._reactiveResources[key].call(this._vm), this.options); // Keep data

    if (oldResource.keepData) {
      r._data = oldResource._data;
      r._status = oldResource._status;
      r._headers = oldResource._headers;
      r._error = oldResource._error;
    }

    r._lastLoaded = oldResource._lastLoaded;
    if (r.prefetch) r.reload();
    this.resources[key] = r;
  }

  cancelAll() {
    Object.keys(this.resources).forEach(r => {
      this.resources[r].cancel();
    });
  }

}

var mixin = ((config = {}) => ({
  beforeCreate() {
    const options = this.$options;

    let _chimera; // Stop if instance doesn't have chimera or already initialized


    if (!options.chimera || options._chimera) return;

    if (typeof options.chimera === 'function') {
      // Initialize with function
      options.chimera = options.chimera.call(this);
    }

    if (options.chimera instanceof VueChimera) {
      _chimera = options.chimera;
    } else if (isPlainObject(options.chimera)) {
      const _options$chimera = options.chimera,
            {
        $options
      } = _options$chimera,
            resources = _objectWithoutProperties(_options$chimera, ["$options"]);

      _chimera = new VueChimera(this, resources, _objectSpread({}, config, $options));
    }

    options.computed = options.computed || {};
    options.watch = options.watch || {}; // Nuxtjs prefetch

    const NUXT = typeof process !== 'undefined' && process.server && this.$ssrContext ? this.$ssrContext.nuxt : typeof window !== 'undefined' ? window.__NUXT__ : null;

    if (_chimera && NUXT && NUXT.chimera) {
      try {
        if (this.$router) {
          let matched = this.$router.match(this.$router.currentRoute.fullPath);
          (matched ? matched.matched : []).forEach((m, i) => {
            let nuxtChimera = NUXT.chimera[i];

            if (nuxtChimera) {
              Object.keys(_chimera.resources).forEach(key => {
                let localResource = _chimera.resources[key];
                let ssrResource = nuxtChimera[key];

                if (localResource && ssrResource && ssrResource._data) {
                  ['_data', '_status', '_headers', 'ssrPrefetched', '_lastLoaded'].forEach(key => {
                    localResource[key] = ssrResource[key];
                  });
                }
              });
            }
          }); // if (process.client) {
          //   delete NUXT.chimera
          // }
        }
      } catch (e) {}
    }

    this._chimera = _chimera;
  },

  data() {
    if (this._chimera) {
      return {
        $chimera: this._chimera.resources
      };
    }

    return {};
  },

  mounted() {
    if (this._chimera) {
      this._chimera.updateReactiveResources();

      for (let r in this._chimera.resources) {
        let resource = this._chimera.resources[r];

        if (resource.prefetch && (!resource.ssrPrefetched || resource.ssrPrefetch === 'override')) {
          resource.reload();
        }
      }
    }
  },

  beforeDestroy() {
    if (!this._chimera) {
      return;
    }

    this._chimera.cancelAll();

    this._chimera = null;
    delete this._chimera;
  }

}));

function NuxtPlugin () {
  this.options = this.options || {};
  const baseOptions = this.options;
  return function ({
    beforeNuxtRender,
    isDev,
    $axios
  }) {
    if (!beforeNuxtRender) {
      return;
    }

    const cancelTokens = [];

    async function prefetchAsyncData({
      Components,
      nuxtState
    }) {
      nuxtState.chimera = nuxtState.chimera || {};

      for (let i = 0, len = Components.length; i < len; i++) {
        let component = Components[i];
        let chimera = component.options ? component.options.chimera : null;

        if (typeof chimera === 'function') {
          // Append @Nuxtjs/axios to component (maybe needed by constructor)
          if ($axios && !component.$axios) component.$axios = $axios;
          chimera = chimera.bind(component)();
        }

        if (!chimera) {
          continue;
        }

        const nuxtChimera = {};

        const {
          $options
        } = chimera,
              resources = _objectWithoutProperties(chimera, ["$options"]);

        const options = Object.assign({}, baseOptions, $options);
        if (!options.axios) options.axios = $axios;

        for (let key in resources) {
          let resource = resources[key];

          if (resource && typeof resource !== 'function') {
            resource = resource && resource._data ? resource : Resource.from(resource, options);
            cancelTokens.push(resource.cancel.bind(resource));
            if (!resource.prefetch || !resource.ssrPrefetch) continue;

            try {
              isDev && console.log('  Prefetching: ' + resource.requestConfig.url); // eslint-disable-line no-console

              let response = await resource.execute();
              resource._data = response.data;
            } catch (err) {
              isDev && console.error(err.message); // eslint-disable-line no-console
            }

            resource.ssrPrefetched = true;
            resources[key] = nuxtChimera[key] = resource;
          }
        }

        if (Object.keys(nuxtChimera).length) {
          nuxtState.chimera[i] = nuxtChimera;
        }
      }
    }

    beforeNuxtRender((...args) => {
      return new Promise((resolve, reject) => {
        prefetchAsyncData(...args).then(resolve).catch(reject);
        setTimeout(reject, baseOptions.ssrPrefetchTimeout, new Error('  SSR Prefetch Timeout.'));
      }).catch(err => {
        for (let cancel of cancelTokens) if (typeof cancel === 'function') cancel();

        isDev && console.error(err.message); // eslint-disable-line no-console
      });
    });
  };
}

const plugin = {
  options: {
    axios: null,
    cache: null,
    debounce: 80,
    prefetch: 'get',
    // false, true, '%METHOD%',
    ssrPrefetch: true,
    ssrPrefetchTimeout: 4000,
    transformer: null,
    headers: null
  },

  install(Vue, options = {}) {
    Object.keys(options).forEach(key => {
      if (key in this.options) {
        this.options[key] = options[key];
      }
    });

    if (!Vue.prototype.hasOwnProperty('$chimera')) {
      Object.defineProperty(Vue.prototype, '$chimera', {
        get() {
          if (this._chimera) {
            return this._chimera.resources;
          }

          return null;
        }

      });
    }

    Vue.mixin(mixin(this.options));
  },

  NuxtPlugin // Auto-install

};
let GlobalVue = null;

if (typeof window !== 'undefined') {
  GlobalVue = window.Vue;
} else if (typeof global !== 'undefined') {
  GlobalVue = global.Vue;
}

if (GlobalVue) {
  GlobalVue.use(plugin, plugin.options);
}

module.exports = plugin;
