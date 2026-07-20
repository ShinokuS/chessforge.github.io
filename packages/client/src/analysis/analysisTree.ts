import {
  appendHistoryFromEvents,
  applyCommand,
  groupHistoryForDisplay,
  type GameCommand,
  type MatchState,
  type MoveHistoryEntry,
  type PlayerId,
} from '@chessforge/engine';
import { cloneMatch, formatAnalysisMove, tryPlayCommand } from './analysisHelpers';

export type AnalysisNode = {
  id: string;
  command: GameCommand | null;
  label: string;
  by: PlayerId | null;
  state: MatchState;
  /** Variations; index 0 is the mainline continuation from this node. */
  children: AnalysisNode[];
};

export type AnalysisPath = number[];

let nextNodeId = 1;

export function createRootNode(state: MatchState): AnalysisNode {
  return {
    id: `n${nextNodeId++}`,
    command: null,
    label: 'Старт',
    by: null,
    state: cloneMatch(state),
    children: [],
  };
}

export function createMoveNode(
  before: MatchState,
  command: GameCommand,
  after: MatchState,
): AnalysisNode {
  return {
    id: `n${nextNodeId++}`,
    command,
    label: formatAnalysisMove(before, command),
    by: before.activePlayer,
    state: after,
    children: [],
  };
}

export function getNodeAt(root: AnalysisNode, path: AnalysisPath): AnalysisNode | null {
  let node = root;
  for (const index of path) {
    const next = node.children[index];
    if (!next) return null;
    node = next;
  }
  return node;
}

export function commandKey(cmd: GameCommand | null): string {
  if (!cmd) return '';
  if (cmd.type === 'endTurn') return 'endTurn';
  return `${cmd.from.x},${cmd.from.y}->${cmd.to.x},${cmd.to.y}:${cmd.abilityId ?? ''}:${cmd.push ? 1 : 0}`;
}

function cloneNodeShallow(node: AnalysisNode): AnalysisNode {
  return { ...node, children: node.children.slice() };
}

/** Immutable: replace node at path with updater(node). */
export function updateAt(
  root: AnalysisNode,
  path: AnalysisPath,
  updater: (node: AnalysisNode) => AnalysisNode,
): AnalysisNode {
  if (path.length === 0) return updater(cloneNodeShallow(root));
  const [head, ...rest] = path;
  const copy = cloneNodeShallow(root);
  const child = copy.children[head!];
  if (!child) return root;
  copy.children[head!] = updateAt(child, rest, updater);
  return copy;
}

/**
 * Play a command at the cursor. Reuses an existing child if the same move exists;
 * otherwise appends a new child (mainline if none, else a variation).
 */
export function playAtPath(
  root: AnalysisNode,
  path: AnalysisPath,
  command: GameCommand,
): { root: AnalysisNode; path: AnalysisPath } | null {
  const node = getNodeAt(root, path);
  if (!node) return null;
  const key = commandKey(command);
  const existing = node.children.findIndex((c) => commandKey(c.command) === key);
  if (existing >= 0) {
    return { root, path: [...path, existing] };
  }
  const result = tryPlayCommand(node.state, command);
  if (!result.ok) return null;
  const child = createMoveNode(node.state, command, result.state);
  const nextRoot = updateAt(root, path, (n) => ({
    ...n,
    children: [...n.children, child],
  }));
  return { root: nextRoot, path: [...path, node.children.length] };
}

/** Play a PV prefix as a variation branch from the cursor (Lichess-style). */
export function playPvAtPath(
  root: AnalysisNode,
  path: AnalysisPath,
  pv: GameCommand[],
  upto: number,
): { root: AnalysisNode; path: AnalysisPath } | null {
  let curRoot = root;
  let curPath = path;
  for (let i = 0; i <= upto; i += 1) {
    const cmd = pv[i];
    if (!cmd) return null;
    const next = playAtPath(curRoot, curPath, cmd);
    if (!next) return null;
    curRoot = next.root;
    curPath = next.path;
  }
  return { root: curRoot, path: curPath };
}

/** Make the node at `path` the mainline child of its parent. */
export function promotePath(root: AnalysisNode, path: AnalysisPath): AnalysisNode {
  if (path.length === 0) return root;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1]!;
  if (index === 0) return root;
  return updateAt(root, parentPath, (parent) => {
    const children = parent.children.slice();
    const [picked] = children.splice(index, 1);
    if (!picked) return parent;
    children.unshift(picked);
    return { ...parent, children };
  });
}

