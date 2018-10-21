'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var Axios = _interopDefault(require('axios'));
var pDebounce = _interopDefault(require('p-debounce'));
var Vue = _interopDefault(require('vue'));

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
  if (config instanceof Axios) {
    return config;
  }

  if (config && typeof config.$request === 'function') {
    return config;
  }

  if (isPlainObject(config)) {
    return Axios.create(config);
  }

  if (typeof config === 'function') {
    if (typeof config.request === 'function') return config;
    let axios = config();
    if (axios instanceof Axios) return axios;
  }

  return Axios;
}

class LocalStorageCache {
  constructor(defaultExpiration) {
    if (typeof window === 'undefined' || !window.localStorage) {
      throw Error('LocalStorageCache: Local storage is not available.');
    } else {
      this.storage = window.localStorage;
    }

    this.defaultExpiration = defaultExpiration;
  }
  /**
     *
     * @param key         Key for the cache
     * @param value       Value for cache persistence
     * @param expiration  Expiration time in milliseconds
     */


  setItem(key, value, expiration) {
    this.storage.setItem(key, JSON.stringify({
      expiration: Date.now() + (expiration || this.defaultExpiration),
      value
    }));
  }
  /**
     * If Cache exists return the Parsed Value, If Not returns {null}
     *
     * @param key
     */


  getItem(key) {
    let item = this.storage.getItem(key);
    item = JSON.parse(item);

    if (item && item.value && Date.now() <= item.expiration) {
      return item.value;
    }

    this.removeItem(key);
    return null;
  }

  removeItem(key) {
    this.storage.removeItem(key);
  }

  keys() {
    return Object.keys(this.storage);
  }

  all() {
    return this.keys().reduce((obj, str) => {
      obj[str] = this.storage.getItem(str);
      return obj;
    }, {});
  }

  length() {
    return this.keys().length;
  }

  clearCache() {
    this.storage.clear();
  }

}

class NullCache {
  setItem(key, value, expiration) {}

  getItem(key) {
    return null;
  }

  removeItem(key) {}

  keys() {
    return [];
  }

  all() {
    return {};
  }

  length() {
    return 0;
  }

  clearCache() {}

}

