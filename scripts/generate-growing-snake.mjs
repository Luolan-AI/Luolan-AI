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
const initialSnakeCells = 4;
const animationSeconds = 36;
const movementFraction = 0.9;

const points = [];
for (let row = 0; row < rowCount; row += 1) {
  if (row % 2 === 0) {
    for (let column = 0; column < columnCount; column += 1) {
      points.push({ row, column });
    }
  } else {
    for (let column = columnCount - 1; column >= 0; column -= 1) {
      points.push({ row, column });
    }
  }
}

const pointIndex = new Map(
  points.map(({ row, column }, index) => [`${row}:${column}`, index]),
);
const activeContributions = contributions
  .filter(({ level }) => level > 0)
  .map((contribution) => ({
    ...contribution,
    visitIndex: pointIndex.get(`${contribution.row}:${contribution.column}`),
  }))
  .filter(({ visitIndex }) => visitIndex !== undefined)
  .sort((left, right) => left.visitIndex - right.visitIndex);

const pathData = points
  .map(({ row, column }, index) => {
    const x = column * gridStep + cellInset + cellSize / 2;
    const y = row * gridStep + cellInset + cellSize / 2;
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  })
  .join(" ");

const totalPathLength = (points.length - 1) * gridStep;
const startIndex = Math.min(initialSnakeCells - 1, points.length - 1);
const animationIndexes = [];
for (let index = startIndex; index < points.length; index += 1) {
  animationIndexes.push(index);
}

const keyTimes = animationIndexes.map((index) => {
  const progress =
    (index - startIndex) / Math.max(1, points.length - 1 - startIndex);
  return formatNumber(progress * movementFraction);
});
keyTimes.push("1");

const headDistances = [];
const tailDistances = [];
const headPositions = [];
for (const index of animationIndexes) {
  const eatenCount = activeContributions.filter(
    ({ visitIndex }) => visitIndex <= index,
  ).length;
  const headDistance = index * gridStep;
  const desiredLength = (initialSnakeCells + eatenCount) * gridStep;
  headDistances.push(formatNumber(headDistance));
  tailDistances.push(
    formatNumber(Math.max(0, headDistance - desiredLength)),
  );
  const { row, column } = points[index];
  headPositions.push(
    `${column * gridStep + cellInset + cellSize / 2} ${row * gridStep + cellInset + cellSize / 2}`,
  );
}
headDistances.push(headDistances.at(-1));
tailDistances.push(tailDistances.at(-1));
headPositions.push(headPositions.at(-1));

const themes = {
  light: {
    background: "transparent",
    border: "#1b1f230a",
    empty: "#ebedf0",
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    snake: "#2ea043",
    snakeOutline: "#0d5f2d",
    eye: "#ffffff",
  },
  dark: {
    background: "transparent",
    border: "#f0f6fc1a",
    empty: "#161b22",
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    snake: "#39d353",
    snakeOutline: "#0d5f2d",
    eye: "#0d1117",
  },
};

await Promise.all([
  writeSvg(lightOutput, themes.light),
  writeSvg(darkOutput, themes.dark),
]);

console.log(
  `Generated growing snake for ${username}: ${activeContributions.length} edible cells`,
);

async function writeSvg(outputPath, theme) {
  const width = columnCount * gridStep;
  const height = rowCount * gridStep;
  const dashGap = totalPathLength + gridStep;
  const headDashes = headDistances.map((distance) => `${distance} ${dashGap}`);
  const tailDashes = tailDistances.map((distance) => `${distance} ${dashGap}`);
  const cells = contributions
    .map(({ date, row, column, level }) => {
      const x = column * gridStep + cellInset;
      const y = row * gridStep + cellInset;
      const color = theme.levels[level];
      const visitIndex = pointIndex.get(`${row}:${column}`);
      const eatProgress =
        visitIndex === undefined
          ? null
          : Math.max(
              0.001,
              ((visitIndex - startIndex) /
                Math.max(1, points.length - 1 - startIndex)) *
                movementFraction,
            );
      const animation =
        level > 0 && eatProgress !== null
          ? `<animate attributeName="fill" dur="${animationSeconds}s" repeatCount="indefinite" calcMode="discrete" values="${color};${theme.empty};${theme.empty}" keyTimes="0;${formatNumber(eatProgress)};1"/>`
          : "";

      return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${color}" stroke="${theme.border}"><title>${escapeXml(date)}</title>${animation}</rect>`;
    })
    .join("");

  const svg = `<svg viewBox="-8 -8 ${width + 16} ${height + 16}" width="${width + 16}" height="${height + 16}" xmlns="http://www.w3.org/2000/svg">
  <title>${escapeXml(username)}'s growing contribution snake</title>
  <desc>A snake eats contribution cells and grows by one segment for every green cell.</desc>
  <rect x="-8" y="-8" width="${width + 16}" height="${height + 16}" fill="${theme.background}"/>
  <defs>
    <mask id="snake-body-mask" x="-8" y="-8" width="${width + 16}" height="${height + 16}" maskUnits="userSpaceOnUse">
      <rect x="-8" y="-8" width="${width + 16}" height="${height + 16}" fill="black"/>
      <path d="${pathData}" fill="none" stroke="white" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${headDashes[0]}">
        <animate attributeName="stroke-dasharray" dur="${animationSeconds}s" repeatCount="indefinite" calcMode="linear" values="${headDashes.join(";")}" keyTimes="${keyTimes.join(";")}"/>
      </path>
      <path d="${pathData}" fill="none" stroke="black" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${tailDashes[0]}">
        <animate attributeName="stroke-dasharray" dur="${animationSeconds}s" repeatCount="indefinite" calcMode="linear" values="${tailDashes.join(";")}" keyTimes="${keyTimes.join(";")}"/>
      </path>
    </mask>
  </defs>
  <g>${cells}</g>
  <path d="${pathData}" fill="none" stroke="${theme.snakeOutline}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" mask="url(#snake-body-mask)"/>
  <path d="${pathData}" fill="none" stroke="${theme.snake}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" mask="url(#snake-body-mask)"/>
  <g>
    <circle cx="0" cy="0" r="7" fill="${theme.snake}" stroke="${theme.snakeOutline}" stroke-width="2"/>
    <circle cx="2" cy="-2" r="1.5" fill="${theme.eye}"/>
    <animateTransform attributeName="transform" type="translate" dur="${animationSeconds}s" repeatCount="indefinite" calcMode="linear" values="${headPositions.join(";")}" keyTimes="${keyTimes.join(";")}"/>
  </g>
</svg>`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, svg, "utf8");
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
