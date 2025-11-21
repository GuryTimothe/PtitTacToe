export enum TicTacToePlayer {
  X = 'X',
  O = 'O'
}

export type TicTacToeCell = TicTacToePlayer | null;

export type TicTacToeBoard = TicTacToeCell[];

export enum TicTacToeStatus {
  Idle = 'idle',
  InProgress = 'in-progress',
  Won = 'won',
  Draw = 'draw'
}

export interface TicTacToeMove {
  index: number;
  player: TicTacToePlayer;
}

export interface TicTacToeSnapshot {
  board: TicTacToeBoard;
  status: TicTacToeStatus;
  currentPlayer: TicTacToePlayer;
  winner?: TicTacToePlayer;
  winningLine?: number[];
  moveCount: number;
  history: TicTacToeMove[];
}

