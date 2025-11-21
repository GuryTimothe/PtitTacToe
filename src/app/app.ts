import { Component, OnDestroy, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import Peer, { DataConnection, PeerJSOption } from 'peerjs';
import { TicTacToeEngine } from './Back/tic-tac-toe/tic-tac-toe-engine';
import {
  TicTacToePlayer,
  TicTacToeSnapshot,
  TicTacToeStatus
} from './Back/tic-tac-toe/tic-tac-toe.models';

type ConnectionState = 'idle' | 'hosting' | 'joining' | 'connected';

interface ChatMessage {
  id: string;
  sender: 'self' | 'peer';
  username: string;
  text: string;
  timestamp: number;
}

type PeerPayload =
  | { type: 'join'; username: string }
  | { type: 'host-ready'; username: string; youAre: TicTacToePlayer; snapshot: TicTacToeSnapshot }
  | { type: 'move'; index: number }
  | { type: 'reset' }
  | { type: 'chat'; message: string; username: string; timestamp: number };
type GlobalWithPeerConfig = typeof globalThis & {
  __ECHEC_PEER_CONFIG__?: PeerJSOption;
};

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnDestroy {
  protected readonly title = signal('EchecComplet');
  protected readonly TicTacToeStatus = TicTacToeStatus;

  private readonly engine = new TicTacToeEngine();
  private readonly boardSize = 3;

  private peer?: Peer;
  private connection?: DataConnection;


  protected hasMutedChat : boolean = false;
  protected readonly gameState = signal<TicTacToeSnapshot>(this.engine.getSnapshot());
  protected readonly statusMessage = computed(() => {
    const state = this.gameState();
    if (state.status === TicTacToeStatus.Won && state.winner) {
      return `Winner: ${state.winner}`;
    }
    if (state.status === TicTacToeStatus.Draw) {
      return 'Draw! No moves remain.';
    }
    if (this.connectionState() !== 'connected') {
      return 'Connect two peers to start playing.';
    }
    return `Turn: ${state.currentPlayer}`;
  });

  protected readonly connectionState = signal<ConnectionState>('idle');
  protected readonly username = signal('');
  protected readonly opponentName = signal('');
  protected readonly hostPeerId = signal('');
  protected readonly joinTargetId = signal('');
  protected readonly chatMessages = signal<ChatMessage[]>([]);
  protected readonly chatInput = signal('');
  protected readonly localPlayer = signal<TicTacToePlayer | null>(null);
  protected readonly infoMessage = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly isConnected = computed(() => this.connectionState() === 'connected');
  protected readonly connectionLabel = computed(() => {
    switch (this.connectionState()) {
      case 'hosting':
        return 'Hosting (waiting for opponent)...';
      case 'joining':
        return 'Connecting to host...';
      case 'connected':
        return `Connected as ${this.localPlayer() ?? '?'}`;
      default:
        return 'Idle';
    }
  });

  protected readonly remotePlayerSymbol = computed(() => {
    const local = this.localPlayer();
    if (local === null) {
      return null;
    }
    return local === TicTacToePlayer.X ? TicTacToePlayer.O : TicTacToePlayer.X;
  });

  constructor() {
    this.gameState.set(this.engine.getSnapshot());
  }

  public ngOnDestroy(): void {
    this.cleanupPeer();
  }

  protected startHosting(): void {
    if (!this.ensureUsername()) {
      return;
    }

    this.prepareForNewSession();
    this.connectionState.set('hosting');
    this.localPlayer.set(TicTacToePlayer.X);
    this.peer = this.createPeerInstance();

    this.peer.on('open', (id) => {
      this.hostPeerId.set(id);
      this.infoMessage.set('Share your host ID with a friend to let them join.');
    });

    this.peer.on('connection', (connection) => {
      if (this.connection) {
        connection.close();
        return;
      }
      this.setupConnection(connection, false);
    });

    this.peer.on('error', (err) => this.setError(err.message));
  }

  protected joinGame(): void {
    if (!this.ensureUsername()) {
      return;
    }

    const targetId = this.joinTargetId().trim();
    if (!targetId) {
      this.setError('Enter a host ID to join.');
      return;
    }

    this.prepareForNewSession();
    this.connectionState.set('joining');
    this.localPlayer.set(TicTacToePlayer.O);
    this.peer = this.createPeerInstance();

    this.peer.on('open', () => {
      const connection = this.peer?.connect(targetId, { reliable: true });
      if (!connection) {
        this.setError('Unable to initiate connection.');
        return;
      }
      this.setupConnection(connection, true);
    });

    this.peer.on('error', (err) => this.setError(err.message));
  }

  protected cancelConnection(): void {
    this.handleDisconnect('Session cancelled.');
  }

  protected handleCellClick(index: number): void {
    if (!this.canPlayCell(index)) {
      return;
    }
    this.applyMove(index, 'local');
  }

  protected canPlayCell(index: number): boolean {
    const state = this.gameState();
    if (state.status !== TicTacToeStatus.InProgress) {
      return false;
    }
    if (state.board[index] !== null) {
      return false;
    }
    if (this.connectionState() !== 'connected') {
      return false;
    }
    const player = this.localPlayer();
    return player !== null && state.currentPlayer === player;
  }

  protected resetGame(announce = true): void {
    const snapshot = this.engine.reset(TicTacToePlayer.X);
    this.gameState.set(snapshot);
    if (announce && this.connectionState() === 'connected') {
      this.sendPayload({ type: 'reset' });
    }
  }

  protected sendChatMessage(): void {
    if (this.connectionState() !== 'connected') {
      return;
    }
    const text = this.chatInput().trim();
    if (!text) {
      return;
    }

    const message: ChatMessage = {
      id: this.generateId(),
      sender: 'self',
      username: this.username().trim(),
      text,
      timestamp: Date.now()
    };

    this.appendChatMessage(message);
    this.chatInput.set('');
    this.sendPayload({ type: 'chat', message: text, username: message.username, timestamp: message.timestamp });
  }

  protected submitChat(event: Event): void {
    event.preventDefault();
    this.sendChatMessage();
  }

  protected formatTimestamp(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(timestamp)
    );
  }

  protected connectionReady(): boolean {
    return this.connectionState() === 'connected';
  }

  protected isPlayersTurn(): boolean {
    const player = this.localPlayer();
    const state = this.gameState();
    return (
      this.connectionState() === 'connected' &&
      state.status === TicTacToeStatus.InProgress &&
      player !== null &&
      state.currentPlayer === player
    );
  }

  protected chatPlaceholder(): string {
    return this.connectionState() === 'connected'
      ? 'Send a message to your opponent'
      : 'Connect to enable chat';
  }

  private setupConnection(connection: DataConnection, initiator: boolean): void {
    this.connection = connection;
    this.chatMessages.set([]);
    this.opponentName.set('');
    let hasOpened = false;

    connection.on('open', () => {
      hasOpened = true;
      this.connectionState.set('connected');
      this.infoMessage.set('Peers connected. Have fun!');
      this.setError(null);
      if (initiator) {
        this.sendPayload({ type: 'join', username: this.username().trim() });
      }
    });

    connection.on('data', (data) => this.handleIncomingPayload(data as PeerPayload));
    connection.on('close', () => {
      if (!hasOpened) {
        this.handlePreOpenFailure('Connection closed before it could be established.');
        return;
      }
      this.handleDisconnect('Peer disconnected.');
    });
    connection.on('error', (err) => {
      if (!hasOpened) {
        this.handlePreOpenFailure(`Negotiation failed: ${err.message}`);
        return;
      }
      this.handleDisconnect(err.message);
    });
  }

  private createPeerInstance(): Peer {
    const customConfig = this.resolvePeerConfig();
    return customConfig ? new Peer(customConfig) : new Peer();
  }

  private resolvePeerConfig(): PeerJSOption | undefined {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const globalConfig = (window as GlobalWithPeerConfig).__ECHEC_PEER_CONFIG__;
    if (globalConfig && typeof globalConfig === 'object') {
      return globalConfig;
    }
    return undefined;
  }

  private handleIncomingPayload(payload: PeerPayload): void {
    switch (payload.type) {
      case 'join':
        this.opponentName.set(payload.username);
        this.infoMessage.set(`${payload.username} joined your lobby.`);
        this.sendPayload({
          type: 'host-ready',
          username: this.username().trim(),
          youAre: TicTacToePlayer.O,
          snapshot: this.engine.getSnapshot()
        });
        break;
      case 'host-ready':
        this.opponentName.set(payload.username);
        this.localPlayer.set(payload.youAre);
        this.gameState.set(this.engine.loadSnapshot(payload.snapshot));
        this.infoMessage.set(
          `Connected to ${payload.username}. You are playing as ${payload.youAre}.`
        );
        break;
      case 'move':
        this.applyMove(payload.index, 'remote');
        break;
      case 'reset':
        this.resetGame(false);
        break;
      case 'chat':
        this.appendChatMessage({
          id: this.generateId(),
          sender: 'peer',
          username: payload.username,
          text: payload.message,
          timestamp: payload.timestamp
        });
        break;
    }
  }

  private handlePreOpenFailure(message: string): void {
    if (this.connectionState() === 'hosting') {
      this.releaseConnectionOnly();
      this.setError(message);
      this.infoMessage.set('Still hosting. Waiting for another opponent.');
      return;
    }

    if (this.connectionState() === 'joining') {
      this.handleDisconnect('Failed to connect to host.');
      this.setError(message);
      return;
    }

    this.handleDisconnect(message);
  }

  private applyMove(index: number, origin: 'local' | 'remote'): void {
    try {
      const snapshot = this.engine.playMove(index);
      this.gameState.set(snapshot);
      if (origin === 'local') {
        this.sendPayload({ type: 'move', index });
      }
    } catch (error: unknown) {
      console.warn(error);
    }
  }

  private prepareForNewSession(): void {
    this.cleanupPeer();
    this.resetGame(false);
    this.chatMessages.set([]);
    this.opponentName.set('');
    this.hostPeerId.set('');
  }

  private cleanupPeer(): void {
    this.releaseConnectionOnly();

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // noop
      }
    }
    this.peer = undefined;
  }

  private releaseConnectionOnly(): void {
    if (this.connection) {
      try {
        this.connection.close();
      } catch {
        // noop
      }
    }
    this.connection = undefined;
  }

  private handleDisconnect(message: string): void {
    this.infoMessage.set(message);
    this.connectionState.set('idle');
    this.localPlayer.set(null);
    this.opponentName.set('');
    this.chatMessages.set([]);
    this.cleanupPeer();
  }

  private sendPayload(payload: PeerPayload): void {
    if (!this.connection || !this.connection.open) {
      return;
    }
    this.connection.send(payload);
  }

  private appendChatMessage(message: ChatMessage): void {
    this.chatMessages.update((messages) => [...messages, message]);
  }

  private ensureUsername(): boolean {
    if (!this.username().trim()) {
      this.setError('Choose a username first.');
      return false;
    }
    this.setError(null);
    return true;
  }

  private setError(message: string | null): void {
    this.errorMessage.set(message);
    if (message) {
      this.infoMessage.set(null);
    }
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
}
