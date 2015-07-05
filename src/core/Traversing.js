import Collection from "src/core/Collection";

export default {

  find : function(selector) {
    var res = [];
    this.forEach(function (el) {
      res = res.concat(Array.prototype.slice.call(el.querySelectorAll(selector)));
    });
    return Collection.fromArray(res);
  },


  eq : function(index) {
    var res = this[index] ? [this[index]] : [];
    return Collection.fromArray(res);
  },


  getFirst : function() {
    var res = this[0] ? [this[0]] : [];
    return Collection.fromArray(res);
  },


  getLast : function() {
    var res = this[0] ? [this[this.length-1]] : [];
    return Collection.fromArray(res);
  },


  getNext : function(selector) {
    var res = Collection();
    var sibling = null;
    this.forEach(function(item) {
      sibling = item.nextSibling;
      if(sibling) {
        while(item.nextSibling && (sibling.nodeType !== item.nodeType)) {
          sibling = item.nextSibling;
        }
      }
      sibling = sibling ? Collection.fromArray([sibling]) : Collection();
      res = res.concat(sibling.find(selector));
    });
    return res;
  },


  getPrev : function(selector) {
    var res = Collection();
    var sibling = null;
    this.forEach(function(item) {
      sibling = item.previousSibling;
      if(sibling) {
        while(item.previousSibling && (sibling.nodeType !== item.nodeType)) {
          sibling = item.previousSibling;
        }
      }
      sibling = sibling ? Collection.fromArray([sibling]) : Collection();
      res = res.concat(sibling.find(selector));
    });
    return res;
  },


  getChildren : function(selector) {
    var res = Collection();
    var children = null;
    this.forEach(function(item) {
      children = Collection.fromArray(Array.prototype.slice.call(item.childNodes));
      res = res.concat(children.find(selector));
    });
    return res;
  },


  getParents : function(selector) {
    var res = Collection();
    var parent = null;
    this.forEach(function(item) {
      parent = item.parentNode ? Collection.fromArray([item.parentNode]) : Collection();
      res = res.concat(parent.find(selector));
    });
    return res;
  }

};