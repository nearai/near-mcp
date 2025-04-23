import { Command, Flags } from '@oclif/core';
import { homedir } from 'os';
import path from 'path';

import { runMcpServer } from '../../';

export default class Run extends Command {
  static description = 'Run the NEAR MCP server';

  static examples = [
    '<%= config.bin %> run',
    '<%= config.bin %> run --key-dir ~/custom-near-keystore',
    '<%= config.bin %> run --remote',
    '<%= config.bin %> run --remote --port 4000',
  ];

  static flags = {
    'key-dir': Flags.string({
      description: 'Directory for the NEAR keystore',
      default: path.join(homedir(), '.near-keystore'),
      helpValue: '<path>',
    }),
    remote: Flags.boolean({
      description: 'Start the server with SSE transport instead of stdio',
      default: false,
    }),
    port: Flags.integer({
      description: 'Port to use for the remote server (when --remote is used)',
      default: 3001,
      helpValue: '<port>',
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Run);
    const keyDir = (() => {
      if (flags['key-dir']) {
        return flags['key-dir'];
      }

      const envKeyDir = process.env.NEAR_KEYSTORE;
      if (envKeyDir) {
        return envKeyDir;
      }

      return path.join(homedir(), '.near-keystore');
    })();
    try {
      await runMcpServer(keyDir, flags.remote, flags.port);
    } catch (error) {
      this.error(
        error instanceof Error ? error.message : 'Unknown error occurred',
      );
    }
  }
}
