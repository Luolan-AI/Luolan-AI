#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [username, lightOutput, darkOutput] = process.argv.slice(2);

if (!username || !lightOutput || !darkOutput) {
  console.error(
    "Usage: node scripts/generate-growing-snake.mjs <username> <light.svg> <dark.svg>",
  );
  process.exit(1);
}

const response = await fetch(
  `https://github.com/users/${encodeURIComponent(username)}/contributions`,
  {
    headers: {
      Accept: "text/html",
      "User-Agent": "growing-contribution-snake",
    },
  },
);

if (!response.ok) {
  throw new Error(
    `GitHub contribution request failed: ${response.status} ${response.statusText}`,
  );
}

const contributionHtml = await response.text();
const contributionPattern =
  /data-date="([^"]+)" id="contribution-day-component-(\d+)-(\d+)" data-level="([0-4])"/g;
const contributions = [];

for (const match of contributionHtml.matchAll(contributionPattern)) {
  contributions.push({
    date: match[1],
    row: Number(match[2]),
    column: Number(match[3]),
    level: Number(match[4]),
  });
}

if (contributions.length < 300) {
  throw new Error(
    `Expected a full GitHub contribution grid, received ${contributions.length} cells`,
  );
}

const rowCount = 7;
const columnCount =
  Math.max(...contributions.map(({ column }) => column)) + 1;
const cellSize = 12;
const cellGap = 4;
const gridStep = cellSize + cellGap;
const cellInset = 2;
const initialSnakeLength = 48;
const growthPerContribution = 10;
const movementFraction = 0.92;

const activeContributions = contributions.filter(({ level }) => level > 0);
if (activeContributions.length === 0) {
  throw new Error("The contribution grid does not contain any edible cells");
}

const orderedContributions = orderTargets(activeContributions);
const firstTarget = contributionCenter(orderedContributions[0]);
const waypoints = [
  { x: -56, y: firstTarget.y },
  { x: -40, y: firstTarget.y },
  { x: -24, y: firstTarget.y },
  { x: -8, y: firstTarget.y },
  ...orderedContributions.map(contributionCenter),
];
const startDistance = 48;
const curve = createSmoothCurve(waypoints);
const totalPathLength = curve.samples.at(-1).distance;
const animationSeconds = clamp(totalPathLength / 78 + 4, 32, 56);

const targetDistances = new Map();
for (let targetIndex = 0; targetIndex < orderedContributions.length; targetIndex += 1) {
  const waypointIndex = targetIndex + 4;
  targetDistances.set(
    contributionKey(orderedContributions[targetIndex]),
    curve.waypointDistances[waypointIndex],
  );
}

const animationSamples = curve.samples.filter(
  ({ distance }) => distance >= startDistance,
);
const keyTimes = animationSamples.map(({ distance }) =>
  formatNumber(
    ((distance - startDistance) /
      Math.max(1, totalPathLength - startDistance)) *
      movementFraction,
  ),
);
keyTimes.push("1");

const headDistances = [];
const tailDistances = [];
const headPositions = [];
const headAngles = [];
let eatenCount = 0;
const orderedTargetDistances = orderedContributions
  .map((contribution) => targetDistances.get(contributionKey(contribution)))
  .sort((left, right) => left - right);

for (let index = 0; index < animationSamples.length; index += 1) {
  const sample = animationSamples[index];
  while (
    eatenCount < orderedTargetDistances.length &&
    orderedTargetDistances[eatenCount] <= sample.distance + 0.001
  ) {
    eatenCount += 1;
  }

  const desiredLength =
    initialSnakeLength + eatenCount * growthPerContribution;
  headDistances.push(formatNumber(sample.distance));
  tailDistances.push(
    formatNumber(Math.max(0, sample.distance - desiredLength)),
  );
  headPositions.push(
    `${formatNumber(sample.x)} ${formatNumber(sample.y)}`,
  );

  const previous = animationSamples[Math.max(0, index - 1)];
  const next =
    animationSamples[Math.min(animationSamples.length - 1, index + 1)];
  let angle =
    (Math.atan2(next.y - previous.y, next.x - previous.x) * 180) / Math.PI;
  if (headAngles.length > 0) {
    const previousAngle = Number(headAngles.at(-1));
    while (angle - previousAngle > 180) angle -= 360;
    while (angle - previousAngle < -180) angle += 360;
    angle =
      previousAngle + clamp(angle - previousAngle, -24, 24);
  }
  headAngles.push(formatNumber(angle));
}

for (const values of [
  headDistances,
  tailDistances,
  headPositions,
  headAngles,
]) {
  values.push(values.at(-1));
}

