import { runMcpServer } from '@mcp-near/index';
import { Command, Flags } from '@oclif/core';
import { homedir } from 'os';
import path from 'path';

export default class Run extends Command {
  static description = 'Run the NEAR MCP server';

  static examples = [
    '<%= config.bin %> run',
    '<%= config.bin %> run --key-dir ~/custom-near-keystore',
  ];

  static flags = {
    'key-dir': Flags.string({
      description: 'Directory for the NEAR keystore',
      default: path.join(homedir(), '.near-keystore'),
      helpValue: '<path>',
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Run);
    console.log('Running NEAR MCP server (stdio transport)...');
    await runMcpServer(flags.keyDir);
  }
}
