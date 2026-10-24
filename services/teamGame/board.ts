// Tic-tac-toe board rules for team games. The board grows with the number of teams
// so every team still has room to make a line:
//   2 teams: 3x3, 3 in a row    3 teams: 4x4, 3 in a row    4-6 teams: 5x5, 4 in a row

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 6;

export interface BoardShape {
  size: number; // cells per side
  lineLength: number; // marks in a row needed to win
}

export function boardFor(teamCount: number): BoardShape {
  if (teamCount <= 2) return { size: 3, lineLength: 3 };
  if (teamCount === 3) return { size: 4, lineLength: 3 };
  return { size: 5, lineLength: 4 };
}

/** Every run of `lineLength` cells across rows, columns and both diagonals. */
export function winningLines({ size, lineLength }: BoardShape): number[][] {
  const lines: number[][] = [];
  const at = (row: number, col: number) => row * size + col;
  const directions = [
    [0, 1], // across
    [1, 0], // down
    [1, 1], // diagonal
    [1, -1], // anti-diagonal
  ];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      for (const [dr, dc] of directions) {
        const endRow = row + dr * (lineLength - 1);
        const endCol = col + dc * (lineLength - 1);
        if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) continue;
        lines.push(Array.from({ length: lineLength }, (_, i) => at(row + dr * i, col + dc * i)));
      }
    }
  }
  return lines;
}

/** The first line that `teamId` owns completely, or null. */
export function findWinningLine(
  owners: (string | null)[],
  shape: BoardShape,
  teamId: string
): number[] | null {
  return winningLines(shape).find((line) => line.every((cell) => owners[cell] === teamId)) ?? null;
}