/** Delete the node at path (and its subtree) from its parent. */
export function deletePath(
  root: AnalysisNode,
  path: AnalysisPath,
): { root: AnalysisNode; path: AnalysisPath } {
  if (path.length === 0) return { root, path };
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1]!;
  const nextRoot = updateAt(root, parentPath, (parent) => ({
    ...parent,
    children: parent.children.filter((_, i) => i !== index),
  }));
  return { root: nextRoot, path: parentPath };
}

/** Drop sibling variations at this node — keep only the mainline child. */
export function keepMainlineOnly(root: AnalysisNode, path: AnalysisPath): AnalysisNode {
  return updateAt(root, path, (node) => ({
    ...node,
    children: node.children[0] ? [node.children[0]] : [],
  }));
}

export type TreeHistoryMove = {
  nodeId: string;
  path: AnalysisPath;
  /** Last tree node when the same history ply spans two moves (Wayfarer). */
  pathEnd?: AnalysisPath;
  label: string;
  by: PlayerId;
  ply: number;
};

export type TreeHistoryBlock =
  | {
      kind: 'row';
      turn: number;
      white?: TreeHistoryMove;
      black?: TreeHistoryMove;
      afterWhite?: TreeHistoryBlock[];
      afterBlack?: TreeHistoryBlock[];
    }
  | {
      kind: 'variation';
      depth: number;
      moves: TreeHistoryMove[];
      nested: TreeHistoryBlock[];
    }
  | {
      kind: 'system';
      text: string;
    };

function openingSkipEntries(state: MatchState): MoveHistoryEntry[] {
  const openingSkips = state.openingSkipSequence;
  if (!openingSkips || openingSkips.length === 0) return [];
  return openingSkips.map((player, idx) => {
    const ply = idx + 1;
    return {
      ply,
      turn: Math.ceil(ply / 2),
      player,
      text: 'Промедление: пропуск первого хода',
      kind: 'ply' as const,
    };
  });
}

type LineStep = {
  path: AnalysisPath;
  node: AnalysisNode;
  before: MatchState;
};

/** Replay commands along a line using the same history rules as battle. */
function replayLineHistory(
  startState: MatchState,
  steps: LineStep[],
  options?: { includeOpeningSkips?: boolean },
): {
  entries: MoveHistoryEntry[];
  pathByPly: Map<number, AnalysisPath>;
  pathEndByPly: Map<number, AnalysisPath>;
  nodeIdByPly: Map<number, string>;
} {
  const pathByPly = new Map<number, AnalysisPath>();
  const pathEndByPly = new Map<number, AnalysisPath>();
  const nodeIdByPly = new Map<number, string>();
  let history: MoveHistoryEntry[] =
    options?.includeOpeningSkips === false ? [] : openingSkipEntries(startState);
  for (const e of history) {
    if (e.kind === 'ply') {
      pathByPly.set(e.ply, []);
      pathEndByPly.set(e.ply, []);
      nodeIdByPly.set(e.ply, 'root');
    }
  }

  let current = startState;
  for (const step of steps) {
    const command = step.node.command;
    if (!command) continue;

    const continueExtraMove = Boolean(current.extraMovePieceId);
    const result = applyCommand(current, command);
    if (!result.ok) break;

    const prevByPly = new Map(
      history.filter((e) => e.kind === 'ply').map((e) => [e.ply, e.text] as const),
    );
    history = appendHistoryFromEvents(history, result.events, result.state, {
      continueExtraMove,
    });

    let touchedPly: number | null = null;
    for (const e of history) {
      if (e.kind !== 'ply') continue;
      const prev = prevByPly.get(e.ply);
      if (prev === undefined) {
        pathByPly.set(e.ply, step.path);
        pathEndByPly.set(e.ply, step.path);
        nodeIdByPly.set(e.ply, step.node.id);
        touchedPly = e.ply;
      } else if (prev !== e.text) {
        // Same ply extended (Wayfarer 2nd half) — keep first path, update end.
        pathEndByPly.set(e.ply, step.path);
        nodeIdByPly.set(e.ply, step.node.id);
        touchedPly = e.ply;
      }
    }

    if (touchedPly === null && (continueExtraMove || command.type === 'endTurn')) {
      for (let j = history.length - 1; j >= 0; j -= 1) {
        const e = history[j];
        if (e?.kind === 'ply') {
          pathEndByPly.set(e.ply, step.path);
          nodeIdByPly.set(e.ply, step.node.id);
          break;
        }
      }
    }

    current = result.state;
  }

  return { entries: history, pathByPly, pathEndByPly, nodeIdByPly };
}

