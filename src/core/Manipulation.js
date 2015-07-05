import Collection from "src/core/Collection";

export default {

  /**
  *
  */
  append : function(toBeAppended) {
    var itemToInsert = null;
    toBeAppended = Collection.query(toBeAppended);
    toBeAppended.forEach(function(itemToAppend) {
      this.forEach(function(item, index) {
        itemToInsert = index === 0 ? itemToAppend : itemToAppend.cloneNode(true);
        item.appendChild(itemToInsert);
      }.bind(this));
    }.bind(this));
    return this;
  },


  /**
  *
  */
  appendTo : function(target) {
    target = Collection.query(target);
    this.forEach(function(item) {
      target.forEach(function(targetItem, index) {
        if(index === 0) {
          targetItem.appendChild(item);
        } else {
          targetItem.appendChild(item.cloneNode(true));
        }
      });
    });
    return this;
  },


  /**
  *
  */
  insertBefore : function(target) {
    target = Collection.query(target);
    this.forEach(function(item) {
      target.forEach(function(targetItem, index) {
        if(index === 0) {
          targetItem.parentNode.insertBefore(item, targetItem);
        } else {
          targetItem.parentNode.insertBefore(item.cloneNode(true), targetItem);
        }
      });
    });
    return this;
  },


  /**
  *
  */
  insertAfter : function(target) {
    var parent = null;
    var itemToInsert = null;
    target = Collection.query(target);
    this.reverse().forEach(function(item) {
      target.forEach(function(targetItem, index) {
        parent = targetItem.parentNode;
        itemToInsert = index === 0 ? item : item.cloneNode(true);
        if(parent.lastchild == targetItem) {
          parent.appendChild(itemToInsert);
        } else {
          parent.insertBefore(itemToInsert, targetItem.nextSibling);
        }
      });
    });
    return this;
  },


  /**
  *
  */
  remove : function() {
    this.forEach(function(item) {
      item.parentNode.removeChild(item);
    });
    return this;
  },

  /**
  *
  */
  empty : function() {
    this.forEach(function(item) {
      item.innerHTML = "";
    });
    return this;
  },

  /**
  *
  */
  clone : function(copyEvents) {
    var clones = Collection.fromArray([]);
    var index = 0;
    var eventParams = null;
    this.forEach(function(item) {
      clones[index] = item.cloneNode(true);
      if(copyEvents === true) {
        for(var eventName in item.$$__listeners) {
          for(var listernerId in item.$$__listeners[eventName]) {
            eventParams = item.$$__listeners[eventName][listernerId];
            Collection.fromArray([clones[index]]).on(eventName, eventParams.listener, eventParams.context, eventParams.useCapture);
          }
        }
      }
      index = clones.length;
    });
    return clones;
  }


};