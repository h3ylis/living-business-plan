require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const auth = require('./lib/auth');
const notify = require('./lib/notify');

const app = express();
const PORT = process.env.PORT || 8800;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'static')));
app.get('/mockup', (req, res) => res.sendFile(path.join(__dirname, 'mockup.html')));
app.use(auth);

// Minimal template engine
const templateCache = {};

function loadTemplate(name) {
  if (templateCache[name] && process.env.NODE_ENV !== 'development') return templateCache[name];
  const filePath = path.join(__dirname, 'views', name);
  templateCache[name] = fs.readFileSync(filePath, 'utf8');
  return templateCache[name];
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function findBlock(html, openTag, closeTag, startPos) {
  let depth = 1;
  let pos = startPos;
  while (depth > 0 && pos < html.length) {
    const nextOpen = html.indexOf(openTag, pos);
    const nextClose = html.indexOf(closeTag, pos);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) return { body: html.substring(startPos, nextClose), end: nextClose + closeTag.length };
      pos = nextClose + closeTag.length;
    }
  }
  return null;
}

function render(template, data) {
  let html = template;

  // {{> partial}} (partials) — expand BEFORE loops so nested #each inside partials get processed
  html = html.replace(/\{\{>\s*(\w+)\s*\}\}/g, (_, name) => {
    const partial = loadTemplate(`partials/${name}.html`);
    return partial;
  });

  // {{#each items}} ... {{/each}} — nesting-aware
  const eachRe = /\{\{#each (\w+(?:\.\w+)*)\}\}/g;
  let match;
  while ((match = eachRe.exec(html)) !== null) {
    const key = match[1];
    const blockStart = match.index + match[0].length;
    const found = findBlock(html, '{{#each ', '{{/each}}', blockStart);
    if (!found) continue;
    const arr = key.split('.').reduce((o, k) => o?.[k], data);
    let replacement = '';
    if (Array.isArray(arr) && arr.length > 0) {
      const lastKey = key.split('.').pop();
      const singular = lastKey.endsWith('s') ? lastKey.slice(0, -1) : lastKey;
      replacement = arr.map(item => {
        const itemData = { ...data, ...item, this: item, [singular]: item };
        return render(found.body, itemData);
      }).join('');
    }
    html = html.substring(0, match.index) + replacement + html.substring(found.end);
    eachRe.lastIndex = match.index + replacement.length;
  }

  // {{#if val}} ... {{else}} ... {{/if}} — nesting-aware
  const ifRe = /\{\{#if (\w+(?:\.\w+)*)\}\}/g;
  while ((match = ifRe.exec(html)) !== null) {
    const key = match[1];
    const blockStart = match.index + match[0].length;
    const found = findBlock(html, '{{#if ', '{{/if}}', blockStart);
    if (!found) continue;
    const val = key.split('.').reduce((o, k) => o?.[k], data);
    const parts = found.body.split('{{else}}');
    const truthy = Array.isArray(val) ? val.length > 0 : !!val;
    const replacement = truthy ? render(parts[0], data) : (parts[1] ? render(parts[1], data) : '');
    html = html.substring(0, match.index) + replacement + html.substring(found.end);
    ifRe.lastIndex = match.index + replacement.length;
  }

  // {{#unless val}} ... {{/unless}}
  const unlessRe = /\{\{#unless (\w+(?:\.\w+)*)\}\}/g;
  while ((match = unlessRe.exec(html)) !== null) {
    const key = match[1];
    const blockStart = match.index + match[0].length;
    const found = findBlock(html, '{{#unless ', '{{/unless}}', blockStart);
    if (!found) continue;
    const val = key.split('.').reduce((o, k) => o?.[k], data);
    const truthy = Array.isArray(val) ? val.length > 0 : !!val;
    const replacement = truthy ? '' : render(found.body, data);
    html = html.substring(0, match.index) + replacement + html.substring(found.end);
    unlessRe.lastIndex = match.index + replacement.length;
  }

  // {{{raw}}} (unescaped)
  html = html.replace(/\{\{\{(\w+(?:\.\w+)*)\}\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o, k) => o?.[k], data);
    return val != null ? String(val) : '';
  });

  // {{#if (eq a b)}} helper
  html = html.replace(/\{\{#if \(eq this\.(\w+) '([^']+)'\)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, cmp, trueBlock, falseBlock) => {
      return data?.this?.[key] === cmp ? render(trueBlock, data) : render(falseBlock, data);
    });
  html = html.replace(/\{\{#if \(eq this\.(\w+) '([^']+)'\)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, cmp, block) => {
      return data?.this?.[key] === cmp ? render(block, data) : '';
    });

  // {{value}} (escaped)
  html = html.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o, k) => o?.[k], data);
    if (val == null) return '';
    return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  });

  return html;
}

function addTimeAgo(items) {
  if (!Array.isArray(items)) return items;
  return items.map(item => ({ ...item, timeAgo: timeAgo(item.created_at || item.changed_at) }));
}

// Override res.render
app.use((req, res, next) => {
  const origRender = res.render;
  res.render = function (viewName, data = {}) {
    data.user = data.user || req.user;

    if (data.entries) data.entries = addTimeAgo(data.entries);
    if (data.recentActivity) data.recentActivity = addTimeAgo(data.recentActivity);
    if (data.history) data.history = addTimeAgo(data.history);

    const content = render(loadTemplate(`${viewName}.html`), data);

    if (data.layout === false) {
      return res.type('html').send(content);
    }

    const layout = loadTemplate('layout.html');
    const page = render(layout, {
      content,
      pageTitle: data.pageTitle || 'Business Plan',
      userName: req.user?.name || '',
      homeActive: data.activeTab === 'home' ? 'active' : '',
      planActive: data.activeTab === 'plan' ? 'active' : ''
    });
    res.type('html').send(page);
  };
  next();
});

// Routes
app.use('/', require('./routes/dashboard'));
app.use('/plan', require('./routes/plan'));
app.use('/thread', require('./routes/thread'));
app.use('/vote', require('./routes/vote'));

notify.init();

app.listen(PORT, () => {
  console.log(`Exec running on http://localhost:${PORT}`);
});