const {
  CancelToken
} = Axios;
const EVENT_SUCCESS = 'success';
const EVENT_ERROR = 'error';
const EVENT_CANCEL = 'cancel';
const EVENT_LOADING = 'loading';
class Resource {
  static from(value, baseOptions = {}) {
    if (value == null) throw new Error('Cannot create resource from `null`');

    if (value instanceof Resource) {
      return value;
    }

    if (typeof value === 'string') {
      return new Resource(value, 'get', baseOptions);
    }

    if (isPlainObject(value)) {
      const {
        url,
        method
      } = value,
            options = _objectWithoutProperties(value, ["url", "method"]);

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
      })
    };
    this.requestConfig[this.requestConfig.method === 'get' ? 'params' : 'data'] = options.params;
    this._loading = false;
    this._status = null;
    this._data = null;
    this._headers = null;
    this._error = null;
    this._lastLoaded = null;
    this._eventListeners = {};
    this.ssrPrefetched = false;
    this.prefetch = typeof options.prefetch === 'string' ? options.prefetch.toLowerCase() === method : Boolean(options.prefetch);
    this.ssrPrefetch = options.ssrPrefetch;
    this.cache = this.getCache(options.cache);
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
    } else {
      this.errorTransformer = err => err;

      this.responseTransformer = res => res;
    } // Set interval.


    if (options.interval) {
      this.setInterval(options.interval);
    }

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

  setInterval(ms) {
    if (typeof process !== 'undefined' && process.server) return;
    this._interval = ms;

    if (this._interval_id) {
      clearInterval(this._interval_id);
    }

    this._interval_id = setInterval(() => this.reload(true), ms);
  }

  on(event, handler) {
    let listeners = this._eventListeners[event] || [];
    listeners.push(handler);
    this._eventListeners[event] = listeners;
    return this;
  }

  emit(event) {
    (this._eventListeners[event] || []).forEach(handler => {
      handler(this);
    });
  }

  fetch(force) {
    return new Promise((resolve, reject) => {
      let setByResponse = res => {
        this._error = null;
        this._loading = false;

        if (res) {
          this._status = res.status;
          this._data = this.responseTransformer(res.data);
          this._headers = res.headers;
          this._lastLoaded = new Date();
        }
      };

      if (this.cache && !force) {
        let cacheValue = this.cache.getItem(this.getCacheKey());

        if (cacheValue) {
          setByResponse(cacheValue);
          resolve(cacheValue);
          return;
        }
      }

      this._loading = true;
      this.emit(EVENT_LOADING);
      this.axios.request(this.requestConfig).then(res => {
        setByResponse(res);
        this.setCache(res);
        this.emit(EVENT_SUCCESS);
        resolve(res);
      }).catch(err => {
        this._data = null;
        this._loading = false;
        const errorResponse = err.response;

        if (errorResponse) {
          this._status = errorResponse.status;
          this._error = this.errorTransformer(errorResponse.data);
          this._headers = errorResponse.headers;
        }

        if (Axios.isCancel(err)) {
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

  send() {
    return this.fetchDebounced(true);
  }

  cancel(unload) {
    if (unload) this._data = null;
    if (typeof this._canceler === 'function') this._canceler();
    this.requestConfig.cancelToken = new CancelToken(c => {
      this._canceler = c;
    });
  }

  stop() {
    this.cancel();
  }

  getCache(cache) {
    const caches = {
      'no-cache': () => new NullCache(),
      'localStorage': () => new LocalStorageCache(this.getConfig().cacheExpiration || 10000)
    };
    cache = cache || 'no-cache';
    return caches[cache] ? caches[cache]() : null;
  }

  getCacheKey() {
    return (typeof window !== 'undefined' && typeof btoa !== 'undefined' ? window.btoa : x => x)(this.requestConfig.url + this.requestConfig.params + this.requestConfig.data + this.requestConfig.method);
  }

  setCache(value) {
    if (this.cache) {
      this.cache.setItem(this.getCacheKey(), value);
    }
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

class VueChimera {
  constructor(vm, resources, options) {
    this._vm = vm;
    this._reactiveResources = {};
    this.options = options || {};
    this._axios = this.options.axios = createAxios(this.options.axios);
    const vmOptions = this._vm.$options;
    vmOptions.computed = vmOptions.computed || {};
    vmOptions.watch = vmOptions.watch || {};
    resources = Object.assign({}, resources);

    for (let key in resources) {
      if (key.charAt(0) === '$') continue;
      let r = resources[key];

      if (typeof r === 'function') {
        r = r.bind(this._vm);
        resources[key] = new NullResource();
        this._reactiveResources[key] = r;
        vmOptions.computed['__' + key] = r;

        vmOptions.watch['__' + key] = t => this.updateReactiveResource(key, t);
      } else {
        resources[key] = Resource.from(r, this.options);
      }

      vmOptions.computed[key] = () => resources[key];
    }

    Object.defineProperty(resources, '$cancelAll', {
      value: this.cancelAll.bind(this)
    });
    Object.defineProperty(resources, '$axios', {
      get: () => this._axios
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
    for (let key in this._reactiveResources) {
      this.updateReactiveResource(key);
    }
  }

  updateReactiveResource(key) {
    let r = this.resources[key] = Resource.from(this._reactiveResources[key](), this.options);
    if (r.prefetch) r.reload();
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
      options.chimera = options.chimera.bind(this)();
    }

    if (options.chimera instanceof VueChimera) {
      _chimera = options.chimera;
    } else if (isPlainObject(options.chimera)) {
      const _options$chimera = options.chimera,
            {
        $options
      } = _options$chimera,
            resources = _objectWithoutProperties(_options$chimera, ["$options"]);

      _chimera = new VueChimera(this, { ...resources
      }, { ...config,
        ...$options
      });
    }

    options.computed = options.computed || {};
    options.watch = options.watch || {}; // Nuxtjs prefetch

    const NUXT = typeof process !== 'undefined' && process.server && this.$ssrContext ? this.$ssrContext.nuxt : typeof window !== 'undefined' ? window.__NUXT__ : null;

    if (_chimera && NUXT && NUXT.chimera) {
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
        });

        if (process.client) {
          delete NUXT.chimera;
        }
      }
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

        for (let key in resources) {
          let resource = resources[key];

          if (resource && typeof resource !== 'function') {
            resource = resource && resource._data ? resource : Resource.from(resource, Object.assign({}, baseOptions, $options));
            cancelTokens.push(resource.cancel.bind(resource));
            if (!resource.prefetch || !resource.ssrPrefetch) continue;

            try {
              isDev && console.log('  Prefetching: ' + resource.requestConfig.url); // eslint-disable-line no-console
              // resource.axios = Axios

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

Vue.config.silent = true;
Vue.config.productionTip = false;
Vue.config.devtools = false;
const plugin = {
  options: {
    axios: null,
    cache: 'no-cache',
    debounce: 80,
    prefetch: 'get',
    // false, true, '%METHOD%',
    ssrPrefetch: true,
    ssrPrefetchTimeout: 4000,
    transformer: null,
    headers: null
  },

  install(Vue$$1, options = {}) {
    Object.keys(options).forEach(key => {
      if (key in this.options) {
        this.options[key] = options[key];
      }
    });

    if (!Vue$$1.prototype.hasOwnProperty('$chimera')) {
      Object.defineProperty(Vue$$1.prototype, '$chimera', {
        get() {
          if (this._chimera) {
            return this._chimera.resources;
          }

          return null;
        }

      });
    }

    Vue$$1.mixin(mixin(this.options));
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
