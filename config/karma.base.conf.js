const { resolve } = require('path')
const webpackConfig = {
    module: {
        rules: [
            {
              test: /\.js$/,
              loader: 'babel-loader',
              exclude: /node_modules/
            },
            {
              test: /\.js/,
              exclude: /node_modules|test|dist/,
              enforce: 'post',
              use: {
                loader: 'istanbul-instrumenter-loader',
                options: { esModules: true }
              }
            }
        ],
    },
    devtool: '#inline-source-map'
}

module.exports = {
    frameworks: ['mocha'],
    files: [
        '../test/unit/index.js'
    ],
    preprocessors: {
        '../test/unit/index.js': ['webpack', 'sourcemap'],
    },
    reporters: ['coverage'],
    coverageReporter: {
      type : 'html',
      dir : '../coverage/'
    },
    webpack: Object.assign({}, webpackConfig),
    webpackMiddleware: {
        noInfo: true
    },
    plugins: [
        'karma-mocha',
        'karma-mocha-reporter',
        'karma-sourcemap-loader',
        'karma-webpack',
        'karma-coverage',
        'istanbul-instrumenter-loader'
    ]
}
