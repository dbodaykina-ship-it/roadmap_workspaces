/*
 * dc-lite.js — минимальный рантайм для артбордов .dc.html вне Claude.
 *
 * Понимает то, что используется в прототипе вотчлиста:
 *   {{ path }} в тексте и атрибутах, !, ===, !==, ==, !=, литералы;
 *   <sc-for list as>, <sc-if value>;
 *   onClick / onKeyDown и другие события, ref, style-строки;
 *   класс логики `class Component extends DCLogic` с state / setState,
 *   componentDidMount / componentDidUpdate / componentWillUnmount.
 *
 * Работает поверх React 18 (assets/react*.production.min.js).
 * Мусор вроде hint-* атрибутов и стриминга не поддерживается — он не нужен
 * для уже готового артборда.
 */
(function () {
  'use strict';
  var React = window.React;
  var ReactDOM = window.ReactDOM;
  var h = React.createElement;
  var Fragment = React.Fragment;

  var CAMEL = 'sc-camel-';
  var RAW = { select: 'sc-raw-select', table: 'sc-raw-table', tbody: 'sc-raw-tbody', thead: 'sc-raw-thead', tfoot: 'sc-raw-tfoot', tr: 'sc-raw-tr', td: 'sc-raw-td', th: 'sc-raw-th', caption: 'sc-raw-caption' };
  var UNRAW = {};
  Object.keys(RAW).forEach(function (k) { UNRAW[RAW[k]] = k; });
  var BOOL = new Set('allowFullScreen async autoFocus autoPlay checked controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden itemScope loop multiple muted noModule noValidate open playsInline readOnly required reversed scoped seamless selected'.split(' '));
  var EVT = {
    onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onsubmit: 'onSubmit',
    onkeydown: 'onKeyDown', onkeyup: 'onKeyUp', onkeypress: 'onKeyPress',
    onmousedown: 'onMouseDown', onmouseup: 'onMouseUp', onmouseenter: 'onMouseEnter', onmouseleave: 'onMouseLeave',
    onmousemove: 'onMouseMove', onmouseover: 'onMouseOver', onmouseout: 'onMouseOut',
    onfocus: 'onFocus', onblur: 'onBlur', ondoubleclick: 'onDoubleClick', ondblclick: 'onDoubleClick', oncontextmenu: 'onContextMenu',
    onpointerdown: 'onPointerDown', onpointerup: 'onPointerUp', onpointermove: 'onPointerMove',
    onpointerenter: 'onPointerEnter', onpointerleave: 'onPointerLeave', onpointercancel: 'onPointerCancel',
    onpointerover: 'onPointerOver', onpointerout: 'onPointerOut', onwheel: 'onWheel', onscroll: 'onScroll'
  };

  function camelize(s) { return s.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); }); }

  /* ---------- выражения в {{ }} ---------- */
  var NUM = /^-?\d+(\.\d+)?$/;
  function lookup(scope, path) {
    var cur = scope, parts = path.split('.');
    for (var i = 0; i < parts.length; i++) { if (cur == null) return undefined; cur = cur[parts[i]]; }
    return cur;
  }
  function wrapped(e) {
    var d = 0;
    for (var i = 0; i < e.length - 1; i++) {
      if (e[i] === '(') d++;
      else if (e[i] === ')') { d--; if (d === 0) return false; }
    }
    return true;
  }
  function findOp(e) {
    var d = 0, q = null, ops = ['===', '!==', '==', '!='];
    for (var i = 0; i < e.length; i++) {
      var c = e[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '(') d++;
      else if (c === ')') d--;
      else if (d === 0) {
        for (var k = 0; k < ops.length; k++) if (e.startsWith(ops[k], i)) return { index: i, op: ops[k] };
      }
    }
    return null;
  }
  function evaluate(scope, expr) {
    var e = String(expr).trim();
    if (!e) return undefined;
    if (e[0] === '(' && e[e.length - 1] === ')' && wrapped(e)) return evaluate(scope, e.slice(1, -1));
    var op = findOp(e);
    if (op) {
      var a = evaluate(scope, e.slice(0, op.index)), b = evaluate(scope, e.slice(op.index + op.op.length));
      switch (op.op) { case '===': return a === b; case '!==': return a !== b; case '==': return a == b; default: return a != b; }
    }
    if (e[0] === '!') return !evaluate(scope, e.slice(1));
    if (e === 'true') return true;
    if (e === 'false') return false;
    if (e === 'null') return null;
    if (e === 'undefined') return undefined;
    if (NUM.test(e)) return Number(e);
    if (e.length >= 2 && (e[0] === '"' || e[0] === "'") && e[e.length - 1] === e[0]) return e.slice(1, -1);
    return lookup(scope, e);
  }
  var HOLE = /\{\{([\s\S]+?)\}\}/g;
  function getter(text) {
    var m = text.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
    if (m) { var ex = m[1]; return function (s) { return evaluate(s, ex); }; }
    if (text.indexOf('{{') >= 0) {
      var parts = text.split(HOLE);
      return function (s) {
        return parts.map(function (p, i) { if (!(i & 1)) return p; var v = evaluate(s, p); return v == null ? '' : v; }).join('');
      };
    }
    return function () { return text; };
  }

  /* ---------- разбор шаблона ---------- */
  var ATTRS = '(?:=\\s*"[^"]*"|=\\s*\'[^\']*\'|=(?!\\s*["\'])|[^>=])*';
  var TAG_RE = new RegExp('(<!---?>|<!--[\\s\\S]*?--!?>)|(<(script|style|textarea|title)(?=[\\s/>])' + ATTRS + '>)([\\s\\S]*?<\\/\\3(?=[\\s/>])[^>]*>)|<[a-zA-Z][^\\s/>]*(?=[\\s/>])' + ATTRS + '>', 'gi');
  var CAMEL_ATTR = /=\s*"[^"]*"|=\s*'[^']*'|(\s)([a-z]+[A-Z][A-Za-z0-9]*)(?=\s*=)/g;
  function keepCamel(src) {
    var fix = function (tag) {
      return tag.replace(CAMEL_ATTR, function (all, sp, name) {
        return name === undefined ? all : sp + CAMEL + name.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
      });
    };
    return src.replace(TAG_RE, function (all, comment, rawOpen, rawTag, rawRest) {
      if (comment !== undefined) return all;
      if (rawOpen) return fix(rawOpen) + rawRest;
      return fix(all);
    });
  }
  function prepare(src) {
    src = src.replace(/<(x-import|dc-import)((?:\s[^>]*?)?)\/>/gi, '<$1$2></$1>');
    src = src.replace(/<helmet(\s|>)/gi, '<sc-helmet$1').replace(/<\/helmet\s*>/gi, '</sc-helmet>');
    src = keepCamel(src);
    Object.keys(RAW).forEach(function (k) { src = src.replace(new RegExp('(</?)' + k + '(?=[\\s>])', 'gi'), '$1' + RAW[k]); });
    return src;
  }

  var warned = new Set();
  function warnOnce(msg) { if (!warned.has(msg)) { warned.add(msg); console.warn('[dc-lite] ' + msg); } }

  function compileChildren(node) {
    var out = [];
    node.childNodes.forEach(function (c) { var f = compileNode(c); if (f) out.push(f); });
    return out;
  }
  function renderAll(list, scope, host) { return list.map(function (f, i) { return f(scope, host, i); }); }

  function compileNode(n) {
    if (n.nodeType === 3) return compileText(n);
    if (n.nodeType !== 1) return null;
    var tag = n.tagName.toLowerCase();
    if (tag === 'sc-for') return compileFor(n);
    if (tag === 'sc-if') return compileIf(n);
    if (tag === 'sc-helmet') return null;
    if (tag === 'dc-import' || tag === 'x-import') { warnOnce('<' + tag + '> не поддерживается'); return null; }
    return compileEl(n);
  }

  function compileText(n) {
    var text = n.nodeValue || '';
    if (text.indexOf('{{') < 0) {
      if (!text.trim() && text.indexOf(' ') < 0) return null;
      return function () { return text; };
    }
    var parts = text.split(HOLE);
    return function (scope, host, key) {
      return h.apply(null, [Fragment, { key: key }].concat(parts.map(function (p, i) {
        if (!(i & 1)) return p;
        var v = evaluate(scope, p);
        if (v === undefined) { warnOnce('{{ ' + p.trim() + ' }} не найдено — пусто'); return null; }
        if (React.isValidElement(v) || Array.isArray(v)) return h(Fragment, { key: i }, v);
        if (v === null || typeof v === 'boolean') return null;
        return h('span', { key: i, className: 'sc-interp' }, String(v));
      })));
    };
  }

  function compileFor(n) {
    var src = n.getAttribute('list') || '';
    var list = getter(src), as = n.getAttribute('as') || 'item', kids = compileChildren(n);
    return function (scope, host, key) {
      var arr = list(scope);
      if (!Array.isArray(arr)) { if (arr != null) warnOnce('sc-for list="' + src + '" — не массив'); arr = []; }
      return h(Fragment, { key: key }, arr.map(function (item, i) {
        var s = Object.assign({}, scope); s[as] = item; s.$index = i;
        return h(Fragment, { key: i }, renderAll(kids, s, host));
      }));
    };
  }

  function compileIf(n) {
    var cond = getter(n.getAttribute('value') || ''), kids = compileChildren(n);
    return function (scope, host, key) {
      return cond(scope) ? h(Fragment, { key: key }, renderAll(kids, scope, host)) : null;
    };
  }

  function lru(map, limit, key, make) {
    var v = map.get(key);
    if (!v) { if (map.size >= limit) map.delete(map.keys().next().value); v = make(); map.set(key, v); }
    return v;
  }
  function assignRef(ref, el) { if (typeof ref === 'function') ref(el); else if (ref) ref.current = el; }

  function compileEl(n) {
    var tag = UNRAW[n.localName] || n.localName;
    var id = n.getAttribute('data-dc-tpl');
    var props = [];
    Array.prototype.forEach.call(n.attributes, function (a) {
      var d = a.name, v = a.value;
      if (d === 'data-dc-tpl' || d === 'sc-name') return;
      if (d.indexOf(CAMEL) === 0) d = camelize(d.slice(CAMEL.length));
      if (d === 'hint-size' || d.indexOf('hint-') === 0) return;
      if (d.indexOf('style-') === 0) { warnOnce('атрибут ' + d + ' не поддерживается'); return; }
      if (d === 'class') d = 'className';
      else if (d === 'for') d = 'htmlFor';
      else if (d.indexOf('on') === 0 && d.length > 2) d = EVT[d] || 'on' + d[2].toUpperCase() + d.slice(3);
      else if (v === '' && BOOL.has(d)) { props.push([d, function () { return true; }]); return; }
      props.push([d, getter(v)]);
    });
    var kids = compileChildren(n);
    // style-строку ставим через cssText в ref, как оригинальный рантайм;
    // колбэки кешируются, чтобы React не дёргал ref на каждом рендере
    var plain = new Map(), byRef = new WeakMap();
    function styleRef(css, user) {
      var make = function () { return function (el) { if (el && el.__dcCss !== css) { el.style.cssText = css; el.__dcCss = css; } }; };
      if (user == null || (typeof user !== 'function' && typeof user !== 'object')) return lru(plain, 256, css, make);
      var m = byRef.get(user);
      if (!m) { m = new Map(); byRef.set(user, m); }
      return lru(m, 256, css, function () { var f = make(); return function (el) { f(el); assignRef(user, el); }; });
    }
    return function (scope, host, key) {
      var p = { key: key + '|' + id }, css = null;
      for (var i = 0; i < props.length; i++) {
        var k = props[i][0], v = props[i][1](scope);
        if (k === 'style' && typeof v === 'string') { css = v; continue; }
        if ((k === 'value' || k === 'checked') && v === undefined) v = k === 'checked' ? false : '';
        p[k] = v;
      }
      if (css !== null) p.ref = styleRef(css, p.ref);
      return h.apply(null, [tag, p].concat(renderAll(kids, scope, host)));
    };
  }

  function compileTemplate(src) {
    var t = document.createElement('template');
    t.innerHTML = prepare(src);
    var n = 0;
    (function mark(node) {
      if (node.nodeType === 1) node.setAttribute('data-dc-tpl', String(n++));
      node.childNodes.forEach(mark);
    })(t.content);
    var kids = compileChildren(t.content);
    return function (scope, host) { return renderAll(kids, scope || {}, host); };
  }

  /* ---------- логика ---------- */
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; this.__host = undefined; }
    setState(a, cb) { if (this.__host) this.__host.__setLogicState(a, cb); }
    forceUpdate() { if (this.__host) this.__host.forceUpdate(); }
    componentDidMount() {}
    componentDidUpdate() {}
    componentWillUnmount() {}
    renderVals() { return {}; }
  }

  function loadLogic(src) {
    if (!src || !src.trim()) return DCLogic;
    var C = new Function('DCLogic', 'StreamableLogic', 'React', src + '\n;return (typeof Component!=="undefined"&&Component)||undefined;')(DCLogic, DCLogic, React);
    return C || DCLogic;
  }

  function mount(el, opts) {
    var tpl = compileTemplate(opts.template);
    var Logic = loadLogic(opts.logic);
    var name = opts.name || 'Main';
    class Host extends React.Component {
      constructor(p) {
        super(p);
        this.state = { v: 0 };
        this.logic = new Logic({});
        this.logic.__host = this;
      }
      __setLogicState(a, cb) {
        var s = this.logic.state, u = typeof a === 'function' ? a(s) : a;
        this.logic.state = Object.assign({}, s, u);
        this.setState(function (f) { return { v: f.v + 1 }; }, cb);
      }
      componentDidMount() { try { this.logic.componentDidMount(); } catch (e) { console.error(e); } }
      componentDidUpdate(pp) { try { this.logic.componentDidUpdate(pp); } catch (e) { console.error(e); } }
      componentWillUnmount() { try { this.logic.componentWillUnmount(); } catch (e) { console.error(e); } }
      render() {
        var props = {}, scope = props;
        this.logic.props = props;
        try { scope = Object.assign({}, props, this.logic.renderVals() || {}); } catch (e) { console.error(e); }
        return h.apply(null, ['div', { className: 'sc-host', 'data-sc-name': name }].concat(tpl(scope, this)));
      }
    }
    ReactDOM.createRoot(el).render(h(Host));
  }

  window.DCLite = { mount: mount, DCLogic: DCLogic };
})();
