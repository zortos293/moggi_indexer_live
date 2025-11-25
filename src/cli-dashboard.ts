import * as cliProgress from 'cli-progress';
import chalk from 'chalk';

interface DashboardStats {
  forwardBlock: number;
  backwardBlock: number;
  latestBlock: number;
  startBlock: number;
  totalProcessed: number;
  blocksPerSecond: number;
  errorsCount: number;
  batchTime: number;
  dbStats?: {
    blocks: number;
    transactions: number;
    contracts: number;
    erc20Tokens: number;
    erc721Tokens: number;
  };
}

export class CLIDashboard {
  private progressBar: cliProgress.SingleBar;
  private startTime: number;
  private lastUpdateTime: number;
  private isLiveMode: boolean = false;
  private originalStartBlock: number = 0;
  private originalTargetBlock: number = 0;
  private totalProcessedOverall: number = 0;

  constructor() {
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();

    this.progressBar = new cliProgress.SingleBar({
      format: chalk.cyan('{bar}') + ' | {percentage}% | {value}/{total} blocks | ETA: {eta_formatted} | {speed} bl/s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false,
    }, cliProgress.Presets.shades_classic);
  }

  showHeader(chainId: number, rpcUrl: string, workers: number, batchSize: number): void {
    console.clear();
    console.log(chalk.bold.blue('╔════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.blue('║') + chalk.bold.white('                    MONAD INDEXER                           ') + chalk.bold.blue('║'));
    console.log(chalk.bold.blue('╚════════════════════════════════════════════════════════════╝'));
    console.log();
    console.log(chalk.gray('Chain ID:      ') + chalk.white(chainId));
    console.log(chalk.gray('RPC URL:       ') + chalk.white(rpcUrl));
    console.log(chalk.gray('Workers:       ') + chalk.white(workers));
    console.log(chalk.gray('Batch Size:    ') + chalk.white(batchSize));
    console.log();
  }

  startSync(startBlock: number, targetBlock: number): void {
    this.originalStartBlock = startBlock;
    this.originalTargetBlock = targetBlock;
    this.totalProcessedOverall = 0;

    const totalBlocks = targetBlock - startBlock;
    console.log(chalk.yellow('Starting bidirectional sync...'));
    console.log(chalk.gray('Forward:  ') + chalk.green(`${startBlock}`) + chalk.gray(' → ') + chalk.green(`${targetBlock}`));
    console.log(chalk.gray('Backward: ') + chalk.green(`${targetBlock}`) + chalk.gray(' → ') + chalk.green(`${startBlock}`));
    console.log();

    this.progressBar.start(totalBlocks, 0, {
      speed: '0.00',
      eta_formatted: 'calculating...',
    });
  }

  extendTarget(newTarget: number): void {
    const additionalBlocks = newTarget - this.originalTargetBlock;
    this.originalTargetBlock = newTarget;
    const newTotal = this.originalTargetBlock - this.originalStartBlock;
    this.progressBar.setTotal(newTotal);
  }

  updateProgress(stats: DashboardStats): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.startTime) / 1000;

    // Use the actual total processed count from stats
    this.totalProcessedOverall = stats.totalProcessed;
    const remaining = stats.backwardBlock - stats.forwardBlock;

    // Calculate ETA based on actual speed
    const blocksPerSecond = stats.blocksPerSecond > 0 ? stats.blocksPerSecond : (this.totalProcessedOverall / elapsedSeconds);
    const secondsRemaining = remaining / blocksPerSecond;
    const etaFormatted = this.formatTime(secondsRemaining);

    this.progressBar.update(this.totalProcessedOverall, {
      speed: blocksPerSecond.toFixed(2),
      eta_formatted: etaFormatted,
    });

    this.lastUpdateTime = now;
  }

  showBatchInfo(stats: DashboardStats): void {
    // Move cursor below progress bar to show batch info
    process.stdout.write('\n');

    const statusLine = [
      chalk.gray('Forward: ') + chalk.green(stats.forwardBlock),
      chalk.gray('Backward: ') + chalk.green(stats.backwardBlock),
      chalk.gray('Gap: ') + chalk.yellow(stats.backwardBlock - stats.forwardBlock),
      chalk.gray('Batch: ') + chalk.cyan(`${stats.batchTime}ms`),
      stats.errorsCount > 0 ? chalk.red(`Errors: ${stats.errorsCount}`) : chalk.green('No errors'),
    ].join(' | ');

    // Clear line and write status (using ANSI escape codes)
    process.stdout.write('\x1B[2K' + statusLine + '\r');
    process.stdout.write('\x1B[1A');
  }

  showDatabaseStats(stats: NonNullable<DashboardStats['dbStats']>): void {
    // Just update inline without breaking progress bar position
    // Skip for now to avoid cursor issues
  }

  completeSyncPhase(): void {
    this.progressBar.stop();
    console.log('\n');
    console.log(chalk.bold.green('✓ Initial sync completed!'));

    const totalTime = (Date.now() - this.startTime) / 1000;
    console.log(chalk.gray('Total time: ') + chalk.white(this.formatTime(totalTime)));
    console.log();
  }

  startLiveMode(): void {
    this.isLiveMode = true;
    console.log(chalk.bold.yellow('Live Indexing Mode'));
    console.log(chalk.gray('Watching for new blocks...'));
    console.log();
  }

  showLiveBlock(blockNumber: number, newBlocks: number): void {
    const timestamp = new Date().toLocaleTimeString();
    process.stdout.write(
      '\x1B[2K' +
      chalk.gray(`[${timestamp}] `) +
      chalk.green(`New blocks: +${newBlocks}`) +
      chalk.gray(' | ') +
      chalk.cyan(`Latest: ${blockNumber}`) +
      '\r'
    );
  }

  showNewBlocksDetected(oldLatest: number, newLatest: number): void {
    // Don't print - just extend target silently to avoid breaking progress bar
    // The change will be reflected in the next batch info update
  }

  showError(message: string): void {
    console.log(chalk.red(`Error: ${message}`));
  }

  showFinalStats(totalProcessed: number, totalTime: number, avgSpeed: number): void {
    console.log();
    console.log(chalk.bold.blue('╔════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.blue('║') + chalk.bold.white('                    INDEXING COMPLETE                       ') + chalk.bold.blue('║'));
    console.log(chalk.bold.blue('╚════════════════════════════════════════════════════════════╝'));
    console.log();
    console.log(chalk.gray('Total blocks processed: ') + chalk.green(totalProcessed.toLocaleString()));
    console.log(chalk.gray('Total time:            ') + chalk.green(this.formatTime(totalTime)));
    console.log(chalk.gray('Average speed:         ') + chalk.green(`${avgSpeed.toFixed(2)} blocks/sec`));
    console.log();
  }

  private formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) {
      return 'calculating...';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  cleanup(): void {
    if (!this.isLiveMode) {
      this.progressBar.stop();
    }
    process.stdout.write('\x1B[?25h'); // Show cursor
  }
}
