var Template = function (node, scope) {
  node.$$template = {
    node: node.cloneNode(true),
    instance: this
  };
  this._node = node;
  this._render(node, scope);
};


Template.NODE_TYPE = {
  ELEMENT: 1,
  ATTR: 2,
  TEXT: 3
};

Template.verySpecials = ["checked", "multiple", "readonly", "disabled"];


Template.specials = {};


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


Template.regex = {
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


Template.create = function (node, model) {
  if (!node.$$template) {
    return new Template(node, model);
  } else {
    var parent = node.parentNode;
    var oldNode = node;
    var instance = node.$$template.instance;
    node = node.$$template.node;
    node.$$template = {
      node: node.cloneNode(true),
      instance: instance
    };
    node.$$template.instance._removeListeners.call(node.$$template.instance);
    node.$$template.instance._render.call(node.$$template.instance, node, model);
    parent.replaceChild(node, oldNode);
    return instance;
  }
};


Template.prototype = {

  _node: null,

  _listeners: [],

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


  _getPathValue: function (obj, path) {
    var parts = path.split(".");
    var res = obj;
    if (parts.length == 1) {
      if (typeof obj[path] !== undefined) {
        return obj[path];
      }
    } else {
      for (var i = 0; i < parts.length; i++) {
        res = res[parts[i]];
        if (res === undefined) {
          res = obj;
          break;
        }
      }
      return res;
    }

  },


  _renderTextNode: function (node, scope) {
    node.textContent = this._renderText(node.textContent, scope);
  },


  _renderText: function (text, scope) {
    if (text.length > 0) {
      var expressions = this._getExpressions(text);
      expressions.forEach(function (expression) {
        text = text.replace(expression.templExp, this._getPathValue(scope, expression.paramName));
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
        return this._getPathValue(scope, param.trim());
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
      return function () {
        ref.apply(this, args);
      }
    })();

  },


  _renderAttributeNode: function (refNode, node, scope) {

    var attrValue = node.value;
    var nodeName = this._renderText(node.name, scope);
    var expressions = this._getExpressions(attrValue);
    var removedAttr = false;

    if (expressions.length) {
      expressions.forEach(function (expression) {
        attrValue = attrValue.replace(expression.templExp, this._getPathValue(scope, expression.paramName));
      }.bind(this));
    } else {

      var parts = node.name.split("-");
      if (parts.length == 2) {
        if (this._isEventSupported(refNode, parts[1])) {
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


  _render : function (node, scope) {

    var children;
    if (node.hasAttribute && node.hasAttribute("data-bind")) {
      scopeName = node.getAttribute("data-bind");
      node.removeAttribute("data-bind");
      scope = scope[scopeName];
    }

    var repeatAttr = null;
    if (node.hasAttribute && node.hasAttribute("data-repeat")) {
      repeatAttr = node.getAttribute("data-repeat");
      node.removeAttribute("data-repeat");
    }

    this._renderAttributes(node, scope);

    if (repeatAttr) {

      var repeatExpression = this._parseRepeatExpression(repeatAttr);
      var data = this._getPathValue(scope, repeatExpression.expr);
      if(data === undefined) {
        console.error(repeatExpression.expr+" does'nt exists on "+scope);
        return;
      }
      var l = data.length;
      var fragments = [];
      children = Array.prototype.slice.call(node.childNodes);
      var fragement = document.createDocumentFragment();
      children.forEach(function (child) {
        fragement.appendChild(child);
      });
      fragments.push(fragement);
      for (var i = 1; i < l; i++) {
        var subScope = null;
        fragement = document.createDocumentFragment();
        children.forEach(function (child) {
          fragement.appendChild(child.cloneNode(true));
        });
        fragments.push(fragement);
      }

      fragments.forEach(function (fragement, index) {
        var subScope = {};
        subScope[repeatExpression.paramName] = data[index];
        subScope.$index = index;
        subScope.$key = repeatExpression.paramName;
        this._render(fragement, subScope);
        node.appendChild(fragement);
      }.bind(this));

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