function entryToMove(
  entry: MoveHistoryEntry,
  pathByPly: Map<number, AnalysisPath>,
  pathEndByPly: Map<number, AnalysisPath>,
  nodeIdByPly: Map<number, string>,
): TreeHistoryMove {
  const path = pathByPly.get(entry.ply) ?? [];
  const pathEndRaw = pathEndByPly.get(entry.ply);
  const pathEnd =
    pathEndRaw && !pathEquals(path, pathEndRaw) ? pathEndRaw : undefined;
  return {
    nodeId: nodeIdByPly.get(entry.ply) ?? `ply-${entry.ply}`,
    path,
    ...(pathEnd ? { pathEnd } : {}),
    label: entry.text,
    by: entry.player,
    ply: entry.ply,
  };
}

function collectBranchSteps(
  parentState: MatchState,
  start: AnalysisNode,
  startPath: AnalysisPath,
): LineStep[] {
  const steps: LineStep[] = [];
  let before = parentState;
  let cur: AnalysisNode | undefined = start;
  let curPath = startPath;
  while (cur) {
    steps.push({ path: curPath, node: cur, before });
    const mainChild: AnalysisNode | undefined = cur.children[0];
    if (!mainChild) break;
    before = cur.state;
    curPath = [...curPath, 0];
    cur = mainChild;
  }
  return steps;
}

function variationBlocks(
  parent: AnalysisNode,
  parentPath: AnalysisPath,
  depth: number,
): TreeHistoryBlock[] {
  const blocks: TreeHistoryBlock[] = [];
  for (let i = 1; i < parent.children.length; i += 1) {
    const start = parent.children[i]!;
    const startPath = [...parentPath, i];
    const steps = collectBranchSteps(parent.state, start, startPath);
    const { entries, pathByPly, pathEndByPly, nodeIdByPly } = replayLineHistory(
      parent.state,
      steps,
      { includeOpeningSkips: false },
    );
    const moves = entries
      .filter((e) => e.kind === 'ply')
      .map((e) => entryToMove(e, pathByPly, pathEndByPly, nodeIdByPly));

    const nested: TreeHistoryBlock[] = [];
    let cur: AnalysisNode | undefined = start;
    let curPath = startPath;
    while (cur) {
      if (cur.children.length > 1) {
        nested.push(...variationBlocks(cur, curPath, depth + 1));
      }
      const mainChild: AnalysisNode | undefined = cur.children[0];
      if (!mainChild) break;
      curPath = [...curPath, 0];
      cur = mainChild;
    }

    if (moves.length > 0 || nested.length > 0) {
      blocks.push({ kind: 'variation', depth, moves, nested });
    }
  }
  return blocks;
}

export function buildTreeHistory(root: AnalysisNode): TreeHistoryBlock[] {
  const mainSteps: LineStep[] = [];
  const sidelinesByPly = new Map<number, TreeHistoryBlock[]>();

  let node = root;
  let path: AnalysisPath = [];
  while (node.children[0]) {
    const child = node.children[0]!;
    const childPath = [...path, 0];
    mainSteps.push({ path: childPath, node: child, before: node.state });

    if (node.children.length > 1) {
      const sidelines = variationBlocks(node, path, 1);
      if (sidelines.length > 0) {
        sidelinesByPly.set(mainSteps.length - 1, sidelines);
      }
    }

    path = childPath;
    node = child;
  }

  const { entries, pathByPly, pathEndByPly, nodeIdByPly } = replayLineHistory(
    root.state,
    mainSteps,
    { includeOpeningSkips: true },
  );

  const afterPly = new Map<number, TreeHistoryBlock[]>();
  for (const [stepIndex, sidelines] of sidelinesByPly) {
    const step = mainSteps[stepIndex];
    if (!step) continue;
    let ply: number | null = null;
    for (const [p, pth] of pathByPly) {
      if (pathEquals(pth, step.path)) {
        ply = p;
        break;
      }
    }
    if (ply === null) {
      for (const [p, pth] of pathEndByPly) {
        if (pathEquals(pth, step.path)) {
          ply = p;
          break;
        }
      }
    }
    if (ply !== null) {
      const prev = afterPly.get(ply) ?? [];
      afterPly.set(ply, [...prev, ...sidelines]);
    }
  }

  const display = groupHistoryForDisplay(entries);
  const blocks: TreeHistoryBlock[] = [];

  for (const block of display) {
    if (block.type === 'system') {
      blocks.push({ kind: 'system', text: block.entry.text });
      continue;
    }
    const { row } = block;
    const out: TreeHistoryBlock = { kind: 'row', turn: row.turn };
    if (row.white) {
      out.white = entryToMove(row.white, pathByPly, pathEndByPly, nodeIdByPly);
      const aw = afterPly.get(row.white.ply);
      if (aw && aw.length > 0) out.afterWhite = aw;
    }
    if (row.black) {
      out.black = entryToMove(row.black, pathByPly, pathEndByPly, nodeIdByPly);
      const ab = afterPly.get(row.black.ply);
      if (ab && ab.length > 0) out.afterBlack = ab;
    }
    blocks.push(out);
  }

  return blocks;
}