const themes = {
  light: {
    background: "transparent",
    border: "#1b1f230a",
    empty: "#ebedf0",
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    snake: "#2ea043",
    snakeOutline: "#0d5f2d",
    highlight: "#ffffff99",
    eye: "#ffffff",
    pupil: "#0d1117",
    tongue: "#e34c6f",
  },
  dark: {
    background: "transparent",
    border: "#f0f6fc1a",
    empty: "#161b22",
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    snake: "#39d353",
    snakeOutline: "#0d5f2d",
    highlight: "#ffffff80",
    eye: "#ffffff",
    pupil: "#0d1117",
    tongue: "#ff7b9c",
  },
};

await Promise.all([
  writeSvg(lightOutput, themes.light),
  writeSvg(darkOutput, themes.dark),
]);

console.log(
  `Generated lively growing snake for ${username}: ${activeContributions.length} edible cells, ${formatNumber(animationSeconds)}s loop`,
);

async function writeSvg(outputPath, theme) {
  const width = columnCount * gridStep;
  const height = rowCount * gridStep;
  const dashGap = totalPathLength + gridStep;
  const headDashes = headDistances.map((distance) => `${distance} ${dashGap}`);
  const tailDashes = tailDistances.map((distance) => `${distance} ${dashGap}`);
  const angleValues = headAngles.map((angle) => `${angle} 0 0`);

  const cells = contributions
    .map(({ date, row, column, level }) => {
      const x = column * gridStep + cellInset;
      const y = row * gridStep + cellInset;
      const color = theme.levels[level];
      const targetDistance = targetDistances.get(`${row}:${column}`);
      const eatProgress =
        targetDistance === undefined
          ? null
          : Math.max(
              0.001,
              ((targetDistance - startDistance) /
                Math.max(1, totalPathLength - startDistance)) *
                movementFraction,
            );
      const animation =
        level > 0 && eatProgress !== null
          ? `<animate attributeName="fill" dur="${formatNumber(animationSeconds)}s" repeatCount="indefinite" calcMode="discrete" values="${color};${theme.empty};${theme.empty}" keyTimes="0;${formatNumber(eatProgress)};1"/>`
          : "";

      return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${color}" stroke="${theme.border}"><title>${escapeXml(date)}</title>${animation}</rect>`;
    })
    .join("");

  const duration = formatNumber(animationSeconds);
  const svg = `<svg viewBox="-24 -8 ${width + 40} ${height + 16}" width="${width + 40}" height="${height + 16}" xmlns="http://www.w3.org/2000/svg">
  <title>${escapeXml(username)}'s lively growing contribution snake</title>
  <desc>A smooth animated snake curves between contribution cells, eats them, and grows longer.</desc>
  <rect x="-24" y="-8" width="${width + 40}" height="${height + 16}" fill="${theme.background}"/>
  <defs>
    <filter id="snake-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
    <mask id="snake-body-mask" x="-24" y="-8" width="${width + 40}" height="${height + 16}" maskUnits="userSpaceOnUse">
      <rect x="-24" y="-8" width="${width + 40}" height="${height + 16}" fill="black"/>
      <path d="${curve.pathData}" pathLength="${formatNumber(totalPathLength)}" fill="none" stroke="white" stroke-width="19" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${headDashes[0]}">
        <animate attributeName="stroke-dasharray" dur="${duration}s" repeatCount="indefinite" calcMode="linear" values="${headDashes.join(";")}" keyTimes="${keyTimes.join(";")}"/>
      </path>
      <path d="${curve.pathData}" pathLength="${formatNumber(totalPathLength)}" fill="none" stroke="black" stroke-width="21" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${tailDashes[0]}">
        <animate attributeName="stroke-dasharray" dur="${duration}s" repeatCount="indefinite" calcMode="linear" values="${tailDashes.join(";")}" keyTimes="${keyTimes.join(";")}"/>
      </path>
    </mask>
  </defs>
  <g>${cells}</g>
  <g filter="url(#snake-shadow)" mask="url(#snake-body-mask)">
    <path d="${curve.pathData}" pathLength="${formatNumber(totalPathLength)}" fill="none" stroke="${theme.snakeOutline}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${curve.pathData}" pathLength="${formatNumber(totalPathLength)}" fill="none" stroke="${theme.snake}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${curve.pathData}" pathLength="${formatNumber(totalPathLength)}" fill="none" stroke="${theme.highlight}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="2 13">
      <animate attributeName="stroke-dashoffset" from="0" to="-15" dur="0.8s" repeatCount="indefinite"/>
    </path>
  </g>
  <g filter="url(#snake-shadow)">
    <animateTransform attributeName="transform" type="translate" dur="${duration}s" repeatCount="indefinite" calcMode="linear" values="${headPositions.join(";")}" keyTimes="${keyTimes.join(";")}"/>
    <g>
      <animateTransform attributeName="transform" type="rotate" dur="${duration}s" repeatCount="indefinite" calcMode="linear" values="${angleValues.join(";")}" keyTimes="${keyTimes.join(";")}"/>
      <g>
        <animateTransform attributeName="transform" type="scale" values="1 1;1.07 0.95;1 1" keyTimes="0;0.5;1" dur="0.7s" repeatCount="indefinite"/>
        <ellipse cx="0" cy="0" rx="10" ry="7.5" fill="${theme.snake}" stroke="${theme.snakeOutline}" stroke-width="2"/>
        <circle cx="3.5" cy="-3.2" r="2.2" fill="${theme.eye}"/>
        <circle cx="3.5" cy="3.2" r="2.2" fill="${theme.eye}"/>
        <circle cx="4.4" cy="-3.2" r="0.9" fill="${theme.pupil}"/>
        <circle cx="4.4" cy="3.2" r="0.9" fill="${theme.pupil}"/>
        <path d="M9,0 L14,0 M14,0 L17,-2 M14,0 L17,2" fill="none" stroke="${theme.tongue}" stroke-width="1.5" stroke-linecap="round">
          <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.55;0.65;0.8;1" dur="1.4s" repeatCount="indefinite"/>
        </path>
      </g>
    </g>
  </g>
</svg>`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, svg, "utf8");
}

