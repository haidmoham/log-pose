'use strict';
// This reproducible layout is a present-day navigation aid over the pinned build.
// It does not determine edge eligibility, historical identity, or relationship strength.
const fs = require('node:fs');
const path = require('node:path');
const graph = require('../api/data/market-field-graph.json');
const count = graph.candidates.length;
// Quantize each integration step so platform math differences cannot compound.
const coordinate = value => Math.round(value * 1000000) / 1000000;
const lengthOf = (x, y) => Math.sqrt(x * x + y * y);
const coordinates = graph.candidates.map(candidate => {
  const seed = Number.parseInt(candidate.id.slice(0, 8), 16) / 4294967296;
  const second = Number.parseInt(candidate.id.slice(8, 16), 16) / 4294967296;
  const angle = seed * Math.PI * 2;
  const radius = 300 * Math.sqrt(second);
  return { x: coordinate(Math.cos(angle) * radius), y: coordinate(Math.sin(angle) * radius) };
});
const degree = graph.adjacency.map(edges => Math.max(1, edges.length));
const preferredSpacing = Math.sqrt(600 * 600 / count);
const iterations = 180;
for (let iteration = 0; iteration < iterations; iteration += 1) {
  const forces = coordinates.map(point => ({ x: -point.x * .035, y: -point.y * .035 }));
  for (let left = 0; left < count; left += 1) {
    for (let right = left + 1; right < count; right += 1) {
      const dx = coordinates[left].x - coordinates[right].x;
      const dy = coordinates[left].y - coordinates[right].y;
      const distanceSquared = Math.max(1, dx * dx + dy * dy);
      const scale = preferredSpacing * preferredSpacing / distanceSquared;
      forces[left].x += dx * scale; forces[left].y += dy * scale;
      forces[right].x -= dx * scale; forces[right].y -= dy * scale;
    }
  }
  for (const [left, right] of graph.pairs) {
    const dx = coordinates[right].x - coordinates[left].x;
    const dy = coordinates[right].y - coordinates[left].y;
    const distance = lengthOf(dx, dy);
    // Degree normalization prevents dense inventory categories collapsing into one point.
    const scale = distance / preferredSpacing / Math.sqrt(degree[left] * degree[right]);
    forces[left].x += dx * scale; forces[left].y += dy * scale;
    forces[right].x -= dx * scale; forces[right].y -= dy * scale;
  }
  const temperature = coordinate(13 * Math.pow(1 - iteration / iterations, 1.4) + .03);
  for (let index = 0; index < count; index += 1) {
    const length = lengthOf(forces[index].x, forces[index].y) || 1;
    const step = Math.min(temperature, length) / length;
    coordinates[index].x = coordinate(coordinates[index].x + forces[index].x * step);
    coordinates[index].y = coordinate(coordinates[index].y + forces[index].y * step);
  }
}
const xs = coordinates.map(point => point.x);
const ys = coordinates.map(point => point.y);
const minimumX = Math.min(...xs); const maximumX = Math.max(...xs);
const minimumY = Math.min(...ys); const maximumY = Math.max(...ys);
const positions = {};
for (let index = 0; index < count; index += 1) {
  positions[graph.candidates[index].id] = {
    x: Number((100 + (coordinates[index].x - minimumX) / (maximumX - minimumX) * 800).toFixed(3)),
    y: Number((110 + (coordinates[index].y - minimumY) / (maximumY - minimumY) * 460).toFixed(3))
  };
}
// Resolve display collisions once at build time, across all candidates. Temporal
// filtering never reruns this pass, so retained node addresses remain unchanged.
const anchors = Object.values(positions);
// A soft target; dense groups may settle slightly closer.
const preferredSeparation = 16;
for (let pass = 0; pass < 200; pass += 1) {
  for (let left = 0; left < anchors.length; left += 1) {
    for (let right = left + 1; right < anchors.length; right += 1) {
      const a = anchors[left]; const b = anchors[right];
      const dx = b.x - a.x; const dy = b.y - a.y;
      const distance = lengthOf(dx, dy);
      if (distance >= preferredSeparation) continue;
      const directionX = distance > 0 ? dx / distance : 1;
      const directionY = distance > 0 ? dy / distance : 0;
      const displacement = (preferredSeparation - distance) * .5;
      a.x = coordinate(a.x - directionX * displacement);
      a.y = coordinate(a.y - directionY * displacement);
      b.x = coordinate(b.x + directionX * displacement);
      b.y = coordinate(b.y + directionY * displacement);
    }
  }
}
for (const anchor of anchors) {
  anchor.x = Number(anchor.x.toFixed(3));
  anchor.y = Number(anchor.y.toFixed(3));
}
const artifact = { build_id: graph.build_id, layout_version: 'fixed-force-map-v3',
  meaning: 'fixed present-day build layout for navigation; distance is not relationship strength or historical knowledge',
  iterations, positions };
const destination = path.resolve(__dirname, '../api/data/market-field-layout.json');
fs.writeFileSync(destination, JSON.stringify(artifact) + '\n');
console.log(`fixed layout: ${count} candidate anchors, ${iterations} deterministic passes`);