export function pathMatchesMove(cur: AnalysisPath, move: TreeHistoryMove): boolean {
  if (pathEquals(cur, move.path)) return true;
  if (move.pathEnd && pathEquals(cur, move.pathEnd)) return true;
  return false;
}

export function pathEquals(a: AnalysisPath, b: AnalysisPath): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function isPrefixPath(prefix: AnalysisPath, full: AnalysisPath): boolean {
  return prefix.length <= full.length && prefix.every((v, i) => full[i] === v);
}

export function stepPath(
  root: AnalysisNode,
  path: AnalysisPath,
  dir: -1 | 1,
): AnalysisPath {
  if (dir < 0) {
    if (path.length === 0) return path;
    const parent = path.slice(0, -1);
    const node = getNodeAt(root, path);
    if (node?.command?.type === 'endTurn' && parent.length > 0) {
      return stepPath(root, parent, -1);
    }
    return parent;
  }
  const node = getNodeAt(root, path);
  if (!node || node.children.length === 0) return path;
  let next = [...path, 0];
  const child = getNodeAt(root, next);
  if (child?.command?.type === 'endTurn' && child.children.length > 0) {
    next = [...next, 0];
  }
  return next;
}

export function replayToTree(
  opening: MatchState,
  commands: GameCommand[],
): { root: AnalysisNode; path: AnalysisPath } {
  let root = createRootNode(opening);
  let path: AnalysisPath = [];
  for (const command of commands) {
    const next = playAtPath(root, path, command);
    if (!next) break;
    root = next.root;
    path = next.path;
  }
  return { root, path };
}

export function mainlineNodes(root: AnalysisNode): AnalysisNode[] {
  const out: AnalysisNode[] = [root];
  let cur = root;
  while (cur.children[0]) {
    cur = cur.children[0];
    out.push(cur);
  }
  return out;
}

export function buildMainlineHistory(root: AnalysisNode): {
  moveHistory: MoveHistoryEntry[];
  pathByPly: Map<number, AnalysisPath>;
} {
  const steps: LineStep[] = [];
  let node = root;
  let path: AnalysisPath = [];
  while (node.children[0]) {
    const child = node.children[0]!;
    const childPath = [...path, 0];
    steps.push({ path: childPath, node: child, before: node.state });
    path = childPath;
    node = child;
  }
  const { entries, pathByPly } = replayLineHistory(root.state, steps, {
    includeOpeningSkips: true,
  });
  return { moveHistory: entries, pathByPly };
}

export function mainlineGraphPaths(root: AnalysisNode): AnalysisPath[] {
  const steps: LineStep[] = [];
  let node = root;
  let path: AnalysisPath = [];
  while (node.children[0]) {
    const child = node.children[0]!;
    const childPath = [...path, 0];
    steps.push({ path: childPath, node: child, before: node.state });
    path = childPath;
    node = child;
  }
  const { entries, pathByPly, pathEndByPly } = replayLineHistory(root.state, steps, {
    includeOpeningSkips: true,
  });
  const paths: AnalysisPath[] = [[]];
  for (const e of entries) {
    if (e.kind !== 'ply') continue;
    const p = pathEndByPly.get(e.ply) ?? pathByPly.get(e.ply) ?? [];
    const last = paths[paths.length - 1]!;
    if (!pathEquals(last, p)) paths.push(p);
  }
  return paths;
}
