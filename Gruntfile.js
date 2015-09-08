//http://www.html5rocks.com/en/tutorials/tooling/supercharging-your-gruntfile/?redirect_from_locale=de

module.exports = function (grunt) {

  grunt.loadNpmTasks('grunt-shell');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-watch');


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
          'src/resources/objectobserve.min.js',
          'src/resources/web-animations-next.min.js',
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
    },

    concat: {
      options: {
        separator: grunt.util.linefeed,
      },
      source: {
        src: ['dist/<%= pkg.name %>.js', 'src/resources/objectobserve.min.js'],
        dest: 'dist/<%= pkg.name %>.js'
      },
      min : {
        src: ['dist/<%= pkg.name %>-min.js', 'src/resources/objectobserve.min.js'],
        dest: 'dist/<%= pkg.name %>-min.js'
      }
    },

    watch: {
      scripts: {
        files: 'src/**/*.js',
        tasks: ['build'],
        options: {
          debounceDelay: 250,
        },
      },
    }

  });

  grunt.registerTask('source', ['clean:build', 'jshint', 'shell:build', 'concat:source']);
  grunt.registerTask('min', ['clean:build', 'jshint', 'shell:buildMinify', 'concat:min']);
  grunt.registerTask('build', ['clean:build', 'jshint', 'shell:build', 'shell:buildMinify', 'concat:source', 'concat:min']);
  grunt.registerTask('buildTests', ['clean:test', 'shell:buildTests']);
  grunt.registerTask('buildTestsMinify', ['shell:buildTestsMinify']);
}