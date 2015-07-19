if (!("dataset" in document.createElement("_"))) {

  Object.defineProperty(HTMLElement.prototype, 'dataset', {

    get: function() {

      var dataset = {},
        attr = this.attributes;
      var copy = {};
      var count = 0;
      var camelcase = null;
      var attrValue = null;

      for (var i = 0; i < attr.length; i++) {
        if (attr[i].name.match(RegExp("^data-(.*)"))) {
          count++;
          var key = RegExp.$1;
          camelcase = utils.camelCase(key);
          attrValue = this.getAttribute(attr[i].name);
          dataset[camelcase] = attrValue;
          if (!this.$$__dataset) {
            copy[camelcase] = attrValue;
          }
        }
      }

      if (!this.$$__oldData) {
        this.$$__oldData = dataset;
      }

      if (!this.$$__dataset) {

        this.$$__dataset = copy;

        this.$$__datasetCallback = function(changes) {

          changes.forEach(function(change) {

            switch (change.type) {
              case "add":
              case "update":
                var name = "";
                for (var p in change.object) {
                  if (p != "$$__observers") {
                    name = "data-" + utils.hyphenate(p);
                    this.setAttribute(name, change.object[p]);
                  }
                }
                break;
              case "delete":
                this.removeAttribute("data-" + utils.hyphenate(change.name));
                break;
            }
          }.bind(this));

        }.bind(this);

        Object.observe(this.$$__dataset, this.$$__datasetCallback);

      } else {

        if (!utils.equals(this.$$__oldData, dataset)) {

          Object.unobserve(this.$$__dataset, this.$$__datasetCallback);

          var changes = Object.changes(this.$$__dataset, dataset);

          for (var added in changes.added) {
            this.$$__dataset[utils.camelCase(added)] = dataset[utils.camelCase(added)];
          }

          for (var removed in changes.removed) {
            delete this.$$__dataset[utils.camelCase(removed)];
          }

          for (var update in changes.update) {
            this.$$__dataset[utils.camelCase(update)] = dataset[utils.camelCase(added)];
          }

          Object.observe(this.$$__dataset, this.$$__datasetCallback);
        }

        this.$$__oldData = dataset;
      }
      if (count === 0) {
        Object.unobserve(this.$$__dataset, this.$$__datasetCallback);
      }
      return this.$$__dataset;
    },

    set: function(value) {},

    enumerable: true,
    configurable: true
  });

}
