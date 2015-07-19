import testEnv from "test/Setup";
import Collection from "src/core/Collection";

export default (function () {

  describe('core:Manipulation', function () {

    testEnv.defaultInit();


    it("append", function () {
      var el = scope.create("<ul><li id='li1' class='childLI'></li><li id='li2' class='childLI'></li><li id='li3' class='childLI'></li><li id='li4' class='childLI'></li></ul>");
      testEnv.sandbox.append(el);
      assert.equal(testEnv.sandbox.getChildren().length, 1);
      assert.equal(testEnv.sandbox.getChildren()[0], el[0]);
    });


    it("appendTo", function () {
      var el = scope.create("<ul><li id='li1' class='childLI'></li><li id='li2' class='childLI'></li><li id='li3' class='childLI'></li><li id='li4' class='childLI'></li></ul>");
      el = el.appendTo(testEnv.sandbox);
      assert.equal(testEnv.sandbox.getChildren().length, 1);
      assert.equal(testEnv.sandbox.getChildren()[0], el[0]);
    });


    it("insertBefore", function () {

      var el = scope.create("<ul><li id='li1' class='childLI'></li><li id='li2' class='childLI'></li><li id='li3' class='childLI'></li><li id='li4' class='childLI'></li></ul>");
      el = el.appendTo(testEnv.sandbox);

      var toBeInserted = scope.create("<li id='appendedLI1' class='appendedLI'></li><li id='appendedLI2' class='appendedLI'></li>");
      toBeInserted.insertBefore(el);
      assert(testEnv.sandbox.getChildren().length, 3);

      assert.equal(testEnv.sandbox.getChildren()[0].id, "appendedLI1");

      toBeInserted.remove();

      toBeInserted = scope.create("<li class='appendedLI appendedLI1'></li><li class='appendedLI appendedLI2'></li>");
      toBeInserted.insertBefore(scope('.childLI'));

      assert.equal(el.getChildren().length, 12);
      assert.isTrue(el.getChildren()[0].className.indexOf("appendedLI1") != -1);

    });


    it("insertAfter", function () {

      var el = scope.create("<ul><li id='li1' class='childLI'></li><li id='li2' class='childLI'></li><li id='li3' class='childLI'></li><li id='li4' class='childLI'></li></ul>");
      el = el.appendTo(testEnv.sandbox);

      var toBeInserted = scope.create("<li id='appendedLI1' class='appendedLI'></li><li id='appendedLI2' class='appendedLI'></li>");
      toBeInserted.insertAfter(el);
      assert(testEnv.sandbox.getChildren().length, 3);

      assert.equal(testEnv.sandbox.getChildren()[2].id, "appendedLI2");

      toBeInserted.remove();

      toBeInserted = scope.create("<li class='appendedLI appendedLI1'></li><li class='appendedLI appendedLI2'></li>");
      toBeInserted.insertAfter(scope('.childLI'));

      assert.equal(el.getChildren().length, 12);
      assert.isTrue(el.getChildren()[11].className.indexOf("appendedLI2") != -1);

    });


    it("remove", function () {

    });


    it("empty", function () {

    });


    it("clone", function () {

    });


  });

})();