function orderTargets(targets) {
  const remaining = targets.map((target) => ({ ...target }));
  const start = remaining.reduce((best, target) => {
    if (target.column < best.column) return target;
    if (
      target.column === best.column &&
      Math.abs(target.row - 3) < Math.abs(best.row - 3)
    ) {
      return target;
    }
    return best;
  });
  remaining.splice(remaining.indexOf(start), 1);

  const ordered = [start];
  let previousDirection = { x: 1, y: 0 };

  while (remaining.length > 0) {
    const current = ordered.at(-1);
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const dx = candidate.column - current.column;
      const dy = candidate.row - current.row;
      const distance = Math.hypot(dx, dy);
      const direction = { x: dx / distance, y: dy / distance };
      const cosine =
        direction.x * previousDirection.x +
        direction.y * previousDirection.y;
      const turnPenalty = (1 - cosine) * Math.min(3.5, distance * 0.45);
      const verticalPenalty = Math.abs(dy) * 0.05;
      const deterministicJitter =
        ((candidate.column * 17 + candidate.row * 31) % 11) / 100;
      const score =
        distance + turnPenalty + verticalPenalty + deterministicJitter;

      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const next = remaining.splice(bestIndex, 1)[0];
    const dx = next.column - current.column;
    const dy = next.row - current.row;
    const distance = Math.hypot(dx, dy);
    previousDirection = { x: dx / distance, y: dy / distance };
    ordered.push(next);
  }

  return ordered;
}

function createSmoothCurve(points) {
  const pathParts = [`M${formatPoint(points[0])}`];
  const samples = [{ ...points[0], distance: 0 }];
  const waypointDistances = [0];
  let totalDistance = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const start = points[index];
    const end = points[index + 1];
    const next = points[Math.min(points.length - 1, index + 2)];
    const controlOne = clampPoint({
      x: start.x + ((end.x - previous.x) / 6) * 0.72,
      y: start.y + ((end.y - previous.y) / 6) * 0.72,
    });
    const controlTwo = clampPoint({
      x: end.x - ((next.x - start.x) / 6) * 0.72,
      y: end.y - ((next.y - start.y) / 6) * 0.72,
    });
    pathParts.push(
      `C${formatPoint(controlOne)} ${formatPoint(controlTwo)} ${formatPoint(end)}`,
    );

    const directDistance = Math.hypot(end.x - start.x, end.y - start.y);
    const sampleCount = Math.max(4, Math.ceil(directDistance / 3));
    let lastSample = samples.at(-1);

    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      const time = sampleIndex / sampleCount;
      const sample = cubicPoint(
        start,
        controlOne,
        controlTwo,
        end,
        time,
      );
      totalDistance += Math.hypot(
        sample.x - lastSample.x,
        sample.y - lastSample.y,
      );
      lastSample = { ...sample, distance: totalDistance };
      samples.push(lastSample);
    }
    waypointDistances.push(totalDistance);
  }

  return {
    pathData: pathParts.join(" "),
    samples,
    waypointDistances,
  };
}

function cubicPoint(start, controlOne, controlTwo, end, time) {
  const inverse = 1 - time;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * time * controlOne.x +
      3 * inverse * time ** 2 * controlTwo.x +
      time ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * time * controlOne.y +
      3 * inverse * time ** 2 * controlTwo.y +
      time ** 3 * end.y,
  };
}

function clampPoint(point) {
  return {
    x: clamp(point.x, -56, columnCount * gridStep - 8),
    y: clamp(point.y, 8, rowCount * gridStep - 8),
  };
}

function contributionCenter({ row, column }) {
  return {
    x: column * gridStep + cellInset + cellSize / 2,
    y: row * gridStep + cellInset + cellSize / 2,
  };
}

function contributionKey({ row, column }) {
  return `${row}:${column}`;
}

function formatPoint({ x, y }) {
  return `${formatNumber(x)},${formatNumber(y)}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatNumber(value) {
  return Number(value.toFixed(5)).toString();
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
