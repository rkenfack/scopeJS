//http://www.html5rocks.com/en/tutorials/tooling/supercharging-your-gruntfile/?redirect_from_locale=de

module.exports = function (grunt) {

  grunt.loadNpmTasks('grunt-shell');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-clean');


  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    shell: {
      build: {
        command: 'jspm bundle-sfx src/App + src/development dist/<%= pkg.name %>.js'
      },
      buildMinify: {
        command: 'jspm bundle-sfx src/App + src/production dist/<%= pkg.name %>-min.js --minify'
      },
      buildTests : {
        command : "jspm bundle-sfx test/Test + test/run test/dist/test.js"
      },
      buildTestsMinify : {
        command : "jspm bundle-sfx test/Test + test/run test/dist/test-min.js --minify"
      }
    },

    jshint: {
      options: {
        esnext : true,
        curly: true,
        browser: true,
        ignores : [
          'src/resources/ObjectObserve.js',
          'src/resources/Soma-template.js',
          'src/polyfill/Promise.js',
          'src/modules/Router.js',
          'src/modules/Http.js',
          'src/modules/Logger.js',
          'src/HTMLParser/HTMLParser.js'
        ]
      },
      src: ['src/**/*.js']
    },

    clean : {
      build : ['dist/**/*'],
      test : ['test/dist/**/*']
    }

  });

  grunt.registerTask('source', ['clean:build', 'jshint', 'shell:build']);
  grunt.registerTask('min', ['clean:build', 'jshint', 'shell:buildMinify']);
  grunt.registerTask('build', ['clean:build', 'jshint', 'shell:build', 'shell:buildMinify']);
  grunt.registerTask('buildTests', ['clean:test', 'shell:buildTests']);
  grunt.registerTask('buildTestsMinify', ['shell:buildTestsMinify']);
}