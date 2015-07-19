import testEnv from "test/Setup";
import Collection from "src/core/Collection";



export default (function () {

  describe('core:Collection', function () {

    testEnv.defaultInit();

    it("fromArray", function () {
      var col = Collection.fromArray(["romeo"]);
      assert.isArray(col);
      assert.equal(col.length, 1);
      assert.equal(col.className, "scopeJS");
    });


    it("fromArrayWrongArgument", function () {
      var col = Collection.fromArray("romeo", "carine");
      assert.isArray(col);
      assert.equal(col.length, 0);
      assert.equal(col.className, "scopeJS");
    });


    it("query", function () {

      var el = scope.create("<ul><li id='li1' class='childLI'></li><li id='li2' class='childLI'></li><li id='li3' class='childLI'></li><li id='li4' class='childLI'></li></ul>");
      el.appendTo(testEnv.sandbox);

      var col = Collection.query(".childLI");
      assert.isArray(col);
      assert.equal(col.length, 4);
      assert.equal(col.className, "scopeJS");

      col = Collection.query("#li1");
      assert.isArray(col);
      assert.equal(col.length, 1);
      assert.equal(col.className, "scopeJS");

      col = Collection.query("#doesNotExists");
      assert.isArray(col);
      assert.equal(col.length, 0);
      assert.equal(col.className, "scopeJS");

      col = Collection.query("#li1, #li2");
      assert.isArray(col);
      assert.equal(col.length, 2);
      assert.equal(col.className, "scopeJS");

      col = Collection.query("#li1, .childLI");
      assert.isArray(col);
      assert.equal(col.length, 4);
      assert.equal(col.className, "scopeJS");

    });


    it("create", function () {

      var el = Collection.create("<ul><li id='li1' class='childLI'></li><li id='li2' class='childLI'></li><li id='li3' class='childLI'></li><li id='li4' class='childLI'></li></ul>");
      assert.equal(el.getChildren().length, 4);

      el = Collection.create([]);
      assert.equal(el.getChildren().length, 0);

      var ul = Collection.create(Collection.create("<ul></ul>"));
      assert.equal(ul.length, 1);
      assert.equal(ul.className, "scopeJS");
      assert.equal(ul[0].tagName.toLowerCase(), "ul");

    });


    it("addModule", function () {
      Collection.addModule({testModule : function() { }});
      assert.isDefined(Collection.fromArray([]).testModule);
    });


    it("addStaticModule", function () {
      Collection.addStaticModule({testModule : function() { }});
      assert.isDefined(Collection.testModule);
    });


    it("addModuleOverride", function () {
      Collection.addModule({testModuleToOverride : function() { return "firstModule"; }});
      assert.isDefined(Collection.fromArray([]).testModuleToOverride);
      Collection.addModule({testModuleToOverride : function() { return "seconcModule"; }});
      assert.equal(Collection.fromArray([]).testModuleToOverride(), "firstModule");
      Collection.addModule({testModuleToOverride : function() { return "seconcModule"; }}, true);
      assert.equal(Collection.fromArray([]).testModuleToOverride(), "seconcModule");
    });


    it("addStaticModuleOverride", function () {
      Collection.addStaticModule({testModuleToOverride : function() { return "firstModule"; }});
      assert.isDefined(Collection.testModuleToOverride);
      Collection.addStaticModule({testModuleToOverride : function() { return "seconcModule"; }});
      assert.equal(Collection.testModuleToOverride(), "firstModule");
      Collection.addStaticModule({testModuleToOverride : function() { return "seconcModule"; }}, true);
      assert.equal(Collection.testModuleToOverride(), "seconcModule");
    });


  });

})();
