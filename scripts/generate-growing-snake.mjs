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

const gridRoute = createGridRoute();
const firstTarget = contributionCenter(gridRoute[0]);
const waypoints = [
  { x: -56, y: firstTarget.y },
  { x: -40, y: firstTarget.y },
  { x: -24, y: firstTarget.y },
  { x: -8, y: firstTarget.y },
  ...gridRoute.map(contributionCenter),
];
const curve = createRoundedCurve(waypoints, 5);
validateNoSelfIntersections(curve.samples);
const startDistance = curve.waypointDistances[3];
const totalPathLength = curve.samples.at(-1).distance;
const animationSeconds = clamp(totalPathLength / 150 + 3, 36, 46);

const targetDistances = new Map();
const gridRouteIndexes = new Map(
  gridRoute.map((contribution, index) => [
    contributionKey(contribution),
    index,
  ]),
);
for (const contribution of activeContributions) {
  const routeIndex = gridRouteIndexes.get(contributionKey(contribution));
  const waypointIndex = routeIndex + 4;
  targetDistances.set(
    contributionKey(contribution),
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
const orderedTargetDistances = activeContributions
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
    snakeGlow: "#39d353",
    snakeOutline: "#0d5f2d",
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
    snakeGlow: "#56d364",
    snakeOutline: "#0d5f2d",
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
  <desc>A continuous animated snake follows a smooth non-self-intersecting route, eats contribution cells, and grows longer.</desc>
  <rect x="-24" y="-8" width="${width + 40}" height="${height + 16}" fill="${theme.background}"/>
  <defs>
    <filter id="snake-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
    <linearGradient id="snake-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${theme.snake}"/>
      <stop offset="52%" stop-color="${theme.snakeGlow}">
        <animate attributeName="stop-color" values="${theme.snakeGlow};${theme.snake};${theme.snakeGlow}" dur="1.8s" repeatCount="indefinite"/>
      </stop>
      <stop offset="100%" stop-color="${theme.snake}"/>
    </linearGradient>
    <mask id="snake-body-mask" x="-24" y="-8" width="${width + 40}" height="${height + 16}" maskUnits="userSpaceOnUse">
      <rect x="-24" y="-8" width="${width + 40}" height="${height + 16}" fill="black"/>
      <path d="${curve.pathData}" pathLength="${formatNumber(totalPathLength)}" fill="none" stroke="white" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${headDashes[0]}">
        <animate attributeName="stroke-dasharray" dur="${duration}s" repeatCount="indefinite" calcMode="linear" values="${headDashes.join(";")}" keyTimes="${keyTimes.join(";")}"/>
      </path>
      <path d="${curve.pathData}" pathLength="${formatNumber(totalPathLength)}" fill="none" stroke="black" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${tailDashes[0]}">
        <animate attributeName="stroke-dasharray" dur="${duration}s" repeatCount="indefinite" calcMode="linear" values="${tailDashes.join(";")}" keyTimes="${keyTimes.join(";")}"/>
      </path>
    </mask>
  </defs>
  <g>${cells}</g>
  <g filter="url(#snake-shadow)" mask="url(#snake-body-mask)">
    <path d="${curve.pathData}" pathLength="${formatNumber(totalPathLength)}" fill="none" stroke="${theme.snakeOutline}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${curve.pathData}" pathLength="${formatNumber(totalPathLength)}" fill="none" stroke="url(#snake-gradient)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
      <animate attributeName="stroke-width" values="8.6;9.4;8.6" keyTimes="0;0.5;1" dur="1.2s" repeatCount="indefinite"/>
    </path>
  </g>
  <g filter="url(#snake-shadow)">
    <animateTransform attributeName="transform" type="translate" dur="${duration}s" repeatCount="indefinite" calcMode="linear" values="${headPositions.join(";")}" keyTimes="${keyTimes.join(";")}"/>
    <g>
      <animateTransform attributeName="transform" type="rotate" dur="${duration}s" repeatCount="indefinite" calcMode="linear" values="${angleValues.join(";")}" keyTimes="${keyTimes.join(";")}"/>
      <g>
        <animateTransform attributeName="transform" type="scale" values="1 1;1.05 0.97;1 1" keyTimes="0;0.5;1" dur="0.7s" repeatCount="indefinite"/>
        <ellipse cx="0" cy="0" rx="8" ry="6.2" fill="${theme.snake}" stroke="${theme.snakeOutline}" stroke-width="1.5"/>
        <circle cx="2.8" cy="-2.5" r="1.7" fill="${theme.eye}"/>
        <circle cx="2.8" cy="2.5" r="1.7" fill="${theme.eye}"/>
        <circle cx="3.5" cy="-2.5" r="0.7" fill="${theme.pupil}"/>
        <circle cx="3.5" cy="2.5" r="0.7" fill="${theme.pupil}"/>
        <path d="M7.5,0 L12,0 M12,0 L14.5,-1.8 M12,0 L14.5,1.8" fill="none" stroke="${theme.tongue}" stroke-width="1.3" stroke-linecap="round">
          <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.55;0.65;0.8;1" dur="1.4s" repeatCount="indefinite"/>
        </path>
      </g>
    </g>
  </g>
</svg>`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, svg, "utf8");
}

function createGridRoute() {
  const route = [];
  for (let column = 0; column < columnCount; column += 1) {
    if (column % 2 === 0) {
      for (let row = 0; row < rowCount; row += 1) {
        route.push({ row, column });
      }
    } else {
      for (let row = rowCount - 1; row >= 0; row -= 1) {
        route.push({ row, column });
      }
    }
  }
  return route;
}

function createRoundedCurve(points, cornerRadius) {
  const pathParts = [`M${formatPoint(points[0])}`];
  const samples = [{ ...points[0], distance: 0 }];
  const waypointDistances = Array(points.length).fill(0);
  let totalDistance = 0;
  let cursor = points[0];

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    if (!next) {
      pathParts.push(`L${formatPoint(current)}`);
      sampleLine(cursor, current);
      waypointDistances[index] = totalDistance;
      cursor = current;
      continue;
    }

    const previous = points[index - 1];
    const incoming = unitVector(previous, current);
    const outgoing = unitVector(current, next);
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;

    if (Math.abs(cross) < 0.0001 && dot > 0.9999) {
      pathParts.push(`L${formatPoint(current)}`);
      sampleLine(cursor, current);
      waypointDistances[index] = totalDistance;
      cursor = current;
      continue;
    }

    const radius = Math.min(
      cornerRadius,
      distance(previous, current) / 3,
      distance(current, next) / 3,
    );
    const before = {
      x: current.x - incoming.x * radius,
      y: current.y - incoming.y * radius,
    };
    const after = {
      x: current.x + outgoing.x * radius,
      y: current.y + outgoing.y * radius,
    };

    pathParts.push(`L${formatPoint(before)}`);
    sampleLine(cursor, before);
    pathParts.push(`Q${formatPoint(current)} ${formatPoint(after)}`);
    const turnDistance = sampleQuadratic(before, current, after);
    waypointDistances[index] = turnDistance;
    cursor = after;
  }

  return {
    pathData: pathParts.join(" "),
    samples,
    waypointDistances,
  };

  function appendSample(point) {
    totalDistance += distance(samples.at(-1), point);
    samples.push({ ...point, distance: totalDistance });
  }

  function sampleLine(start, end) {
    const sampleCount = Math.max(1, Math.ceil(distance(start, end) / 3));
    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      const time = sampleIndex / sampleCount;
      appendSample({
        x: start.x + (end.x - start.x) * time,
        y: start.y + (end.y - start.y) * time,
      });
    }
  }

  function sampleQuadratic(start, control, end) {
    const sampleCount = 6;
    let middleDistance = totalDistance;
    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      const time = sampleIndex / sampleCount;
      const inverse = 1 - time;
      appendSample({
        x:
          inverse ** 2 * start.x +
          2 * inverse * time * control.x +
          time ** 2 * end.x,
        y:
          inverse ** 2 * start.y +
          2 * inverse * time * control.y +
          time ** 2 * end.y,
      });
      if (sampleIndex === sampleCount / 2) {
        middleDistance = totalDistance;
      }
    }
    return middleDistance;
  }
}

function validateNoSelfIntersections(samples) {
  const epsilon = 0.0001;
  for (let left = 0; left < samples.length - 1; left += 1) {
    const a = samples[left];
    const b = samples[left + 1];
    for (let right = left + 2; right < samples.length - 1; right += 1) {
      const c = samples[right];
      const d = samples[right + 1];
      if (segmentsIntersect(a, b, c, d, epsilon)) {
        throw new Error(
          `Generated route self-intersects near samples ${left} and ${right}`,
        );
      }
    }
  }
}

function segmentsIntersect(a, b, c, d, epsilon) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (
    abC * abD < -epsilon &&
    cdA * cdB < -epsilon
  );
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function unitVector(start, end) {
  const length = distance(start, end);
  return {
    x: (end.x - start.x) / length,
    y: (end.y - start.y) / length,
  };
}

function distance(start, end) {
  return Math.hypot(end.x - start.x, end.y - start.y);
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
