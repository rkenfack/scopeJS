var Template = function (node, scope) {
  node.$$template = {
    node: node.cloneNode(true),
    instance: this
  };
  this.original = node.cloneNode(true),
  this.node = node;
  this.render(node, scope);
};


Template.NODE_TYPE = {
  ELEMENT: 1,
  ATTR: 2,
  TEXT: 3
};


Template.specials = {
  "data-src": "src",
  "data-style": "style",
  "data-href": "href"
};


Template.regex = {
  sequence: null,
  token: /\{\{\s*[\w]+\.?[\w]*\s*\}\}/g,
  tokenName: /\w+/,
  paramName: /[\w]+\s*\.?[\w]*/,
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


Template.prototype = {

  node : null,
  original : null,

  _listeners: [],

  dispose : function () {
    this._removeListeners();
    delete this.node.$$template;
  },

  update : function(model) {
    this.render(this.original, model);
  },

  _removeListeners : function() {
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
    var textContent = node.textContent;
    if (textContent.length > 0) {
      var expressions = this._getExpressions(textContent);
      var parts = null;
      expressions.forEach(function (expression) {
        textContent = textContent.replace(expression.templExp, this._getPathValue(scope, expression.paramName));
      }.bind(this));
      node.textContent = textContent;
    }
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
    var expressions = this._getExpressions(attrValue);
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


  render: function (node, scope) {

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
        this.render(fragement, subScope);
        node.appendChild(fragement);
      }.bind(this));

    } else {
      children = Array.prototype.slice.call(node.childNodes);
      children.forEach(function (child) {
        if (child.nodeType == Template.NODE_TYPE.TEXT) {
          this._renderTextNode(child, scope);
        } else if (child.nodeType == Template.NODE_TYPE.ELEMENT) {
          this._renderAttributes(child, scope);
          this.render(child, scope);
        }
      }.bind(this));
    }
  }
};


var template = function (node, model) {

  if (!node.$$template) {
    return new Template(node, model);
  } else {
    var parent = node.parentNode;
    var oldNode = node;
    var instance = node.$$template.instance;
    node = node.$$template.node;
    node.$$template = {
      node : node.cloneNode(true),
      instance : instance
    };
    node.$$template.instance._removeListeners.call(node.$$template.instance);
    node.$$template.instance.render.call(node.$$template.instance, node, model);
    parent.replaceChild(node, oldNode);
    return instance;
  }

};
