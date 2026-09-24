(function exposeConsoleUi(globalScope) {
  'use strict';

  function node(tag, text = '', className = '') {
    const item = document.createElement(tag);
    item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function append(parent, ...items) {
    parent.append(...items);
    return parent;
  }

  function link(label, url) {
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) return node('span', label);
    } catch {
      return node('span', label);
    }
    const item = node('a', label);
    item.href = url;
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    return item;
  }

  function title(kicker, text, description) {
    return append(node('div', '', 'view-heading'), node('p', kicker, 'eyebrow'),
      node('h2', text), node('p', description, 'view-note'));
  }

  function metric(value, label, note) {
    return append(node('div', '', 'metric'), node('strong', value),
      node('span', label), node('small', note));
  }

  function table(headers, rows) {
    const wrap = node('div', '', 'table-wrap');
    const tableNode = node('table');
    const header = node('tr');
    headers.forEach(label => header.append(node('th', label)));
    tableNode.append(append(node('thead'), header), append(node('tbody'), ...rows));
    wrap.append(tableNode);
    return wrap;
  }

  function svgNode(tag, attributes = {}) {
    const item = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([name, value]) => item.setAttribute(name, value));
    return item;
  }

  function seriesChart(model, values, years, formatter, label, compact = false) {
    const width = compact ? 112 : 320;
    const height = compact ? 28 : 86;
    const scale = model.chartScale(values, width, height, compact ? 2 : 5);
    const figure = node('div', '', compact ? 'mini-series' : 'trend-chart');
    const svg = svgNode('svg', {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': label
    });
    svg.append(svgNode('line', {
      x1: 0, y1: scale.zeroY, x2: width, y2: scale.zeroY, class: 'axis'
    }));
    if (!compact) {
      const baselineLabel = svgNode('text', {
        x: 4, y: Math.max(9, Math.min(height - 2, scale.zeroY - 3)), class: 'axis-label'
      });
      baselineLabel.textContent = '0';
      svg.append(baselineLabel);
    }
    for (const segment of model.contiguousSegments(scale.points)) {
      if (segment.length > 1) {
        svg.append(svgNode('polyline', {
          points: segment.map(point => `${point.x},${point.y}`).join(' '),
          class: 'series-line'
        }));
      }
      segment.forEach(point => svg.append(svgNode('circle', {
        cx: point.x, cy: point.y, r: compact ? 2 : 3.5, class: 'series-point'
      })));
    }
    svg.append(node('title', label));
    figure.append(svg);
    if (!compact) {
      const labelX = index => values.length > 1
        ? 5 + index * (width - 10) / (values.length - 1)
        : width / 2;
      const yearLabels = node('div', '', 'trend-labels');
      years.forEach((year, index) => {
        const item = node('span', String(year));
        item.style.left = `${labelX(index) / width * 100}%`;
        yearLabels.append(item);
      });
      const valueLabels = node('div', '', 'trend-values');
      values.forEach((value, index) => {
        const item = node('span', value === null ? '—' : formatter(value));
        item.style.left = `${labelX(index) / width * 100}%`;
        valueLabels.append(item);
      });
      figure.append(yearLabels, valueLabels);
    }
    return figure;
  }

  if (globalScope) globalScope.LogPoseUI = {
    node, append, link, title, metric, table, seriesChart
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
