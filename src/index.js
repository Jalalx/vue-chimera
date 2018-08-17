import axios from 'axios'
import Vue from 'vue'
import mixin from './mixin'

import Resource from "./Resource";
import NullResource from './NullResource'
import { remove } from './utils'

Vue.config.silent = true
Vue.config.productionTip = false
Vue.config.devtools = false

export class VueChimera {

    static install(Vue, options = {}) {
        Resource.cache = options.cache || 'no-cache'
        Resource.axios = options.axios instanceof axios ? options.axios : axios.create(options.axios || {})
        Vue.mixin(mixin(options))
    }

    constructor(options = {}, context) {

        this._vm = null

        this._listeners = []
        this._context = context
        this._reactiveResources = {}

        const resources = options.resources

        for (let key in resources) {
            let r = resources[key]

            if (typeof r === 'function') {
                resources[key] = new NullResource()
                this._reactiveResources[key] = r.bind(context)
            } else
                resources[key] = Resource.from(r)
        }

        this._initVM(resources)
        this._resources = resources
    }

    _initVM(data) {
        this._vm = new Vue({
            data,
            computed: {
                $loading() {
                    for (let key in this.$data) {
                        if (this.$data[key].loading)
                            return true
                    }
                    return false
                }
            }
        })
        data.$loading = () => this._vm.$loading
        data.$client = () => this._axios
    }

    watch() {
        return this._vm.$watch('$data', () => {
            let i = this._listeners.length
            while (i--) {
                let vm = this._listeners[i]
                if (vm)
                    vm.$nextTick(() => vm.$forceUpdate())
            }
        }, {deep: true})
    }

    subscribe(vm) {
        this._listeners.push(vm)
    }

    unsubscribe(vm) {
        remove(this._listeners, vm)
    }

    updateReactiveResources() {
        for (let key in this._reactiveResources)
            this.updateReactiveResource(key)
    }

    updateReactiveResource(key) {
        this._resources[key] = Resource.from(this._reactiveResources[key](), this._axios)
    }

    get resources() {
        return this._resources
    }
}


// Auto-install
let GlobalVue = null
if (typeof window !== 'undefined') {
    GlobalVue = window.Vue
} else if (typeof global !== 'undefined') {
    GlobalVue = global.Vue
}

if (GlobalVue) {
    GlobalVue.use(VueChimera.install)
}

export default VueChimera.install
