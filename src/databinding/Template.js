// TODO : Partial rendering

export default (function () {

  var Template = function (node, scope, ctx) {
    ctx = ctx || window;
    node.$$template = {
      node: node.cloneNode(true),
      instance: this,
      ctx: ctx
    };
    this._ctx = ctx;
    this._node = node;
    this._currentPath = "";
    this._render(node, scope);
  };


  Template.NODE_TYPE = {
    ELEMENT: 1,
    ATTR: 2,
    TEXT: 3,
    DOCUMENT_FRAGMENT: 11
  };


  Template.applyChanges = function (template, model, changes) {

    var firstCharCode = null;
    var keysArray = Object.keys(Object(model));
    var changeCount = 0;

    for (var nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex++) {
      var nextKey = keysArray[nextIndex];
      if ((nextKey.toLowerCase().charAt(0) != "_") && (nextKey.toLowerCase().charAt(0) != "$")) {
        changeCount++;
      }
    }

    if (changeCount > 0) {
      template.update(model);
    }
  };


  Template.verySpecials = ["checked", "multiple", "readonly", "disabled"];


  Template.conditions = ["if", "show", "hide"];


  Template.specials = {};

  Template.insertAfter = function(newNode, targetNode) {
    var itemToInsert = newNode;
    var parent = targetNode.parentNode;
    var children = Template.getChildren(parent);
    if(children[children.length-1] == targetNode) {
      parent.appendChild(itemToInsert);
    } else {
      parent.insertBefore(itemToInsert, targetNode.nextSibling);
    }
  };

  Template.addSpecial = function (attrName, mapTo) {
    Template.specials[attrName] = mapTo;
  };


  Template.addSpecials = function (attrs) {
    for (var p in attrs) {
      Template.specials[p] = attrs[p];
    }
  };


  Template.removeSpecial = function (attrName, mapTo) {
    delete Template.specials[attrName];
  };


  Template.executeCode = function (code, scope) {
    return (function (codeToRun) {
      var vars = codeToRun.match(Template.regex.varName);
      var parts;
      vars.forEach(function (vr) {
        codeToRun = codeToRun.replace(vr, Template._getPathValue(scope, vr));
      });
      codeToRun = "'use strict'; return " + codeToRun;
      var tmpFunc = new Function(codeToRun); // jshint ignore:line
      return tmpFunc.apply({});
    })(code);
  };


  Template.escapeHtml = function (str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  };


  // UNSAFE with unsafe strings; only use on previously-escaped ones!
  Template.unescapeHtml = function (escapedStr) {
    var div = document.createElement('div');
    div.innerHTML = escapedStr;
    var child = div.childNodes[0];
    return child ? child.nodeValue : '';
  };


  Template.regex = {
    varName: /[a-zA-Z_$]+[0-9a-zA-Z_$]*(.[a-zA-Z_$]+[0-9a-zA-Z_$])*/g,
    sequence: null,
    token: /\{\{\s*\$?[\w]+\.?[\w]*\s*\}\}/g,
    tokenName: /\w+/,
    paramName: /\$?[\w]+\s*\.?[\w]*/,
    expression: null,
    escape: /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g,
    trim: /^[\s+]+|[\s+]+$/g,
    repeat: /\{\{\s*([\w]+)\s*in\s*([\w]+\.?[\w]*)\s*\}\}/,
    func: /(.*)\((.*)\)/,
    params: /,\s+|,|\s+,\s+/,
    quote: /\"|\'/g,
    content: /[^.|^\s]/gm,
    depth: /..\//g,
    string: /^(\"|\')(.*)(\"|\')$/
  };


  Template._getPathValue = function (obj, path) {

    var parts = path.split(".");
    var res = obj;

    if (parts.length == 1) {
      if (typeof obj[path] !== undefined) {
        res = obj[path];
      }
    } else {
      for (var i = 0; i < parts.length; i++) {
        res = res[parts[i]];
        if (res === undefined) {
          res = obj;
          break;
        }
      }
    }

    return res;
  };

  Template.getChildren = function(list) {
    var children = Array.prototype.slice.call(list.childNodes);
    return children.filter(function(node) {
      if((node.nodeType == Template.NODE_TYPE.TEXT) && (node.textContent.trim() === "")) {
        return false;
      }
      return true;
    });
  };


  Template.create = function (node, model, ctx) {

    if (!node.$$template) {
      return new Template(node, model, ctx);
    } else {
      var parent = node.parentNode;
      var oldNode = node;
      var instance = node.$$template.instance;
      node = node.$$template.node;
      node.$$template = {
        node: node.cloneNode(true),
        instance: instance,
        ctx: ctx
      };
      node.$$template.instance._removeListeners.call(node.$$template.instance);
      node.$$template.instance._render.call(node.$$template.instance, node, model);
      parent.replaceChild(node, oldNode);
      return instance;
    }
  };


  Template.prototype = {

    _currentPath: null,

    _node: null,

    _listeners: [],

    _modelListeners: {},

    _onModelChange: function (changes) {
      var that = this;
      changes.forEach(function (change) {
        var listeners = that._modelListeners[change.name];
        if (listeners) {
          listeners.forEach(function (listener) {
            listener.callback(that, change);
          });
        }
      });
    },

    dispose: function () {
      this._removeListeners();
      var node = this._node;
      var parent = node.parentNode;
      parent.replaceChild(this._node.$$template.node, node);
      delete this._node.$$template;
    },

    update: function (model) {
      var node = this._node;
      var parent = node.parentNode;
      var oldNode = node;
      var instance = node.$$template.instance;
      this._node = node = node.$$template.node;
      node.$$template = {
        node: node.cloneNode(true),
        instance: instance
      };
      node.$$template.instance._removeListeners.call(node.$$template.instance);
      node.$$template.instance._render.call(node.$$template.instance, node, model);
      parent.replaceChild(node, oldNode);
      return instance;
    },

    _removeListeners: function () {
      this._listeners.forEach(function (registered) {
        registered.node.removeEventListener(registered.eventName, registered.listener, false);
      });
      this._listeners = [];
    },


    _isEventSupported: function (target, eventName) {
      eventName = 'on' + eventName;
      var isSupported = (eventName in target);
      if (!isSupported) {
        target.setAttribute(eventName, 'return;');
        isSupported = typeof target[eventName] == 'function';
        target.removeAttribute(eventName);
      }
      return isSupported;
    },


    _getExpressions: function (value) {
      var expressions = [];
      var test = value.match(Template.regex.token) || [];
      test.forEach(function (match) {
        expressions.push({
          templExp: match.trim(),
          paramName: (match.match(Template.regex.paramName)[0]).trim()
        });
      }.bind(this));

      return expressions;
    },


    _parseRepeatExpression: function (value) {
      var expression = null;
      var test = value.match(Template.regex.repeat);
      if (test) {
        expression = {
          paramName: (test[1]).trim(),
          expr: (test[2]).trim()
        };
      }
      return expression;
    },


    _renderTextNode: function (node, scope) {
      node.textContent = this._renderText(node.textContent, scope);
    },


    _renderText: function (text, scope) {
      if (text.length > 0) {
        var expressions = this._getExpressions(text);
        expressions.forEach(function (expression) {
          text = text.replace(expression.templExp, Template._getPathValue(scope, expression.paramName));
        }.bind(this));
        return text;
      }
      return "";
    },


    _getParamList: function (scope, funcString) {
      var startPos = funcString.indexOf("(");
      var endPos = funcString.indexOf(")");
      var funcName = funcString.substr(0, startPos);
      var params = funcString.substr(startPos + 1, endPos - startPos - 1).trim();
      if (params.length > 0) {
        params = params.split(",").map(function (param) {
          return Template._getPathValue(scope, param.trim());
        }.bind(this));
      } else {
        params = [];
      }
      return {
        funcName: funcString.substr(0, startPos),
        params: params
      };
    },


    _callFunction: function (funcString, args) {
      return (function () {
        var ref = this;
        var parts = funcString.split(".");
        for (var i = 0; i < parts.length; i++) {
          if (ref[parts[i]] !== undefined) {
            ref = ref[parts[i]];
          } else {
            throw "The function " + funcString + " is not defined";
          }
        }
        return function (e) {
          args.push(e);
          ref.apply(this, args);
        };
      }.bind(this._ctx))();

    },


    _renderAttributeNode: function (refNode, node, scope) {

      var attrValue = node.value;
      var nodeName = this._renderText(node.name, scope);
      var removedAttr = false;

      var parts = node.name.split("-");

      if ((parts.length == 2) && this._isEventSupported(refNode, parts[1])) {

        var eventName = parts[1];
        var callback = attrValue;
        refNode.removeAttribute(node.name);

        var funcCall = this._getParamList(scope, callback);
        callback = this._callFunction(funcCall.funcName, funcCall.params);
        this._listeners.push({
          node: refNode,
          eventName: eventName,
          listener: callback
        });

        refNode.addEventListener(eventName, callback, false);

      } else {

        if ((parts.length == 2) && (Template.conditions.indexOf(parts[1]) != -1)) {

          var newstr = attrValue.replace(/{/g, "").replace(/}/g, "");
          removedAttr = true;

          var conditionValue = Template.executeCode(newstr, scope);

          // PathObserver

          switch (node.name) {

          case "data-if":
            if (conditionValue === true) {

            }
            break;
          case "data-show":
            break;

          case "data-hide":
            break;

          }

        } else {
          var expressions = this._getExpressions(attrValue);
          if (expressions.length) {
            expressions.forEach(function (expression) {
              attrValue = attrValue.replace(expression.templExp, Template._getPathValue(scope, expression.paramName));
            }.bind(this));
          }
        }
      }

      node.value = attrValue;

      if (Template.specials[node.name]) {
        refNode.setAttribute(Template.specials[node.name], attrValue);
        removedAttr = true;
      }

      if (nodeName != node.name) {
        refNode.setAttribute(nodeName, attrValue);
        removedAttr = true;
      }

      if (Template.verySpecials.indexOf(nodeName) != -1) {
        if (attrValue != "true") {
          removedAttr = true;
        }
      }

      if (removedAttr) {
        refNode.removeAttribute(node.name);
      }

    },


    _renderAttributes: function (node, scope) {
      var attrs = node.attributes;
      if (attrs && attrs.length > 0) {
        attrs = Array.prototype.slice.call(attrs);
        attrs.forEach(function (attr) {
          this._renderAttributeNode(node, attr, scope);
        }.bind(this));
      }
    },


    _buildSubScope: function (data, repeatExpression, index) {
      var subScope = {};
      subScope[repeatExpression.paramName] = data[index];
      subScope.$index = index;
      subScope.$key = repeatExpression.paramName;
      return subScope;
    },




    _updateList: function (listNode, changes) {

      var index;
      var children;
      var node;
      var repeatData = listNode.$$repeatData;

      console.log(changes);

      changes.forEach(function (change) {

        switch (change.type) {

          case "add":
            index = parseInt(change.name, 10);
            if (index >= 0) {
              node = repeatData.itemTemplate.cloneNode(true);
              this._render(node,  this._buildSubScope(repeatData.data, repeatData.expr, index));
              if(index > 0) {
                Template.insertAfter(node, Template.getChildren(listNode)[index-1]);
              } else {
                listNode.appendChild(node);
              }
            }
          break;

          case "delete":
            index = parseInt(change.name, 10);
            if (index >= 0) {
              var toRemove = Template.getChildren(listNode)[index];
              toRemove.parentNode.removeChild(toRemove);
            }
          break;

          case "update":
            index = parseInt(change.name, 10);
            if (index >= 0) {
              node = repeatData.itemTemplate.cloneNode(true);
              this._render(node,  this._buildSubScope(repeatData.data, repeatData.expr, index));
              var toReplace = Template.getChildren(listNode)[index];
              toReplace.parentNode.replaceChild(node, toReplace);
            }
          break;

        }

      }, this);

    },


    _render : function (node, scope) {

      if (node.hasAttribute && node.hasAttribute("data-bind")) {
        scopeName = node.getAttribute("data-bind");
        node.removeAttribute("data-bind");
        scope = scope[scopeName];
        this._currentPath += "." + scopeName;
      }

      var repeatAttr = null;
      var children;

      if (node.hasAttribute && node.hasAttribute("data-repeat")) {
        repeatAttr = node.getAttribute("data-repeat");
        node.removeAttribute("data-repeat");
      }

      this._renderAttributes(node, scope);

      if (repeatAttr) {

        var repeatExpression = this._parseRepeatExpression(repeatAttr);

        var data = Template._getPathValue(scope, repeatExpression.expr);

        // Observe the list Model to update the dom when changes happen
        Object.observe(data, this._updateList.bind(this, node));

        this._currentPath += "." + repeatExpression.expr;

        if (data === undefined) {
          console.error(repeatExpression.expr + " does'nt exists on " + scope);
          return;
        }
        var l = data.length;
        var fragments = [];

        children = Array.prototype.slice.call(node.childNodes);

        var fragment = document.createDocumentFragment();
        children.forEach(function (child) {
          fragment.appendChild(child);
        });

        node.$$repeatData = {
          itemTemplate: fragment.cloneNode(true),
          data: data,
          expr: repeatExpression
        };

        for (var i = 0; i < l; i++) {
          var subScope = null;
          fragments.push(fragment.cloneNode(true));
        }

        var listFragment = document.createDocumentFragment();

        fragments.forEach(function (fragment, index) {
          this._render(fragment, this._buildSubScope(data, repeatExpression, index));
          listFragment.appendChild(fragment);
        }.bind(this));

        node.appendChild(listFragment);

      } else {

        children = Array.prototype.slice.call(node.childNodes);

        children.forEach(function (child) {
          if (child.nodeType == Template.NODE_TYPE.TEXT) {
            this._renderTextNode(child, scope);
          } else if (child.nodeType == Template.NODE_TYPE.ELEMENT) {
            this._renderAttributes(child, scope);
            this._render(child, scope);
          }
        }.bind(this));

      }
    }
  };

  Template.addSpecials({
    "_src": "src",
    "_href": "href",
    "_style": "style",
    "_checked": "checked",
    "_disabled": "disabled",
    "_readonly": "readonly",
    "_multiple": "multiple"
  });

  return {

    addSpecial: Template.addSpecial,
    addSpecials: Template.addSpecials,
    removeSpecial: Template.removeSpecial,

    template: function (model, ctx) {
      var template = Template.create(this[0], model, ctx);
      //Object.observe(model, Template.applyChanges.bind(this, template, model));
      Object.observe(model, template._onModelChange.bind(template));
      return template;
    }

  };

})();
