import {
  TicTacToeBoard,
  TicTacToeMove,
  TicTacToePlayer,
  TicTacToeSnapshot,
  TicTacToeStatus
} from './tic-tac-toe.models';

/**
 * Core game engine that encapsulates the board logic for Tic-Tac-Toe.
 * Keeps a snapshot of the current state and exposes helper methods
 * to play turns, reset, or inspect the game without touching any UI.
 */
export class TicTacToeEngine {
  private readonly boardSize: number;
  private readonly totalCells: number;

  private snapshot: TicTacToeSnapshot;

  constructor(boardSize = 3, firstPlayer: TicTacToePlayer = TicTacToePlayer.X) {
    if (boardSize < 3) {
      throw new Error('Board size must be at least 3.');
    }

    this.boardSize = boardSize;
    this.totalCells = boardSize * boardSize;
    this.snapshot = this.createEmptySnapshot(firstPlayer);
  }

  /**
   * Resets the board and starts a new game.
   */
  public reset(firstPlayer: TicTacToePlayer = TicTacToePlayer.X): TicTacToeSnapshot {
    this.snapshot = this.createEmptySnapshot(firstPlayer);
    return this.cloneSnapshot();
  }

  /**
   * Accepts an externally provided snapshot (typically from a peer) and loads it locally.
   */
  public loadSnapshot(snapshot: TicTacToeSnapshot): TicTacToeSnapshot {
    if (snapshot.board.length !== this.totalCells) {
      throw new Error('Snapshot size does not match the configured board.');
    }

    this.snapshot = {
      ...snapshot,
      board: [...snapshot.board],
      history: [...snapshot.history]
    };

    return this.cloneSnapshot();
  }

  /**
   * Attempts to play a move using the flattened board index (0..8 for a 3x3 board).
   */
  public playMove(index: number): TicTacToeSnapshot {
    this.assertMoveIsAllowed(index);

    const board = [...this.snapshot.board];
    board[index] = this.snapshot.currentPlayer;

    const history: TicTacToeMove[] = [
      ...this.snapshot.history,
      { index, player: this.snapshot.currentPlayer }
    ];

    const moveCount = this.snapshot.moveCount + 1;

    const statusResult = this.evaluateBoard(board);

    const nextPlayer =
      statusResult.status === TicTacToeStatus.InProgress
        ? this.togglePlayer(this.snapshot.currentPlayer)
        : this.snapshot.currentPlayer;

    this.snapshot = {
      board,
      status: statusResult.status,
      currentPlayer: nextPlayer,
      winner: statusResult.winner,
      winningLine: statusResult.winningLine,
      moveCount,
      history
    };

    return this.cloneSnapshot();
  }

  /**
   * Returns a copy of the current state to keep the engine immutable from the caller perspective.
   */
  public getSnapshot(): TicTacToeSnapshot {
    return this.cloneSnapshot();
  }

  /**
   * Helper to list every available move (empty cell indexes).
   */
  public getAvailableMoves(): number[] {
    return this.snapshot.board
      .map((cell, idx) => (cell === null ? idx : -1))
      .filter((idx) => idx !== -1);
  }

  /**
   * Quickly tests whether a given index can be played next.
   */
  public canPlay(index: number): boolean {
    return (
      index >= 0 &&
      index < this.totalCells &&
      this.snapshot.board[index] === null &&
      this.snapshot.status === TicTacToeStatus.InProgress
    );
  }

  /**
   * Makes an automatic move using a basic strategy (first available cell).
   */
  public autoPlay(): TicTacToeSnapshot {
    const [nextMove] = this.getAvailableMoves();
    if (nextMove === undefined) {
      throw new Error('No moves available.');
    }
    return this.playMove(nextMove);
  }

  private assertMoveIsAllowed(index: number): void {
    if (this.snapshot.status !== TicTacToeStatus.InProgress) {
      throw new Error('Game is not currently accepting moves.');
    }

    if (!Number.isInteger(index) || index < 0 || index >= this.totalCells) {
      throw new Error(`Move index must be an integer between 0 and ${this.totalCells - 1}.`);
    }

    if (this.snapshot.board[index] !== null) {
      throw new Error(`Cell ${index} is already occupied.`);
    }
  }

  private createEmptySnapshot(firstPlayer: TicTacToePlayer): TicTacToeSnapshot {
    const board: TicTacToeBoard = Array.from({ length: this.totalCells }, () => null);
    return {
      board,
      status: TicTacToeStatus.InProgress,
      currentPlayer: firstPlayer,
      moveCount: 0,
      history: []
    };
  }

  private cloneSnapshot(): TicTacToeSnapshot {
    return {
      ...this.snapshot,
      board: [...this.snapshot.board],
      history: [...this.snapshot.history]
    };
  }

  private togglePlayer(player: TicTacToePlayer): TicTacToePlayer {
    return player === TicTacToePlayer.X ? TicTacToePlayer.O : TicTacToePlayer.X;
  }

  private evaluateBoard(
    board: TicTacToeBoard
  ): { status: TicTacToeStatus; winner?: TicTacToePlayer; winningLine?: number[] } {
    const winningLines = this.computeWinningLines();

    for (const line of winningLines) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return { status: TicTacToeStatus.Won, winner: board[a], winningLine: line };
      }
    }

    if (board.every((cell) => cell !== null)) {
      return { status: TicTacToeStatus.Draw };
    }

    return { status: TicTacToeStatus.InProgress, winner: undefined, winningLine: undefined };
  }

  private computeWinningLines(): number[][] {
    const lines: number[][] = [];

    // Rows
    for (let row = 0; row < this.boardSize; row++) {
      const start = row * this.boardSize;
      lines.push(Array.from({ length: this.boardSize }, (_, idx) => start + idx));
    }

    // Columns
    for (let col = 0; col < this.boardSize; col++) {
      lines.push(
        Array.from({ length: this.boardSize }, (_, idx) => idx * this.boardSize + col)
      );
    }

    // Diagonals
    lines.push(Array.from({ length: this.boardSize }, (_, idx) => idx * (this.boardSize + 1)));
    lines.push(
      Array.from(
        { length: this.boardSize },
        (_, idx) => (idx + 1) * (this.boardSize - 1)
      )
    );

    return lines;
  }
}

